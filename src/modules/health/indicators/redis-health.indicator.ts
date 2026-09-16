import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants.js';

/** Redis PING 探针（06 §6），基于 Terminus v12 HealthIndicatorService。 */
@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly healthIndicator: HealthIndicatorService,
  ) {}

  async isHealthy(key: 'redis') {
    const indicator = this.healthIndicator.check(key);
    try {
      const pong = await this.redis.ping();
      if (pong !== 'PONG') return indicator.down({ response: pong });
      return indicator.up({ response: pong });
    } catch (error) {
      return indicator.down({
        error: error instanceof Error ? error.message : 'PING_FAILED',
      });
    }
  }
}
