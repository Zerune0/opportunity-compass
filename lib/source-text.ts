/**
 * 准备项 source_text 的写法约定（见 CONTRACT.md「数据约定」）：
 * 官方必需的准备项写作 `Official excerpt: "<官网原文>" <我们自己的核实说明…>`。
 * parseSourceText 把它拆成「主办方原文」（excerpt）和「我们的说明」（notes），纯函数，不猜。
 *
 * - 以 `Official excerpt:`（忽略大小写和前导空白）开头：marked_official = true。
 *   冒号后（跳过空白）紧跟一段成对引号时，excerpt = 引号内的内容，notes = 引号后剩下的文字（trim，空则 null）。
 *   支持直引号 "…"（取到下一个直引号为止，内部的弯引号原样保留）和弯引号 “…”（按嵌套层数配对）。
 *   找不到成对引号时：excerpt = 冒号后的全部文字（trim，空则 null），notes = null。
 * - 其他情况：marked_official = false，excerpt = null，notes = 原文（trim，空则 null）。
 */
export interface ParsedSourceText {
  excerpt: string | null;
  notes: string | null;
  marked_official: boolean;
}

const PREFIX_RE = /^\s*official excerpt:/i;

const orNull = (s: string): string | null => {
  const t = s.trim();
  return t === '' ? null : t;
};

/** 从 rest[0] 的开引号起找配对的闭引号下标；找不到返回 -1。 */
function closingQuoteIndex(rest: string): number {
  const open = rest[0];
  if (open === '"') return rest.indexOf('"', 1);
  if (open === '“') {
    let depth = 0;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '“') depth++;
      else if (rest[i] === '”') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

export function parseSourceText(text: string | null | undefined): ParsedSourceText {
  if (typeof text !== 'string') return { excerpt: null, notes: null, marked_official: false };
  const m = PREFIX_RE.exec(text);
  if (!m) return { excerpt: null, notes: orNull(text), marked_official: false };

  const rest = text.slice(m[0].length).trimStart();
  const close = closingQuoteIndex(rest);
  if (close < 0) return { excerpt: orNull(rest), notes: null, marked_official: true };
  return {
    excerpt: orNull(rest.slice(1, close)),
    notes: orNull(rest.slice(close + 1)),
    marked_official: true,
  };
}
