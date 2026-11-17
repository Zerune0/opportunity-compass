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
import { exhaustiveBest, type ExhaustiveResult } from './exhaustive';
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

/** 按第 5 条比较指标：负数 = a 更优，0 = 指标完全并列。 */
function cmpMetrics(a: ExhaustiveResult, b: ExhaustiveResult): number {
  if (a.N !== b.N) return b.N - a.N;
  if (Math.abs(a.total_usd - b.total_usd) > EPS) return a.total_usd - b.total_usd;
  return a.allocationCount - b.allocationCount;
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

function randomScenario(seed: number): { scenario: Scenario; options: SolveOptions } {
  const rnd = lcg(seed);
  const nOpp = rnd() < 0.6 ? 1 : 2;
  const nStu = 2 + Math.floor(rnd() * (nOpp === 1 ? 5 : 3)); // 单机会 2–6 人，两机会 2–4 人
  const nInt = 1 + Math.floor(rnd() * 3); // 1–3 项措施

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
  const N_RANDOM = 40;
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
  it('随机场景中合法、参与对照的不少于 30 个', () => {
    expect(checked).toBeGreaterThanOrEqual(30);
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
