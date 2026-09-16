import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';

export class UpdateProfileDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString({ message: '昵称必须为字符串' })
  name!: string;
}
