import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import {
  buildPaginationMeta,
  type PaginationMeta,
} from '../../common/dto/pagination.dto.js';
import { REDIS_CLIENT } from '../../common/redis/redis.constants.js';
import { toMessageVo, type MessageVo } from './vo/message.vo.js';

/** 同用户消息软上限：超出删除最旧（消息中心非无限存储，05 §3 资源约束） */
const SOFT_LIMIT = 200;
/** 超预算提醒幂等键 TTL：32 天覆盖任意自然月并留余量 */
export const BUDGET_DEDUPE_TTL_SECONDS = 32 * 24 * 60 * 60;

interface CountRow {
  cnt: string | number;
}

/**
 * 消息中心服务：append 由各主流程调用（超预算/安全告警/月报），
 * 写失败仅告警不抛出——调用方均为主流程，消息属旁路增强能力。
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger('MessagesService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * 追加一条站内消息（尽力而为）：
   * - dedupeKey 提供时先 Redis SET NX EX 抢幂等（抢不到说明当期已发过，直接跳过；
   *   Redis 异常降级为不幂等，宁重复不丢消息）；
   * - 插入后做软上限回收：仅保留最新 200 条；
   * - 任何失败仅 logger.warn，绝不向主流程抛错。
   */
  async append(
    userId: string,
    type: MessageVo['type'],
    title: string,
    content: string,
    payload?: unknown,
    dedupeKey?: string,
  ): Promise<void> {
    try {
      if (dedupeKey) {
        let acquired: 'OK' | null;
        try {
          acquired = await this.redis.set(
            dedupeKey,
            '1',
            'EX',
            BUDGET_DEDUPE_TTL_SECONDS,
            'NX',
          );
        } catch (error) {
          this.logger.warn(
            `消息幂等键写入失败（降级为不幂等）: ${(error as Error).message}`,
          );
          acquired = 'OK';
        }
        if (acquired !== 'OK') return;
      }
      await this.dataSource.query(
        `INSERT INTO messages (user_id, type, title, content, payload)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, type, title, content, payload ? JSON.stringify(payload) : null],
      );
      // 软上限：多表 DELETE 一次性清掉最新 200 条之外的旧消息
      await this.dataSource.query(
        `DELETE m FROM messages m
         LEFT JOIN (
           SELECT id FROM messages WHERE user_id = ?
           ORDER BY id DESC LIMIT ${SOFT_LIMIT}
         ) keep ON keep.id = m.id
         WHERE m.user_id = ? AND keep.id IS NULL`,
        [userId, userId],
      );
    } catch (error) {
      this.logger.warn(
        `写入站内消息失败 userId=${userId} type=${type}: ${(error as Error).message}`,
      );
    }
  }

  /** 分页列表：created_at 倒序（等价 id 倒序，主键序即写入序）。 */
  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ items: MessageVo[]; pagination: PaginationMeta }> {
    const countRows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM messages WHERE user_id = ?',
      [userId],
    );
    const total = Number(countRows[0]?.cnt ?? 0);

    const rows = await this.dataSource.query<
      Array<{
        id: string | number;
        type: MessageVo['type'];
        title: string;
        content: string;
        payload: unknown;
        is_read: number | string;
        read_at: Date | string | null;
        created_at: Date | string;
      }>
    >(
      `SELECT id, type, title, content, payload, is_read, read_at, created_at
         FROM messages
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ? OFFSET ?`,
      [userId, pageSize, (page - 1) * pageSize],
    );

    return {
      items: rows.map(toMessageVo),
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  /** 未读数（首页聚合与消息中心角标共用）。 */
  async unreadCount(userId: string): Promise<number> {
    const rows = await this.dataSource.query<CountRow[]>(
      'SELECT COUNT(*) AS cnt FROM messages WHERE user_id = ? AND is_read = 0',
      [userId],
    );
    return Number(rows[0]?.cnt ?? 0);
  }

  /** 标记已读：ids 指定或 all 全量；已读消息幂等跳过。 */
  async markRead(
    userId: string,
    target: { ids?: number[]; all?: boolean },
  ): Promise<{ updated: number }> {
    const result =
      target.all === true
        ? await this.dataSource.query(
            'UPDATE messages SET is_read = 1, read_at = NOW(3) WHERE user_id = ? AND is_read = 0',
            [userId],
          )
        : await this.dataSource.query(
            `UPDATE messages SET is_read = 1, read_at = NOW(3)
              WHERE user_id = ? AND is_read = 0
                AND id IN (${target.ids!.map(() => '?').join(',')})`,
            [userId, ...target.ids!],
          );
    return {
      updated: Number((result as { affectedRows?: number }).affectedRows ?? 0),
    };
  }
}
