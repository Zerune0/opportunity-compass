import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeReachability } from '../reachability';
import type { Allocation, JointPlan, ResourceGrant, Scenario, VerifyOptions, VerifyResult } from '../types';
import { exhaustiveBest } from './exhaustive';
import { EVAL_DATE, makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { verifyPlan } from './verify';

// 全部是虚构示例数据（example.com、is_sample: true），结果是模拟。

const TODAY = { today: EVAL_DATE };

const O1 = makeOpp('o1');
const O2 = makeOpp('o2');
const OPAST = makeOpp('opast', { deadline: '2026-10-01' });
const S1 = makeStudent('s1');
const S2 = makeStudent('s2');
const S3 = makeStudent('s3', { devices: ['smartphone', 'home_internet', 'laptop'] });
const S4 = makeStudent('s4', { grade: 7 });
const S5 = makeStudent('s5');

const LOAN = makeIntervention('loan', { unit_cost_usd: 100, fixed_cost_usd: 50, capacity: 3 });

function base(overrides: Partial<Scenario> = {}): Scenario {
  return makeScenario({
    students: [S1, S2, S3, S4, S5],
    opportunities: [O1, O2, OPAST],
    interventions: [LOAN],
    budget_usd: 1000,
    ...overrides,
  });
}

function alloc(i: string, s: string, o: string, cost: number): Allocation {
  return { intervention_id: i, student_id: s, opportunity_id: o, cost_usd: cost };
}

function check(res: VerifyResult, name: string) {
  const c = res.checks.find((x) => x.name === name);
  if (!c) throw new Error(`缺少检查项 ${name}`);
  return c;
}

function expectFail(res: VerifyResult, name: string) {
  expect(res.passed).toBe(false);
  expect(check(res, name).passed, check(res, name).detail).toBe(false);
}

function failedNames(res: VerifyResult): string[] {
  return res.checks.filter((c) => !c.passed).map((c) => c.name);
}

const laptopGrant = (student: string, opp: string | null, extra: Partial<ResourceGrant> = {}): ResourceGrant => ({
  id: `g-${student}-${opp}`,
  student_id: student,
  opportunity_id: opp,
  type: 'device',
  device: 'laptop',
  status: 'approved',
  provider: 'Example Org（虚构）',
  is_sample: true,
  ...extra,
});

/** 正确方案：loan 给 s1（o1、o2）与 s2（o1）。G = 3，成本 50 + 2 × 100 = 250。 */
const GOOD: JointPlan = {
  selected_intervention_ids: ['loan'],
  allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's1', 'o2', 0), alloc('loan', 's2', 'o1', 100)],
};

const ALL_CHECKS = [
  'input_validity',
  'approval',
  'mutual_exclusion',
  'prerequisite',
  'allocation_validity',
  'capacity',
  'cost_accounting',
  'budget',
  'eligibility',
  'deadline',
  'barrier_resolution',
  'coverage_loss',
  'metrics',
];

describe('fixture 自检（保证用例前提成立）', () => {
  it('没有笔记本的学生不带 grant 不可达，带设备 grant 后可达', () => {
    expect(analyzeReachability(S1, O1, [], TODAY).reachable).toBe(false);
    expect(analyzeReachability(S1, O1, [laptopGrant('s1', 'o1')], TODAY).reachable).toBe(true);
  });
  it('有笔记本的学生本来就可达', () => {
    expect(analyzeReachability(S3, O1, [], TODAY).reachable).toBe(true);
  });
  it('7 年级学生带设备 grant 仍不可达（资格不满足）', () => {
    expect(analyzeReachability(S4, O1, [laptopGrant('s4', 'o1')], TODAY).reachable).toBe(false);
  });
  it('已过截止日期的机会带 grant 也不可达', () => {
    expect(analyzeReachability(S1, OPAST, [laptopGrant('s1', 'opast')], TODAY).reachable).toBe(false);
  });
});

