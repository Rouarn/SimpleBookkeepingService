import { Type } from 'class-transformer';
import { IsIn, IsOptional, Matches, ValidateNested } from 'class-validator';

const ID_PATTERN = /^\d{1,19}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

class LastCategoryDto {
  // IsOptional 对 null 也放行（字段允许显式置空）
  @Matches(ID_PATTERN, { message: '支出分类 id 非法' })
  @IsOptional()
  expense?: string | null;

  @Matches(ID_PATTERN, { message: '收入分类 id 非法' })
  @IsOptional()
  income?: string | null;
}

/** PUT 整体替换：所有字段可选；未传字段由 Service 重置为默认值（04a §10）。 */
export class UpdatePreferencesDto {
  @Matches(ID_PATTERN, { message: '账本 id 非法' })
  @IsOptional()
  activeBookId?: string | null;

  @Matches(MONTH_PATTERN, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  flowMonth?: string | null;

  @IsIn(['ALL', 'EXPENSE', 'INCOME'], { message: 'flowType 枚举非法' })
  @IsOptional()
  flowType?: 'ALL' | 'EXPENSE' | 'INCOME';

  @Matches(MONTH_PATTERN, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  statsMonth?: string | null;

  @IsIn(['expense', 'income'], { message: 'statsType 枚举非法' })
  @IsOptional()
  statsType?: 'expense' | 'income';

  @IsIn(['expense', 'income'], { message: 'lastBillType 枚举非法' })
  @IsOptional()
  lastBillType?: 'expense' | 'income';

  @Matches(ID_PATTERN, { message: '支付方式 id 非法' })
  @IsOptional()
  lastPayMethod?: string | null;

  @ValidateNested()
  @Type(() => LastCategoryDto)
  @IsOptional()
  lastCategory?: LastCategoryDto;
}
