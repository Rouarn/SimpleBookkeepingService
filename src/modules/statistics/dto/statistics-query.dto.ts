import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { MONTH_REGEX } from '../../../common/dto/month-query.dto.js';
import { BookScopeQueryDto } from '../../bills/dto/bill-list-query.dto.js';

const ID_PATTERN = /^\d{1,19}$/;

class MonthScopeQuery extends BookScopeQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  month?: string;
}

export class OverviewQueryDto extends MonthScopeQuery {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';
}

export class CategoryStatsQueryDto extends MonthScopeQuery {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';
}

export class PayMethodStatsQueryDto extends MonthScopeQuery {}

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
}
