/**
 * 日历导出（纯函数）：把 Quest Journal 里各机会的截止日期生成 iCalendar（RFC 5545）文本。
 *
 * - 每个有合法截止日期的机会一个全天事件（DTSTART;VALUE=DATE + DTEND 为次日）。
 *   截止的具体时间（deadline_note）只写在 DESCRIPTION 里，因为全天事件没有时刻。
 * - includeProgramDates 为 true 且起止日期都合法（结束不早于开始）时，另加一个全天多日事件。
 * - 不加提醒（VALARM）：学生在自己的日历里加。
 * - 不读系统时钟：DTSTAMP 用 options.generatedOn（非法时用固定的 19700101T000000Z）。
 * - 永不抛异常：非数组、非对象条目、缺字段、非法日期一律安全跳过。
 */
import type { ISODate, JournalApplicationStatus } from './types';

export interface CalendarItem {
  opportunity_id: string;
  title: string;
  deadline: ISODate | null;
  deadline_note?: string | null;
  official_url?: string | null;
  application?: JournalApplicationStatus;
  program_start?: ISODate | null;
  program_end?: ISODate | null;
}

export interface CalendarOptions {
  /** 生成日期（YYYY-MM-DD），用作 DTSTAMP；由调用方传入。 */
  generatedOn: ISODate;
  includeProgramDates?: boolean;
}

/** 没进日历的原因：没有截止日期 / 截止日期无法读取 / 已撤回（withdrawn）。 */
export type CalendarSkipReason = 'no_deadline' | 'invalid_deadline' | 'withdrawn';

export interface CalendarSkipped {
  opportunity_id: string;
  title: string;
  reason: CalendarSkipReason;
}

export interface CalendarResult {
  /** iCalendar 文本，CRLF 换行，以 CRLF 结尾。 */
  ics: string;
  /** 生成了截止事件的机会 id（按输入顺序）。 */
  included: string[];
  /** 生成了参与期事件的机会 id（只在 includeProgramDates 为 true 时可能非空）。 */
  program_included: string[];
  /** 没生成截止事件的机会（按输入顺序）。没有字符串 id 的条目、重复的 id 不列出。 */
  skipped: CalendarSkipped[];
}

export const CALENDAR_PRODID = '-//Opportunity Compass//Quest Journal Deadlines//EN';
export const CALENDAR_FOOTER =
  'From your Opportunity Compass Quest Journal. Dates come from the catalog; confirm on the official page.';
export const CALENDAR_TIME_HINT = 'Check the official page for the exact time.';

const CRLF = '\r\n';
const FALLBACK_DTSTAMP = '19700101T000000Z';

