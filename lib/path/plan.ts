/**
 * planRoutes(profile, opp, options?) — 路线规划（第 2 层实现）。
 *
 * 规则：
 * 1. 先 checkEligibility。overall = not_eligible → status 'blocked'、routes []，
 *    绝不生成任何路线或「绕过」建议；只给阻断要求（带官网原文）、每条一句原因、替代提示：
 *    - next_cycle：opp.recurring_annually !== false，且至少一条阻断是「会随时间变好」的
 *      （grade / age 低于 min），且没有任何「不会随时间变好」的阻断
 *      （grade / age 高于 max、region、citizenship、status）时才给；recurring_annually 未知时提示向官方确认。
 *    - same_field：opp.fields 非空时给（opportunity_ids 不填，planRoutes 拿不到机会目录）。
 *    - 因缺技能 / 作品被硬性阻断：仍然 blocked，原因里说明补上并更新档案后可重新规划。
 * 2. 否则 status 'routes'，plan.warnings 在资格 unknown 时列出待确认的硬性要求。
 * 3. 步骤：opp.preparation 每项一步（id = prep_item_id = PrepItem.id）；被证据覆盖（findCoveringEvidence）
 *    → skipped，保留在列表里但不计入合计。每条路线最后固定「提交申请」（费用 = 报名费，依赖其他所有步骤）。
 * 4. 路线（顺序固定，总是 2 或 3 条）：
 *    - learning_first：拓扑排序时优先学习 / 材料类；
 *    - practice_first：有未跳过的实践类准备项时才生成；优先实践类，其次是实践类的前置学习项；
 *    - community：最前面加「找到同伴或导师」（2 小时估算），其余优先申请必需项。
 *    同一优先级按 opp.preparation 原顺序。依赖不存在或依赖自身 → 忽略该依赖并提醒；
 *    依赖成环 → 卡住时只强行放入环上原顺序最靠前的一个步骤，然后继续正常排序（不在环上的依赖仍被遵守），并提醒。
 * 5. 合计 / 周数 / 是否来得及 / 预算提醒见 buildRoute。来得及 ≠ 会被录取。
 *
 * 公平性：不读取 school_name、display_name。
 * 纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO、不调 AI。
 */
import { checkEligibility } from '../eligibility';
import { plural } from '../format';
import { daysBetween, parseISODate } from '../eligibility/dates';
import { findCoveringEvidence, requiredPrepClosure } from '../reachability/coverage';
import type {
  AlternativeHint,
  EligibilityItem,
  EvalOptions,
  Opportunity,
  PlanResult,
  PrepItem,
  Route,
  RouteStep,
  RouteType,
  StudentProfile,
} from '../types';
import {
  FEE_UNKNOWN_WARNING,
  PARTNER_STEP_ID,
  PRACTICE_KINDS,
  RESERVED_STEP_IDS,
  ROUTE_TITLES,
  SUBMIT_STEP_ID,
  round2,
  safeNonNeg,
  usd,
} from './shared';

interface BaseStep {
  step: RouteStep;
  practice: boolean;
  required: boolean;
  /** 在 opp.preparation 中的原顺序。 */
  index: number;
}

interface BaseSteps {
  items: BaseStep[];
  /** 数据质量提醒（重复 id、依赖不存在等），放进 plan.warnings。 */
  dataWarnings: string[];
}

// ───────────────────────────── 阻断（blocked） ─────────────────────────────

type BlockNature = 'improvable' | 'permanent' | 'fixable';

/** 判断一条阻断要求随时间的走向。 */
function blockNature(item: EligibilityItem, profile: StudentProfile, opp: Opportunity): BlockNature {
  const req = opp.requirements.find((r) => r.id === item.requirement_id);
  if (!req) return 'permanent';
  switch (req.type) {
    case 'grade':
    case 'age': {
      const v = req.type === 'grade' ? profile.grade : profile.age;
      if (v != null && req.min != null && v < req.min && (req.max == null || req.max >= req.min)) {
        return 'improvable';
      }
      return 'permanent';
    }
    case 'prerequisite_skill':
    case 'portfolio':
      return 'fixable';
    default:
      return 'permanent';
  }
}

