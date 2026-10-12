import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { REDIS_CLIENT, REDIS_KEYS } from '../redis/redis.constants.js';

/**
 * 原子释放锁的 Lua 脚本：仅当锁的 value 等于本实例的 owner token 时才 DEL，
 * 避免任务超时后锁被误释放给其他实例（GET+DEL 两步在脚本内原子执行）。
 */
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

/**
 * 定时任务分布式选主锁（P1-20）：多实例部署时同一任务全局仅执行一次。
 * - 抢锁：SET bk:lock:{job} NX EX <ttl>，value 为随机 owner token（crypto.randomUUID）；
 * - 抢不到：其他实例正在执行，记录一次跳过日志后直接返回；
 * - 释放：任务结束（含异常）由 try/finally 保证走 Lua 比对 owner 后 DEL；
 * - TTL 兜底：执行实例崩溃后锁自动过期，下一轮任务可被其他实例接手。
 */
@Injectable()
export class CronLockService {
  private readonly logger = new Logger('CronLock');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** 以分布式锁包住任务体执行；未抢到锁则静默跳过。 */
  async runWithLock(
    job: string,
    ttlSeconds: number,
    task: () => Promise<void>,
  ): Promise<void> {
    const lockKey = REDIS_KEYS.cronLock(job);
    const owner = randomUUID();

    let acquired: 'OK' | null;
    try {
      acquired = await this.redis.set(lockKey, owner, 'EX', ttlSeconds, 'NX');
    } catch (error) {
      // Redis 故障时无法协调选主：宁可不执行（任务均为幂等清理，漏跑一轮无害），
      // 也不冒多实例同时执行的风险
      this.logger.warn(
        `任务 ${job} 抢锁失败（Redis 异常），本次跳过: ${(error as Error).message}`,
      );
      return;
    }
    if (acquired !== 'OK') {
      this.logger.log(`任务 ${job} 锁已被其他实例持有，本次跳过`);
      return;
    }

    try {
      await task();
    } finally {
      try {
        await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, owner);
      } catch (error) {
        // 释放失败仅告警：锁有 TTL 兜底，不会永久阻塞下一轮任务
        this.logger.warn(`任务 ${job} 释放锁失败: ${(error as Error).message}`);
      }
    }
  }
}
