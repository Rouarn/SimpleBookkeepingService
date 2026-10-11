/**
 * 业务错误码常量表（03 §4.2，与文档同步；一经发布只增不改不复用）。
 * 结构：code → 默认 HTTP 状态码与文案。
 */
import { HttpStatus } from '@nestjs/common';

export interface ErrorCodeMeta {
  code: number;
  httpStatus: number;
  message: string;
}

export const ERROR_CODES = {
  SUCCESS: { code: 0, httpStatus: HttpStatus.OK, message: 'ok' },

  PARAM_INVALID: {
    code: 40000,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '参数校验失败',
  },
  AMOUNT_INVALID: {
    code: 40001,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '金额必须大于 0',
  },
  REMARK_TOO_LONG: {
    code: 40002,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '备注超过 50 字',
  },
  PHOTOS_TOO_MANY: {
    code: 40003,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '凭证图片超过 3 张',
  },
  DATETIME_INVALID: {
    code: 40004,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '日期/时间格式非法',
  },

  NAME_INVALID: {
    code: 40010,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '名称不能为空或超长',
  },
  BUDGET_NEGATIVE: {
    code: 40011,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '预算不能为负',
  },
  PASSWORD_INCORRECT: {
    code: 40012,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '旧密码不正确',
  },

  BOOK_NOT_EMPTY: {
    code: 40020,
    httpStatus: HttpStatus.CONFLICT,
    message: '账本非空，禁止删除',
  },
  DEFAULT_BOOK_PROTECTED: {
    code: 40021,
    httpStatus: HttpStatus.BAD_REQUEST,
    message: '默认账本不可删除',
  },
  MIGRATE_TARGET_INVALID: {
    code: 40022,
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    message: '迁移目标账本不存在或不属于当前用户',
  },

  UNAUTHORIZED: {
    code: 40100,
    httpStatus: HttpStatus.UNAUTHORIZED,
    message: '未登录或登录已失效',
  },
  ACCESS_TOKEN_EXPIRED: {
    code: 40101,
    httpStatus: HttpStatus.UNAUTHORIZED,
    message: 'access token 已过期',
  },
  REFRESH_TOKEN_INVALID: {
    code: 40102,
    httpStatus: HttpStatus.UNAUTHORIZED,
    message: 'refresh token 无效或已失效',
  },
  LOGIN_TOO_MANY: {
    code: 40103,
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    message: '登录尝试过多，请稍后再试',
  },

  ACCOUNT_FROZEN: {
    code: 40300,
    httpStatus: HttpStatus.FORBIDDEN,
    message: '账号已冻结',
  },

  BILL_NOT_FOUND: {
    code: 40400,
    httpStatus: HttpStatus.NOT_FOUND,
    message: '账单不存在',
  },
  BOOK_NOT_FOUND: {
    code: 40401,
    httpStatus: HttpStatus.NOT_FOUND,
    message: '账本不存在',
  },

  CATEGORY_INVALID: {
    code: 42200,
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    message: '分类不存在或与收支类型不匹配',
  },
  PAY_METHOD_INVALID: {
    code: 42201,
    httpStatus: HttpStatus.UNPROCESSABLE_ENTITY,
    message: '支付方式不存在或已停用',
  },

  RATE_LIMITED: {
    code: 42900,
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    message: '请求过于频繁',
  },
  UPLOAD_RATE_LIMITED: {
    code: 42901,
    httpStatus: HttpStatus.TOO_MANY_REQUESTS,
    message: '上传过于频繁，请稍后再试',
  },

  INTERNAL_ERROR: {
    code: 50000,
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '服务繁忙，请稍后重试',
  },
  DATABASE_UNAVAILABLE: {
    code: 50001,
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '数据库暂不可用',
  },
  STORAGE_UNAVAILABLE: {
    code: 50002,
    httpStatus: HttpStatus.INTERNAL_SERVER_ERROR,
    message: '文件存储不可用',
  },

  CONFLICT: {
    code: 40900,
    httpStatus: HttpStatus.CONFLICT,
    message: '资源状态冲突',
  },
} satisfies Record<string, ErrorCodeMeta>;

export type ErrorCodeKey = keyof typeof ERROR_CODES;