function blockedPlan(
  profile: StudentProfile,
  opp: Opportunity,
  blocking: EligibilityItem[],
): PlanResult {
  const reasons = blocking.map((b) => {
    const base = `You don't meet the hard requirement "${b.label}": ${b.explanation} Official text: "${b.source_text}".`;
    if (b.requirement_type === 'prerequisite_skill' || b.requirement_type === 'portfolio') {
      return `${base} Once you have this and update your profile, you can plan again.`;
    }
    return base;
  });

  const alternatives: AlternativeHint[] = [];
  const natures = blocking.map((b) => blockNature(b, profile, opp));
  const hasImprovable = natures.includes('improvable');
  const hasPermanent = natures.includes('permanent');
  if (opp.recurring_annually !== false && hasImprovable && !hasPermanent) {
    const labels = blocking
      .filter((_, i) => natures[i] === 'improvable')
      .map((b) => `"${b.label}"`)
      .join(', ');
    let text = `You may meet ${labels} as you move up a grade / get older. Watch for a future round, and check the latest official rules then.`;
    if (opp.recurring_annually == null) text += ' Confirm with the organizer whether it runs every year.';
    alternatives.push({ kind: 'next_cycle', text });
  }
  const fields = (opp.fields ?? []).filter((f) => typeof f === 'string' && f !== '');
  if (fields.length > 0) {
    alternatives.push({
      kind: 'same_field',
      text: `Look at other verified opportunities in the same field (${fields.join(', ')}).`,
    });
  }

  return {
    status: 'blocked',
    profile_id: profile.id,
    opportunity_id: opp.id,
    routes: [],
    blocking_requirements: blocking,
    reasons,
    alternatives,
  };
}

// ───────────────────────────── 步骤 ─────────────────────────────

function stepFromPrep(profile: StudentProfile, opp: Opportunity, prep: PrepItem, deps: string[]): RouteStep {
  const covering = findCoveringEvidence(profile, opp, prep);
  const skipped = covering.length > 0;
  const descParts = [prep.required_for_application ? 'Required to apply.' : 'Recommended; can make your application stronger.'];
  if (prep.source_text) descParts.push(` Source: ${prep.source_text}`);
  return {
    id: prep.id,
    title: prep.title,
    description: descParts.join(''),
    prep_item_id: prep.id,
    depends_on: deps,
    hours: safeNonNeg(prep.estimated_hours),
    cost_usd: safeNonNeg(prep.estimated_cost_usd),
    skipped,
    skip_reason: skipped ? `Already covered by ${covering.map((e) => `"${e.title}"`).join(', ')}` : null,
    satisfied_by_evidence_ids: covering.map((e) => e.id),
  };
}

function buildBaseSteps(profile: StudentProfile, opp: Opportunity): BaseSteps {
  const dataWarnings: string[] = [];
  const preps = Array.isArray(opp.preparation) ? opp.preparation : [];
  const seen = new Set<string>();
  const accepted: PrepItem[] = [];
  for (const prep of preps) {
    if (RESERVED_STEP_IDS.includes(prep.id)) {
      dataWarnings.push(`Prep item "${prep.title}" has an id that clashes with a fixed step, so it was ignored. Please check the opportunity data.`);
      continue;
    }
    if (seen.has(prep.id)) {
      dataWarnings.push(`Prep item id "${prep.id}" is repeated; only the first one was kept. Please check the opportunity data.`);
      continue;
    }
    seen.add(prep.id);
    accepted.push(prep);
  }

  const items = accepted.map((prep, index) => {
    const deps: string[] = [];
    for (const d of Array.isArray(prep.depends_on) ? prep.depends_on : []) {
      if (d === prep.id) {
        dataWarnings.push(`Prep item "${prep.title}" lists itself as a dependency; that dependency was ignored. Please check the opportunity data.`);
        continue;
      }
      if (!seen.has(d)) {
        dataWarnings.push(`Prep item "${prep.title}" depends on "${d}", which does not exist in this opportunity; that dependency was ignored.`);
        continue;
      }
      if (!deps.includes(d)) deps.push(d);
    }
    return {
      step: stepFromPrep(profile, opp, prep, deps),
      practice: prep.evidence_kind != null && PRACTICE_KINDS.includes(prep.evidence_kind),
      required: prep.required_for_application === true,
      index,
    };
  });
  return { items, dataWarnings };
}

/** 在尚未排好的步骤中，item 是否位于依赖环上（沿未排好的依赖能回到自身）。 */
function onCycle(item: BaseStep, byId: Map<string, BaseStep>, placed: Set<string>): boolean {
  const visited = new Set<string>();
  const stack = item.step.depends_on.filter((d) => !placed.has(d));
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (id === item.step.id) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const d of byId.get(id)?.step.depends_on ?? []) if (!placed.has(d)) stack.push(d);
  }
  return false;
}

