import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { AppConfig } from '../config/configuration.js';
import { SnakeNamingStrategy } from './naming.strategy.js';
import { User } from '../entities/user.entity.js';
import { RefreshToken } from '../entities/refresh-token.entity.js';
import { Book } from '../entities/book.entity.js';
import { Category } from '../entities/category.entity.js';
import { PayMethod } from '../entities/pay-method.entity.js';
import { Bill } from '../entities/bill.entity.js';
import { BillPhoto } from '../entities/bill-photo.entity.js';
import { UserPreference } from '../entities/user-preference.entity.js';
import { OperationLog } from '../entities/operation-log.entity.js';

/**
 * TypeORM 全局模块（05 §1）。
 * 表结构同步策略：
 *   - 开发环境：synchronize 开启，实体改动后启动即自动建表/加字段/改索引；
 *   - 生产环境：synchronize 永久关闭，表结构变更在上线前手动执行 DDL。
 * 全部 9 实体在根模块一次性注册：service 层全部用 raw SQL（dataSource.query），
 * 不走 Repository，故不需要 autoLoadEntities / forFeature 分散注册。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appConfig = configService.get<AppConfig['app']>('app')!;
        const dbConfig = configService.get<AppConfig['database']>('database')!;
        // P1-05：DB_TLS=true 时启用 TLS 加密连接；MySQL 5.7 自签证书且
        // 无法导入 CA 的场景，可通过 DB_TLS_REJECT_UNAUTHORIZED=false 跳过证书校验
        const ssl = dbConfig.tls
          ? { rejectUnauthorized: dbConfig.tlsRejectUnauthorized }
          : undefined;
        return {
          type: 'mysql' as const,
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.name,
          charset: 'utf8mb4',
          timezone: '+08:00',
          ssl,
          entities: [
            User,
            RefreshToken,
            Book,
            Category,
            PayMethod,
            Bill,
            BillPhoto,
            UserPreference,
            OperationLog,
          ],
          namingStrategy: new SnakeNamingStrategy(),
          // 开发环境自动同步表结构；生产环境关闭，DDL 手动执行
          synchronize: !appConfig.isProduction,
          migrationsRun: false,
          logging: ['error', 'warn'],
          extra: {
            supportBigNumbers: true,
            bigNumberStrings: true,
            connectionLimit: dbConfig.connectionLimit,
            waitForConnections: true,
            multipleStatements: false,
          },
        };
      },
    }),
  ],
})
export class DatabaseModule {}
