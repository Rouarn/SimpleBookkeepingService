import { IsIn, IsOptional } from 'class-validator';

export class CategoryQueryDto {
  @IsOptional()
  @IsIn(['expense', 'income'], { message: 'type 仅支持 expense / income' })
  type?: 'expense' | 'income';
}
