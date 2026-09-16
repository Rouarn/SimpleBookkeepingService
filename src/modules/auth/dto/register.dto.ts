import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { CodePointLength } from '../../../common/validators/codepoint-length.validator.js';
import { NotWeakPassword } from '../../../common/validators/not-weak-password.validator.js';

const PLATFORMS = ['app', 'h5', 'mp-weixin', 'mp-alipay', 'mp-douyin'] as const;

export class RegisterDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString({ message: '密码必须为字符串' })
  @Length(8, 32, { message: '密码长度需为 8~32 位' })
  @NotWeakPassword()
  password!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @CodePointLength(1, 12, { message: '昵称长度需为 1~12 字' })
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '设备标识过长' })
  deviceId?: string;

  @IsOptional()
  @IsIn(PLATFORMS, { message: '平台标识非法' })
  platform?: (typeof PLATFORMS)[number];
}
