-- ============================================================
-- 001_token_version.sql
-- 归档阶段三（P1-01）：users 表新增令牌版本号列
--   - 修改密码 / 全员登出时 token_version 自增，使既有 access token 即刻失效
--   - 对应实体：src/entities/user.entity.ts User.tokenVersion
-- MySQL 5.7，幂等：先查 information_schema 判断列是否存在
-- ============================================================

-- 列不存在时才执行 ADD COLUMN；已存在则退化为 SELECT 1（空操作）
SET @ddl := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND column_name = 'token_version'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
