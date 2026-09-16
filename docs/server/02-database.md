# 02 · 数据库设计

- 数据库：**MySQL 5.7.44**（锁定 5.7）
- 引擎/字符集：**InnoDB / utf8mb4 / utf8mb4_unicode_ci**（库、表、连接串三层一致）
- 时区：数据库会话使用 `+08:00`，连接串追加 `timezone='+08:00'`；应用层统一 Asia/Shanghai
- 命名规范：表名小写蛇形复数（`bills`）；主键统一 `id BIGINT UNSIGNED AUTO_INCREMENT`；时间列 `*_at`、日期列 `*_date`
- 金额：`DECIMAL(12,2)`，**入库恒为正数**，方向由 `type` 表达；接口对 C 端输出数字（两位小数），前端展示层决定符号

## 1. ER 图

```mermaid
erDiagram
    users ||--o{ refresh_tokens : "持有"
    users ||--o{ books : "拥有"
    users ||--|| user_preferences : "有一条偏好"
    users ||--o{ bills : "记账"
    users ||--o{ operation_logs : "产生"
    books ||--o{ bills : "归集"
    categories ||--o{ bills : "归类"
    pay_methods ||--o{ bills : "收支渠道"
    bills ||--o{ bill_photos : "凭证(最多3张)"
    user_preferences }o--|| books : "当前激活(可空)"
    user_preferences }o--o| categories : "上次分类(可空)"
    user_preferences }o--o| pay_methods : "上次支付方式(可空)"

    users {
        bigint id PK
        varchar phone UK "手机号"
        varchar password_hash "bcrypt cost12"
        varchar nickname "昵称(≤12)"
        varchar avatar_url UK "头像相对路径key"
        date join_date "加入日期"
        tinyint status "1正常 0冻结"
        datetime last_login_at
        datetime created_at
        datetime updated_at
    }
    refresh_tokens {
        bigint id PK
        bigint user_id FK
        char jti UK "令牌唯一ID"
        varchar token_hash "refresh令牌SHA256"
        varchar device_id
        varchar platform
        datetime expires_at
        datetime revoked_at
        datetime last_used_at
        datetime created_at
    }
    books {
        bigint id PK
        bigint user_id FK
        varchar name "账本名(≤12)"
        decimal budget "月预算,0未设置"
        tinyint is_default "注册时默认账本"
        int sort_order
        datetime created_at
        datetime updated_at
        datetime deleted_at "预留软删"
    }
    categories {
        bigint id PK
        enum type "expense|income"
        varchar name UK "分类名"
        varchar icon "emoji"
        char color "主题色"
        char bg "浅底色"
        tinyint sort_order
        tinyint is_system
        tinyint status
    }
    pay_methods {
        bigint id PK
        varchar name UK "现金/微信支付..."
        char short_name "头像简称"
        char color
        char bg
        tinyint sort_order
        tinyint is_system
        tinyint status
    }
    bills {
        bigint id PK
        bigint user_id FK "冗余归属,隔离查询"
        bigint book_id FK
        bigint category_id FK
        bigint pay_method_id FK
        enum type "expense|income"
        decimal amount "恒正,两位小数"
        date record_date "记账日 YYYY-MM-DD"
        time record_time "记账时刻 HH:mm:ss"
        varchar remark "≤50字"
        datetime created_at
        datetime updated_at
        datetime deleted_at "预留软删"
    }
    bill_photos {
        bigint id PK
        bigint bill_id FK
        bigint user_id "冗余归属"
        varchar url "磁盘相对路径key"
        tinyint sort_order "0~2"
        datetime created_at
    }
    user_preferences {
        bigint id PK
        bigint user_id FK UK
        bigint active_book_id FK
        char flow_month "YYYY-MM"
        enum flow_type "ALL|EXPENSE|INCOME"
        char stats_month
        enum stats_type "expense|income"
        enum last_bill_type
        bigint last_pay_method_id FK
        bigint last_category_expense_id FK
        bigint last_category_income_id FK
        datetime updated_at
    }
    operation_logs {
        bigint id PK
        bigint user_id FK "可空(未登录请求)"
        varchar method
        varchar path
        smallint http_status
        int biz_code
        varchar ip
        varchar user_agent
        char trace_id
        int cost_ms
        datetime created_at
    }
```

