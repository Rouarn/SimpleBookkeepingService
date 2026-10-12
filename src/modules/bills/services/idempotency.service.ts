import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

/** 处理标记 TTL：处理异常/进程崩溃时最多占用 10 分钟。 */
const LOCK_TTL_SECONDS = 10 * 60;
/** 已提交结果 TTL：24h 内同 key 重放返回已有账单。 */
const RESULT_TTL_SECONDS = 24 * 60 * 60;

/** Redis 幂等记录：处理中 committed=false（billId 为空串占位），提交后 committed=true。 */
export interface IdempotencyRecord {
  billId: string;
  fingerprint: string;
  committed: boolean;
}

/** 成功结果只缓存账单 id；重放时实时查库并重新签发图片 URL（签名仅 12h，缓存 24h）。 */
export interface CommittedBillResult {
  billId: string;
}

/** 请求体规范化：对象 key 递归排序后 stringify，数组保持原始顺序（顺序语义不同则指纹不同）。 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(
      ([key, val]) => [key, canonicalize(val)] as const,
    );
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries);
  }
  return value;
}

/** 幂等指纹：sha256(规范化请求体 JSON)，用于识别同 key 携带不同请求体的重试。 */
export function computeIdempotencyFingerprint(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

/**
 * Idempotency-Key 防重复提交（04b §6）：
 * 幂等值结构 { billId, fingerprint, committed }，提交标记与处理锁合一：
 * 同用户同 key：指纹不一致 → 409（防不同请求体静默重放旧账单）；
 * 处理中（committed=false）→ 409；已提交（committed=true）→ 返回 billId 由调用方重放；
 * 首次 → 写 committed=false 处理标记后执行，事务提交后再置 committed=true。
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** 返回已提交的账单 id；null 表示首次请求（已写入处理标记）。 */
  async beginOrReplay(
    userId: string,
    key: string | undefined,
    fingerprint: string,
  ): Promise<CommittedBillResult | null> {
    if (!key) return null;
    const redisKey = REDIS_KEYS.idempotency(userId, key);
    const record = await this.readRecord(redisKey);
    if (record !== null) return this.resolveRecord(record, fingerprint);

    const created = await this.redis.set(
      redisKey,
      JSON.stringify({
        billId: '',
        fingerprint,
        committed: false,
      } satisfies IdempotencyRecord),
      'EX',
      LOCK_TTL_SECONDS,
      'NX',
    );
    if (created !== null) return null;

    // 抢锁失败：并发请求抢先写入，重读一次以区分指纹冲突/已提交/处理中
    const raced = await this.readRecord(redisKey);
    if (raced !== null) return this.resolveRecord(raced, fingerprint);
    this.throwProcessing();
  }

  /** 事务成功提交后调用：落 committed=true 与 billId，作为后续重放凭据（结果 TTL）。 */
  async markCommitted(
    userId: string,
    key: string | undefined,
    fingerprint: string,
    billId: string,
  ): Promise<void> {
    if (!key) return;
    const record: IdempotencyRecord = { billId, fingerprint, committed: true };
    await this.redis.set(
      REDIS_KEYS.idempotency(userId, key),
      JSON.stringify(record),
      'EX',
      RESULT_TTL_SECONDS,
    );
  }

  /** 处理异常时调用：仅清理未提交的处理标记；已 committed 的 key 永不删除，重试时重放已有账单。 */
  async fail(userId: string, key: string | undefined): Promise<void> {
    if (!key) return;
    const redisKey = REDIS_KEYS.idempotency(userId, key);
    const record = await this.readRecord(redisKey);
    if (record === null || record.committed) return;
    await this.redis.del(redisKey);
  }

  /**
   * 读取并解析幂等记录；值损坏（非法 JSON）时删除该 key 并视为无缓存，
   * 按首次请求重新处理，不让脏值演变为 500。
   */
  private async readRecord(
    redisKey: string,
  ): Promise<IdempotencyRecord | null> {
    const raw = await this.redis.get(redisKey);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as IdempotencyRecord;
    } catch {
      await this.redis.del(redisKey);
      return null;
    }
  }

  /** 分流已有记录：指纹不匹配/处理中抛 409，已提交返回重放结果。 */
  private resolveRecord(
    record: IdempotencyRecord,
    fingerprint: string,
  ): CommittedBillResult {
    // 旧结构值（无 fingerprint 字段）同样按指纹不匹配处理，不做向后兼容
    if (record.fingerprint !== fingerprint) this.throwFingerprintMismatch();
    if (!record.committed) this.throwProcessing();
    return { billId: record.billId };
  }

  private throwProcessing(): never {
    throw new BusinessException(
      ERROR_CODES.CONFLICT.code,
      ERROR_CODES.CONFLICT.httpStatus,
      '请求正在处理中，请勿重复提交',
    );
  }

  private throwFingerprintMismatch(): never {
    throw new BusinessException(
      ERROR_CODES.CONFLICT.code,
      ERROR_CODES.CONFLICT.httpStatus,
      '幂等键冲突：该 Idempotency-Key 已被用于不同的请求体',
    );
  }
}
