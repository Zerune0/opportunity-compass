/**
 * 交叉检查：求解器（./solve，只 import、不读源码）对照独立验证器（./verify）与穷举（./exhaustive）。
 * 这是唯一允许 import 求解器的测试文件。全部是虚构示例数据，结果是模拟。
 *
 * 断言（按 CONTRACT「联合求解模型」）：
 * - 穷举可行 ⇔ 求解器 OPTIMAL；OPTIMAL 方案通过 verifyPlan，前六级指标（N、L、成本、分配条数、措施数、撤回数）与穷举一致；
 * - 穷举不可行 ⇔ 求解器 INFEASIBLE；主结果是空方案；alternative 的放松项按第 6 条规则（逐个规模 m、固定优先级），
 *   且直接（不删自带的 fairness，规则 R3）通过「去掉放松项」的 verifyPlan，指标与对应的穷举一致；
 * - 规则 R1：任何方案都不选被「场景外学生的不可撤回 grant」封锁的措施，也不撤回场景外学生的 grant；
 * - 每个方案的 revoked_grant_ids / lost_pairs / revocations / fairness 与验证器重算完全一致；protect 模式下撤回为空；
 * - 规范化（第 5 条）；conditional（第 7 条）；朴素枚举对极小场景逐字段比较完整方案（含撤回）。
 */
