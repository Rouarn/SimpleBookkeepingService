import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS_CLIENT, REDIS_KEYS } from '../redis/redis.constants.js';

/** 与 @nestjs/throttler 内部 ThrottlerStorageRecord 结构兼容 */
interface StorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * 基于 Redis ZSET 的滑动窗口日志限流（01 §6：Redis 滑窗；03 §7：多实例一致）。
 * 每次命中以「时间戳+唯一ID」为 member 落入 ZSET，先裁掉 ttl 之外的旧记录，
 * 再统计窗口内请求数；最老一条记录老化的时刻即为窗口重新放行的时刻。
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<StorageRecord> {
    const redisKey = REDIS_KEYS.throttle(throttlerName, key);
    const now = Date.now();
    const windowStart = now - ttl;

    const results = (await this.redis
      .multi()
      .zremrangebyscore(redisKey, 0, windowStart)
      .zadd(redisKey, now, `${now}:${randomUUID()}`)
      .zcard(redisKey)
      .zrange(redisKey, '0', '0', 'WITHSCORES')
      .pexpire(redisKey, ttl)
      .exec()) as Array<[Error | null, unknown]>;

    const totalHits = Number(results[2]?.[1] ?? 0);
    const oldestPair = results[3]?.[1] as [string?, string?] | undefined;
    const oldestScore = oldestPair?.[1] ? Number(oldestPair[1]) : now;
    // 最老记录老化出窗的时间；至少 1ms，避免边界 0
    const timeToExpire = Math.max(1, oldestScore + ttl - now);

    return {
      totalHits,
      timeToExpire,
      isBlocked: totalHits > limit,
      timeToBlockExpire: totalHits > limit ? timeToExpire : 0,
    };
  }
}
