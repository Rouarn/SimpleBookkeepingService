import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from './redis.constants.js';

/** 统计聚合缓存 slot：月维度只缓存三件套（月度 trend 序列含当前月，保持实时）；年维度额外含 trend。 */
export const STAT_MONTH_SLOTS = [
  'overview',
  'categories',
  'payMethods',
] as const;
export const STAT_YEAR_SLOTS = [...STAT_MONTH_SLOTS, 'trend'] as const;

/**
 * 可降级 Redis 缓存助手：读/写/失效异常一律吞掉并视为未命中，
 * 保证 Redis 连接异常时业务请求仍可回源 DB（统计/字典缓存专用）。
 */
@Injectable()
export class RedisCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** 读缓存：未命中、连接异常、内容损坏均返回 null，由调用方回源 DB。 */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch {
      // 内容损坏尝试摘除；连接异常时摘除失败也无碍，靠 TTL 自然过期
      try {
        await this.redis.del(key);
      } catch {
        // 忽略
      }
      return null;
    }
  }

  /** 写缓存：失败不阻断业务请求。 */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // 缓存写失败不阻断业务
    }
  }

  /** 精确删除若干 key（写路径收尾失效用）：失败不阻断业务写路径。 */
  async invalidateKeys(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch {
      // 失效失败靠 TTL 兜底
    }
  }

  /** SCAN 匹配删除（清空账单等批量失效场景）：失败不阻断业务写路径。 */
  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      for await (const keys of this.redis.scanStream({
        match: pattern,
        count: 200,
      })) {
        if (keys.length > 0) await this.redis.del(...keys);
      }
    } catch {
      // 失效失败靠 TTL 兜底
    }
  }
}
