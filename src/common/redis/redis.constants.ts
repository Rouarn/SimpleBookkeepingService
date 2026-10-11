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
  /** 统计用全量字典（含停用项，历史统计可追溯）：与启用态字典分开短缓存 */
  dictCategoriesAll: (type: string): string => `bk:dict:categories:all:${type}`,
  dictPayMethodsAll: 'bk:dict:pay-methods:all',
  /**
   * 统计聚合缓存（仅已结束期间）：slot=overview/categories/payMethods/trend，
   * bookScope=账本 id 或 all，period=YYYY-MM 或 YYYY；
   * overview/categories 结果随 type 维度变化，以 variant 区分。
   */
  stat: (
    slot: string,
    userId: string,
    bookScope: string,
    period: string,
    variant?: string,
  ): string =>
    variant
      ? `bk:stat:${slot}:${userId}:${bookScope}:${variant}:${period}`
      : `bk:stat:${slot}:${userId}:${bookScope}:${period}`,
  /** 某用户全部统计缓存（SCAN 失效用） */
  statPatternUser: (userId: string): string => `bk:stat:*:${userId}:*`,
  /** 删除账单/替换头像后文件的 7 天保留墓碑（ZSET：member=key, score=删除时刻 unix） */
  tombstoneBills: 'bk:cleanup:tombstone:bills',
  tombstoneAvatars: 'bk:cleanup:tombstone:avatars',
  /** 定时任务分布式锁（P1-20）：value 为 owner token，Lua 比对后原子释放 */
  cronLock: (job: string): string => `bk:lock:${job}`,
} as const;
