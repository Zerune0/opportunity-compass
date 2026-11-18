/**
 * explainMatch(profile, opp, options?) — 这个机会为什么适合 / 不适合这名学生（不含分数或名次）。
 * findAlternatives(profile, opp, catalog, options?: MatchOptions) — 从传入的机会目录里找替代机会（完整实现，第二阶段第 1 层）。
 *
 * ── explainMatch ── PHASE 2 SAMPLE VERSION — replaced in layer 2
 * 示例版本：签名与返回形状和最终版一致，内容简化但如实。
 * 理由只来自三件事，按 MATCH_REASON_KINDS 顺序输出：
 * - interest：profile.interests ∩ opp.fields（用 lib/tags.ts 的 normalizeTag 比较：去首尾空格、不区分大小写、
 *   空格 / 下划线 / 连字符视为同一写法；shared_interests 按 opp.fields 原顺序与原写法）；
 *   兴趣没填或机会没有领域标签 → positive: null；有交集 → true；都填了但没交集 → false。
 * - eligibility：checkEligibility 的 overall：eligible → true，not_eligible → false，unknown → null（列出待确认的硬性要求）。
 * - reachability：analyzeReachability(profile, opp, options.grants ?? [], options) 的 reachable 与 summary——
 *   页面上同时显示 analyzeGaps 时请传同一组 grants，两者的 reachable 才一致。
 * 省略：format / time / cost 三类理由（最终版从障碍里拆出单独理由）。
 * 不输出任何分数、百分比或名次。
 *
 * ── findAlternatives（完整实现）──
 * 产品依据（Quest Recovery）：申请过期、费用难以承担或资格暂时不符时，找下一届或同领域的其他机会；
 * 不把任何候选说成目标机会的官方前置条件。只从传入的 catalog 里找，不编造机会。
 *
 * 0. options 为 MatchOptions：today 与 grants（缺省 []；与 analyzeGaps / explainMatch 的 grants 同义，
 *    页面上三者传同一组）。grants 只经由 analyzeReachability 起作用，引擎自己只认与该学生、该机会匹配的 approved grant。
 * 1. 先算学生在 opp 上「受阻的原因」（可多个；日期只来自 options.today）：
 *    - eligibility_block：checkEligibility 总体 not_eligible。每条硬性 not_satisfied 的要求按 ./block.ts 的
 *      blockNature 分为 improvable（grade / age 在参考日确定低于 min，且 max 缺省或 ≥ min——与 analyzeGaps 共用
 *      lib/requirement-timing.ts 的 belowMinimumLater）、permanent（高于 max、region、citizenship、status 等）、
 *      fixable（prerequisite_skill、portfolio）。
 *    - past_deadline：给了 today，且 opp.deadline 可解析并早于 today。
 *    - not_reachable：资格不是 not_eligible，且 analyzeReachability(profile, opp, grants, options) 有未化解的障碍
 *      （「已过截止日期」那条障碍不算——它已由 past_deadline 表示）。
 *    - too_little_time：资格不是 not_eligible、截止没过，planRoutes 返回 routes 且每条路线 feasible_by_deadline === false。
 *    都没有 → 学生没有受阻，返回 []（不在学生没问题时推销别的机会）。
 * 2. next_cycle（最多一条，opportunity_id = opp.id，eligibility_overall: null，shared_fields = opp.fields 去重）：
 *    仅当 opp.recurring_annually !== false、没有任何 permanent 阻断，并且满足其一：
 *    past_deadline；或至少一条 improvable 阻断；或（前两者都没有时）too_little_time。
 *    只有 fixable 阻断时不给（补上就能申请这一届）。reason 如实写出是哪一种（有 fixable 阻断时一并说明），
 *    不承诺下一届能申请、提醒届时按官网最新要求确认；recurring_annually 为 null / 缺省时注明「是否每年举办未确认」。
 * 3. same_field（最多 3 条，仅在学生受阻时给）：catalog 中 id 非空、不是 opp.id、id 不重复（重复只取第一条）、
 *    与 opp.fields 至少一个共同标签（normalizeTag 比较；shared_fields 用候选原本的写法并去重）、
 *    给了 today 时截止日期没过（null / 无法解析的保留）、analyzeReachability(profile, cand, grants, options) 不出错且
 *    资格不是 not_eligible 的机会。排序键依次为：
 *    source_tier = 'user_posted' 排在所有其他候选之后 → 资格 eligible 在 unknown 前 →
 *    （仅当受阻原因含 not_reachable）reachable true < null < false → 共同标签数多的在前 →
 *    截止日期早的在前（null / 无法解析最后）→ id 字典序。
 *    reason：共同领域、资格结论（符合 / 列出待向官方确认的硬性要求）、现实条件一句话（走得通 / 信息不足 /
 *    也有未化解的障碍：哪几类）；user_posted 注明是示例发布、未经官网核实。
 *    reason 不把候选说成前置条件或跳板，不出现分数、名次或录取可能性。
 * 4. 结果顺序：next_cycle 在前，其后 same_field。
 *
 * 公平性：不读取学校名、显示名。纯函数：不读系统时钟、无随机、无 IO、不调 AI。永不抛异常
 * （候选判断出错的跳过；目标机会判断出错的那一类原因视为不存在）。
 */
