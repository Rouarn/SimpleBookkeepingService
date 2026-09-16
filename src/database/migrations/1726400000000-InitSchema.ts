import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 初始化 9 张表（02 §2 完整 DDL，逐字落地）。
 * MySQL 5.7：InnoDB / utf8mb4 / utf8mb4_unicode_ci。
 */
export class InitSchema1726400000000 implements MigrationInterface {
  name = 'InitSchema1726400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 2.1 users
    await queryRunner.query(`
CREATE TABLE \`users\` (
  \`id\`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  \`phone\`         VARCHAR(20)     NOT NULL COMMENT '手机号(加密存储,见07文档;当前明文)',
  \`password_hash\` VARCHAR(100)    NOT NULL COMMENT 'bcrypt 哈希,cost=12',
  \`nickname\`      VARCHAR(12)     NOT NULL DEFAULT '小绿' COMMENT '昵称,最长12字',
  \`avatar_url\`    VARCHAR(512)    NOT NULL DEFAULT '' COMMENT '头像文件相对路径key(相对UPLOAD_DIR,如avatars/10001/avatar-20260916-100000-a1b2c3d4.jpg),空串表示用内置默认头像;对外访问时由服务端拼接签名URL',
  \`join_date\`     DATE            NOT NULL COMMENT '加入日期,注册当天',
  \`status\`        TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '状态:1正常 0冻结',
  \`last_login_at\` DATETIME(3)     NULL DEFAULT NULL COMMENT '最近登录时间',
  \`created_at\`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_phone\` (\`phone\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户表'`);

    // 2.2 refresh_tokens
    await queryRunner.query(`
CREATE TABLE \`refresh_tokens\` (
  \`id\`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`user_id\`     BIGINT UNSIGNED NOT NULL COMMENT '所属用户',
  \`jti\`         CHAR(36)        NOT NULL COMMENT 'JWT 唯一ID(UUID v4)',
  \`token_hash\`  CHAR(64)        NOT NULL COMMENT 'refresh token 原文的 SHA256,不存原文',
  \`device_id\`   VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '客户端设备标识',
  \`platform\`    VARCHAR(16)     NOT NULL DEFAULT '' COMMENT 'app|h5|mp-weixin|mp-alipay...',
  \`expires_at\`  DATETIME(3)     NOT NULL COMMENT '过期时间(签发后30天)',
  \`revoked_at\`  DATETIME(3)     NULL DEFAULT NULL COMMENT '吊销时间(登出/轮换旧token)',
  \`last_used_at\` DATETIME(3)    NULL DEFAULT NULL COMMENT '最近一次刷新使用',
  \`created_at\`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_jti\` (\`jti\`),
  KEY \`idx_user_expire\` (\`user_id\`, \`expires_at\`),
  CONSTRAINT \`fk_refresh_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='刷新令牌(支持轮换与吊销)'`);

    // 2.3 books
    await queryRunner.query(`
CREATE TABLE \`books\` (
  \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账本ID',
  \`user_id\`    BIGINT UNSIGNED NOT NULL COMMENT '所属用户',
  \`name\`       VARCHAR(12)     NOT NULL DEFAULT '个人账本' COMMENT '账本名称,最长12字',
  \`budget\`     DECIMAL(12,2) UNSIGNED NOT NULL DEFAULT 0.00 COMMENT '月预算(元),0表示未设置',
  \`is_default\` TINYINT(1)      NOT NULL DEFAULT 0 COMMENT '是否默认账本:1是 0否,默认账本不可删除',
  \`sort_order\` INT             NOT NULL DEFAULT 0 COMMENT '列表排序,小在前',
  \`created_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  \`deleted_at\` DATETIME(3)     NULL DEFAULT NULL COMMENT '预留软删字段,v1不启用',
  PRIMARY KEY (\`id\`),
  KEY \`idx_user_sort\` (\`user_id\`, \`sort_order\`, \`id\`),
  CONSTRAINT \`fk_books_user\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账本表'`);

