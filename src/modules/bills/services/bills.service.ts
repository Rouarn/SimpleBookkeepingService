import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  BusinessException,
  type FieldValidationDetail,
} from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { MAX_AMOUNT, round2 } from '../../../common/utils/money.js';
import {
  currentMonth,
  dayLabel,
  dateLabel,
  monthRange,
  timeToColumn,
  todayStr,
} from '../../../common/utils/date.util.js';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../../common/dto/pagination.dto.js';
import { codePointLength } from '../../../common/utils/text.util.js';
import { CategoriesService } from '../../dictionaries/services/categories.service.js';
import { PayMethodsService } from '../../dictionaries/services/pay-methods.service.js';
import { BooksService } from '../../books/services/books.service.js';
import { SignedUrlService } from '../../files/services/signed-url.service.js';
import { StorageService } from '../../files/services/storage.service.js';
import { CleanupService } from '../../files/services/cleanup.service.js';
import type { BillDetailVm, BillJoinRow, BillVm } from '../vo/bill.vo.js';
import { mapPhotosToBillIds, toBillDetailVm, toBillVm } from '../vo/bill.vo.js';
import type {
  BillListQueryDto,
  BookScopeQueryDto,
  ClearBillsDto,
  CreateBillDto,
  GroupedQueryDto,
  SummaryQueryDto,
  UpdateBillDto,
} from '../dto/bill-list-query.dto.js';
import { IdempotencyService } from './idempotency.service.js';

const GROUPED_LIMIT = 1000;
const PHOTO_KEY_PATTERN =
  /^bills\/\d{1,19}\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9._-]+\.jpg$/;

const BILL_SELECT = `
  SELECT b.id, b.type, b.amount, b.category_id, b.pay_method_id,
         DATE_FORMAT(b.record_date, '%Y-%m-%d') AS record_date, b.record_time,
         b.remark, b.book_id, b.created_at, b.updated_at,
         c.name AS category_name, c.icon AS icon_text, c.color AS icon_color, c.bg AS icon_bg,
         p.name AS pay_method_name,
         bk.name AS book_name, u.nickname AS recorder
    FROM bills b
    JOIN categories c ON c.id = b.category_id
    JOIN pay_methods p ON p.id = b.pay_method_id
    JOIN books bk ON bk.id = b.book_id
    JOIN users u ON u.id = b.user_id
`;

interface PhotoRow {
  bill_id: string | number;
  url: string;
  sort_order: number;
}

interface AggregateRow {
  type: 'expense' | 'income';
  cnt: string | number;
  total: string | number | null;
}

interface CountRow {
  cnt: string | number;
}

function billNotFound(): never {
  throw new BusinessException(
    ERROR_CODES.BILL_NOT_FOUND.code,
    ERROR_CODES.BILL_NOT_FOUND.httpStatus,
    ERROR_CODES.BILL_NOT_FOUND.message,
  );
}

function bizError(
  meta: (typeof ERROR_CODES)[keyof typeof ERROR_CODES],
  message?: string,
  details?: FieldValidationDetail[],
): never {
  throw new BusinessException(
    meta.code,
    meta.httpStatus,
    message ?? meta.message,
    details,
  );
}

interface NormalizedBillInput {
  type: 'expense' | 'income';
  amount: string;
  categoryId: string;
  payMethodId: string;
  bookId: string;
  recordDate: string;
  recordTime: string; // HH:mm:ss
  remark: string;
  photos: string[];
}

/**
 * 账单核心服务（04b 全章 / 02 §4.2 事务②③④）。
 */
