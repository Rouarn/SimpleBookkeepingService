/**
 * 一次性修复脚本：清理 bill_photos 孤儿行（账单已删但照片行残留）。
 *
 * 背景（2026-10 阶段一红线 P0-03）：历史版本的删除/清空账单逻辑未清理
 * bill_photos 行，且库中无外键约束（createForeignKeyConstraints:false），
 * 导致 cleanup 任务把孤儿 url 当作"仍被引用"，对应磁盘文件永不回收。
 *
 * 行为：
 *   1. 默认 dry-run：仅统计与预览，不改任何数据；
 *   2. --apply：将孤儿行 url 写入墓碑 ZSET（score=当前时刻）后删除孤儿行，
 *      磁盘文件由每日 03:30 清理任务在 7 天保留期后回收；
 *   3. 顺带检测 bill_photos → bills 是否存在真实外键并输出提示。
 *
 * 用法：
 *   # 预览（安全）
 *   DOTENV_PATH=.env.production node scripts/fix-orphan-bill-photos.mjs
 *   # 执行修复
 *   DOTENV_PATH=.env.production node scripts/fix-orphan-bill-photos.mjs --apply
 */
import mysql from 'mysql2/promise';
import Redis from 'ioredis';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: process.env.DOTENV_PATH ?? '.env.development' });

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 1000;
/** 与 src/common/redis/redis.constants.ts 的 REDIS_KEYS.tombstoneBills 一致 */
const TOMBSTONE_BILLS_KEY = 'bk:cleanup:tombstone:bills';

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[fix] 缺少必需的环境变量 ${name}（用 DOTENV_PATH 指定 .env 文件）`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  });
  const redis = new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number(process.env.REDIS_PORT ?? 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: Number(process.env.REDIS_DB ?? 0),
    lazyConnect: true,
    maxRetriesPerRequest: 2,
  });

  try {
    // 1. 外键检测：确认库中是否真有 bill_photos → bills 约束
    const [fkRows] = await conn.query(
      `SELECT CONSTRAINT_NAME
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'bill_photos'
          AND REFERENCED_TABLE_NAME = 'bills'`,
      [requiredEnv('DB_NAME')],
    );
    if (fkRows.length > 0) {
      console.log(`外键检测：存在真实外键 ${fkRows.map((r) => r.CONSTRAINT_NAME).join(', ')}（若含 ON DELETE CASCADE，历史版本可能未产生孤儿行）`);
    } else {
      console.log('外键检测：bill_photos → bills 无外键约束（与本仓实体配置一致）');
    }

    // 2. 按 id 游标分批扫描孤儿行（bill_id 在 bills 中已不存在）
    let cursor = 0;
    let totalOrphans = 0;
    let totalTombstoned = 0;
    let totalDeleted = 0;

    for (;;) {
      const [rows] = await conn.query(
        `SELECT bp.id, bp.url
           FROM bill_photos bp
           LEFT JOIN bills b ON b.id = bp.bill_id
          WHERE b.id IS NULL AND bp.id > ?
          ORDER BY bp.id ASC
          LIMIT ${BATCH_SIZE}`,
        [cursor],
      );
      if (rows.length === 0) break;
      cursor = Number(rows[rows.length - 1].id);
      totalOrphans += rows.length;

      if (rows.length <= 5) {
        for (const row of rows) console.log(`  孤儿行 id=${row.id} url=${row.url}`);
      }

      if (APPLY) {
        const now = Math.floor(Date.now() / 1000);
        const args = rows.flatMap((row) => [now, row.url]);
        await redis.zadd(TOMBSTONE_BILLS_KEY, ...args);
        totalTombstoned += rows.length;

        const ids = rows.map((row) => row.id);
        const [result] = await conn.query(
          `DELETE FROM bill_photos WHERE id IN (${ids.map(() => '?').join(',')})`,
          ids,
        );
        totalDeleted += result.affectedRows;
        console.log(`已处理批次：墓碑登记 ${rows.length} 条，删除孤儿行 ${result.affectedRows} 条`);
      }
    }

    console.log('\n===== 结果 =====');
    console.log(`孤儿 bill_photos 行总数: ${totalOrphans}`);
    if (APPLY) {
      console.log(`已登记墓碑: ${totalTombstoned} 条（磁盘文件由清理任务在 7 天保留期后回收）`);
      console.log(`已删除孤儿行: ${totalDeleted} 条`);
    } else {
      console.log('当前为 dry-run 预览，未修改任何数据；确认无误后追加 --apply 执行修复');
    }
  } finally {
    await conn.end();
    redis.disconnect();
  }
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
