import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  Validate,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  DATE_REGEX,
  MONTH_REGEX,
} from '../../../common/dto/month-query.dto.js';
import { IsAmountInputConstraint } from './bill-fields.dto.js';

const ID_PATTERN = /^\d{1,19}$/;

export class BillListQueryDto extends PaginationQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  month?: string;

  @Matches(DATE_REGEX, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  startDate?: string;

  @Matches(DATE_REGEX, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  endDate?: string;

  @IsIn(['ALL', 'expense', 'income'], {
    message: 'type 仅支持 ALL/expense/income',
  })
  @IsOptional()
  type?: 'ALL' | 'expense' | 'income';

  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;

  @Matches(ID_PATTERN, { message: '分类 id 非法' })
  @IsOptional()
  categoryId?: string;
}

/** 今日流水/月汇总/分组通用：仅账本过滤 */
export class BookScopeQueryDto {
  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;
}

export class GroupedQueryDto extends BookScopeQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  month!: string;

  @IsIn(['ALL', 'expense', 'income'], {
    message: 'type 仅支持 ALL/expense/income',
  })
  @IsOptional()
  type?: 'ALL' | 'expense' | 'income';
}

export class SummaryQueryDto extends BookScopeQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  month!: string;
}

export class CreateBillDto {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';

  @Validate(IsAmountInputConstraint)
  amount!: number | string;

  @Matches(ID_PATTERN, { message: '分类 id 非法' })
  categoryId!: string;

  @Matches(ID_PATTERN, { message: '支付方式 id 非法' })
  payMethodId!: string;

  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;

  @Matches(DATE_REGEX, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  date?: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  @IsOptional()
  time?: string;

  @IsString({ message: '备注必须为字符串' })
  @IsOptional()
  remark?: string;

  @IsArray({ message: 'photos 必须为数组' })
  @IsString({ each: true, message: 'photos 元素必须为字符串 key' })
  @IsOptional()
  photos?: string[];
}

export class UpdateBillDto {
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense/income' })
  @IsOptional()
  type?: 'expense' | 'income';

  @Validate(IsAmountInputConstraint)
  @IsOptional()
  amount?: number | string;

  @Matches(ID_PATTERN, { message: '分类 id 非法' })
  @IsOptional()
  categoryId?: string;

  @Matches(ID_PATTERN, { message: '支付方式 id 非法' })
  @IsOptional()
  payMethodId?: string;

  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;

  @Matches(DATE_REGEX, { message: '日期格式必须为 YYYY-MM-DD' })
  @IsOptional()
  date?: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: '时间格式必须为 HH:mm' })
  @IsOptional()
  time?: string;

  @IsString({ message: '备注必须为字符串' })
  @IsOptional()
  remark?: string;

  @IsArray({ message: 'photos 必须为数组' })
  @IsString({ each: true, message: 'photos 元素必须为字符串 key' })
  @IsOptional()
  photos?: string[];

  @IsString()
  @IsOptional()
  updatedAt?: string;
}

export class ClearBillsDto {
  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  bookId?: string;

  @IsIn([true], { message: '必须显式确认 confirm=true' })
  confirm!: true;
}