describe('verifyPlan：正确方案全部通过', () => {
  it('基本正确方案：每项检查都输出且通过', () => {
    const res = verifyPlan(base(), GOOD);
    expect(failedNames(res)).toEqual([]);
    expect(res.passed).toBe(true);
    expect(res.checks.map((c) => c.name)).toEqual(ALL_CHECKS);
    for (const c of res.checks) expect(c.detail.length).toBeGreaterThan(0);
  });

  it('空方案通过，且不传软要求时不输出 organizer_requirements', () => {
    const res = verifyPlan(base(), { selected_intervention_ids: [], allocations: [] });
    expect(res.passed).toBe(true);
    expect(res.checks.some((c) => c.name === 'organizer_requirements')).toBe(false);
    expect(check(res, 'metrics').detail).toContain('plan 未携带指标，仅重算');
  });

  it('带正确指标的 JointResult 形状通过 metrics；软要求满足时 organizer_requirements 通过', () => {
    const plan = {
      ...GOOD,
      R0: [
        { student_id: 's3', opportunity_id: 'o2' },
        { student_id: 's3', opportunity_id: 'o1' },
      ],
      R1: [
        { student_id: 's1', opportunity_id: 'o1' },
        { student_id: 's1', opportunity_id: 'o2' },
        { student_id: 's2', opportunity_id: 'o1' },
        { student_id: 's3', opportunity_id: 'o1' },
        { student_id: 's3', opportunity_id: 'o2' },
      ],
      G: 3,
      L: 0,
      N: 3,
      cost: { fixed_usd: 50, marginal_usd: 200, total_usd: 250 },
    };
    const res = verifyPlan(base(), plan, { required_intervention_ids: ['loan'], min_gain: 3 });
    expect(failedNames(res)).toEqual([]);
    expect(check(res, 'organizer_requirements').passed).toBe(true);
  });

  it('existing grant 已覆盖的 (措施, 学生) 记 0 成本、不重复占容量', () => {
    // s1 已经通过 loan 拿到一份 grant（只对 o1 有效）；方案把 loan 也用于 s1@o2，记 0。
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 2 }],
      existing_grants: [laptopGrant('s1', 'o1', { intervention_id: 'loan' })],
    });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o2', 0), alloc('loan', 's2', 'o1', 100)],
    };
    const res = verifyPlan(scenario, plan);
    expect(failedNames(res)).toEqual([]);
  });

  it('per_time_slot：不同时段可复用同一份容量', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
      opportunity_time_slots: { o1: 'AM', o2: 'PM' },
    });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's2', 'o2', 100)],
    };
    expect(failedNames(verifyPlan(scenario, plan))).toEqual([]);
  });

  it('pending 措施在 assume_approved 中列出时放行', () => {
    const scenario = base({ interventions: [{ ...LOAN, status: 'pending' }] });
    const res = verifyPlan(scenario, GOOD, { assume_approved_intervention_ids: ['loan'] });
    expect(failedNames(res)).toEqual([]);
  });

  it('tradeoff 模式 L ≤ loss_cap 时 coverage_loss 通过（负小时措施本身使 input_validity 不通过）', () => {
    const { scenario, plan } = lossCase();
    const res = verifyPlan(scenario, plan, { mode: 'tradeoff', loss_cap: 1 });
    expect(check(res, 'coverage_loss').passed).toBe(true);
    expectFail(res, 'input_validity');
  });
});

describe('verifyPlan：容量', () => {
  it('total 口径：超过容量的不同学生数', () => {
    const scenario = base({ interventions: [{ ...LOAN, capacity: 1 }] });
    const res = verifyPlan(scenario, GOOD);
    expectFail(res, 'capacity');
    expect(check(res, 'capacity').detail).toContain('loan');
  });

  it('total 口径：同一学生多个机会只占 1 个容量（不误报）', () => {
    const scenario = base({ interventions: [{ ...LOAN, capacity: 1 }] });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's1', 'o2', 0)],
    };
    expect(check(verifyPlan(scenario, plan), 'capacity').passed).toBe(true);
  });

  it('per_time_slot 口径：同一时段内超出', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
      opportunity_time_slots: { o1: 'AM', o2: 'AM' },
    });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's2', 'o2', 100)],
    };
    const res = verifyPlan(scenario, plan);
    expectFail(res, 'capacity');
    expect(check(res, 'capacity').detail).toContain('AM');
  });

  it('per_time_slot 口径：没列出的机会同属默认时段', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
      opportunity_time_slots: { opast: 'X' },
    });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's2', 'o2', 100)],
    };
    const res = verifyPlan(scenario, plan);
    expectFail(res, 'capacity');
    expect(check(res, 'capacity').detail).toContain('默认时段');
  });

  it('existing grant 占位（学生不在场景内、status 为 pending 也占）', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 2 }],
      existing_grants: [laptopGrant('outsider', null, { intervention_id: 'loan', status: 'pending' })],
    });
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's2', 'o1', 100)],
    };
    const res = verifyPlan(scenario, plan);
    expect(check(res, 'input_validity').passed).toBe(true);
    expectFail(res, 'capacity');
    expect(check(res, 'capacity').detail).toContain('outsider');
  });

  it('per_time_slot：opportunity_id 为 null 的 existing grant 计入每个时段', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
      opportunity_time_slots: { o1: 'AM', o2: 'PM' },
      existing_grants: [laptopGrant('outsider', null, { intervention_id: 'loan' })],
    });
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's2', 'o2', 100)] };
    expectFail(verifyPlan(scenario, plan), 'capacity');
  });

  it('只算 existing grant 就超容量 → input_validity 不通过', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1 }],
      existing_grants: [
        laptopGrant('x1', null, { id: 'e1', intervention_id: 'loan' }),
        laptopGrant('x2', null, { id: 'e2', intervention_id: 'loan' }),
      ],
    });
    const res = verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] });
    expectFail(res, 'input_validity');
  });
});

