import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * 把 number 精确展开为十进制字面量（P2-12）。
 * 背景：String(number) 使用「最短往返表示」，即客户端 JSON 中 100.005
 * 经 Number 解析后 String(100.005) 仍是 "100.005"，可据此还原原始小数位；
 * 但极小/极大数会得到科学计数法（如 1e-7），这里统一展开成普通十进制。
 * 禁止使用 toFixed：它会先四舍五入，等于替客户端掩盖多余小数位。
 */
export function numberToDecimalLiteral(n: number): string | null {
  if (!Number.isFinite(n)) return null;
  const raw = String(n);
  const exp = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(raw);
  if (!exp) return raw;
  const sign = exp[1] ?? '';
  const intDigits = exp[2]!;
  const fracDigits = exp[3] ?? '';
  const shift = Number(exp[4]);
  const digits = intDigits + fracDigits;
  const point = intDigits.length + shift;
  let body: string;
  if (point <= 0) {
    body = `0.${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    body = digits + '0'.repeat(point - digits.length);
  } else {
    body = `${digits.slice(0, point)}.${digits.slice(point)}`;
  }
  return sign + body;
}

/**
 * 金额入参校验（04b §6 / P2-12）：number 或数字字符串均可，
 * 具体业务码（40001）由 Service 在精校阶段返回；此处只保证「可解析为有限数」
 * 且 number 通道不能绕过小数位检查（100.005 此前仅 Number.isFinite 直接放行，
 * 会被静默四舍五入入账）。
 */
@ValidatorConstraint({ name: 'isAmountInput', async: false })
export class IsAmountInputConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'number') {
      const literal = numberToDecimalLiteral(value);
      if (literal === null) return false;
      // 转精确十进制字符串后再查小数位：3 位及以上小数直接判非法
      return !/\.\d{3,}/.test(literal);
    }
    // 字符串通道维持原口径：格式合法性在此判，3 位小数由 Service 返回 40001
    if (typeof value === 'string') return /^\d+(\.\d+)?$/.test(value.trim());
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} 必须为大于 0 的金额`;
  }
}
