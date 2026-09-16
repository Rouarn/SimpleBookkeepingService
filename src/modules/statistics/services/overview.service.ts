import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { round2 } from '../../../common/utils/money.js';
import {
  currentMonth,
  dateLabel,
  todayStr,
} from '../../../common/utils/date.util.js';
import { BillsService } from '../../bills/services/bills.service.js';
import {
  BookScopeQueryDto,
  SummaryQueryDto,
} from '../../bills/dto/bill-list-query.dto.js';
import type { BillVm } from '../../bills/vo/bill.vo.js';
import { BooksService } from '../../books/services/books.service.js';

interface UserRow {
  nickname: string;
}

export interface HomeMonth {
  month: string;
  expense: number;
  income: number;
  balance: number;
  expenseCount: number;
  incomeCount: number;
  count: number;
}

export interface HomeToday {
  date: string;
  expense: number;
  income: number;
  list: BillVm[];
}

/** 首页一屏聚合（04d §5）：跨全部账本收支 + 激活账本预算 + 今日流水。 */
@Injectable()
export class OverviewService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly billsService: BillsService,
    private readonly booksService: BooksService,
  ) {}

  async home(userId: string): Promise<{
    todayDate: string;
    user: { name: string };
    month: HomeMonth;
    budget: { budget: number; progress: number; overBudget: boolean };
    today: HomeToday;
  }> {
    const month = currentMonth();
    const monthQuery = Object.assign(new SummaryQueryDto(), { month });
    const todayQuery = new BookScopeQueryDto();

    const [userRows, monthSummary, today, activeBook] = await Promise.all([
      this.dataSource.query<UserRow[]>(
        'SELECT nickname FROM users WHERE id = ? LIMIT 1',
        [userId],
      ),
      this.billsService.summary(userId, monthQuery),
      this.billsService.today(userId, todayQuery),
      this.booksService.getActive(userId),
    ]);

    const budget = round2(activeBook.budget);
    const progress =
      budget > 0
        ? Math.min(100, round2((monthSummary.expense / budget) * 100))
        : 0;

    return {
      todayDate: dateLabel(todayStr()),
      user: { name: userRows[0]?.nickname ?? '' },
      month: monthSummary,
      budget: {
        budget,
        progress,
        overBudget: budget > 0 && monthSummary.expense > budget,
      },
      today,
    };
  }
}
