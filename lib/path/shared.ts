/**
 * lib/path 内部共用的常量与格式化工具（纯函数）。
 */
import type { EvidenceKind, RouteType } from '../types';

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

/** 数字展示：整数原样，小数保留一位。 */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, '');
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