describe('verifyPlan：成本与预算', () => {
  it('总成本超预算', () => {
    const res = verifyPlan(base({ budget_usd: 200 }), GOOD);
    expectFail(res, 'budget');
    expect(check(res, 'budget').detail).toContain('250');
  });

  it('固定成本少计（cost.fixed_usd = 0）', () => {
    const plan = { ...GOOD, cost: { fixed_usd: 0, marginal_usd: 200, total_usd: 200 } };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'cost_accounting');
    expectFail(res, 'metrics');
  });

  it('固定成本重复计（同一措施计两次）', () => {
    const plan = { ...GOOD, cost: { fixed_usd: 100, marginal_usd: 200, total_usd: 300 } };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'cost_accounting');
    expectFail(res, 'metrics');
  });

  it('同一 (措施, 学生) 记了两次全额', () => {
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's1', 'o2', 100)],
    };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'cost_accounting');
    expect(check(res, 'cost_accounting').detail).toContain('(loan, s1)');
  });

  it('已有 grant 覆盖的 (措施, 学生) 仍计费', () => {
    const scenario = base({ existing_grants: [laptopGrant('s1', 'o1', { intervention_id: 'loan' })] });
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o2', 100)] };
    expectFail(verifyPlan(scenario, plan), 'cost_accounting');
  });

  it('人均成本少计（记 0）', () => {
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o1', 0)] };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'cost_accounting');
    // 预算按重算的正确成本检查，不按少记的数字
    expect(check(verifyPlan(base({ budget_usd: 100 }), plan), 'budget').passed).toBe(false);
  });

  it('负成本不抛错，判不通过', () => {
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o1', -100)] };
    expectFail(verifyPlan(base(), plan), 'cost_accounting');
  });
});

describe('verifyPlan：措施合法 / 互斥 / 依赖', () => {
  it('选了 pending 措施（未 assume）', () => {
    const scenario = base({ interventions: [{ ...LOAN, status: 'pending' }] });
    const res = verifyPlan(scenario, GOOD);
    expectFail(res, 'approval');
    expect(check(res, 'approval').detail).toContain('pending');
  });

  it('选了不存在的措施、重复选中', () => {
    expectFail(verifyPlan(base(), { selected_intervention_ids: ['ghost'], allocations: [] }), 'approval');
    expectFail(verifyPlan(base(), { selected_intervention_ids: ['loan', 'loan'], allocations: [] }), 'approval');
  });

  it('互斥的两项同时被选（只有一方列出也算）', () => {
    const scenario = base({
      interventions: [LOAN, makeIntervention('buy', { mutually_exclusive_with: ['loan'] })],
    });
    const res = verifyPlan(scenario, { selected_intervention_ids: ['buy', 'loan'], allocations: [] });
    expectFail(res, 'mutual_exclusion');
    expect(check(res, 'mutual_exclusion').detail).toContain('buy');
  });

  it('前置依赖缺失', () => {
    const scenario = base({
      interventions: [{ ...LOAN, requires: ['support'] }, makeIntervention('support', { type: 'time_support', unit_cost_usd: 0 })],
    });
    const res = verifyPlan(scenario, GOOD);
    expectFail(res, 'prerequisite');
    expect(check(res, 'prerequisite').detail).toContain('support');
    // 选上依赖后通过（不要求依赖有分配）
    const ok = verifyPlan(scenario, { ...GOOD, selected_intervention_ids: ['loan', 'support'] });
    expect(check(ok, 'prerequisite').passed).toBe(true);
  });
});

