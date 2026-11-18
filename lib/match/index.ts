/**
 * explainMatch(profile, opp, options?: MatchOptions) — 这个机会为什么适合 / 不适合这名学生（完整实现，第二阶段第 2 层；不含分数或名次）。
 * findAlternatives(profile, opp, catalog, options?: MatchOptions) — 从传入的机会目录里找替代机会（完整实现，第二阶段第 1 层）。
 *
 * ── explainMatch（完整实现，第二阶段第 2 层；代码在 ./explain.ts）──
 * 只整理已有引擎的结论，不另写判断：r = analyzeReachability(profile, opp, grants, { today })（内部调用 checkEligibility），
 * eligibility_overall 与 reachable 直接取 r。grants = options.grants 里的对象（不是数组按 []），引擎只认与该学生、
 * 该机会匹配的 approved grant——与 analyzeGaps / findAlternatives 传同一组时三者结论一致。
 * 理由按 MATCH_REASON_KINDS 顺序输出，每个种类最多一条，没有可说的种类不输出（条数不固定）：
 * - interest：profile.interests ∩ opp.fields（normalizeTag 比较；shared_interests 按 opp.fields 原顺序与原写法）；
 *   兴趣没填 / 为空数组（提示可在 Skill Passport 补充）或机会没有领域标签 → null；有交集 → true；都填了但没交集 → false。
 * - eligibility：eligible → true；not_eligible → false，列出不满足的硬性要求（标签，最多 3 条，其余写「还有 N 条」），
 *   每条按 ./block.ts 的 blockNature 说明走向：permanent「不是靠准备能改变的」/ improvable「升年级或长大后可能满足」
 *   （附「届时按官网要求重新确认」）/ fixable「可以自己补上」；unknown → null，列出待确认的硬性要求（最多 3 条），
 *   每条注明是「在 Skill Passport 补填某项」还是「向主办方确认」——以 checkEligibility 返回的 confirm_with_official
 *   为准（引擎在档案缺该项时给 "Add your <字段> to your profile first." 提示，如缺州 / 省；其余为向主办方确认），不另猜。
 *   偏好（非硬性）要求不列。
 * - reachability：r.reachable 与 r.summary（引擎原文，含「可达 ≠ 录取」）。
 * - format：online → true；in_person / hybrid（附地点）按档案交通等级：reliable → true；limited / none → false，
 *   若交通障碍已被 approved grant 化解 → true 并写明；交通没填 → null；format 缺失或无法识别 → null。
 *   reliable 但引擎仍有未化解的交通障碍（如需自费差旅）时仍为 true，文字加半句「差旅 / 交通问题见 transport 那条」。
 * - time：已过截止日期 → false（引擎描述）；未化解的 time 障碍 → false（引擎描述，最多两条，pending 只提一句「尚未生效」）；
 *   全部已被 time_support 化解 → true 并写明；否则缺 profile.hours_per_week_available / opportunity.time_commitment.hours_per_week /
 *   opportunity.deadline / options.today → null（写出缺什么、去哪补）；否则 true：每周需要与可用小时、截止前剩几天、
 *   必需准备小时（requiredPrepClosure，与引擎同一口径）放得下；没有截止日期时提示可能是滚动截止。
 * - cost：未化解的 cost 障碍 → false（引擎描述；官方费用未知时引擎已写成 at least $X，与 analyzeGaps 同一口径；
 *   官方费用已知且已批准支持只抵一部分时补一句还差多少）；已被 fee_waiver 化解 → true；缺官方费用或预算 → null
 *   （官方费用未知、预算已填时说明必需准备费与预算的关系：放得下 / 高于预算、加上已批准的有金额减免才放得下，且总数可能更高）；
 *   否则 true（费用 + 必需准备费，在预算内）。financial_aid_available 为 true 时注明「有资助 ≠ 你已获得」。
 * - device：没有必需设备 → true；档案没填设备 → null；缺的设备逐个说明（被 approved device grant 化解的写
 *   「主办方已批准的 X 借用覆盖了 X 要求」，未化解的用引擎描述 + pending 提示）；有未化解的 → false，否则 true。
 * - transport：线上机会不输出；未化解的交通障碍 → false（引擎描述 + pending 提示）；已化解 → true（写明是交通补助 /
 *   替代参与方式）；缺 profile.transport 或「是否自费差旅」→ null；否则 true。
 * summary：一句话，按「资格 → 现实条件 → 兴趣」：not_eligible 时不加任何鼓励申请的话、不提兴趣——不满足的硬性要求
 * 全部是 fixable（portfolio / prerequisite_skill）时说「现在还不满足 "X"，这是可以自己补上的」（不说本届不能申请，
 * 也不承诺补上后会被录取）；含 permanent 或 improvable 的要求时说本届不能申请及原因；
 * unknown 先说要向主办方确认（或补填档案）哪几条，再说现实条件；eligible 时说可达（注明不代表录取）/ 不可达的障碍类别 /
 * 还缺哪些信息，最后一句兴趣。
 * 档案字段损坏（有值但类型不对，./profile-issues.ts，与 analyzeGaps 同口径）：不调用引擎，eligibility / reachability 为 null，
 * 说明是档案问题、请在 Skill Passport 更正（不归咎于机会）。机会数据不完整导致引擎出错：同样只给 interest / eligibility /
 * reachability 三条 null 理由，提示查看官网。两种情况 eligibility_overall = 'unknown'、reachable = null。
 * 仍然不做：不比较学生所在地与举办地的距离（只提示学生自己核对路程）；不读学生的形式偏好（档案没有这个字段）；
 * 不预测 pending 支持获批后的效果（只说尚未生效，详细推演见 analyzeGaps）；不输出任何分数、百分比、名次或匹配等级，
 * 也不按理由条数排序机会。
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
  MatchOptions,
  Opportunity,
  OverallEligibility,
  ReachabilityResult,
  ResourceGrant,
  StudentProfile,
} from '../types';

export { explainMatch } from './explain';

const MAX_SAME_FIELD = 3;

function hardLabels(e: EligibilityResult, status: 'not_satisfied' | 'unknown'): string {
  return e.items
    .filter((i) => i.hard && i.status === status)
    .map((i) => `"${i.label}"`)
    .join(', ');
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