    // 2.4 categories
    await queryRunner.query(`
CREATE TABLE \`categories\` (
  \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`type\`       ENUM('expense','income') NOT NULL COMMENT '收支方向',
  \`name\`       VARCHAR(16)     NOT NULL COMMENT '分类名称,与客户端现有字典逐字一致',
  \`icon\`       VARCHAR(16)     NOT NULL DEFAULT '📦' COMMENT 'emoji 图标',
  \`color\`      CHAR(7)         NOT NULL DEFAULT '#ff6a3d' COMMENT '主题色 #RRGGBB',
  \`bg\`         CHAR(7)         NOT NULL DEFAULT '#fff0ea' COMMENT '浅底色',
  \`sort_order\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  \`is_system\`  TINYINT(1)      NOT NULL DEFAULT 1 COMMENT '系统内置分类(不可删)',
  \`status\`     TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  \`created_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_type_name\` (\`type\`, \`name\`),
  KEY \`idx_type_sort\` (\`type\`, \`status\`, \`sort_order\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收支分类字典(系统种子数据)'`);

    // 2.5 pay_methods
    await queryRunner.query(`
CREATE TABLE \`pay_methods\` (
  \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`name\`       VARCHAR(16)     NOT NULL COMMENT '现金/微信支付/支付宝/信用卡/储蓄卡',
  \`short_name\` CHAR(1)         NOT NULL DEFAULT '其' COMMENT '单字简称',
  \`color\`      CHAR(7)         NOT NULL DEFAULT '#8a8f9c',
  \`bg\`         CHAR(7)         NOT NULL DEFAULT '#f1f2f7',
  \`sort_order\` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  \`is_system\`  TINYINT(1)      NOT NULL DEFAULT 1,
  \`status\`     TINYINT UNSIGNED NOT NULL DEFAULT 1,
  \`created_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  \`updated_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_name\` (\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='收/付款方式字典'`);

    // 2.6 bills
    await queryRunner.query(`
CREATE TABLE \`bills\` (
  \`id\`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '账单ID',
  \`user_id\`       BIGINT UNSIGNED NOT NULL COMMENT '归属用户(冗余,用于归属过滤与索引覆盖)',
  \`book_id\`       BIGINT UNSIGNED NOT NULL COMMENT '所属账本',
  \`category_id\`   BIGINT UNSIGNED NOT NULL COMMENT '收支分类',
  \`pay_method_id\` BIGINT UNSIGNED NOT NULL COMMENT '收/付款方式',
  \`type\`          ENUM('expense','income') NOT NULL COMMENT '支出/收入',
  \`amount\`        DECIMAL(12,2) UNSIGNED NOT NULL COMMENT '金额绝对值,恒正,两位小数',
  \`record_date\`   DATE            NOT NULL COMMENT '记账日期',
  \`record_time\`   TIME            NOT NULL DEFAULT '12:00:00' COMMENT '记账时间(HH:mm:ss)',
  \`remark\`        VARCHAR(50)     NOT NULL DEFAULT '' COMMENT '备注,最长50字',
  \`created_at\`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时刻(排序兜底)',
  \`updated_at\`    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  \`deleted_at\`    DATETIME(3)     NULL DEFAULT NULL COMMENT '预留软删字段,v1删除为物理删除',
  PRIMARY KEY (\`id\`),
  KEY \`idx_user_datetime\` (\`user_id\`, \`record_date\`, \`record_time\`, \`created_at\`),
  KEY \`idx_user_type_date\` (\`user_id\`, \`type\`, \`record_date\`),
  KEY \`idx_book_date\` (\`book_id\`, \`record_date\`),
  KEY \`idx_category\` (\`category_id\`),
  KEY \`idx_pay_method\` (\`pay_method_id\`),
  KEY \`idx_user_created\` (\`user_id\`, \`created_at\`),
  CONSTRAINT \`fk_bills_user\`     FOREIGN KEY (\`user_id\`)       REFERENCES \`users\` (\`id\`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT \`fk_bills_book\`     FOREIGN KEY (\`book_id\`)       REFERENCES \`books\` (\`id\`)       ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT \`fk_bills_category\` FOREIGN KEY (\`category_id\`)   REFERENCES \`categories\` (\`id\`)  ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT \`fk_bills_pay\`      FOREIGN KEY (\`pay_method_id\`) REFERENCES \`pay_methods\` (\`id\`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账单流水表'`);

