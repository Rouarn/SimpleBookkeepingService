-- ============================================================
-- 002_indexes.sql
-- P2-04 索引精修（MySQL 5.7，幂等，可重复执行）
--
-- 变更清单：
--   A. bills            删除 idx_category（category_id 单列）
--   B. bills            删除 idx_pay_method（pay_method_id 单列）
--   C. bills            删除 idx_book_date（book_id, record_date），
--                       新增 idx_book_datetime（book_id, record_date, record_time, created_at）
--   D. bill_photos      删除 idx_user（user_id 单列），
--                       新增 idx_user_bill_sort（user_id, bill_id, sort_order）
--   E. user_preferences 删除 idx_active_book / idx_last_pay /
--                       idx_last_cat_exp / idx_last_cat_inc 四个单列索引
--
-- 判定依据（已核对 src/ 下全部 .query 调用的 WHERE / ORDER BY）：
--   1. bills 上 category_id 仅在 buildScope 中以 b.category_id = ? 出现，
--      而该 WHERE 恒以 b.user_id = ? 为第一过滤条件，走 idx_user_datetime /
--      idx_user_type_date 即可；statistics 的 GROUP BY category_id 同样带
--      user_id + record_date 范围前导。全库不存在「不带 user_id 前缀」的
--      category_id / pay_method_id 查询，两个单列索引只有写入维护成本。
--   2. 账本维度查询（list/today/grouped/summary 带 book_id）：
--        WHERE user_id = ? AND book_id = ? AND record_date 半开区间
--        ORDER BY record_date DESC, record_time DESC, created_at DESC
--      EXPLAIN 思路：无 book_id 时只能走 idx_user_datetime（user_id 前导）；
--      指定 book_id 时，idx_book_datetime 以 book_id 等值起头，扫描区间收敛
--      到单账本且索引序与排序键完全一致，可消除 filesort；book_id 为全局
--      唯一主键值，选择率天然很高。故与 idx_user_datetime 共存，由优化器
--      按成本自选，而不是互相替代。
--   3. bill_photos 实际路径：
--        列表批量取图：WHERE user_id=? AND bill_id IN (...)
--                     ORDER BY bill_id, sort_order（每账单最多 3 张）
--        详情/删单条：WHERE bill_id=? AND user_id=? ORDER BY sort_order
--        清空：WHERE user_id=? AND bill_id IN (本批账单 id)
--      (user_id, bill_id, sort_order) 联合索引全覆盖；uk_bill_sort
--      (bill_id, sort_order) 唯一约束保留，承担同账单序号去重。
--   4. user_preferences 所有读写（getPreferences / replacePreferences /
--      激活态切换 / 删账本修正）WHERE 恒为 user_id = ?，由 uk_user 唯一
--      索引覆盖；四个外键样式列仅随整行读写，无任何独立 WHERE 使用。
--
-- 待生产 EXPLAIN 复核（拿不准，本次不动）：
--   * idx_user_created (user_id, created_at)：当前没有 user_id + created_at
--     的独立 WHERE/ORDER BY，列表排序尾部 created_at 已由
--     idx_user_datetime 的尾列覆盖；若生产慢查询确认无用可在后续脚本删除。
--   * idx_user_type_date (user_id, type, record_date) 对 summary/today 聚合
--     与 statistics overview 按 type 过滤场景的实际命中情况，建议生产数据
--     规模下 EXPLAIN 验证，本次保留。
-- ============================================================

-- ---------- A. bills：删除 idx_category ----------
SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE bills DROP INDEX idx_category',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bills'
    AND index_name = 'idx_category'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------- B. bills：删除 idx_pay_method ----------
SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE bills DROP INDEX idx_pay_method',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bills'
    AND index_name = 'idx_pay_method'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------- C. bills：idx_book_date 扩为 idx_book_datetime ----------
-- 先删旧索引（开发环境 synchronize 已可能直接建成新名，故两者都做存在性判断）
SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE bills DROP INDEX idx_book_date',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bills'
    AND index_name = 'idx_book_date'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 再加四列联合索引
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE bills ADD INDEX idx_book_datetime (book_id, record_date, record_time, created_at)',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bills'
    AND index_name = 'idx_book_datetime'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------- D. bill_photos：idx_user 改为联合索引 ----------
SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE bill_photos DROP INDEX idx_user',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_photos'
    AND index_name = 'idx_user'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE bill_photos ADD INDEX idx_user_bill_sort (user_id, bill_id, sort_order)',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'bill_photos'
    AND index_name = 'idx_user_bill_sort'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------- E. user_preferences：删除四个无 WHERE 使用的单列索引 ----------
SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE user_preferences DROP INDEX idx_active_book',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_preferences'
    AND index_name = 'idx_active_book'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE user_preferences DROP INDEX idx_last_pay',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_preferences'
    AND index_name = 'idx_last_pay'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE user_preferences DROP INDEX idx_last_cat_exp',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_preferences'
    AND index_name = 'idx_last_cat_exp'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE user_preferences DROP INDEX idx_last_cat_inc',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_preferences'
    AND index_name = 'idx_last_cat_inc'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
