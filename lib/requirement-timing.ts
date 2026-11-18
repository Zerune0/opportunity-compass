/**
 * 年级 / 年龄要求「低于下限、以后可能满足」的共同口径（纯函数）。
 * analyzeGaps（lib/gap）与 findAlternatives（lib/match/block.ts）共用，保证两处结论一致。
 *
 * 规则：只有同时满足下面几条才算「会随时间改善」（belowMinimumLater 返回 true）：
 * - 要求类型是 grade 或 age，且 min 是数字；max 缺省（null / undefined）或 max ≥ min（区间有效）；
 * - grade：档案年级是数字且 < min（年级没有参考日，按当前年级）；
 * - age：档案年龄是数字，且在参考日（as_of ?? opp.deadline）当天「可能的年龄」全部 < min。
 *   可能的年龄与 checkEligibility 的 judgeAge 同一算法（ageCandidates）：
 *   参考日缺省 → 当前年龄；参考日或 options.today 无法解析 → 退回当前年龄（这种情况下 checkEligibility
 *   本身会给 unknown，不会走到这里）；参考日在 today 之前 / 之后 → 减去 / 加上期间的整年数（不整除时两种可能）。
 * 其他情况（高于上限、档案值缺失、区间无效、到参考日会超过上限等）一律 false。
 *
 * 公平性：只读 grade / age 与要求本身，不读取学校名、显示名。不读系统时钟、无随机、无 IO。
 */
import { compareYMD, parseISODate, wholeYearsBetween } from './eligibility/dates';
import type { EvalOptions, Opportunity, Requirement, StudentProfile } from './types';

/** age 要求在参考日（as_of ?? deadline）当天可能的年龄（与 checkEligibility 的 judgeAge 同一算法）。 */
export function ageCandidates(
  age: number,
  rule: { as_of?: string | null },
  opp: Pick<Opportunity, 'deadline'> | null | undefined,
  options?: EvalOptions,
): number[] {
  const refRaw = rule.as_of ?? opp?.deadline ?? null;
  const ref = typeof refRaw === 'string' ? parseISODate(refRaw) : null;
  const today = typeof options?.today === 'string' ? parseISODate(options.today) : null;
  if (ref == null || today == null) return [age];
  const cmp = compareYMD(ref, today);
  if (cmp === 0) return [age];
  if (cmp < 0) {
    const { years, exact } = wholeYearsBetween(ref, today);
    return exact ? [age - years] : [age - years - 1, age - years];
  }
  const { years, exact } = wholeYearsBetween(today, ref);
  return exact ? [age + years] : [age + years, age + years + 1];
}

/** 年级 / 年龄要求：在参考日确定低于下限，且上限缺省或不低于下限 → 以后可能满足。 */
export function belowMinimumLater(
  req: Requirement | null | undefined,
  profile: StudentProfile,
  opp: Pick<Opportunity, 'deadline'> | null | undefined,
  options?: EvalOptions,
): boolean {
  if (req == null || (req.type !== 'grade' && req.type !== 'age')) return false;
  const min = req.min;
  const max = req.max;
  if (typeof min !== 'number' || !Number.isFinite(min)) return false;
  if (max != null && !(typeof max === 'number' && max >= min)) return false;
  if (req.type === 'grade') {
    const g = profile.grade;
    return typeof g === 'number' && Number.isFinite(g) && g < min;
  }
  const a = profile.age;
  if (typeof a !== 'number' || !Number.isFinite(a)) return false;
  return ageCandidates(a, req, opp, options).every((x) => x < min);
}