@Injectable()
export class BillsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly categoriesService: CategoriesService,
    private readonly payMethodsService: PayMethodsService,
    private readonly booksService: BooksService,
    private readonly signedUrlService: SignedUrlService,
    private readonly storageService: StorageService,
    private readonly cleanupService: CleanupService,
    private readonly idempotencyService: IdempotencyService,
  ) {}

  // ---------- 查询 ----------

  async list(
    userId: string,
    query: BillListQueryDto,
  ): Promise<{ list: BillVm[]; pagination: PaginationMeta }> {
    // bookId 归属校验：他人/不存在的账本统一 40401，禁止借空列表探测（04b §1 / 07 §8.3）
    if (query.bookId)
      await this.booksService.getOwnedBookOrFail(userId, query.bookId);
    const { whereSql, params } = this.buildListScope(userId, query);
    const page = query.page;
    const pageSize = query.pageSize;

    const countRows = await this.dataSource.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt FROM bills b WHERE ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.cnt ?? 0);

    const rows = await this.dataSource.query<BillJoinRow[]>(
      `${BILL_SELECT} WHERE ${whereSql}
       ORDER BY b.record_date DESC, b.record_time DESC, b.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, pageSize, (page - 1) * pageSize],
    );

    const photosByBill = await this.loadPhotosMap(
      userId,
      rows.map((row) => String(row.id)),
    );
    return {
      list: rows.map((row) => toBillVm(row, photosByBill)),
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  async today(
    userId: string,
    query: BookScopeQueryDto,
  ): Promise<{
    date: string;
    expense: number;
    income: number;
    list: BillVm[];
  }> {
    if (query.bookId)
      await this.booksService.getOwnedBookOrFail(userId, query.bookId);
    const date = todayStr();
    const { whereSql, params } = this.buildScope({
      userId,
      startDate: date,
      endDate: undefined,
      bookId: query.bookId,
      type: undefined,
      categoryId: undefined,
    });

    const rows = await this.dataSource.query<BillJoinRow[]>(
      `${BILL_SELECT} WHERE ${whereSql}
       ORDER BY b.record_time DESC, b.created_at DESC`,
      params,
    );
    const photosByBill = await this.loadPhotosMap(
      userId,
      rows.map((row) => String(row.id)),
    );

    const aggregates = await this.dataSource.query<AggregateRow[]>(
      `SELECT type, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS total
         FROM bills b WHERE ${whereSql} GROUP BY b.type`,
      params,
    );
    const sums = { expense: 0, income: 0 };
    for (const row of aggregates) {
      sums[row.type] = round2(row.total);
    }

    return {
      date,
      expense: sums.expense,
      income: sums.income,
      list: rows.map((r) => toBillVm(r, photosByBill)),
    };
  }

  async grouped(
    userId: string,
    query: GroupedQueryDto,
  ): Promise<{
    month: string;
    type: 'ALL' | 'expense' | 'income';
    truncated: boolean;
    groups: Array<{
      day: string;
      date: string;
      recordDate: string;
      expense: number;
      income: number;
      items: BillVm[];
    }>;
  }> {
    if (query.bookId)
      await this.booksService.getOwnedBookOrFail(userId, query.bookId);
    const [start, end] = monthRange(query.month);
    const { whereSql, params } = this.buildScope({
      userId,
      startDate: start,
      endDate: end,
      bookId: query.bookId,
      type: query.type && query.type !== 'ALL' ? query.type : undefined,
      categoryId: undefined,
    });

    const countRows = await this.dataSource.query<CountRow[]>(
      `SELECT COUNT(*) AS cnt FROM bills b WHERE ${whereSql}`,
      params,
    );
    const total = Number(countRows[0]?.cnt ?? 0);

    const rows = await this.dataSource.query<BillJoinRow[]>(
      `${BILL_SELECT} WHERE ${whereSql}
       ORDER BY b.record_date DESC, b.record_time DESC, b.created_at DESC
       LIMIT ${GROUPED_LIMIT}`,
      params,
    );
    const photosByBill = await this.loadPhotosMap(
      userId,
      rows.map((row) => String(row.id)),
    );

    const groups: Array<{
      day: string;
      date: string;
      recordDate: string;
      expense: number;
      income: number;
      items: BillVm[];
    }> = [];
    const groupIndex = new Map<string, number>();
    for (const row of rows) {
      let index = groupIndex.get(row.record_date);
      if (index === undefined) {
        index = groups.length;
        groupIndex.set(row.record_date, index);
        groups.push({
          day: dayLabel(row.record_date),
          date: dateLabel(row.record_date),
          recordDate: row.record_date,
          expense: 0,
          income: 0,
          items: [],
        });
      }
      const vm = toBillVm(row, photosByBill);
      groups[index].items.push(vm);
      groups[index][row.type] = round2(groups[index][row.type] + vm.amountAbs);
    }

    return {
      month: query.month,
      type: query.type ?? 'ALL',
      truncated: total > GROUPED_LIMIT,
      groups,
    };
  }

  async summary(
    userId: string,
    query: SummaryQueryDto,
  ): Promise<{
    month: string;
    expense: number;
    income: number;
    balance: number;
    expenseCount: number;
    incomeCount: number;
    count: number;
  }> {
    if (query.bookId)
      await this.booksService.getOwnedBookOrFail(userId, query.bookId);
    const [start, end] = monthRange(query.month);
    const { whereSql, params } = this.buildScope({
      userId,
      startDate: start,
      endDate: end,
      bookId: query.bookId,
      type: undefined,
      categoryId: undefined,
    });

    const rows = await this.dataSource.query<AggregateRow[]>(
      `SELECT b.type, COUNT(*) AS cnt, COALESCE(SUM(b.amount), 0) AS total
         FROM bills b WHERE ${whereSql} GROUP BY b.type`,
      params,
    );

    const result = {
      month: query.month,
      expense: 0,
      income: 0,
      balance: 0,
      expenseCount: 0,
      incomeCount: 0,
      count: 0,
    };
    for (const row of rows) {
      const total = round2(row.total);
      const cnt = Number(row.cnt);
      result[row.type] = total;
      if (row.type === 'expense') result.expenseCount = cnt;
      else result.incomeCount = cnt;
      result.count += cnt;
    }
    result.balance = round2(result.income - result.expense);
    return result;
  }

  async detail(userId: string, billId: string): Promise<BillDetailVm> {
    return this.buildDetail(userId, billId);
  }

  // ---------- 写入 ----------

  async create(
    userId: string,
    dto: CreateBillDto,
    idempotencyKey?: string,
  ): Promise<BillDetailVm> {
    const replayed = await this.idempotencyService.beginOrReplay(
      userId,
      idempotencyKey,
    );
    if (replayed) {
      // 实时查库重放：图片签名 URL 重新签发，且仍受用户隔离约束
      return this.detail(userId, replayed.billId);
    }

    try {
      const normalized = await this.normalizeCreate(userId, dto);
      const billId = await this.dataSource.transaction(async (manager) => {
        const insertResult = await manager.query(
          `INSERT INTO bills
             (user_id, book_id, category_id, pay_method_id, type, amount, record_date, record_time, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            normalized.bookId,
            normalized.categoryId,
            normalized.payMethodId,
            normalized.type,
            normalized.amount,
            normalized.recordDate,
            normalized.recordTime,
            normalized.remark,
          ],
        );
        const newId = String(
          (insertResult as { insertId: number | string }).insertId,
        );
        await this.replacePhotos(manager, newId, userId, normalized.photos);
        return newId;
      });

      const result = await this.buildDetail(userId, billId);
      await this.idempotencyService.commit(userId, idempotencyKey, billId);
      return result;
    } catch (error) {
      await this.idempotencyService.fail(userId, idempotencyKey);
      throw error;
    }
  }

  async update(
    userId: string,
    billId: string,
    dto: UpdateBillDto,
  ): Promise<BillDetailVm> {
    // 事务③：校验/字典/磁盘 IO 全部在事务外完成（02 §4.2 / 05 §3.3）
    const baseRows = await this.dataSource.query<BillJoinRow[]>(
      `${BILL_SELECT} WHERE b.id = ? AND b.user_id = ? LIMIT 1`,
      [billId, userId],
    );
    const existing = baseRows[0];
    if (!existing) billNotFound();

    if (dto.updatedAt) {
      this.assertOptimisticMatch(dto.updatedAt, existing.updated_at);
    }

    const normalized = await this.normalizeUpdate(userId, dto, existing);

    // 事务内只做：锁行 → 二次乐观锁校验 → UPDATE → 照片全量替换
    await this.dataSource.transaction(async (manager) => {
      const lockRows = await manager.query<Array<{ updated_at: string }>>(
        'SELECT updated_at FROM bills WHERE id = ? AND user_id = ? FOR UPDATE',
        [billId, userId],
      );
      if (!lockRows[0]) billNotFound();
      if (dto.updatedAt) {
        this.assertOptimisticMatch(dto.updatedAt, lockRows[0].updated_at);
      }

      await manager.query(
        `UPDATE bills
           SET type = ?, amount = ?, category_id = ?, pay_method_id = ?, book_id = ?,
               record_date = ?, record_time = ?, remark = ?
         WHERE id = ? AND user_id = ?`,
        [
          normalized.type,
          normalized.amount,
          normalized.categoryId,
          normalized.payMethodId,
          normalized.bookId,
          normalized.recordDate,
          normalized.recordTime,
          normalized.remark,
          billId,
          userId,
        ],
      );

      if (dto.photos !== undefined) {
        await manager.query(
          'DELETE FROM bill_photos WHERE bill_id = ? AND user_id = ?',
          [billId, userId],
        );
        await this.replacePhotos(manager, billId, userId, normalized.photos);
      }
    });

    // 提交后再 JOIN 组装 VO
    return this.buildDetail(userId, billId);
  }

  private assertOptimisticMatch(
    clientStamp: string,
    serverStamp: string | Date | undefined,
  ): void {
    const client = new Date(clientStamp).getTime();
    // 携带了 updatedAt 却不可解析：不得静默跳过乐观锁保护
    if (!Number.isFinite(client)) {
      bizError(ERROR_CODES.PARAM_INVALID, 'updatedAt 时间戳格式不正确');
    }
    const server = new Date(serverStamp ?? '').getTime();
    if (Math.abs(client - server) > 1000) {
      bizError(ERROR_CODES.CONFLICT, '账单已被他人修改，请刷新后重试');
    }
  }

  async remove(
    userId: string,
    billId: string,
  ): Promise<{ id: string; deleted: boolean }> {
    // 事务④：先取凭证 key 供 7 天墓碑保留，再物理删除（照片外键级联）。
    // Redis 墓碑登记放在事务提交之后（05 §3.3：事务内不做外部调用）。
    const photoKeys = await this.dataSource.transaction(async (manager) => {
      const photoRows = await manager.query<PhotoRow[]>(
        'SELECT url FROM bill_photos WHERE bill_id = ? AND user_id = ?',
        [billId, userId],
      );
      const result = await manager.query(
        'DELETE FROM bills WHERE id = ? AND user_id = ?',
        [billId, userId],
      );
      if ((result as { affectedRows?: number }).affectedRows !== 1)
        billNotFound();
      return photoRows.map((row) => row.url);
    });

    await this.cleanupService.markBillPhotosTombstone(photoKeys);
    return { id: billId, deleted: true };
  }

  async clear(
    userId: string,
    dto: ClearBillsDto,
  ): Promise<{ deletedCount: number }> {
    if (dto.bookId)
      await this.booksService.getOwnedBookOrFail(userId, dto.bookId);

    // Redis 墓碑登记放在事务提交之后（05 §3.3）
    const { deletedCount, photoKeys } = await this.dataSource.transaction(
      async (manager) => {
        const photoRows = await manager.query<PhotoRow[]>(
          'SELECT url FROM bill_photos WHERE user_id = ?' +
            (dto.bookId
              ? ' AND bill_id IN (SELECT id FROM bills WHERE book_id = ?)'
              : ''),
          dto.bookId ? [userId, dto.bookId] : [userId],
        );
        const result = await manager.query(
          'DELETE FROM bills WHERE user_id = ?' +
            (dto.bookId ? ' AND book_id = ?' : ''),
          dto.bookId ? [userId, dto.bookId] : [userId],
        );
        return {
          deletedCount: Number(
            (result as { affectedRows?: number }).affectedRows ?? 0,
          ),
          photoKeys: photoRows.map((row) => row.url),
        };
      },
    );

    await this.cleanupService.markBillPhotosTombstone(photoKeys);
    return { deletedCount };
  }

  // ---------- 内部工具 ----------

  private buildListScope(
    userId: string,
    query: BillListQueryDto,
  ): { whereSql: string; params: Array<string | number> } {
    const useRange =
      query.startDate !== undefined || query.endDate !== undefined;
    if (
      useRange &&
      query.startDate &&
      query.endDate &&
      query.startDate >= query.endDate
    ) {
      bizError(ERROR_CODES.DATETIME_INVALID, 'startDate 必须早于 endDate');
    }
    // 只给 startDate 时上界收敛到明天（半开），防止无界范围扫描；
    // 账单不允许未来日期，该上界在数据上等价于「至今」。
    let rangeEnd = query.endDate;
    if (useRange && !rangeEnd) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      rangeEnd = todayStr(tomorrow);
    }
    return this.buildScope({
      userId,
      startDate: useRange
        ? query.startDate
        : monthRange(query.month ?? currentMonth())[0],
      endDate: useRange
        ? rangeEnd
        : monthRange(query.month ?? currentMonth())[1],
      bookId: query.bookId,
      type: query.type && query.type !== 'ALL' ? query.type : undefined,
      categoryId: query.categoryId,
    });
  }

  private buildScope(options: {
    userId: string;
    startDate?: string;
    endDate?: string;
    bookId?: string;
    type?: 'expense' | 'income';
    categoryId?: string;
  }): { whereSql: string; params: Array<string | number> } {
    const clauses = ['b.user_id = ?'];
    const params: Array<string | number> = [options.userId];
    if (options.startDate) {
      clauses.push('b.record_date >= ?');
      params.push(options.startDate);
    }
    if (options.endDate) {
      clauses.push('b.record_date < ?');
      params.push(options.endDate);
    }
    if (options.bookId) {
      clauses.push('b.book_id = ?');
      params.push(options.bookId);
    }
    if (options.type) {
      clauses.push('b.type = ?');
      params.push(options.type);
    }
    if (options.categoryId) {
      clauses.push('b.category_id = ?');
      params.push(options.categoryId);
    }
    return { whereSql: clauses.join(' AND '), params };
  }

  private async loadPhotosMap(
    userId: string,
    billIds: string[],
  ): Promise<Map<string, string[]>> {
    if (billIds.length === 0) return new Map();
    const rows = await this.dataSource.query<PhotoRow[]>(
      `SELECT bill_id, url, sort_order FROM bill_photos
        WHERE user_id = ? AND bill_id IN (${billIds.map(() => '?').join(',')})
        ORDER BY bill_id ASC, sort_order ASC, id ASC`,
      [userId, ...billIds],
    );
    return mapPhotosToBillIds(rows, this.signedUrlService);
  }

  private async buildDetail(
    userId: string,
    billId: string,
    manager?: DataSource | import('typeorm').EntityManager,
  ): Promise<BillDetailVm> {
    const executor = manager ?? this.dataSource;
    const rows = await executor.query<BillJoinRow[]>(
      `${BILL_SELECT} WHERE b.id = ? AND b.user_id = ? LIMIT 1`,
      [billId, userId],
    );
    const row = rows[0];
    if (!row) billNotFound();

    const photoRows = await executor.query<PhotoRow[]>(
      'SELECT bill_id, url, sort_order FROM bill_photos WHERE bill_id = ? AND user_id = ? ORDER BY sort_order ASC, id ASC',
      [billId, userId],
    );
    const photos = photoRows.map(
      (photo) => this.signedUrlService.sign(photo.url).url,
    );

    const [monthStart, nextMonthStart] = monthRange(
      row.record_date.slice(0, 7),
    );
    const monthRows = await executor.query<
      Array<{ month_expense: string | number | null }>
    >(
      `SELECT COALESCE(SUM(amount), 0) AS month_expense
         FROM bills
        WHERE user_id = ? AND type = 'expense'
          AND record_date >= ? AND record_date < ?
          AND ( record_date < ? OR (record_date = ? AND record_time <= ?) )`,
      [
        userId,
        monthStart,
        nextMonthStart,
        row.record_date,
        row.record_date,
        row.record_time,
      ],
    );

    return toBillDetailVm(
      row,
      photos,
      Number(monthRows[0]?.month_expense ?? 0),
    );
  }

  private async replacePhotos(
    manager: import('typeorm').EntityManager,
    billId: string,
    userId: string,
    keys: string[],
  ): Promise<void> {
    for (const [index, key] of keys.entries()) {
      await manager.query(
        'INSERT INTO bill_photos (bill_id, user_id, url, sort_order) VALUES (?, ?, ?, ?)',
        [billId, userId, key, index],
      );
    }
  }

  private async normalizeCreate(
    userId: string,
    dto: CreateBillDto,
  ): Promise<NormalizedBillInput> {
    const type = dto.type ?? 'expense';
    await this.categoriesService.getCategoryOrFail(dto.categoryId, type);
    await this.payMethodsService.getPayMethodOrFail(dto.payMethodId);
    const bookId = await this.resolveBookId(userId, dto.bookId);
    const { amount, recordDate, recordTime, remark, photos } =
      this.validateCommonFields(userId, {
        amount: dto.amount,
        date: dto.date,
        time: dto.time,
        remark: dto.remark,
        photos: dto.photos,
      });
    return {
      type,
      amount,
      categoryId: dto.categoryId,
      payMethodId: dto.payMethodId,
      bookId,
      recordDate,
      recordTime: timeToColumn(recordTime),
      remark,
      photos,
    };
  }

  private async normalizeUpdate(
    userId: string,
    dto: UpdateBillDto,
    existing: BillJoinRow,
  ): Promise<NormalizedBillInput> {
    const type = dto.type ?? existing.type;
    const categoryId = dto.categoryId ?? String(existing.category_id);
    const payMethodId = dto.payMethodId ?? String(existing.pay_method_id);
    await this.categoriesService.getCategoryOrFail(categoryId, type);
    await this.payMethodsService.getPayMethodOrFail(payMethodId);
    const bookId = await this.resolveBookId(
      userId,
      dto.bookId ?? String(existing.book_id),
    );

    const cleaned = this.validateCommonFields(userId, {
      amount: dto.amount ?? existing.amount,
      date: dto.date ?? existing.record_date,
      time: dto.time ?? existing.record_time.slice(0, 5),
      remark: dto.remark ?? existing.remark,
      photos: dto.photos,
      partial: dto.photos === undefined,
    });

    return {
      type,
      amount: cleaned.amount,
      categoryId,
      payMethodId,
      bookId,
      recordDate: cleaned.recordDate,
      recordTime: timeToColumn(cleaned.recordTime),
      remark: cleaned.remark,
      photos: cleaned.photos,
    };
  }

  private validateCommonFields(
    userId: string,
    fields: {
      amount: number | string;
      date?: string;
      time?: string;
      remark?: string;
      photos?: string[];
      partial?: boolean;
    },
  ): {
    amount: string;
    recordDate: string;
    recordTime: string;
    remark: string;
    photos: string[];
  } {
    // 金额：> 0、≤ 上限、最多两位小数
    const rawAmount = fields.amount;
    if (typeof rawAmount === 'string' && /\.\d{3,}/.test(rawAmount.trim())) {
      bizError(ERROR_CODES.AMOUNT_INVALID);
    }
    const amountNumber = round2(rawAmount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0)
      bizError(ERROR_CODES.AMOUNT_INVALID);
    if (amountNumber > MAX_AMOUNT) bizError(ERROR_CODES.AMOUNT_INVALID);

    // 日期：不可未来；date=当天缺省时间取当前时刻，历史日期缺省 12:00
    const recordDate = fields.date ?? todayStr();
    if (
      !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(recordDate) ||
      Number.isNaN(new Date(`${recordDate}T00:00:00`).getTime())
    ) {
      bizError(ERROR_CODES.DATETIME_INVALID);
    }
    const now = new Date();
    if (recordDate > todayStr(now))
      bizError(ERROR_CODES.DATETIME_INVALID, '记账日期不能晚于今天');
    let recordTime: string;
    if (fields.time) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time))
        bizError(ERROR_CODES.DATETIME_INVALID);
      recordTime = fields.time;
    } else {
      recordTime =
        recordDate === todayStr(now)
          ? `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
          : '12:00';
    }
    if (recordDate === todayStr(now)) {
      const recordDateTime = new Date(`${recordDate}T${recordTime}:00`);
      if (recordDateTime.getTime() > now.getTime())
        bizError(ERROR_CODES.DATETIME_INVALID, '记账时间不能晚于当前时刻');
    }

    // 备注：trim 后按码点 ≤50（emoji 算 1，03 §10）
    const remark = (fields.remark ?? '').trim();
    if (codePointLength(remark) > 50) bizError(ERROR_CODES.REMARK_TOO_LONG);

    // 凭证：0~3 个，只认本站 bills 目录下当前用户的 key
    let photos: string[] = [];
    if (fields.photos !== undefined) {
      if (fields.photos.length > 3) bizError(ERROR_CODES.PHOTOS_TOO_MANY);
      for (const key of fields.photos) {
        if (
          typeof key !== 'string' ||
          !PHOTO_KEY_PATTERN.test(key) ||
          !key.startsWith(`bills/${userId}/`) ||
          this.storageService.resolveExistingFile(key) === null
        ) {
          bizError(ERROR_CODES.PARAM_INVALID, '凭证图片 key 非法');
        }
      }
      photos = [...fields.photos];
    }

    return {
      amount: amountNumber.toFixed(2),
      recordDate,
      recordTime,
      remark,
      photos,
    };
  }

  private async resolveBookId(
    userId: string,
    bookId: string | undefined,
  ): Promise<string> {
    if (bookId) {
      await this.booksService.getOwnedBookOrFail(userId, bookId);
      return bookId;
    }
    const activeBookId = await this.booksService.getActiveBookId(userId);
    if (activeBookId) {
      try {
        await this.booksService.getOwnedBookOrFail(userId, activeBookId);
        return activeBookId;
      } catch {
        // 激活态异常时回退默认账本
      }
    }
    const rows = await this.dataSource.query<Array<{ id: string | number }>>(
      'SELECT id FROM books WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
      [userId],
    );
    if (!rows[0]) {
      bizError(ERROR_CODES.BOOK_NOT_FOUND);
    }
    return String(rows[0].id);
  }
}
