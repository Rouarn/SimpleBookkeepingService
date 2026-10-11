import {
  type CallHandler,
  type ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomBytes } from 'node:crypto';
import type { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs';
import type { AuthUser } from '../decorators/current-user.decorator.js';
import { requestContext } from '../context/trace.context.js';

interface RequestWithMeta {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: AuthUser;
}

/** 未登录（40100）/token 过期（40101）：探测流量不落审计 */
const SKIP_BIZ_CODES = new Set([40100, 40101]);

/**
 * 最外层拦截器（05 §4）：
 * 1. 生成/透传 traceId（X-Request-Id，32 位 hex），响应头原样回传；
 * 2. 经 AsyncLocalStorage 在整条调用链透传；
 * 3. 结束后异步落 operation_logs 审计（只记元数据，不记请求/响应体，失败仅告警）。
 *    审计瘦身（防写放大与审计表被恶意灌爆）：签名图片 GET（全站最高频端点）、
 *    429 限流、401/40100/40101 未登录探测、OPTIONS 预检不落库。
 *    归档建议：审计表定期归档，线上仅保留 90 天。
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('LoggingInterceptor');

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithMeta & { url?: string }>();
    const response = http.getResponse<{
      setHeader: (k: string, v: string) => void;
      statusCode: number;
    }>();

    // 存活探针高频（5s/次）：不落 operation_logs，也不生成 trace
    if ((request.url ?? '').split('?')[0] === '/health') {
      return next.handle();
    }

    const headerRequestId = request.headers['x-request-id'];
    const requestId = Array.isArray(headerRequestId)
      ? headerRequestId[0]
      : headerRequestId;
    const traceId =
      requestId && /^[a-f0-9]{32}$/i.test(requestId)
        ? requestId.toLowerCase()
        : randomBytes(16).toString('hex');
    response.setHeader('X-Request-Id', traceId);

    const start = Date.now();
    let bizCode = 0;
    // finalize 早于异常过滤器执行，此时 response.statusCode 还是方法默认码
    // （GET=200/POST=201），失败状态必须在错误传播当下自行捕获
    let resolvedStatus = response.statusCode;

    return requestContext.run({ traceId }, () =>
      next.handle().pipe(
        tap({
          error: (error: unknown) => {
            if (error instanceof HttpException) {
              resolvedStatus = error.getStatus();
              const body = error.getResponse();
              if (typeof body === 'object' && body !== null && 'code' in body) {
                bizCode = Number((body as { code: unknown }).code);
              }
            } else {
              resolvedStatus = 500;
            }
          },
        }),
        finalize(() => {
          const costMs = Date.now() - start;
          const userId = request.user?.id ?? null;
          const method = context
            .switchToHttp()
            .getRequest<{ method: string }>().method;
          // 只落 path 不落 query：避免 /files 签名 URL 的 sign 等敏感参数进审计（07 §8.5）
          const fullPath =
            context
              .switchToHttp()
              .getRequest<{ originalUrl?: string; url?: string }>()
              .originalUrl ?? '';
          const path = fullPath.split('?')[0];
          const httpStatus = resolvedStatus;

          // 审计瘦身：高频/无价值流量不落 operation_logs，其余保持原逻辑。
          // resolvedStatus/bizCode 已在 tap error 中捕获，finalize 阶段可信；
          // 401 同时覆盖业务码（40100/40101）与裸 HTTP 401（如守卫直接拒绝）。
          if (
            method === 'OPTIONS' ||
            (method === 'GET' && path.startsWith('/api/v1/files/')) ||
            httpStatus === 429 ||
            httpStatus === 401 ||
            SKIP_BIZ_CODES.has(bizCode)
          ) {
            return;
          }

          const userAgentHeader = request.headers['user-agent'];
          const userAgent =
            (Array.isArray(userAgentHeader)
              ? userAgentHeader[0]
              : userAgentHeader) ?? '';
          const ip = request.ip ?? '';

          this.dataSource
            .query(
              `INSERT INTO operation_logs (user_id, method, path, http_status, biz_code, ip, user_agent, trace_id, cost_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                userId,
                method,
                path.slice(0, 255),
                httpStatus,
                bizCode,
                ip.slice(0, 45),
                userAgent.slice(0, 255),
                traceId,
                costMs,
              ],
            )
            .catch((error: unknown) => {
              // 审计失败只告警不抛出，不影响主流程（06 §5.3）
              this.logger.warn(`审计日志写入失败: ${(error as Error).message}`);
            });
        }),
      ),
    );
  }
}
