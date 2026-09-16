import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { BusinessException } from '../exceptions/business.exception.js';
import { ERROR_CODES } from '../exceptions/error-codes.js';
import { getTraceId } from '../context/trace.context.js';
import { formatTimestamp } from '../utils/date.util.js';

interface ErrorBody {
  code: number;
  message: string;
  data: null;
  details?: unknown;
}

/**
 * 框架层（非业务）状态码补充。文档错误码表面向业务语义，
 * 这里的码仅用于未匹配路由 / 方法不允许等 NestJS 自身抛出的场景，
 * 避免把「Cannot POST /xxx」误报成 40400「账单不存在」。
 */
const FRAMEWORK_CODES = {
  ROUTE_NOT_FOUND: 40404,
  METHOD_NOT_ALLOWED: 40405,
  UNSUPPORTED_MEDIA_TYPE: 40415,
  SERVICE_UNAVAILABLE: 50303,
} as const;

/**
 * 全局异常归一化（03 §4）：任何未捕获错误都输出统一错误信封，不泄漏堆栈/SQL。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // /health 失败保持 Terminus 原始探针响应（503 + 指标详情）
    if (
      (request.url ?? '').split('?')[0] === '/health' &&
      exception instanceof HttpException
    ) {
      response
        .status(exception.getStatus())
        .json(exception.getResponse() as Record<string, unknown>);
      return;
    }

    const body = this.resolveBody(exception, request);
    const httpStatus = this.resolveHttpStatus(exception, body.code);

    if (httpStatus >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} -> ${httpStatus}/${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(httpStatus).json({
      code: body.code,
      message: body.message,
      data: null,
      ...(body.details !== undefined ? { details: body.details } : {}),
      traceId: getTraceId() || this.fallbackTraceId(request),
      timestamp: formatTimestamp(),
    });
  }

  private resolveBody(exception: unknown, request: Request): ErrorBody {
    // 业务异常（已携带精确 code 与文案）
    if (exception instanceof BusinessException) {
      const payload = exception.getResponse() as {
        code: number;
        message: string;
        data: null;
        details?: unknown;
      };
      return {
        code: payload.code,
        message: payload.message,
        data: null,
        ...(payload.details !== undefined ? { details: payload.details } : {}),
      };
    }

    // Multer 文件上传错误（超限/缺文件）按参数错误处理
    if (this.isMulterError(exception)) {
      const multerMessage =
        (exception as { code?: string }).code === 'LIMIT_FILE_SIZE'
          ? '文件大小超出限制'
          : '文件上传参数不合法';
      return {
        code: ERROR_CODES.PARAM_INVALID.code,
        message: multerMessage,
        data: null,
      };
    }

    // 框架 HTTP 异常
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const responsePayload = exception.getResponse();

      if (typeof responsePayload === 'object' && responsePayload !== null) {
        const payload = responsePayload as Record<string, unknown>;
        if (typeof payload.code === 'number') {
          const message =
            typeof payload.message === 'string' && payload.message.length > 0
              ? payload.message
              : ERROR_CODES.PARAM_INVALID.message;
          return {
            code: payload.code,
            message,
            data: null,
            ...(payload.details !== undefined
              ? { details: payload.details }
              : {}),
          };
        }
      }

      return {
        code: this.httpStatusToBizCode(status),
        message: this.httpStatusToMessage(status, responsePayload),
        data: null,
      };
    }

    // 未知错误：不对外暴露内部信息
    this.logger.error(
      `未处理异常 ${request.method} ${request.originalUrl}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      code: ERROR_CODES.INTERNAL_ERROR.code,
      message: ERROR_CODES.INTERNAL_ERROR.message,
      data: null,
    };
  }

  private resolveHttpStatus(exception: unknown, bizCode: number): number {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (typeof status === 'number') return status;
    }
    const meta = Object.values(ERROR_CODES).find(
      (item) => item.code === bizCode,
    );
    return meta?.httpStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private httpStatusToBizCode(status: number): number {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.PARAM_INVALID.code;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHORIZED.code;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.ACCOUNT_FROZEN.code;
      case HttpStatus.NOT_FOUND:
        return FRAMEWORK_CODES.ROUTE_NOT_FOUND;
      case HttpStatus.METHOD_NOT_ALLOWED:
        return FRAMEWORK_CODES.METHOD_NOT_ALLOWED;
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return FRAMEWORK_CODES.UNSUPPORTED_MEDIA_TYPE;
      case HttpStatus.CONFLICT:
        return ERROR_CODES.CONFLICT.code;
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return ERROR_CODES.CATEGORY_INVALID.code;
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED.code;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return FRAMEWORK_CODES.SERVICE_UNAVAILABLE;
      default:
        return ERROR_CODES.INTERNAL_ERROR.code;
    }
  }

  private httpStatusToMessage(status: number, payload: unknown): string {
    if (typeof payload === 'string' && payload.length > 0) return payload;
    if (typeof payload === 'object' && payload !== null) {
      const message = (payload as { message?: unknown }).message;
      if (typeof message === 'string' && message.length > 0) return message;
    }
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ERROR_CODES.PARAM_INVALID.message;
      case HttpStatus.UNAUTHORIZED:
        return ERROR_CODES.UNAUTHORIZED.message;
      case HttpStatus.FORBIDDEN:
        return ERROR_CODES.ACCOUNT_FROZEN.message;
      case HttpStatus.NOT_FOUND:
        return '接口不存在';
      case HttpStatus.METHOD_NOT_ALLOWED:
        return '请求方法不被允许';
      case HttpStatus.UNSUPPORTED_MEDIA_TYPE:
        return '不支持的媒体类型';
      case HttpStatus.TOO_MANY_REQUESTS:
        return ERROR_CODES.RATE_LIMITED.message;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return '服务暂不可用';
      default:
        return ERROR_CODES.INTERNAL_ERROR.message;
    }
  }

  private isMulterError(exception: unknown): boolean {
    return (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { name?: string }).name === 'MulterError'
    );
  }

  private fallbackTraceId(request: Request): string {
    const header = request.headers['x-request-id'];
    const value = Array.isArray(header) ? header[0] : header;
    return value && /^[a-f0-9]{32}$/i.test(value)
      ? value.toLowerCase()
      : randomBytes(16).toString('hex');
  }
}
