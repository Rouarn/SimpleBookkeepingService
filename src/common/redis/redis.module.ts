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
        });
        const logger = new Logger('Redis');
        client.on('error', (error: Error) =>
          logger.error(`Redis 连接错误: ${error.message}`),
        );
        client.on('connect', () => logger.log('Redis 已连接'));
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
