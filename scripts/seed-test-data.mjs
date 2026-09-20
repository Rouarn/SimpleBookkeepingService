import mysql from 'mysql2/promise';
import { readdir, copyFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// ===== 配置 =====
const DB_CONFIG = {
  host: '127.0.0.1',
  port: 3306,
  user: 'root',
  password: '2001',
  database: 'dbtest',
};

const PHONE = '15638309893';
const IMAGE_DIR = '/Users/woyuxiaji/Pictures/storage/fulitu-cc';
const UPLOAD_DIR = resolve('./uploads');

// 分类（来自种子数据）
const EXPENSE_CATEGORIES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const INCOME_CATEGORIES = [10, 11, 12, 13, 14, 15, 16];
const PAY_METHODS = [1, 2, 3, 4, 5];

// 生成参数
const TOTAL_BILLS = 3000;
const PHOTO_RATIO = 0.85; // 85% 的账单有图片
const START_DATE = new Date('2022-01-01');
const END_DATE = new Date(); // 今天

// ===== 工具函数 =====
function pad2(n) {
  return String(n).padStart(2, '0');
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function buildKey(userId, date) {
  const stamp =
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`;
  const rand = randomBytes(4).toString('hex');
  return `bills/${userId}/${date.getFullYear()}/${pad2(date.getMonth() + 1)}/${pad2(date.getDate())}/${stamp}-${rand}.jpg`;
}

// 根据类型生成合理金额
function randomAmount(type) {
  if (type === 'expense') {
    // 支出：大部分小额，偶尔大额
    const r = Math.random();
    if (r < 0.6) return (randomInt(1, 5000) / 100).toFixed(2); // 0.01 - 50
    if (r < 0.9) return (randomInt(5001, 30000) / 100).toFixed(2); // 50.01 - 300
    return (randomInt(30001, 200000) / 100).toFixed(2); // 300.01 - 2000
  }
  // 收入：工资类较大，其他较小
  const r = Math.random();
  if (r < 0.3) return (randomInt(500000, 3000000) / 100).toFixed(2); // 5000 - 30000 (工资)
  if (r < 0.7) return (randomInt(10000, 500000) / 100).toFixed(2); // 100 - 5000
  return (randomInt(1, 10000) / 100).toFixed(2); // 0.01 - 100
}

// 备注池
const EXPENSE_REMARKS = [
  '', '', '', '', // 大部分无备注
  '午餐', '晚餐', '早餐', '地铁', '打车', '超市', '网购',
  '加油', '停车费', '电影', '咖啡', '奶茶', '水果', '蔬菜',
  '日用品', '话费', '电费', '水费', '燃气费', '房租',
  '看病', '买药', '买书', '培训', '机票', '酒店', '门票',
  '礼物', '红包', '聚餐', '理发', '健身', '快递',
];
const INCOME_REMARKS = [
  '', '', '',
  '工资', '奖金', '理财收益', '退款', '红包', '兼职', '礼金', '佣金',
];

async function main() {
  const conn = await mysql.createConnection(DB_CONFIG);

  // 获取用户和默认账本
  const [users] = await conn.query('SELECT id FROM users WHERE phone = ?', [PHONE]);
  if (users.length === 0) {
    console.error(`用户 ${PHONE} 不存在`);
    await conn.end();
    process.exit(1);
  }
  const userId = String(users[0].id);

  const [books] = await conn.query(
    'SELECT id FROM books WHERE user_id = ? AND is_default = 1 LIMIT 1',
    [userId],
  );
  if (books.length === 0) {
    console.error('用户没有默认账本');
    await conn.end();
    process.exit(1);
  }
  const bookId = String(books[0].id);

  console.log(`用户ID: ${userId}, 账本ID: ${bookId}`);

  // 读取图片列表
  const allFiles = await readdir(IMAGE_DIR);
  const images = allFiles.filter((f) => /\.(jpe?g|png)$/i.test(f));
  console.log(`可用图片数量: ${images.length}`);

  // 生成账单数据
  console.log(`开始生成 ${TOTAL_BILLS} 条账单记录...`);

  let insertedBills = 0;
  let insertedPhotos = 0;
  const batchSize = 100;

  for (let i = 0; i < TOTAL_BILLS; i += batchSize) {
    const batchEnd = Math.min(i + batchSize, TOTAL_BILLS);

    await conn.beginTransaction();
    try {
      for (let j = i; j < batchEnd; j++) {
        const date = randomDate(START_DATE, END_DATE);
        const isExpense = Math.random() < 0.72;
        const type = isExpense ? 'expense' : 'income';
        const categoryId = isExpense
          ? pick(EXPENSE_CATEGORIES)
          : pick(INCOME_CATEGORIES);
        const payMethodId = pick(PAY_METHODS);
        const amount = randomAmount(type);
        const recordDate = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
        const recordTime = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
        const remark = pick(isExpense ? EXPENSE_REMARKS : INCOME_REMARKS);

        const [result] = await conn.query(
          'INSERT INTO bills (user_id, book_id, category_id, pay_method_id, type, amount, record_date, record_time, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [userId, bookId, categoryId, payMethodId, type, amount, recordDate, recordTime, remark],
        );
        const billId = String(result.insertId);
        insertedBills++;

        // 添加图片
        if (Math.random() < PHOTO_RATIO) {
          const photoCount = randomInt(1, 3);
          const usedImages = new Set();
          for (let k = 0; k < photoCount; k++) {
            let image;
            do {
              image = pick(images);
            } while (usedImages.has(image) && usedImages.size < images.length);
            usedImages.add(image);

            const key = buildKey(userId, date);
            const destPath = join(UPLOAD_DIR, key);
            await mkdir(resolve(destPath, '..'), { recursive: true });
            await copyFile(join(IMAGE_DIR, image), destPath);

            await conn.query(
              'INSERT INTO bill_photos (bill_id, user_id, url, sort_order) VALUES (?, ?, ?, ?)',
              [billId, userId, key, k],
            );
            insertedPhotos++;
          }
        }
      }
      await conn.commit();
      console.log(`已完成 ${batchEnd}/${TOTAL_BILLS} (账单: ${insertedBills}, 图片: ${insertedPhotos})`);
    } catch (err) {
      await conn.rollback();
      console.error('批次插入失败:', err.message);
      throw err;
    }
  }

  // 统计结果
  const [billCount] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM bills WHERE user_id = ?',
    [userId],
  );
  const [photoCount] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM bill_photos WHERE user_id = ?',
    [userId],
  );
  const [yearStats] = await conn.query(
    "SELECT YEAR(record_date) AS year, type, COUNT(*) AS cnt FROM bills WHERE user_id = ? GROUP BY YEAR(record_date), type ORDER BY year, type",
    [userId],
  );

  console.log('\n===== 完成 =====');
  console.log(`账单总数: ${billCount[0].cnt}`);
  console.log(`图片总数: ${photoCount[0].cnt}`);
  console.log('\n按年份统计:');
  for (const row of yearStats) {
    console.log(`  ${row.year} ${row.type}: ${row.cnt} 条`);
  }

  await conn.end();
}

main().catch((err) => {
  console.error('脚本执行失败:', err);
  process.exit(1);
});
