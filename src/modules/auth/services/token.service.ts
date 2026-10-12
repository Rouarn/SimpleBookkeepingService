import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { CronLockService } from '../../../common/cron/cron-lock.service.js';
import { RedisCacheService } from '../../../common/redis/redis-cache.service.js';
import { REDIS_KEYS } from '../../../common/redis/redis.constants.js';
import { formatTimestamp } from '../../../common/utils/date.util.js';
import { MessagesService } from '../../messages/messages.service.js';

/** 选主锁 TTL 兜底（P1-20）：按任务预估时长 10 分钟 */
const PURGE_LOCK_TTL_SECONDS = 10 * 60;

/** refresh 轮换幂等映射 TTL（P1-02）：覆盖客户端并发重试窗口，过期后映射消失 */
const RT_SWAP_TTL_SECONDS = 30;

export interface TokenDeviceInfo {
  deviceId?: string;
  platform?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

interface RefreshJwtPayload {
  sub: string;
  jti: string;
  type: string;
  iat: number;
  exp: number;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  jti: string;
  token_hash: string;
  device_id: string;
  platform: string;
  expires_at: Date;
  revoked_at: Date | null;
}

function invalidRefresh(): never {
  throw new BusinessException(
    ERROR_CODES.REFRESH_TOKEN_INVALID.code,
    ERROR_CODES.REFRESH_TOKEN_INVALID.httpStatus,
    ERROR_CODES.REFRESH_TOKEN_INVALID.message,
  );
}

/**
 * 双令牌服务（07 §3）：
 * - access JWT（默认 30m）无状态，载荷 sub/jti/iat/exp/type/ver（P1-01 token 版本）；
 * - refresh JWT（30d）仅以 HMAC-SHA256 形态入库（P2-13：密钥为服务端 REFRESH_PEPPER，
 *   库泄漏时无 pepper 无法离线枚举/碰撞，优于无盐 SHA-256）；
 * - 刷新即轮换；已吊销令牌再次出现 → 吊销该用户全部 refresh（疑似泄漏）；
 * - 并发轮换竞争走幂等映射（P1-02），良性并发不再连坐吊销。
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger('TokenService');
  private readonly jwtConfig: AppConfig['jwt'];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly cronLock: CronLockService,
    private readonly cache: RedisCacheService,
    private readonly messagesService: MessagesService,
  ) {
    this.jwtConfig = this.configService.get<AppConfig['jwt']>('jwt')!;
  }

  /**
   * 签发一对新令牌并把 refresh 哈希入库；可在事务内（manager）执行。
   * access 载荷带 ver（用户 token_version，P1-01），并写入 iss/aud（P1-05）。
   */
  async issuePair(
    userId: string,
    device: TokenDeviceInfo,
    tokenVersion: number,
    manager?: EntityManager,
  ): Promise<TokenPair> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessToken = this.jwtService.sign(
      {
        sub: String(userId),
        jti: accessJti,
        type: 'access',
        ver: tokenVersion,
      },
      {
        secret: this.jwtConfig.accessSecret,
        expiresIn: this.jwtConfig.accessTtlSeconds,
        algorithm: 'HS256',
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      },
    );
    const refreshToken = this.jwtService.sign(
      { sub: String(userId), jti: refreshJti, type: 'refresh' },
      {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshTtlSeconds,
        algorithm: 'HS256',
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      },
    );

