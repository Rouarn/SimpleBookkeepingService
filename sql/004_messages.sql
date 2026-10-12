-- =====================================================================
-- 004_messages.sql
-- 小绿记账 · 消息中心 + 账号注销（幂等，可重复执行）
--
-- 本轮内容：
--   1. 新表 messages（站内消息：超预算提醒 / 安全告警 / 月度账单报告）
--   2. users 增加 deactivated_at（注销时刻）
--   3. users.phone 列宽 20 → 40（注销匿名手机号 'del:{id}:{10位}' 最长 34）
--   4. users.status 注释补充状态 2=注销
--
-- ── 执行说明 ──────────────────────────────────────────────────────────
-- - 开发环境 TypeORM synchronize:true 会自动建表/加列，无需执行本文件；
-- - 生产环境（synchronize 关闭）须在发版前手工执行：
--     mysql -u<user> -p <db_name> < sql/004_messages.sql
-- - 执行顺序：在 sql/003_foreign_keys.sql 之后执行；
-- - 所有 DDL 均先查 information_schema 判断存在性（MODIFY 语句天然幂等），
--   重复执行不会报错。
-- =====================================================================

SET @db_name := DATABASE();

-- ---------------------------------------------------------------------
-- 步骤 1：新表 messages
-- ---------------------------------------------------------------------
SET @table_exists := (
  SELECT COUNT(1)
    FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = @db_name
     AND TABLE_NAME = 'messages'
);
SET @ddl := IF(
  @table_exists = 0,
  'CREATE TABLE `messages` ('
    '  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,'
    '  `user_id` BIGINT UNSIGNED NOT NULL,'
    '  `type` VARCHAR(32) NOT NULL COMMENT ''消息类型：budget_over 超预算 / security 安全 / monthly_report 月报'','
    '  `title` VARCHAR(64) NOT NULL,'
    '  `content` VARCHAR(255) NOT NULL,'
    '  `payload` JSON NULL,'
    '  `is_read` TINYINT(1) NOT NULL DEFAULT 0,'
    '  `read_at` DATETIME(3) NULL,'
    '  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),'
    '  PRIMARY KEY (`id`),'
    '  KEY `idx_user_read_created` (`user_id`, `is_read`, `created_at`)'
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT=''站内消息''',
  'SELECT ''步骤1跳过：messages 表已存在'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 若表已存在但缺联合索引（历史手工建表场景），补齐
SET @idx_exists := (
  SELECT COUNT(1)
    FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = @db_name
     AND TABLE_NAME = 'messages'
     AND INDEX_NAME = 'idx_user_read_created'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE `messages` ADD KEY `idx_user_read_created` (`user_id`, `is_read`, `created_at`)',
  'SELECT ''步骤1b跳过：idx_user_read_created 已存在'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 步骤 2：users 增加 deactivated_at（注销时刻，保留期清理任务的判定依据）
-- ---------------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(1)
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = @db_name
     AND TABLE_NAME = 'users'
     AND COLUMN_NAME = 'deactivated_at'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE `users` ADD COLUMN `deactivated_at` DATETIME(3) NULL AFTER `last_login_at`',
  'SELECT ''步骤2跳过：users.deactivated_at 已存在'' AS msg'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 步骤 3：users.phone 列宽 20 → 40
-- 注销时改写为 CONCAT('del:', id, ':', LEFT(MD5(RAND()), 10))，
-- BIGINT UNSIGNED 最长 19 位 → 匿名值最长 4+19+1+10=34，须放宽列宽；
-- MODIFY 天然幂等，重复执行无副作用（含 uk_phone 唯一索引不受影响）。
-- ---------------------------------------------------------------------
ALTER TABLE `users`
  MODIFY COLUMN `phone` VARCHAR(40) NOT NULL
  COMMENT '手机号（注销时改写为 del:{id}:{随机} 匿名值以释放唯一键）';

-- ---------------------------------------------------------------------
-- 步骤 4：users.status 注释补充状态 2=注销（1 正常 0 冻结 2 注销）
-- ---------------------------------------------------------------------
ALTER TABLE `users`
  MODIFY COLUMN `status` TINYINT UNSIGNED NOT NULL DEFAULT 1
  COMMENT '状态：1正常 0冻结 2注销（注销保留匿名行，业务数据由清理任务回收）';

-- ---------------------------------------------------------------------
-- 后续事项：
-- - 注销保留期清理由应用侧每日 03:40 任务（deactivated-purge）执行，
--   按需清理 bill_photos → bills → books → messages；users 行保留作匿名审计；
-- - categories / pay_methods 为全局共享字典（无 user_id），注销无需清理。
-- ---------------------------------------------------------------------