import { checkEligibility } from '../eligibility';
import { analyzeReachability } from '../reachability';
import { planRoutes } from '../path';
import { dayNumber, parseISODate } from '../eligibility/dates';
import { asArray, safeOpportunity, safeProfile } from '../gap/inputs';
import { normalizedTagSet, sharedTags } from '../tags';
import { blockNature, type BlockNature } from './block';
import { BARRIER_TYPES } from '../types';
import type {
  AlternativeSuggestion,
  BarrierType,
  EligibilityItem,
  EligibilityResult,
  EvalOptions,
  MatchExplanation,
  MatchOptions,
  MatchReason,
  Opportunity,
  OverallEligibility,
  ReachabilityResult,
  ResourceGrant,
  StudentProfile,
} from '../types';

const MAX_SAME_FIELD = 3;

function hardLabels(e: EligibilityResult, status: 'not_satisfied' | 'unknown'): string {
  return e.items
    .filter((i) => i.hard && i.status === status)
    .map((i) => `"${i.label}"`)
    .join(', ');
}

// ───────────────────────────── explainMatch ─────────────────────────────

export function explainMatch(profile: StudentProfile, opp: Opportunity, options?: MatchOptions): MatchExplanation {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);

  // ── interest ──
  const interestsFilled = Array.isArray(p.interests);
  const shared_interests = sharedTags(o.fields, normalizedTagSet(asArray<unknown>(p.interests)));
  let interest: MatchReason;
  if (!interestsFilled) {
    interest = { kind: 'interest', positive: null, text: "Your profile has no interests yet, so we can't compare them with this opportunity's fields." };
  } else if (o.fields.length === 0) {
    interest = { kind: 'interest', positive: null, text: "This opportunity lists no fields, so we can't compare it with your interests." };
  } else if (shared_interests.length > 0) {
    interest = { kind: 'interest', positive: true, text: `Matches your interests: ${shared_interests.join(', ')}.` };
  } else {
    interest = {
      kind: 'interest',
      positive: false,
      text: `None of your interests match this opportunity's fields (${o.fields.join(', ')}).`,
    };
  }

  // ── eligibility / reachability ──
  let r: ReachabilityResult | null = null;
  try {
    const grants = asArray<ResourceGrant>(options?.grants);
    const evalOptions: EvalOptions | undefined = options?.today == null ? undefined : { today: options.today };
    r = analyzeReachability(p, o, grants, evalOptions);
  } catch {
    r = null;
  }

  let eligibility_overall: OverallEligibility;
  let eligibility: MatchReason;
  let reachability: MatchReason;
  let reachable: boolean | null;
  if (r == null) {
    eligibility_overall = 'unknown';
    reachable = null;
    eligibility = { kind: 'eligibility', positive: null, text: "The opportunity data is incomplete, so we can't check eligibility. Check the official page." };
    reachability = { kind: 'reachability', positive: null, text: "The opportunity data is incomplete, so we can't tell whether this is realistic for you." };
  } else {
    eligibility_overall = r.eligibility.overall;
    reachable = r.reachable;
    if (eligibility_overall === 'eligible') {
      eligibility = { kind: 'eligibility', positive: true, text: 'You meet every hard official requirement we can check.' };
    } else if (eligibility_overall === 'not_eligible') {
      eligibility = { kind: 'eligibility', positive: false, text: `You don't meet the hard requirement(s): ${hardLabels(r.eligibility, 'not_satisfied')}.` };
    } else {
      eligibility = {
        kind: 'eligibility',
        positive: null,
        text: `Some hard requirements can't be checked yet: ${hardLabels(r.eligibility, 'unknown')}. Confirm with the organizer.`,
      };
    }
    reachability = { kind: 'reachability', positive: reachable, text: r.summary };
  }

  const interestPart =
    interest.positive === true
      ? `Shares your interests (${shared_interests.join(', ')}).`
      : interest.positive === false
        ? "Doesn't overlap with your listed interests."
        : 'Interest match unknown.';
  const eligPart =
    eligibility_overall === 'eligible'
      ? 'Eligibility: you meet the checkable hard requirements.'
      : eligibility_overall === 'not_eligible'
        ? 'Eligibility: not eligible this round.'
        : 'Eligibility: to be confirmed.';
  const reachPart =
    reachable === true
      ? 'Realistically doable right now (not a prediction of admission).'
      : reachable === false
        ? 'Not realistic right now.'
        : 'Realistic or not: unknown yet.';

  return {
    profile_id: p.id,
    opportunity_id: o.id,
    reasons: [interest, eligibility, reachability],
    eligibility_overall,
    reachable,
    shared_interests,
    summary: `${interestPart} ${eligPart} ${reachPart}`,
  };
}