import { describe, expect, it } from 'vitest';
import type {
  DeviceType,
  FairnessFloor,
  FairnessReport,
  Intervention,
  JointOutcome,
  JointPlan,
  JointResult,
  Opportunity,
  ResourceGrant,
  Scenario,
  SolveOptions,
  StudentProfile,
  StudentStatus,
  SupportType,
  VerifyOptions,
} from '../types';
import { exhaustiveBest, NAIVE_LIMITS, naiveBest, type ExhaustiveResult, type NaiveResult } from './exhaustive';
import { solveJoint } from './solve';
import { lcg, makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { createJointEvaluator, verifyAndMeasure, verifyPlan } from './verify';

const EPS = 1e-6;

type Soft = 'min_gain' | 'fairness_floors' | 'required_intervention_ids';
/** 放松的固定优先级（第 6 条）。 */
const SOFT_ORDER: Soft[] = ['min_gain', 'fairness_floors', 'required_intervention_ids'];

/** 「复核选项」：与求解相同的 mode / loss_cap / 软要求；条件性方案另传 assume。 */
function verifyOpts(o: SolveOptions, assume?: string[]): VerifyOptions {
  const v: VerifyOptions = {};
  if (o.mode !== undefined) v.mode = o.mode;
  if (o.loss_cap !== undefined) v.loss_cap = o.loss_cap;
  if (o.required_intervention_ids !== undefined) v.required_intervention_ids = o.required_intervention_ids;
  if (o.min_gain !== undefined) v.min_gain = o.min_gain;
  if (o.fairness_floors !== undefined) v.fairness_floors = o.fairness_floors;
  if (assume) v.assume_approved_intervention_ids = assume;
  return v;
}

function without(o: VerifyOptions, relaxed: readonly Soft[]): VerifyOptions {
  const v = { ...o };
  for (const r of relaxed) delete v[r];
  return v;
}

/** options 中给出（非 null，含空数组）的软要求项，按固定优先级。 */
function givenSoft(v: VerifyOptions): Soft[] {
  return SOFT_ORDER.filter((k) => v[k] != null);
}

/** K 的全部 m 元子集，按固定优先级的字典序（每个子集内部也按优先级排列）。 */
function combos(items: Soft[], m: number): Soft[][] {
  if (m === 0) return [[]];
  const out: Soft[][] = [];
  items.forEach((x, k) => {
    for (const rest of combos(items.slice(k + 1), m - 1)) out.push([x, ...rest]);
  });
  return out;
}

/** 按第 5 条前六级比较指标：负数 = a 更优，0 = 指标完全并列。 */
function cmpMetrics(a: ExhaustiveResult, b: ExhaustiveResult): number {
  if (a.N !== b.N) return b.N - a.N;
  if (a.L !== b.L) return a.L - b.L;
  if (Math.abs(a.total_usd - b.total_usd) > EPS) return a.total_usd - b.total_usd;
  if (a.allocationCount !== b.allocationCount) return a.allocationCount - b.allocationCount;
  if (a.selectedCount !== b.selectedCount) return a.selectedCount - b.selectedCount;
  return a.revokedCount - b.revokedCount;
}

/**
 * 规范化（第 5 条）：选中的每项措施要么有分配，要么在 required 里，要么是这两类措施的（传递）前置依赖。
 * required 传 undefined 表示没有（或已放松）该软要求。
 */
function normalizationIssues(label: string, scenario: Scenario, outcome: JointOutcome, required: string[] | undefined): string[] {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const anchor = new Set<string>([...outcome.allocations.map((a) => a.intervention_id), ...(required ?? [])]);
  const stack = [...anchor];
  while (stack.length) {
    const id = stack.pop()!;
    for (const r of byId.get(id)?.requires ?? []) {
      if (!anchor.has(r)) {
        anchor.add(r);
        stack.push(r);
      }
    }
  }
  const extra = outcome.selected_intervention_ids.filter((id) => !anchor.has(id));
  return extra.length ? [`${label}：选中了既无分配、也非必须启用或其前置依赖的措施 ${extra.join('、')}`] : [];
}

function outcomeSummary(r: JointOutcome & { status?: string }) {
  return {
    status: r.status,
    N: r.N,
    G: r.G,
    L: r.L,
    total_usd: r.cost?.total_usd,
    allocations: r.allocations?.map((a) => `${a.intervention_id}:${a.student_id}:${a.opportunity_id}`),
    selected: r.selected_intervention_ids,
    revoked: r.revoked_grant_ids,
  };
}

function exSummary(e: ExhaustiveResult) {
  return {
    feasible: e.feasible,
    N: e.N,
    G: e.G,
    L: e.L,
    total_usd: e.total_usd,
    allocationCount: e.allocationCount,
    selectedCount: e.selectedCount,
    revokedCount: e.revokedCount,
    selected: e.plan?.selected_intervention_ids,
    allocations: e.plan?.allocations.map((a) => `${a.intervention_id}:${a.student_id}:${a.opportunity_id}`),
    revoked: e.plan?.revoked_grant_ids,
  };
}

/** 只取方案字段（不带求解器自带的指标），交给验证器重算。 */
function planOnly(o: JointPlan): JointPlan {
  return { selected_intervention_ids: o.selected_intervention_ids, allocations: o.allocations, revoked_grant_ids: o.revoked_grant_ids ?? [] };
}

function fairnessEqual(a: FairnessReport[] | undefined | null, b: FairnessReport[] | null): boolean {
  if (b === null) return a === undefined;
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((x, k) => {
    const y = b[k];
    const ratioOk = y.ratio === null ? x.ratio === null : typeof x.ratio === 'number' && Math.abs(x.ratio - y.ratio) <= EPS;
    return (
      x.floor_id === y.floor_id &&
      x.eligible_members === y.eligible_members &&
      x.covered_members === y.covered_members &&
      x.satisfied === y.satisfied &&
      ratioOk &&
      Math.abs(x.min_ratio - y.min_ratio) <= EPS
    );
  });
}

/**
 * 撤回与损失明细、公平报告：必须给出，且与验证器对同一方案的重算完全一致（含顺序）；protect 模式下不撤回。
 * fairnessFloors：本方案应当报告的底线（原 options 的 fairness_floors；alternative 放松了底线时也照样报告）。
 */
function detailIssues(label: string, scenario: Scenario, outcome: JointOutcome, vopts: VerifyOptions, fairnessFloors: FairnessFloor[] | undefined): string[] {
  const issues: string[] = [];
  if (!Array.isArray(outcome.revoked_grant_ids)) issues.push(`${label}：没有给出 revoked_grant_ids`);
  if (!Array.isArray(outcome.lost_pairs)) issues.push(`${label}：没有给出 lost_pairs`);
  if (!Array.isArray(outcome.revocations)) issues.push(`${label}：没有给出 revocations`);
  if (vopts.mode !== 'tradeoff' && (outcome.revoked_grant_ids ?? []).length > 0) {
    issues.push(`${label}：protect 模式下撤回了 ${JSON.stringify(outcome.revoked_grant_ids)}`);
  }
  const m = verifyAndMeasure(createJointEvaluator(scenario), planOnly(outcome), { ...vopts, fairness_floors: fairnessFloors }).metrics;
  if (JSON.stringify(outcome.revoked_grant_ids ?? []) !== JSON.stringify(m.revoked_grant_ids)) {
    issues.push(`${label}：revoked_grant_ids ${JSON.stringify(outcome.revoked_grant_ids)} 未排序或含非法 id（合法部分 ${JSON.stringify(m.revoked_grant_ids)}）`);
  }
  if (JSON.stringify(outcome.lost_pairs ?? null) !== JSON.stringify(m.lost_pairs)) {
    issues.push(`${label}：lost_pairs 与验证器重算不一致 solver=${JSON.stringify(outcome.lost_pairs)} verifier=${JSON.stringify(m.lost_pairs)}`);
  }
  if (JSON.stringify(outcome.revocations ?? null) !== JSON.stringify(m.revocations)) {
    issues.push(`${label}：revocations 与验证器重算不一致 solver=${JSON.stringify(outcome.revocations)} verifier=${JSON.stringify(m.revocations)}`);
  }
  if (!fairnessEqual(outcome.fairness, m.fairness)) {
    issues.push(`${label}：fairness 与验证器重算不一致 solver=${JSON.stringify(outcome.fairness)} verifier=${JSON.stringify(m.fairness)}`);
  }
  if (outcome.L !== m.L || outcome.G !== m.G || outcome.N !== m.N) {
    issues.push(`${label}：G / L / N 与验证器重算不一致 solver=${outcome.G}/${outcome.L}/${outcome.N} verifier=${m.G}/${m.L}/${m.N}`);
  }
  return issues;
}

/** 统计：保证对照真的覆盖到了各种情况（不是全部空方案）。 */
const STATS = {
  optimal: 0,
  optimalPositiveN: 0,
  optimalPositiveL: 0,
  optimalWithRevocation: 0,
  infeasible: 0,
  infeasibleByFloors: 0,
  conditional: 0,
  multiAllocGroups: 0,
  tradeoff: 0,
  withFloors: 0,
  /** OPTIMAL 且至少一条自愿撤回（forced_by === null）。 */
  optimalVoluntaryRevocation: 0,
  /** OPTIMAL 且撤回了 pending 的已有 grant。 */
  optimalPendingRevocation: 0,
  /** 场景里有「不可撤回 grant 封锁互斥措施」的结构（规则 R1）。 */
  lockedBlocking: 0,
  /** 上述场景中封锁确实起作用：去掉「被封锁措施 ↔ 锁定措施」的互斥关系后，穷举的最优 N 更大。 */
  lockedBlockingBinding: 0,
};

/** 规则 R1：场景外学生（不在 students 中）的已有 grant 所属措施，与某项措施互斥（该措施因此被封锁）。 */
function blockedByLocked(scenario: Scenario): string[] {
  const stu = new Set(scenario.students.map((s) => s.id));
  const ints = new Map(scenario.interventions.map((i) => [i.id, i]));
  const lockedInts = new Set(
    (scenario.existing_grants ?? [])
      .filter((g) => typeof g.intervention_id === 'string' && ints.has(g.intervention_id) && !stu.has(g.student_id))
      .map((g) => g.intervention_id as string),
  );
  const excl = (a: Intervention, b: Intervention) =>
    (a.mutually_exclusive_with ?? []).includes(b.id) || (b.mutually_exclusive_with ?? []).includes(a.id);
  return scenario.interventions
    .filter((i) => [...lockedInts].some((k) => k !== i.id && excl(i, ints.get(k)!)))
    .map((i) => i.id)
    .sort();
}

/** 去掉被封锁措施与锁定措施之间的互斥关系（仅用于统计「封锁是否真的起作用」）。 */
function withoutLockedExclusions(scenario: Scenario): Scenario {
  const stu = new Set(scenario.students.map((s) => s.id));
  const ids = new Set(scenario.interventions.map((i) => i.id));
  const lockedInts = new Set(
    (scenario.existing_grants ?? [])
      .filter((g) => typeof g.intervention_id === 'string' && ids.has(g.intervention_id) && !stu.has(g.student_id))
      .map((g) => g.intervention_id as string),
  );
  return {
    ...scenario,
    interventions: scenario.interventions.map((i) => {
      const mx = i.mutually_exclusive_with;
      if (!Array.isArray(mx)) return i;
      return { ...i, mutually_exclusive_with: mx.filter((k) => !(lockedInts.has(k) || lockedInts.has(i.id))) };
    }),
  };
}

/**
 * 对比一次「求解（主结果或条件性结果）」与穷举；返回不一致描述列表。
 * status 为求解器给出的状态，outcome 为对应方案。
 */
function compareOne(
  label: string,
  scenario: Scenario,
  status: string,
  outcome: JointOutcome,
  vopts: VerifyOptions,
  alternative: JointResult['alternative'] | undefined,
): string[] {
  const issues: string[] = [];
  const ex = exhaustiveBest(scenario, vopts);
  const ctx = () => JSON.stringify({ solver: outcomeSummary({ ...outcome, status }), exhaustive: exSummary(ex) });
  issues.push(...detailIssues(label, scenario, outcome, vopts, vopts.fairness_floors));
  if (ex.feasible) {
    if (status !== 'OPTIMAL') {
      issues.push(`${label}：穷举可行，求解器状态为 ${status} ${ctx()}`);
      return issues;
    }
    const v = verifyPlan(scenario, outcome, vopts);
    if (!v.passed) {
      issues.push(`${label}：OPTIMAL 方案未通过 verifyPlan：${v.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
    }
    if (outcome.N !== ex.N) issues.push(`${label}：N 不一致 ${ctx()}`);
    if (outcome.L !== ex.L) issues.push(`${label}：L 不一致 ${ctx()}`);
    if (Math.abs(outcome.cost.total_usd - ex.total_usd) > EPS) issues.push(`${label}：total_usd 不一致 ${ctx()}`);
    if (outcome.allocations.length !== ex.allocationCount) issues.push(`${label}：分配条数不一致 ${ctx()}`);
    if (outcome.selected_intervention_ids.length !== ex.selectedCount) issues.push(`${label}：选中措施数不一致 ${ctx()}`);
    if ((outcome.revoked_grant_ids ?? []).length !== ex.revokedCount) issues.push(`${label}：撤回数不一致 ${ctx()}`);
    issues.push(...normalizationIssues(label, scenario, outcome, vopts.required_intervention_ids));
    return issues;
  }

  // 穷举不可行
  if (status !== 'INFEASIBLE') {
    issues.push(`${label}：穷举不可行，求解器状态为 ${status} ${ctx()}`);
    return issues;
  }
  if (
    outcome.selected_intervention_ids.length !== 0 ||
    outcome.allocations.length !== 0 ||
    (outcome.revoked_grant_ids ?? []).length !== 0 ||
    outcome.cost.total_usd !== 0 ||
    outcome.G !== 0 ||
    outcome.L !== 0
  ) {
    issues.push(`${label}：INFEASIBLE 主结果不是空方案 ${ctx()}`);
  }
  if (alternative === undefined) return issues; // 条件性结果没有 alternative 字段
  if (!alternative) {
    issues.push(`${label}：INFEASIBLE 但 alternative 为空`);
    return issues;
  }
  const relaxed = alternative.relaxed as Soft[];
  const relaxedOpts = without(vopts, relaxed);
  // 直接复核（规则 R3：复核选项没给底线时验证器不比较 alternative 按原底线报告的 fairness）。
  const v = verifyPlan(scenario, alternative, relaxedOpts);
  if (!v.passed) {
    issues.push(`${label}：alternative 未通过去掉 ${relaxed.join('+')} 后的 verifyPlan：${v.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
  }
  issues.push(...detailIssues(`${label} alternative`, scenario, alternative, relaxedOpts, vopts.fairness_floors));

  // 期望的放松方式（第 6 条）：m = 1, 2, … 依次尝试 K 的 m 元子集；第一个有可行子集的 m 中取指标最优者；
  // 指标完全并列时（第 7 级字典序穷举不比较）接受任一并列的子集。
  const K = givenSoft(vopts);
  let expected: { relaxed: Soft[]; ex: ExhaustiveResult }[] = [];
  for (let m = 1; m <= K.length && expected.length === 0; m++) {
    const tries = combos(K, m)
      .map((T) => ({ relaxed: T, ex: exhaustiveBest(scenario, without(vopts, T)) }))
      .filter((t) => t.ex.feasible);
    if (tries.length === 0) continue;
    const best = [...tries].sort((a, b) => cmpMetrics(a.ex, b.ex))[0];
    expected = tries.filter((t) => cmpMetrics(t.ex, best.ex) === 0);
  }
  const match = expected.find((e) => e.relaxed.join(',') === relaxed.join(','));
  const altCtx = JSON.stringify({
    solverAlternative: { relaxed, ...outcomeSummary(alternative) },
    expected: expected.map((e) => ({ relaxed: e.relaxed, ...exSummary(e.ex) })),
  });
  if (!match) {
    issues.push(`${label}：alternative 放松项与期望不符（或未按固定优先级排列） ${altCtx}`);
  } else {
    if (alternative.N !== match.ex.N) issues.push(`${label}：alternative N 不一致 ${altCtx}`);
    if (alternative.L !== match.ex.L) issues.push(`${label}：alternative L 不一致 ${altCtx}`);
    if (Math.abs(alternative.cost.total_usd - match.ex.total_usd) > EPS) issues.push(`${label}：alternative total_usd 不一致 ${altCtx}`);
    if (alternative.allocations.length !== match.ex.allocationCount) issues.push(`${label}：alternative 分配条数不一致 ${altCtx}`);
    if (alternative.selected_intervention_ids.length !== match.ex.selectedCount) issues.push(`${label}：alternative 选中措施数不一致 ${altCtx}`);
    if ((alternative.revoked_grant_ids ?? []).length !== match.ex.revokedCount) issues.push(`${label}：alternative 撤回数不一致 ${altCtx}`);
    const keptRequired = relaxed.includes('required_intervention_ids') ? undefined : vopts.required_intervention_ids;
    issues.push(...normalizationIssues(`${label} alternative`, scenario, alternative, keptRequired));
  }
  return issues;
}

function crossCheck(scenario: Scenario, sopts: SolveOptions = {}): string[] {
  const issues: string[] = [];
  const res = solveJoint(scenario, sopts);
  const vopts = verifyOpts(sopts);
  if (sopts.mode === 'tradeoff') STATS.tradeoff++;
  if (sopts.fairness_floors != null) STATS.withFloors++;
  if (res.status === 'OPTIMAL') {
    STATS.optimal++;
    if (res.N > 0) STATS.optimalPositiveN++;
    if (res.L > 0) STATS.optimalPositiveL++;
    if ((res.revoked_grant_ids ?? []).length > 0) STATS.optimalWithRevocation++;
    if ((res.revocations ?? []).some((r) => r.forced_by === null)) STATS.optimalVoluntaryRevocation++;
    const pendingIds = new Set((scenario.existing_grants ?? []).filter((g) => g.status === 'pending').map((g) => g.id));
    if ((res.revoked_grant_ids ?? []).some((id) => pendingIds.has(id))) STATS.optimalPendingRevocation++;
    const groups = new Set(res.allocations.map((a) => a.intervention_id + '|' + a.student_id));
    if (groups.size < res.allocations.length) STATS.multiAllocGroups++;
  }
  if (res.status === 'INFEASIBLE') {
    STATS.infeasible++;
    if (vopts.fairness_floors != null && exhaustiveBest(scenario, without(vopts, ['fairness_floors'])).feasible) STATS.infeasibleByFloors++;
  }
  if (res.conditional) STATS.conditional++;
  if (blockedByLocked(scenario).length > 0) {
    STATS.lockedBlocking++;
    const relaxedEx = exhaustiveBest(withoutLockedExclusions(scenario), vopts);
    const ex = exhaustiveBest(scenario, vopts);
    if (relaxedEx.feasible && (!ex.feasible || relaxedEx.N > ex.N)) STATS.lockedBlockingBinding++;
  }
  if (res.status === 'UNSUPPORTED_INPUT') return [`求解器返回 UNSUPPORTED_INPUT（场景应合法）：${res.notes.join(' / ')}`];
  issues.push(...compareOne('主结果', scenario, res.status, res, vopts, res.alternative ?? null));

  const pending = scenario.interventions.filter((i) => i.status === 'pending').map((i) => i.id).sort();
  if (pending.length > 0) {
    const c = res.conditional;
    if (!c) issues.push('场景有 pending 措施，但 conditional 为空');
    else {
      if (JSON.stringify(c.assumed_approved_intervention_ids) !== JSON.stringify(pending)) {
        issues.push(`conditional.assumed_approved_intervention_ids = ${JSON.stringify(c.assumed_approved_intervention_ids)}，应为 ${JSON.stringify(pending)}`);
      }
      issues.push(...compareOne('条件性结果', scenario, c.status, c, verifyOpts(sopts, pending), undefined));
    }
  } else if (res.conditional) {
    issues.push('场景没有 pending 措施，但 conditional 非空');
  }
  // 主结果永远不含 pending 措施
  for (const id of res.selected_intervention_ids) {
    if (pending.includes(id)) issues.push(`主结果含 pending 措施 ${id}`);
  }
  // 规则 R1：被不可撤回 grant 封锁的措施在任何方案里都不能出现；场景外学生的 grant 不能被撤回。
  const blocked = blockedByLocked(scenario);
  const stuIds = new Set(scenario.students.map((s) => s.id));
  const outsiderGrantIds = new Set((scenario.existing_grants ?? []).filter((g) => !stuIds.has(g.student_id)).map((g) => g.id));
  const outcomes: [string, JointOutcome | null | undefined][] = [
    ['主结果', res],
    ['alternative', res.alternative],
    ['条件性结果', res.conditional],
  ];
  for (const [label, o] of outcomes) {
    if (!o) continue;
    const bad = o.selected_intervention_ids.filter((id) => blocked.includes(id));
    if (bad.length > 0) issues.push(`${label}选中了被不可撤回 grant 封锁的措施 ${bad.join('、')}`);
    const badRev = (o.revoked_grant_ids ?? []).filter((id) => outsiderGrantIds.has(id));
    if (badRev.length > 0) issues.push(`${label}撤回了场景外学生的 grant ${badRev.join('、')}`);
  }
  return issues;
}

// ───────────────────────────── 手工场景 ─────────────────────────────

const O1 = makeOpp('o1');
const O2 = makeOpp('o2');
const O3 = makeOpp('o3');
const INPERSON = makeOpp('o-in', { location: { format: 'in_person', country: 'US', state: 'CA' } });
const PAID = makeOpp('o-fee', { cost: { fee_usd: 50, requires_travel_expense: false }, required_devices: [] });
const HEAVY = makeOpp('o-heavy', { time_commitment: { hours_per_week: 12, total_weeks: 6 }, required_devices: [] });
const PAST = makeOpp('o-past', { deadline: '2026-10-01' });

const need = (id: string, o: Partial<StudentProfile> = {}) => makeStudent(id, o);
const has = (id: string) => makeStudent(id, { devices: ['smartphone', 'home_internet', 'laptop'] });
const young = (id: string) => makeStudent(id, { grade: 7 });

const LOAN = makeIntervention('loan', { unit_cost_usd: 100, fixed_cost_usd: 50 });
const grant = (g: Partial<ResourceGrant> & Pick<ResourceGrant, 'id' | 'student_id'>): ResourceGrant => ({
  opportunity_id: null,
  type: 'device',
  device: 'laptop',
  status: 'approved',
  provider: 'Example Org（虚构）',
  is_sample: true,
  ...g,
});

const HAND: { name: string; scenario: Scenario; options?: SolveOptions }[] = [
  {
    name: '容量紧：4 人需要设备，容量 2',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c'), need('d')],
      opportunities: [O1],
      interventions: [{ ...LOAN, capacity: 2 }],
    }),
  },
  {
    name: '容量松、预算松',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c')],
      opportunities: [O1, O2],
      interventions: [{ ...LOAN, capacity: null }],
      budget_usd: 10_000,
    }),
  },
  {
    name: '预算紧：只够 2 人',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c'), need('d')],
      opportunities: [O1],
      interventions: [LOAN],
      budget_usd: 260,
    }),
  },
  {
    name: '预算为 0：只有免费措施可用',
    scenario: makeScenario({
      students: [need('a'), need('b'), makeStudent('c', { devices: ['laptop'], hours_per_week_available: 0 })],
      opportunities: [O1],
      interventions: [LOAN, makeIntervention('free-time', { type: 'time_support', resolves: ['time'], hours_per_week: 5, unit_cost_usd: 0, fixed_cost_usd: 0, device: null })],
      budget_usd: 0,
    }),
  },
  {
    name: '固定成本高：两种设备措施，选总成本小的',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [
        makeIntervention('cheap-unit-high-fixed', { unit_cost_usd: 10, fixed_cost_usd: 500 }),
        makeIntervention('pricey-unit-no-fixed', { unit_cost_usd: 120, fixed_cost_usd: 0 }),
      ],
      budget_usd: 1000,
    }),
  },
  {
    name: '互斥：两种设备来源只能选一种，各自容量 1',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c')],
      opportunities: [O1],
      interventions: [
        makeIntervention('loan-x', { capacity: 1, unit_cost_usd: 50, mutually_exclusive_with: ['loan-y'] }),
        makeIntervention('loan-y', { capacity: 2, unit_cost_usd: 80 }),
      ],
    }),
  },
  {
    name: '前置依赖：设备借用需要先启用培训（培训本身无效果）',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [
        { ...LOAN, requires: ['training'] },
        makeIntervention('training', { type: 'time_support', resolves: ['time'], hours_per_week: 0, unit_cost_usd: 0, fixed_cost_usd: 30, device: null }),
      ],
      budget_usd: 400,
    }),
  },
  {
    name: 'pending 措施：便宜的 pending，贵的 approved（含 conditional）',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [
        makeIntervention('pending-loan', { unit_cost_usd: 10, status: 'pending' }),
        makeIntervention('approved-loan', { unit_cost_usd: 200, capacity: 1 }),
      ],
      budget_usd: 1000,
    }),
  },
  {
    name: 'existing_grants：已占容量、已覆盖的 (措施, 学生) 免费',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c')],
      opportunities: [O1, O2],
      interventions: [{ ...LOAN, capacity: 2 }],
      existing_grants: [grant({ id: 'e1', student_id: 'a', opportunity_id: 'o1', intervention_id: 'loan' })],
      budget_usd: 1000,
    }),
  },
  {
    name: '多机会多时段：per_time_slot 容量 1',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1, O2, O3],
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
      opportunity_time_slots: { o1: 'AM', o2: 'AM', o3: 'PM' },
      budget_usd: 1000,
    }),
  },
  {
    name: '同场景 total 口径对照',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1, O2, O3],
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'total' }],
      opportunity_time_slots: { o1: 'AM', o2: 'AM', o3: 'PM' },
      budget_usd: 1000,
    }),
  },
  {
    name: 'required_intervention_ids：必须启用的措施固定成本超预算 → INFEASIBLE',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [LOAN, makeIntervention('gala', { type: 'alternative_access', resolves: ['transport'], fixed_cost_usd: 900, unit_cost_usd: 0, device: null })],
      budget_usd: 500,
    }),
    options: { required_intervention_ids: ['gala'] },
  },
  {
    name: 'required_intervention_ids 可满足',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [LOAN, makeIntervention('gala', { type: 'alternative_access', resolves: ['transport'], fixed_cost_usd: 100, unit_cost_usd: 0, device: null })],
      budget_usd: 500,
    }),
    options: { required_intervention_ids: ['gala'] },
  },
  {
    name: 'min_gain 达不到 → INFEASIBLE',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c')],
      opportunities: [O1],
      interventions: [{ ...LOAN, capacity: 2 }],
    }),
    options: { min_gain: 3 },
  },
  {
    name: 'min_gain 可达',
    scenario: makeScenario({
      students: [need('a'), need('b'), need('c')],
      opportunities: [O1],
      interventions: [{ ...LOAN, capacity: 2 }],
    }),
    options: { min_gain: 2 },
  },
  {
    name: '两项软要求同时给出且都达不到（互斥的必须项 + min_gain）',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [
        makeIntervention('x', { mutually_exclusive_with: ['y'], unit_cost_usd: 30 }),
        makeIntervention('y', { unit_cost_usd: 60 }),
      ],
    }),
    options: { required_intervention_ids: ['x', 'y'], min_gain: 5 },
  },
  {
    name: '必须启用的措施是 pending → 主结果 INFEASIBLE',
    scenario: makeScenario({
      students: [need('a')],
      opportunities: [O1],
      interventions: [makeIntervention('p', { status: 'pending', unit_cost_usd: 20 }), makeIntervention('q', { unit_cost_usd: 40 })],
    }),
    options: { required_intervention_ids: ['p'] },
  },
  {
    name: '本来就可达 + 因资格永远不可达 + 已过截止',
    scenario: makeScenario({
      students: [has('ok1'), has('ok2'), young('kid'), need('a')],
      opportunities: [O1, PAST],
      interventions: [LOAN],
    }),
  },
  {
    name: '同时缺两类障碍（设备 + 交通），需要两项措施',
    scenario: makeScenario({
      students: [need('a', { transport: { level: 'none' } }), need('b', { transport: { level: 'none' } }), need('c')],
      opportunities: [INPERSON],
      interventions: [
        makeIntervention('laptops', { unit_cost_usd: 100 }),
        makeIntervention('bus', { type: 'transport_subsidy', resolves: ['transport'], amount_usd: 40, unit_cost_usd: 40, device: null }),
        makeIntervention('remote', { type: 'alternative_access', resolves: ['transport'], unit_cost_usd: 25, fixed_cost_usd: 60, capacity: 1, device: null }),
      ],
      budget_usd: 450,
    }),
  },
  {
    name: '费用与时间障碍：fee_waiver 与 time_support',
    scenario: makeScenario({
      students: [makeStudent('poor', { budget_usd: 0 }), makeStudent('busy', { hours_per_week_available: 10 }), makeStudent('fine')],
      opportunities: [PAID, HEAVY],
      interventions: [
        makeIntervention('waiver', { type: 'fee_waiver', resolves: ['cost'], amount_usd: null, unit_cost_usd: 50, device: null }),
        makeIntervention('stipend', { type: 'time_support', resolves: ['time'], hours_per_week: 2, unit_cost_usd: 70, capacity: 2, device: null }),
      ],
      budget_usd: 300,
    }),
  },
  {
    name: '8 名学生、单机会、4 项措施（规模上限）',
    scenario: makeScenario({
      students: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, k) => (k % 3 === 0 ? need(id, { transport: { level: 'none' } }) : need(id))),
      opportunities: [INPERSON],
      interventions: [
        makeIntervention('laptops', { unit_cost_usd: 90, capacity: 5 }),
        makeIntervention('bus', { type: 'transport_subsidy', resolves: ['transport'], amount_usd: 30, unit_cost_usd: 30, capacity: 2, device: null }),
        makeIntervention('refurb', { unit_cost_usd: 40, fixed_cost_usd: 120, capacity: 3, mutually_exclusive_with: ['laptops'] }),
        makeIntervention('remote', { type: 'alternative_access', resolves: ['transport'], unit_cost_usd: 0, fixed_cost_usd: 80, requires: ['laptops'], device: null }),
      ],
      budget_usd: 700,
    }),
  },
];

