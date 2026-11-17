/**
 * runWhatIf(scenario, input) — 主办方 What-if 页面的视图模型（纯函数，页面只负责渲染）。
 *
 * 流程：
 * 1. 处理勾选：enabledIds = 纳入考虑的措施；requiredIds = 主办方要求必须启用的措施（须是 enabledIds 的子集）。
 *    **前置依赖的处理**：已纳入、但其前置依赖（requires）未纳入的措施会被排除（迭代到不动点，规则与
 *    ./scenarios 的 resolveEnabledInterventions / withEnabledInterventions 相同），并在 `excluded` 与
 *    `assumptions` 里写明原因。不会出现「依赖没开、措施照样生效」。
 *    runWhatIf 不会替用户自动补上依赖（页面可以提供「一键带上」）。
 *    不在纳入范围内的必须启用项会被忽略，并在 `ignored_required` 里说明。
 * 2. withEnabledInterventions / withBudget 得到场景 → solveJoint。
 * 3. 对主结果**独立再调用一次 verifyPlan**（相同的 mode / loss_cap / 软要求），页面展示的是这次复核。
 *    例外：求解器因「内部复核未通过」返回 UNSUPPORTED_INPUT 时，展示求解器保留的那次失败复核（被舍弃方案的复核），
 *    让页面能看到哪一项没通过。
 * 4. 汇总成 WhatIfView：只含汇总数字，不含任何学生的 id、姓名、学校或逐人明细；
 *    求解器 / 验证器文字里的措施 id 先换成标题，再把学生 id、姓名、学校替换为「某学生」/「某学校」，并注明涉及人数。
 * 5. 没有评估出来的数字（UNSUPPORTED_INPUT 时的成本、余额、G / L / N 等）为 null，页面显示「—」。
 *    预算或最低新增目标不是有限数时不会抛错；视图里的文字不出现 NaN / Infinity（换成「未填写或无效」），
 *    非有限的数字字段一律为 null。页面本身应在输入无效时不调用 runWhatIf，这里只是防线。
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入。
 * 所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 */
import { analyzeReachability } from '../reachability';
import { solveJoint } from './solve';
import { verifyPlan } from './verify';
import {
  MIN_NAME_TOKEN_LENGTH,
  missingPrerequisites,
  resolveEnabledInterventions,
  withBudget,
  withEnabledInterventions,
} from './scenario-utils';

export { missingPrerequisites };
import type {
  Allocation,
  BarrierType,
  Intervention,
  JointCost,
  JointOutcome,
  JointStatus,
  ResourceGrant,
  Scenario,
  SolveOptions,
  VerifyOptions,
} from '../types';

// ───────────────────────────── 类型 ─────────────────────────────

export interface WhatIfInput {
  /** 纳入考虑的措施 id。 */
  enabledIds: string[];
  /** 主办方要求必须启用的措施 id（须是 enabledIds 的子集，否则忽略并说明）。 */
  requiredIds: string[];
  /** 预算（美元）。 */
  budget: number;
  /** 最低新增目标（G ≥ minGain）；null / 缺省 = 不要求。 */
  minGain?: number | null;
  /** 缺省 protect（不允许原有覆盖减少）。 */
  mode?: 'protect' | 'tradeoff';
  /** tradeoff 模式下允许的最大损失。 */
  lossCap?: number | null;
}

export interface WhatIfLabels {
  /** 「模拟结果，不代表真实影响」 */
  simulation: string;
  /** 「示例学生 / 示例场景」 */
  sample: string;
  /** 「占位机会，待替换为已核实的真实机会」 */
  placeholder_opportunity: string;
  /** 可达 ≠ 录取 */
  reachable_not_admission: string;
}

/** 主结果的成本。null = 没有评估（UNSUPPORTED_INPUT）或输入无效，页面显示「—」。 */
export interface WhatIfCost {
  fixed_usd: number | null;
  /** 按人计的成本合计（各措施 unit_cost × 服务的不同学生数）。 */
  per_student_usd: number | null;
  total_usd: number | null;
  /** 预算；不是有限数时为 null。 */
  budget_usd: number | null;
  /** 预算 − 总成本；没有评估或预算无效时为 null。 */
  remaining_usd: number | null;
}