// ───────────────────────────── findAlternatives ─────────────────────────────

/** 学生在目标机会上「受阻的原因」。 */
interface BlockState {
  /** 资格 not_eligible 时的阻断项与各自走向；资格不是 not_eligible（或无法判断）时为空。 */
  blocking: { item: EligibilityItem; nature: BlockNature }[];
  pastDeadline: boolean;
  /** 现实障碍（不含「已过截止日期」那一条）使 reachable === false，且资格不是 not_eligible。 */
  notReachable: boolean;
  /** 资格不是 not_eligible、截止没过，但 planRoutes 的每条路线都来不及（feasible_by_deadline === false）。 */
  tooLittleTime: boolean;
}

function isPastDeadline(deadline: unknown, todayDay: number | null): boolean {
  if (todayDay == null || typeof deadline !== 'string') return false;
  const d = parseISODate(deadline);
  return d != null && dayNumber(d) < todayDay;
}

function blockState(
  p: StudentProfile,
  o: Opportunity,
  grants: ResourceGrant[],
  options: EvalOptions | undefined,
  todayDay: number | null,
): BlockState {
  const pastDeadline = isPastDeadline(o.deadline, todayDay);

  let elig: EligibilityResult | null = null;
  try {
    elig = checkEligibility(p, o, options);
  } catch {
    elig = null;
  }
  const notEligible = elig?.overall === 'not_eligible';
  const blocking =
    elig != null && notEligible
      ? elig.items.filter((i) => i.hard && i.status === 'not_satisfied').map((item) => ({ item, nature: blockNature(item, p, o, options) }))
      : [];

  let notReachable = false;
  if (!notEligible) {
    try {
      const r = analyzeReachability(p, o, grants, options);
      if (r.reachable === false) {
        // 「已过截止日期」障碍（time、shortfall 为 null、无法化解）单独算作 pastDeadline，不计入现实障碍。
        notReachable = r.barriers.some((b) => !b.resolved && !(pastDeadline && b.type === 'time' && b.shortfall == null));
      }
    } catch {
      notReachable = false;
    }
  }

  let tooLittleTime = false;
  if (!notEligible && !pastDeadline) {
    try {
      const plan = planRoutes(p, o, options);
      tooLittleTime = plan.status === 'routes' && plan.routes.length > 0 && plan.routes.every((r) => r.feasible_by_deadline === false);
    } catch {
      tooLittleTime = false;
    }
  }

  return { blocking, pastDeadline, notReachable, tooLittleTime };
}

