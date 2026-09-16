import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 字典种子（02 §2.4 / §2.5）：16 分类 + 5 支付方式。
 * 显式指定稳定 id（与色值/图标同为契约的一部分），
 * ON DUPLICATE KEY UPDATE 保证迁移幂等可重入（06 §2.3）。
 */
export class SeedDictionaries1726400001000 implements MigrationInterface {
  name = 'SeedDictionaries1726400001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
INSERT INTO \`categories\` (\`id\`,\`type\`,\`name\`,\`icon\`,\`color\`,\`bg\`,\`sort_order\`) VALUES
(1, 'expense','其他','📦','#ff6a3d','#fff0ea',0),
(2, 'expense','购物','🛍️','#ff8f1f','#fff3e6',1),
(3, 'expense','交通','🚌','#4a8cff','#eaf2ff',2),
(4, 'expense','娱乐','🎬','#a45dff','#f4ecff',3),
(5, 'expense','餐饮','🍽️','#ff6a3d','#ffefea',4),
(6, 'expense','住房','🏠','#22b573','#e8f8f1',5),
(7, 'expense','就医','💊','#f2484b','#ffecec',6),
(8, 'expense','教育','📚','#2ea8e6','#e8f6fd',7),
(9, 'expense','旅行','✈️','#14b8a6','#e6f7f5',8),
(10,'income','其他','📦','#ff6a3d','#fff0ea',0),
(11,'income','退还款','🔄','#5b8ff9','#eaf2ff',1),
(12,'income','红包','🧧','#ff7a45','#fff0e8',2),
(13,'income','收益','📈','#34c759','#e9faf0',3),
(14,'income','礼金','🎁','#ffb020','#fff7e3',4),
(15,'income','佣金','💰','#b06be0','#f5edff',5),
(16,'income','工资','💵','#f2484b','#ffecec',6)
ON DUPLICATE KEY UPDATE
  \`icon\` = VALUES(\`icon\`),
  \`color\` = VALUES(\`color\`),
  \`bg\` = VALUES(\`bg\`),
  \`sort_order\` = VALUES(\`sort_order\`),
  \`is_system\` = 1,
  \`status\` = 1`);

    await queryRunner.query(`
INSERT INTO \`pay_methods\` (\`id\`,\`name\`,\`short_name\`,\`color\`,\`bg\`,\`sort_order\`) VALUES
(1,'现金','现','#f2994a','#fdf2e4',0),
(2,'微信支付','微','#07c160','#e7f8ef',1),
(3,'支付宝','支','#1677ff','#e8f2ff',2),
(4,'信用卡','信','#ff7d00','#fff2e3',3),
(5,'储蓄卡','卡','#5a6072','#eef0f5',4)
ON DUPLICATE KEY UPDATE
  \`short_name\` = VALUES(\`short_name\`),
  \`color\` = VALUES(\`color\`),
  \`bg\` = VALUES(\`bg\`),
  \`sort_order\` = VALUES(\`sort_order\`),
  \`is_system\` = 1,
  \`status\` = 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 系统字典回滚：按固定 id 删除
    await queryRunner.query(
      `DELETE FROM \`pay_methods\` WHERE \`id\` BETWEEN 1 AND 5`,
    );
    await queryRunner.query(
      `DELETE FROM \`categories\` WHERE \`id\` BETWEEN 1 AND 16`,
    );
  }
}
