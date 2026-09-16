import { Inject, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import {
  REDIS_CLIENT,
  REDIS_KEYS,
} from '../../../common/redis/redis.constants.js';
import { BusinessException } from '../../../common/exceptions/business.exception.js';
import { ERROR_CODES } from '../../../common/exceptions/error-codes.js';

export interface PayMethodVo {
  id: string;
  name: string;
  shortName: string;
  color: string;
  bg: string;
}

/** 校验通过后供账单模块组装 VO 的支付方式行（列名与表一致）。 */
export interface ValidatedPayMethod {
  id: string;
  name: string;
  short_name: string;
  color: string;
  bg: string;
}

const CACHE_TTL_SECONDS = 24 * 60 * 60;

interface PayMethodRow {
  id: string | number;
  name: string;
  short_name: string;
  color: string;
  bg: string;
  sort_order: number;
}

function toVo(row: PayMethodRow): PayMethodVo {
  return {
    id: String(row.id),
    name: row.name,
    shortName: row.short_name,
    color: row.color,
    bg: row.bg,
  };
}

/**
 * 支付方式字典（04c §9）：仅返回启用项，Redis 缓存 24h。
 * getPayMethodOrFail 供账单写入校验（42201）。
 */
@Injectable()
export class PayMethodsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async list(): Promise<PayMethodVo[]> {
    const cached = await this.redis.get(REDIS_KEYS.dictPayMethods);
    if (cached) {
      try {
        return JSON.parse(cached) as PayMethodVo[];
      } catch {
        // 缓存内容损坏：摘除后回源，避免 500
        await this.redis.del(REDIS_KEYS.dictPayMethods);
      }
    }

    const rows = await this.dataSource.query<PayMethodRow[]>(
      'SELECT id, name, short_name, color, bg, sort_order FROM pay_methods WHERE status = 1 ORDER BY sort_order ASC, id ASC',
    );
    const list = rows.map(toVo);
    await this.redis.set(
      REDIS_KEYS.dictPayMethods,
      JSON.stringify(list),
      'EX',
      CACHE_TTL_SECONDS,
    );
    return list;
  }

  /** 校验支付方式存在且启用；否则 42201。 */
  async getPayMethodOrFail(id: string): Promise<ValidatedPayMethod> {
    const rows = await this.dataSource.query<ValidatedPayMethod[]>(
      'SELECT id, name, short_name, color, bg FROM pay_methods WHERE id = ? AND status = 1 LIMIT 1',
      [id],
    );
    const payMethod = rows[0];
    if (!payMethod) {
      throw new BusinessException(
        ERROR_CODES.PAY_METHOD_INVALID.code,
        ERROR_CODES.PAY_METHOD_INVALID.httpStatus,
        ERROR_CODES.PAY_METHOD_INVALID.message,
      );
    }
    return payMethod;
  }
}