/** 已评估方案（替代方案 / 条件性方案）的成本，总是有数字。 */
export interface WhatIfPlanCost {
  fixed_usd: number;
  per_student_usd: number;
  total_usd: number;
}

export interface WhatIfSelected {
  id: string;
  title: string;
  /** 本措施服务的不同学生人数。 */
  students_served: number;
  fixed_usd: number;
  per_student_usd: number;
  subtotal_usd: number;
}

export interface WhatIfCapacitySlot {
  /** 范围说明：「全场景」或「时段 xxx」。 */
  scope_label: string;
  used: number;
  capacity: number | null;
  full: boolean;
}

export interface WhatIfCapacity {
  id: string;
  title: string;
  selected: boolean;
  /** 不限容量时为空数组。 */
  slots: WhatIfCapacitySlot[];
  unlimited: boolean;
}

export interface WhatIfCheck {
  name: string;
  /** 中文标签。 */
  label: string;
  passed: boolean;
  /** 说明（已去除学生 id / 姓名 / 学校）。 */
  detail: string;
}

export interface WhatIfVerification {
  passed: boolean;
  checks: WhatIfCheck[];
  /** 解读复核结果的补充说明（如 INFEASIBLE 时空方案不满足主办方要求是预期的）；没有则为 null。 */
  note: string | null;
}

export interface WhatIfOutcomeSummary {
  R1_count: number;
  G: number;
  L: number;
  N: number;
  cost: WhatIfPlanCost;
  selected: WhatIfSelected[];
}

export interface WhatIfAlternative extends WhatIfOutcomeSummary {
  /** 放松了哪些要求（中文）。 */
  relaxed: string[];
  note: string;
}

export interface WhatIfConditional extends WhatIfOutcomeSummary {
  status: JointStatus;
  status_label: string;
  /** 假设获批的措施标题。 */
  assumed_approved: string[];
  /** 与当前结果相比的差异。 */
  delta: { G: number; L: number; N: number; total_usd: number };
  /** 对条件性方案的独立复核是否通过（带 assume_approved）。 */
  verification_passed: boolean;
  note: string;
}

export interface WhatIfUncoveredReason {
  /** 障碍类型或 'eligibility' / 'unknown'。 */
  kind: BarrierType | 'eligibility' | 'unknown';
  /** 涉及的不同学生人数。 */
  students: number;
  /** 可能原因（中文）。 */
  cause: string;
  /** 完整一句话，如「5 人仍缺设备（名额已满）」。 */
  text: string;
}

export interface WhatIfUncovered {
  /** 方案后仍不可达的（学生, 机会）对数。 */
  pairs: number;
  /** 至少有一个机会仍不可达的不同学生人数。 */
  students: number;
  reasons: WhatIfUncoveredReason[];
}

export interface WhatIfExcluded {
  id: string;
  title: string;
  /** 缺少的前置依赖（标题）。 */
  missing_requires: string[];
  reason: string;
}

export interface WhatIfView {
  scenario_title: string;
  evaluation_date: string;
  is_sample: true;
  student_count: number;
  opportunities: { title: string; is_placeholder: boolean }[];
  /** 实际参与求解的设置。 */
  effective: {
    enabled_ids: string[];
    required_ids: string[];
    /** 不是有限数时为 null。 */
    budget_usd: number | null;
    /** 不设目标或不是有限数时为 null。 */
    min_gain: number | null;
    mode: 'protect' | 'tradeoff';
    loss_cap: number | null;
  };
  /** 因前置依赖未纳入而被排除的措施。 */
  excluded: WhatIfExcluded[];
  /** 被忽略的「必须启用」项。 */
  ignored_required: { id: string; title: string; reason: string }[];
  status: JointStatus;
  status_label: string;
  status_explanation: string;
  /** 以下五个数在 UNSUPPORTED_INPUT（没有评估）时为 null。 */
  R0_count: number | null;
  R1_count: number | null;
  G: number | null;
  L: number | null;
  N: number | null;
  cost: WhatIfCost;
  selected: WhatIfSelected[];
  capacity_usage: WhatIfCapacity[];
  verification: WhatIfVerification;
  alternative: WhatIfAlternative | null;
  conditional: WhatIfConditional | null;
  /** UNSUPPORTED_INPUT 时为 null（没有评估）。 */
  uncovered: WhatIfUncovered | null;
  /** 求解器说明（已脱敏）。 */
  solver_notes: string[];
  assumptions: string[];
  labels: WhatIfLabels;
}