describe('verifyPlan：分配合法', () => {
  it('分配引用了未选中的措施', () => {
    const plan: JointPlan = { selected_intervention_ids: [], allocations: [alloc('loan', 's1', 'o1', 100)] };
    expectFail(verifyPlan(base(), plan), 'allocation_validity');
  });

  it('分配引用了不存在的措施 / 学生 / 机会', () => {
    for (const a of [alloc('ghost', 's1', 'o1', 0), alloc('loan', 'nobody', 'o1', 100), alloc('loan', 's1', 'nowhere', 100)]) {
      const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [a] };
      const res = verifyPlan(base(), plan);
      expectFail(res, 'allocation_validity');
    }
  });

  it('措施的 opportunity_ids 不含该机会', () => {
    const scenario = base({ interventions: [{ ...LOAN, opportunity_ids: ['o2'] }] });
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o1', 100)] };
    const res = verifyPlan(scenario, plan);
    expectFail(res, 'allocation_validity');
    expect(check(res, 'allocation_validity').detail).toContain('opportunity_ids');
  });

  it('重复的 (i, s, o)', () => {
    const plan: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's1', 'o1', 0)],
    };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'allocation_validity');
    expect(check(res, 'allocation_validity').detail).toContain('重复');
  });
});

describe('verifyPlan：指标与交叉检查', () => {
  const R0 = [
    { student_id: 's3', opportunity_id: 'o1' },
    { student_id: 's3', opportunity_id: 'o2' },
  ];
  const R1 = [
    ...R0,
    { student_id: 's1', opportunity_id: 'o1' },
    { student_id: 's1', opportunity_id: 'o2' },
    { student_id: 's2', opportunity_id: 'o1' },
  ];
  const honest = { ...GOOD, R0, R1, G: 3, L: 0, N: 3, cost: { fixed_usd: 50, marginal_usd: 200, total_usd: 250 } };

  it('plan 自带的 R1 / G / L / N / cost 与重算不一致', () => {
    const variants = [
      { ...honest, G: 4 },
      { ...honest, L: 1 },
      { ...honest, N: 2 },
      { ...honest, R1: R1.slice(0, 4) },
      { ...honest, R1: [...R1, R1[0]] }, // 重复对
      { ...honest, R0: [] },
      { ...honest, cost: { fixed_usd: 50, marginal_usd: 200, total_usd: 260 } },
    ];
    for (const plan of variants) expectFail(verifyPlan(base(), plan), 'metrics');
  });

  it('资格不满足的学生被算进 R1（自带指标造假）', () => {
    const plan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'o1', 100), alloc('loan', 's4', 'o1', 100)],
      R0,
      R1: [...R0, { student_id: 's1', opportunity_id: 'o1' }, { student_id: 's4', opportunity_id: 'o1' }],
      G: 2,
      L: 0,
      N: 2,
      cost: { fixed_usd: 50, marginal_usd: 200, total_usd: 250 },
    };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'eligibility');
    expect(check(res, 'eligibility').detail).toContain('s4');
    expectFail(res, 'metrics');
  });

  it('截止日期早于评估日的机会被算进新增覆盖（自带指标造假）', () => {
    const plan = {
      selected_intervention_ids: ['loan'],
      allocations: [alloc('loan', 's1', 'opast', 100)],
      R0,
      R1: [...R0, { student_id: 's1', opportunity_id: 'opast' }],
      G: 1,
      L: 0,
      N: 1,
      cost: { fixed_usd: 50, marginal_usd: 100, total_usd: 150 },
    };
    const res = verifyPlan(base(), plan);
    expectFail(res, 'deadline');
    expect(check(res, 'deadline').detail).toContain('opast');
    expectFail(res, 'barrier_resolution'); // 已过截止的 time 障碍无法化解
    expectFail(res, 'metrics');
  });
});

/**
 * 构造 L > 0：s6 原本靠已有 time_support 5 小时补上每周缺口；分配一个 hours_per_week 为负的措施后缺口不再被化解。
 * 负的 hours_per_week 是**不合法输入**（契约第 6 条）：合法输入下 grant 只帮忙，L 恒为 0。
 * 这里仍用它来检验 coverage_loss 的判定逻辑——input_validity 不通过时其余检查照常给出。
 */
