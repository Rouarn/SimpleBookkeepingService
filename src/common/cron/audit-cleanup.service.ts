import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CronLockService } from './cron-lock.service.js';

/** 审计日志保留 90 天（02 §2.9：只追加、定期归档清理） */
const RETENTION_DAYS = 90;
/** 单批删除行数：小批量循环避免长事务/大范围锁表 */
const BATCH_SIZE = 1000;
/** 批间小睡，给主从复制与业务写入让路 */
const BATCH_SLEEP_MS = 50;
/** 锁 TTL 兜底：按全表大体量分批的预估时长放宽到 30 分钟 */
const LOCK_TTL_SECONDS = 30 * 60;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * operation_logs 归档清理（02 §2.9）：每日删除 90 天前的请求审计日志。
 * 主键游标分批：先取「90 天前」的最大主键作为删除边界（自增主键与写入顺序一致，
 * id <= 边界的行创建时间必然早于边界行），随后 DELETE ... WHERE id <= 边界
 * LIMIT 1000 循环至删完，避免单条大 DELETE 造成长事务与锁表。
 */
@Injectable()
export class AuditCleanupService {
  private readonly logger = new Logger('AuditCleanupService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cronLock: CronLockService,
  ) {}

  @Cron('0 4 * * *', { name: 'operation-logs-purge' })
  async purgeExpired(): Promise<void> {
    await this.cronLock.runWithLock(
      'operation-logs-purge',
      LOCK_TTL_SECONDS,
      async () => {
        try {
          const rows = await this.dataSource.query<
            Array<{ boundary_id: string | null }>
          >(
            `SELECT MAX(id) AS boundary_id FROM operation_logs
              WHERE created_at < DATE_SUB(NOW(3), INTERVAL ? DAY)`,
            [RETENTION_DAYS],
          );
          const boundary = rows[0]?.boundary_id;
          if (!boundary || boundary === '0') return;

          let total = 0;
          for (;;) {
            const result = await this.dataSource.query(
              'DELETE FROM operation_logs WHERE id <= ? LIMIT ?',
              [boundary, BATCH_SIZE],
            );
            const affected = Number(
              (result as { affectedRows?: number }).affectedRows ?? 0,
            );
            total += affected;
            if (affected < BATCH_SIZE) break;
            await sleep(BATCH_SLEEP_MS);
          }
          if (total > 0) {
            this.logger.log(
              `operation_logs 归档清理完成，删除 ${total} 行（保留 ${RETENTION_DAYS} 天）`,
            );
          }
        } catch (error) {
          this.logger.error(
            `operation_logs 归档清理失败: ${(error as Error).message}`,
          );
        }
      },
    );
  }
}
