import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextStore {
  traceId: string;
  userId?: string;
}

/**
 * 请求级上下文（06 §5.2）：traceId/userId 经 AsyncLocalStorage 在
 * Guard/Interceptor/Service/审计写入之间透传。
 */
export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getTraceId(): string {
  return requestContext.getStore()?.traceId ?? '';
}
