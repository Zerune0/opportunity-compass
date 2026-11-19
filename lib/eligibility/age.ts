/**
 * 年龄要求的统一取年龄入口（纯函数）。
 *
 * checkEligibility 的 judgeAge、lib/requirement-timing.ts 的 ageCandidates / belowMinimumLater、
 * lib/path/plan.ts 的 blockNature 都从这里取「参考日当天的年龄」：
 *
 * 1. 有可用的 `birth_date`（合法 `YYYY-MM-DD`，且给了 options.today 时不晚于 today）：
 *    - 参考日 R = rule.as_of ?? opp.deadline；R 能解析 → R 当天的确切年龄（ageOn，不需要 today）；
 *    - R 缺省 → 用 options.today 当天的确切年龄；也没有 today → 不给确切年龄（与没有 today 时的旧行为一致）；
 *    - R 无法解析，或 R 早于出生日期 → 不给确切年龄（调用方按原有规则处理）。
 * 2. 没有可用的 `birth_date` → 由当前年龄 `age` 推出参考日当天可能的年龄（ageRangeOn，与第一阶段相同的算法：
 *    参考日早于 / 晚于 today 且不是整年时有两个可能值）。
 *
 * birth_date 是合法的资格输入（年龄要求是官方要求）；仍然不读 school_name / display_name。
 * 不读系统时钟、无随机、无 IO、不抛异常。
 */
import type { EvalOptions, ISODate, Opportunity, StudentProfile } from '../types';
import { ageOnYMD, compareYMD, parseISODate, wholeYearsBetween, type YMD } from './dates';

/** 带参考日的规则（age 要求只用到 as_of）。 */
export interface AgeRule {
  as_of?: string | null;
}

/** 参考日当天的确切年龄（来自出生日期）。 */
export interface ExactAge {
  age: number;
  /** 计算所用的日期（`YYYY-MM-DD`）。 */
  on: ISODate;
  /** on 是哪个日期：官方参考日 as_of、截止日期 deadline、或（两者都没有时）today。 */
  on_which: 'as_of' | 'deadline' | 'today';
}

/**
 * 可用的出生日期：合法 `YYYY-MM-DD`，且给了 today 时不晚于 today；否则 null。
 * （未来的出生日期视为填错，不用于判断。没有 today 时不检查出生日期是否在未来；
 *  此时若参考日 as_of / deadline 早于出生日期，exactAgeOnReference 返回 null，checkEligibility 判 unknown 并说明原因。）
 */
export function usableBirthDate(birthDate: unknown, options?: EvalOptions): YMD | null {
  if (typeof birthDate !== 'string') return null;
  const b = parseISODate(birthDate);
  if (b == null) return null;
  const today = typeof options?.today === 'string' ? parseISODate(options.today) : null;
  if (today != null && compareYMD(b, today) > 0) return null;
  return b;
}

/** 统一入口：有可用出生日期时，参考日（as_of ?? deadline，都没有时用 today）当天的确切年龄；否则 null。 */
export function exactAgeOnReference(
  birthDate: unknown,
  rule: AgeRule,
  opp: Pick<Opportunity, 'deadline'> | null | undefined,
  options?: EvalOptions,
): ExactAge | null {
  const birth = usableBirthDate(birthDate, options);
  if (birth == null) return null;
  const asOf = rule?.as_of ?? null;
  const refRaw = asOf ?? opp?.deadline ?? null;
  if (refRaw != null) {
    const ref = typeof refRaw === 'string' ? parseISODate(refRaw) : null;
    if (ref == null) return null;
    const age = ageOnYMD(birth, ref);
    return age == null ? null : { age, on: refRaw, on_which: asOf != null ? 'as_of' : 'deadline' };
  }
  const todayRaw = options?.today;
  const today = typeof todayRaw === 'string' ? parseISODate(todayRaw) : null;
  if (today == null || typeof todayRaw !== 'string') return null;
  const age = ageOnYMD(birth, today);
  return age == null ? null : { age, on: todayRaw, on_which: 'today' };
}

/**
 * 没有出生日期时：由今天的年龄 age 推出参考日 ref 当天可能的年龄（第一阶段算法，不变）。
 * ref = today → [age]；ref 早于 today → [age−n−1, age−n]（恰好整年时只有 age−n）；
 * ref 晚于 today → [age+n, age+n+1]（恰好整年时只有 age+n）。
 */
export function ageRangeOn(age: number, ref: YMD, today: YMD): number[] {
  const cmp = compareYMD(ref, today);
  if (cmp === 0) return [age];
  if (cmp < 0) {
    const { years, exact } = wholeYearsBetween(ref, today);
    return exact ? [age - years] : [age - years - 1, age - years];
  }
  const { years, exact } = wholeYearsBetween(today, ref);
  return exact ? [age + years] : [age + years, age + years + 1];
}

/** 出生日期与档案 age 不一致：按 today 由出生日期算出的年龄 ≠ age。需要 today；不一致时返回两者，否则 null。 */
export function birthDateAgeMismatch(
  profile: Pick<StudentProfile, 'age' | 'birth_date'>,
  options?: EvalOptions,
): { from_birth_date: number; stated_age: number } | null {
  const birth = usableBirthDate(profile?.birth_date, options);
  if (birth == null) return null;
  const today = typeof options?.today === 'string' ? parseISODate(options.today) : null;
  const stated = profile.age;
  if (today == null || typeof stated !== 'number' || !Number.isFinite(stated)) return null;
  const fromBirth = ageOnYMD(birth, today);
  if (fromBirth == null || fromBirth === stated) return null;
  return { from_birth_date: fromBirth, stated_age: stated };
}
