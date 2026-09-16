import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

const PROCESSING = 'PROCESSING';
const LOCK_TTL_SECONDS = 10 * 60;
const RESULT_TTL_SECONDS = 24 * 60 * 60;

/** 成功结果只缓存账单 id；重放时实时查库并重新签发图片 URL（签名仅 12h，缓存 24h）。 */
export interface CommittedBillResult {
  billId: string;
}

/**
 * Idempotency-Key 防重复提交（04b §6）：
 * 同用户同 key：进行中 → 409；已有成功结果 → 返回已提交账单 id 由调用方重放；
 * 首次 → 加锁后执行并缓存 24h。
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** 返回已缓存的提交结果；null 表示首次请求（已加锁）。 */
  async beginOrReplay(
    userId: string,
    key: string | undefined,
  ): Promise<CommittedBillResult | null> {
    if (!key) return null;
    const redisKey = REDIS_KEYS.idempotency(userId, key);
    const cached = await this.redis.get(redisKey);
    if (cached !== null) {
      if (cached === PROCESSING) {
        throw new BusinessException(
          ERROR_CODES.CONFLICT.code,
          ERROR_CODES.CONFLICT.httpStatus,
          '请求正在处理中，请勿重复提交',
        );
      }
      return JSON.parse(cached) as CommittedBillResult;
    }
    const locked = await this.redis.set(
      redisKey,
      PROCESSING,
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (locked === null) {
      throw new BusinessException(
        ERROR_CODES.CONFLICT.code,
        ERROR_CODES.CONFLICT.httpStatus,
        '请求正在处理中，请勿重复提交',
      );
    }
    return null;
  }

  async commit(
    userId: string,
    key: string | undefined,
    billId: string,
  ): Promise<void> {
    if (!key) return;
    const result: CommittedBillResult = { billId };
    await this.redis.set(
      REDIS_KEYS.idempotency(userId, key),
      JSON.stringify(result),
      'EX',
      RESULT_TTL_SECONDS,
    );
  }

  async fail(userId: string, key: string | undefined): Promise<void> {
    if (!key) return;
    await this.redis.del(REDIS_KEYS.idempotency(userId, key));
  }
}