// ───────────────────────────── 常量 ─────────────────────────────

export const WHATIF_LABELS: WhatIfLabels = {
  simulation: '模拟结果，不代表真实影响',
  sample: '示例学生 / 示例场景',
  placeholder_opportunity: '占位机会，待替换为已核实的真实机会',
  reachable_not_admission: '可达 ≠ 录取：可达只表示资格不冲突、现实条件走得通',
};

export const STATUS_LABELS: Record<JointStatus, string> = {
  OPTIMAL: '已找到最优方案',
  INFEASIBLE: '做不到',
  SEARCH_LIMIT_REACHED: '达到搜索上限',
  UNSUPPORTED_INPUT: '输入不支持',
};

const STATUS_EXPLANATIONS: Record<JointStatus, string> = {
  OPTIMAL:
    '已完成全部搜索：在当前勾选、预算与要求下，没有比这更好的方案（先比净变化，再比成本）。',
  INFEASIBLE:
    '做不到：在不突破容量、预算、互斥、前置依赖等硬约束的前提下，无法同时满足你提的要求（必须启用的措施 / 最低新增目标）。当前结果是「不启用任何措施」；放松要求后的替代方案见下方，求解器没有悄悄降低要求。',
  SEARCH_LIMIT_REACHED:
    '达到搜索上限后停止：显示的是上限内找到的、经独立复核通过的最好方案，不保证最优，也不代表没有更好的方案。',
  UNSUPPORTED_INPUT:
    '输入不合法或超出求解器支持范围（或求解器的内部复核未通过，按不支持的输入处理），没有给出方案。原因见求解器说明。',
};

export const CHECK_LABELS: Record<string, string> = {
  input_validity: '输入合法',
  approval: '措施均已批准',
  mutual_exclusion: '没有同时启用互斥措施',
  prerequisite: '前置依赖已启用',
  allocation_validity: '分配合法',
  capacity: '未超出名额',
  cost_accounting: '成本记账正确',
  budget: '未超出预算',
  eligibility: '资格交叉检查（措施不改变官方资格）',
  deadline: '截止日期交叉检查',
  barrier_resolution: '障碍确实被化解',
  coverage_loss: '原本可达的没有减少',
  organizer_requirements: '主办方要求',
  metrics: '指标重算一致',
};

const BARRIER_ZH: Record<BarrierType, string> = {
  device: '设备',
  transport: '交通条件',
  cost: '费用',
  time: '时间',
};

const RELAXED_ZH: Record<'required_intervention_ids' | 'min_gain', string> = {
  required_intervention_ids: '不再要求「必须启用」的措施',
  min_gain: '不再要求最低新增目标',
};

/** INFEASIBLE 时「仍未覆盖」的障碍原因。 */
export const INFEASIBLE_UNCOVERED_CAUSE = '当前要求无法满足，主结果为不启用任何措施；可参考上方的替代方案';

const EPS = 1e-6;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const isApproved = (iv: Intervention) => iv.status !== 'pending';
const pairKey = (s: string, o: string) => JSON.stringify([s, o]);

// ───────────────────────────── 辅助 ─────────────────────────────

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把文字中的学生 id / 显示名 / 学校名替换为「某学生」/「某学校」，并在末尾注明涉及人数。
 * - 按长度降序替换（先长后短），避免 dl-s1 误伤 dl-s10。
 * - 学生 id（任意长度）只在边界处替换：前后都不是 ASCII 字母数字、连字符或下划线。
 * - 姓名 / 学校名短于 3 个字符时不做子串替换（避免把 "X" 当学校名改坏 "Xavier"）；
 *   这类短标识要靠场景校验（措施 id / 标题不得含学生信息）兜底。
 */
