import { type PipeTransform, Injectable } from '@nestjs/common';
import { BusinessException } from '../exceptions/business.exception.js';
import { ERROR_CODES } from '../exceptions/error-codes.js';

const ID_PATTERN = /^\d{1,19}$/;

/**
 * 路径参数 ID 校验（BIGINT 字符串，02 §2.1）。
 * 非法 id（字母/小数/负数/0/超 19 位）直接 40000，不进入查询。
 */
@Injectable()
export class BigIntIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !ID_PATTERN.test(value) || value === '0') {
      throw new BusinessException(
        ERROR_CODES.PARAM_INVALID.code,
        ERROR_CODES.PARAM_INVALID.httpStatus,
        '资源 id 非法',
      );
    }
    return value;
  }
}