function lossCase(): { scenario: Scenario; plan: JointPlan } {
  const busy = makeStudent('s6', { devices: ['laptop'], hours_per_week_available: 0 });
  const scenario = makeScenario({
    students: [busy],
    opportunities: [O1],
    interventions: [makeIntervention('weird', { type: 'time_support', resolves: ['time'], hours_per_week: -5, unit_cost_usd: 0 })],
    existing_grants: [
      { id: 'e-time', student_id: 's6', opportunity_id: null, type: 'time_support', hours_per_week: 5, status: 'approved', provider: 'Example Org（虚构）', is_sample: true },
    ],
  });
  return { scenario, plan: { selected_intervention_ids: ['weird'], allocations: [alloc('weird', 's6', 'o1', 0)] } };
}

describe('verifyPlan：损失', () => {
  it('fixture 自检：s6 只带已有 grant 可达，加上负小时 grant 后不可达', () => {
    const { scenario } = lossCase();
    const g = scenario.existing_grants ?? [];
    expect(analyzeReachability(scenario.students[0], O1, g, TODAY).reachable).toBe(true);
  });

  it('负小时措施是不合法输入：input_validity 不通过', () => {
    const { scenario, plan } = lossCase();
    const res = verifyPlan(scenario, plan);
    expectFail(res, 'input_validity');
    expect(check(res, 'input_validity').detail).toContain('hours_per_week');
  });

  it('protect 模式下 L > 0（不合法输入下仍给出 coverage_loss 判定）', () => {
    const { scenario, plan } = lossCase();
    const res = verifyPlan(scenario, plan);
    expectFail(res, 'coverage_loss');
    expect(check(res, 'coverage_loss').detail).toContain('L = 1');
    expectFail(verifyPlan(scenario, plan, { mode: 'protect', loss_cap: 5 }), 'coverage_loss'); // protect 忽略 loss_cap
  });

  it('tradeoff 缺 loss_cap', () => {
    const res = verifyPlan(base(), GOOD, { mode: 'tradeoff' });
    expectFail(res, 'coverage_loss');
    expectFail(res, 'input_validity');
  });

  it('tradeoff 下 L > loss_cap', () => {
    const { scenario, plan } = lossCase();
    expectFail(verifyPlan(scenario, plan, { mode: 'tradeoff', loss_cap: 0 }), 'coverage_loss');
  });

  it('合法输入下 plan 自带 L > 0（造假）：metrics 不通过，coverage_loss 按重算的 L = 0 通过', () => {
    const plan = { ...GOOD, L: 1, N: 2, G: 3 };
    const res = verifyPlan(base(), plan);
    expect(check(res, 'input_validity').passed).toBe(true);
    expect(check(res, 'coverage_loss').passed).toBe(true);
    expectFail(res, 'metrics');
    expect(check(res, 'metrics').detail).toContain('L 自带 1');
  });
});

describe('verifyPlan：软要求', () => {
  it('required_intervention_ids 不满足', () => {
    const scenario = base({ interventions: [LOAN, makeIntervention('support', { type: 'time_support', unit_cost_usd: 0 })] });
    const res = verifyPlan(scenario, GOOD, { required_intervention_ids: ['support'] });
    expectFail(res, 'organizer_requirements');
    expect(check(res, 'organizer_requirements').detail).toContain('support');
  });

  it('min_gain 不满足', () => {
    const res = verifyPlan(base(), GOOD, { min_gain: 4 });
    expectFail(res, 'organizer_requirements');
    expect(check(res, 'organizer_requirements').detail).toContain('G = 3');
  });
});

