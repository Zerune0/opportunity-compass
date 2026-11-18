/** 通用数字格式化（纯函数），lib/reachability 与 lib/path 共用。 */

/** 数字展示：整数原样，小数保留一位。 */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * Noun form agreeing with n: singular only when n displays as "1" (after fmt).
 * pluralForm defaults to singular + "s"; pass it for irregular plurals.
 */
export function pluralNoun(n: number, singular: string, pluralForm: string = `${singular}s`): string {
  return fmt(n) === '1' ? singular : pluralForm;
}

/** "N noun" with agreement: plural(1, 'measure') → "1 measure"; plural(2, 'measure') → "2 measures". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${fmt(n)} ${pluralNoun(n, singular, pluralForm)}`;
}

/** Joins items as natural English: "A", "A and B", "A, B and C". */
export function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
