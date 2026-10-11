import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { CronLockService } from '../../../common/cron/cron-lock.service.js';

/** 选主锁 TTL 兜底（P1-20）：按任务预估时长 10 分钟 */
const PURGE_LOCK_TTL_SECONDS = 10 * 60;

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
 * - access JWT（2h）无状态，载荷 sub/jti/iat/exp/type；
 * - refresh JWT（30d）仅以 SHA256 形态入库；
 * - 刷新即轮换；已吊销令牌再次出现 → 吊销该用户全部 refresh（疑似泄漏）。
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
  ) {
    this.jwtConfig = this.configService.get<AppConfig['jwt']>('jwt')!;
  }

  /** 签发一对新令牌并把 refresh 哈希入库；可在事务内（manager）执行。 */
  async issuePair(
    userId: string,
    device: TokenDeviceInfo,
    manager?: EntityManager,
  ): Promise<TokenPair> {
    const accessJti = randomUUID();
    const refreshJti = randomUUID();

    const accessToken = this.jwtService.sign(
      { sub: String(userId), jti: accessJti, type: 'access' },
      {
        secret: this.jwtConfig.accessSecret,
        expiresIn: this.jwtConfig.accessTtlSeconds,
        algorithm: 'HS256',
      },
    );
    const refreshToken = this.jwtService.sign(
      { sub: String(userId), jti: refreshJti, type: 'refresh' },
      {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshTtlSeconds,
        algorithm: 'HS256',
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
   * 已吊销令牌被重用时吊销该用户全部有效 refresh。
   */
  async rotate(rawRefreshToken: string): Promise<TokenPair> {
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
      await this.dataSource.query(
        'UPDATE refresh_tokens SET revoked_at = NOW(3) WHERE user_id = ? AND revoked_at IS NULL',
        [String(payload.sub)],
      );
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
        // 并发刷新竞争：另一请求已轮换，本次按重用处理
        await this.dataSource.query(
          'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW(3)) WHERE user_id = ? AND revoked_at IS NULL',
          [String(payload.sub)],
        );
        invalidRefresh();
      }
      return this.issuePair(String(payload.sub), device, manager);
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

  private verifyRefreshJwt(token: string): RefreshJwtPayload {
    let payload: RefreshJwtPayload;
    try {
      payload = this.jwtService.verify<RefreshJwtPayload>(token, {
        secret: this.jwtConfig.refreshSecret,
        algorithms: ['HS256'],
      });
    } catch {
      invalidRefresh();
    }
    if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
      invalidRefresh();
    }
    return payload;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
