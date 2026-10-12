import { IsString, Length } from 'class-validator';

/** 账号注销入参：密码确认（长度规则与改密一致，防误触与盗号注销）。 */
export class DeactivateDto {
  @IsString({ message: '密码必须为字符串' })
  @Length(8, 32, { message: '密码长度需为 8~32 位' })
  password!: string;
}
