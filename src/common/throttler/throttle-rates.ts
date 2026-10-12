/**
 * 限流档位定义（03 §7）。ttl 单位毫秒；limit 为窗口内最大次数。
 */
export const THROTTLE_NAMES = {
  DEFAULT: 'default',
  LOGIN_IP: 'login-ip',
  REGISTER: 'register',
  REFRESH: 'refresh',
  BILL_WRITE: 'bill-write',
  BILL_DELETE: 'bill-delete',
  UPLOAD: 'upload',
  EXPORT: 'export',
} as const;

export const THROTTLE_RATES = {
  /** 全局兜底 120 次/分钟 */
  [THROTTLE_NAMES.DEFAULT]: { ttl: 60_000, limit: 120 },
  /** 登录同 IP 20 次/15 分钟（同手机号 5 次/15 分钟由 AuthService Redis 计数实现，40103） */
  [THROTTLE_NAMES.LOGIN_IP]: { ttl: 15 * 60_000, limit: 20 },
  /** 注册同 IP 3 次/小时 */
  [THROTTLE_NAMES.REGISTER]: { ttl: 60 * 60_000, limit: 3 },
  /** 刷新 30 次/分钟 */
  [THROTTLE_NAMES.REFRESH]: { ttl: 60_000, limit: 30 },
  /** 账单写入 30 次/分钟 */
  [THROTTLE_NAMES.BILL_WRITE]: { ttl: 60_000, limit: 30 },
  /** 账单删除 20 次/分钟 */
  [THROTTLE_NAMES.BILL_DELETE]: { ttl: 60_000, limit: 20 },
  /** 图片上传 20 次/10 分钟（42901） */
  [THROTTLE_NAMES.UPLOAD]: { ttl: 10 * 60_000, limit: 20 },
  /** 账单数据导出 6 次/小时（CSV 全量流式，防高频大查询） */
  [THROTTLE_NAMES.EXPORT]: { ttl: 60 * 60_000, limit: 6 },
} as const;
