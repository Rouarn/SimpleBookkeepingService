import { HttpException } from '@nestjs/common';

/** 统一业务异常（05 §3.2）：code 精确表达原因，httpStatus 表达大类。 */
export class BusinessException extends HttpException {
  readonly bizCode: number;
  readonly bizDetails?: unknown;

  constructor(
    code: number,
    httpStatus: number,
    message: string,
    details?: unknown,
  ) {
    super({ code, message, data: null, details }, httpStatus);
    this.bizCode = code;
    this.bizDetails = details;
  }
}

/** 字段级校验细节（03 §4.3 details） */
export interface FieldValidationDetail {
  field: string;
  value?: unknown;
  reason: string;
}
