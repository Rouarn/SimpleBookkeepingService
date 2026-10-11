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
import { pickTrustedRequestId } from '../constants/request-id.js';

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

    // P2-10：readiness 失败对外只回静态 {status:'error'}，不泄露内网地址/端口等拓扑；
    // 完整探针细节（含 127.0.0.1:6379 等）仅写服务端日志。liveness 为静态响应不会走到这里。
    if (
      (request.url ?? '').split('?')[0] === '/health/ready' &&
      exception instanceof HttpException
    ) {
      this.logger.error(
        `readiness 探针失败 ${exception.getStatus()}: ${this.safeStringify(exception.getResponse())}`,
      );
      response.status(exception.getStatus()).json({ status: 'error' });
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
        // P2-11：账号冻结由 BusinessException(40300) 先走业务分支；
        // 落到这里的裸 ForbiddenException 是其他权限问题，不再误报「账号已冻结」
        return ERROR_CODES.FORBIDDEN_OPERATION.code;
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
        return ERROR_CODES.FORBIDDEN_OPERATION.message;
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

  /**
   * 兜底 traceId（守卫在拦截器之前抛错时 ALS 内尚无 traceId）：
   * P2-11 仅信任内网代理（req.ip 属 10/8、172.16-31/12、192.168/16、127/8）
   * 传入且形态合法（8~64 位字母数字/_-）的 X-Request-Id，否则服务端生成，
   * 避免公网客户端伪造 traceId 污染审计/日志关联。
   */
  private fallbackTraceId(request: Request): string {
    // P2-11：仅内网可信代理传入且形态合法的 X-Request-Id 才透传，否则服务端生成
    return (
      pickTrustedRequestId(request.headers['x-request-id'], request.ip) ??
      randomBytes(16).toString('hex')
    );
  }

  /** 探针细节安全序列化：只用于服务端日志，长度截断防日志注入/放大。 */
  private safeStringify(payload: unknown): string {
    try {
      const text = JSON.stringify(payload);
      return text.length <= 1000 ? text : `${text.slice(0, 1000)}...(截断)`;
    } catch {
      return '[无法序列化的探针错误详情]';
    }
  }
}
