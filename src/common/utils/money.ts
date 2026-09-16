/**
 * 金额工具（README §三·2 / 05 §3.4）。
 * 与客户端 bill.js 的 round2 完全同口径：先乘 100 四舍五入再除回，禁止浮点累加。
 * DECIMAL 经 mysql2 取出是字符串，统一经本函数转 number。
 */
export function round2(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** 金额比较：a > b */
export function greaterThan(a: number, b: number): boolean {
  return Math.round(a * 100) > Math.round(b * 100);
}

/** 金额上限（03 §10：0 < x ≤ 99,999,999.99） */
export const MAX_AMOUNT = 99_999_999.99;