describe('verifyPlan：输入不合法与畸形方案', () => {
  const cases: [string, Scenario, VerifyOptions?][] = [
    ['预算为负', base({ budget_usd: -1 })],
    ['预算非有限', base({ budget_usd: Number.POSITIVE_INFINITY })],
    ['评估日不合法', base({ evaluation_date: '2026-13-01' })],
    ['学生 id 重复', base({ students: [S1, S1] })],
    ['机会 id 重复', base({ opportunities: [O1, O1] })],
    ['措施 id 重复', base({ interventions: [LOAN, LOAN] })],
    ['requires 引用不存在', base({ interventions: [{ ...LOAN, requires: ['ghost'] }] })],
    ['requires 引用自己', base({ interventions: [{ ...LOAN, requires: ['loan'] }] })],
    ['互斥引用自己', base({ interventions: [{ ...LOAN, mutually_exclusive_with: ['loan'] }] })],
    ['opportunity_ids 引用不存在', base({ interventions: [{ ...LOAN, opportunity_ids: ['nowhere'] }] })],
    ['时段键引用不存在', base({ opportunity_time_slots: { nowhere: 'AM' } })],
    ['capacity 为负', base({ interventions: [{ ...LOAN, capacity: -1 }] })],
    ['unit_cost 为负', base({ interventions: [{ ...LOAN, unit_cost_usd: -1 }] })],
    ['fixed_cost 非有限', base({ interventions: [{ ...LOAN, fixed_cost_usd: Number.NaN }] })],
    ['loss_cap 为负', base(), { mode: 'tradeoff', loss_cap: -1 }],
    ['min_gain 非有限', base(), { min_gain: Number.NaN }],
    ['required 引用不存在', base(), { required_intervention_ids: ['ghost'] }],
    ['assume_approved 引用不存在', base(), { assume_approved_intervention_ids: ['ghost'] }],
    ['评估日前后有空格', base({ evaluation_date: ` ${EVAL_DATE} ` })],
    ['时段标签不是字符串', base({ opportunity_time_slots: { o1: 1 as unknown as string } })],
    ['时段标签为空字符串', base({ opportunity_time_slots: { o1: '' } })],
    ['时段表不是对象', base({ opportunity_time_slots: ['AM'] as unknown as Record<string, string> })],
    ['措施 amount_usd 为负', base({ interventions: [{ ...LOAN, amount_usd: -1 }] })],
    ['措施 hours_per_week 非有限', base({ interventions: [{ ...LOAN, hours_per_week: Number.NaN }] })],
    ['已有 grant 的 amount_usd 为负', base({ existing_grants: [laptopGrant('s5', null, { amount_usd: -10 })] })],
    ['已有 grant 不是对象', base({ existing_grants: [null as unknown as ResourceGrant] })],
    ['mode 不合法', base(), { mode: 'whatever' as 'protect' }],
  ];
  for (const [name, scenario, options] of cases) {
    it(`input_validity 不通过：${name}（其余检查照常给出）`, () => {
      const res = verifyPlan(scenario, GOOD, options);
      expectFail(res, 'input_validity');
      for (const n of ALL_CHECKS) expect(res.checks.some((c) => c.name === n)).toBe(true);
    });
  }

  it('null 视同未给：loss_cap / min_gain / required 为 null，措施 capacity 缺省（undefined）视同不限', () => {
    const res = verifyPlan(base(), GOOD, { loss_cap: null, min_gain: null, required_intervention_ids: null } as unknown as VerifyOptions);
    expect(failedNames(res)).toEqual([]);
    expect(res.checks.some((c) => c.name === 'organizer_requirements')).toBe(false);
    const unlimited = base({ interventions: [{ ...LOAN, capacity: undefined as unknown as null }] });
    expect(failedNames(verifyPlan(unlimited, GOOD))).toEqual([]);
  });

  it('pending 的已有 grant 占容量但不免成本', () => {
    const scenario = base({
      interventions: [{ ...LOAN, capacity: 1 }],
      existing_grants: [laptopGrant('s1', 'o1', { intervention_id: 'loan', status: 'pending' })],
    });
    // s1 已占名额 → 再分配给 s1 不超容量，但要记单价。
    const charged: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o1', 100)] };
    expect(failedNames(verifyPlan(scenario, charged))).toEqual([]);
    const free: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's1', 'o1', 0)] };
    expectFail(verifyPlan(scenario, free), 'cost_accounting');
    // 名额被 s1 占着：分给 s2 超容量。
    const other: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 's2', 'o1', 100)] };
    expectFail(verifyPlan(scenario, other), 'capacity');
  });

  it('畸形 plan 不抛异常，判不通过', () => {
    const weird: unknown[] = [
      null,
      undefined,
      {},
      { selected_intervention_ids: 'loan', allocations: {} },
      { selected_intervention_ids: [42, null], allocations: [null, 3, { intervention_id: 1 }] },
      { selected_intervention_ids: ['loan'], allocations: [{ intervention_id: 'loan', student_id: 's1', opportunity_id: 'o1', cost_usd: 'abc' }] },
      { ...GOOD, R1: 'x', G: 'three', cost: null },
      { ...GOOD, R1: [null, { student_id: 1 }] },
    ];
    for (const plan of weird) {
      let res: VerifyResult | undefined;
      expect(() => {
        res = verifyPlan(base(), plan as JointPlan);
      }).not.toThrow();
      expect(res?.passed).toBe(false);
    }
  });

  it('畸形 scenario 不抛异常', () => {
    for (const sc of [null, {}, { students: 'x', opportunities: null, interventions: [null] }]) {
      expect(() => verifyPlan(sc as unknown as Scenario, GOOD)).not.toThrow();
      expect(verifyPlan(sc as unknown as Scenario, GOOD).passed).toBe(false);
    }
  });
});

