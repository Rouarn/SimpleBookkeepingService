import {
  Global,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT } from './redis.constants.js';
import { RedisCacheService } from './redis-cache.service.js';

/**
 * 全局 Redis（ioredis 5）：限流计数、字典缓存、登录锁定、幂等键。
 * 仅存易失性数据，不存业务真相（01 §3.2）。
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis => {
        const redisConfig = configService.get<AppConfig['redis']>('redis')!;
        const client = new Redis({
          host: redisConfig.host,
          port: redisConfig.port,
          password: redisConfig.password || undefined,
          db: redisConfig.db,
          lazyConnect: false,
          maxRetriesPerRequest: 3,
          // 离线队列禁用（P1-04）：Redis 断连时命令立即快速失败而非排队悬挂，
          // 由各调用方（限流 fail-open、登录锁定降级、幂等校验等）自行降级，
          // 避免请求在离线队列中无限堆积、拖垮整站响应。
          enableOfflineQueue: false,
          // 重连指数退避：100ms 起步每次翻倍，上限 3s，避免故障期间重连风暴
          retryStrategy: (times: number): number =>
            Math.min(2 ** times * 100, 3000),
        });
        const logger = new Logger('Redis');
        client.on('error', (error: Error) =>
          logger.error(`Redis 连接错误: ${error.message}`),
        );
        client.on('connect', () => logger.log('Redis 已连接'));
        return client;
      },
    },
    RedisCacheService,
  ],
  exports: [REDIS_CLIENT, RedisCacheService],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
