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

/**
 * 把「我们的说明」（parseSourceText 的 notes，或整段非官方原文）拆成正文和出处信息，供界面把出处收进小按钮里。纯函数，不改写原句：
 * - url：`Source: <网址>` 里的网址（去掉句末标点）；
 * - verified：`Verified by <人> on <日期>.` 整句；
 * - estimate_note：讲「时间和费用是估算」的整句（`Preparation hours and cost are …` / `Time and cost are …`）；
 * - body：去掉上面三项后的剩余文字，并去掉开头的 `Human-verified application instructions:`（这类说明一律是人工核实的，
 *   在出处信息里写明）；空则 null。
 * 找不到的项为 null；全部找不到时 body 就是原文。
 */
export interface SourceNoteParts {
  body: string | null;
  url: string | null;
  verified: string | null;
  estimate_note: string | null;
  human_verified: boolean;
}

const URL_RE = /Source:\s*(https?:\/\/\S+?)(?=[.,;)]?(?:\s|$))[.,;)]?/i;
const VERIFIED_RE = /Verified by [^.]*? on \d{4}-\d{2}-\d{2}\.?/i;
const ESTIMATE_RE = /(?:Preparation hours and cost|Time and cost) are (?:team )?estimates[^.]*\./i;
const HUMAN_RE = /^\s*Human-verified application instructions:\s*/i;

export function splitSourceNote(note: string | null | undefined): SourceNoteParts {
  if (typeof note !== 'string' || note.trim() === '') {
    return { body: null, url: null, verified: null, estimate_note: null, human_verified: false };
  }
  let rest = note;
  const url = URL_RE.exec(rest);
  if (url) rest = rest.replace(url[0], ' ');
  const verified = VERIFIED_RE.exec(rest);
  if (verified) rest = rest.replace(verified[0], ' ');
  const estimate = ESTIMATE_RE.exec(rest);
  if (estimate) rest = rest.replace(estimate[0], ' ');
  const human = HUMAN_RE.test(rest);
  if (human) rest = rest.replace(HUMAN_RE, '');
  return {
    body: orNull(rest.replace(/\s+/g, ' ')),
    url: url ? url[1] : null,
    verified: verified ? verified[0].trim().replace(/\.?$/, '.') : null,
    estimate_note: estimate ? estimate[0].trim() : null,
    human_verified: human,
  };
}
