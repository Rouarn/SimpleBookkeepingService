/**
 * 金额工具（README §三·2 / 05 §3.4）。
 * 与客户端 bill.js 的 round2 完全同口径：先乘 100 四舍五入再除回，禁止浮点累加。
 * DECIMAL 经 mysql2 取出是字符串，统一经本函数转 number。
 * 金额上限常量统一收口到 common/constants（P2-12），此处转出保持旧引用路径可用。
 */
export { MAX_AMOUNT } from '../constants/business-limits.js';

/**
 * 元 → 分的四舍五入（整数分运算，避免浮点误差）。
 * 关键：加 Number.EPSILON 修正二进制浮点天然偏小，例如
 * 1.005 在 IEEE-754 中实际存储为 1.00499999999999989...，
 * 直接 Math.round(1.005 * 100) 会错误得到 100；
 * 加上幅度对应的 EPSILON（2^-52）后再乘 100，可正确进位为 101。
 */
export function round2(value: number | string | null | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 金额比较：a > b（同为整数分口径，加 EPSILON 防浮点边界误判） */
export function greaterThan(a: number, b: number): boolean {
  return (
    Math.round((a + Number.EPSILON) * 100) >
    Math.round((b + Number.EPSILON) * 100)
  );
}
