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
import { requestContext } from '../context/trace.context.js';

interface JwtAccessPayload {
  sub: string;
  jti: string;
  type: 'access';
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
 * - 校验 Bearer access token（过期 40101 / 缺失或非法 40100）；
 * - 查库校验账号状态（冻结 40300），注入 req.user；
 * - userId 只取自令牌，绝不信任客户端入参（07 §3.3）。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
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

    // 查库：账号必须存在且未冻结
    const rows = await this.dataSource.query(
      'SELECT id, status FROM users WHERE id = ? LIMIT 1',
      [payload.sub],
    );
    const userRow = (rows as Array<{ id: string; status: number }>)[0];
    if (!userRow) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }
    if (Number(userRow.status) !== 1) {
      throw new BusinessException(
        ERROR_CODES.ACCOUNT_FROZEN.code,
        ERROR_CODES.ACCOUNT_FROZEN.httpStatus,
        ERROR_CODES.ACCOUNT_FROZEN.message,
      );
    }

    request.user = { id: String(payload.sub), jti: payload.jti };
    const store = requestContext.getStore();
    if (store) store.userId = String(payload.sub);
    return true;
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