/**
 * 稳定拓扑排序：每次在依赖都已排好的候选里选 (rank, 原顺序) 最小的。
 * 卡住（有环）时，只强行放入「位于环上」且原顺序最靠前的一个步骤，然后继续正常循环，cyclic = true。
 * 只挑环上的步骤，是为了不让依赖环的下游步骤（不在环上）被排到它的依赖之前。
 */
function topoSort(items: BaseStep[], rank: (b: BaseStep) => number): { order: BaseStep[]; cyclic: boolean } {
  const byId = new Map(items.map((b) => [b.step.id, b]));
  const placed = new Set<string>();
  const remaining = [...items];
  const order: BaseStep[] = [];
  let cyclic = false;
  while (remaining.length > 0) {
    let best = -1;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      if (!c.step.depends_on.every((d) => placed.has(d))) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const b = remaining[best];
      const rc = rank(c);
      const rb = rank(b);
      if (rc < rb || (rc === rb && c.index < b.index)) best = i;
    }
    if (best === -1) {
      cyclic = true;
      for (let i = 0; i < remaining.length; i++) {
        const c = remaining[i];
        if (!onCycle(c, byId, placed)) continue;
        if (best === -1 || c.index < remaining[best].index) best = i;
      }
      // 理论上卡住时必有环上节点；兜底取原顺序最靠前的一个，保证循环终止。
      if (best === -1) {
        best = 0;
        for (let i = 1; i < remaining.length; i++) if (remaining[i].index < remaining[best].index) best = i;
      }
    }
    const [next] = remaining.splice(best, 1);
    placed.add(next.step.id);
    order.push(next);
  }
  return { order, cyclic };
}

/**
 * ids 及其全部前置依赖（传递闭包）。
 * skip(b) 为真的节点不计入，也不再沿它往前追（例如已被证据跳过的步骤，其前置也就不必做了）。
 */
function withAncestors(items: BaseStep[], ids: string[], skip?: (b: BaseStep) => boolean): Set<string> {
  const byId = new Map(items.map((b) => [b.step.id, b]));
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (node && skip?.(node)) continue;
    out.add(id);
    for (const d of byId.get(id)?.step.depends_on ?? []) stack.push(d);
  }
  return out;
}

function cloneStep(s: RouteStep): RouteStep {
  return { ...s, depends_on: [...s.depends_on], satisfied_by_evidence_ids: [...s.satisfied_by_evidence_ids] };
}

// ───────────────────────────── 时间判断 ─────────────────────────────

interface Feasibility {
  value: boolean | null;
  missing: string[];
  deadlinePassed: boolean;
  /** 到截止日前大约能投入的小时数（可判断时）。 */
  capacityHours: number | null;
  daysLeft: number | null;
}

/** 每周可用小时的状态：有效数值 / 没填 / 填了但无效（≤ 0 或不是有限数）。 */
type HoursState = { kind: 'ok'; value: number } | { kind: 'missing' } | { kind: 'invalid' };

function hoursState(raw: unknown): HoursState {
  if (raw == null) return { kind: 'missing' };
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return { kind: 'ok', value: raw };
  return { kind: 'invalid' };
}

function judgeFeasibility(totalHours: number, hours: HoursState, opp: Opportunity, today?: string): Feasibility {
  const missing: string[] = [];
  const deadline = opp.deadline == null ? null : parseISODate(opp.deadline);
  if (opp.deadline == null) missing.push('the official site gives no deadline (it may be rolling admission)');
  else if (deadline == null) missing.push("the deadline date format can't be read");
  const now = today == null ? null : parseISODate(today);
  if (today == null) missing.push("today's date was not provided");
  else if (now == null) missing.push("today's date format can't be read");

  // 截止日已过与每周可用小时无关：日期都能解析时先判断。
  if (deadline != null && now != null) {
    const daysLeft = daysBetween(now, deadline);
    if (daysLeft < 0) return { value: false, missing: [], deadlinePassed: true, capacityHours: 0, daysLeft };
  }

  if (hours.kind === 'missing') missing.push('your profile has no weekly available hours yet');
  else if (hours.kind === 'invalid') missing.push('the weekly available hours in your profile are invalid (must be more than 0)');

  const none: Feasibility = { value: null, missing, deadlinePassed: false, capacityHours: null, daysLeft: null };
  if (missing.length > 0 || deadline == null || now == null || hours.kind !== 'ok') return none;

  const hpw = hours.value;
  const days = daysBetween(now, deadline);
  const capacity = (hpw * Math.max(days, 1)) / 7;
  return { value: totalHours <= capacity, missing, deadlinePassed: false, capacityHours: capacity, daysLeft: days };
}

