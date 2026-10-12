import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CronLockService } from './cron-lock.service.js';
import { MessagesService } from '../../modules/messages/messages.service.js';
import {
  currentMonth,
  monthLabel,
  monthRange,
  shiftMonth,
} from '../utils/date.util.js';
import { round2 } from '../utils/money.js';

/** 每批聚合的用户数：id 游标分批，避免单条大 GROUP BY 长时间占住连接 */
const BATCH_SIZE = 500;
/** 选主锁 TTL 兜底（P1-20）：按全量用户分批发送的预估时长放宽到 30 分钟 */
const LOCK_TTL_SECONDS = 30 * 60;

interface MonthlyAggregateRow {
  user_id: string | number;
  expense: string | number;
  income: string | number;
  cnt: string | number;
}

/**
 * 月度账单报告（每月 1 日 08:05）：对上月有账单的活跃用户（status=1）
 * 各发一条 monthly_report 站内消息（上月支出合计、收入合计、笔数）。
 * 一条聚合 SQL 按 user_id 分组（不逐人查询），主键游标 500/批分批遍历。
 */
@Injectable()
export class MonthlyReportCronService {
  private readonly logger = new Logger('MonthlyReportCronService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cronLock: CronLockService,
    private readonly messagesService: MessagesService,
  ) {}

  @Cron('5 8 1 * *', { name: 'monthly-report' })
  async sendMonthlyReports(): Promise<void> {
    await this.cronLock.runWithLock(
      'monthly-report',
      LOCK_TTL_SECONDS,
      async () => {
        try {
          const month = shiftMonth(currentMonth(), -1);
          const [monthStart, monthEnd] = monthRange(month);

          let cursor = '0';
          let notified = 0;
          for (;;) {
            const rows = await this.dataSource.query<MonthlyAggregateRow[]>(
              `SELECT b.user_id,
                      COALESCE(SUM(CASE WHEN b.type = 'expense' THEN b.amount ELSE 0 END), 0) AS expense,
                      COALESCE(SUM(CASE WHEN b.type = 'income' THEN b.amount ELSE 0 END), 0) AS income,
                      COUNT(*) AS cnt
                 FROM bills b
                 JOIN users u ON u.id = b.user_id AND u.status = 1
                WHERE b.record_date >= ? AND b.record_date < ? AND b.user_id > ?
                GROUP BY b.user_id
                ORDER BY b.user_id ASC
                LIMIT ${BATCH_SIZE}`,
              [monthStart, monthEnd, cursor],
            );
            if (rows.length === 0) break;

            for (const row of rows) {
              cursor = String(row.user_id);
              const expense = round2(row.expense);
              const income = round2(row.income);
              const count = Number(row.cnt);
              await this.messagesService.append(
                cursor,
                'monthly_report',
                '月度账单报告',
                `${monthLabel(month)}记账 ${count} 笔：支出 ${expense.toFixed(2)} 元，收入 ${income.toFixed(2)} 元`,
                { month, expense, income, count },
              );
              notified += 1;
            }
            if (rows.length < BATCH_SIZE) break;
          }
          if (notified > 0) {
            this.logger.log(`月度账单报告发送完成：${notified} 位用户`);
          }
        } catch (error) {
          this.logger.error(
            `月度账单报告任务失败: ${(error as Error).message}`,
          );
        }
      },
    );
  }
}
