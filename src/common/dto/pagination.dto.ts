import { Transform } from 'class-transformer';
import { IsOptional } from 'class-validator';

/**
 * 分页查询基类（03 §3.2）：page 从 1 开始，pageSize 默认 20、1~100；
 * 非法值回退默认值而非报错。
 */
export class PaginationQueryDto {
  @Transform(({ value }) => normalizePage(value))
  @IsOptional()
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
  return toPositiveInt(value) ?? 1;
}

function normalizePageSize(value: unknown): number {
  const num = toPositiveInt(value) ?? 20;
  return Math.min(num, 100);
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
