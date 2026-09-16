import { IsOptional, Matches } from 'class-validator';

const ID_PATTERN = /^\d{1,19}$/;

export class DeleteBookQueryDto {
  @IsOptional()
  @Matches(ID_PATTERN, { message: '迁移目标账本 id 非法' })
  migrateBookId?: string;
}
