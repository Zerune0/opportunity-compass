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
import { daysBetween, parseISODate } from '../eligibility/dates';
import { findCoveringEvidence } from '../reachability/coverage';
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
  fmt,
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
    const base = `不满足硬性要求「${b.label}」：${b.explanation}官网原文：「${b.source_text}」。`;
    if (b.requirement_type === 'prerequisite_skill' || b.requirement_type === 'portfolio') {
      return `${base}补上这一项并更新档案后，可以重新规划。`;
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
      .map((b) => `「${b.label}」`)
      .join('、');
    let text = `${labels}可能随年级 / 年龄增长而满足，可以关注之后的届次，到时请按官网最新要求重新确认。`;
    if (opp.recurring_annually == null) text += '是否每年举办请向官方确认。';
    alternatives.push({ kind: 'next_cycle', text });
  }
  const fields = (opp.fields ?? []).filter((f) => typeof f === 'string' && f !== '');
  if (fields.length > 0) {
    alternatives.push({
      kind: 'same_field',
      text: `可以看看同领域（${fields.join('、')}）的其他已核实机会。`,
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
  const descParts = [prep.required_for_application ? '申请必需。' : '建议准备，可提高竞争力。'];
  if (prep.source_text) descParts.push(`依据：${prep.source_text}`);
  return {
    id: prep.id,
    title: prep.title,
    description: descParts.join(''),
    prep_item_id: prep.id,
    depends_on: deps,
    hours: safeNonNeg(prep.estimated_hours),
    cost_usd: safeNonNeg(prep.estimated_cost_usd),
    skipped,
    skip_reason: skipped ? `已有${covering.map((e) => `《${e.title}》`).join('、')}覆盖这一项` : null,
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
      dataWarnings.push(`准备项「${prep.title}」的 id 与固定步骤冲突，已忽略，请检查机会数据。`);
      continue;
    }
    if (seen.has(prep.id)) {
      dataWarnings.push(`准备项 id「${prep.id}」重复，只保留第一项，请检查机会数据。`);
      continue;
    }
    seen.add(prep.id);
    accepted.push(prep);
  }

  const items = accepted.map((prep, index) => {
    const deps: string[] = [];
    for (const d of Array.isArray(prep.depends_on) ? prep.depends_on : []) {
      if (d === prep.id) {
        dataWarnings.push(`准备项「${prep.title}」把自己列为依赖，已忽略这条依赖，请检查机会数据。`);
        continue;
      }
      if (!seen.has(d)) {
        dataWarnings.push(`准备项「${prep.title}」依赖的「${d}」在该机会中不存在，已忽略这条依赖。`);
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
  if (opp.deadline == null) missing.push('官网没有写明截止日期（可能是滚动录取）');
  else if (deadline == null) missing.push('截止日期格式无法识别');
  const now = today == null ? null : parseISODate(today);
  if (today == null) missing.push('没有提供今天的日期');
  else if (now == null) missing.push('今天的日期格式无法识别');

  // 截止日已过与每周可用小时无关：日期都能解析时先判断。
  if (deadline != null && now != null) {
    const daysLeft = daysBetween(now, deadline);
    if (daysLeft < 0) return { value: false, missing: [], deadlinePassed: true, capacityHours: 0, daysLeft };
  }

  if (hours.kind === 'missing') missing.push('档案里还没有填每周可用小时数');
  else if (hours.kind === 'invalid') missing.push('档案里填写的每周可用小时数无效（需大于 0）');

  const none: Feasibility = { value: null, missing, deadlinePassed: false, capacityHours: null, daysLeft: null };
  if (missing.length > 0 || deadline == null || now == null || hours.kind !== 'ok') return none;

  const hpw = hours.value;
  const days = daysBetween(now, deadline);
  const capacity = (hpw * Math.max(days, 1)) / 7;
  return { value: totalHours <= capacity, missing, deadlinePassed: false, capacityHours: capacity, daysLeft: days };
}

// ───────────────────────────── 路线 ─────────────────────────────

const RATIONALE: Record<RouteType, string> = {
  learning_first: '先补齐知识和申请材料，再动手做作品；适合刚入门、想先把基础打牢的情况。',
  practice_first: '尽早动手做项目 / 作品，需要的知识边做边补，作品本身也能成为申请材料；适合已经有一点基础、想尽快拿出成果的情况。',
  community: '先找到同伴或导师，再一起推进，优先完成申请必需项；适合一个人推进有困难、希望有人一起或有人指点的情况。',
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
      title: '找到同伴或导师',
      description:
        '可以找学校老师、社区组织或线上学习社群，约好一起准备或定期请教。2 小时是估算，用来联系和约第一次见面。',
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
    title: '提交申请',
    description: `按官网要求提交申请材料${opp.deadline ? `（截止日期 ${opp.deadline}，具体时间以官网为准）` : ''}。提交申请不等于会被录取。`,
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
    warnings.push(`超出预算 ${usd(round2(total_cost_usd - ctx.budget))}（这条路线约需 ${usd(total_cost_usd)}，档案预算 ${usd(ctx.budget)}）。`);
  }
  if (feas.value === false) {
    if (feas.deadlinePassed) {
      warnings.push(`截止日期 ${opp.deadline} 已过，这一届来不及申请了。`);
    } else {
      warnings.push(
        `按每周 ${fmt(hpw as number)} 小时，到截止日期 ${opp.deadline}（还剩 ${feas.daysLeft} 天）大约能投入 ${fmt(round2(feas.capacityHours as number))} 小时，这条路线需要 ${fmt(total_hours)} 小时，可能来不及。只做申请必需项（含它们的前置步骤）需要 ${fmt(ctx.requiredOnlyHours)} 小时，可供参考；删减哪些步骤由你决定。`,
      );
    }
  } else if (feas.value === null) {
    warnings.push(`暂时无法判断能否在截止日期前完成：${feas.missing.join('；')}。`);
  }

  let rationale = RATIONALE[type];
  if (hpw != null && estimated_weeks != null) {
    rationale += `按档案中每周可用 ${fmt(hpw)} 小时，这条路线约需 ${estimated_weeks} 周。`;
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
      .map((i) => `「${i.label}」`)
      .join('、');
    warnings.push(`资格还没确认：${labels}。请先对照官网原文向官方确认，再投入准备。`);
  }
  for (const i of eligibility.items) {
    if (!i.hard && i.status === 'not_satisfied') {
      warnings.push(`加分项「${i.label}」目前不满足（不影响申请资格）。`);
    }
  }

  const { items, dataWarnings } = buildBaseSteps(profile, opp);
  warnings.push(...dataWarnings);
  if (items.length === 0) warnings.push('这个机会没有列出准备项，路线里只有固定步骤，请以官网要求为准。');

  const hours = hoursState(profile.hours_per_week_available);
  if (hours.kind === 'invalid') {
    warnings.push('档案里填写的每周可用小时数无效（需大于 0），暂时无法估算周数和能否来得及，请更新档案。');
  }
  const budgetRaw = profile.budget_usd;
  let budget: number | null = null;
  if (typeof budgetRaw === 'number' && Number.isFinite(budgetRaw) && budgetRaw >= 0) {
    budget = budgetRaw;
  } else if (budgetRaw != null) {
    warnings.push('档案里填写的预算数值无效（不能为负数），这次没有做预算比较，请更新档案。');
  }

  // 只做申请必需项：只取未被证据跳过的必需项；遇到已跳过的前置步骤不计入，也不再往前追。
  const requiredIds = items.filter((b) => b.required && !b.step.skipped).map((b) => b.step.id);
  const requiredClosure = withAncestors(items, requiredIds, (b) => b.step.skipped);
  const requiredOnlyHours = round2(
    items.filter((b) => requiredClosure.has(b.step.id)).reduce((sum, b) => sum + b.step.hours, 0),
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
    cyclicWarning: '部分准备项的依赖关系成环，无法确定先后，环上的步骤从原顺序最靠前的一项开始排，其余依赖关系仍被遵守，请向官方或团队确认。',
  };

  let anyCyclic = false;
  const routes = types.map((type) => {
    const { order, cyclic } = topoSort(items, ranks[type]);
    anyCyclic = anyCyclic || cyclic;
    return buildRoute(type, order, cyclic, ctx);
  });
  if (anyCyclic) warnings.push('机会数据中的准备项依赖关系成环，环上的步骤从原顺序最靠前的一项开始排列。');

  return {
    status: 'routes',
    profile_id: profile.id,
    opportunity_id: opp.id,
    routes,
    warnings,
  };
}
