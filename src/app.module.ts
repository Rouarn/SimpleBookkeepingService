import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/configuration.js';
import { DatabaseModule } from './database/database.module.js';
import { CommonModule } from './common/common.module.js';
import { FilesModule } from './modules/files/files.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { DictionariesModule } from './modules/dictionaries/dictionaries.module.js';
import { BooksModule } from './modules/books/books.module.js';
import { BillsModule } from './modules/bills/bills.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { StatisticsModule } from './modules/statistics/statistics.module.js';
import { HealthModule } from './modules/health/health.module.js';

/**
 * 根模块：只做模块组装（05 §1）。
 */
@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    CommonModule,
    FilesModule,
    AuthModule,
    DictionariesModule,
    BooksModule,
    BillsModule,
    UsersModule,
    StatisticsModule,
    HealthModule,
    ScheduleModule.forRoot(),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig['app']>('app')!;
        return {
          pinoHttp: {
            level: appConfig.isProduction ? 'info' : 'debug',
            // 统一 JSON 输出（文档 06 §5）；敏感字段在日志层脱敏（07 §8.2）
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.refreshToken',
                'req.body.tokenHash',
                'res.headers["set-cookie"]',
              ],
              censor: '[REDACTED]',
              remove: false,
            },
            customProps: () => ({ context: 'HTTP' }),
            autoLogging: {
              ignore: (req) => (req as { url?: string }).url === '/health',
            },
          },
        };
      },
    }),
  ],
})
export class AppModule {}