## 2. 数据表完整 DDL

### 2.1 users 用户表

```sql
CREATE TABLE `users` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `phone`         VARCHAR(20)     NOT NULL COMMENT '手机号(加密存储,见07文档;当前明文)',
  `password_hash` VARCHAR(100)    NOT NULL COMMENT 'bcrypt 哈希,cost=12',
  `nickname`      VARCHAR(12)     NOT NULL DEFAULT '小绿' COMMENT '昵称,最长12字',
  `avatar_url`    VARCHAR(512)    NOT NULL DEFAULT '' COMMENT '头像文件相对路径key(相对UPLOAD_DIR,如avatars/10001/avatar-20260916-100000-a1b2c3d4.jpg),空串表示用内置默认头像;对外访问时由服务端拼接签名URL',
  `join_date`     DATE            NOT NULL COMMENT '加入日期,注册当天',
  `status`        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态:1正常 0冻结',
  `last_login_at` DATETIME(3)     NULL DEFAULT NULL COMMENT '最近登录时间',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表';
```

> `BIGINT` 经 JSON 输出时**统一序列化为字符串**（全局拦截器处理），避免 JS 精度丢失；前端按不透明字符串使用（与现有 `b_xxx` id 的用法一致，可直接作为 `:key`）。

### 2.2 refresh_tokens 刷新令牌表

```sql
CREATE TABLE `refresh_tokens` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NOT NULL COMMENT '所属用户',
  `jti`         CHAR(36)        NOT NULL COMMENT 'JWT 唯一ID(UUID v4)',
  `token_hash`  CHAR(64)        NOT NULL COMMENT 'refresh token 原文的 SHA256,不存原文',
  `device_id`   VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '客户端设备标识(更新系统外的独立上报)',
  `platform`    VARCHAR(16)     NOT NULL DEFAULT '' COMMENT 'app|h5|mp-weixin|mp-alipay...',
  `expires_at`  DATETIME(3)     NOT NULL COMMENT '过期时间(签发后30天)',
  `revoked_at`  DATETIME(3)     NULL DEFAULT NULL COMMENT '吊销时间(登出/轮换旧token)',
  `last_used_at` DATETIME(3)    NULL DEFAULT NULL COMMENT '最近一次刷新使用',
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_jti` (`jti`),
  KEY `idx_user_expire` (`user_id`, `expires_at`),
  CONSTRAINT `fk_refresh_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='刷新令牌(支持轮换与吊销)';
```

### 2.3 books 账本表

```sql
CREATE TABLE `books` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账本ID',
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '所属用户',
  `name`       VARCHAR(12)     NOT NULL DEFAULT '个人账本' COMMENT '账本名称,最长12字',
  `budget`     DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0.00 COMMENT '月预算(元),0表示未设置',
  `is_default` TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否注册时自动创建的默认账本:1是 0否,默认账本不可删除',
  `sort_order` INT             NOT NULL DEFAULT 0 COMMENT '列表排序,小在前',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at` DATETIME(3)     NULL DEFAULT NULL COMMENT '预留软删字段,v1不启用',
  PRIMARY KEY (`id`),
  KEY `idx_user_sort` (`user_id`, `sort_order`, `id`),
  CONSTRAINT `fk_books_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账本表';
```

> 默认账本唯一性（每个 user 仅一条 `is_default=1`）由 Service 层在注册事务中保证；MySQL 5.7 无部分索引，不使用触发器。

### 2.4 categories 收支分类字典表

