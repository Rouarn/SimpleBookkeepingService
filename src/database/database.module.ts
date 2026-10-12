import { Global, Logger as NestLogger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type {
  Logger as TypeOrmLogger,
  ObjectLiteral,
  QueryRunner,
} from 'typeorm';
import type { AppConfig } from '../config/configuration.js';
import { SnakeNamingStrategy } from './naming.strategy.js';
import { User } from '../entities/user.entity.js';
import { Message } from '../entities/message.entity.js';
import { RefreshToken } from '../entities/refresh-token.entity.js';
import { Book } from '../entities/book.entity.js';
import { Category } from '../entities/category.entity.js';
import { PayMethod } from '../entities/pay-method.entity.js';
import { Bill } from '../entities/bill.entity.js';
import { BillPhoto } from '../entities/bill-photo.entity.js';
import { UserPreference } from '../entities/user-preference.entity.js';
import { OperationLog } from '../entities/operation-log.entity.js';

/**
 * TypeORM 脱敏日志器（P2-13）：
 * 生产中失败 SQL 的 parameters 会带手机号、备注等明文 PII，
 * 默认 AdvancedConsoleLogger 会把「完整 SQL + 参数数组」全部打印。
 * 本日志器 error/warn 只输出驱动错误码与 SQL 摘要（动词 + 表名），
 * 绝不输出参数与完整 SQL；query/slowQuery/schema/migration 一律静默。
 */
class SanitizedTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');

  logQuery(): void {
    // logging 选项只含 error/warn，正常 SQL 不记录
  }

  logQueryError(
    error: string | Error,
    query: string,
    _parameters?: unknown[] | ObjectLiteral,
    _queryRunner?: QueryRunner,
  ): void {
    this.logger.error(
      `SQL 执行失败 [${this.summarizeError(error)}] ${this.summarizeQuery(query)}`,
    );
  }

  logQuerySlow(): void {
    // 慢查询同样可能携带参数上下文，不输出完整 SQL；当前未开启 slow 级别
  }

  logSchemaBuild(): void {
    // 生产 synchronize 关闭，无 DDL 日志；开发 DDL 不含业务数据，同样不记录
  }

  logMigration(): void {
    // 未启用 migrationsRun
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level !== 'warn') return;
    // TypeORM 内部告警：剥离可能附带的 SQL 文本，只保留首行摘要
    const text = message instanceof Error ? message.message : String(message);
    this.logger.warn(text.split('\n')[0]?.slice(0, 200) ?? '未知告警');
  }

  /** 提取 mysql2 驱动错误码：errno/code/sqlState，不回显错误中夹带的 SQL。 */
  private summarizeError(error: string | Error): string {
    if (typeof error === 'string') return error.slice(0, 120);
    const driverError = error as Error & {
      errno?: number;
      code?: string;
      sqlState?: string;
      sqlMessage?: string;
    };
    const parts = [
      driverError.code ? `code=${driverError.code}` : null,
      typeof driverError.errno === 'number'
        ? `errno=${driverError.errno}`
        : null,
      driverError.sqlState ? `sqlState=${driverError.sqlState}` : null,
      // sqlMessage 只取首行并截断，避免多语句错误回显语句片段
      (driverError.sqlMessage ?? error.message ?? '')
        .split('\n')[0]!
        .slice(0, 120),
    ].filter(Boolean);
    return parts.join(' ');
  }

  /** SQL 摘要：仅保留命令动词与首个表名（如 "UPDATE users"），不输出语句正文。 */
  private summarizeQuery(query: string): string {
    const head = query.trim().replace(/\s+/g, ' ').slice(0, 200);
    const match =
      /^(SELECT|INSERT INTO|UPDATE|DELETE FROM|REPLACE INTO)\s+`?([A-Za-z0-9_]+)`?/i.exec(
        head,
      );
    if (match) {
      const verb = match[1]!
        .toUpperCase()
        .replace(' INTO', '')
        .replace(' FROM', '');
      return `(${verb} ${match[2]})`;
    }
    const firstWord = /^([A-Za-z]+)/.exec(head)?.[1]?.toUpperCase();
    return firstWord ? `(${firstWord})` : '(SQL)';
  }
}

// 接口实现由 TypeScript 在 implements 处静态校验（Logger 接口见 typeorm/logger）

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
            Message,
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
          // P2-13：error/warn 经脱敏日志器输出，不打印参数与完整 SQL（防 PII 落日志）
          logging: ['error', 'warn'],
          logger: new SanitizedTypeOrmLogger(),
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