// ───────────────────────────── 路线 ─────────────────────────────

const RATIONALE: Record<RouteType, string> = {
  learning_first: 'Learn the basics and prepare application materials first, then build your project. Good if you are just starting and want a solid base.',
  practice_first: 'Start building a project / portfolio early and learn what you need along the way; the work itself can become part of your application. Good if you already know a little and want results soon.',
  community: 'Find a peer or mentor first, then work together, doing the required items first. Good if working alone is hard and you want company or guidance.',
};

interface RouteContext {
  opp: Opportunity;
  hours: HoursState;
  /** 有效预算（有限且 ≥ 0）；没填或无效时为 null，不做预算比较。 */
  budget: number | null;
  today?: string;
  /** 只做申请必需项（含前置步骤）的小时数。 */
  requiredOnlyHours: number;
  cyclicWarning: string | null;
}

function buildRoute(type: RouteType, ordered: BaseStep[], cyclic: boolean, ctx: RouteContext): Route {
  const { opp } = ctx;
  const steps: RouteStep[] = [];
  if (type === 'community') {
    steps.push({
      id: PARTNER_STEP_ID,
      title: 'Find a peer or mentor',
      description:
        'Try a teacher at school, a community group or an online learning group, and agree to prepare together or check in regularly. The 2 hours is an estimate for reaching out and setting up a first meeting.',
      prep_item_id: null,
      depends_on: [],
      hours: 2,
      cost_usd: 0,
      skipped: false,
      skip_reason: null,
      satisfied_by_evidence_ids: [],
    });
  }
  for (const b of ordered) steps.push(cloneStep(b.step));

  const fee = opp.cost?.fee_usd;
  steps.push({
    id: SUBMIT_STEP_ID,
    title: 'Submit application',
    description: `Submit your application materials as the official site asks${opp.deadline ? ` (deadline ${opp.deadline}; check the official site for the exact time)` : ''}. Submitting an application does not mean you will be admitted.`,
    prep_item_id: null,
    depends_on: steps.map((s) => s.id),
    hours: 0,
    cost_usd: safeNonNeg(fee),
    skipped: false,
    skip_reason: null,
    satisfied_by_evidence_ids: [],
  });

  const active = steps.filter((s) => !s.skipped);
  const total_hours = round2(active.reduce((sum, s) => sum + s.hours, 0));
  const total_cost_usd = round2(active.reduce((sum, s) => sum + s.cost_usd, 0));
  const hpw = ctx.hours.kind === 'ok' ? ctx.hours.value : null;
  const estimated_weeks = hpw == null ? null : Math.ceil(total_hours / hpw);
  const feas = judgeFeasibility(total_hours, ctx.hours, opp, ctx.today);

  const warnings: string[] = [];
  if (cyclic && ctx.cyclicWarning) warnings.push(ctx.cyclicWarning);
  if (fee == null) warnings.push(FEE_UNKNOWN_WARNING);
  if (ctx.budget != null && total_cost_usd > ctx.budget) {
    warnings.push(`Over budget by ${usd(round2(total_cost_usd - ctx.budget))} (this route needs about ${usd(total_cost_usd)}; your profile budget is ${usd(ctx.budget)}).`);
  }
  if (feas.value === false) {
    if (feas.deadlinePassed) {
      warnings.push(`The deadline ${opp.deadline} has passed, so it is too late to apply this round.`);
    } else {
      warnings.push(
        `At ${plural(hpw as number, 'hour')} per week, you can put in about ${plural(round2(feas.capacityHours as number), 'hour')} before the deadline ${opp.deadline} (${plural(feas.daysLeft as number, 'day')} left). This route needs ${plural(total_hours, 'hour')}, so you may not make it. Doing only the required items (and the steps they depend on) needs ${plural(ctx.requiredOnlyHours, 'hour')}, for reference; you decide which steps to cut.`,
      );
    }
  } else if (feas.value === null) {
    warnings.push(`We can't tell yet if you can finish before the deadline: ${feas.missing.join('; ')}.`);
  }

  let rationale = RATIONALE[type];
  if (hpw != null && estimated_weeks != null) {
    rationale +=
      estimated_weeks === 0
        ? ` At the ${plural(hpw, 'hour')} per week in your profile, this route needs no extra weeks of prep.`
        : ` At the ${plural(hpw, 'hour')} per week in your profile, this route takes about ${plural(estimated_weeks, 'week')}.`;
  }

  return {
    id: `${opp.id}:${type}`,
    type,
    title: ROUTE_TITLES[type],
    steps,
    total_hours,
    total_cost_usd,
    estimated_weeks,
    feasible_by_deadline: feas.value,
    rationale,
    warnings,
  };
}

