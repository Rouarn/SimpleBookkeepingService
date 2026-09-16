import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { round2 } from '../../../common/utils/money.js';
import {
  currentMonth,
  elapsedDays,
  monthLabel,
  monthRange,
  recentMonths,
  shiftMonth,
} from '../../../common/utils/date.util.js';
import type { BillType } from '../../../entities/category.entity.js';
import { BooksService } from '../../books/services/books.service.js';
import type {
  CategoryStatsQueryDto,
  OverviewQueryDto,
  PayMethodStatsQueryDto,
  TrendQueryDto,
} from '../dto/statistics-query.dto.js';

interface SumRow {
  expense: string | number | null;
  income: string | number | null;
  expense_count: string | number | null;
  income_count: string | number | null;
}

interface GroupAmountRow {
  group_id: string | number;
  total: string | number | null;
  cnt: string | number | null;
}

interface TrendRow {
  ym: string;
  expense: string | number | null;
  income: string | number | null;
}

interface Scope {
  sql: string;
  params: unknown[];
}

export interface MomVo {
  up: boolean;
  percent: number | null;
  text: string;
}

/** 统计与首页概览（04d）：实时 SQL 聚合，不建汇总表。 */
@Injectable()
export class StatisticsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly booksService: BooksService,
  ) {}

  async overview(
    userId: string,
    query: OverviewQueryDto,
  ): Promise<{
    month: string;
    type: BillType;
    total: number;
    oppositeTotal: number;
    balance: number;
    count: number;
    dailyAverage: number;
    elapsedDays: number;
    mom: MomVo;
  }> {
    const month = query.month ?? currentMonth();
    const type: BillType = query.type ?? 'expense';
    const scope = await this.buildScope(userId, month, query.bookId);
    const prevScope = await this.buildScope(
      userId,
      shiftMonth(month, -1),
      query.bookId,
    );

    const [current, previous] = await Promise.all([
      this.sumMonth(scope),
      this.sumMonth(prevScope),
    ]);

    const total = round2(current[type]);
    const oppositeType: BillType = type === 'expense' ? 'income' : 'expense';
    const oppositeTotal = round2(current[oppositeType]);
    const balance = round2(current.income - current.expense);
    const count =
      type === 'expense' ? current.expenseCount : current.incomeCount;
    const days = elapsedDays(month);
    const prevTotal = round2(previous[type]);

    return {
      month,
      type,
      total,
      oppositeTotal,
      balance,
      count,
      dailyAverage: days > 0 ? round2(total / days) : 0,
      elapsedDays: days,
      mom: this.buildMom(total, prevTotal),
    };
  }

  async categories(
    userId: string,
    query: CategoryStatsQueryDto,
  ): Promise<{
    month: string;
    type: BillType;
    total: number;
    list: Array<{
      categoryId: string;
      name: string;
      icon: string;
      color: string;
      bg: string;
      amount: number;
      count: number;
      percent: number;
    }>;
  }> {
    const month = query.month ?? currentMonth();
    const type: BillType = query.type ?? 'expense';
    const scope = await this.buildScope(userId, month, query.bookId, type);

    const [dictMap, rows] = await Promise.all([
      // 历史口径：字典停用后仍需返回原名/图标（04c：JOIN 不过滤状态）
      this.loadCategoryDict(type),
      this.dataSource.query<GroupAmountRow[]>(
        `SELECT b.category_id AS group_id, COALESCE(SUM(b.amount), 0) AS total, COUNT(*) AS cnt
           FROM bills b WHERE ${scope.sql}
          GROUP BY b.category_id`,
        scope.params,
      ),
    ]);

    const list = rows
      .map((row) => {
        const meta = dictMap.get(String(row.group_id));
        const amount = round2(row.total);
        return {
          categoryId: String(row.group_id),
          name: meta?.name ?? '已删除分类',
          icon: meta?.icon ?? '📦',
          color: meta?.color ?? '#999999',
          bg: meta?.bg ?? '#f2f2f2',
          amount,
          count: Number(row.cnt),
        };
      })
      .sort((a, b) => b.amount - a.amount);
    const total = round2(list.reduce((sum, item) => sum + item.amount, 0));

    return {
      month,
      type,
      total,
      list: list.map((item) => ({
        ...item,
        percent: total > 0 ? round2((item.amount / total) * 100) : 0,
      })),
    };
  }

  async payMethods(
    userId: string,
    query: PayMethodStatsQueryDto,
  ): Promise<{
    month: string;
    total: number;
    list: Array<{
      payMethodId: string;
      name: string;
      shortName: string;
      color: string;
      bg: string;
      amount: number;
      count: number;
      percent: number;
    }>;
  }> {
    const month = query.month ?? currentMonth();
    // 固定支出口径（04d §3）
    const scope = await this.buildScope(userId, month, query.bookId, 'expense');

    const [dictMap, rows] = await Promise.all([
      // 历史口径：含停用支付方式（04c：JOIN 不过滤状态）
      this.loadPayMethodDict(),
      this.dataSource.query<GroupAmountRow[]>(
        `SELECT b.pay_method_id AS group_id, COALESCE(SUM(b.amount), 0) AS total, COUNT(*) AS cnt
           FROM bills b WHERE ${scope.sql}
          GROUP BY b.pay_method_id`,
        scope.params,
      ),
    ]);

    const list = rows
      .map((row) => {
        const meta = dictMap.get(String(row.group_id));
        const amount = round2(row.total);
        return {
          payMethodId: String(row.group_id),
          name: meta?.name ?? '已删除方式',
          shortName: meta?.shortName ?? '?',
          color: meta?.color ?? '#999999',
          bg: meta?.bg ?? '#f2f2f2',
          amount,
          count: Number(row.cnt),
        };
      })
      .sort((a, b) => b.amount - a.amount);
    const total = round2(list.reduce((sum, item) => sum + item.amount, 0));

    return {
      month,
      total,
      list: list.map((item) => ({
        ...item,
        percent: total > 0 ? round2((item.amount / total) * 100) : 0,
      })),
    };
  }

  async trend(
    userId: string,
    query: TrendQueryDto,
  ): Promise<{
    months: number;
    list: Array<{
      month: string;
      label: string;
      expense: number;
      income: number;
    }>;
  }> {
    const count = query.months ?? 6;
    if (query.bookId)
      await this.booksService.getOwnedBookOrFail(userId, query.bookId);

    const sequence = recentMonths(count);
    const [start] = monthRange(sequence[0]);
    const [, end] = monthRange(sequence[sequence.length - 1]);

    // 仅此处允许 DATE_FORMAT，用于 GROUP BY（04d §4 明确）；WHERE 仍走半开区间
    const rows = await this.dataSource.query<TrendRow[]>(
      `SELECT DATE_FORMAT(b.record_date, '%Y-%m') AS ym,
              COALESCE(SUM(CASE WHEN b.type = 'expense' THEN b.amount ELSE 0 END), 0) AS expense,
              COALESCE(SUM(CASE WHEN b.type = 'income' THEN b.amount ELSE 0 END), 0) AS income
         FROM bills b
        WHERE b.user_id = ? AND b.record_date >= ? AND b.record_date < ?
              ${query.bookId ? 'AND b.book_id = ?' : ''}
        GROUP BY ym`,
      query.bookId ? [userId, start, end, query.bookId] : [userId, start, end],
    );
    const amountMap = new Map(
      rows.map((row) => [
        row.ym,
        { expense: round2(row.expense), income: round2(row.income) },
      ]),
    );

    return {
      months: count,
      list: sequence.map((month) => ({
        month,
        label: monthLabel(month),
        expense: amountMap.get(month)?.expense ?? 0,
        income: amountMap.get(month)?.income ?? 0,
      })),
    };
  }

  /** 全量分类字典（含停用项，历史统计可追溯）。 */
  private async loadCategoryDict(
    type: BillType,
  ): Promise<
    Map<
      string,
      { id: string; name: string; icon: string; color: string; bg: string }
    >
  > {
    const rows = await this.dataSource.query<
      Array<{
        id: string | number;
        name: string;
        icon: string;
        color: string;
        bg: string;
      }>
    >('SELECT id, name, icon, color, bg FROM categories WHERE type = ?', [
      type,
    ]);
    return new Map(
      rows.map((row) => [String(row.id), { ...row, id: String(row.id) }]),
    );
  }

  /** 全量支付方式字典（含停用项）。 */
  private async loadPayMethodDict(): Promise<
    Map<
      string,
      { id: string; name: string; shortName: string; color: string; bg: string }
    >
  > {
    const rows = await this.dataSource.query<
      Array<{
        id: string | number;
        name: string;
        short_name: string;
        color: string;
        bg: string;
      }>
    >('SELECT id, name, short_name, color, bg FROM pay_methods');
    return new Map(
      rows.map((row) => [
        String(row.id),
        {
          id: String(row.id),
          name: row.name,
          shortName: row.short_name,
          color: row.color,
          bg: row.bg,
        },
      ]),
    );
  }

  /**
   * 环比四分支（04d §1）：上升 / 下降 / 持平 / 不可比。
   * 上月为 0 且本月 > 0 → percent=null、text='--'。
   */
  private buildMom(current: number, previous: number): MomVo {
    if (previous === 0) {
      return current > 0
        ? { up: false, percent: null, text: '--' }
        : { up: false, percent: 0, text: '0.00%' };
    }
    if (current === previous) {
      return { up: false, percent: 0, text: '0.00%' };
    }
    const percent = round2(Math.abs(((current - previous) / previous) * 100));
    const up = current > previous;
    return { up, percent, text: `${up ? '+' : '-'}${percent.toFixed(2)}%` };
  }

  private async buildScope(
    userId: string,
    month: string,
    bookId?: string,
    type?: BillType,
  ): Promise<Scope> {
    if (bookId) await this.booksService.getOwnedBookOrFail(userId, bookId);
    const [start, end] = monthRange(month);
    const conditions = [
      'b.user_id = ?',
      'b.record_date >= ?',
      'b.record_date < ?',
    ];
    const params: unknown[] = [userId, start, end];
    if (bookId) {
      conditions.push('b.book_id = ?');
      params.push(bookId);
    }
    if (type) {
      conditions.push('b.type = ?');
      params.push(type);
    }
    return { sql: conditions.join(' AND '), params };
  }

  private async sumMonth(scope: Scope): Promise<{
    expense: number;
    income: number;
    expenseCount: number;
    incomeCount: number;
  }> {
    const rows = await this.dataSource.query<SumRow[]>(
      `SELECT COALESCE(SUM(CASE WHEN b.type = 'expense' THEN b.amount ELSE 0 END), 0) AS expense,
              COALESCE(SUM(CASE WHEN b.type = 'income' THEN b.amount ELSE 0 END), 0) AS income,
              SUM(CASE WHEN b.type = 'expense' THEN 1 ELSE 0 END) AS expense_count,
              SUM(CASE WHEN b.type = 'income' THEN 1 ELSE 0 END) AS income_count
         FROM bills b WHERE ${scope.sql}`,
      scope.params,
    );
    const row = rows[0];
    return {
      expense: round2(row?.expense ?? 0),
      income: round2(row?.income ?? 0),
      expenseCount: Number(row?.expense_count ?? 0),
      incomeCount: Number(row?.income_count ?? 0),
    };
  }
}
