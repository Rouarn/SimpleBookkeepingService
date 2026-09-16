import { registerDecorator, type ValidationOptions } from 'class-validator';

/**
 * 常见弱口令 Top 列表（07 §2）：命中即拒绝，大小写不敏感。
 * 不强制字符种类组合。
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
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            !WEAK_PASSWORDS.has(value.toLowerCase())
          );
        },
        defaultMessage() {
          return '密码过于简单，请更换为更复杂的密码';
        },
      },
    });
  };
}
