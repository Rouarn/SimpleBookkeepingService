import { IsOptional, IsString, MaxLength } from 'class-validator';

export class LogoutDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048, { message: 'refreshToken 非法' })
  refreshToken?: string;
}
