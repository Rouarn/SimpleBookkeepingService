import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { getTraceId } from '../context/trace.context.js';
import { formatTimestamp } from '../utils/date.util.js';

/**
 * 最内层拦截器：成功响应统一包裹（03 §3.1）
 * { code:0, message:'ok', data, traceId, timestamp }。
 * bigint 统一序列化为字符串（02 §2.1 注），StreamableFile 原样透传。
 */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // /health 保持 Terminus 原始探针格式，不走业务信封
    const request = context.switchToHttp().getRequest<IncomingMessage>();
    if ((request.url ?? '').split('?')[0] === '/health') {
      return next.handle();
    }
    return next.handle().pipe(
      map((data) => {
        if (data instanceof StreamableFile) return data;
        return {
          code: 0,
          message: 'ok',
          data: serialize(data),
          traceId: getTraceId(),
          timestamp: formatTimestamp(),
        };
      }),
    );
  }
}

/** 递归将 bigint 转为字符串；undefined（void 处理器）归一为 null（03 §3.1 data 恒存在）。 */
function serialize(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result[key] = serialize(item);
    }
    return result;
  }
  return value;
}
