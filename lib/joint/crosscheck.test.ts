/**
 * 交叉检查：求解器（./solve，只 import、不读源码）对照独立验证器（./verify）与朴素穷举（./exhaustive）。
 * 这是唯一允许 import 求解器的测试文件。全部是虚构示例数据，结果是模拟。
 */
import { describe, expect, it } from 'vitest';
import type {
  DeviceType,
  Intervention,
  JointOutcome,
  JointResult,
  Opportunity,
  ResourceGrant,
  Scenario,
  SolveOptions,
  StudentProfile,
  SupportType,
  VerifyOptions,
} from '../types';
import { exhaustiveBest, NAIVE_LIMITS, naiveBest, type ExhaustiveResult, type NaiveResult } from './exhaustive';
import { solveJoint } from './solve';
import { lcg, makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { verifyPlan } from './verify';

const EPS = 1e-6;

type Soft = 'required_intervention_ids' | 'min_gain';

function verifyOpts(o: SolveOptions, assume?: string[]): VerifyOptions {
  const v: VerifyOptions = {};
  if (o.mode !== undefined) v.mode = o.mode;
  if (o.loss_cap !== undefined) v.loss_cap = o.loss_cap;
  if (o.required_intervention_ids !== undefined) v.required_intervention_ids = o.required_intervention_ids;
  if (o.min_gain !== undefined) v.min_gain = o.min_gain;
  if (assume) v.assume_approved_intervention_ids = assume;
  return v;
}

function without(o: VerifyOptions, relaxed: Soft[]): VerifyOptions {
  const v = { ...o };
  for (const r of relaxed) delete v[r];
  return v;
}

/** 按第 5 条比较指标（不含字典序）：负数 = a 更优，0 = 指标完全并列。 */
function cmpMetrics(a: ExhaustiveResult, b: ExhaustiveResult): number {
  if (a.N !== b.N) return b.N - a.N;
  if (Math.abs(a.total_usd - b.total_usd) > EPS) return a.total_usd - b.total_usd;
  if (a.allocationCount !== b.allocationCount) return a.allocationCount - b.allocationCount;
  return a.selectedCount - b.selectedCount;
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
    allocations: r.allocations?.length,
    selected: r.selected_intervention_ids,
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
    selected: e.plan?.selected_intervention_ids,
    allocations: e.plan?.allocations.map((a) => `${a.intervention_id}:${a.student_id}:${a.opportunity_id}`),
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
    if (Math.abs(outcome.cost.total_usd - ex.total_usd) > EPS) issues.push(`${label}：total_usd 不一致 ${ctx()}`);
    if (outcome.allocations.length !== ex.allocationCount) issues.push(`${label}：分配条数不一致 ${ctx()}`);
    if (outcome.selected_intervention_ids.length !== ex.selectedCount) issues.push(`${label}：选中措施数不一致 ${ctx()}`);
    issues.push(...normalizationIssues(label, scenario, outcome, vopts.required_intervention_ids));
    return issues;
  }

  // 穷举不可行
  if (status !== 'INFEASIBLE') {
    issues.push(`${label}：穷举不可行，求解器状态为 ${status} ${ctx()}`);
    return issues;
  }
  if (outcome.selected_intervention_ids.length !== 0 || outcome.allocations.length !== 0 || outcome.cost.total_usd !== 0) {
    issues.push(`${label}：INFEASIBLE 主结果不是空方案 ${ctx()}`);
  }
  if (alternative === undefined) return issues; // 条件性结果没有 alternative 字段
  if (!alternative) {
    issues.push(`${label}：INFEASIBLE 但 alternative 为空`);
    return issues;
  }
  const relaxed = alternative.relaxed as Soft[];
  const v = verifyPlan(scenario, alternative, without(vopts, relaxed));
  if (!v.passed) {
    issues.push(`${label}：alternative 未通过去掉 ${relaxed.join('+')} 后的 verifyPlan：${v.checks.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail}`).join(' | ')}`);
  }
  // 期望的放松方式（第 6 条）：只尝试 options 里给出的项；都可行取更优，完全并列取只放松 min_gain；都不可行两项都放松。
  const given: Soft[] = (['min_gain', 'required_intervention_ids'] as Soft[]).filter((k) => vopts[k] !== undefined);
  const tries = given.map((k) => ({ relaxed: [k], ex: exhaustiveBest(scenario, without(vopts, [k])) })).filter((t) => t.ex.feasible);
  let expected: { relaxed: Soft[]; ex: ExhaustiveResult }[];
  if (tries.length === 0) expected = [{ relaxed: given, ex: exhaustiveBest(scenario, without(vopts, given)) }];
  else {
    tries.sort((a, b) => cmpMetrics(a.ex, b.ex));
    expected = tries.filter((t) => cmpMetrics(t.ex, tries[0].ex) === 0);
  }
  const match = expected.find(
    (e) => [...e.relaxed].sort().join(',') === [...relaxed].sort().join(','),
  );
  const altCtx = JSON.stringify({
    solverAlternative: { relaxed, ...outcomeSummary(alternative) },
    expected: expected.map((e) => ({ relaxed: e.relaxed, ...exSummary(e.ex) })),
  });
  if (!match) {
    // 指标完全并列时契约要求取只放松 min_gain；但字典序（第 5 条第 4 步）不同的方案指标也可能并列，这里只在指标层面比较。
    issues.push(`${label}：alternative 放松项与期望不符 ${altCtx}`);
  } else {
    if (alternative.N !== match.ex.N) issues.push(`${label}：alternative N 不一致 ${altCtx}`);
    if (Math.abs(alternative.cost.total_usd - match.ex.total_usd) > EPS) issues.push(`${label}：alternative total_usd 不一致 ${altCtx}`);
    if (alternative.allocations.length !== match.ex.allocationCount) issues.push(`${label}：alternative 分配条数不一致 ${altCtx}`);
    if (alternative.selected_intervention_ids.length !== match.ex.selectedCount) issues.push(`${label}：alternative 选中措施数不一致 ${altCtx}`);
    const keptRequired = relaxed.includes('required_intervention_ids') ? undefined : vopts.required_intervention_ids;
    issues.push(...normalizationIssues(`${label} alternative`, scenario, alternative, keptRequired));
  }
  return issues;
}

/** 覆盖面统计：保证对照真的覆盖到了各种情况（不是全部空方案）。 */
const STATS = { optimal: 0, optimalPositiveN: 0, infeasible: 0, conditional: 0, multiAllocGroups: 0 };

function crossCheck(scenario: Scenario, sopts: SolveOptions = {}): string[] {
  const issues: string[] = [];
  const res = solveJoint(scenario, sopts);
  if (res.status === 'OPTIMAL') {
    STATS.optimal++;
    if (res.N > 0) STATS.optimalPositiveN++;
    const groups = new Set(res.allocations.map((a) => a.intervention_id + '|' + a.student_id));
    if (groups.size < res.allocations.length) STATS.multiAllocGroups++;
  }
  if (res.status === 'INFEASIBLE') STATS.infeasible++;
  if (res.conditional) STATS.conditional++;
  if (res.status === 'UNSUPPORTED_INPUT') return [`求解器返回 UNSUPPORTED_INPUT（场景应合法）：${res.notes.join(' / ')}`];
  issues.push(...compareOne('主结果', scenario, res.status, res, verifyOpts(sopts), res.alternative ?? null));

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

// ───────────────────────────── 随机场景 ─────────────────────────────

const SUPPORT: SupportType[] = ['device', 'transport_subsidy', 'fee_waiver', 'time_support', 'alternative_access'];

function pick<T>(rnd: () => number, xs: readonly T[]): T {
  return xs[Math.floor(rnd() * xs.length)];
}

/**
 * shape = 'small'：单机会 2–6 人、两机会 2–4 人，1–4 项措施（与 exhaustiveBest 对照）；
 * shape = 'tiny'：≤ 3 人、≤ 2 个机会、≤ 3 项措施，且「措施 × 学生 × 机会」≤ 12（与朴素枚举 naiveBest 对照）。
 */
function randomScenario(seed: number, shape: 'small' | 'tiny' = 'small'): { scenario: Scenario; options: SolveOptions } {
  const rnd = lcg(seed);
  const nOpp = rnd() < 0.6 ? 1 : 2;
  let nStu: number;
  let nInt: number;
  if (shape === 'small') {
    nStu = 2 + Math.floor(rnd() * (nOpp === 1 ? 5 : 3)); // 单机会 2–6 人，两机会 2–4 人
    nInt = 1 + Math.floor(rnd() * 4); // 1–4 项措施
    if (nInt === 4 && nStu * nOpp > 4) nStu = Math.max(2, Math.floor(4 / nOpp)); // 4 项措施时控制规模，保持整套测试几秒内
  } else {
    nInt = 1 + Math.floor(rnd() * NAIVE_LIMITS.interventions);
    const maxStu = Math.min(NAIVE_LIMITS.students, Math.floor(NAIVE_LIMITS.triples / (nInt * nOpp)));
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
    students.push(
      makeStudent(`st${k}`, {
        grade: rnd() < 0.12 ? 7 : 10,
        devices: rnd() < 0.3 ? ['smartphone', 'laptop'] : ['smartphone'],
        transport: { level: pick(rnd, ['reliable', 'reliable', 'limited', 'none'] as const) },
        budget_usd: pick(rnd, [0, 20, 100]),
        hours_per_week_available: pick(rnd, [6, 10, 20]),
      }),
    );
  }
  const ids = Array.from({ length: nInt }, (_, k) => `iv${k}`);
  const interventions: Intervention[] = ids.map((id, k) => {
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
    if (k > 0 && rnd() < 0.2) iv.mutually_exclusive_with = [ids[k - 1]];
    else if (k > 0 && rnd() < 0.2) iv.requires = [ids[0]];
    if (rnd() < 0.15) iv.status = 'pending';
    return iv;
  });
  const existing: ResourceGrant[] = [];
  if (rnd() < 0.35) {
    const iv = pick(rnd, interventions);
    existing.push({
      id: 'eg0',
      student_id: pick(rnd, students).id,
      opportunity_id: rnd() < 0.5 ? null : pick(rnd, opps).id,
      intervention_id: iv.id,
      type: iv.type,
      amount_usd: iv.amount_usd ?? null,
      device: iv.device ?? null,
      hours_per_week: iv.hours_per_week ?? null,
      status: rnd() < 0.8 ? 'approved' : 'pending',
      provider: 'Example Org（虚构）',
      is_sample: true,
    });
  }
  const slots: Record<string, string> = {};
  if (nOpp > 1 && rnd() < 0.6) {
    slots[opps[0].id] = 'AM';
    if (rnd() < 0.5) slots[opps[1].id] = rnd() < 0.5 ? 'AM' : 'PM';
  }
  const options: SolveOptions = {};
  if (rnd() < 0.2) options.required_intervention_ids = [pick(rnd, ids)];
  if (rnd() < 0.25) options.min_gain = Math.floor(rnd() * 4);
  const scenario = makeScenario({
    id: `random-${seed}`,
    students,
    opportunities: opps,
    interventions,
    existing_grants: existing.length > 0 ? existing : undefined,
    opportunity_time_slots: Object.keys(slots).length > 0 ? slots : undefined,
    budget_usd: pick(rnd, [0, 100, 250, 500, 2000]),
  });
  return { scenario, options };
}

describe('交叉检查：随机小场景（固定种子线性同余）', () => {
  const N_RANDOM = 200;
  let checked = 0;
  for (let k = 0; k < N_RANDOM; k++) {
    const seed = 1000 + k * 7919;
    it(`随机场景 seed=${seed}`, () => {
      const { scenario, options } = randomScenario(seed);
      // 生成器保证 existing grant 不超容量的检查交给 verifyPlan：输入不合法的随机场景跳过对照，但要求求解器同样判 UNSUPPORTED_INPUT。
      const valid = verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] }, verifyOpts(options)).checks.find(
        (c) => c.name === 'input_validity',
      )?.passed;
      if (!valid) {
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
    expect(checked).toBeGreaterThanOrEqual(150);
  });
});

describe('交叉检查覆盖面', () => {
  it('对照覆盖了 OPTIMAL（含 N > 0）、INFEASIBLE、conditional', () => {
    console.info('[crosscheck stats]', JSON.stringify(STATS));
    expect(STATS.optimalPositiveN).toBeGreaterThanOrEqual(20);
    expect(STATS.infeasible).toBeGreaterThanOrEqual(4);
    expect(STATS.conditional).toBeGreaterThanOrEqual(3);
  });
});

// ───────────────────────────── 朴素枚举：完整方案逐字段对照 ─────────────────────────────

const cmpS = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** 第 5 条完整目标（含字典序）：负数 = a 更优，0 = 同一方案。两者都必须可行。 */
function cmpNaive(a: NaiveResult, b: NaiveResult): number {
  if (a.N !== b.N) return b.N - a.N;
  if (Math.abs(a.total_usd - b.total_usd) > EPS) return a.total_usd - b.total_usd;
  const pa = a.plan!;
  const pb = b.plan!;
  if (pa.allocations.length !== pb.allocations.length) return pa.allocations.length - pb.allocations.length;
  const sa = pa.selected_intervention_ids;
  const sb = pb.selected_intervention_ids;
  if (sa.length !== sb.length) return sa.length - sb.length;
  for (let k = 0; k < sa.length; k++) if (sa[k] !== sb[k]) return cmpS(sa[k], sb[k]);
  for (let k = 0; k < pa.allocations.length; k++) {
    const x = pa.allocations[k];
    const y = pb.allocations[k];
    const d = cmpS(x.intervention_id, y.intervention_id) || cmpS(x.student_id, y.student_id) || cmpS(x.opportunity_id, y.opportunity_id);
    if (d !== 0) return d;
  }
  return 0;
}

function fullPlan(o: JointOutcome) {
  return { selected: o.selected_intervention_ids, allocations: o.allocations, cost: o.cost };
}

function naivePlan(n: NaiveResult) {
  return {
    selected: n.plan!.selected_intervention_ids,
    allocations: n.plan!.allocations,
    cost: { fixed_usd: n.fixed_usd, marginal_usd: n.marginal_usd, total_usd: n.total_usd },
  };
}

const NAIVE_STATS = { feasible: 0, infeasible: 0, nonEmpty: 0, evaluated: 0 };

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
    if (status !== 'OPTIMAL') return [`${label}：朴素枚举可行，求解器状态为 ${status}`];
    const a = JSON.stringify(fullPlan(outcome));
    const b = JSON.stringify(naivePlan(nv));
    return a === b ? [] : [`${label}：完整方案不一致 solver=${a} naive=${b}`];
  }
  NAIVE_STATS.infeasible++;
  if (status !== 'INFEASIBLE') return [`${label}：朴素枚举不可行，求解器状态为 ${status}`];
  if (alternative === undefined) return [];
  if (!alternative) return [`${label}：INFEASIBLE 但 alternative 为空`];
  // 期望的放松方式：按 [min_gain, required] 顺序尝试 options 里给出的项，取完整目标最优；完全并列取先尝试的；都不可行两项都放松。
  const given: Soft[] = (['min_gain', 'required_intervention_ids'] as Soft[]).filter((k) => vopts[k] !== undefined);
  let expected: { relaxed: Soft[]; nv: NaiveResult } | null = null;
  for (const k of given) {
    const r = naiveBest(scenario, without(vopts, [k]));
    if (!r.feasible) continue;
    if (!expected || cmpNaive(r, expected.nv) < 0) expected = { relaxed: [k], nv: r };
  }
  if (!expected) expected = { relaxed: given, nv: naiveBest(scenario, without(vopts, given)) };
  const issues: string[] = [];
  if ([...alternative.relaxed].sort().join(',') !== [...expected.relaxed].sort().join(',')) {
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
  if (res.status === 'UNSUPPORTED_INPUT') return [`求解器返回 UNSUPPORTED_INPUT：${res.notes.join(' / ')}`];
  const issues = naiveCompareOne('主结果', scenario, res.status, res, verifyOpts(sopts), res.alternative ?? null);
  const pending = scenario.interventions.filter((i) => i.status === 'pending').map((i) => i.id).sort();
  if (pending.length > 0 && res.conditional) {
    issues.push(...naiveCompareOne('条件性结果', scenario, res.conditional.status, res.conditional, verifyOpts(sopts, pending), undefined));
  }
  return issues;
}

describe('交叉检查：朴素枚举（每个 (措施, 学生, 机会) 是否分配），比较完整方案', () => {
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
  ];
  for (const { name, scenario, options } of TINY_HAND) {
    it(name, () => {
      expect(naiveCrossCheck(scenario, options ?? {})).toEqual([]);
    });
  }

  const N_TINY = 60;
  for (let k = 0; k < N_TINY; k++) {
    const seed = 50_000 + k * 104_729;
    it(`随机极小场景 seed=${seed}`, () => {
      const { scenario, options } = randomScenario(seed, 'tiny');
      const valid = verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] }, verifyOpts(options)).checks.find(
        (c) => c.name === 'input_validity',
      )?.passed;
      if (!valid) {
        expect(solveJoint(scenario, options).status).toBe('UNSUPPORTED_INPUT');
        return;
      }
      const issues = naiveCrossCheck(scenario, options);
      if (issues.length > 0) expect({ seed, scenario, options, issues }).toEqual({ seed, scenario, options, issues: [] });
    });
  }

  it('朴素对照覆盖了可行（含非空方案）与不可行，且确实枚举了大量候选', () => {
    console.info('[naive stats]', JSON.stringify(NAIVE_STATS));
    expect(NAIVE_STATS.nonEmpty).toBeGreaterThanOrEqual(20);
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