function isBlocked(b: BlockState): boolean {
  return b.blocking.length > 0 || b.pastDeadline || b.notReachable || b.tooLittleTime;
}

const NOT_CONFIRMED_YEARLY = 'Whether it runs every year is not confirmed — check with the organizer.';

function nextCycle(o: Opportunity, b: BlockState): AlternativeSuggestion | null {
  if (o.recurring_annually === false) return null;
  const natures = b.blocking.map((x) => x.nature);
  // 任何「不会随时间改善」的阻断（高于上限、地区、国籍、身份……）都不给 next_cycle：下一届同样不符合。
  if (natures.includes('permanent')) return null;
  const improvable = natures.includes('improvable');
  const labels = (n: BlockNature) =>
    b.blocking
      .filter((x) => x.nature === n)
      .map((x) => `"${x.item.label}"`)
      .join(', ');

  const parts: string[] = [];
  if (b.pastDeadline) parts.push(`The deadline for this round (${o.deadline}) has passed.`);
  if (improvable) parts.push(`You don't meet ${labels('improvable')} yet, but you may as you move up a grade or get older.`);
  if (!b.pastDeadline && !improvable) {
    if (!b.tooLittleTime) return null;
    parts.push(
      `With your current weekly hours, none of the suggested routes can be finished before this round's deadline (${o.deadline}).`,
    );
  }
  if (natures.includes('fixable')) parts.push(`You would also need to meet ${labels('fixable')}, which you can work on yourself.`);
  parts.push(
    "If it runs again, you could aim for the next round. We can't promise you will be able to apply then; check the latest official rules when it opens.",
  );
  if (o.recurring_annually == null) parts.push(NOT_CONFIRMED_YEARLY);

  return {
    kind: 'next_cycle',
    opportunity_id: o.id || null,
    title: o.title,
    reason: parts.join(' '),
    eligibility_overall: null,
    shared_fields: sharedTags(o.fields, normalizedTagSet(o.fields)),
  };
}

const BARRIER_NAMES: Record<BarrierType, string> = {
  time: 'time',
  cost: 'cost',
  transport: 'transportation',
  device: 'device',
};

interface Candidate {
  suggestion: AlternativeSuggestion;
  posted: boolean;
  overall: OverallEligibility;
  reachable: boolean | null;
  sharedCount: number;
  deadlineDay: number | null;
  id: string;
}

const ELIG_ORDER: Record<OverallEligibility, number> = { eligible: 0, unknown: 1, not_eligible: 2 };
const reachOrder = (r: boolean | null) => (r === true ? 0 : r === null ? 1 : 2);

