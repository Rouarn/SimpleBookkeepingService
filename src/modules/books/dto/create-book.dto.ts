import { Transform } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBookDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '账本名称必须为字符串' })
  name!: string;

  /** 数值合法性在 Service 校验，为负返回专属错误码 40011 */
  @IsOptional()
  @IsNumber({}, { message: '预算必须为数字' })
  budget?: number;

  @IsOptional()
  @IsBoolean()
  activate?: boolean;
}
