/** ioredis 客户端注入令牌。 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/** Redis key 命名空间统一前缀（限流/缓存/登录计数/幂等）。 */
export const REDIS_KEYS = {
  throttle: (name: string, key: string): string => `bk:throttle:${name}:${key}`,
  loginFailPhone: (phone: string): string => `bk:login-fail:phone:${phone}`,
  loginFailIp: (ip: string): string => `bk:login-fail:ip:${ip}`,
  idempotency: (userId: string, key: string): string =>
    `bk:idem:${userId}:${key}`,
  dictCategories: (type: string): string => `bk:dict:categories:${type}`,
  dictPayMethods: 'bk:dict:pay-methods',
  /** 删除账单/替换头像后文件的 7 天保留墓碑（ZSET：member=key, score=删除时刻 unix） */
  tombstoneBills: 'bk:cleanup:tombstone:bills',
  tombstoneAvatars: 'bk:cleanup:tombstone:avatars',
} as const;
