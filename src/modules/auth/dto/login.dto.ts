import {
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const PLATFORMS = ['app', 'h5', 'mp-weixin', 'mp-alipay', 'mp-douyin'] as const;

export class LoginDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString({ message: '密码必须为字符串' })
  @Length(8, 32, { message: '密码长度需为 8~32 位' })
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '设备标识过长' })
  deviceId?: string;

  @IsOptional()
  @IsIn(PLATFORMS, { message: '平台标识非法' })
  platform?: (typeof PLATFORMS)[number];
}