describe('交叉检查：手工场景（求解器 vs verifyPlan + 穷举）', () => {
  for (const { name, scenario, options } of HAND) {
    it(name, () => {
      expect(crossCheck(scenario, options ?? {})).toEqual([]);
    });
  }
});


// ───────────────────────────── 第 3 层手工场景：撤回与公平底线（带手算期望） ─────────────────────────────

const TRADE = (loss_cap: number): SolveOptions => ({ mode: 'tradeoff', loss_cap });
const OLD = makeIntervention('old', { unit_cost_usd: 100, capacity: 1 });
const NEW = makeIntervention('new', { unit_cost_usd: 60, capacity: 2, mutually_exclusive_with: ['old'] });
/** a 已借到 old 的笔记本（对所有机会有效）→ (a, o1) ∈ R0；old 容量 1 已满。 */
const swapScenario = (o: Partial<Scenario> = {}) =>
  makeScenario({
    students: [need('a'), need('b')],
    opportunities: [O1],
    interventions: [OLD, NEW],
    existing_grants: [grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' })],
    ...o,
  });

/** busy：有笔记本、每周可用 0 小时，靠 old（时间支持 5 小时）的已有 grant 可达；new（笔记本）帮不了他。 */
const busy = (id: string, statuses: StudentStatus[] = ['high_school_student']) =>
  makeStudent(id, { devices: ['smartphone', 'home_internet', 'laptop'], hours_per_week_available: 0, statuses });
const OLD_TIME = makeIntervention('old', { type: 'time_support', resolves: ['time'], hours_per_week: 5, device: null, unit_cost_usd: 0, capacity: 1 });
const timeGrant = (id: string, student: string): ResourceGrant =>
  grant({ id, student_id: student, intervention_id: 'old', type: 'time_support', device: null, hours_per_week: 5 });
const lossScenario = (o: Partial<Scenario> = {}) =>
  makeScenario({
    students: [busy('a'), need('b'), need('c'), need('d')],
    opportunities: [O1],
    interventions: [OLD_TIME, makeIntervention('new', { unit_cost_usd: 10, capacity: 3, mutually_exclusive_with: ['old'] })],
    existing_grants: [timeGrant('e-a', 'a')],
    ...o,
  });

const O2_UPPER = makeOpp('o2', {
  requirements: [{ id: 'req-grade', type: 'grade', min: 11, max: 12, label: '11–12 年级', hard: true, source_text: 'Open to grades 11-12. (fictional example)' }],
});

const fl = (id: string, statuses: StudentStatus[], min_ratio: number): FairnessFloor => ({
  id,
  label: `示例群体 ${id}`,
  basis: '虚构的分组依据（示例）',
  statuses_any_of: statuses,
  min_ratio,
});
const FG = fl('fg', ['first_generation'], 1);
const fairStudents = () => [
  need('f1', { statuses: ['low_income'] }),
  need('f2', { statuses: ['first_generation'] }),
  makeStudent('f5', { statuses: ['first_generation'], devices: ['laptop'] }),
];
const GALA = makeIntervention('gala', { type: 'alternative_access', resolves: ['transport'], device: null, unit_cost_usd: 0, fixed_cost_usd: 0, mutually_exclusive_with: ['loan'] });

interface Expect {
  status: string;
  N: number;
  L: number;
  revoked: string[];
  relaxed: Soft[];
  allocatedStudents: string[];
}
const HAND3: { name: string; scenario: Scenario; options?: SolveOptions; expect: Partial<Expect> }[] = [
  {
    name: 'tradeoff 强制撤回：换用 new，撤回 e-a，由 new 给 a 补位（loss_cap 0）',
    scenario: swapScenario(),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 1, L: 0, revoked: ['e-a'], allocatedStudents: ['a', 'b'] },
  },
  {
    name: 'protect 下与已有 grant 所属措施互斥的措施不可选 → 空方案',
    scenario: swapScenario(),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [], allocatedStudents: [] },
  },
  {
    name: 'loss_cap 恰好够：撤回 a 的时间支持换笔记本给 3 人（G 3，L 1）',
    scenario: lossScenario(),
    options: TRADE(1),
    expect: { status: 'OPTIMAL', N: 2, L: 1, revoked: ['e-a'], allocatedStudents: ['b', 'c', 'd'] },
  },
  {
    name: 'loss_cap 差一个（0）：不能撤回 → 空方案',
    scenario: lossScenario(),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [] },
  },
  {
    name: '自愿撤回使 N 更好：撤回 a 的 o1 设备，改给 b（o1、o2 两个机会）',
    scenario: makeScenario({
      students: [need('a'), need('b', { grade: 11 })],
      opportunities: [O1, O2_UPPER],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-a', student_id: 'a', opportunity_id: 'o1', intervention_id: 'old' })],
    }),
    options: TRADE(1),
    expect: { status: 'OPTIMAL', N: 1, L: 1, revoked: ['e-a'], allocatedStudents: ['b', 'b'] },
  },
  {
    name: '自愿撤回不值得（N 不变、L 变大）→ 空方案',
    scenario: makeScenario({
      students: [need('a'), need('b')],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' })],
    }),
    options: TRADE(1),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [] },
  },
  {
    // 规则 R4：loss_cap = 0 的 tradeoff 不等同 protect。h 自己有笔记本（本来可达），e-h 是 pending、不化解任何障碍；
    // 撤回它不造成损失，却腾出 old 唯一的名额给 a。手算：G 1，L 0，N 1，成本 100，撤回 1 条（自愿）。
    name: 'loss_cap 0 的 tradeoff：撤回场景内学生的 pending grant 腾名额（L 0）',
    scenario: makeScenario({
      students: [need('a'), has('h')],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-h', student_id: 'h', intervention_id: 'old', status: 'pending' })],
    }),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 1, L: 0, revoked: ['e-h'], allocatedStudents: ['a'] },
  },
  {
    // 同上，但 e-h 是 approved：h 自己有笔记本，撤回仍不造成损失 → loss_cap 0 下照样允许。
    name: 'loss_cap 0 的 tradeoff：撤回不造成损失的 approved grant 腾名额（L 0）',
    scenario: makeScenario({
      students: [need('a'), has('h')],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-h', student_id: 'h', intervention_id: 'old' })],
    }),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 1, L: 0, revoked: ['e-h'], allocatedStudents: ['a'] },
  },
  {
    name: '同上但 protect：pending 的已有 grant 也不能撤回 → 空方案',
    scenario: makeScenario({
      students: [need('a'), has('h')],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-h', student_id: 'h', intervention_id: 'old', status: 'pending' })],
    }),
    expect: { status: 'OPTIMAL', N: 0, revoked: [] },
  },
  {
    // 规则 R1：e-out 的学生不在场景内，不可撤回，照样占满 old 的名额 → tradeoff 也不能腾名额。
    name: 'R1：场景外学生的 pending grant 占满名额，不可撤回（tradeoff 0）→ 空方案',
    scenario: makeScenario({
      students: [need('a')],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' })],
    }),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [], allocatedStudents: [] },
  },
  {
    // 规则 R1：old 有场景外学生的 e-out（不可撤回）→ 与 old 互斥的 new 被封锁。old 容量 2 已被 a、outsider 占满；
    // 自愿撤回 e-a 再把 old 给 b：G 1、L 1、N 0，不优于空方案（且 loss_cap 1 才允许）。手算最优：空方案。
    name: 'R1：场景外学生的 grant 封锁互斥措施（tradeoff 1）→ new 不可选，空方案',
    scenario: swapScenario({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [
        grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' }),
        grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' }),
      ],
    }),
    options: TRADE(1),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [], allocatedStudents: [] },
  },
  {
    name: 'R1：同上（protect）→ 空方案',
    scenario: swapScenario({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [
        grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' }),
        grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' }),
      ],
    }),
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [] },
  },
  {
    name: 'R1：必须启用被封锁的 new（tradeoff 2）→ INFEASIBLE，放松 required',
    scenario: swapScenario({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [
        grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' }),
        grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' }),
      ],
    }),
    options: { ...TRADE(2), required_intervention_ids: ['new'] },
    expect: { status: 'INFEASIBLE', relaxed: ['required_intervention_ids'] },
  },
  {
    name: 'R1：必须启用被封锁的 new（protect）→ INFEASIBLE，放松 required',
    scenario: swapScenario({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [
        grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' }),
        grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' }),
      ],
    }),
    options: { required_intervention_ids: ['new'] },
    expect: { status: 'INFEASIBLE', relaxed: ['required_intervention_ids'] },
  },
  {
    // 对照：没有 e-out 时（old 容量 2，只有 e-a），tradeoff 0 下换用 new：强制撤回 e-a、new 给 a 与 b（N 1），
    // 或者直接 old 给 b（N 1，成本 100 < 120）→ 后者更便宜，不撤回。
    name: 'R1 对照：去掉场景外 grant 后 old 有空名额，直接给 b（不撤回）',
    scenario: swapScenario({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' })],
    }),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 1, L: 0, revoked: [], allocatedStudents: ['b'] },
  },
  {
    name: 'protect 下必须启用互斥措施 → INFEASIBLE，放松 required',
    scenario: swapScenario(),
    options: { required_intervention_ids: ['new'] },
    expect: { status: 'INFEASIBLE', relaxed: ['required_intervention_ids'] },
  },
  {
    name: 'tradeoff 下必须启用互斥措施 → 可行（强制撤回 + 补位）',
    scenario: swapScenario(),
    options: { ...TRADE(0), required_intervention_ids: ['new'] },
    expect: { status: 'OPTIMAL', N: 1, revoked: ['e-a'] },
  },
  {
    name: '底线改变人选：第一代学生底线 → 名额给 f2（不按编号给 f1）',
    scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }] }),
    options: { fairness_floors: [FG] },
    expect: { status: 'OPTIMAL', N: 1, allocatedStudents: ['f2'] },
  },
  {
    name: '底线不可行（名额 0）→ INFEASIBLE，放松 fairness_floors',
    scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 0 }] }),
    options: { fairness_floors: [FG] },
    expect: { status: 'INFEASIBLE', relaxed: ['fairness_floors'] },
  },
  {
    name: '分母为 0 的底线不适用，不影响结果',
    scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }] }),
    options: { fairness_floors: [fl('ug', ['undergraduate'], 1)] },
    expect: { status: 'OPTIMAL', N: 1, allocatedStudents: ['f1'] },
  },
  {
    name: '三项软要求同时存在：只需放松 required（m = 1）',
    scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }, GALA] }),
    options: { required_intervention_ids: ['gala'], min_gain: 1, fairness_floors: [FG] },
    expect: { status: 'INFEASIBLE', relaxed: ['required_intervention_ids'] },
  },
  {
    name: '三项软要求同时存在：需要放松两项，{min_gain, required} 优于 {min_gain, fairness_floors}',
    scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }, GALA] }),
    options: { required_intervention_ids: ['gala'], min_gain: 2, fairness_floors: [FG] },
    expect: { status: 'INFEASIBLE', relaxed: ['min_gain', 'required_intervention_ids'] },
  },
  {
    name: '底线阻止撤回：低收入的 a 会因撤回失去机会 → 不撤回',
    scenario: lossScenario({ students: [busy('a', ['low_income']), need('b'), need('c')] }),
    options: { ...TRADE(1), fairness_floors: [fl('low', ['low_income'], 1)] },
    expect: { status: 'OPTIMAL', N: 0, L: 0, revoked: [] },
  },
  {
    name: '同上但没有底线：撤回换来 N = 1',
    scenario: lossScenario({ students: [busy('a', ['low_income']), need('b'), need('c')] }),
    options: TRADE(1),
    expect: { status: 'OPTIMAL', N: 1, L: 1, revoked: ['e-a'] },
  },
  {
    name: 'pending 的互斥措施：主结果不变，conditional 中强制撤回并补位',
    scenario: swapScenario({ interventions: [OLD, { ...NEW, status: 'pending' }] }),
    options: TRADE(0),
    expect: { status: 'OPTIMAL', N: 0, revoked: [] },
  },
];

