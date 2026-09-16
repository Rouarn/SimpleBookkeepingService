import { round2 } from '../../../common/utils/money.js';
import {
  columnToTime,
  formatTimestamp,
} from '../../../common/utils/date.util.js';
import type { SignedUrlService } from '../../files/services/signed-url.service.js';

/** 账单 JOIN 字典后的查询行（列名与 SQL 别名一致）。 */
export interface BillJoinRow {
  id: string | number;
  type: 'expense' | 'income';
  amount: string | number;
  category_id: string | number;
  pay_method_id: string | number;
  record_date: string;
  record_time: string;
  remark: string;
  book_id: string | number;
  category_name: string;
  icon_text: string;
  icon_color: string;
  icon_bg: string;
  pay_method_name: string;
  book_name?: string;
  recorder?: string;
  created_at?: Date | string;
  updated_at?: Date | string;
}

export interface BillVm {
  id: string;
  type: 'expense' | 'income';
  amount: number;
  amountAbs: number;
  categoryId: string;
  category: string;
  iconText: string;
  iconColor: string;
  iconBg: string;
  payMethodId: string;
  payMethod: string;
  date: string;
  time: string;
  remark: string;
  photos: string[];
  bookId: string;
}

export interface BillDetailVm extends BillVm {
  bookName: string;
  recorder: string;
  recordTime: string;
  monthExpense: number;
  createdAt: string;
  updatedAt: string;
}

function baseVm(row: BillJoinRow, photos: string[]): BillVm {
  const abs = round2(row.amount);
  return {
    id: String(row.id),
    type: row.type,
    amount: row.type === 'expense' ? -abs : abs,
    amountAbs: abs,
    categoryId: String(row.category_id),
    category: row.category_name,
    iconText: row.icon_text,
    iconColor: row.icon_color,
    iconBg: row.icon_bg,
    payMethodId: String(row.pay_method_id),
    payMethod: row.pay_method_name,
    date: row.record_date,
    time: columnToTime(row.record_time),
    remark: row.remark ?? '',
    photos,
    bookId: String(row.book_id),
  };
}

/** 批量把照片 key 行映射为 billId → 签名 URL 列表，避免 N+1。 */
export function mapPhotosToBillIds(
  photoRows: Array<{ bill_id: string | number; url: string }>,
  signedUrlService: SignedUrlService,
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const photo of photoRows) {
    const billId = String(photo.bill_id);
    const list = map.get(billId) ?? [];
    list.push(signedUrlService.sign(photo.url).url);
    map.set(billId, list);
  }
  return map;
}

export function toBillVm(
  row: BillJoinRow,
  photosByBill: Map<string, string[]>,
): BillVm {
  return baseVm(row, photosByBill.get(String(row.id)) ?? []);
}

export function toBillDetailVm(
  row: BillJoinRow,
  photos: string[],
  monthExpense: number,
): BillDetailVm {
  return {
    ...baseVm(row, photos),
    bookName: row.book_name ?? '',
    recorder: row.recorder ?? '',
    recordTime: `${row.record_date} ${row.record_time}`,
    monthExpense: round2(monthExpense),
    createdAt: formatTimestamp(new Date(row.created_at ?? Date.now())),
    updatedAt: formatTimestamp(new Date(row.updated_at ?? Date.now())),
  };
}
