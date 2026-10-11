import {
  IsOptional,
  Matches,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  type ValidationArguments,
} from 'class-validator';
import { DATE_RANGE_MAX_DAYS } from '../constants/business-limits.js';
import { currentMonth } from '../utils/date.util.js';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

/** 把已通过 YYYY-MM-DD 正则校验的日期解析为 UTC 零点毫秒数（避免本机时区漂移）。 */
function parseDateUtc(date: string): number {
  const [year, month, day] = date.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return Date.UTC(year, month - 1, day);
}

/** 区间 DTO 结构（跨字段校验从 args.object 读取另一端）。 */
interface DateRangeDtoShape {
  startDate?: string;
  endDate?: string;
}

/** 跨字段校验（P2-12）：两端都传时 startDate 不得晚于 endDate。挂在 endDate 上。 */
@ValidatorConstraint({ name: 'startNotAfterEnd', async: false })
export class StartNotAfterEndConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as DateRangeDtoShape;
    if (
      typeof dto?.startDate !== 'string' ||
      typeof dto?.endDate !== 'string'
    ) {
      return true;
    }
    return parseDateUtc(dto.startDate) <= parseDateUtc(dto.endDate);
  }

  defaultMessage(): string {
    return '开始日期不能晚于结束日期';
  }
}

/** 跨字段校验（P2-12）：两端都传时区间跨度不得超过 370 天（约一年，防全表扫描式拉取）。 */
@ValidatorConstraint({ name: 'dateRangeMaxSpan', async: false })
export class DateRangeMaxSpanConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as DateRangeDtoShape;
    if (
      typeof dto?.startDate !== 'string' ||
      typeof dto?.endDate !== 'string'
    ) {
      return true;
    }
    const diffDays =
      (parseDateUtc(dto.endDate) - parseDateUtc(dto.startDate)) / MS_PER_DAY;
    return diffDays <= DATE_RANGE_MAX_DAYS;
  }

  defaultMessage(): string {
    return `日期区间跨度不能超过 ${DATE_RANGE_MAX_DAYS} 天`;
  }
}

/**
 * 日期区间（半开区间：startDate 含、endDate 不含），两端均可选但需格式合法；
 * 两端都传时做跨字段关系校验（P2-12）：start≤end 且跨度 ≤370 天。
 * 关系校验统一挂在 endDate 上（经 ValidationArguments.object 读 startDate），
 * 避免类级装饰器在不同 class-validator 版本上的注册差异。
 */
export class DateRangeQueryDto {
  @Matches(DATE_PATTERN, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  startDate?: string;

  @Matches(DATE_PATTERN, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  @Validate(StartNotAfterEndConstraint)
  @Validate(DateRangeMaxSpanConstraint)
  endDate?: string;
}

/** month 缺省取当前月（Asia/Shanghai）。 */
export function resolveMonth(month: string | undefined): string {
  return month && MONTH_PATTERN.test(month) ? month : currentMonth();
}

export const MONTH_REGEX = MONTH_PATTERN;
export const DATE_REGEX = DATE_PATTERN;