describe('交叉检查：第 3 层手工场景（撤回、权衡模式、公平底线；含手算期望）', () => {
  for (const { name, scenario, options, expect: want } of HAND3) {
    it(name, () => {
      const opts = options ?? {};
      // 先确认穷举参考本身符合手算（先怀疑自己）
      const ex = exhaustiveBest(scenario, verifyOpts(opts));
      if (want.status === 'OPTIMAL') {
        expect(ex.feasible).toBe(true);
        if (want.N !== undefined) expect(ex.N).toBe(want.N);
        if (want.L !== undefined) expect(ex.L).toBe(want.L);
        if (want.revoked !== undefined) expect(ex.revokedCount).toBe(want.revoked.length);
      } else if (want.status === 'INFEASIBLE') {
        expect(ex.feasible).toBe(false);
      }
      const res = solveJoint(scenario, opts);
      const got = {
        status: res.status,
        N: res.N,
        L: res.L,
        revoked: res.revoked_grant_ids,
        relaxed: res.alternative?.relaxed,
        allocatedStudents: res.allocations.map((a) => a.student_id),
      };
      const picked = Object.fromEntries(Object.keys(want).map((k) => [k, got[k as keyof typeof got]]));
      expect({ picked, notes: picked.status === want.status ? undefined : res.notes }).toEqual({ picked: want, notes: undefined });
      expect(crossCheck(scenario, opts)).toEqual([]);
    });
  }
  it('pending 互斥措施的 conditional：换用 new、撤回 e-a', () => {
    const res = solveJoint(swapScenario({ interventions: [OLD, { ...NEW, status: 'pending' }] }), TRADE(0));
    expect({ status: res.conditional?.status, N: res.conditional?.N, revoked: res.conditional?.revoked_grant_ids }).toEqual({
      status: 'OPTIMAL',
      N: 1,
      revoked: ['e-a'],
    });
  });
});