describe('verifyPlan：纯函数', () => {
  it('不修改输入，同输入同输出', () => {
    const scenario = base({ existing_grants: [laptopGrant('s5', null)] });
    const plan = { ...GOOD, allocations: [...GOOD.allocations].reverse() };
    const before = JSON.stringify([scenario, plan]);
    const a = verifyPlan(scenario, plan, { min_gain: 1 });
    const b = verifyPlan(scenario, plan, { min_gain: 1 });
    expect(JSON.stringify([scenario, plan])).toBe(before);
    expect(a).toEqual(b);
    expect(a.passed).toBe(true); // 分配顺序不影响复核
  });

  it('不读取学校名、显示名：只改这两个字段结果相同', () => {
    const s1b = { ...S1, school_name: 'Fictional Elite Academy', display_name: '另一个名字' };
    const a = verifyPlan(base(), GOOD);
    const b = verifyPlan(base({ students: [s1b, S2, S3, S4, S5] }), GOOD);
    expect(b).toEqual(a);
  });
});

describe('exhaustiveBest：小场景手算', () => {
  it('容量 2：最优 G = 2（s1、s2 或 s5 中两人；s4 资格不满足不算）', () => {
    const scenario = makeScenario({
      students: [S1, S2, S3, S4],
      opportunities: [O1],
      interventions: [{ ...LOAN, capacity: 2 }],
    });
    const r = exhaustiveBest(scenario);
    expect(r).toMatchObject({ feasible: true, N: 2, G: 2, L: 0, total_usd: 250, allocationCount: 2 });
  });

  it('预算只够固定成本：最优为空方案', () => {
    const scenario = makeScenario({ students: [S1], opportunities: [O1], interventions: [LOAN], budget_usd: 120 });
    expect(exhaustiveBest(scenario)).toMatchObject({ feasible: true, N: 0, total_usd: 0, allocationCount: 0 });
  });

  it('min_gain 达不到 → 不可行；去掉后可行', () => {
    const scenario = makeScenario({ students: [S1], opportunities: [O1], interventions: [LOAN] });
    expect(exhaustiveBest(scenario, { min_gain: 2 }).feasible).toBe(false);
    expect(exhaustiveBest(scenario, { min_gain: 1 })).toMatchObject({ feasible: true, N: 1, total_usd: 150 });
  });

  it('输入不合法 → 不可行', () => {
    const scenario = makeScenario({ students: [S1], opportunities: [O1], interventions: [LOAN], budget_usd: -5 });
    expect(exhaustiveBest(scenario).feasible).toBe(false);
  });
});