    const executor = manager ?? this.dataSource;
    await executor.query(
      `INSERT INTO refresh_tokens (user_id, jti, token_hash, device_id, platform, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? SECOND))`,
      [
        String(userId),
        refreshJti,
        this.hashToken(refreshToken),
        (device.deviceId ?? '').slice(0, 64),
        (device.platform ?? '').slice(0, 16),
        this.jwtConfig.refreshTtlSeconds,
      ],
    );

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.jwtConfig.accessTtlSeconds,
    };
  }

  /**
   * 刷新轮换：校验 JWT → 查库存 → 吊销旧令牌并签发新对。
   * 任何不一致（无效/过期/哈希不符/已吊销）一律 40102；
   * 已吊销令牌被重用时吊销该用户全部有效 refresh；
   * 并发轮换竞争（P1-02）：先查幂等映射，命中则返回同一新令牌对，
   * 未命中（真窗口外重放）才全家族吊销并记安全日志。
   */
  async rotate(rawRefreshToken: string, ip = ''): Promise<TokenPair> {
    const payload = this.verifyRefreshJwt(rawRefreshToken);
    const tokenHash = this.hashToken(rawRefreshToken);

    const rows = await this.dataSource.query<RefreshTokenRow[]>(
      `SELECT id, user_id, jti, token_hash, device_id, platform, expires_at, revoked_at
         FROM refresh_tokens WHERE jti = ? LIMIT 1`,
      [payload.jti],
    );
    const stored = rows[0];
    if (!stored || String(stored.user_id) !== String(payload.sub)) {
      invalidRefresh();
    }

    // 冻结账号不得通过刷新重新获得 access（与 JwtAuthGuard 口径一致，07 §3）
    const userRows = await this.dataSource.query<Array<{ status: number }>>(
      'SELECT status FROM users WHERE id = ? LIMIT 1',
      [String(payload.sub)],
    );
    if (!userRows[0] || Number(userRows[0].status) !== 1) {
      throw new BusinessException(
        ERROR_CODES.ACCOUNT_FROZEN.code,
        ERROR_CODES.ACCOUNT_FROZEN.httpStatus,
        ERROR_CODES.ACCOUNT_FROZEN.message,
      );
    }

    if (stored.revoked_at !== null || stored.token_hash !== tokenHash) {
      // 重用检测：作废该用户当前全部有效 refresh token
      await this.revokeAllRefreshTokens(String(payload.sub));
      this.logger.warn(
        `检测到 refresh token 重用，已吊销该用户全部 refresh：userId=${String(payload.sub)}，旧 jti 摘要=${this.digestJti(payload.jti)}`,
      );
      await this.notifySecurityAlert(String(payload.sub), ip);
      invalidRefresh();
    }

    const device: TokenDeviceInfo = {
      deviceId: stored.device_id || undefined,
      platform: stored.platform || undefined,
    };

    return this.dataSource.transaction(async (manager) => {
      const result = await manager.query(
        `UPDATE refresh_tokens
           SET revoked_at = NOW(3), last_used_at = NOW(3)
         WHERE id = ? AND revoked_at IS NULL`,
        [stored.id],
      );
      if ((result as { affectedRows?: number }).affectedRows !== 1) {
        // 并发刷新竞争（P1-02）：幂等映射命中则直接返回映射中的新令牌对
        // （不吊销、不报错）；未命中视为窗口外重放，回退全家族吊销。
        // 注意吊销须走非事务连接：下方抛错会回滚 manager 内的变更。
        const swapped = await this.swapCacheGet(payload.jti);
        if (swapped) return swapped;
        await this.revokeAllRefreshTokens(String(payload.sub));
        this.logger.warn(
          `refresh 轮换竞争且幂等映射未命中（疑似重放），已吊销该用户全部 refresh：userId=${String(payload.sub)}，旧 jti 摘要=${this.digestJti(payload.jti)}`,
        );
        await this.notifySecurityAlert(String(payload.sub), ip);
        invalidRefresh();
      }
      // 事务内读最新 token_version：改密并发时新令牌携带的 ver 尽量新鲜
      const tokenVersion = await this.readTokenVersion(
        manager,
        String(payload.sub),
      );
      const pair = await this.issuePair(
        String(payload.sub),
        device,
        tokenVersion,
        manager,
      );
      // 轮换成功后登记幂等映射（P1-02）：映射须在事务提交前写入，
      // 否则并发请求会在「已提交、映射未写」的间隙误判为重放
      await this.swapCachePut(payload.jti, pair);
      return pair;
    });
  }

  /**
   * 每日清理 refresh_tokens（02 §2.2 有效期 30 天）：
   * 删除已过期行，以及吊销满 30 天（过了合理申诉窗口）的行，控制表增长。
   */
  @Cron('45 3 * * *', { name: 'refresh-tokens-purge' })
  async purgeExpired(): Promise<void> {
    // 多实例选主锁（P1-20）：同一时刻仅一个实例执行，其余实例跳过
    await this.cronLock.runWithLock(
      'refresh-tokens-purge',
      PURGE_LOCK_TTL_SECONDS,
      async () => {
        try {
          const result = await this.dataSource.query(
            `DELETE FROM refresh_tokens
              WHERE expires_at < NOW(3)
                 OR (revoked_at IS NOT NULL AND revoked_at < DATE_SUB(NOW(3), INTERVAL 30 DAY))`,
          );
          const affected =
            (result as { affectedRows?: number }).affectedRows ?? 0;
          if (affected > 0) {
            this.logger.log(`清理过期/吊销 refresh token ${affected} 行`);
          }
        } catch (error) {
          this.logger.error(
            `refresh token 清理失败: ${(error as Error).message}`,
          );
        }
      },
    );
  }

  /** 登出：携带 refresh 则吊销；非法/过期直接幂等成功。 */
  async revoke(rawRefreshToken: string | undefined): Promise<void> {
    if (!rawRefreshToken) return;
    let payload: RefreshJwtPayload;
    try {
      payload = this.verifyRefreshJwt(rawRefreshToken);
    } catch {
      return;
    }
    await this.dataSource.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE jti = ? AND revoked_at IS NULL',
      [payload.jti],
    );
  }

  /** P1-01：吊销该用户全部 refresh token（改密/全员登出/重用处置共用）。 */
  async revokeAllRefreshTokens(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const executor = manager ?? this.dataSource;
    await executor.query(
      'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
      [userId],
    );
  }

  /**
   * P1-01：token_version 自增并返回新版本号（改密/全员登出后旧 access 即刻失效）。
   * 调用方随后应执行 invalidateVersionCache 清守卫侧短缓存。
   */
  async bumpTokenVersion(
    userId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const executor = manager ?? this.dataSource;
    await executor.query(
      'UPDATE users SET token_version = token_version + 1 WHERE id = ?',
      [userId],
    );
    return this.readTokenVersion(executor, userId);
  }

  /** P1-01：失效 token_version 短缓存，让版本变更对守卫立即可见（TTL 兜底）。 */
  async invalidateVersionCache(userId: string): Promise<void> {
    await this.cache.invalidateKeys(REDIS_KEYS.tokenVersion(userId));
  }

  private verifyRefreshJwt(token: string): RefreshJwtPayload {
    let payload: RefreshJwtPayload;
    try {
      payload = this.jwtService.verify<RefreshJwtPayload>(token, {
        secret: this.jwtConfig.refreshSecret,
        algorithms: ['HS256'],
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      });
    } catch {
      invalidRefresh();
    }
    if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
      invalidRefresh();
    }
    return payload;
  }

  /**
   * refresh token 存储哈希（P2-13）：HMAC-SHA256(REFRESH_PEPPER, token)。
   * 注意：更换 pepper（或首次上线本算法）后历史哈希全部失配，
   * 存量 refresh token 会失效，用户需用账号密码重新登录。
   */
  private hashToken(token: string): string {
    return createHmac('sha256', this.jwtConfig.refreshPepper)
      .update(token)
      .digest('hex');
  }

  /** 读取用户 token_version（签发 access JWT 的 ver 声明用）。 */
  private async readTokenVersion(
    executor: DataSource | EntityManager,
    userId: string,
  ): Promise<number> {
    const rows = await executor.query<
      Array<{ token_version: number | string }>
    >('SELECT token_version FROM users WHERE id = ? LIMIT 1', [userId]);
    return Number(rows[0]?.token_version ?? 0);
  }

  /** 读轮换幂等映射（P1-02）：Redis 异常/未命中均返回 null，回退现行全家族吊销。 */
  private async swapCacheGet(oldJti: string): Promise<TokenPair | null> {
    return this.cache.get<TokenPair>(REDIS_KEYS.rtSwap(oldJti));
  }

  /** 写轮换幂等映射（P1-02）：写失败不阻断轮换主流程（退化为现行连坐行为）。 */
  private async swapCachePut(oldJti: string, pair: TokenPair): Promise<void> {
    await this.cache.set(REDIS_KEYS.rtSwap(oldJti), pair, RT_SWAP_TTL_SECONDS);
  }

  /** jti 摘要（安全日志用）：只落 SHA256 前 12 位，不落完整令牌。 */
  private digestJti(jti: string): string {
    return createHash('sha256').update(jti).digest('hex').slice(0, 12);
  }

  /**
   * 安全告警站内消息（旁路增强，append 内部吞错绝不抛出）：
   * content 仅含时间与来源 IP 摘要，不含任何 token/jti 明文。
   */
  private async notifySecurityAlert(userId: string, ip: string): Promise<void> {
    await this.messagesService.append(
      userId,
      'security',
      '安全提醒',
      `检测到登录凭证异常使用，系统已于 ${formatTimestamp()} 吊销该账号全部登录态（来源 IP：${ip || '未知'}）。若非本人操作，请立即修改密码。`,
    );
  }
}