describe('对照器自检：篡改求解结果必须被发现（防止断言形同虚设）', () => {
  const scenario = swapScenario();
  const opts = TRADE(0);
  const vopts = verifyOpts(opts);
  const res = solveJoint(scenario, opts);
  it('未篡改时没有问题', () => {
    expect(compareOne('自检', scenario, res.status, res, vopts, res.alternative ?? null)).toEqual([]);
  });
  const tampered: [string, (r: JointResult) => JointResult][] = [
    ['forced_by 改为 null', (r) => ({ ...r, revocations: (r.revocations ?? []).map((x) => ({ ...x, forced_by: null })) })],
    ['缺少 revocations', (r) => ({ ...r, revocations: undefined })],
    ['缺少 lost_pairs', (r) => ({ ...r, lost_pairs: undefined })],
    ['lost_pairs 造假', (r) => ({ ...r, lost_pairs: [{ student_id: 'a', opportunity_id: 'o1' }] })],
    ['去掉撤回（违反强制撤回）', (r) => ({ ...r, revoked_grant_ids: [], revocations: [] })],
    ['N 少报', (r) => ({ ...r, N: r.N - 1 })],
    ['多带 fairness', (r) => ({ ...r, fairness: [] })],
  ];
  for (const [name, f] of tampered) {
    it(name, () => {
      expect(compareOne('自检', scenario, res.status, f(res), vopts, res.alternative ?? null).length).toBeGreaterThan(0);
    });
  }
  it('protect 下有撤回、缺少 fairness 报告都会被发现', () => {
    const p = solveJoint(scenario);
    expect(compareOne('自检', scenario, p.status, { ...p, revoked_grant_ids: ['e-a'] }, verifyOpts({}), null).join(' ')).toContain('protect');
    const withFloor = { fairness_floors: [FG] };
    const q = solveJoint(scenario, withFloor);
    expect(compareOne('自检', scenario, q.status, { ...q, fairness: undefined }, verifyOpts(withFloor), q.alternative ?? null).join(' ')).toContain('fairness');
  });
});

// ───────────────────────────── 随机场景 ─────────────────────────────

const SUPPORT: SupportType[] = ['device', 'transport_subsidy', 'fee_waiver', 'time_support', 'alternative_access'];
const GROUP_STATUSES: StudentStatus[] = ['low_income', 'first_generation', 'underrepresented_in_stem'];

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)];
}

/**
 * shape = 'small'：单机会 2–6 人、两机会 2–4 人，1–4 项措施，0–2 条可撤回的已有 grant，另可能有场景外学生的不可撤回 grant（与 exhaustiveBest 对照）；
 * shape = 'tiny'：≤ 3 人、≤ 2 个机会、≤ 3 项措施，「措施 × 学生 × 机会」+ 可撤回 grant 数 ≤ 12（与朴素枚举 naiveBest 对照）。
 * 第 3 层新增：带 intervention_id 的已有 grant（approved / pending，可能指向场景外学生）、更多互斥关系
 * （常常指向有已有 grant 的措施，从而触发强制撤回）、tradeoff 模式与随机 loss_cap、基于随机 statuses 的公平底线。
 * 规则 R1 之后：学生在场景外的已有 grant 不可撤回；另有三种结构——「换用」（L > 0 / 补位）、「pending 腾名额」
 * （自愿撤回、L = 0，规则 R4）、「锁定」（场景外学生的 grant 封锁与其措施互斥的措施）。
 */
