import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { CodePointLength } from '../../../common/validators/codepoint-length.validator.js';
import { NotWeakPassword } from '../../../common/validators/not-weak-password.validator.js';
import { NICKNAME_MAX_LENGTH } from '../../../common/constants/business-limits.js';

const PLATFORMS = ['app', 'h5', 'mp-weixin', 'mp-alipay', 'mp-douyin'] as const;

/** 零宽字符码点：U+200B/200C/200D 与 BOM U+FEFF（视觉不可见，可用于混淆/冒名）。 */
const ZERO_WIDTH_CODE_POINTS = new Set([0x200b, 0x200c, 0x200d, 0xfeff]);

/** RTL 覆盖符码点：U+202A-202E、U+2066-2069（可反转文本显示方向，钓鱼/审计投毒）。 */
const RTL_OVERRIDE_CODE_POINTS = new Set<number>([
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
]);

/**
 * 昵称安全判定（P2-12）：
 * - \p{Cc}：C0/C1 控制字符（U+0000-001F、U+0080-009F，含换行/制表/转义）；
 * - 零宽字符与 RTL 覆盖符按码点匹配（用十六进制码点书写，避免源码混入不可见字符）。
 */
function containsUnsafeNicknameChar(value: string): boolean {
  if (/\p{Cc}/u.test(value)) return true;
  for (const char of value) {
    const codePoint = char.codePointAt(0)!;
    if (
      ZERO_WIDTH_CODE_POINTS.has(codePoint) ||
      RTL_OVERRIDE_CODE_POINTS.has(codePoint)
    ) {
      return true;
    }
  }
  return false;
}

/** 昵称安全约束（P2-12）：仅拦截上述不可见/方向控制字符，正常 emoji/中日韩文字放行。 */
@ValidatorConstraint({ name: 'nicknameSafe', async: false })
export class NicknameSafeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && !containsUnsafeNicknameChar(value);
  }

  defaultMessage(): string {
    return '昵称不能包含控制字符、零宽字符或文本方向控制符';
  }
}

export class RegisterDto {
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @IsString({ message: '密码必须为字符串' })
  // P1-06：长度按 Unicode 码点计（8~32 位），与弱口令校验器同口径（@Length 按 UTF-16 码元计数，emoji 等会误判）
  @CodePointLength(8, 32, { message: '密码长度需为 8~32 位' })
  @NotWeakPassword()
  password!: string;

  // P2-12：先 trim 再校验，码点长度 1~12，并拒绝控制/零宽/RTL 覆盖字符
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @CodePointLength(1, NICKNAME_MAX_LENGTH, {
    message: `昵称长度需为 1~${NICKNAME_MAX_LENGTH} 字`,
  })
  @Validate(NicknameSafeConstraint)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: '设备标识过长' })
  deviceId?: string;

  @IsOptional()
  @IsIn(PLATFORMS, { message: '平台标识非法' })
  platform?: (typeof PLATFORMS)[number];
}
