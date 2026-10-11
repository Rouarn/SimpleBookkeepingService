import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../../config/configuration.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import type { AuthUser } from '../decorators/current-user.decorator.js';
import { BusinessException } from '../exceptions/business.exception.js';
import { ERROR_CODES } from '../exceptions/error-codes.js';
import { RedisCacheService } from '../redis/redis-cache.service.js';
import { REDIS_KEYS } from '../redis/redis.constants.js';
import { requestContext } from '../context/trace.context.js';

/** token_version 短缓存 TTL（P1-01）：守卫免每请求查库，版本变更时主动失效 */
const TOKEN_VERSION_CACHE_TTL_SECONDS = 60;

/**
 * 守卫短缓存条目（P2-11）：同时缓存账号状态与 token_version，
 * 命中时即可完成「冻结校验 + 版本校验」，彻底消掉每请求 SELECT users。
 * 冻结/改密/全员登出由写路径主动 invalidate（TTL 60s 兜底）。
 */
interface TokenVersionCacheEntry {
  /** users.status：1=正常，其余视为冻结 */
  status: number;
  /** users.token_version */
  version: number;
}

interface JwtAccessPayload {
  sub: string;
  jti: string;
  type: 'access';
  /** 签发时的用户 token_version（P1-01）：与库中不一致即令牌已被版本化吊销 */
  ver?: number;
  iat: number;
  exp: number;
}

interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthUser;
}

/**
 * 全局 JWT 守卫（03 §6）：
 * - @Public() 白名单直通；
 * - 校验 Bearer access token（过期 40101 / 缺失或非法 40100），含 iss/aud（P1-05）；
 * - 校验 ver 声明与用户 token_version 一致（P1-01，status+version 60s 短缓存免每请求查库，
 *   不一致按 40100 提示重新登录；Redis 异常回源 DB，不因缓存故障拒绝业务）；
 * - 校验账号状态（缓存命中同样拦截，冻结 40300），注入 req.user；
 * - userId 只取自令牌，绝不信任客户端入参（07 §3.3）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly cache: RedisCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authorization = request.headers.authorization;
    const token = this.extractBearer(authorization);
    if (!token) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }

    const jwtConfig = this.configService.get<AppConfig['jwt']>('jwt')!;
    let payload: JwtAccessPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtAccessPayload>(token, {
        secret: jwtConfig.accessSecret,
        algorithms: ['HS256'],
        issuer: jwtConfig.issuer,
        audience: jwtConfig.audience,
      });
    } catch (error) {
      if ((error as { name?: string }).name === 'TokenExpiredError') {
        throw new BusinessException(
          ERROR_CODES.ACCESS_TOKEN_EXPIRED.code,
          ERROR_CODES.ACCESS_TOKEN_EXPIRED.httpStatus,
          ERROR_CODES.ACCESS_TOKEN_EXPIRED.message,
        );
      }
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }

    if (payload.type !== 'access' || !payload.sub) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }

    // token_version 校验（P1-01/P2-11）：优先走 60s 短缓存免每请求查库；
    // 缓存条目含 status + version，命中即完成冻结校验与版本比对，
    // 账号冻结/改密由写路径主动失效（最迟 60s 随 TTL 收敛）。
    const cachedEntry = await this.cache.get<TokenVersionCacheEntry>(
      REDIS_KEYS.tokenVersion(payload.sub),
    );
    // 兼容灰度窗口：旧版缓存是裸数字（仅 version），形态不符即按未命中回源 DB，
    // 避免升级后 60s 内把旧缓存误读为 status 缺失而判冻结
    if (cachedEntry !== null && typeof cachedEntry === 'object') {
      if (Number(cachedEntry.status) !== 1) this.rejectFrozen();
      if (payload.ver !== Number(cachedEntry.version)) this.rejectStaleToken();
      request.user = { id: String(payload.sub), jti: payload.jti };
      const store = requestContext.getStore();
      if (store) store.userId = String(payload.sub);
      return true;
    }

    // 缓存未命中（或 Redis 异常，视为未命中）回源 DB：账号必须存在且未冻结
    const rows = await this.dataSource.query(
      'SELECT id, status, token_version FROM users WHERE id = ? LIMIT 1',
      [payload.sub],
    );
    const userRow = (
      rows as Array<{
        id: string;
        status: number;
        token_version: number | string;
      }>
    )[0];
    if (!userRow) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }
    if (Number(userRow.status) !== 1) {
      this.rejectFrozen();
    }
    const dbVersion = Number(userRow.token_version ?? 0);
    if (payload.ver !== dbVersion) this.rejectStaleToken();

    // 回写短缓存（60s，含 status + version）：写失败不阻断
    //（set 内部吞异常，靠下次未命中重试）
    await this.cache.set(
      REDIS_KEYS.tokenVersion(payload.sub),
      {
        status: Number(userRow.status),
        version: dbVersion,
      } satisfies TokenVersionCacheEntry,
      TOKEN_VERSION_CACHE_TTL_SECONDS,
    );

    request.user = { id: String(payload.sub), jti: payload.jti };
    const store = requestContext.getStore();
    if (store) store.userId = String(payload.sub);
    return true;
  }

  /** 账号冻结（status 非 1）：40300，语义区别于通用 40301。 */
  private rejectFrozen(): never {
    throw new BusinessException(
      ERROR_CODES.ACCOUNT_FROZEN.code,
      ERROR_CODES.ACCOUNT_FROZEN.httpStatus,
      ERROR_CODES.ACCOUNT_FROZEN.message,
    );
  }

  /** ver 与库中 token_version 不一致（含旧令牌缺 ver）：令牌已被版本化吊销。 */
  private rejectStaleToken(): never {
    throw new BusinessException(
      ERROR_CODES.UNAUTHORIZED.code,
      ERROR_CODES.UNAUTHORIZED.httpStatus,
      '登录状态已更新，请重新登录',
    );
  }

  private extractBearer(
    authorization: string | string[] | undefined,
  ): string | null {
    const header = Array.isArray(authorization)
      ? authorization[0]
      : authorization;
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/.exec(header.trim());
    return match ? match[1]!.trim() : null;
  }
}
