import { IsOptional, Matches } from 'class-validator';
import { currentMonth } from '../utils/date.util.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 单月可选查询：month 缺省时由 resolveMonth 归一化为当前月。 */
export class MonthQueryDto {
  @Matches(MONTH_PATTERN, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  month?: string;
}

/** month 必填的查询参数。 */
export class RequiredMonthQueryDto {
  @Matches(MONTH_PATTERN, { message: '月份格式必须为 YYYY-MM' })
  month!: string;
}

/** 日期区间（半开区间：startDate 含、endDate 不含），两端均可选但需格式合法。 */
export class DateRangeQueryDto {
  @Matches(DATE_PATTERN, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  startDate?: string;

  @Matches(DATE_PATTERN, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  endDate?: string;
}

/** month 缺省取当前月（Asia/Shanghai）。 */
export function resolveMonth(month: string | undefined): string {
  return month && MONTH_PATTERN.test(month) ? month : currentMonth();
}

export const MONTH_REGEX = MONTH_PATTERN;
export const DATE_REGEX = DATE_PATTERN;