    // 2.7 bill_photos
    await queryRunner.query(`
CREATE TABLE \`bill_photos\` (
  \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`bill_id\`    BIGINT UNSIGNED NOT NULL COMMENT '所属账单',
  \`user_id\`    BIGINT UNSIGNED NOT NULL COMMENT '冗余归属,鉴权与清理用',
  \`url\`        VARCHAR(512)    NOT NULL COMMENT '图片文件相对路径key',
  \`sort_order\` TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT '展示顺序 0~2,每张账单最多3张',
  \`created_at\` DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_bill_sort\` (\`bill_id\`, \`sort_order\`),
  KEY \`idx_user\` (\`user_id\`),
  CONSTRAINT \`fk_photos_bill\` FOREIGN KEY (\`bill_id\`) REFERENCES \`bills\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账单凭证图片'`);

    // 2.8 user_preferences
    await queryRunner.query(`
CREATE TABLE \`user_preferences\` (
  \`id\`                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`user_id\`                  BIGINT UNSIGNED NOT NULL,
  \`active_book_id\`           BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '当前激活账本',
  \`flow_month\`               CHAR(7)          NULL DEFAULT NULL COMMENT '流水页月份 YYYY-MM,NULL取当前月',
  \`flow_type\`                ENUM('ALL','EXPENSE','INCOME') NOT NULL DEFAULT 'ALL' COMMENT '流水类型筛选',
  \`stats_month\`              CHAR(7)          NULL DEFAULT NULL,
  \`stats_type\`               ENUM('expense','income') NOT NULL DEFAULT 'expense',
  \`last_bill_type\`           ENUM('expense','income') NOT NULL DEFAULT 'expense' COMMENT '记账页上次收支方向',
  \`last_pay_method_id\`       BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '上次支付方式',
  \`last_category_expense_id\` BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '支出方向上次分类',
  \`last_category_income_id\`  BIGINT UNSIGNED  NULL DEFAULT NULL COMMENT '收入方向上次分类',
  \`updated_at\`               DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  UNIQUE KEY \`uk_user\` (\`user_id\`),
  KEY \`idx_active_book\` (\`active_book_id\`),
  KEY \`idx_last_pay\` (\`last_pay_method_id\`),
  KEY \`idx_last_cat_exp\` (\`last_category_expense_id\`),
  KEY \`idx_last_cat_inc\` (\`last_category_income_id\`),
  CONSTRAINT \`fk_pref_user\`  FOREIGN KEY (\`user_id\`)                  REFERENCES \`users\` (\`id\`)       ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_pref_book\`  FOREIGN KEY (\`active_book_id\`)           REFERENCES \`books\` (\`id\`)       ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_pref_pay\`   FOREIGN KEY (\`last_pay_method_id\`)       REFERENCES \`pay_methods\` (\`id\`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_pref_cate1\` FOREIGN KEY (\`last_category_expense_id\`) REFERENCES \`categories\` (\`id\`)  ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT \`fk_pref_cate2\` FOREIGN KEY (\`last_category_income_id\`)  REFERENCES \`categories\` (\`id\`)  ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户UI偏好'`);

    // 2.9 operation_logs
    await queryRunner.query(`
CREATE TABLE \`operation_logs\` (
  \`id\`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`user_id\`     BIGINT UNSIGNED NULL DEFAULT NULL COMMENT '未登录请求为空',
  \`method\`      VARCHAR(8)      NOT NULL,
  \`path\`        VARCHAR(255)    NOT NULL,
  \`http_status\` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  \`biz_code\`    INT             NOT NULL DEFAULT 0 COMMENT '业务码,0成功',
  \`ip\`          VARCHAR(45)     NOT NULL DEFAULT '' COMMENT '兼容IPv6',
  \`user_agent\`  VARCHAR(255)    NOT NULL DEFAULT '',
  \`trace_id\`    CHAR(32)        NOT NULL DEFAULT '',
  \`cost_ms\`     INT UNSIGNED    NOT NULL DEFAULT 0,
  \`created_at\`  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  KEY \`idx_user_time\` (\`user_id\`, \`created_at\`),
  KEY \`idx_trace\` (\`trace_id\`),
  KEY \`idx_created\` (\`created_at\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='请求审计日志(只追加,定期归档)'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 按外键依赖逆序删除
    for (const table of [
      'operation_logs',
      'user_preferences',
      'bill_photos',
      'bills',
      'pay_methods',
      'categories',
      'books',
      'refresh_tokens',
      'users',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS \`${table}\``);
    }
  }
}