// ───────────────────────────── 主函数 ─────────────────────────────

export function planRoutes(profile: StudentProfile, opp: Opportunity, options?: EvalOptions): PlanResult {
  const eligibility = checkEligibility(profile, opp, options);
  if (eligibility.overall === 'not_eligible') {
    const blocking = eligibility.items.filter((i) => i.hard && i.status === 'not_satisfied');
    return blockedPlan(profile, opp, blocking);
  }

  const warnings: string[] = [];
  if (eligibility.overall === 'unknown') {
    const labels = eligibility.items
      .filter((i) => i.hard && i.status === 'unknown')
      .map((i) => `"${i.label}"`)
      .join(', ');
    warnings.push(`Eligibility not confirmed yet: ${labels}. Confirm with the organizer using the official text before you put time into preparing.`);
  }
  for (const i of eligibility.items) {
    if (!i.hard && i.status === 'not_satisfied') {
      warnings.push(`Bonus item "${i.label}" is not met yet (this does not affect eligibility).`);
    }
  }

  const { items, dataWarnings } = buildBaseSteps(profile, opp);
  warnings.push(...dataWarnings);
  if (items.length === 0) warnings.push('This opportunity lists no prep items, so the routes only have fixed steps. Follow the official requirements.');

  const hours = hoursState(profile.hours_per_week_available);
  if (hours.kind === 'invalid') {
    warnings.push("The weekly available hours in your profile are invalid (must be more than 0), so we can't estimate weeks or whether you'll make the deadline. Please update your profile.");
  }
  const budgetRaw = profile.budget_usd;
  let budget: number | null = null;
  if (typeof budgetRaw === 'number' && Number.isFinite(budgetRaw) && budgetRaw >= 0) {
    budget = budgetRaw;
  } else if (budgetRaw != null) {
    warnings.push('The budget in your profile is invalid (it cannot be negative), so we skipped the budget check this time. Please update your profile.');
  }

  // 只做申请必需项：只取未被证据跳过的必需项；遇到已跳过的前置步骤不计入，也不再往前追。
  // 与 analyzeReachability 的 H 共用 requiredPrepClosure，保证两边数字一致。
  const requiredOnlyHours = round2(
    requiredPrepClosure(profile, opp, { excludeIds: RESERVED_STEP_IDS }).reduce(
      (sum, p) => sum + safeNonNeg(p.estimated_hours),
      0,
    ),
  );

  // 实践类的前置（传递）学习项，在实践优先路线里排在其他学习项之前。
  const practiceIds = items.filter((b) => b.practice && !b.step.skipped).map((b) => b.step.id);
  const practiceAncestors = withAncestors(items, practiceIds);

  const ranks: Record<RouteType, (b: BaseStep) => number> = {
    learning_first: (b) => (b.practice ? 1 : 0),
    practice_first: (b) => (b.practice ? 0 : practiceAncestors.has(b.step.id) ? 1 : 2),
    community: (b) => (b.required ? 0 : 1),
  };

  const types: RouteType[] = ['learning_first'];
  if (practiceIds.length > 0) types.push('practice_first');
  types.push('community');

  const ctx: RouteContext = {
    opp,
    hours,
    budget,
    today: options?.today,
    requiredOnlyHours,
    cyclicWarning: 'Some prep items depend on each other in a loop, so their order is unclear. Steps in the loop start from the earliest one in the original list; other dependencies are still respected. Please confirm with the organizer or your team.',
  };

  let anyCyclic = false;
  const routes = types.map((type) => {
    const { order, cyclic } = topoSort(items, ranks[type]);
    anyCyclic = anyCyclic || cyclic;
    return buildRoute(type, order, cyclic, ctx);
  });
  if (anyCyclic) warnings.push('Prep items in the opportunity data depend on each other in a loop; steps in the loop start from the earliest one in the original list.');

  return {
    status: 'routes',
    profile_id: profile.id,
    opportunity_id: opp.id,
    routes,
    warnings,
  };
}
