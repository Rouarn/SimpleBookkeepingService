import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { MAX_AMOUNT, round2 } from '../../../common/utils/money.js';
import { codePointLength } from '../../../common/utils/text.util.js';
import type { CreateBookDto } from '../dto/create-book.dto.js';
import type { UpdateBookDto } from '../dto/update-book.dto.js';
import { toBookVm, type BookRow, type BookVm } from '../vo/book.vo.js';

const MAX_BOOKS_PER_USER = 20;

const BOOK_SELECT_COLUMNS = `
  b.id, b.name, b.budget, b.is_default, b.sort_order, b.created_at,
  (SELECT COUNT(*) FROM bills bl WHERE bl.book_id = b.id AND bl.user_id = b.user_id) AS bill_count
`;

function bookNotFound(): never {
  throw new BusinessException(
    ERROR_CODES.BOOK_NOT_FOUND.code,
    ERROR_CODES.BOOK_NOT_FOUND.httpStatus,
    ERROR_CODES.BOOK_NOT_FOUND.message,
  );
}

interface CountRow {
  cnt: string | number;
}

/**
 * 账本服务（04c §一 / 02 §4.2 事务⑤）。
 * 所有查询以 user_id 隔离，越权统一 40401（不存在与无权限不区分，防探测）。
 */