function randomScenario(seed: number, shape: 'small' | 'tiny' = 'small'): { scenario: Scenario; options: SolveOptions } {
  const rnd = lcg(seed);
  let nOpp = rnd() < 0.6 ? 1 : 2;
  const r = rnd();
  const nGrants = r < 0.35 ? 0 : r < 0.75 ? 1 : 2;
  // 「换用」结构的意向（见下）；极小场景中提高比例并固定为 3 人 × 1 机会 × 2 措施，让朴素对照也覆盖 L > 0。
  const swapIntent = nGrants > 0 && rnd() < (shape === 'tiny' ? 0.6 : 0.5);
  let nStu: number;
  let nInt: number;
  if (shape === 'tiny' && swapIntent) {
    nOpp = 1;
    nInt = 2;
    nStu = NAIVE_LIMITS.students;
  } else if (shape === 'small') {
    nStu = 2 + Math.floor(rnd() * (nOpp === 1 ? 5 : 3)); // 单机会 2–6 人，两机会 2–4 人
    nInt = 1 + Math.floor(rnd() * 4); // 1–4 项措施
    if (nInt === 4 && nStu * nOpp > 4) nStu = Math.max(2, Math.floor(4 / nOpp)); // 4 项措施时控制规模
    if (nGrants === 2 && nInt >= 3 && nStu * nOpp > 4) nStu = Math.max(2, Math.floor(4 / nOpp)); // 两条可撤回 grant 时同样控制
  } else {
    nInt = 1 + Math.floor(rnd() * NAIVE_LIMITS.interventions);
    const budget = Math.min(NAIVE_LIMITS.triples, NAIVE_LIMITS.triplesPlusRevocable - nGrants);
    const maxStu = Math.max(1, Math.min(NAIVE_LIMITS.students, Math.floor(budget / (nInt * nOpp))));
    nStu = 1 + Math.floor(rnd() * maxStu);
  }

  const opps: Opportunity[] = [];
  for (let k = 0; k < nOpp; k++) {
    const devices: DeviceType[] = rnd() < 0.7 ? ['laptop'] : [];
    opps.push(
      makeOpp(`r${k}`, {
        location: rnd() < 0.4 ? { format: 'in_person', country: 'US', state: 'CA' } : { format: 'online' },
        cost: { fee_usd: rnd() < 0.3 ? 60 : 0, requires_travel_expense: false },
        time_commitment: { hours_per_week: rnd() < 0.3 ? 12 : 5, total_weeks: 4 },
        required_devices: devices,
        deadline: rnd() < 0.1 ? '2026-10-01' : '2027-03-01',
      }),
    );
  }
  const students: StudentProfile[] = [];
  for (let k = 0; k < nStu; k++) {
    const statuses: StudentStatus[] | null =
      rnd() < 0.15 ? null : ['high_school_student', ...GROUP_STATUSES.filter(() => rnd() < 0.4)];
    students.push(
      makeStudent(`st${k}`, {
        grade: rnd() < 0.12 ? 7 : 10,
        devices: rnd() < 0.3 ? ['smartphone', 'laptop'] : ['smartphone'],
        transport: { level: pick(rnd, ['reliable', 'reliable', 'limited', 'none'] as const) },
        budget_usd: pick(rnd, [0, 20, 100]),
        hours_per_week_available: pick(rnd, [6, 10, 20]),
        statuses,
      }),
    );
  }
  const ids = Array.from({ length: nInt }, (_, k) => `iv${k}`);
  const interventions: Intervention[] = ids.map((id) => {
    const type = pick(rnd, SUPPORT);
    const iv: Intervention = {
      id,
      title: `随机示例措施 ${id}`,
      type,
      resolves: [],
      unit_cost_usd: pick(rnd, [0, 20, 50, 100]),
      fixed_cost_usd: pick(rnd, [0, 0, 30, 120]),
      capacity: pick(rnd, [null, 1, 2, 3]),
    };
    if (type === 'device') iv.device = 'laptop';
    if (type === 'transport_subsidy') iv.amount_usd = 40;
    if (type === 'fee_waiver') iv.amount_usd = pick(rnd, [null, 30, 60]);
    if (type === 'time_support') iv.hours_per_week = pick(rnd, [2, 7, 12]);
    if (rnd() < 0.3) iv.capacity_scope = 'per_time_slot';
    if (nOpp > 1 && rnd() < 0.25) iv.opportunity_ids = [pick(rnd, opps).id];
    if (rnd() < 0.15) iv.status = 'pending';
    return iv;
  });
  // 已有 grant：多数指向场景内措施（可撤回），少数无 intervention_id；学生偶尔在场景外。
  const existing: ResourceGrant[] = [];
  for (let k = 0; k < nGrants; k++) {
    const iv = pick(rnd, interventions);
    const linked = rnd() < 0.85;
    existing.push({
      id: `eg${k}`,
      student_id: rnd() < 0.15 ? 'outsider' : pick(rnd, students).id,
      opportunity_id: rnd() < 0.5 ? null : pick(rnd, opps).id,
      intervention_id: linked ? iv.id : null,
      type: iv.type,
      amount_usd: iv.amount_usd ?? null,
      device: iv.device ?? null,
      hours_per_week: iv.hours_per_week ?? null,
      status: rnd() < 0.8 ? 'approved' : 'pending',
      provider: 'Example Org（虚构）',
      is_sample: true,
    });
  }
  // 「换用」结构（约一半）：eg0 是 approved、对所有机会有效的 grant，所属措施容量 1（已满），
  // 另一项措施与它互斥且名额更多——tradeoff 下可能值得撤回 eg0（L > 0），也可能补位（L = 0）。
  const swap = swapIntent && existing.length > 0 && nInt >= 2;
  if (swap && !existing[0].intervention_id) existing[0].intervention_id = interventions[0].id;
  if (swap) {
    // holder = 时间支持（每周 +7 小时），st0 有笔记本、每周 0 小时，只靠 eg0 可达 5 小时的机会；
    // rival = 借笔记本，帮不了 st0（撤回 eg0 后 st0 无法补位 → L > 0），但可能帮到其他人。
    const holder = interventions.find((iv) => iv.id === existing[0].intervention_id)!;
    Object.assign(holder, { type: 'time_support', hours_per_week: 7, device: null, amount_usd: null, capacity: 1, capacity_scope: 'total' });
    delete holder.status;
    Object.assign(existing[0], {
      status: 'approved',
      opportunity_id: null,
      student_id: students[0].id,
      type: 'time_support',
      hours_per_week: 7,
      device: null,
      amount_usd: null,
    });
    Object.assign(students[0], { devices: ['smartphone', 'laptop'], hours_per_week_available: 0, grade: 10, transport: { level: 'reliable' }, budget_usd: 100 });
    for (const g of existing.slice(1)) if (g.intervention_id === holder.id) g.intervention_id = null; // 保持容量预检合法
    const rival = interventions.find((iv) => iv.id !== holder.id)!;
    Object.assign(rival, { type: 'device', device: 'laptop', amount_usd: null, hours_per_week: null, mutually_exclusive_with: [holder.id], capacity: pick(rnd, [null, 2, 3]) });
    delete rival.requires;
    delete rival.status;
    delete rival.opportunity_ids;
    // 第一个机会：线上、免费、每周 5 小时、需要笔记本；其他学生多半缺笔记本——让「换用」真正有得有失。
    Object.assign(opps[0], {
      location: { format: 'online' },
      cost: { fee_usd: 0, requires_travel_expense: false },
      time_commitment: { hours_per_week: 5, total_weeks: 4 },
      required_devices: ['laptop'],
      deadline: '2027-03-01',
    });
    for (const st of students.slice(1)) {
      if (rnd() < (shape === 'tiny' ? 1 : 0.7)) Object.assign(st, { devices: ['smartphone'], grade: 10, hours_per_week_available: 10 });
    }
  }
  const swapHolderId = swap ? existing[0].intervention_id : null;
  /** 「换用」结构占用的措施（holder 与 rival），下面的「pending 腾名额」结构不改动它们。 */
  const swapIds = new Set(swap ? interventions.filter((iv) => iv.id === swapHolderId || (iv.mutually_exclusive_with ?? []).includes(swapHolderId as string)).map((iv) => iv.id) : []);
  // 「pending 腾名额」结构（约 30%）：某条场景内学生的已有 grant 改为 pending，所属措施（借笔记本）容量正好被已有 grant 占满；
  // 该学生资格不符（7 年级），撤回不造成损失、自己也用不上——tradeoff 下（loss_cap 可为 0）值得自愿撤回腾名额（规则 R4）。
  let pendingRoom = false;
  if (rnd() < 0.35) {
    let g = existing.find(
      (x) => typeof x.intervention_id === 'string' && !swapIds.has(x.intervention_id) && x.student_id !== 'outsider' && !(swap && x.student_id === students[0].id),
    );
    const owner = students[students.length - 1];
    const target = interventions.find((iv) => !swapIds.has(iv.id));
    // 没有可用的已有 grant 时新建一条（极小场景只在不超出朴素枚举上限时新建）。
    const roomForNew = shape === 'small' ? existing.length < 2 : nInt * nOpp * nStu + existing.length + 1 <= NAIVE_LIMITS.triplesPlusRevocable;
    if (!g && target && roomForNew && !(swap && owner === students[0])) {
      g = {
        id: 'eg-pend',
        student_id: owner.id,
        opportunity_id: null,
        intervention_id: target.id,
        type: 'device',
        status: 'pending',
        provider: 'Example Org（虚构）',
        is_sample: true,
      };
      existing.push(g);
    }
    if (g) {
      pendingRoom = true;
      const holder = interventions.find((iv) => iv.id === g.intervention_id)!;
      Object.assign(holder, { type: 'device', device: 'laptop', amount_usd: null, hours_per_week: null, capacity_scope: 'total' });
      delete holder.status;
      Object.assign(g, { status: 'pending', type: 'device', device: 'laptop', amount_usd: null, hours_per_week: null });
      Object.assign(students.find((st) => st.id === g.student_id)!, { grade: 7 });
      holder.capacity = new Set(existing.filter((x) => x.intervention_id === holder.id).map((x) => x.student_id)).size;
      delete holder.requires;
      delete holder.opportunity_ids;
      // 另一位场景内学生缺笔记本，第一个机会需要笔记本：腾出的名额有人用得上。
      const needy = students.find((st) => st.id !== g!.student_id && !(swap && st === students[0]));
      if (needy) Object.assign(needy, { devices: ['smartphone'], grade: 10, hours_per_week_available: 10, transport: { level: 'reliable' }, budget_usd: 100 });
      Object.assign(opps[0], {
        location: { format: 'online' },
        cost: { fee_usd: 0, requires_travel_expense: false },
        time_commitment: { hours_per_week: 5, total_weeks: 4 },
        required_devices: ['laptop'],
        deadline: '2027-03-01',
      });
    }
  }
  // 「锁定」结构（约 35%，规则 R1）：场景外学生的已有 grant 指向措施 k（不可撤回），另一项措施 j 与 k 互斥 → j 被封锁。
  // k 不取「换用」结构的 holder（否则 rival 被封锁，「换用」结构失效）。
  if (nInt >= 2 && rnd() < 0.35) {
    const k = pick(rnd, interventions.filter((iv) => iv.id !== swapHolderId));
    const j = pick(rnd, interventions.filter((iv) => iv !== k));
    existing.push({
      id: 'eg-out',
      student_id: 'outsider',
      opportunity_id: null,
      intervention_id: k.id,
      type: k.type,
      amount_usd: k.amount_usd ?? null,
      device: k.device ?? null,
      hours_per_week: k.hours_per_week ?? null,
      status: rnd() < 0.5 ? 'approved' : 'pending',
      provider: 'Example Org（虚构）',
      is_sample: true,
    });
    if (k.capacity != null) k.capacity += 1; // 保持容量预检合法（名额照样被占满或不变）
    const mx = j.mutually_exclusive_with ?? [];
    if (!mx.includes(k.id)) j.mutually_exclusive_with = [...mx, k.id];
  }
  // 互斥 / 依赖：互斥常常指向有已有 grant 的措施（触发强制撤回）。
  const granted = [...new Set(existing.map((g) => g.intervention_id).filter((x): x is string => typeof x === 'string'))];
  interventions.forEach((iv, k) => {
    if (iv.mutually_exclusive_with) return; // 已由「换用」结构设定
    const others = granted.filter((g) => g !== iv.id);
    if (others.length > 0 && rnd() < 0.35) iv.mutually_exclusive_with = [pick(rnd, others)];
    else if (k > 0 && rnd() < 0.2) iv.mutually_exclusive_with = [ids[k - 1]];
    else if (k > 0 && rnd() < 0.2) iv.requires = [ids[0]];
  });
  const slots: Record<string, string> = {};
  if (nOpp > 1 && rnd() < 0.6) {
    slots[opps[0].id] = 'AM';
    if (rnd() < 0.5) slots[opps[1].id] = rnd() < 0.5 ? 'AM' : 'PM';
  }
  const options: SolveOptions = {};
  if (rnd() < (swap || pendingRoom ? 0.8 : 0.4)) {
    options.mode = 'tradeoff';
    options.loss_cap = pick(rnd, [0, 1, 2, 2]);
  }
  if (rnd() < 0.2) options.required_intervention_ids = [pick(rnd, ids)];
  if (rnd() < 0.2) options.min_gain = Math.floor(rnd() * 4);
  if (rnd() < 0.3) {
    const n = rnd() < 0.7 ? 1 : 2;
    options.fairness_floors = Array.from({ length: n }, (_, k) => ({
      id: `floor${k}`,
      label: `随机示例群体 ${k}`,
      basis: '虚构的分组依据（示例）',
      statuses_any_of: rnd() < 0.8 ? [pick(rnd, GROUP_STATUSES)] : [pick(rnd, GROUP_STATUSES), pick(rnd, GROUP_STATUSES)],
      min_ratio: pick(rnd, [0.34, 0.5, 0.67, 1]),
    }));
  }
  const scenario = makeScenario({
    id: `random-${seed}`,
    students,
    opportunities: opps,
    interventions,
    existing_grants: existing.length > 0 ? existing : undefined,
    opportunity_time_slots: Object.keys(slots).length > 0 ? slots : undefined,
    budget_usd: swap || pendingRoom ? pick(rnd, [250, 500, 2000]) : pick(rnd, [0, 100, 250, 500, 2000]),
  });
  return { scenario, options };
}

function inputValid(scenario: Scenario, options: SolveOptions): boolean {
  return (
    verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] }, verifyOpts(options)).checks.find((c) => c.name === 'input_validity')
      ?.passed === true
  );
}

describe('交叉检查：随机小场景（固定种子线性同余）', () => {
  const N_RANDOM = 260;
  let checked = 0;
  for (let k = 0; k < N_RANDOM; k++) {
    const seed = 1000 + k * 7919;
    it(`随机场景 seed=${seed}`, () => {
      const { scenario, options } = randomScenario(seed);
      // 输入不合法的随机场景（如已有 grant 超容量）跳过对照，但要求求解器同样判 UNSUPPORTED_INPUT。
      if (!inputValid(scenario, options)) {
        expect(solveJoint(scenario, options).status).toBe('UNSUPPORTED_INPUT');
        return;
      }
      checked++;
      const issues = crossCheck(scenario, options);
      if (issues.length > 0) {
        expect({ seed, scenario, options, issues }).toEqual({ seed, scenario, options, issues: [] });
      }
    });
  }
  it('随机场景中合法、参与对照的不少于 150 个', () => {
    console.info('[crosscheck random] 合法并参与对照', checked, '/', N_RANDOM);
    expect(checked).toBeGreaterThanOrEqual(150);
  });
});

describe('交叉检查覆盖面', () => {
  // 门槛按实测（2026-11-17：N>0 106、L>0 13、有撤回 69、自愿撤回 46、撤回 pending 48、封锁结构 66 / 起作用 29、
  // 因底线不可行 23）留出余量；达不到时调整随机生成器，不要降低门槛。
  it('对照覆盖了 OPTIMAL（含 N > 0、L > 0、有撤回、自愿撤回、撤回 pending）、不可撤回 grant 封锁互斥措施、INFEASIBLE（含因底线）、conditional、tradeoff、底线', () => {
    console.info('[crosscheck stats]', JSON.stringify(STATS));
    expect(STATS.optimalPositiveN).toBeGreaterThanOrEqual(20);
    expect(STATS.optimalPositiveL).toBeGreaterThanOrEqual(8);
    expect(STATS.optimalWithRevocation).toBeGreaterThanOrEqual(40);
    expect(STATS.optimalVoluntaryRevocation).toBeGreaterThanOrEqual(30);
    expect(STATS.optimalPendingRevocation).toBeGreaterThanOrEqual(30);
    expect(STATS.lockedBlocking).toBeGreaterThanOrEqual(45);
    expect(STATS.lockedBlockingBinding).toBeGreaterThanOrEqual(18);
    expect(STATS.infeasible).toBeGreaterThanOrEqual(4);
    expect(STATS.infeasibleByFloors).toBeGreaterThanOrEqual(10);
    expect(STATS.conditional).toBeGreaterThanOrEqual(3);
    expect(STATS.tradeoff).toBeGreaterThanOrEqual(30);
    expect(STATS.withFloors).toBeGreaterThanOrEqual(20);
  });
});

// ───────────────────────────── 朴素枚举：完整方案逐字段对照 ─────────────────────────────

