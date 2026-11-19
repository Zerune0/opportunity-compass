/**
 * Quest Journal 的纯函数（不读写存储；存储见 lib/store.ts）。
 *
 * JournalEntry 的 application / eligibility_confirmation / decision / participated 四项互相独立，
 * 页面必须分开显示。journalHeadline 只是给列表用的一句话摘要，不能代替这四项的分开显示。
 */
import { JOURNAL_EVENTS, type ISODate, type JournalEntry, type JournalEvent, type JournalHistoryItem } from './types';

export function isJournalEvent(v: unknown): v is JournalEvent {
  return typeof v === 'string' && (JOURNAL_EVENTS as readonly string[]).includes(v);
}

/**
 * 把一个事件应用到条目上（返回新对象，不修改输入）：按 JournalEvent 的注释更新对应字段，并追加
 * `{ event, on }` 到 history——与 history 最后一条完全相同（同一事件、同一天）时不重复追加（字段照常按事件设置，连续重复调用结果幂等）；
 * 中间隔了别的事件（例如记录 → 清除 → 再记录）则照常追加。
 *
 * 不阻止「不合常理」的顺序（如没提交就记 admitted、退出后记 participated）：学生记录的是现实，
 * 系统不替他判断。页面应当引导而不是拦截：
 * - 还没提交（application 不是 submitted）时，录取结果、资格确认的按钮放在次要位置，并提示「通常在提交后才会有」；
 * - 记 admitted / not_admitted、eligibility_* 时若 application 仍是 preparing，询问是否同时记一次 submitted；
 * - 已 withdrawn 时把「重新开始」（reopened）放在显眼处；
 * - 无论哪种组合，四项都分开显示，不合并成一个状态。
 *
 * 更正事件（eligibility_cleared / decision_cleared / participation_cleared）把对应一项恢复成未记录，
 * history 照常追加（撤回也如实留痕，不删除旧记录）。申请进度的更正用 reopened。
 * on 可以是过去的日期（补记）；本函数不读系统时钟，也不检查 on 是否晚于今天（由页面用 resolveRecordDate 限制）。
 */
export function applyJournalEvent(entry: JournalEntry, event: JournalEvent, on: ISODate): JournalEntry {
  const next: JournalEntry = { ...entry };
  switch (event) {
    case 'added':
      break;
    case 'submitted':
      next.application = 'submitted';
      next.submitted_on = on;
      break;
    case 'withdrawn':
      next.application = 'withdrawn';
      break;
    case 'reopened':
      next.application = 'preparing';
      next.submitted_on = null;
      break;
    case 'eligibility_confirmed':
      next.eligibility_confirmation = 'confirmed';
      break;
    case 'eligibility_rejected':
      next.eligibility_confirmation = 'rejected';
      break;
    case 'admitted':
      next.decision = 'admitted';
      break;
    case 'not_admitted':
      next.decision = 'not_admitted';
      break;
    case 'participated':
      next.participated = true;
      break;
    case 'did_not_participate':
      next.participated = false;
      break;
    // 更正事件：恢复成「未记录」（与 createJournalEntry 的初始值相同），只改自己那一项。
    case 'eligibility_cleared':
      next.eligibility_confirmation = 'unconfirmed';
      break;
    case 'decision_cleared':
      next.decision = 'pending';
      break;
    case 'participation_cleared':
      next.participated = null;
      break;
  }
  const history = Array.isArray(entry.history) ? entry.history : [];
  // 只和最后一条比：连续重复（同一事件、同一天）不追加；中间隔了别的事件（如清除后再记）照常追加，
  // 这样 history 的最后一条始终对应最近一次记录。
  const last = history[history.length - 1];
  const already = !!last && last.event === event && last.on === on;
  next.history = already ? [...history] : [...history, { event, on }];
  return next;
}

/**
 * 列表用的一句话摘要（英文，面向学生），由四项字段派生、不存储。
 * 只说学生记录了什么，不推断没记录的事（如提交了不代表资格已确认）。
 */
export function journalHeadline(entry: JournalEntry): string {
  const parts: string[] = [];
  if (entry.application === 'withdrawn') parts.push('Withdrawn');
  else if (entry.application === 'submitted') parts.push(entry.submitted_on ? `Submitted on ${entry.submitted_on}` : 'Submitted');
  else parts.push('Preparing');

  if (entry.eligibility_confirmation === 'confirmed') parts.push('eligibility confirmed by the organizer');
  else if (entry.eligibility_confirmation === 'rejected') parts.push('organizer said not eligible');

  if (entry.decision === 'admitted') parts.push('admitted');
  else if (entry.decision === 'not_admitted') parts.push('not admitted');

  if (entry.participated === true) parts.push('took part');
  else if (entry.participated === false) parts.push('did not take part');

  return parts.join(' · ');
}

/**
 * 按日期排序的 history（返回新数组，不修改输入）：日期早的在前；同一天保持记录先后。
 * 用于显示——因为日期可以补记，history 的存储顺序（记录先后）不一定按日期递增。
 */
export function sortJournalHistory(history: readonly JournalHistoryItem[]): JournalHistoryItem[] {
  return history
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.on === b.item.on ? a.index - b.index : a.item.on < b.item.on ? -1 : 1))
    .map(({ item }) => item);
}

function isValidISODate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const daysInMonth = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= daysInMonth;
}

/**
 * 页面上「记录日期」输入框的取值规则（today 由页面传入，本函数不读系统时钟）：
 * 合法的 YYYY-MM-DD 且不晚于 today → 原样返回；空、非法或晚于 today → 返回 today。
 */
export function resolveRecordDate(input: string | null | undefined, today: ISODate): ISODate {
  const v = typeof input === 'string' ? input.trim() : '';
  if (!isValidISODate(v)) return today;
  return v > today ? today : v;
}