export function scrubStudentInfo(text: string, scenario: Scenario): string {
  type Tok = { token: string; sid: string; repl: string; isId: boolean };
  const toks: Tok[] = [];
  for (const s of scenario.students) {
    if (typeof s.id === 'string' && s.id) toks.push({ token: s.id, sid: s.id, repl: '某学生', isId: true });
    if (typeof s.display_name === 'string' && s.display_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.display_name, sid: s.id, repl: '某学生', isId: false });
    }
    if (typeof s.school_name === 'string' && s.school_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.school_name, sid: s.id, repl: '某学校', isId: false });
    }
  }
  toks.sort((a, b) => b.token.length - a.token.length || cmpStr(a.token, b.token));
  const hit = new Set<string>();
  let out = text;
  for (const t of toks) {
    if (t.isId) {
      const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(t.token)}(?![A-Za-z0-9_-])`, 'g');
      if (re.test(out)) {
        hit.add(t.sid);
        re.lastIndex = 0;
        out = out.replace(re, t.repl);
      }
    } else if (out.includes(t.token)) {
      hit.add(t.sid);
      out = out.split(t.token).join(t.repl);
    }
  }
  if (hit.size > 0) out += `（涉及 ${hit.size} 名学生，已隐去身份）`;
  return out;
}

/** 把文字中用「」括起来的措施 id 换成措施标题（求解器 / 验证器的说明里用的是 id）。 */
function humanizeInterventionIds(text: string, scenario: Scenario): string {
  let out = text;
  const ivs = [...scenario.interventions].sort((a, b) => b.id.length - a.id.length || cmpStr(a.id, b.id));
  for (const iv of ivs) out = out.split(`「${iv.id}」`).join(`「${iv.title}」`);
  return out;
}

/** 先把措施 id 换成标题，再脱敏（换进去的标题也会被检查）。 */
function cleanText(text: string, scenario: Scenario): string {
  return scrubStudentInfo(humanizeInterventionIds(text, scenario), scenario);
}

const INVALID_NUMBER_TEXT = '未填写或无效';

/** 防线：把视图里所有文字中的 NaN / Infinity 换成「未填写或无效」，非有限数字换成 null。 */
function scrubNonFinite<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/[-+]?Infinity|NaN/g, INVALID_NUMBER_TEXT);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** 已纳入、但前置依赖未纳入的措施会被排除（迭代到不动点；规则见 resolveEnabledInterventions）。 */
function resolvePrerequisites(
  scenario: Scenario,
  enabledIds: readonly string[],
): { enabled: string[]; excluded: WhatIfExcluded[] } {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const { enabled, removed } = resolveEnabledInterventions(scenario, enabledIds);
  const excluded: WhatIfExcluded[] = removed.map((r) => {
    const names = r.missing_requires.map(title);
    return {
      id: r.id,
      title: title(r.id),
      missing_requires: names,
      reason: `「${title(r.id)}」需要同时纳入${names.map((n) => `「${n}」`).join('、')}，后者未纳入，所以本措施没有参与求解。`,
    };
  });
  return { enabled, excluded };
}

function synthGrant(scenario: Scenario, iv: Intervention, a: Allocation): ResourceGrant {
  return {
    id: 'alloc:' + a.intervention_id + ':' + a.student_id + ':' + a.opportunity_id,
    student_id: a.student_id,
    opportunity_id: a.opportunity_id,
    intervention_id: a.intervention_id,
    type: iv.type,
    amount_usd: iv.amount_usd ?? null,
    device: iv.device ?? null,
    hours_per_week: iv.hours_per_week ?? null,
    status: 'approved',
    provider: scenario.title,
    is_sample: true,
  };
}

function summarizeSelected(scenario: Scenario, outcome: JointPlan2): WhatIfSelected[] {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  return outcome.selected_intervention_ids.map((id) => {
    const iv = byId.get(id);
    const allocs = outcome.allocations.filter((a) => a.intervention_id === id);
    const served = new Set(allocs.map((a) => a.student_id)).size;
    const fixed = iv?.fixed_cost_usd ?? 0;
    const per = allocs.reduce((s, a) => s + a.cost_usd, 0);
    return {
      id,
      title: iv?.title ?? id,
      students_served: served,
      fixed_usd: round2(fixed),
      per_student_usd: round2(per),
      subtotal_usd: round2(fixed + per),
    };
  });
}

type JointPlan2 = Pick<JointOutcome, 'selected_intervention_ids' | 'allocations'>;

function costOf(c: JointCost): WhatIfPlanCost {
  return { fixed_usd: round2(c.fixed_usd), per_student_usd: round2(c.marginal_usd), total_usd: round2(c.total_usd) };
}

function outcomeSummary(scenario: Scenario, o: JointOutcome): WhatIfOutcomeSummary {
  return {
    R1_count: o.R1.length,
    G: o.G,
    L: o.L,
    N: o.N,
    cost: costOf(o.cost),
    selected: summarizeSelected(scenario, o),
  };
}

const DEFAULT_SLOT = '\u0000default';

function capacityUsage(scenario: Scenario, plan: JointPlan2): WhatIfCapacity[] {
  const slotOf = (oid: string | null | undefined): string => {
    const slots = scenario.opportunity_time_slots;
    if (slots && oid != null && Object.prototype.hasOwnProperty.call(slots, oid)) return slots[oid];
    return DEFAULT_SLOT;
  };
  const allSlots = [...new Set([DEFAULT_SLOT, ...Object.values(scenario.opportunity_time_slots ?? {})])].sort(cmpStr);
  const usedSlots = new Set(scenario.opportunities.map((o) => slotOf(o.id)));
  const selected = new Set(plan.selected_intervention_ids);
  return scenario.interventions
    .filter(isApproved)
    .map((iv) => {
      const allocs = plan.allocations.filter((a) => a.intervention_id === iv.id);
      const existing = (scenario.existing_grants ?? []).filter((g) => g.intervention_id === iv.id);
      if (iv.capacity == null) {
        return { id: iv.id, title: iv.title, selected: selected.has(iv.id), slots: [], unlimited: true };
      }
      const cap = iv.capacity;
      let slots: WhatIfCapacitySlot[];
      if (iv.capacity_scope === 'per_time_slot') {
        slots = allSlots
          .filter((t) => usedSlots.has(t))
          .map((t) => {
            const set = new Set<string>();
            for (const g of existing) if (g.opportunity_id === null || slotOf(g.opportunity_id) === t) set.add(String(g.student_id));
            for (const a of allocs) if (slotOf(a.opportunity_id) === t) set.add(a.student_id);
            return {
              scope_label: t === DEFAULT_SLOT ? '默认时段' : `时段 ${t}`,
              used: set.size,
              capacity: cap,
              full: set.size >= cap - EPS,
            };
          });
      } else {
        const set = new Set<string>();
        for (const g of existing) set.add(String(g.student_id));
        for (const a of allocs) set.add(a.student_id);
        slots = [{ scope_label: '全场景', used: set.size, capacity: cap, full: set.size >= cap - EPS }];
      }
      return { id: iv.id, title: iv.title, selected: selected.has(iv.id), slots, unlimited: false };
    });
}

function uncoveredSummary(
  scenario: Scenario,
  fullScenario: Scenario,
  outcome: JointOutcome,
  capacity: WhatIfCapacity[],
  remainingBudget: number,
  infeasible: boolean,
): WhatIfUncovered {
  const ivById = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const r1 = new Set(outcome.R1.map((p) => pairKey(p.student_id, p.opportunity_id)));
  const existing = scenario.existing_grants ?? [];
  const byKind = new Map<WhatIfUncoveredReason['kind'], Set<string>>();
  const kindsOf = new Map<string, Set<WhatIfUncoveredReason['kind']>>();
  const add = (k: WhatIfUncoveredReason['kind'], sid: string) => {
    const set = byKind.get(k) ?? new Set<string>();
    set.add(sid);
    byKind.set(k, set);
    const ks = kindsOf.get(sid) ?? new Set<WhatIfUncoveredReason['kind']>();
    ks.add(k);
    kindsOf.set(sid, ks);
  };
  let pairs = 0;
  const students = new Set<string>();
  for (const s of scenario.students) {
    for (const o of scenario.opportunities) {
      if (r1.has(pairKey(s.id, o.id))) continue;
      pairs++;
      students.add(s.id);
      const grants: ResourceGrant[] = [...existing];
      for (const a of outcome.allocations) {
        if (a.student_id !== s.id || a.opportunity_id !== o.id) continue;
        const iv = ivById.get(a.intervention_id);
        if (iv) grants.push(synthGrant(scenario, iv, a));
      }
      const res = analyzeReachability(s, o, grants, { today: scenario.evaluation_date });
      const hardFail = res.eligibility.items.some((r) => r.hard && r.status === 'not_satisfied');
      if (hardFail) add('eligibility', s.id);
      const unresolved = res.barriers.filter((b) => !b.resolved).map((b) => b.type);
      for (const t of unresolved) add(t, s.id);
      if (!hardFail && unresolved.length === 0) add('unknown', s.id);
    }
  }

  const selected = new Set(outcome.selected_intervention_ids);
  const causeFor = (t: BarrierType, who: Set<string>): string => {
    // INFEASIBLE：主结果是空方案，是因为主办方提的要求做不到，不是名额、预算或其他约束挡住了这些学生。
    if (infeasible) return INFEASIBLE_UNCOVERED_CAUSE;
    // 只用于解释（展示用），求解与复核都不读 resolves。
    const enabled = scenario.interventions.filter((iv) => iv.resolves.includes(t));
    const enabledApproved = enabled.filter(isApproved);
    if (enabledApproved.length === 0) {
      if (enabled.length > 0) return '能化解它的措施待审批，未计入当前结果';
      if (fullScenario.interventions.some((iv) => iv.resolves.includes(t))) return '能化解它的措施没有纳入方案';
      return '场景中没有能化解它的措施';
    }
    const full = enabledApproved.some(
      (iv) => selected.has(iv.id) && capacity.find((c) => c.id === iv.id)?.slots.some((sl) => sl.full),
    );
    if (full) return '名额已满';
    const minExtra = Math.min(
      ...enabledApproved.map((iv) => iv.unit_cost_usd + (selected.has(iv.id) ? 0 : iv.fixed_cost_usd ?? 0)),
    );
    if (minExtra > remainingBudget + EPS) return '预算不足';
    const allBlockedElsewhere = [...who].every((sid) => (kindsOf.get(sid)?.size ?? 0) > 1);
    if (allBlockedElsewhere) return '这些学生同时还缺其他条件，只化解这一项不会让他们变为可达，所以方案没有为此分配';
    return '受互斥、前置依赖等其他约束限制，方案没有覆盖';
  };

  const order: WhatIfUncoveredReason['kind'][] = ['eligibility', 'device', 'transport', 'cost', 'time', 'unknown'];
  const reasons: WhatIfUncoveredReason[] = [];
  for (const k of order) {
    const set = byKind.get(k);
    if (!set || set.size === 0) continue;
    const n = set.size;
    if (k === 'eligibility') {
      const cause = '措施不能改变官方资格';
      reasons.push({ kind: k, students: n, cause, text: `${n} 人不符合官方资格：${cause}` });
    } else if (k === 'unknown') {
      const cause = '信息不足，需向官方或学生确认';
      reasons.push({ kind: k, students: n, cause, text: `${n} 人无法判定是否可达：${cause}` });
    } else {
      const cause = causeFor(k, set);
      reasons.push({ kind: k, students: n, cause, text: `${n} 人仍缺${BARRIER_ZH[k]}：${cause}` });
    }
  }
  return { pairs, students: students.size, reasons };
}

// ───────────────────────────── 主函数 ─────────────────────────────

export function runWhatIf(scenario: Scenario, input: WhatIfInput): WhatIfView {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const title = (id: string) => byId.get(id)?.title ?? id;

  // 1. 勾选与前置依赖
  const { enabled, excluded } = resolvePrerequisites(scenario, input.enabledIds);
  const enabledSet = new Set(enabled);
  const ignored_required: WhatIfView['ignored_required'] = [];
  const required: string[] = [];
  for (const id of [...new Set(input.requiredIds)]) {
    if (enabledSet.has(id)) required.push(id);
    else {
      const wasExcluded = excluded.some((e) => e.id === id);
      ignored_required.push({
        id,
        title: title(id),
        reason: wasExcluded
          ? `「${title(id)}」因前置依赖未纳入而被排除，「必须启用」这一要求被忽略。`
          : `「${title(id)}」没有纳入方案，「必须启用」这一要求被忽略。`,
      });
    }
  }
  required.sort(cmpStr);

  const mode = input.mode ?? 'protect';
  const minGain = input.minGain ?? null;
  const budgetValid = Number.isFinite(input.budget);
  const lossCap = input.lossCap ?? null;

  // 2. 求解
  const eff = withBudget(withEnabledInterventions(scenario, enabled), input.budget);
  const opts: SolveOptions = { mode };
  if (mode === 'tradeoff' && lossCap !== null) opts.loss_cap = lossCap;
  if (required.length > 0) opts.required_intervention_ids = required;
  if (minGain !== null) opts.min_gain = minGain;
  const result = solveJoint(eff, opts);

  // 3. 独立复核（主结果）
  const vOpts: VerifyOptions = { mode };
  if (opts.loss_cap !== undefined) vOpts.loss_cap = opts.loss_cap;
  if (opts.required_intervention_ids) vOpts.required_intervention_ids = opts.required_intervention_ids;
  if (opts.min_gain !== undefined) vOpts.min_gain = opts.min_gain;
  const plainPlan = { selected_intervention_ids: result.selected_intervention_ids, allocations: result.allocations };
  // 内部复核未通过（UNSUPPORTED_INPUT 且求解器保留了失败的复核）：展示那次失败的复核。
  const internalFailure = result.status === 'UNSUPPORTED_INPUT' && result.verification != null;
  const vr =
    internalFailure && result.verification
      ? result.verification
      : verifyPlan(eff, result.status === 'UNSUPPORTED_INPUT' ? plainPlan : result, vOpts);
  const verification: WhatIfVerification = {
    passed: vr.passed && result.status !== 'UNSUPPORTED_INPUT',
    checks: vr.checks.map((c) => ({
      name: c.name,
      label: CHECK_LABELS[c.name] ?? c.name,
      passed: c.passed,
      detail: cleanText(c.detail, scenario),
    })),
    note:
      result.status === 'INFEASIBLE'
        ? '主结果是「不启用任何措施」的空方案，它本来就不满足你提的要求，所以「主办方要求」一项不通过是预期的；其余硬约束检查用来确认空方案本身合法。'
        : internalFailure
          ? '求解器找到的方案没有通过独立复核，已舍弃、未给出（当前结果为空方案）；下面是被舍弃方案的复核结果。请检查场景数据。'
          : result.status === 'UNSUPPORTED_INPUT'
            ? '输入不合法，未做评估；复核里「输入合法」一项会说明原因。'
            : null,
  };

  // 4. 汇总
  const evaluated = result.status !== 'UNSUPPORTED_INPUT';
  const budgetUsd = budgetValid ? input.budget : null;
  const planCost = costOf(result.cost);
  const cost: WhatIfCost = evaluated
    ? {
        ...planCost,
        budget_usd: budgetUsd,
        remaining_usd: budgetUsd !== null ? round2(budgetUsd - result.cost.total_usd) : null,
      }
    : { fixed_usd: null, per_student_usd: null, total_usd: null, budget_usd: budgetUsd, remaining_usd: null };
  const capacity_usage = capacityUsage(eff, result);

  let alternative: WhatIfAlternative | null = null;
  if (result.alternative) {
    alternative = {
      ...outcomeSummary(eff, result.alternative),
      relaxed: result.alternative.relaxed.map((k) => RELAXED_ZH[k]),
      note: cleanText(result.alternative.note, scenario),
    };
  }

  let conditional: WhatIfConditional | null = null;
  if (result.conditional) {
    const c = result.conditional;
    const cv = verifyPlan(eff, c, { ...vOpts, assume_approved_intervention_ids: c.assumed_approved_intervention_ids });
    conditional = {
      ...outcomeSummary(eff, c),
      status: c.status,
      status_label: STATUS_LABELS[c.status],
      assumed_approved: c.assumed_approved_intervention_ids.map(title),
      delta: {
        G: c.G - result.G,
        L: c.L - result.L,
        N: c.N - result.N,
        total_usd: round2(c.cost.total_usd - result.cost.total_usd),
      },
      verification_passed: c.status === 'INFEASIBLE' || c.status === 'UNSUPPORTED_INPUT' ? false : cv.passed,
      note: cleanText(c.note, scenario),
    };
  }

  const uncovered = evaluated
    ? uncoveredSummary(eff, scenario, result, capacity_usage, cost.remaining_usd ?? 0, result.status === 'INFEASIBLE')
    : null;

  // 假设与不确定性
  const enabledPending = eff.interventions.filter((iv) => !isApproved(iv)).map((iv) => `「${iv.title}」`);
  const assumptions: string[] = [
    '所有学生和场景数据都是示例 / 模拟，不是真实学生，结果不代表真实影响。',
    '机会目前是占位，之后替换为人工核实过的真实机会（官方链接 + 核实日期）。',
    '「可达」只表示资格不冲突、现实条件（时间 / 费用 / 交通 / 设备）走得通，不等于录取，也不代表录取概率。',
    '模型假设学生会接受分配到的资源；实际是否接受、能否到场未纳入计算。',
    '各项成本、名额、预算都是示例数字。',
    `评估日期为 ${scenario.evaluation_date}：资格、年龄与截止日期都按这一天计算。`,
    enabledPending.length > 0
      ? `待审批的措施（${enabledPending.join('、')}）未计入当前结果，只出现在「如果获批」的条件性结果里。`
      : '待审批的措施不计入当前结果；本次没有纳入待审批的措施。',
    '每项措施的作用只通过它提供的资源（设备 / 补助 / 替代参与方式 / 时间）是否化解学生的现实障碍来判断，措施不能改变官方资格。',
    '若勾选的措施有前置依赖而依赖项没有纳入，该措施会被排除、不参与求解（不会出现「依赖没开、措施照样生效」）。',
    '名额或预算不够、多名学生条件相同时，按学生编号顺序决定分给谁（模拟中的确定性规则），不代表谁更需要。',
  ];
  for (const e of excluded) assumptions.push(e.reason);
  for (const r of ignored_required) assumptions.push(r.reason);
  if (result.status === 'SEARCH_LIMIT_REACHED') {
    assumptions.push('本次求解达到搜索上限：结果不保证最优，也不代表没有更好的方案。');
  }
  if (result.conditional?.status === 'SEARCH_LIMIT_REACHED') {
    assumptions.push('条件性结果的求解达到搜索上限：不保证最优。');
  }

  const view: WhatIfView = {
    scenario_title: scenario.title,
    evaluation_date: scenario.evaluation_date,
    is_sample: true,
    student_count: scenario.students.length,
    opportunities: scenario.opportunities.map((o) => ({
      title: o.title,
      is_placeholder: o.is_sample === true || o.title.includes('占位'),
    })),
    effective: {
      enabled_ids: enabled,
      required_ids: required,
      budget_usd: budgetUsd,
      min_gain: minGain !== null && Number.isFinite(minGain) ? minGain : null,
      mode,
      loss_cap: lossCap,
    },
    excluded,
    ignored_required,
    status: result.status,
    status_label: STATUS_LABELS[result.status],
    status_explanation: STATUS_EXPLANATIONS[result.status],
    R0_count: evaluated ? result.R0.length : null,
    R1_count: evaluated ? result.R1.length : null,
    G: evaluated ? result.G : null,
    L: evaluated ? result.L : null,
    N: evaluated ? result.N : null,
    cost,
    selected: summarizeSelected(eff, result),
    capacity_usage,
    verification,
    alternative,
    conditional,
    uncovered,
    solver_notes: result.notes.map((n) => cleanText(n, scenario)),
    assumptions,
    labels: WHATIF_LABELS,
  };
  return scrubNonFinite(view);
}

/** 页面「恢复默认」用的默认输入：纳入全部措施、不设必须启用、场景预算、无最低新增目标。 */
export function defaultWhatIfInput(scenario: Scenario): WhatIfInput {
  return {
    enabledIds: scenario.interventions.map((iv) => iv.id),
    requiredIds: [],
    budget: scenario.budget_usd,
    minGain: null,
    mode: 'protect',
  };
}
