-- =====================================================================
-- 003_foreign_keys.sql
-- 小绿记账 · 外键约束补齐（MySQL 5.7，幂等，可重复执行）
--
-- 本轮内容：
--   bill_photos (bill_id, user_id) → bills (id, user_id) ON DELETE CASCADE
--
-- ── 执行前必读 ────────────────────────────────────────────────────────
-- 1. 先清理历史孤儿行，否则建外键会因孤儿数据失败：
--      node scripts/fix-orphan-bill-photos.mjs            # dry-run 预览核对
--      node scripts/fix-orphan-bill-photos.mjs --apply    # 登记墓碑后删除孤儿
--    另建议手工核对 (bill_id,user_id) 联合错配行（脚本只按 bill_id 判定）：
--      SELECT COUNT(*) FROM bill_photos bp
--      LEFT JOIN bills b ON b.id = bp.bill_id AND b.user_id = bp.user_id
--      WHERE b.id IS NULL;
-- 2. 生产环境执行前先整库备份（mysqldump --single-transaction）。
-- 3. 执行方式：
--      mysql -u<user> -p <db_name> < sql/003_foreign_keys.sql
--
-- 说明：
-- - 实体侧 createForeignKeyConstraints:false 策略不变，开发库靠 TypeORM
--   synchronize 建表，无需执行本文件；本文件仅用于生产/测试库手工迁移。
-- - 所有 DDL 均先查 information_schema 判断存在性，再用 PREPARE 执行，
--   重复执行不会报错。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 步骤 1：bills 补 UNIQUE KEY (id, user_id)
-- 联合外键要求被引用列构成唯一索引；bills 现有 PRIMARY KEY(id) 不含
-- user_id，无法支撑 (id,user_id) 联合引用，故补一个联合唯一索引
-- （id 本身即主键唯一，(id,user_id) 逻辑上必然唯一，无数据冲突风险）。
-- ---------------------------------------------------------------------
SET @db_name := DATABASE();

SET @idx_exists := (
  SELECT COUNT(1)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db_name
     AND TABLE_NAME = 'bills'
     AND INDEX_NAME = 'uk_bills_id_user'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE `bills` ADD UNIQUE KEY `uk_bills_id_user` (`id`, `user_id`)',
  'SELECT ''步骤1跳过：uk_bills_id_user 已存在'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 步骤 2：bill_photos → bills 联合外键，ON DELETE CASCADE
-- 账单物理删除时数据库层面级联清理凭证行（与应用层删除逻辑双保险）。
-- 子表 bill_photos 若无 (bill_id,user_id) 前缀的可用索引，InnoDB 会
-- 自动创建同名普通索引，属预期行为。
-- ---------------------------------------------------------------------
SET @fk_exists := (
  SELECT COUNT(1)
    FROM information_schema.TABLE_CONSTRAINTS
   WHERE CONSTRAINT_SCHEMA = @db_name
     AND TABLE_NAME = 'bill_photos'
     AND CONSTRAINT_NAME = 'fk_billphotos_bill_user'
     AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);
SET @ddl := IF(
  @fk_exists = 0,
  'ALTER TABLE `bill_photos` ADD CONSTRAINT `fk_billphotos_bill_user` '
    'FOREIGN KEY (`bill_id`, `user_id`) '
    'REFERENCES `bills` (`id`, `user_id`) ON DELETE CASCADE',
  'SELECT ''步骤2跳过：fk_billphotos_bill_user 已存在'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 后续事项（本轮不建）：
-- bills → books / categories / pay_methods 外键暂不建立：
--   1. 字典表（categories / pay_methods / books）约定"永不物理删除，
--      仅 status=0 停用"，应用层已按此实现，外键的防护价值有限；
--   2. 历史数据可能存在字典被物理删除后的残留账单，直接建外键有失败
--      风险，需先做全量数据核对与清洗，留待后续专项迁移。
-- ---------------------------------------------------------------------
