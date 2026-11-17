/**
 * lib/path 内部共用的常量与格式化工具（纯函数）。
 */
import { fmt } from '../format';
import type { EvidenceKind, RouteType } from '../types';

export { fmt };

export const ROUTE_TITLES: Record<RouteType, string> = {
  learning_first: '学习优先',
  practice_first: '实践优先',
  community: '社区协作',
};

/** 实践类准备项：evidence_kind 属于这些种类。其余（含未填）为学习 / 材料类。 */
export const PRACTICE_KINDS: readonly EvidenceKind[] = [
  'project',
  'portfolio',
  'competition_result',
  'work_experience',
  'volunteer_experience',
];

export const SUBMIT_STEP_ID = 'submit-application';
export const PARTNER_STEP_ID = 'find-partner';
export const RESERVED_STEP_IDS: readonly string[] = [SUBMIT_STEP_ID, PARTNER_STEP_ID];

/** 报名费未写清时路线上的提醒；plan 生成、diff 用它判断「未写清 ↔ 有数字」。 */
export const FEE_UNKNOWN_WARNING = '报名费官网未写清，未计入费用，请向官方确认。';

/**
 * 结构化深比较（只处理 JSON 类数据：原始值、数组、普通对象），对对象键顺序不敏感。
 * 值为 undefined 的键视同不存在，与 JSON 序列化一致。
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}


/** 金额展示，如 `$20`。 */
export function usd(n: number): string {
  return `$${fmt(n)}`;
}

/** 浮点求和后统一保留两位小数，避免 0.1 + 0.2 之类的误差。 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 有限非负数，否则 0。 */
export function safeNonNeg(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}
