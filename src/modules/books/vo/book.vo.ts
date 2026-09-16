import { round2 } from '../../../common/utils/money.js';
import { formatTimestamp } from '../../../common/utils/date.util.js';

/** 账本列表/详情原始聚合行（列名与表一致）。 */
export interface BookRow {
  id: string | number;
  name: string;
  budget: string | number;
  is_default: number | boolean;
  sort_order: number;
  created_at: Date | string;
  bill_count?: string | number;
}

/** 账本视图模型（04c BookVM）。 */
export interface BookVm {
  id: string;
  name: string;
  budget: number;
  isDefault: boolean;
  active: boolean;
  billCount: number;
  sortOrder: number;
  createdAt: string;
}

export function toBookVm(row: BookRow, activeBookId: string | null): BookVm {
  return {
    id: String(row.id),
    name: row.name,
    budget: round2(row.budget),
    isDefault: Number(row.is_default) === 1,
    active: activeBookId !== null && String(activeBookId) === String(row.id),
    billCount: Number(row.bill_count ?? 0),
    sortOrder: Number(row.sort_order),
    createdAt: formatTimestamp(new Date(row.created_at)),
  };
}
