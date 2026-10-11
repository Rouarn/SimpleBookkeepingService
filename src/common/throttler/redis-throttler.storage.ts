import { Inject, Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger('RedisThrottlerStorage');

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

    let results: Array<[Error | null, unknown]>;
    try {
      results = (await this.redis
        .multi()
        .zremrangebyscore(redisKey, 0, windowStart)
        .zadd(redisKey, now, `${now}:${randomUUID()}`)
        .zcard(redisKey)
        .zrange(redisKey, '0', '0', 'WITHSCORES')
        .pexpire(redisKey, ttl)
        .exec()) as Array<[Error | null, unknown]>;
    } catch (error) {
      // Redis 故障时限流 fail-open（P1-04）：全局限流守卫先于 JWT，
      // 每个请求必经此处，抛异常会把 Redis 故障放大成全站 5xx；
      // 降级为「本次未计数、直接放行」（isBlocked=false 即放行语义），
      // 故障恢复后窗口计数自动重新累积。
      this.logger.warn(
        `限流计数失败（key=${redisKey}），降级放行: ${(error as Error).message}`,
      );
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

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
