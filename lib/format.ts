/** 通用数字格式化（纯函数），lib/reachability 与 lib/path 共用。 */

/** 数字展示：整数原样，小数保留一位。 */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}