```sql
CREATE TABLE `categories` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `type`       ENUM('expense','income') NOT NULL COMMENT '收支方向',
  `name`       VARCHAR(16)     NOT NULL COMMENT '分类名称,与客户端现有字典逐字一致',
  `icon`       VARCHAR(16)     NOT NULL DEFAULT '📦' COMMENT 'emoji 图标',
  `color`      CHAR(7)         NOT NULL DEFAULT '#ff6a3d' COMMENT '主题色 #RRGGBB',
  `bg`         CHAR(7)         NOT NULL DEFAULT '#fff0ea' COMMENT '浅底色',
  `sort_order` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `is_system`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '系统内置分类(不可删)',
  `status`     TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_type_name` (`type`, `name`),
  KEY `idx_type_sort` (`type`, `status`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收支分类字典(系统种子数据)';
```

种子数据（与 [category.js](../../store/modules/category.js) 完全一致，共 16 行）：

```sql
INSERT INTO `categories` (`type`,`name`,`icon`,`color`,`bg`,`sort_order`) VALUES
('expense','其他','📦','#ff6a3d','#fff0ea',0),
('expense','购物','🛍️','#ff8f1f','#fff3e6',1),
('expense','交通','🚌','#4a8cff','#eaf2ff',2),
('expense','娱乐','🎬','#a45dff','#f4ecff',3),
('expense','餐饮','🍽️','#ff6a3d','#ffefea',4),
('expense','住房','🏠','#22b573','#e8f8f1',5),
('expense','就医','💊','#f2484b','#ffecec',6),
('expense','教育','📚','#2ea8e6','#e8f6fd',7),
('expense','旅行','✈️','#14b8a6','#e6f7f5',8),
('income','其他','📦','#ff6a3d','#fff0ea',0),
('income','退还款','🔄','#5b8ff9','#eaf2ff',1),
('income','红包','🧧','#ff7a45','#fff0e8',2),
('income','收益','📈','#34c759','#e9faf0',3),
('income','礼金','🎁','#ffb020','#fff7e3',4),
('income','佣金','💰','#b06be0','#f5edff',5),
('income','工资','💵','#f2484b','#ffecec',6);
```

### 2.5 pay_methods 支付方式字典表

```sql
CREATE TABLE `pay_methods` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       VARCHAR(16)     NOT NULL COMMENT '现金/微信支付/支付宝/信用卡/储蓄卡',
  `short_name` CHAR(1)         NOT NULL DEFAULT '其' COMMENT '统计头像单字简称',
  `color`      CHAR(7)         NOT NULL DEFAULT '#8a8f9c',
  `bg`         CHAR(7)         NOT NULL DEFAULT '#f1f2f7',
  `sort_order` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `is_system`  TINYINT(1)      NOT NULL DEFAULT 1,
  `status`     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收/付款方式字典';

INSERT INTO `pay_methods` (`name`,`short_name`,`color`,`bg`,`sort_order`) VALUES
('现金','现','#f2994a','#fdf2e4',0),
('微信支付','微','#07c160','#e7f8ef',1),
('支付宝','支','#1677ff','#e8f2ff',2),
('信用卡','信','#ff7d00','#fff2e3',3),
('储蓄卡','卡','#5a6072','#eef0f5',4);
```

### 2.6 bills 账单表（核心表）

```sql
CREATE TABLE `bills` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账单ID',
  `user_id`       BIGINT UNSIGNED NOT NULL COMMENT '归属用户(冗余,用于归属过滤与索引覆盖)',
  `book_id`       BIGINT UNSIGNED NOT NULL COMMENT '所属账本',
  `category_id`   BIGINT UNSIGNED NOT NULL COMMENT '收支分类',
  `pay_method_id` BIGINT UNSIGNED NOT NULL COMMENT '收/付款方式',
  `type`          ENUM('expense','income') NOT NULL COMMENT '支出/收入',
  `amount`        DECIMAL(12,2) UNSIGNED NOT NULL COMMENT '金额绝对值,恒正,两位小数',
  `record_date`   DATE            NOT NULL COMMENT '记账日期',
  `record_time`   TIME            NOT NULL DEFAULT '12:00:00' COMMENT '记账时间(HH:mm:ss,接口只收发HH:mm)',
  `remark`        VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '备注,最长50字',
  `created_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时刻(排序兜底)',
  `updated_at`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `deleted_at`    DATETIME(3)     NULL DEFAULT NULL COMMENT '预留软删字段,v1删除为物理删除',
  PRIMARY KEY (`id`),
  KEY `idx_user_datetime` (`user_id`, `record_date`, `record_time`, `created_at`),
  KEY `idx_user_type_date` (`user_id`, `type`, `record_date`),
  KEY `idx_book_date` (`book_id`, `record_date`),
  KEY `idx_category` (`category_id`),
  KEY `idx_pay_method` (`pay_method_id`),
  KEY `idx_user_created` (`user_id`, `created_at`),
  CONSTRAINT `fk_bills_user`     FOREIGN KEY (`user_id`)       REFERENCES `users` (`id`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_bills_book`     FOREIGN KEY (`book_id`)       REFERENCES `books` (`id`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_bills_category` FOREIGN KEY (`category_id`)   REFERENCES `categories` (`id`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_bills_pay`      FOREIGN KEY (`pay_method_id`) REFERENCES `pay_methods` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账单流水表';
```

> MySQL 5.7 会解析但**不强制执行 CHECK**，`amount > 0`、备注长度等约束全部在 Service / DTO 层完成，不依赖数据库。

### 2.7 bill_photos 账单凭证表

```sql
CREATE TABLE `bill_photos` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `bill_id`    BIGINT UNSIGNED NOT NULL COMMENT '所属账单',
  `user_id`    BIGINT UNSIGNED NOT NULL COMMENT '冗余归属,鉴权与清理用',
  `url`        VARCHAR(512)    NOT NULL COMMENT '图片文件相对路径key(相对UPLOAD_DIR,如bills/10001/2026/09/16/20260916-121830-a1b2c3d4.jpg);对外访问时由服务端拼接签名URL,禁止存绝对URL',
  `sort_order` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '展示顺序 0~2,每张账单最多3张(Service 强校验)',
  `created_at` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_bill_sort` (`bill_id`, `sort_order`),
  KEY `idx_user` (`user_id`),
  CONSTRAINT `fk_photos_bill` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账单凭证图片';
```

### 2.8 user_preferences 用户偏好表（跨设备同步，可选接入）

```sql
CREATE TABLE `user_preferences` (
  `id`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`                  BIGINT UNSIGNED NOT NULL,
  `active_book_id`           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '当前激活账本',
  `flow_month`               CHAR(7)          NULL DEFAULT NULL COMMENT '流水页月份 YYYY-MM,NULL取当前月',
  `flow_type`                ENUM('ALL','EXPENSE','INCOME') NOT NULL DEFAULT 'ALL' COMMENT '流水类型筛选',
  `stats_month`              CHAR(7)          NULL DEFAULT NULL,
  `stats_type`               ENUM('expense','income') NOT NULL DEFAULT 'expense',
  `last_bill_type`           ENUM('expense','income') NOT NULL DEFAULT 'expense' COMMENT '记账页上次收支方向',
  `last_pay_method_id`       BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '上次支付方式',
  `last_category_expense_id` BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '支出方向上次分类',
  `last_category_income_id`  BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '收入方向上次分类',
  `updated_at`               DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user` (`user_id`),
  KEY `idx_active_book` (`active_book_id`),
  KEY `idx_last_pay` (`last_pay_method_id`),
  KEY `idx_last_cat_exp` (`last_category_expense_id`),
  KEY `idx_last_cat_inc` (`last_category_income_id`),
  CONSTRAINT `fk_pref_user`  FOREIGN KEY (`user_id`)                  REFERENCES `users` (`id`)       ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_pref_book`  FOREIGN KEY (`active_book_id`)           REFERENCES `books` (`id`)       ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pref_pay`   FOREIGN KEY (`last_pay_method_id`)       REFERENCES `pay_methods` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pref_cate1` FOREIGN KEY (`last_category_expense_id`) REFERENCES `categories` (`id`)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_pref_cate2` FOREIGN KEY (`last_category_income_id`)  REFERENCES `categories` (`id`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户UI偏好(对应客户端app.js)';
```

### 2.9 operation_logs 请求审计日志表

```sql
CREATE TABLE `operation_logs` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '未登录请求为空',
  `method`      VARCHAR(8)      NOT NULL,
  `path`        VARCHAR(255)    NOT NULL,
  `http_status` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `biz_code`    INT             NOT NULL DEFAULT 0 COMMENT '业务码,0成功',
  `ip`          VARCHAR(45)     NOT NULL DEFAULT '' COMMENT '兼容IPv6',
  `user_agent`  VARCHAR(255)    NOT NULL DEFAULT '',
  `trace_id`    CHAR(32)        NOT NULL DEFAULT '',
  `cost_ms`     INT UNSIGNED    NOT NULL DEFAULT 0,
  `created_at`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user_time` (`user_id`, `created_at`),
  KEY `idx_trace` (`trace_id`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='请求审计日志(只追加,定期归档)';
```

> 日志表按月归档（`RENAME TABLE` + 新建），保留最近 3 个月在线数据；历史数据导出到本地归档磁盘（NAS 卷）压缩存放。文件型结构化日志（pino）仍是主排障手段，此表只做安全审计与后台查询。

## 3. 索引设计及优化策略

### 3.1 索引与核心查询的对应关系

| 核心查询场景                    | 命中索引                       | 查询写法要点                                                                                           |
| ------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| 首页/流水：取某月账单按时间倒序 | `bills.idx_user_datetime`      | 日期条件写**半开区间**：`record_date >= :monthStart AND record_date < :nextMonthStart`，禁止对列包函数 |
| 统计：某月某类型分类聚合        | `idx_user_type_date`           | 等值列 `user_id`、`type` 在前，范围列 `record_date` 在后                                               |
| 账本维度筛选/删除账本前检查     | `idx_book_date`                | `book_id` 等值                                                                                         |
| 详情页「当月截止本单支出」      | `idx_user_datetime`            | 见 §4 的标准 SQL                                                                                       |
| 账单列表分页                    | `idx_user_datetime` + 主键回表 | 游标分页优先（见 04b），深分页不用 `LIMIT 100000`                                                      |
| 登录                            | `users.uk_phone`               | 手机号唯一索引直达                                                                                     |
| 刷新令牌                        | `refresh_tokens.uk_jti`        | jti 唯一索引 + `revoked_at IS NULL`                                                                    |

### 3.2 设计原则

1. **组合索引列序：等值 → 排序 → 范围**。`idx_user_datetime(user_id, record_date, record_time, created_at)` 一次覆盖「按用户过滤 + 按日期范围 + 按时间排序」。
2. **冗余归属列 `user_id`**：账单所有查询都带用户隔离条件。即使已能经 `book_id → books.user_id` 推导，也在 bills 上冗余 `user_id`，避免 JOIN 鉴权，并让索引更小、更稳定。
3. **外键保留**：字典与归属关系使用 InnoDB 外键兜底（RESTRICT），防止脏数据；高并发写入若成为瓶颈再评估移除（当前规模无此问题）。
4. **禁止 `SELECT *`**：列表接口只取必要列；凭证照片用二次查询按 `bill_id IN (...)` 批量装配，避免 N+1。
5. **聚合下推 SQL**：月汇总/分类排行/支付方式排行/趋势全部用 `SUM/COUNT/GROUP BY` 单条聚合，Service 只做舍入和占比计算；数据库返回精确 `DECIMAL`，避免 JS 浮点误差。
6. MySQL 5.7 无降序索引，组合索引内部全部升序；倒序场景利用 InnoDB 反向扫描（`ORDER BY record_date DESC, record_time DESC`）。
7. **慢查询**：开启 `slow_query_log`，阈值 `long_query_time=0.5`；TypeORM 监听 `'slow'` 事件打点。
8. 连接池：`mysql2` 池大小 `CPU核数*2 + 磁盘数` 起步（小规格机器 10~20），`waitForConnections=true`。

## 4. 表关系与事务边界

### 4.1 关系总结

| 关系                             | 基数                                      | 外键策略                                                                     |
| -------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| users → books                    | 1 : N                                     | RESTRICT 删用户（v1 无注销账号接口）                                         |
| users → bills                    | 1 : N（经账本逻辑归属，物理冗余 user_id） | RESTRICT                                                                     |
| books → bills                    | 1 : N                                     | **RESTRICT：账本下有账单时禁止删除**，须先迁移                               |
| categories / pay_methods → bills | 1 : N                                     | 系统字典 RESTRICT，保证历史账单不出现悬空分类                                |
| bills → bill_photos              | 1 : N（≤3）                               | **CASCADE：删账单级联删照片记录**（磁盘文件由每日清理任务延迟 7 天物理删除） |
| users → refresh_tokens           | 1 : N                                     | CASCADE                                                                      |
| users → user_preferences         | 1 : 1                                     | CASCADE                                                                      |

### 4.2 事务边界（必须用单个 queryRunner 包裹的场景）

**事务① 注册**（一致性要求：用户、默认账本、偏好行同时成功/失败）

```
BEGIN;
  INSERT users ...;
  INSERT books (user_id, name='个人账本', budget=0, is_default=1) ...;
  INSERT user_preferences (user_id, active_book_id=上一步账本id) ...;
COMMIT;
```

**事务② 新增账单（含凭证）**

```
BEGIN;
  -- Service 先在事务外完成：账本归属校验、分类/支付方式字典校验、金额/长度校验
  INSERT bills ...;
  INSERT bill_photos (bill_id, url, sort_order) ...; -- 最多3行,超出整体回滚并抛400
COMMIT;
-- 事务提交后再写审计/埋点,失败不影响主流程
```

**事务③ 编辑账单（照片可全量替换）**

```
BEGIN;
  SELECT ... FROM bills WHERE id=? AND user_id=? FOR UPDATE; -- 行锁防并发覆盖
  UPDATE bills ...;
  若请求带 photos 字段: DELETE FROM bill_photos WHERE bill_id=?; 批量 INSERT 新照片;
COMMIT;
```

**事务④ 删除账单**：`DELETE FROM bills WHERE id=? AND user_id=?`（照片由外键级联删除）；影响行数 0 → 404。

**事务⑤ 删除/迁移账本**

- 默认账本（`is_default=1`）→ 业务错误 `40021`，禁止删除；
- 目标账本下存在账单且未传 `migrateBookId` → `40022`（409 语义），要求客户端确认迁移目标；
- 传了 `migrateBookId`：校验目标账本归属 → `UPDATE bills SET book_id=? WHERE book_id=? AND user_id=?` → 删除空账本，单事务；
- 若该账本是用户当前激活账本（`user_preferences.active_book_id`），事务内将激活账本重置为默认账本。

**只读场景不开事务**：月汇总、分组流水、统计聚合、详情查询，使用默认隔离级别（**REPEATABLE READ**，MySQL 5.7 默认），单条聚合查询天然一致。

### 4.3 详情页「当月截止本单支出」标准 SQL

口径与客户端 [bill.js](../../store/modules/bill.js) `detailById` 完全一致（支出、同月、日期更早或同日时间不晚于本单）：

```sql
SELECT COALESCE(SUM(amount), 0) AS month_expense
FROM bills
WHERE user_id = :userId
  AND type = 'expense'
  AND record_date >= :monthStart
  AND record_date <  :nextMonthStart
  AND ( record_date <  :billDate
        OR (record_date = :billDate AND record_time <= :billTime) );
```

### 4.4 分类聚合标准 SQL（支付方式聚合同构）

```sql
SELECT c.id, c.name, c.icon, c.color, c.bg,
       SUM(b.amount)                AS amount,
       COUNT(*)                     AS bill_count,
       ROUND(SUM(b.amount) / :total * 100, 2) AS percent
FROM bills b
JOIN categories c ON c.id = b.category_id
WHERE b.user_id = :userId
  AND b.type = :type
  AND b.record_date >= :monthStart
  AND b.record_date <  :nextMonthStart
GROUP BY c.id, c.name, c.icon, c.color, c.bg
ORDER BY amount DESC;
```

> `:total` 由同条件下 `SUM(amount)` 先行取一次（或在 Service 用结果集合计）；占比保留两位小数，各项之和不强制等于 100（四舍五入误差由前端容忍，与现有实现一致）。

## 5. 数据库初始化与演进

1. 所有表结构通过 **TypeORM Migration** 管理（`synchronize: false`，生产永不自动建表）；
2. 迁移文件两个：`InitSchema`（建表）、`SeedDictionaries`（16 分类 + 5 支付方式，幂等：`INSERT ... ON DUPLICATE KEY UPDATE`）；
3. 默认账本、偏好行不做全局种子，仅在「注册事务」中按用户创建；
4. 字典后续变更只允许「新增」或「停用(status=0)」，不删除/改名历史字典，保证历史账单可追溯。