function compareCandidates(a: Candidate, b: Candidate, byReachability: boolean): number {
  if (a.posted !== b.posted) return a.posted ? 1 : -1;
  if (a.overall !== b.overall) return ELIG_ORDER[a.overall] - ELIG_ORDER[b.overall];
  if (byReachability && a.reachable !== b.reachable) return reachOrder(a.reachable) - reachOrder(b.reachable);
  if (a.sharedCount !== b.sharedCount) return b.sharedCount - a.sharedCount;
  if (a.deadlineDay !== b.deadlineDay) {
    if (a.deadlineDay == null) return 1;
    if (b.deadlineDay == null) return -1;
    return a.deadlineDay - b.deadlineDay;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function sameFieldCandidate(
  p: StudentProfile,
  raw: unknown,
  targetTags: Set<string>,
  grants: ResourceGrant[],
  options: EvalOptions | undefined,
  todayDay: number | null,
): Candidate | null {
  const c = safeOpportunity(raw);
  const shared = sharedTags(c.fields, targetTags);
  if (shared.length === 0) return null;
  if (isPastDeadline(c.deadline, todayDay)) return null; // 截止日期已过，不再推荐。
  let r: ReachabilityResult;
  try {
    r = analyzeReachability(p, c, grants, options);
  } catch {
    return null; // 数据不完整，无法确认 → 不推荐。
  }
  const overall = r.eligibility.overall;
  if (overall === 'not_eligible') return null;

  const eligText =
    overall === 'eligible'
      ? 'You meet its hard requirements that we can check.'
      : `Some of its hard requirements need to be confirmed with the organizer: ${hardLabels(r.eligibility, 'unknown')}.`;
  let reachText: string;
  if (r.reachable === true) {
    reachText = 'Based on current info it looks realistically doable (this says nothing about admission).';
  } else if (r.reachable === null) {
    reachText = "We don't have enough info yet to tell whether it's realistic for you.";
  } else {
    const types = BARRIER_TYPES.filter((t) => r.barriers.some((b) => !b.resolved && b.type === t)).map((t) => BARRIER_NAMES[t]);
    reachText =
      types.length > 0
        ? `It also has unresolved barriers for you right now (${types.join(', ')}).`
        : 'It also has unresolved barriers for you right now.';
  }
  const posted = c.source_tier === 'user_posted';
  const tier = posted ? ' This is a sample posting, not verified on an official site.' : '';
  const d = typeof c.deadline === 'string' ? parseISODate(c.deadline) : null;

  return {
    suggestion: {
      kind: 'same_field',
      opportunity_id: c.id,
      title: c.title,
      reason: `A separate opportunity that is also in ${shared.join(', ')}. ${eligText} ${reachText}${tier}`,
      eligibility_overall: overall,
      shared_fields: shared,
    },
    posted,
    overall,
    reachable: r.reachable,
    sharedCount: shared.length,
    deadlineDay: d ? dayNumber(d) : null,
    id: c.id,
  };
}

export function findAlternatives(
  profile: StudentProfile,
  opp: Opportunity,
  catalog: Opportunity[],
  options?: MatchOptions,
): AlternativeSuggestion[] {
  try {
    const p = safeProfile(profile);
    const o = safeOpportunity(opp);
    const evalOptions: EvalOptions | undefined = options?.today == null ? undefined : { today: options.today };
    const grants = asArray<unknown>(options?.grants).filter(
      (g) => g != null && typeof g === 'object' && !Array.isArray(g),
    ) as ResourceGrant[];
    const todayYMD = parseISODate(evalOptions?.today);
    const todayDay = todayYMD ? dayNumber(todayYMD) : null;

    const block = blockState(p, o, grants, evalOptions, todayDay);
    if (!isBlocked(block)) return []; // 学生没有受阻：不推销别的机会。

    const out: AlternativeSuggestion[] = [];
    const nc = nextCycle(o, block);
    if (nc) out.push(nc);

    const targetTags = normalizedTagSet(o.fields);
    if (targetTags.size > 0) {
      const seen = new Set<string>();
      const candidates: Candidate[] = [];
      for (const raw of asArray<unknown>(catalog)) {
        const id = raw != null && typeof raw === 'object' && typeof (raw as { id?: unknown }).id === 'string' ? (raw as { id: string }).id : '';
        if (id === '' || id === o.id || seen.has(id)) continue;
        seen.add(id);
        const cand = sameFieldCandidate(p, raw, targetTags, grants, evalOptions, todayDay);
        if (cand) candidates.push(cand);
      }
      candidates.sort((a, b) => compareCandidates(a, b, block.notReachable));
      out.push(...candidates.slice(0, MAX_SAME_FIELD).map((c) => c.suggestion));
    }
    return out;
  } catch {
    return [];
  }
}
