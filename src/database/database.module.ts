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
 * synchronize 永久关闭，表结构只经迁移演进（02 §5）。
 * 全部 9 实体在根模块一次性注册：service 层全部用 raw SQL（dataSource.query），
 * 不走 Repository，故不需要 autoLoadEntities / forFeature 分散注册。
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const dbConfig = configService.get<AppConfig['database']>('database')!;
        return {
          type: 'mysql' as const,
          host: dbConfig.host,
          port: dbConfig.port,
          username: dbConfig.user,
          password: dbConfig.password,
          database: dbConfig.name,
          charset: 'utf8mb4',
          timezone: '+08:00',
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
          synchronize: false,
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
