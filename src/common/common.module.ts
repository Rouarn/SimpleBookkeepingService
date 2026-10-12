import { Global, Module, type ExecutionContext } from '@nestjs/common';
import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  Reflector,
} from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisModule } from './redis/redis.module.js';
import { REDIS_CLIENT } from './redis/redis.constants.js';
import { RedisThrottlerStorage } from './throttler/redis-throttler.storage.js';
import { CronLockService } from './cron/cron-lock.service.js';
import { AuditCleanupService } from './cron/audit-cleanup.service.js';
import { MonthlyReportCronService } from './cron/monthly-report.cron.service.js';
import { DeactivatedPurgeCronService } from './cron/deactivated-purge.cron.service.js';
import { MessagesModule } from '../modules/messages/messages.module.js';
import { FilesModule } from '../modules/files/files.module.js';
import { THROTTLE_NAMES, THROTTLE_RATES } from './throttler/throttle-rates.js';
import { CustomThrottlerGuard } from './throttler/custom-throttler.guard.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { LoggingInterceptor } from './interceptors/logging.interceptor.js';
import { TransformInterceptor } from './interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import type { AppConfig } from '../config/configuration.js';

/**
 * 全局基础设施：Redis、JWT、限流存储、全局守卫/拦截器/过滤器（01 §4 分层）。
 * 守卫顺序：CustomThrottlerGuard（先挡洪峰）→ JwtAuthGuard。
 * 拦截器顺序：Logging（最外）→ Transform（最内包裹 data）。
 */
@Global()
@Module({
  imports: [
    RedisModule,
    // cron 服务依赖：月报/注销清理需要 MessagesService，注销清理需要 StorageService
    MessagesModule,
    FilesModule,
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [REDIS_CLIENT],
      useFactory: (redis: Redis) => {
        // v6 会对注册的每个档位无条件计数；命名档通过 skipIf 限定为
        // 「仅在路由以 @Throttle({ [name]: ... }) 显式声明时生效」，
        // default 档对全部路由生效（03 §7）。
        const reflector = new Reflector();
        // @Throttle({ [name]: opt }) 在 v6 中写入的元数据键前缀（throttler.constants.THROTTLER_LIMIT）
        const THROTTLER_LIMIT_PREFIX = 'THROTTLER:LIMIT';
        const onlyWhenDeclared =
          (name: string) =>
          (context: ExecutionContext): boolean => {
            if (name === THROTTLE_NAMES.DEFAULT) return false;
            const declared = reflector.getAllAndOverride<unknown>(
              THROTTLER_LIMIT_PREFIX + name,
              [context.getHandler(), context.getClass()],
            );
            return declared === undefined || declared === null;
          };

        const build = (
          name: (typeof THROTTLE_NAMES)[keyof typeof THROTTLE_NAMES],
        ) => ({
          name,
          ...THROTTLE_RATES[name],
          skipIf: onlyWhenDeclared(name),
        });

        return {
          storage: new RedisThrottlerStorage(redis),
          throttlers: [
            build(THROTTLE_NAMES.DEFAULT),
            build(THROTTLE_NAMES.LOGIN_IP),
            build(THROTTLE_NAMES.REGISTER),
            build(THROTTLE_NAMES.REFRESH),
            build(THROTTLE_NAMES.BILL_WRITE),
            build(THROTTLE_NAMES.BILL_DELETE),
            build(THROTTLE_NAMES.UPLOAD),
            build(THROTTLE_NAMES.EXPORT),
          ],
        };
      },
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const jwtConfig = configService.get<AppConfig['jwt']>('jwt')!;
        return {
          secret: jwtConfig.accessSecret,
          signOptions: { algorithm: 'HS256' },
        };
      },
    }),
  ],
  providers: [
    RedisThrottlerStorage,
    CronLockService,
    AuditCleanupService,
    MonthlyReportCronService,
    DeactivatedPurgeCronService,
    AllExceptionsFilter,
    LoggingInterceptor,
    TransformInterceptor,
    JwtAuthGuard,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useExisting: CustomThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    CustomThrottlerGuard,
  ],
  exports: [RedisModule, JwtModule, RedisThrottlerStorage, CronLockService],
})
export class CommonModule {}
