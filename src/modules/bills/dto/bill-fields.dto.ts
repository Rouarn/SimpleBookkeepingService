import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * 金额入参校验（04b §6）：number 或数字字符串均可，
 * 具体业务码（40001）由 Service 在精校阶段返回；此处只保证「可解析为有限数」。
 */
@ValidatorConstraint({ name: 'isAmountInput', async: false })
export class IsAmountInputConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'string') return /^\d+(\.\d+)?$/.test(value.trim());
    return false;
  }

  defaultMessage(args: ValidationArguments): string {
    return `${args.property} 必须为大于 0 的金额`;
  }
}
