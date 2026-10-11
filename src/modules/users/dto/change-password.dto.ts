import { IsString, Length } from 'class-validator';
import { NotWeakPassword } from '../../../common/validators/not-weak-password.validator.js';

/** 修改密码入参（P1-01）：新密码规则与注册一致（8~32 位 + 弱口令黑名单）。 */
export class ChangePasswordDto {
  @IsString({ message: '密码必须为字符串' })
  @Length(8, 32, { message: '密码长度需为 8~32 位' })
  oldPassword!: string;

  @IsString({ message: '密码必须为字符串' })
  @Length(8, 32, { message: '密码长度需为 8~32 位' })
  @NotWeakPassword()
  newPassword!: string;
}
