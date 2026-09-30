import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';

/**
 * 字典表种子数据（02 §2.4 / §2.5）。
 * 内容与 simple-bookkeeping.sql 中 categories / pay_methods 的 INSERT 记录逐字一致，
 * 保证前端"分类/支付方式"展示与历史生产库完全相同。
 */
const CATEGORY_SEEDS: Array<{
  id: number;
  type: 'expense' | 'income';
  name: string;
  icon: string;
  color: string;
  bg: string;
  sortOrder: number;
}> = [
  // 支出
  {
    id: 1,
    type: 'expense',
    name: '其他',
    icon: '📦',
    color: '#ff6a3d',
    bg: '#fff0ea',
    sortOrder: 0,
  },
  {
    id: 2,
    type: 'expense',
    name: '购物',
    icon: '🛍️',
    color: '#ff8f1f',
    bg: '#fff3e6',
    sortOrder: 1,
  },
  {
    id: 3,
    type: 'expense',
    name: '交通',
    icon: '🚌',
    color: '#4a8cff',
    bg: '#eaf2ff',
    sortOrder: 2,
  },
  {
    id: 4,
    type: 'expense',
    name: '娱乐',
    icon: '🎬',
    color: '#a45dff',
    bg: '#f4ecff',
    sortOrder: 3,
  },
  {
    id: 5,
    type: 'expense',
    name: '餐饮',
    icon: '🍽️',
    color: '#ff6a3d',
    bg: '#ffefea',
    sortOrder: 4,
  },
  {
    id: 6,
    type: 'expense',
    name: '住房',
    icon: '🏠',
    color: '#22b573',
    bg: '#e8f8f1',
    sortOrder: 5,
  },
  {
    id: 7,
    type: 'expense',
    name: '就医',
    icon: '💊',
    color: '#f2484b',
    bg: '#ffecec',
    sortOrder: 6,
  },
  {
    id: 8,
    type: 'expense',
    name: '教育',
    icon: '📚',
    color: '#2ea8e6',
    bg: '#e8f6fd',
    sortOrder: 7,
  },
  {
    id: 9,
    type: 'expense',
    name: '旅行',
    icon: '✈️',
    color: '#14b8a6',
    bg: '#e6f7f5',
    sortOrder: 8,
  },
  // 收入
  {
    id: 10,
    type: 'income',
    name: '其他',
    icon: '📦',
    color: '#ff6a3d',
    bg: '#fff0ea',
    sortOrder: 0,
  },
  {
    id: 11,
    type: 'income',
    name: '退还款',
    icon: '🔄',
    color: '#5b8ff9',
    bg: '#eaf2ff',
    sortOrder: 1,
  },
  {
    id: 12,
    type: 'income',
    name: '红包',
    icon: '🧧',
    color: '#ff7a45',
    bg: '#fff0e8',
    sortOrder: 2,
  },
  {
    id: 13,
    type: 'income',
    name: '收益',
    icon: '📈',
    color: '#34c759',
    bg: '#e9faf0',
    sortOrder: 3,
  },
  {
    id: 14,
    type: 'income',
    name: '礼金',
    icon: '🎁',
    color: '#ffb020',
    bg: '#fff7e3',
    sortOrder: 4,
  },
  {
    id: 15,
    type: 'income',
    name: '佣金',
    icon: '💰',
    color: '#b06be0',
    bg: '#f5edff',
    sortOrder: 5,
  },
  {
    id: 16,
    type: 'income',
    name: '工资',
    icon: '💵',
    color: '#f2484b',
    bg: '#ffecec',
    sortOrder: 6,
  },
];

const PAY_METHOD_SEEDS: Array<{
  id: number;
  name: string;
  shortName: string;
  color: string;
  bg: string;
  sortOrder: number;
}> = [
  {
    id: 1,
    name: '现金',
    shortName: '现',
    color: '#f2994a',
    bg: '#fdf2e4',
    sortOrder: 0,
  },
  {
    id: 2,
    name: '微信支付',
    shortName: '微',
    color: '#07c160',
    bg: '#e7f8ef',
    sortOrder: 1,
  },
  {
    id: 3,
    name: '支付宝',
    shortName: '支',
    color: '#1677ff',
    bg: '#e8f2ff',
    sortOrder: 2,
  },
  {
    id: 4,
    name: '信用卡',
    shortName: '信',
    color: '#ff7d00',
    bg: '#fff2e3',
    sortOrder: 3,
  },
  {
    id: 5,
    name: '储蓄卡',
    shortName: '卡',
    color: '#5a6072',
    bg: '#eef0f5',
    sortOrder: 4,
  },
];

/**
 * 字典种子数据初始化（04c §8 / §9）。
 *
 * 背景：TypeORM synchronize 只负责建表（DDL），不写入任何业务数据；
 * 字典表（categories / pay_methods）是系统级只读数据，必须在首次启动时填充，
 * 否则 /api/v1/categories、/api/v1/pay-methods 等接口返回空数组，账单录入也无法校验。
 *
 * 策略：应用启动后检查两张表是否为空，为空则按固定 id 批量插入（id 与生产库一致，
 * 便于账单数据迁移与对账）。幂等：已有数据则跳过，绝不覆盖。
 */
@Injectable()
export class DictionarySeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DictionarySeedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seedCategories();
      await this.seedPayMethods();
    } catch (err) {
      // 种子失败不应阻塞服务启动：记录错误后放行，运维可通过接口空数据现象感知
      this.logger.error(
        `字典种子数据初始化失败: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  private async seedCategories(): Promise<void> {
    const [{ count }] = await this.dataSource.query<Array<{ count: string }>>(
      'SELECT COUNT(*) AS count FROM categories',
    );
    if (Number(count) > 0) {
      this.logger.log(`categories 已有 ${count} 条记录，跳过种子写入`);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      for (const c of CATEGORY_SEEDS) {
        await manager.query(
          `INSERT INTO categories
            (id, type, name, icon, color, bg, sort_order, is_system, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
          [c.id, c.type, c.name, c.icon, c.color, c.bg, c.sortOrder],
        );
      }
    });

    // 清理可能残留的分类缓存（首次启动通常为空，保险起见）
    await this.redis.del(
      REDIS_KEYS.dictCategories('expense'),
      REDIS_KEYS.dictCategories('income'),
    );

    this.logger.log(`categories 种子写入完成，共 ${CATEGORY_SEEDS.length} 条`);
  }

  private async seedPayMethods(): Promise<void> {
    const [{ count }] = await this.dataSource.query<Array<{ count: string }>>(
      'SELECT COUNT(*) AS count FROM pay_methods',
    );
    if (Number(count) > 0) {
      this.logger.log(`pay_methods 已有 ${count} 条记录，跳过种子写入`);
      return;
    }

    await this.dataSource.transaction(async (manager) => {
      for (const p of PAY_METHOD_SEEDS) {
        await manager.query(
          `INSERT INTO pay_methods
            (id, name, short_name, color, bg, sort_order, is_system, status)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
          [p.id, p.name, p.shortName, p.color, p.bg, p.sortOrder],
        );
      }
    });

    await this.redis.del(REDIS_KEYS.dictPayMethods);

    this.logger.log(
      `pay_methods 种子写入完成，共 ${PAY_METHOD_SEEDS.length} 条`,
    );
  }
}
