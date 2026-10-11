import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import bcrypt from 'bcrypt';
import { Redis } from 'ioredis';
import { User } from '../../../entities/user.entity.js';
import { Book } from '../../../entities/book.entity.js';
import { UserPreference } from '../../../entities/user-preference.entity.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { todayStr } from '../../../common/utils/date.util.js';
import { SignedUrlService } from '../../files/services/signed-url.service.js';
import type { LoginDto } from '../dto/login.dto.js';
import type { RegisterDto } from '../dto/register.dto.js';
import { buildAuthUserVo, type AuthUserVo } from '../vo/auth-user.vo.js';
import type { TokenDeviceInfo, TokenPair } from './token.service.js';
import { TokenService } from './token.service.js';

const BCRYPT_COST = 12;
const LOGIN_FAIL_WINDOW_MS = 15 * 60_000;
const LOGIN_FAIL_LIMIT = 5;
/** 账号不存在时也做一次等代价 bcrypt 比较，消除响应计时差（07 §2 防枚举）。 */
const DUMMY_PASSWORD_HASH =
  '$2b$12$OIgkhAY9.deX7Hrgu4XvrOGwWpEX0QxcQ./T2nhYj4x5VENfPODA.';

function phoneAlreadyRegistered(): never {
  throw new BusinessException(
    ERROR_CODES.PARAM_INVALID.code,
    ERROR_CODES.PARAM_INVALID.httpStatus,
    '该手机号已注册',
    { field: 'phone' },
  );
}

export type AuthResult = TokenPair & { user: AuthUserVo };

/**
 * 认证服务（04a §1~§4 / 07 §3）：
 * 注册事务①（用户 + 默认账本 + 偏好 + refresh 入库）；登录失败计数防枚举。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly tokenService: TokenService,
    private readonly signedUrlService: SignedUrlService,
  ) {}

  /** 注册：单事务创建用户、默认账本「个人账本」、偏好行，并直接签发双令牌。 */
  async register(dto: RegisterDto): Promise<AuthResult> {
    const exists = await this.dataSource.getRepository(User).findOne({
      where: { phone: dto.phone },
      select: { id: true },
    });
    if (exists) phoneAlreadyRegistered();

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const device: TokenDeviceInfo = {
      deviceId: dto.deviceId,
      platform: dto.platform,
    };

    let user: User;
    let pair: TokenPair;
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const userEntity = manager.create(User, {
          phone: dto.phone,
          passwordHash,
          nickname: dto.nickname ?? '小绿',
          avatarUrl: '',
          joinDate: todayStr(),
          status: 1,
        });
        await manager.save(userEntity);

        const bookEntity = manager.create(Book, {
          userId: userEntity.id,
          name: '个人账本',
          budget: '0.00',
          isDefault: true,
          sortOrder: 0,
          deletedAt: null,
        });
        await manager.save(bookEntity);

        const preferenceEntity = manager.create(UserPreference, {
          userId: userEntity.id,
          activeBookId: bookEntity.id,
          flowMonth: null,
          flowType: 'ALL',
          statsMonth: null,
          statsType: 'expense',
          lastBillType: 'expense',
          lastPayMethodId: null,
          lastCategoryExpenseId: null,
          lastCategoryIncomeId: null,
        });
        await manager.save(preferenceEntity);

        const tokenPair = await this.tokenService.issuePair(
          userEntity.id,
          device,
          manager,
        );
        return { user: userEntity, pair: tokenPair };
      });
      user = result.user;
      pair = result.pair;
    } catch (error) {
      // 并发注册同一手机号：唯一键冲突归并为业务错误（不落 50000）
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | null)?.code === 'ER_DUP_ENTRY'
      ) {
        phoneAlreadyRegistered();
      }
      throw error;
    }

    return { ...pair, user: buildAuthUserVo(user, this.signedUrlService) };
  }

  /** 登录：手机号维度失败计数锁定（5 次/15 分钟，40103），错误文案统一防枚举。 */
  async login(dto: LoginDto): Promise<AuthResult> {
    const failKey = REDIS_KEYS.loginFailPhone(dto.phone);
    // Redis 故障降级（P1-04）：锁定计数读写失败时不拒绝业务
    // （宁可不锁，不可拒业务），仅记录告警并正常走密码校验。
    let locked = false;
    try {
      const failCount = Number((await this.redis.get(failKey)) ?? 0);
      locked = failCount >= LOGIN_FAIL_LIMIT;
    } catch (error) {
      this.logger.warn(
        `登录失败计数读取失败，跳过锁定判定: ${(error as Error).message}`,
      );
    }
    if (locked) {
      throw new BusinessException(
        ERROR_CODES.LOGIN_TOO_MANY.code,
        ERROR_CODES.LOGIN_TOO_MANY.httpStatus,
        ERROR_CODES.LOGIN_TOO_MANY.message,
      );
    }

    const user = await this.dataSource.getRepository(User).findOne({
      where: { phone: dto.phone },
    });
    // 账号不存在也执行一次等代价比较，避免通过响应耗时枚举账号（07 §2）
    const passwordMatched = await bcrypt.compare(
      dto.password,
      user ? user.passwordHash : DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatched) {
      try {
        const next = await this.redis.incr(failKey);
        if (next === 1) await this.redis.pexpire(failKey, LOGIN_FAIL_WINDOW_MS);
      } catch (error) {
        this.logger.warn(
          `登录失败计数写入失败，本次跳过计数: ${(error as Error).message}`,
        );
      }
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '手机号或密码错误',
      );
    }

    if (user.status !== 1) {
      throw new BusinessException(
        ERROR_CODES.ACCOUNT_FROZEN.code,
        ERROR_CODES.ACCOUNT_FROZEN.httpStatus,
        ERROR_CODES.ACCOUNT_FROZEN.message,
      );
    }

    // 登录成功清零失败计数；Redis 故障时降级为不清零（计数有 15 分钟窗口自然过期）
    try {
      await this.redis.del(failKey);
    } catch (error) {
      this.logger.warn(`登录失败计数清零失败: ${(error as Error).message}`);
    }
    const loginAt = new Date();
    await this.dataSource.query(
      'UPDATE users SET last_login_at = NOW(3) WHERE id = ?',
      [user.id],
    );
    user.lastLoginAt = loginAt;

    const pair = await this.tokenService.issuePair(user.id, {
      deviceId: dto.deviceId,
      platform: dto.platform,
    });
    return {
      ...pair,
      user: buildAuthUserVo(user, this.signedUrlService, {
        lastLoginAt: loginAt,
      }),
    };
  }

  /** 刷新轮换。 */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    return this.tokenService.rotate(rawRefreshToken);
  }

  /** 登出：吊销携带的 refresh token（access 短期无状态，客户端丢弃即可）。 */
  async logout(rawRefreshToken: string | undefined): Promise<void> {
    await this.tokenService.revoke(rawRefreshToken);
  }
}
