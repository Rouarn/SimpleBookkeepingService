import { Transform } from 'class-transformer';
import { IsOptional, Max } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../constants/business-limits.js';

/**
 * 分页查询基类（03 §3.2）：page 从 1 开始，pageSize 默认 20、1~100；
 * 非法页码/页大小回退默认值而非报错；page 超过 MAX_PAGE（10000，P2-12 防恶意深
 * 翻页）不做静默回退，交由 @Max 直接 400 校验失败。
 */
export class PaginationQueryDto {
  @Transform(({ value }) => normalizePage(value))
  @IsOptional()
  @Max(MAX_PAGE, { message: `页码不能超过 ${MAX_PAGE}` })
  page!: number;

  @Transform(({ value }) => normalizePageSize(value))
  @IsOptional()
  pageSize!: number;
}

function toPositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 1) return null;
  return num;
}

function normalizePage(value: unknown): number {
  // 超出上限的正整数原样返回：由 @Max 触发 400，避免静默回退到第 1 页掩盖异常调用
  return toPositiveInt(value) ?? 1;
}

function normalizePageSize(value: unknown): number {
  const num = toPositiveInt(value) ?? DEFAULT_PAGE_SIZE;
  return Math.min(num, MAX_PAGE_SIZE);
}

/** 统一分页响应骨架（03 §3.2）。 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function buildPaginationMeta(
  page: number,
  pageSize: number,
  total: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