interface DateParts {
  y: number;
  m: number;
  d: number;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** 严格解析 YYYY-MM-DD；不存在的日期（如 2027-02-30）返回 null。 */
export function parseCalendarDate(value: unknown): DateParts | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function nextDay({ y, m, d }: DateParts): DateParts {
  if (d < daysInMonth(y, m)) return { y, m, d: d + 1 };
  if (m < 12) return { y, m: m + 1, d: 1 };
  return { y: y + 1, m: 1, d: 1 };
}

function compareDates(a: DateParts, b: DateParts): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

function basicDate({ y, m, d }: DateParts): string {
  return `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;
}

function isoDate({ y, m, d }: DateParts): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 去掉换行以外的控制字符（含 DEL），统一换行为 \n。 */
function cleanText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
}

/** RFC 5545 TEXT 转义：反斜杠、分号、逗号、换行。 */
export function escapeCalendarText(value: string): string {
  return cleanText(value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

/**
 * 按 RFC 5545 折行：每行（不含 CRLF）不超过 75 个 UTF-8 字节，续行以一个空格开头（空格计入 75）。
 * 按码点切分，不会切断多字节字符。
 */
export function foldCalendarLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = utf8Length(char);
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join(CRLF);
}

/** 只接受 http / https 的绝对地址，返回规范化后的 href；否则 null。 */
function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (/[\s\u0000-\u001F\u007F]/.test(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** FNV-1a 32 位哈希（十六进制），用于让清洗后的 UID 仍然唯一。 */
function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** UID 的 id 部分：只保留 A-Z a-z 0-9 . _ -；清洗过的加原 id 的哈希，避免 "a b" 与 "a-b" 撞车。 */
export function calendarUidPart(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 80);
  if (cleaned === id && cleaned !== '') return cleaned;
  return `${cleaned || 'item'}-${hash(id)}`;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = cleanText(value).trim();
  return cleaned === '' ? null : cleaned;
}

function event(lines: string[]): string[] {
  return ['BEGIN:VEVENT', ...lines, 'END:VEVENT'];
}

export function buildDeadlineCalendar(items: unknown, options: unknown): CalendarResult {
  const opts = (typeof options === 'object' && options !== null ? options : {}) as Partial<CalendarOptions>;
  const stampDate = parseCalendarDate(opts.generatedOn);
  const dtstamp = stampDate ? `${basicDate(stampDate)}T000000Z` : FALLBACK_DTSTAMP;
  const includeProgram = opts.includeProgramDates === true;

  const included: string[] = [];
  const programIncluded: string[] = [];
  const skipped: CalendarSkipped[] = [];
  const seenIds = new Set<string>();
  const usedUids = new Set<string>();
  const events: string[] = [];

  const uniqueUid = (base: string): string => {
    let uid = base;
    let n = 2;
    while (usedUids.has(uid)) {
      uid = base.replace('@', `-${n}@`);
      n += 1;
    }
    usedUids.add(uid);
    return uid;
  };

  const list: unknown[] = Array.isArray(items) ? items : [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const id = typeof item.opportunity_id === 'string' ? item.opportunity_id : null;
    if (id === null || id.trim() === '' || seenIds.has(id)) continue;
    seenIds.add(id);
    const title = textOrNull(item.title) ?? id;

    if (item.application === 'withdrawn') {
      skipped.push({ opportunity_id: id, title, reason: 'withdrawn' });
      continue;
    }

    const url = safeUrl(item.official_url);
    const uidPart = calendarUidPart(id);
    const deadline = parseCalendarDate(item.deadline);

    if (deadline) {
      const note = textOrNull(item.deadline_note);
      const description = [
        `Deadline: ${isoDate(deadline)}${note ? ` (${note})` : ''}.`,
        CALENDAR_TIME_HINT,
        ...(url ? [`Official page: ${url}`] : []),
        CALENDAR_FOOTER,
      ].join('\n');
      events.push(
        ...event([
          `UID:${uniqueUid(`${uidPart}-deadline@opportunity-compass`)}`,
          `DTSTAMP:${dtstamp}`,
          `DTSTART;VALUE=DATE:${basicDate(deadline)}`,
          `DTEND;VALUE=DATE:${basicDate(nextDay(deadline))}`,
          `SUMMARY:${escapeCalendarText(`Deadline: ${title}`)}`,
          `DESCRIPTION:${escapeCalendarText(description)}`,
          ...(url ? [`URL:${url}`] : []),
          'TRANSP:TRANSPARENT',
        ]),
      );
      included.push(id);
    } else {
      const hasValue = item.deadline !== null && item.deadline !== undefined && item.deadline !== '';
      skipped.push({ opportunity_id: id, title, reason: hasValue ? 'invalid_deadline' : 'no_deadline' });
    }

    if (includeProgram) {
      const start = parseCalendarDate(item.program_start);
      const end = parseCalendarDate(item.program_end);
      if (start && end && compareDates(start, end) <= 0) {
        const description = [
          `Program dates in the catalog: ${isoDate(start)} to ${isoDate(end)}.`,
          ...(url ? [`Official page: ${url}`] : []),
          CALENDAR_FOOTER,
        ].join('\n');
        events.push(
          ...event([
            `UID:${uniqueUid(`${uidPart}-program@opportunity-compass`)}`,
            `DTSTAMP:${dtstamp}`,
            `DTSTART;VALUE=DATE:${basicDate(start)}`,
            `DTEND;VALUE=DATE:${basicDate(nextDay(end))}`,
            `SUMMARY:${escapeCalendarText(`Program: ${title}`)}`,
            `DESCRIPTION:${escapeCalendarText(description)}`,
            ...(url ? [`URL:${url}`] : []),
            'TRANSP:TRANSPARENT',
          ]),
        );
        programIncluded.push(id);
      }
    }
  }

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${CALENDAR_PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Opportunity Compass deadlines',
    ...events,
    'END:VCALENDAR',
  ];

  return {
    ics: lines.map(foldCalendarLine).join(CRLF) + CRLF,
    included,
    program_included: programIncluded,
    skipped,
  };
}