@Injectable()
export class BooksService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** 账本列表（含激活态与实时账单笔数；默认账本始终第一）。 */
  async list(userId: string): Promise<{ list: BookVm[] }> {
    const activeBookId = await this.getActiveBookId(userId);
    const rows = await this.dataSource.query<BookRow[]>(
      `SELECT ${BOOK_SELECT_COLUMNS}
         FROM books b
        WHERE b.user_id = ? AND b.deleted_at IS NULL
        ORDER BY b.is_default DESC, b.sort_order ASC, b.id ASC`,
      [userId],
    );
    return { list: rows.map((row) => toBookVm(row, activeBookId)) };
  }

  /** 新建账本（软上限 20；activate=true 同时切换激活）。 */
  async create(userId: string, dto: CreateBookDto): Promise<BookVm> {
    const name = this.validateName(dto.name);
    const budget = this.validateBudget(dto.budget ?? 0);

    const countRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM books WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    );
    if (Number(countRows[0]?.cnt ?? 0) >= MAX_BOOKS_PER_USER) {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '账本数量已达上限',
      );
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const insertResult = await manager.query(
        `INSERT INTO books (user_id, name, budget, is_default, sort_order)
         VALUES (?, ?, ?, 0, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM (SELECT sort_order FROM books WHERE user_id = ?) AS t))`,
        [userId, name, budget.toFixed(2), userId],
      );
      const newId = String(
        (insertResult as { insertId: number | string }).insertId,
      );
      if (dto.activate === true) {
        await manager.query(
          'UPDATE user_preferences SET active_book_id = ? WHERE user_id = ?',
          [newId, userId],
        );
      }
      return newId;
    });

    return this.findVm(
      userId,
      result,
      dto.activate === true ? result : undefined,
    );
  }

  /** 获取当前激活账本；偏好缺失（异常）时回退默认账本。 */
  async getActive(userId: string): Promise<BookVm> {
    const activeBookId = await this.getActiveBookId(userId);
    if (activeBookId) {
      const rows = await this.queryBookVm(userId, activeBookId);
      if (rows[0]) return toBookVm(rows[0], activeBookId);
    }
    const defaultRows = await this.dataSource.query<BookRow[]>(
      `SELECT ${BOOK_SELECT_COLUMNS}
         FROM books b
        WHERE b.user_id = ? AND b.is_default = 1 AND b.deleted_at IS NULL
        ORDER BY b.id ASC LIMIT 1`,
      [userId],
    );
    const defaultRow = defaultRows[0];
    if (!defaultRow) bookNotFound();
    return toBookVm(defaultRow, String(defaultRow.id));
  }

  /** 切换激活账本。 */
  async setActive(userId: string, bookId: string): Promise<BookVm> {
    await this.assertOwnedBook(userId, bookId);
    await this.dataSource.query(
      'UPDATE user_preferences SET active_book_id = ? WHERE user_id = ?',
      [bookId, userId],
    );
    return this.findVm(userId, bookId, bookId);
  }

  /** 账本详情。 */
  async detail(userId: string, bookId: string): Promise<BookVm> {
    return this.findVm(userId, bookId);
  }

  /** 修改账本名 / 月预算（局部更新）。 */
  async update(
    userId: string,
    bookId: string,
    dto: UpdateBookDto,
  ): Promise<BookVm> {
    await this.assertOwnedBook(userId, bookId);

    const sets: string[] = [];
    const params: Array<string | number> = [];
    if (dto.name !== undefined) {
      sets.push('name = ?');
      params.push(this.validateName(dto.name));
    }
    if (dto.budget !== undefined) {
      sets.push('budget = ?');
      params.push(this.validateBudget(dto.budget).toFixed(2));
    }
    if (sets.length > 0) {
      params.push(bookId, userId);
      await this.dataSource.query(
        `UPDATE books SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
        params,
      );
    }
    return this.findVm(userId, bookId);
  }

  /**
   * 删除账本（事务⑤）：
   * 1. 默认账本 40021；2. 无账单直接删；3. 有账单未传迁移目标 40020；
   * 4. 迁移目标非法 40022；5. 合法则迁移账单 → 删账本 → 修正激活态。
   */
  async remove(
    userId: string,
    bookId: string,
    migrateBookId?: string,
  ): Promise<{ id: string; deleted: boolean; migratedBillCount: number }> {
    const book = await this.getOwnedBookOrFail(userId, bookId);
    if (Number(book.is_default) === 1) {
      throw new BusinessException(
        ERROR_CODES.DEFAULT_BOOK_PROTECTED.code,
        ERROR_CODES.DEFAULT_BOOK_PROTECTED.httpStatus,
        ERROR_CODES.DEFAULT_BOOK_PROTECTED.message,
      );
    }

    const billCountRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM bills WHERE book_id = ? AND user_id = ?',
      [bookId, userId],
    );
    const billCount = Number(billCountRows[0]?.cnt ?? 0);

    if (billCount > 0) {
      if (!migrateBookId) {
        throw new BusinessException(
          ERROR_CODES.BOOK_NOT_EMPTY.code,
          ERROR_CODES.BOOK_NOT_EMPTY.httpStatus,
          ERROR_CODES.BOOK_NOT_EMPTY.message,
        );
      }
      if (migrateBookId === bookId) {
        throw new BusinessException(
          ERROR_CODES.MIGRATE_TARGET_INVALID.code,
          ERROR_CODES.MIGRATE_TARGET_INVALID.httpStatus,
          ERROR_CODES.MIGRATE_TARGET_INVALID.message,
        );
      }
      await this.assertOwnedBook(userId, migrateBookId);
    }

    const migratedBillCount = await this.dataSource.transaction(
      async (manager) => {
        let migrated = 0;
        if (billCount > 0 && migrateBookId) {
          const migrateResult = await manager.query(
            'UPDATE bills SET book_id = ? WHERE book_id = ? AND user_id = ?',
            [migrateBookId, bookId, userId],
          );
          migrated = Number(
            (migrateResult as { changedRows?: number }).changedRows ?? 0,
          );
        }

        const deleteResult = await manager.query(
          'DELETE FROM books WHERE id = ? AND user_id = ? AND is_default = 0',
          [bookId, userId],
        );
        if ((deleteResult as { affectedRows?: number }).affectedRows !== 1) {
          throw new BusinessException(
            ERROR_CODES.DEFAULT_BOOK_PROTECTED.code,
            ERROR_CODES.DEFAULT_BOOK_PROTECTED.httpStatus,
            ERROR_CODES.DEFAULT_BOOK_PROTECTED.message,
          );
        }

        // 若删除的是激活账本，激活态重置为默认账本
        await manager.query(
          `UPDATE user_preferences
            SET active_book_id = (SELECT id FROM (SELECT id FROM books WHERE user_id = ? AND is_default = 1 LIMIT 1) AS d)
          WHERE user_id = ? AND active_book_id = ?`,
          [userId, userId, bookId],
        );

        return migrated;
      },
    );

    return { id: bookId, deleted: true, migratedBillCount };
  }

  /**
   * 高频归属校验（轻量）：仅判存在性，不做 bill_count 聚合子查询。
   * 供账单写入、统计等只验归属的路径复用；不存在或不属于当前用户统一 40401。
   */
  async assertOwnedBook(userId: string, bookId: string): Promise<void> {
    const rows = await this.dataSource.query<Array<{ ok: number }>>(
      'SELECT 1 AS ok FROM books WHERE id = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1',
      [bookId, userId],
    );
    if (!rows[0]) bookNotFound();
  }

  /**
   * 账本归属校验（需完整行）：返回行含 bill_count 聚合，
   * 仅保留给真正依赖行字段（如 is_default）的路径；纯归属校验请用 assertOwnedBook。
   */
  async getOwnedBookOrFail(userId: string, bookId: string): Promise<BookRow> {
    const rows = await this.dataSource.query<BookRow[]>(
      `SELECT ${BOOK_SELECT_COLUMNS}
         FROM books b
        WHERE b.id = ? AND b.user_id = ? AND b.deleted_at IS NULL
        LIMIT 1`,
      [bookId, userId],
    );
    const book = rows[0];
    if (!book) bookNotFound();
    return book;
  }

  async getActiveBookId(userId: string): Promise<string | null> {
    const rows = await this.dataSource.query<
      Array<{ active_book_id: string | null }>
    >('SELECT active_book_id FROM user_preferences WHERE user_id = ? LIMIT 1', [
      userId,
    ]);
    const value = rows[0]?.active_book_id;
    return value === null || value === undefined ? null : String(value);
  }

  private async queryBookVm(
    userId: string,
    bookId: string,
  ): Promise<BookRow[]> {
    return this.dataSource.query<BookRow[]>(
      `SELECT ${BOOK_SELECT_COLUMNS}
         FROM books b
        WHERE b.id = ? AND b.user_id = ? AND b.deleted_at IS NULL
        LIMIT 1`,
      [bookId, userId],
    );
  }

  private async findVm(
    userId: string,
    bookId: string,
    activeBookIdOverride?: string,
  ): Promise<BookVm> {
    const activeBookId =
      activeBookIdOverride ?? (await this.getActiveBookId(userId));
    const rows = await this.queryBookVm(userId, bookId);
    const row = rows[0];
    if (!row) bookNotFound();
    return toBookVm(row, activeBookId);
  }

  private validateName(rawName: unknown): string {
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (codePointLength(name) < 1 || codePointLength(name) > 12) {
      throw new BusinessException(
        ERROR_CODES.NAME_INVALID.code,
        ERROR_CODES.NAME_INVALID.httpStatus,
        ERROR_CODES.NAME_INVALID.message,
      );
    }
    return name;
  }

  private validateBudget(rawBudget: number): number {
    if (!Number.isFinite(rawBudget)) {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '预算必须为数字',
        { field: 'budget' },
      );
    }
    if (round2(rawBudget) < 0) {
      throw new BusinessException(
        ERROR_CODES.BUDGET_NEGATIVE.code,
        ERROR_CODES.BUDGET_NEGATIVE.httpStatus,
        ERROR_CODES.BUDGET_NEGATIVE.message,
      );
    }
    if (round2(rawBudget) > MAX_AMOUNT) {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        `预算不能超过 ${MAX_AMOUNT.toFixed(2)}`,
        { field: 'budget' },
      );
    }
    return round2(rawBudget);
  }
}
