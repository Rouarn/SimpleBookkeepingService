import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MONTH_REGEX } from '../../../common/dto/month-query.dto.js';
import { BookScopeQueryDto } from '../../bills/dto/bill-list-query.dto.js';

const ID_PATTERN = /^\d{1,19}$/;
const YEAR_PATTERN = /^\d{4}$/;

/**
 * 时间范围查询：month（YYYY-MM）与 year（YYYY）二选一，
 * 同时传入时由 service 层拒绝（400）。均缺省时默认当前月。
 */
class PeriodScopeQuery extends BookScopeQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  month?: string;

  @Matches(YEAR_PATTERN, { message: '年份格式必须为 YYYY' })
  @IsOptional()
  year?: string;
}

export class OverviewQueryDto extends PeriodScopeQuery {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';
}

export class CategoryStatsQueryDto extends PeriodScopeQuery {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';
}

export class PayMethodStatsQueryDto extends PeriodScopeQuery {}

export class TrendQueryDto {
  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;

  @Type(() => Number)
  @IsInt({ message: 'months 必须为整数' })
  @Min(3, { message: 'months 最小 3' })
  @Max(12, { message: 'months 最大 12' })
  @IsOptional()
  months?: number;

  @Matches(YEAR_PATTERN, { message: '年份格式必须为 YYYY' })
  @IsOptional()
  year?: string;
}
