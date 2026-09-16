/**
 * 文本长度工具（03 §10）：按 Unicode 码点计数，emoji 等代理对字符算 1。
 */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}
