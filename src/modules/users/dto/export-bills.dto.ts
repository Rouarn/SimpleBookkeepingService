import { IsOptional, Matches } from 'class-validator';
import { MONTH_REGEX } from '../../../common/dto/month-query.dto.js';

/** GET /users/me/export 查询参数：month 缺省导出全部账单。 */
export class ExportBillsQueryDto {
  @Matches(MONTH_REGEX, { message: '月份格式必须为 YYYY-MM' })
  @IsOptional()
  month?: string;
}
