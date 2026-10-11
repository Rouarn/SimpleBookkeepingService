/**
 * 客户端 X-Request-Id 可信透传规则（P2-11）。
 * 仅允许来自内网可信代理（10/8、172.16-31/12、192.168/16、127/8）
 * 且形态为 8~64 位字母/数字/下划线/短横线的值透传到 traceId，
 * 公网请求一律由服务端生成，防止伪造 traceId 污染审计与日志关联。
 * 前提：main.ts 已按 TRUST_PROXY_HOPS 设置 Express trust proxy，req.ip 可信。
 */

/** 可信 X-Request-Id 形态：8~64 位，字母数字与 _-，杜绝换行/空格/注入字符 */
export const TRUSTED_REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/**
 * 判断 req.ip 是否属于内网可信网段。
 * 兼容 Node 常见的 IPv4 映射地址（::ffff:a.b.c.d）与 IPv6 回环 ::1。
 */
export function isInternalIp(ip: string | undefined): boolean {
  if (!ip) return false;
  let value = ip.trim().toLowerCase();
  if (value.startsWith('::ffff:')) value = value.slice('::ffff:'.length);
  if (value === '::1') return true;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return (
    first === 10 || // 10.0.0.0/8
    (first === 172 && second >= 16 && second <= 31) || // 172.16.0.0/12
    (first === 192 && second === 168) || // 192.168.0.0/16
    first === 127 // 127.0.0.0/8
  );
}

/**
 * 判定客户端 X-Request-Id 是否可透传：
 * 来源为内网可信代理且值形态合法才返回原值，否则返回 null（调用方自行生成）。
 */
export function pickTrustedRequestId(
  headerValue: string | string[] | undefined,
  ip: string | undefined,
): string | null {
  const value = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (
    typeof value === 'string' &&
    TRUSTED_REQUEST_ID_PATTERN.test(value) &&
    isInternalIp(ip)
  ) {
    return value;
  }
  return null;
}
