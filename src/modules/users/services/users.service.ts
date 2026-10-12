import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import bcrypt from 'bcrypt';
import type { Express } from 'express';
import type { Response } from 'express';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';
import {
  formatTimestamp,
  joinDaysOf,
  monthRange,
} from '../../../common/utils/date.util.js';
import { codePointLength } from '../../../common/utils/text.util.js';
import { TokenService } from '../../auth/services/token.service.js';
import { CategoriesService } from '../../dictionaries/services/categories.service.js';
import { PayMethodsService } from '../../dictionaries/services/pay-methods.service.js';
import { BooksService } from '../../books/services/books.service.js';
import { MessagesService } from '../../messages/messages.service.js';
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

/** 我的统计：账单笔数与记账天数合并为一条聚合行 */
interface BillStatsRow {
  records: string | number;
  days: string | number;
}

/** 与注册一致（auth.service BCRYPT_COST）：bcrypt 计算成本因子 */
const BCRYPT_COST = 12;

/** CSV 导出主键游标分批行数 */
const EXPORT_BATCH_SIZE = 1000;

/** CSV 字段转义：含 , " \n \r 时双引号包裹并翻倍内部引号。 */
function csvEscape(field: string): string {
  if (/[",\n\r]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

interface ExportBillRow {
  id: string | number;
  record_date: string;
  record_time: string;
  type: 'expense' | 'income';
  category_name: string;
  pay_method_name: string;
  amount: string;
  remark: string | null;
  book_name: string;
}

/** 用户资料 / 头像 / 统计 / UI 偏好（04a §5~§10）。 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger('UsersService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokenService: TokenService,
    private readonly booksService: BooksService,
    private readonly categoriesService: CategoriesService,
    private readonly payMethodsService: PayMethodsService,
    private readonly signedUrlService: SignedUrlService,
    private readonly storageService: StorageService,
    private readonly cleanupService: CleanupService,
    private readonly messagesService: MessagesService,
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

  /**
   * 账单 CSV 导出（流式）：@Res() 接管响应，主键游标 1000 行/批分批查询
   * 并写响应流，避免全量结果集驻留内存；JOIN 分类/支付方式/账本名。
   * 仅导出本人数据（恒定 user_id 过滤）；month 缺省导出全部。
   */
  async exportBills(
    userId: string,
    month: string | undefined,
    res: Response,
  ): Promise<void> {
    const clauses = ['b.user_id = ?'];
    const params: Array<string | number> = [userId];
    if (month) {
      const [monthStart, monthEnd] = monthRange(month);
      clauses.push('b.record_date >= ?', 'b.record_date < ?');
      params.push(monthStart, monthEnd);
    }
    const whereSql = clauses.join(' AND ');
    // Excel 中文兼容：BOM + UTF-8；文件名带月份（YYYYMM）或 all
    const filename = month
      ? `bills_export_${month.replace('-', '')}.csv`
      : 'bills_export_all.csv';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
    res.write('\uFEFF');
    res.write('账单日期,时间,类型,分类,支付方式,金额,备注,账本\n');

    try {
      let cursor = '0';
      for (;;) {
        const rows = await this.dataSource.query<ExportBillRow[]>(
          `SELECT b.id,
                  DATE_FORMAT(b.record_date, '%Y-%m-%d') AS record_date,
                  b.record_time, b.type,
                  c.name AS category_name, p.name AS pay_method_name,
                  b.amount, b.remark, bk.name AS book_name
             FROM bills b
             JOIN categories c ON c.id = b.category_id
             JOIN pay_methods p ON p.id = b.pay_method_id
             JOIN books bk ON bk.id = b.book_id
            WHERE ${whereSql} AND b.id > ?
            ORDER BY b.id ASC
            LIMIT ${EXPORT_BATCH_SIZE}`,
          [...params, cursor],
        );
        if (rows.length === 0) break;
        for (const row of rows) {
          res.write(
            [
              row.record_date,
              String(row.record_time).slice(0, 5),
              row.type === 'expense' ? '支出' : '收入',
              row.category_name,
              row.pay_method_name,
              // 金额保持 DECIMAL 字符串原样，不经数值转换
              String(row.amount),
              row.remark ?? '',
              row.book_name,
            ]
              .map(csvEscape)
              .join(',') + '\n',
          );
        }
        cursor = String(rows[rows.length - 1]!.id);
        if (rows.length < EXPORT_BATCH_SIZE) break;
      }
    } catch (error) {
      this.logger.warn(
        `账单导出中断 userId=${userId}: ${(error as Error).message}`,
      );
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  /**
   * 账号注销：校验密码 → 单事务改写账号（status=2、手机号匿名化释放唯一键、
   * token_version 自增、记录注销时刻）→ 事务后吊销全部 refresh → 清守卫
   * 版本缓存 → 发一条 security 告警消息（留档，用户已登出看不到无妨）。
   * 业务数据由注销保留期清理任务（deactivated-purge）回收；users 行保留。
   */
  async deactivate(userId: string, password: string): Promise<void> {
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
    // 与改密同一错误码路径：密码不符 → PASSWORD_INCORRECT
    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      throw new BusinessException(
        ERROR_CODES.PASSWORD_INCORRECT.code,
        ERROR_CODES.PASSWORD_INCORRECT.httpStatus,
        ERROR_CODES.PASSWORD_INCORRECT.message,
        { field: 'password' },
      );
    }

    await this.dataSource.transaction(async (manager) => {
      // 匿名手机号内嵌主键 id（id 唯一故新值必然唯一，MD5 段仅混淆），无碰撞重试需要
      const result = await manager.query(
        `UPDATE users SET
           status = 2,
           phone = CONCAT('del:', id, ':', LEFT(MD5(RAND()), 10)),
           nickname = '已注销用户',
           avatar_url = '',
           token_version = token_version + 1,
           deactivated_at = NOW(3)
         WHERE id = ? AND status = 1`,
        [userId],
      );
      if ((result as { affectedRows?: number }).affectedRows !== 1) {
        throw new BusinessException(
          ERROR_CODES.CONFLICT.code,
          ERROR_CODES.CONFLICT.httpStatus,
          '账号状态已变化，请刷新后重试',
        );
      }
    });

    // 事务后收尾（事务外连接）：吊销全部 refresh + 清守卫版本短缓存
    await this.tokenService.revokeAllRefreshTokens(userId);
    await this.tokenService.invalidateVersionCache(userId);
    await this.messagesService.append(
      userId,
      'security',
      '安全提醒',
      `账号已于 ${formatTimestamp()} 申请注销，全部登录态已失效；账单等业务数据将在保留期后清除。`,
    );
  }

  async getStats(userId: string): Promise<{
    records: number;
    days: number;
    books: number;
    joinDays: number;
  }> {
    // 三路查询互不依赖并行发出；账单两条聚合（笔数 + 去重记账天数）合并为一条 SELECT
    const [billStatsRows, bookRows, user] = await Promise.all([
      this.dataSource.query<BillStatsRow[]>(
        'SELECT COUNT(*) AS records, COUNT(DISTINCT record_date) AS days FROM bills WHERE user_id = ?',
        [userId],
      ),
      this.dataSource.query<CountRow[]>(
        'SELECT COUNT(*) AS cnt FROM books WHERE user_id = ? AND deleted_at IS NULL',
        [userId],
      ),
      this.getUserRowOrFail(userId),
    ]);
    const billStats = billStatsRows[0];

    return {
      records: Number(billStats?.records ?? 0),
      days: Number(billStats?.days ?? 0),
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
