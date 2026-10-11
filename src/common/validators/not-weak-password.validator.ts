import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * 常见弱口令 Top 列表（07 §2）：命中即拒绝，大小写不敏感。
 */
const WEAK_PASSWORDS = new Set([
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  '111111111',
  '00000000',
  '88888888',
  '66666666',
  '123123123',
  'abc12345',
  'a12345678',
  'aa123456',
  'password',
  'password1',
  'password123',
  'qwerty123',
  '1q2w3e4r',
  'abcd1234',
  'woaini1314',
  'iloveyou',
]);

/**
 * 常见弱词表（P1-06）：匹配「弱词 + 可选数字尾缀」模式，如 password123、admin2024。
 * qwerty/asdf/zxcv 等键盘行序列已由键盘序列规则覆盖，此处不重复收录。
 */
const WEAK_WORDS = [
  'password',
  'passwd',
  'pwd',
  'admin',
  'qwerty',
  'abc',
  'letmein',
  'welcome',
  'monkey',
  'dragon',
  'iloveyou',
  'woaini',
  'aini',
  'user',
  'root',
  'guest',
  'test',
] as const;

/** 弱词 + 可选数字尾缀的预编译正则（词表均为字母，无需转义）。 */
const WEAK_WORD_PATTERNS: RegExp[] = WEAK_WORDS.map(
  (word) => new RegExp(`^${word}\\d*$`),
);

/** 键盘行/字母表基础序列（P1-06）：正逆序均检测，连续 >=4 位即拒绝。 */
const KEYBOARD_SEQUENCES = [
  '1234567890',
  'qwertyuiop',
  'asdfghjkl',
  'zxcvbnm',
  'abcdefghijklmnopqrstuvwxyz',
] as const;

/**
 * 预生成所有长度为 4 的连续片段（含逆序）。
 * 密码只要包含任一长度 4 的连续片段，即等价于存在 >=4 位的正/逆序键盘序列。
 */
const KEYBOARD_CHUNKS: Set<string> = new Set(
  KEYBOARD_SEQUENCES.flatMap((sequence) => {
    const reversed = Array.from(sequence).reverse().join('');
    const chunks: string[] = [];
    for (const seq of [sequence, reversed]) {
      for (let i = 0; i <= seq.length - 4; i += 1) {
        chunks.push(seq.slice(i, i + 4));
      }
    }
    return chunks;
  }),
);

/**
 * 依次检测各弱口令规则，返回首个命中的具体中文提示；null 表示未命中。
 * 校验与报错文案共用同一函数，保证规则与提示信息始终一致。
 */
function detectWeakRule(
  value: string,
  args: ValidationArguments,
): string | null {
  const lower = value.toLowerCase();

  // 规则 1：常见弱口令精确名单
  if (WEAK_PASSWORDS.has(lower)) {
    return '密码为常见弱口令，请更换';
  }

  // 规则 2：与手机号相同或逆序（从 DTO 上下文读取 phone 字段）
  const phone = (args.object as Record<string, unknown> | undefined)?.phone;
  if (typeof phone === 'string' && phone !== '') {
    const phoneReversed = Array.from(phone).reverse().join('');
    if (lower === phone.toLowerCase() || lower === phoneReversed) {
      return '密码不能与手机号相同（含逆序）';
    }
  }

  // 规则 3：键盘连续序列（正/逆序，长度 >=4，如 qwert/1234/abcd）
  for (const chunk of KEYBOARD_CHUNKS) {
    if (lower.includes(chunk)) {
      return '密码包含键盘连续字符序列（如 qwert/1234/abcd），请更换';
    }
  }

  // 规则 4：弱词 + 可选数字尾缀（如 password123、admin2024）
  for (const pattern of WEAK_WORD_PATTERNS) {
    if (pattern.test(lower)) {
      return '密码为常见弱词加数字的组合，请更换';
    }
  }

  // 规则 5：纯数字或纯字母（单一字符类别）
  if (/^\d+$/.test(value)) {
    return '密码不能为纯数字';
  }
  if (/^[a-zA-Z]+$/.test(value)) {
    return '密码不能为纯字母';
  }

  return null;
}

/**
 * 弱口令校验（P1-06）：精确名单 + 手机号同逆 + 键盘序列 + 弱词数字尾缀 + 单一字符类别。
 * 非字符串交由 @IsString 拦截，此处不重复报错。
 */
export function NotWeakPassword(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'notWeakPassword',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return true;
          return detectWeakRule(value, args) === null;
        },
        defaultMessage(args: ValidationArguments) {
          const value = args.value;
          if (typeof value === 'string') {
            return (
              detectWeakRule(value, args) ??
              '密码过于简单，请更换为更复杂的密码'
            );
          }
          return '密码过于简单，请更换为更复杂的密码';
        },
      },
    });
  };
}
