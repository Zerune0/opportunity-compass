/**
 * Quest Journal 的纯函数（不读写存储；存储见 lib/store.ts）。
 *
 * JournalEntry 的 application / eligibility_confirmation / decision / participated 四项互相独立，
 * 页面必须分开显示。journalHeadline 只是给列表用的一句话摘要，不能代替这四项的分开显示。
 */
import { JOURNAL_EVENTS, type ISODate, type JournalEntry, type JournalEvent } from './types';

export function isJournalEvent(v: unknown): v is JournalEvent {
  return typeof v === 'string' && (JOURNAL_EVENTS as readonly string[]).includes(v);
}

/**
 * 把一个事件应用到条目上（返回新对象，不修改输入）：按 JournalEvent 的注释更新对应字段，并追加
 * `{ event, on }` 到 history——同一事件同一天已经记过时不重复追加（字段照常按事件设置，结果幂等）。
 *
 * 不阻止「不合常理」的顺序（如没提交就记 admitted、退出后记 participated）：学生记录的是现实，
 * 系统不替他判断。页面应当引导而不是拦截：
 * - 还没提交（application 不是 submitted）时，录取结果、资格确认的按钮放在次要位置，并提示「通常在提交后才会有」；
 * - 记 admitted / not_admitted、eligibility_* 时若 application 仍是 preparing，询问是否同时记一次 submitted；
 * - 已 withdrawn 时把「重新开始」（reopened）放在显眼处；
 * - 无论哪种组合，四项都分开显示，不合并成一个状态。
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
  }
  const history = Array.isArray(entry.history) ? entry.history : [];
  const already = history.some((h) => h.event === event && h.on === on);
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