const cmpS = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function cmpSArr(a: readonly string[], b: readonly string[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) if (a[k] !== b[k]) return cmpS(a[k], b[k]);
  return a.length - b.length;
}

/** 第 5 条完整七级目标（含字典序）：负数 = a 更优，0 = 同一方案。两者都必须可行。 */
function cmpNaive(a: NaiveResult, b: NaiveResult): number {
  if (a.N !== b.N) return b.N - a.N;
  if (a.L !== b.L) return a.L - b.L;
  if (Math.abs(a.total_usd - b.total_usd) > EPS) return a.total_usd - b.total_usd;
  const pa = a.plan!;
  const pb = b.plan!;
  if (pa.allocations.length !== pb.allocations.length) return pa.allocations.length - pb.allocations.length;
  const sa = pa.selected_intervention_ids;
  const sb = pb.selected_intervention_ids;
  if (sa.length !== sb.length) return sa.length - sb.length;
  const ra = pa.revoked_grant_ids ?? [];
  const rb = pb.revoked_grant_ids ?? [];
  if (ra.length !== rb.length) return ra.length - rb.length;
  const c = cmpSArr(sa, sb);
  if (c !== 0) return c;
  for (let k = 0; k < pa.allocations.length; k++) {
    const x = pa.allocations[k];
    const y = pb.allocations[k];
    const d = cmpS(x.intervention_id, y.intervention_id) || cmpS(x.student_id, y.student_id) || cmpS(x.opportunity_id, y.opportunity_id);
    if (d !== 0) return d;
  }
  return cmpSArr(ra, rb);
}

function fullPlan(o: JointOutcome) {
  return {
    selected: o.selected_intervention_ids,
    allocations: o.allocations,
    revoked: o.revoked_grant_ids,
    cost: o.cost,
    lost_pairs: o.lost_pairs,
    revocations: o.revocations,
  };
}

function naivePlan(n: NaiveResult) {
  return {
    selected: n.plan!.selected_intervention_ids,
    allocations: n.plan!.allocations,
    revoked: n.plan!.revoked_grant_ids,
    cost: { fixed_usd: n.fixed_usd, marginal_usd: n.marginal_usd, total_usd: n.total_usd },
    lost_pairs: n.lost_pairs,
    revocations: n.revocations,
  };
}

const NAIVE_STATS = { feasible: 0, infeasible: 0, nonEmpty: 0, withRevocation: 0, positiveL: 0, lockedBlocking: 0, evaluated: 0 };

function naiveCompareOne(
  label: string,
  scenario: Scenario,
  status: string,
  outcome: JointOutcome,
  vopts: VerifyOptions,
  alternative: JointResult['alternative'] | undefined,
): string[] {
  const nv = naiveBest(scenario, vopts);
  NAIVE_STATS.evaluated += nv.evaluated;
  if (nv.feasible) {
    NAIVE_STATS.feasible++;
    if (nv.plan!.selected_intervention_ids.length > 0) NAIVE_STATS.nonEmpty++;
    if (nv.revokedCount > 0) NAIVE_STATS.withRevocation++;
    if (nv.L > 0) NAIVE_STATS.positiveL++;
    if (status !== 'OPTIMAL') return [`${label}：朴素枚举可行，求解器状态为 ${status}`];
    const a = JSON.stringify(fullPlan(outcome));
    const b = JSON.stringify(naivePlan(nv));
    const issues = a === b ? [] : [`${label}：完整方案不一致 solver=${a} naive=${b}`];
    if (!fairnessEqual(outcome.fairness, nv.fairness)) issues.push(`${label}：fairness 不一致 solver=${JSON.stringify(outcome.fairness)} naive=${JSON.stringify(nv.fairness)}`);
    return issues;
  }
  NAIVE_STATS.infeasible++;
  if (status !== 'INFEASIBLE') return [`${label}：朴素枚举不可行，求解器状态为 ${status}`];
  if (alternative === undefined) return [];
  if (!alternative) return [`${label}：INFEASIBLE 但 alternative 为空`];
  // 期望的放松方式（第 6 条）：m = 1, 2, …；同一 m 内按固定优先级的字典序依次尝试，按完整目标取最优，完全并列取靠前的子集。
  const K = givenSoft(vopts);
  let expected: { relaxed: Soft[]; nv: NaiveResult } | null = null;
  for (let m = 1; m <= K.length && !expected; m++) {
    for (const T of combos(K, m)) {
      const r = naiveBest(scenario, without(vopts, T));
      if (!r.feasible) continue;
      if (!expected || cmpNaive(r, expected.nv) < 0) expected = { relaxed: T, nv: r };
    }
  }
  const issues: string[] = [];
  if (!expected) return [`${label}：朴素枚举在放松全部软要求后仍不可行（不应发生）`];
  if (alternative.relaxed.join(',') !== expected.relaxed.join(',')) {
    issues.push(`${label}：alternative 放松项 ${alternative.relaxed.join('+')}，期望 ${expected.relaxed.join('+')}`);
  } else {
    const a = JSON.stringify(fullPlan(alternative));
    const b = JSON.stringify(naivePlan(expected.nv));
    if (a !== b) issues.push(`${label}：alternative 完整方案不一致 solver=${a} naive=${b}`);
  }
  return issues;
}

function naiveCrossCheck(scenario: Scenario, sopts: SolveOptions = {}): string[] {
  const res = solveJoint(scenario, sopts);
  if (blockedByLocked(scenario).length > 0) NAIVE_STATS.lockedBlocking++;
  if (res.status === 'UNSUPPORTED_INPUT') return [`求解器返回 UNSUPPORTED_INPUT：${res.notes.join(' / ')}`];
  const issues = naiveCompareOne('主结果', scenario, res.status, res, verifyOpts(sopts), res.alternative ?? null);
  if (sopts.mode !== 'tradeoff' && (res.revoked_grant_ids ?? []).length > 0) issues.push('protect 模式下主结果有撤回');
  const pending = scenario.interventions.filter((i) => i.status === 'pending').map((i) => i.id).sort();
  if (pending.length > 0 && res.conditional) {
    issues.push(...naiveCompareOne('条件性结果', scenario, res.conditional.status, res.conditional, verifyOpts(sopts, pending), undefined));
  }
  return issues;
}

describe('交叉检查：朴素枚举（每个撤回子集 × 每个 (措施, 学生, 机会) 是否分配），比较完整方案', () => {
  const TINY_HAND: { name: string; scenario: Scenario; options?: SolveOptions }[] = [
    {
      name: '两人、容量 1：并列时按学生编号取 a',
      scenario: makeScenario({ students: [need('b'), need('a')], opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }] }),
    },
    {
      name: '免费无作用的 time_support 不被选中（S4 复现）',
      scenario: makeScenario({
        students: [need('x')],
        opportunities: [O1],
        interventions: [
          makeIntervention('a', { type: 'time_support', resolves: ['time'], hours_per_week: 0, unit_cost_usd: 0, device: null }),
          makeIntervention('b', { unit_cost_usd: 10 }),
        ],
      }),
    },
    {
      name: 'pending 的已有 grant：占容量、不免成本',
      scenario: makeScenario({
        students: [need('t'), need('u')],
        opportunities: [O1],
        interventions: [makeIntervention('loan', { unit_cost_usd: 100, capacity: 1 })],
        existing_grants: [grant({ id: 'p', student_id: 't', opportunity_id: 'o1', intervention_id: 'loan', status: 'pending' })],
      }),
    },
    {
      name: '同上但 tradeoff：撤回 pending grant 腾名额（并列时撤回更少者优先 → 仍给 t）',
      scenario: makeScenario({
        students: [need('t'), need('u')],
        opportunities: [O1],
        interventions: [makeIntervention('loan', { unit_cost_usd: 100, capacity: 1 })],
        existing_grants: [grant({ id: 'p', student_id: 't', opportunity_id: 'o1', intervention_id: 'loan', status: 'pending' })],
      }),
      options: TRADE(0),
    },
    {
      name: '两机会两时段 per_time_slot + 前置依赖',
      scenario: makeScenario({
        students: [need('a'), need('b')],
        opportunities: [O1, O2],
        interventions: [
          { ...LOAN, capacity: 1, capacity_scope: 'per_time_slot', requires: ['setup'] },
          makeIntervention('setup', { type: 'time_support', resolves: ['time'], hours_per_week: 0, unit_cost_usd: 0, fixed_cost_usd: 10, device: null }),
        ],
        opportunity_time_slots: { o1: 'AM', o2: 'PM' },
      }),
    },
    {
      name: '必须启用的措施互斥 + min_gain → INFEASIBLE，alternative 完整方案',
      scenario: makeScenario({
        students: [need('a'), need('b')],
        opportunities: [O1],
        interventions: [
          makeIntervention('x', { mutually_exclusive_with: ['y'], unit_cost_usd: 30 }),
          makeIntervention('y', { unit_cost_usd: 60 }),
        ],
      }),
      options: { required_intervention_ids: ['x', 'y'], min_gain: 1 },
    },
    { name: '换用互斥措施（tradeoff 0）：完整方案含撤回', scenario: swapScenario(), options: TRADE(0) },
    { name: '换用互斥措施（protect）', scenario: swapScenario() },
    {
      name: '自愿撤回使 N 更好（完整方案）',
      scenario: makeScenario({
        students: [need('a'), need('b', { grade: 11 })],
        opportunities: [O1, O2_UPPER],
        interventions: [OLD],
        existing_grants: [grant({ id: 'e-a', student_id: 'a', opportunity_id: 'o1', intervention_id: 'old' })],
      }),
      options: TRADE(1),
    },
    {
      name: 'R1：场景外学生的 grant 封锁互斥措施（tradeoff 1，完整方案）',
      scenario: swapScenario({
        interventions: [{ ...OLD, capacity: 2 }, NEW],
        existing_grants: [
          grant({ id: 'e-a', student_id: 'a', intervention_id: 'old' }),
          grant({ id: 'e-out', student_id: 'outsider', intervention_id: 'old', status: 'pending' }),
        ],
      }),
      options: TRADE(1),
    },
    {
      name: 'loss_cap 0 的 tradeoff：撤回 pending grant 腾名额（完整方案）',
      scenario: makeScenario({
        students: [need('a'), has('h')],
        opportunities: [O1],
        interventions: [OLD],
        existing_grants: [grant({ id: 'e-h', student_id: 'h', intervention_id: 'old', status: 'pending' })],
      }),
      options: TRADE(0),
    },
    {
      name: '三项软要求的放松（完整方案）',
      scenario: makeScenario({ students: fairStudents(), opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }, GALA] }),
      options: { required_intervention_ids: ['gala'], min_gain: 2, fairness_floors: [FG] },
    },
  ];
  for (const { name, scenario, options } of TINY_HAND) {
    it(name, () => {
      expect(naiveCrossCheck(scenario, options ?? {})).toEqual([]);
    });
  }

  const N_TINY = 100;
  for (let k = 0; k < N_TINY; k++) {
    const seed = 50_000 + k * 104_729;
    it(`随机极小场景 seed=${seed}`, () => {
      const { scenario, options } = randomScenario(seed, 'tiny');
      if (!inputValid(scenario, options)) {
        expect(solveJoint(scenario, options).status).toBe('UNSUPPORTED_INPUT');
        return;
      }
      const issues = naiveCrossCheck(scenario, options);
      if (issues.length > 0) expect({ seed, scenario, options, issues }).toEqual({ seed, scenario, options, issues: [] });
    });
  }

  // 门槛按实测（2026-11-17：非空 41、撤回 26、L>0 14、封锁结构 31、不可行 41）留出余量。
  it('朴素对照覆盖了可行（含非空方案、含撤回、L > 0）、不可撤回 grant 封锁互斥措施与不可行，且确实枚举了大量候选', () => {
    console.info('[naive stats]', JSON.stringify(NAIVE_STATS));
    expect(NAIVE_STATS.nonEmpty).toBeGreaterThanOrEqual(20);
    expect(NAIVE_STATS.withRevocation).toBeGreaterThanOrEqual(15);
    expect(NAIVE_STATS.positiveL).toBeGreaterThanOrEqual(8);
    expect(NAIVE_STATS.lockedBlocking).toBeGreaterThanOrEqual(20);
    expect(NAIVE_STATS.infeasible).toBeGreaterThanOrEqual(3);
    expect(NAIVE_STATS.evaluated).toBeGreaterThan(10_000);
  });
});

