import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { readdir, stat, unlink, statfs } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { StorageService } from './storage.service.js';

const ORPHAN_RETENTION_MS = 24 * 60 * 60_000; // 未被账单引用的孤儿文件 24h
const TOMBSTONE_RETENTION_SECONDS = 7 * 24 * 60 * 60; // 误删申诉窗口 7 天

/**
 * 磁盘文件每日回收（04c §三·资源回收）：
 * - 账单凭证：未引用且上传超 24h 的孤儿删除；已删账单的文件在墓碑中保留 7 天；
 * - 头像：非当前头像由墓碑保留最近 1 个历史版本 7 天；
 * - 磁盘剩余 < 10% 记录告警日志。
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger('CleanupService');

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly storageService: StorageService,
  ) {}

  /** 账单删除时登记凭证墓碑（7 天后物理删除）。 */
  async markBillPhotosTombstone(keys: string[]): Promise<void> {
    await this.addTombstone(REDIS_KEYS.tombstoneBills, keys);
  }

  /** 头像替换时登记旧头像墓碑（保留 7 天）。 */
  async markAvatarTombstone(key: string): Promise<void> {
    await this.addTombstone(REDIS_KEYS.tombstoneAvatars, [key]);
  }

  @Cron('30 3 * * *', { name: 'files-cleanup' })
  async handleCleanup(): Promise<void> {
    try {
      await this.cleanBills();
      await this.cleanAvatars();
      await this.checkDiskSpace();
    } catch (error) {
      this.logger.error(`清理任务失败: ${(error as Error).message}`);
    }
  }

  private async addTombstone(redisKey: string, keys: string[]): Promise<void> {
    const valid = keys.filter((key) => /^(bills|avatars)\//.test(key));
    if (valid.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const args = valid.flatMap((key) => [now, key]);
    await this.redis.zadd(redisKey, ...args);
  }

  private async cleanBills(): Promise<void> {
    const referenced = await this.loadReferencedBillKeys();
    const tombstones = await this.loadTombstones(REDIS_KEYS.tombstoneBills);
    const nowMs = Date.now();

    const files = await this.walkFiles('bills');
    let removed = 0;
    for (const file of files) {
      if (referenced.has(file.key)) continue;

      const tombstoneScore = tombstones.get(file.key);
      if (tombstoneScore !== undefined) {
        if (nowMs / 1000 - tombstoneScore >= TOMBSTONE_RETENTION_SECONDS) {
          if (await this.safeUnlink(file.absolute)) {
            removed += 1;
            await this.redis.zrem(REDIS_KEYS.tombstoneBills, file.key);
          }
        }
        continue;
      }

      // 从未被引用：超 24h 的孤儿直接删除
      if (nowMs - file.mtimeMs >= ORPHAN_RETENTION_MS) {
        if (await this.safeUnlink(file.absolute)) removed += 1;
      }
    }
    this.logger.log(`账单凭证清理完成，删除 ${removed} 个文件`);
  }

  private async cleanAvatars(): Promise<void> {
    const currentAvatars = await this.loadCurrentAvatars();
    const tombstones = await this.loadTombstones(REDIS_KEYS.tombstoneAvatars);
    const nowMs = Date.now();

    // 按用户分组：非当前头像只保留最近 1 个历史版本（04c §三·资源回收），
    // 更早的墓碑版本立即回收；被保留的最近版本满 7 天墓碑期后删除。
    const filesByUser = new Map<
      string,
      Array<{ key: string; absolute: string; mtimeMs: number }>
    >();
    for (const file of await this.walkFiles('avatars')) {
      if (currentAvatars.has(file.key)) continue;
      const userId = file.key.split('/')[1] ?? '_';
      const group = filesByUser.get(userId);
      if (group) group.push(file);
      else filesByUser.set(userId, [file]);
    }

    let removed = 0;
    for (const group of filesByUser.values()) {
      group.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const [retained, ...rest] = group;

      for (const [index, file] of [retained, ...rest].entries()) {
        const tombstoneScore = tombstones.get(file.key);
        let canDelete: boolean;
        if (index === 0) {
          // 最近 1 个历史版本：满墓碑期（或游离满 7 天）才删
          canDelete =
            (tombstoneScore !== undefined &&
              nowMs / 1000 - tombstoneScore >= TOMBSTONE_RETENTION_SECONDS) ||
            (tombstoneScore === undefined &&
              nowMs - file.mtimeMs >= TOMBSTONE_RETENTION_SECONDS * 1000);
        } else {
          // 更早的历史版本：已登记墓碑即删；游离文件同样满 7 天删
          canDelete =
            tombstoneScore !== undefined ||
            nowMs - file.mtimeMs >= TOMBSTONE_RETENTION_SECONDS * 1000;
        }
        if (canDelete && (await this.safeUnlink(file.absolute))) {
          removed += 1;
          await this.redis.zrem(REDIS_KEYS.tombstoneAvatars, file.key);
        }
      }
    }
    this.logger.log(`历史头像清理完成，删除 ${removed} 个文件`);
  }

  private async loadReferencedBillKeys(): Promise<Set<string>> {
    const rows = await this.dataSource.query<Array<{ url: string }>>(
      'SELECT url FROM bill_photos',
    );
    return new Set(rows.map((row) => row.url));
  }

  private async loadCurrentAvatars(): Promise<Set<string>> {
    const rows = await this.dataSource.query<Array<{ avatar_url: string }>>(
      "SELECT avatar_url FROM users WHERE avatar_url LIKE 'avatars/%'",
    );
    return new Set(rows.map((row) => row.avatar_url));
  }

  private async loadTombstones(redisKey: string): Promise<Map<string, number>> {
    const entries = await this.redis.zrangebyscore(
      redisKey,
      0,
      Date.now() / 1000 + 8 * 86400,
      'WITHSCORES',
    );
    const map = new Map<string, number>();
    for (let i = 0; i + 1 < entries.length; i += 2) {
      map.set(entries[i] as string, Number(entries[i + 1]));
    }
    return map;
  }

  private async walkFiles(
    subdir: string,
  ): Promise<Array<{ key: string; absolute: string; mtimeMs: number }>> {
    const root = resolve(this.storageService.getRootDir(), subdir);
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true, recursive: true });
    } catch {
      return [];
    }
    const files: Array<{ key: string; absolute: string; mtimeMs: number }> = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.jpg')) continue;
      const absolute = join(entry.parentPath ?? root, entry.name);
      try {
        const stats = await stat(absolute);
        const relative = resolve(absolute).slice(
          resolve(this.storageService.getRootDir()).length + 1,
        );
        files.push({
          key: relative.split('\\').join('/'),
          absolute,
          mtimeMs: stats.mtimeMs,
        });
      } catch {
        // 无状态文件跳过
      }
    }
    return files;
  }

  private async safeUnlink(absolute: string): Promise<boolean> {
    try {
      await unlink(absolute);
      return true;
    } catch (error) {
      // 文件已不存在（手动清理/重复任务）：视为目标态，墓碑成员可随之摘除
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      this.logger.warn(`删除文件失败 ${absolute}: ${(error as Error).message}`);
      return false;
    }
  }

  private async checkDiskSpace(): Promise<void> {
    try {
      const root = this.storageService.getRootDir();
      const info = await statfs(root);
      const ratio = info.bavail / info.blocks;
      if (ratio < 0.1) {
        this.logger.error(
          `磁盘剩余空间不足 10%（当前 ${(ratio * 100).toFixed(2)}%），请及时扩容`,
        );
      }
    } catch (error) {
      this.logger.warn(`磁盘空间检查失败: ${(error as Error).message}`);
    }
  }
}