/** 不剪枝的暴力枚举（只用于极小场景），用来确认 exhaustiveBest 的剪枝不改变最优指标。 */
function bruteNoPrune(scenario: Scenario, options: VerifyOptions = {}) {
  const ints = scenario.interventions.map((i) => i.id);
  const pairs = scenario.students.flatMap((s) => scenario.opportunities.map((o) => [s.id, o.id] as const));
  let best: { N: number; total: number; count: number; selected: number } | null = null;
  for (let mask = 0; mask < 1 << ints.length; mask++) {
    const selected = ints.filter((_, k) => mask & (1 << k));
    const per = 1 << selected.length;
    const total = per ** pairs.length;
    for (let code = 0; code < total; code++) {
      let c = code;
      const raw: Allocation[] = [];
      for (const [s, o] of pairs) {
        const m = c % per;
        c = Math.floor(c / per);
        selected.forEach((id, k) => {
          if (m & (1 << k)) raw.push(alloc(id, s, o, 0));
        });
      }
      raw.sort((a, b) =>
        a.intervention_id < b.intervention_id ? -1 : a.intervention_id > b.intervention_id ? 1 :
        a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 :
        a.opportunity_id < b.opportunity_id ? -1 : a.opportunity_id > b.opportunity_id ? 1 : 0,
      );
      const charged = new Set<string>();
      for (const a of raw) {
        const k = a.intervention_id + '|' + a.student_id;
        if (charged.has(k)) continue;
        charged.add(k);
        const covered = (scenario.existing_grants ?? []).some(
          (g) => g.intervention_id === a.intervention_id && g.student_id === a.student_id && g.status === 'approved',
        );
        a.cost_usd = covered ? 0 : (scenario.interventions.find((i) => i.id === a.intervention_id)?.unit_cost_usd ?? 0);
      }
      const plan = { selected_intervention_ids: selected, allocations: raw };
      const res = verifyPlan(scenario, plan, options);
      if (!res.passed) continue;
      const m = check(res, 'metrics').detail;
      const N = Number(/N = (-?\d+)/.exec(m)?.[1]);
      const cost = Number(/成本 \$([\d.]+)/.exec(m)?.[1]);
      const cand = { N, total: cost, count: raw.length, selected: selected.length };
      const tieCost = best !== null && Math.abs(cand.total - best.total) <= 1e-6;
      if (
        !best ||
        cand.N > best.N ||
        (cand.N === best.N &&
          (cand.total < best.total - 1e-6 ||
            (tieCost && (cand.count < best.count || (cand.count === best.count && cand.selected < best.selected)))))
      ) {
        best = cand;
      }
    }
  }
  return best;
}

describe('exhaustiveBest：剪枝不改变最优指标（对照不剪枝的暴力枚举）', () => {
  const tiny: [string, Scenario, VerifyOptions?][] = [
    [
      '两人两措施（设备 + 交通）、线下机会',
      makeScenario({
        students: [makeStudent('a', { transport: { level: 'none' } }), makeStudent('b')],
        opportunities: [makeOpp('in', { location: { format: 'in_person', country: 'US', state: 'CA' } })],
        interventions: [
          makeIntervention('lap', { unit_cost_usd: 60, capacity: 1 }),
          makeIntervention('bus', { type: 'transport_subsidy', resolves: ['transport'], amount_usd: 20, unit_cost_usd: 20, device: null }),
        ],
        budget_usd: 200,
      }),
    ],
    [
      '一人两机会、existing grant、per_time_slot',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1, O2],
        interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
        opportunity_time_slots: { o1: 'AM' },
        existing_grants: [laptopGrant('s2', 'o2', { intervention_id: 'loan' })],
      }),
    ],
    ['不合法输入（负小时措施）：两边都不可行', lossCase().scenario, { mode: 'tradeoff', loss_cap: 1 }],
    [
      'tradeoff 模式 + pending 的已有 grant（占容量、不免成本）',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1],
        interventions: [{ ...LOAN, capacity: 2 }, makeIntervention('free', { type: 'time_support', resolves: ['time'], hours_per_week: 0, unit_cost_usd: 0, device: null })],
        existing_grants: [laptopGrant('s1', null, { intervention_id: 'loan', status: 'pending' })],
      }),
      { mode: 'tradeoff', loss_cap: 1 },
    ],
    [
      'min_gain + required',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1],
        interventions: [LOAN, makeIntervention('alt', { unit_cost_usd: 30, mutually_exclusive_with: ['loan'] })],
        budget_usd: 300,
      }),
      { min_gain: 2, required_intervention_ids: ['loan'] },
    ],
  ];
  for (const [name, scenario, options] of tiny) {
    it(name, () => {
      const brute = bruteNoPrune(scenario, options ?? {});
      const ex = exhaustiveBest(scenario, options ?? {});
      if (!brute) expect(ex.feasible).toBe(false);
      else expect({ N: ex.N, total: ex.total_usd, count: ex.allocationCount, selected: ex.selectedCount }).toEqual(brute);
    });
  }
});

describe('独立性守卫', () => {
  for (const file of ['./verify.ts', './exhaustive.ts']) {
    it(`${file} 不 import 求解器 / index / scenarios`, () => {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      const specifiers = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const spec of specifiers) {
        expect(spec).not.toMatch(/^\.\/(solve|index|scenarios)(\.ts)?$/);
        expect(spec).not.toMatch(/^\.\/?$|^\.\.\/joint|^@\/lib\/joint(\/(solve|index|scenarios))?$/);
      }
      expect(specifiers.every((s) => ['../types', '../reachability', '../eligibility', '../eligibility/dates', '../format', './verify'].includes(s))).toBe(true);
    });
  }
});
