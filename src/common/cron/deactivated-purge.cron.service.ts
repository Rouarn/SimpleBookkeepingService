import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { unlink } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { AppConfig } from '../../config/configuration.js';
import { REDIS_CLIENT, REDIS_KEYS } from '../redis/redis.constants.js';
import { CronLockService } from './cron-lock.service.js';
import { StorageService } from '../../modules/files/services/storage.service.js';

/** 单批删除/扫描行数：小批量循环避免长事务/大范围锁表 */
const BATCH_SIZE = 1000;
/** 每批注销用户数：id 游标分批遍历 */
const USER_BATCH_SIZE = 500;
/** 批间小睡，给主从复制与业务写入让路 */
const BATCH_SLEEP_MS = 50;
/** 选主锁 TTL 兜底（P1-20）：按全量注销用户清理的预估时长放宽到 30 分钟 */
const LOCK_TTL_SECONDS = 30 * 60;
/** bill_photos.url 合法形态（与 storage KEY_PATTERN 口径一致，防目录穿越拼路径） */
const PHOTO_KEY_PATTERN = /^(bills|avatars)\//;

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/**
 * 注销账号保留期清理（每日 03:40）：status=2 且注销满保留期（默认 30 天，
 * USER_DEACTIVATION_RETENTION_DAYS）的用户，逐用户分批回收业务数据：
 * bill_photos 行 → bills → books → messages；照片文件按 url 拼上传目录
 * unlink（缺省忽略错误），删除前对每个 url 登记墓碑 ZSET（与 files 模块
 * 的 bk:cleanup:tombstone:bills 读取逻辑一致，误删可追溯）。
 * 分类/支付方式字典表（categories/pay_methods）为全局共享、无 user_id
 * 用户级字段，注销无需清理。users 行保留作匿名审计。
 * 幂等：删除顺序天然支持重复执行——bills/books 清空后即无可清理对象。
 */
@Injectable()
export class DeactivatedPurgeCronService {
  private readonly logger = new Logger('DeactivatedPurgeCronService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly cronLock: CronLockService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  @Cron('40 3 * * *', { name: 'deactivated-purge' })
  async purgeDeactivated(): Promise<void> {
    await this.cronLock.runWithLock(
      'deactivated-purge',
      LOCK_TTL_SECONDS,
      async () => {
        try {
          const retentionDays =
            this.configService.get<AppConfig['userDeactivation']>(
              'userDeactivation',
            )!.retentionDays;

          let cursor = '0';
          let purged = 0;
          for (;;) {
            const rows = await this.dataSource.query<Array<{ id: string }>>(
              `SELECT id FROM users
                WHERE status = 2
                  AND deactivated_at IS NOT NULL
                  AND deactivated_at < DATE_SUB(NOW(3), INTERVAL ? DAY)
                  AND id > ?
                ORDER BY id ASC
                LIMIT ${USER_BATCH_SIZE}`,
              [retentionDays, cursor],
            );
            if (rows.length === 0) break;
            for (const row of rows) {
              cursor = String(row.id);
              await this.purgeUser(cursor);
              purged += 1;
            }
            if (rows.length < USER_BATCH_SIZE) break;
          }
          if (purged > 0) {
            this.logger.log(`注销账号清理完成：${purged} 个用户`);
          }
        } catch (error) {
          this.logger.error(
            `注销账号清理任务失败: ${(error as Error).message}`,
          );
        }
      },
    );
  }

  /** 单用户清理：照片行+文件 → 账单 → 账本 → 消息；重复执行无副作用。 */
  private async purgeUser(userId: string): Promise<void> {
    await this.purgeBillPhotos(userId);

    for (;;) {
      const result = await this.dataSource.query(
        'DELETE FROM bills WHERE user_id = ? LIMIT ?',
        [userId, BATCH_SIZE],
      );
      if (
        Number((result as { affectedRows?: number }).affectedRows ?? 0) <
        BATCH_SIZE
      )
        break;
      await sleep(BATCH_SLEEP_MS);
    }
    for (;;) {
      const result = await this.dataSource.query(
        'DELETE FROM books WHERE user_id = ? LIMIT ?',
        [userId, BATCH_SIZE],
      );
      if (
        Number((result as { affectedRows?: number }).affectedRows ?? 0) <
        BATCH_SIZE
      )
        break;
      await sleep(BATCH_SLEEP_MS);
    }
    for (;;) {
      const result = await this.dataSource.query(
        'DELETE FROM messages WHERE user_id = ? LIMIT ?',
        [userId, BATCH_SIZE],
      );
      if (
        Number((result as { affectedRows?: number }).affectedRows ?? 0) <
        BATCH_SIZE
      )
        break;
      await sleep(BATCH_SLEEP_MS);
    }
  }

  /**
   * 凭证照片清理：按 id 游标分批「墓碑登记 → 删行 → 删文件」。
   * 墓碑在删除行之前写入（与 fix-orphan-bill-photos.mjs 的 ZADD score=当前秒
   * 口径一致），文件 unlink 缺省忽略错误（已不存在等价于目标态）。
   */
  private async purgeBillPhotos(userId: string): Promise<void> {
    const rootDir = this.storageService.getRootDir();
    let cursor = '0';
    for (;;) {
      const rows = await this.dataSource.query<
        Array<{ id: string; url: string }>
      >(
        `SELECT id, url FROM bill_photos
          WHERE user_id = ? AND id > ?
          ORDER BY id ASC LIMIT ${BATCH_SIZE}`,
        [userId, cursor],
      );
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.id;

      // 1) 墓碑登记（分片避免单条命令参数过大）
      const now = Math.floor(Date.now() / 1000);
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
        const args = chunk.flatMap((row) => [now, row.url]);
        await this.redis.zadd(REDIS_KEYS.tombstoneBills, ...args);
      }

      // 2) 删除照片行（本批选中的 id 均已读出，按上界删除保证推进）
      await this.dataSource.query(
        'DELETE FROM bill_photos WHERE user_id = ? AND id <= ?',
        [userId, cursor],
      );

      // 3) 删除磁盘文件（缺省忽略错误）
      for (const row of rows) {
        if (!PHOTO_KEY_PATTERN.test(row.url)) continue;
        const absolute = resolve(join(rootDir, row.url));
        if (!absolute.startsWith(rootDir + sep)) continue;
        await unlink(absolute).catch(() => undefined);
      }

      if (rows.length < BATCH_SIZE) break;
      await sleep(BATCH_SLEEP_MS);
    }
  }
}
