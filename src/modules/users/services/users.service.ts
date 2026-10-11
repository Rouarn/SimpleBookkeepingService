import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import type { Express } from 'express';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import { joinDaysOf } from '../../../common/utils/date.util.js';
import { codePointLength } from '../../../common/utils/text.util.js';
import { TokenService } from '../../auth/services/token.service.js';
import { CategoriesService } from '../../dictionaries/services/categories.service.js';
import { PayMethodsService } from '../../dictionaries/services/pay-methods.service.js';
import { BooksService } from '../../books/services/books.service.js';
import { SignedUrlService } from '../../files/services/signed-url.service.js';
import { StorageService } from '../../files/services/storage.service.js';
import { CleanupService } from '../../files/services/cleanup.service.js';
import type { ChangePasswordDto } from '../dto/change-password.dto.js';
import type { UpdatePreferencesDto } from '../dto/preferences.dto.js';
import {
  toPreferencesVo,
  toProfileVo,
  type PreferenceRow,
  type PreferencesVo,
  type ProfileVo,
  type UserRow,
} from '../vo/user.vo.js';

interface CountRow {
  cnt: string | number;
}

/** 与注册一致（auth.service BCRYPT_COST）：bcrypt 计算成本因子 */
const BCRYPT_COST = 12;

/** 用户资料 / 头像 / 统计 / UI 偏好（04a §5~§10）。 */
@Injectable()
export class UsersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokenService: TokenService,
    private readonly booksService: BooksService,
    private readonly categoriesService: CategoriesService,
    private readonly payMethodsService: PayMethodsService,
    private readonly signedUrlService: SignedUrlService,
    private readonly storageService: StorageService,
    private readonly cleanupService: CleanupService,
  ) {}

  async getProfile(userId: string): Promise<ProfileVo> {
    return toProfileVo(
      await this.getUserRowOrFail(userId),
      this.signedUrlService,
    );
  }

  async updateName(userId: string, name: string): Promise<ProfileVo> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (codePointLength(trimmed) < 1 || codePointLength(trimmed) > 12) {
      throw new BusinessException(
        ERROR_CODES.NAME_INVALID.code,
        ERROR_CODES.NAME_INVALID.httpStatus,
        ERROR_CODES.NAME_INVALID.message,
      );
    }
    await this.dataSource.query('UPDATE users SET nickname = ? WHERE id = ?', [
      trimmed,
      userId,
    ]);
    return this.getProfile(userId);
  }

  async updateAvatar(
    userId: string,
    file: Express.Multer.File | undefined,
  ): Promise<{ avatar: string; expiresAt: string }> {
    if (!file || !file.buffer) {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '文件为空',
      );
    }

    const saved = await this.storageService.saveImage(
      userId,
      'avatar',
      file.originalname,
      file.mimetype,
      file.buffer,
    );

    const oldAvatar = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<UserRow[]>(
        'SELECT id, phone, nickname, avatar_url, join_date FROM users WHERE id = ? FOR UPDATE',
        [userId],
      );
      const previous = rows[0]?.avatar_url ?? '';
      await manager.query('UPDATE users SET avatar_url = ? WHERE id = ?', [
        saved.key,
        userId,
      ]);
      return previous;
    });

    // 旧头像提交后登记墓碑（保留历史版本 7 天）
    if (oldAvatar.startsWith('avatars/')) {
      await this.cleanupService.markAvatarTombstone(oldAvatar);
    }

    const signed = this.signedUrlService.sign(saved.key);
    return { avatar: signed.url, expiresAt: signed.expiresAt };
  }

  /**
   * 修改密码（P1-01）：校验旧密码 → 单事务更新哈希 + token_version 自增 +
   * 吊销该用户全部 refresh → 清守卫版本短缓存，所有旧 access 即刻失效。
   */
  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const rows = await this.dataSource.query<
      Array<{ id: string; password_hash: string }>
    >('SELECT id, password_hash FROM users WHERE id = ? LIMIT 1', [userId]);
    const user = rows[0];
    if (!user) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }
    const matched = await bcrypt.compare(dto.oldPassword, user.password_hash);
    if (!matched) {
      throw new BusinessException(
        ERROR_CODES.PASSWORD_INCORRECT.code,
        ERROR_CODES.PASSWORD_INCORRECT.httpStatus,
        ERROR_CODES.PASSWORD_INCORRECT.message,
        { field: 'oldPassword' },
      );
    }
    const newPasswordHash = await bcrypt.hash(dto.newPassword, BCRYPT_COST);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        'UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?',
        [newPasswordHash, userId],
      );
      await this.tokenService.revokeAllRefreshTokens(userId, manager);
    });
    await this.tokenService.invalidateVersionCache(userId);
  }

  /** 全员登出（P1-01）：token_version 自增 + 吊销全部 refresh，旧 access 即刻失效。 */
  async logoutAll(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.tokenService.bumpTokenVersion(userId, manager);
      await this.tokenService.revokeAllRefreshTokens(userId, manager);
    });
    await this.tokenService.invalidateVersionCache(userId);
  }

  async getStats(userId: string): Promise<{
    records: number;
    days: number;
    books: number;
    joinDays: number;
  }> {
    const billRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM bills WHERE user_id = ?',
      [userId],
    );
    const dayRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(DISTINCT record_date) AS cnt FROM bills WHERE user_id = ?',
      [userId],
    );
    const bookRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM books WHERE user_id = ? AND deleted_at IS NULL',
      [userId],
    );
    const user = await this.getUserRowOrFail(userId);

    return {
      records: Number(billRows[0]?.cnt ?? 0),
      days: Number(dayRows[0]?.cnt ?? 0),
      books: Number(bookRows[0]?.cnt ?? 0),
      joinDays: joinDaysOf(user.join_date),
    };
  }

  async getPreferences(userId: string): Promise<PreferencesVo> {
    const rows = await this.dataSource.query<PreferenceRow[]>(
      `SELECT active_book_id, flow_month, flow_type, stats_month, stats_type,
              last_bill_type, last_pay_method_id, last_category_expense_id, last_category_income_id
         FROM user_preferences WHERE user_id = ? LIMIT 1`,
      [userId],
    );
    return toPreferencesVo(rows[0] ?? this.defaultPreferenceRow());
  }

  /** PUT 整体替换：未传字段重置默认（04a §10）。 */
  async replacePreferences(
    userId: string,
    dto: UpdatePreferencesDto,
  ): Promise<PreferencesVo> {
    // 资源引用校验
    let activeBookId: string | null;
    if (dto.activeBookId === undefined) {
      activeBookId = await this.getDefaultBookId(userId);
    } else if (dto.activeBookId === null) {
      activeBookId = null;
    } else {
      await this.booksService.getOwnedBookOrFail(userId, dto.activeBookId);
      activeBookId = dto.activeBookId;
    }

    if (dto.lastPayMethod)
      await this.payMethodsService.getPayMethodOrFail(dto.lastPayMethod);
    if (dto.lastCategory?.expense) {
      await this.categoriesService.getCategoryOrFail(
        dto.lastCategory.expense,
        'expense',
      );
    }
    if (dto.lastCategory?.income) {
      await this.categoriesService.getCategoryOrFail(
        dto.lastCategory.income,
        'income',
      );
    }

    const values = {
      activeBookId,
      flowMonth: dto.flowMonth ?? null,
      flowType: dto.flowType ?? 'ALL',
      statsMonth: dto.statsMonth ?? null,
      statsType: dto.statsType ?? 'expense',
      lastBillType: dto.lastBillType ?? 'expense',
      lastPayMethodId: dto.lastPayMethod ?? null,
      lastCategoryExpenseId: dto.lastCategory?.expense ?? null,
      lastCategoryIncomeId: dto.lastCategory?.income ?? null,
    };

    await this.dataSource.query(
      `UPDATE user_preferences SET
         active_book_id = ?, flow_month = ?, flow_type = ?, stats_month = ?, stats_type = ?,
         last_bill_type = ?, last_pay_method_id = ?, last_category_expense_id = ?, last_category_income_id = ?
       WHERE user_id = ?`,
      [
        values.activeBookId,
        values.flowMonth,
        values.flowType,
        values.statsMonth,
        values.statsType,
        values.lastBillType,
        values.lastPayMethodId,
        values.lastCategoryExpenseId,
        values.lastCategoryIncomeId,
        userId,
      ],
    );

    return this.getPreferences(userId);
  }

  private async getUserRowOrFail(userId: string): Promise<UserRow> {
    const rows = await this.dataSource.query<UserRow[]>(
      'SELECT id, phone, nickname, avatar_url, join_date FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    const user = rows[0];
    if (!user) {
      throw new BusinessException(
        ERROR_CODES.UNAUTHORIZED.code,
        ERROR_CODES.UNAUTHORIZED.httpStatus,
        ERROR_CODES.UNAUTHORIZED.message,
      );
    }
    return user;
  }

  private async getDefaultBookId(userId: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ id: string | number }>>(
      'SELECT id FROM books WHERE user_id = ? AND is_default = 1 AND deleted_at IS NULL ORDER BY id ASC LIMIT 1',
      [userId],
    );
    return rows[0] ? String(rows[0].id) : null;
  }

  private defaultPreferenceRow(): PreferenceRow {
    return {
      active_book_id: null,
      flow_month: null,
      flow_type: 'ALL',
      stats_month: null,
      stats_type: 'expense',
      last_bill_type: 'expense',
      last_pay_method_id: null,
      last_category_expense_id: null,
      last_category_income_id: null,
    };
  }
}
