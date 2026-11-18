/**
 * 第二阶段四个新函数共用的输入防护（纯函数）。
 *
 * 第一阶段的引擎（checkEligibility / analyzeReachability / planRoutes）假设输入符合 lib/types.ts；
 * 第二阶段的新函数承诺「对任何输入都不抛异常」，所以先做最小的整理：
 * - 只把「空就是没有」的数组字段补成 []：profile.evidence（及每条证据的 skills）、opp.preparation、
 *   opp.required_devices、opp.fields。这些字段为空数组的含义本来就是「没有」，不算猜测。
 * - 其他缺失字段（如 requirements、cost、location）不补默认值——补了就等于替学生 / 主办方猜；
 *   引擎因此抛错时，由调用方 try/catch 退回到「信息不足」的结果。
 * - 返回新对象，不修改输入。
 *
 * 公平性：只做展开复制，不读取学校名、显示名。
 */
import type { EvidenceItem, Opportunity, PrepItem, StudentProfile } from '../types';

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function asStringArray(v: unknown): string[] {
  return asArray<unknown>(v).filter((x): x is string => typeof x === 'string' && x !== '');
}

export function safeProfile(raw: unknown): StudentProfile {
  const p = isObject(raw) ? raw : {};
  const evidence = asArray<unknown>(p.evidence)
    .filter(isObject)
    .map((e) => ({ ...e, skills: asStringArray(e.skills) }) as unknown as EvidenceItem);
  return {
    ...(p as unknown as StudentProfile),
    id: typeof p.id === 'string' ? p.id : '',
    evidence,
  };
}

export function safeOpportunity(raw: unknown): Opportunity {
  const o = isObject(raw) ? raw : {};
  const preparation = asArray<unknown>(o.preparation)
    .filter(isObject)
    .map((x) => ({ ...x, depends_on: asStringArray(x.depends_on) }) as unknown as PrepItem);
  return {
    ...(o as unknown as Opportunity),
    id: typeof o.id === 'string' ? o.id : '',
    title: typeof o.title === 'string' ? o.title : '',
    fields: asStringArray(o.fields),
    preparation,
    required_devices: asArray(o.required_devices),
  };
}

/** 有限数，否则 null。 */
export function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
