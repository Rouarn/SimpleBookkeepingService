import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { codePointLength } from '../utils/text.util.js';

/**
 * 按 Unicode 码点计长度（03 §10：emoji 算 1），替代 class-validator 按 UTF-16 计数的 @Length。
 */
export function CodePointLength(
  min: number,
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return (object: object, propertyName: string | symbol) => {
    registerDecorator({
      name: 'codePointLength',
      target: object.constructor,
      propertyName: propertyName.toString(),
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return (
            typeof value === 'string' &&
            codePointLength(value) >= min &&
            codePointLength(value) <= max
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} 长度须为 ${min}~${max} 个字符`;
        },
      },
    });
  };
}
