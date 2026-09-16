import { maskPhone } from '../../../common/utils/phone.util.js';
import { joinDaysOf } from '../../../common/utils/date.util.js';
import type { SignedUrlService } from '../../files/services/signed-url.service.js';

export interface UserRow {
  id: string | number;
  phone: string;
  nickname: string;
  avatar_url: string;
  join_date: string;
}

/** GET/PATCH /users/me 资料（04a §5/§6）。 */
export interface ProfileVo {
  id: string;
  phone: string;
  name: string;
  avatar: string;
  joinDate: string;
  joinDays: number;
}

export function toProfileVo(
  row: UserRow,
  signedUrlService: SignedUrlService,
): ProfileVo {
  return {
    id: String(row.id),
    phone: maskPhone(row.phone),
    name: row.nickname,
    avatar: row.avatar_url ? signedUrlService.sign(row.avatar_url).url : '',
    joinDate: row.join_date,
    joinDays: joinDaysOf(row.join_date),
  };
}

export interface PreferenceRow {
  active_book_id: string | null;
  flow_month: string | null;
  flow_type: 'ALL' | 'EXPENSE' | 'INCOME';
  stats_month: string | null;
  stats_type: 'expense' | 'income';
  last_bill_type: 'expense' | 'income';
  last_pay_method_id: string | null;
  last_category_expense_id: string | null;
  last_category_income_id: string | null;
}

export interface PreferencesVo {
  activeBookId: string | null;
  flowMonth: string | null;
  flowType: 'ALL' | 'EXPENSE' | 'INCOME';
  statsMonth: string | null;
  statsType: 'expense' | 'income';
  lastBillType: 'expense' | 'income';
  lastPayMethod: string | null;
  lastCategory: { expense: string | null; income: string | null };
}

export function toPreferencesVo(row: PreferenceRow): PreferencesVo {
  return {
    activeBookId:
      row.active_book_id === null ? null : String(row.active_book_id),
    flowMonth: row.flow_month,
    flowType: row.flow_type,
    statsMonth: row.stats_month,
    statsType: row.stats_type,
    lastBillType: row.last_bill_type,
    lastPayMethod:
      row.last_pay_method_id === null ? null : String(row.last_pay_method_id),
    lastCategory: {
      expense:
        row.last_category_expense_id === null
          ? null
          : String(row.last_category_expense_id),
      income:
        row.last_category_income_id === null
          ? null
          : String(row.last_category_income_id),
    },
  };
}
