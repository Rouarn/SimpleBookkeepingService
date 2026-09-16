import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import type { BillType } from '../../../entities/category.entity.js';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

export interface CategoryVo {
  id: string;
  name: string;
  icon: string;
  color: string;
  bg: string;
}

/** 校验通过后供账单模块组装 VO 的分类行（列名与表一致）。 */
export interface ValidatedCategory extends CategoryVo {
  type: BillType;
}

const CACHE_TTL_SECONDS = 24 * 60 * 60;

interface CategoryRow {
  id: string | number;
  name: string;
  icon: string;
  color: string;
  bg: string;
  type: BillType;
  sort_order: number;
}

function toVo(row: CategoryRow): CategoryVo {
  return {
    id: String(row.id),
    name: row.name,
    icon: row.icon,
    color: row.color,
    bg: row.bg,
  };
}

/**
 * 收支分类字典（04c §8）：系统种子、全局只读，Redis 缓存 24h。
 * getCategoryOrFail 供账单写入校验（42200）。
 */
@Injectable()
export class CategoriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** 指定 type 返回数组；不传返回 { expense, income } 分组。 */
  async list(
    type?: BillType,
  ): Promise<CategoryVo[] | { expense: CategoryVo[]; income: CategoryVo[] }> {
    if (type) return this.listByType(type);
    const [expense, income] = await Promise.all([
      this.listByType('expense'),
      this.listByType('income'),
    ]);
    return { expense, income };
  }

  /** 校验分类存在、启用且与收支类型匹配；不匹配抛 42200。 */
  async getCategoryOrFail(
    id: string,
    type: BillType,
  ): Promise<ValidatedCategory> {
    const rows = await this.dataSource.query<
      Array<ValidatedCategory & { status: number }>
    >(
      'SELECT id, type, name, icon, color, bg, status FROM categories WHERE id = ? LIMIT 1',
      [id],
    );
    const category = rows[0];
    if (!category || Number(category.status) !== 1 || category.type !== type) {
      throw new BusinessException(
        ERROR_CODES.CATEGORY_INVALID.code,
        ERROR_CODES.CATEGORY_INVALID.httpStatus,
        ERROR_CODES.CATEGORY_INVALID.message,
      );
    }
    return category;
  }

  private async listByType(type: BillType): Promise<CategoryVo[]> {
    const cacheKey = REDIS_KEYS.dictCategories(type);
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as CategoryVo[];
      } catch {
        // 缓存内容损坏：摘除后回源，避免 500
        await this.redis.del(cacheKey);
      }
    }

    const rows = await this.dataSource.query<CategoryRow[]>(
      'SELECT id, name, icon, color, bg, type, sort_order FROM categories WHERE type = ? AND status = 1 ORDER BY sort_order ASC, id ASC',
      [type],
    );
    const list = rows.map(toVo);
    await this.redis.set(
      cacheKey,
      JSON.stringify(list),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return list;
  }
}
