import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @IsString({ message: 'refreshToken 必须为字符串' })
  @MinLength(10, { message: 'refreshToken 非法' })
  @MaxLength(2048, { message: 'refreshToken 非法' })
  refreshToken!: string;
}