// ───────────────────────────── 边界输入：求解器与验证器判定一致 ─────────────────────────────

describe('边界输入对照：求解器返回 UNSUPPORTED_INPUT ⇔ 验证器 input_validity 不通过', () => {
  const baseIv = makeIntervention('loan', { unit_cost_usd: 50, capacity: 2 });
  const base = (o: Partial<Scenario> = {}) =>
    makeScenario({ students: [need('a'), need('b')], opportunities: [O1, O2], interventions: [baseIv, makeIntervention('loan2', { unit_cost_usd: 70 })], ...o });
  const iv = (patch: Record<string, unknown>) => base({ interventions: [{ ...baseIv, ...patch } as Intervention, makeIntervention('loan2')] });
  const eg = (patch: Record<string, unknown>) =>
    base({ existing_grants: [{ ...grant({ id: 'e1', student_id: 'a', opportunity_id: 'o1' }), ...patch } as ResourceGrant] });
  const cast = <T,>(x: unknown) => x as T;
  const FLOOR_OK: FairnessFloor = { id: 'f1', label: '示例群体', basis: '虚构依据（示例）', statuses_any_of: ['low_income'], min_ratio: 0.5 };

  const cases: [string, Scenario, Record<string, unknown>, boolean][] = [
    // [名称, 场景, options, 期望合法?]
    ['基准', base(), {}, true],
    ['预算为负', base({ budget_usd: -1 }), {}, false],
    ['预算 NaN', base({ budget_usd: Number.NaN }), {}, false],
    ['预算 Infinity', base({ budget_usd: Number.POSITIVE_INFINITY }), {}, false],
    ['预算是字符串', base({ budget_usd: cast<number>('100') }), {}, false],
    ['评估日前有空格', base({ evaluation_date: ' 2026-11-17' }), {}, false],
    ['评估日后有空格', base({ evaluation_date: '2026-11-17 ' }), {}, false],
    ['评估日不补零', base({ evaluation_date: '2026-1-7' }), {}, false],
    ['评估日 2 月 30 日', base({ evaluation_date: '2026-02-30' }), {}, false],
    ['评估日是数字', base({ evaluation_date: cast<string>(20261117) }), {}, false],
    ['评估日为 null', base({ evaluation_date: cast<string>(null) }), {}, false],
    ['loss_cap 为 null（protect）', base(), { loss_cap: null }, true],
    ['min_gain 为 null', base(), { min_gain: null }, true],
    ['required 为 null', base(), { required_intervention_ids: null }, true],
    ['mode 为 null', base(), { mode: null }, true],
    ['tradeoff + loss_cap null', base(), { mode: 'tradeoff', loss_cap: null }, false],
    ['tradeoff + loss_cap 0', base(), { mode: 'tradeoff', loss_cap: 0 }, true],
    ['mode 拼错', base(), { mode: 'Protect' }, false],
    ['min_gain 为负', base(), { min_gain: -1 }, false],
    ['min_gain NaN', base(), { min_gain: Number.NaN }, false],
    ['loss_cap Infinity', base(), { mode: 'tradeoff', loss_cap: Number.POSITIVE_INFINITY }, false],
    ['required 是字符串', base(), { required_intervention_ids: 'loan' }, false],
    ['required 引用不存在', base(), { required_intervention_ids: ['ghost'] }, false],
    ['capacity 为 undefined', iv({ capacity: undefined }), {}, true],
    ['capacity 为 null', iv({ capacity: null }), {}, true],
    ['capacity 为负', iv({ capacity: -1 }), {}, false],
    ['capacity Infinity', iv({ capacity: Number.POSITIVE_INFINITY }), {}, false],
    ['unit_cost 缺失', iv({ unit_cost_usd: undefined }), {}, false],
    ['fixed_cost 为 null', iv({ fixed_cost_usd: null }), {}, false],
    ['amount_usd 为 null', iv({ amount_usd: null }), {}, true],
    ['amount_usd 为负', iv({ amount_usd: -1 }), {}, false],
    ['hours_per_week NaN', iv({ hours_per_week: Number.NaN }), {}, false],
    ['hours_per_week 为 0', iv({ hours_per_week: 0 }), {}, true],
    ['requires 为 null', iv({ requires: null }), {}, true],
    ['requires 是字符串', iv({ requires: 'loan2' }), {}, false],
    ['互斥为 null', iv({ mutually_exclusive_with: null }), {}, true],
    ['互斥引用自己', iv({ mutually_exclusive_with: ['loan'] }), {}, false],
    ['opportunity_ids 为 null', iv({ opportunity_ids: null }), {}, true],
    ['opportunity_ids 是字符串', iv({ opportunity_ids: 'o1' }), {}, false],
    ['时段表为 null', base({ opportunity_time_slots: cast<Record<string, string>>(null) }), {}, true],
    ['时段表是字符串', base({ opportunity_time_slots: cast<Record<string, string>>('AM') }), {}, false],
    ['时段表是数组', base({ opportunity_time_slots: cast<Record<string, string>>(['AM']) }), {}, false],
    ['时段标签是数字', base({ opportunity_time_slots: cast<Record<string, string>>({ o1: 1, o2: 2 }) }), {}, false],
    ['时段标签为空', base({ opportunity_time_slots: { o1: '' } }), {}, false],
    ['时段标签为空格（非空字符串）', base({ opportunity_time_slots: { o1: ' ' } }), {}, true],
    ['时段标签为 null', base({ opportunity_time_slots: cast<Record<string, string>>({ o1: null }) }), {}, false],
    ['existing_grants 为 null', base({ existing_grants: cast<ResourceGrant[]>(null) }), {}, true],
    ['existing_grants 是字符串', base({ existing_grants: cast<ResourceGrant[]>('x') }), {}, false],
    ['existing_grants 含 null', base({ existing_grants: cast<ResourceGrant[]>([null]) }), {}, false],
    ['已有 grant amount 为负', eg({ amount_usd: -5 }), {}, false],
    ['已有 grant hours Infinity', eg({ hours_per_week: Number.POSITIVE_INFINITY }), {}, false],
    ['已有 grant amount 为 null', eg({ amount_usd: null }), {}, true],
    ['students 为 null', base({ students: cast<StudentProfile[]>(null) }), {}, false],
    ['students 含没有 id 的条目', base({ students: cast<StudentProfile[]>([{ grade: 10 }]) }), {}, false],
    ['interventions 含 null', base({ interventions: cast<Intervention[]>([null]) }), {}, false],
    ['学生 id 重复', base({ students: [need('a'), need('a')] }), {}, false],
    // 第 3 层：existing grant 的 id、公平底线格式
    ['已有 grant id 重复', base({ existing_grants: [grant({ id: 'e1', student_id: 'a' }), grant({ id: 'e1', student_id: 'b' })] }), {}, false],
    ['已有 grant id 是数字', eg({ id: 7 }), {}, false],
    ['已有 grant id 缺失', eg({ id: undefined }), {}, false],
    ['已有 grant 指向场景外措施（合法、不可撤回）', eg({ intervention_id: 'gone' }), {}, true],
    ['fairness_floors 为 null', base(), { fairness_floors: null }, true],
    ['fairness_floors 为空数组', base(), { fairness_floors: [] }, true],
    ['fairness_floors 合法', base(), { fairness_floors: [FLOOR_OK] }, true],
    ['fairness_floors 合法（min_ratio 0 与 1）', base(), { fairness_floors: [{ ...FLOOR_OK, min_ratio: 0 }, { ...FLOOR_OK, id: 'f2', min_ratio: 1 }] }, true],
    ['fairness_floors 不是数组', base(), { fairness_floors: FLOOR_OK }, false],
    ['fairness_floors 含 null', base(), { fairness_floors: [null] }, false],
    ['底线 id 为空', base(), { fairness_floors: [{ ...FLOOR_OK, id: '' }] }, false],
    ['底线 id 重复', base(), { fairness_floors: [FLOOR_OK, FLOOR_OK] }, false],
    ['底线 label 为空格', base(), { fairness_floors: [{ ...FLOOR_OK, label: ' ' }] }, false],
    ['底线 basis 缺失', base(), { fairness_floors: [{ ...FLOOR_OK, basis: undefined }] }, false],
    ['底线 basis 不是字符串', base(), { fairness_floors: [{ ...FLOOR_OK, basis: 3 }] }, false],
    ['底线 statuses_any_of 为空', base(), { fairness_floors: [{ ...FLOOR_OK, statuses_any_of: [] }] }, false],
    ['底线 statuses_any_of 含非法值', base(), { fairness_floors: [{ ...FLOOR_OK, statuses_any_of: ['wealthy'] }] }, false],
    ['底线 statuses_any_of 有重复值（合法）', base(), { fairness_floors: [{ ...FLOOR_OK, statuses_any_of: ['low_income', 'low_income'] }] }, true],
    ['底线 min_ratio 大于 1', base(), { fairness_floors: [{ ...FLOOR_OK, min_ratio: 1.01 }] }, false],
    ['底线 min_ratio 为负', base(), { fairness_floors: [{ ...FLOOR_OK, min_ratio: -0.5 }] }, false],
    ['底线 min_ratio NaN', base(), { fairness_floors: [{ ...FLOOR_OK, min_ratio: Number.NaN }] }, false],
    ['底线 min_ratio 为 null', base(), { fairness_floors: [{ ...FLOOR_OK, min_ratio: null }] }, false],
  ];
  for (const [name, scenario, options, expectValid] of cases) {
    it(name, () => {
      const solver = solveJoint(scenario, options as SolveOptions);
      const v = verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] }, options as VerifyOptions);
      const verifierValid = v.checks.find((c) => c.name === 'input_validity')?.passed === true;
      expect({ solverUnsupported: solver.status === 'UNSUPPORTED_INPUT', verifierInvalid: !verifierValid }).toEqual({
        solverUnsupported: !expectValid,
        verifierInvalid: !expectValid,
      });
    });
  }
});
