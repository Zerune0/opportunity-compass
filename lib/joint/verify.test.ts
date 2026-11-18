import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { analyzeReachability } from '../reachability';
import type {
  Allocation,
  FairnessFloor,
  FairnessReport,
  JointPlan,
  ResourceGrant,
  Scenario,
  StudentStatus,
  VerifyOptions,
  VerifyResult,
} from '../types';
import { exhaustiveBest, naiveBest } from './exhaustive';
import { EVAL_DATE, makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { createJointEvaluator, verifyAndMeasure, verifyPlan } from './verify';

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
  if (!c) throw new Error(`missing check ${name}`);
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
  provider: 'Example Org (fictional)',
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
  'revocation',
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
    expect(check(res, 'metrics').detail).toContain('The plan carries no metrics; recomputed only');
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
    expect(check(res, 'capacity').detail).toContain('the default time slot');
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
    expect(check(res, 'allocation_validity').detail).toContain('Duplicate allocation');
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
      { id: 'e-time', student_id: 's6', opportunity_id: null, type: 'time_support', hours_per_week: 5, status: 'approved', provider: 'Example Org (fictional)', is_sample: true },
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
    expect(check(res, 'metrics').detail).toContain('L reported 1');
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
    ['negative budget', base({ budget_usd: -1 })],
    ['budget not finite', base({ budget_usd: Number.POSITIVE_INFINITY })],
    ['invalid evaluation date', base({ evaluation_date: '2026-13-01' })],
    ['duplicate student id', base({ students: [S1, S1] })],
    ['duplicate opportunity id', base({ opportunities: [O1, O1] })],
    ['duplicate support measure id', base({ interventions: [LOAN, LOAN] })],
    ['requires references a missing measure', base({ interventions: [{ ...LOAN, requires: ['ghost'] }] })],
    ['requires references itself', base({ interventions: [{ ...LOAN, requires: ['loan'] }] })],
    ['mutual exclusion references itself', base({ interventions: [{ ...LOAN, mutually_exclusive_with: ['loan'] }] })],
    ['opportunity_ids references a missing opportunity', base({ interventions: [{ ...LOAN, opportunity_ids: ['nowhere'] }] })],
    ['time slot key references a missing opportunity', base({ opportunity_time_slots: { nowhere: 'AM' } })],
    ['negative capacity', base({ interventions: [{ ...LOAN, capacity: -1 }] })],
    ['negative unit_cost', base({ interventions: [{ ...LOAN, unit_cost_usd: -1 }] })],
    ['fixed_cost not finite', base({ interventions: [{ ...LOAN, fixed_cost_usd: Number.NaN }] })],
    ['negative loss_cap', base(), { mode: 'tradeoff', loss_cap: -1 }],
    ['min_gain not finite', base(), { min_gain: Number.NaN }],
    ['required references a missing measure', base(), { required_intervention_ids: ['ghost'] }],
    ['assume_approved references a missing measure', base(), { assume_approved_intervention_ids: ['ghost'] }],
    ['evaluation date with surrounding spaces', base({ evaluation_date: ` ${EVAL_DATE} ` })],
    ['time slot label not a string', base({ opportunity_time_slots: { o1: 1 as unknown as string } })],
    ['time slot label is an empty string', base({ opportunity_time_slots: { o1: '' } })],
    ['time slot map is not an object', base({ opportunity_time_slots: ['AM'] as unknown as Record<string, string> })],
    ['measure amount_usd negative', base({ interventions: [{ ...LOAN, amount_usd: -1 }] })],
    ['measure hours_per_week not finite', base({ interventions: [{ ...LOAN, hours_per_week: Number.NaN }] })],
    ['existing grant amount_usd negative', base({ existing_grants: [laptopGrant('s5', null, { amount_usd: -10 })] })],
    ['existing grant is not an object', base({ existing_grants: [null as unknown as ResourceGrant] })],
    ['invalid mode', base(), { mode: 'whatever' as 'protect' }],
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
    const s1b = { ...S1, school_name: 'Fictional Elite Academy', display_name: 'Another name' };
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

/**
 * 不剪枝的暴力枚举（只用于极小场景），用来确认 exhaustiveBest 的剪枝不改变前六级最优指标。
 * 同时枚举可撤回 grant（intervention_id 指向场景内措施）的所有子集；免成本只认未撤回的 approved grant。
 */
function bruteNoPrune(scenario: Scenario, options: VerifyOptions = {}) {
  const ints = scenario.interventions.map((i) => i.id);
  const pairs = scenario.students.flatMap((s) => scenario.opportunities.map((o) => [s.id, o.id] as const));
  // 规则 R1：可撤回 = 措施在场景内、且学生在场景内。
  const stuIds = scenario.students.map((s) => s.id);
  const revocable = (scenario.existing_grants ?? [])
    .filter((g) => typeof g.intervention_id === 'string' && ints.includes(g.intervention_id) && stuIds.includes(g.student_id))
    .map((g) => g.id)
    .sort();
  const ev = createJointEvaluator(scenario);
  let best: { N: number; L: number; total: number; count: number; selected: number; revoked: number } | null = null;
  for (let rmask = 0; rmask < 1 << revocable.length; rmask++) {
    const revoked = revocable.filter((_, k) => rmask & (1 << k));
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
            (g) => g.intervention_id === a.intervention_id && g.student_id === a.student_id && g.status === 'approved' && !revoked.includes(g.id),
          );
          a.cost_usd = covered ? 0 : (scenario.interventions.find((i) => i.id === a.intervention_id)?.unit_cost_usd ?? 0);
        }
        const plan = { selected_intervention_ids: selected, allocations: raw, revoked_grant_ids: revoked };
        const { result, metrics } = verifyAndMeasure(ev, plan, options);
        if (!result.passed) continue;
        const cand = { N: metrics.N, L: metrics.L, total: metrics.total_usd, count: raw.length, selected: selected.length, revoked: revoked.length };
        const key = (x: typeof cand) => [-x.N, x.L, Math.round(x.total * 1e6), x.count, x.selected, x.revoked];
        const better = (a: number[], b: number[]) => {
          for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
          return false;
        };
        if (!best || better(key(cand), key(best))) best = cand;
      }
    }
  }
  return best;
}

describe('exhaustiveBest：剪枝不改变最优指标（对照不剪枝的暴力枚举）', () => {
  const tiny: [string, Scenario, VerifyOptions?][] = [
    [
      'two students, two measures (device + transport), in-person opportunity',
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
      'one student, two opportunities, existing grant, per_time_slot',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1, O2],
        interventions: [{ ...LOAN, capacity: 1, capacity_scope: 'per_time_slot' }],
        opportunity_time_slots: { o1: 'AM' },
        existing_grants: [laptopGrant('s2', 'o2', { intervention_id: 'loan' })],
      }),
    ],
    ['invalid input (negative-hours measure): infeasible on both sides', lossCase().scenario, { mode: 'tradeoff', loss_cap: 1 }],
    [
      'tradeoff mode + pending existing grant (uses capacity, not free)',
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
      else {
        expect(ex.feasible).toBe(true);
        expect({ N: ex.N, L: ex.L, total: ex.total_usd, count: ex.allocationCount, selected: ex.selectedCount, revoked: ex.revokedCount }).toEqual(brute);
      }
    });
  }
});

// ───────────────────────────── 第 3 层：撤回已有 grant ─────────────────────────────

/**
 * 撤回场景（虚构）：s1 已经通过措施 old 借到笔记本（e-old，对所有机会有效），因此 (s1, o1) ∈ R0。
 * old 容量 1（已被 s1 占满）、单价 100；new 单价 60、容量 2，与 old 互斥。
 */
const OLD = makeIntervention('old', { unit_cost_usd: 100, capacity: 1 });
const NEW = makeIntervention('new', { unit_cost_usd: 60, capacity: 2, mutually_exclusive_with: ['old'] });
const E_OLD = laptopGrant('s1', null, { id: 'e-old', intervention_id: 'old' });
const TRADE0: VerifyOptions = { mode: 'tradeoff', loss_cap: 0 };
const TRADE1: VerifyOptions = { mode: 'tradeoff', loss_cap: 1 };

function rev(overrides: Partial<Scenario> = {}): Scenario {
  return makeScenario({
    students: [S1, S2],
    opportunities: [O1],
    interventions: [OLD, NEW],
    existing_grants: [E_OLD],
    budget_usd: 1000,
    ...overrides,
  });
}

/** 换用 new：强制撤回 e-old，并由 new 给 s1 补位、同时给 s2。L = 0，G = 1，成本 120。 */
const SWAP: JointPlan = {
  selected_intervention_ids: ['new'],
  allocations: [alloc('new', 's1', 'o1', 60), alloc('new', 's2', 'o1', 60)],
  revoked_grant_ids: ['e-old'],
};
const P = (s: string, o: string) => ({ student_id: s, opportunity_id: o });

describe('verifyPlan：撤回（第 3 条第 8 款）', () => {
  it('fixture 自检：R0 = {(s1, o1)}，e-old 是可撤回的', () => {
    const m = verifyAndMeasure(createJointEvaluator(rev()), { selected_intervention_ids: [], allocations: [] }).metrics;
    expect(m.R0).toEqual([P('s1', 'o1')]);
    expect(createJointEvaluator(rev()).norm.revocable.map((g) => g.id)).toEqual(['e-old']);
  });

  it('tradeoff：强制撤回 + 由另一措施补位，全部通过；R0 仍按全部已有 grant', () => {
    const r = verifyAndMeasure(createJointEvaluator(rev()), SWAP, TRADE0);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics).toMatchObject({ G: 1, L: 0, N: 1, total_usd: 120, lost_pairs: [], revoked_grant_ids: ['e-old'] });
    expect(r.metrics.R0).toEqual([P('s1', 'o1')]);
    expect(r.metrics.revocations).toEqual([{ grant_id: 'e-old', intervention_id: 'old', student_id: 's1', forced_by: 'new' }]);
    expect(check(r.result, 'revocation').detail).toContain('1 forced');
  });

  it('protect 模式（缺省或显式）下任何撤回都不通过：强制撤回也不行', () => {
    for (const o of [undefined, { mode: 'protect' as const }, { mode: 'protect' as const, loss_cap: 5 }]) {
      const res = verifyPlan(rev(), SWAP, o);
      expect(failedNames(res)).toEqual(['revocation']);
      expect(check(res, 'revocation').detail).toContain('protect');
    }
  });

  it('protect 模式下选与已有 grant 所属措施互斥的措施：不撤回违反强制撤回，撤回又不被允许', () => {
    const noRevoke: JointPlan = { selected_intervention_ids: ['new'], allocations: [alloc('new', 's2', 'o1', 60)] };
    expectFail(verifyPlan(rev(), noRevoke), 'revocation');
    expectFail(verifyPlan(rev(), { ...noRevoke, revoked_grant_ids: ['e-old'] }), 'revocation');
  });

  it('缺少强制撤回：detail 写明该撤回的 grant', () => {
    const plan: JointPlan = { selected_intervention_ids: ['new'], allocations: [alloc('new', 's2', 'o1', 60)], revoked_grant_ids: [] };
    const res = verifyPlan(rev(), plan, TRADE0);
    expect(failedNames(res)).toEqual(['revocation']);
    expect(check(res, 'revocation').detail).toContain('e-old');
    expect(check(res, 'revocation').detail).toContain('new');
  });

  describe('规则 R1：场景外学生的已有 grant 不可撤回', () => {
    // old 容量 2：e-old（s1，场景内，可撤回）+ e-out（outsider，场景外，不可撤回）。
    const withOutsider = (status: 'approved' | 'pending' = 'pending') =>
      rev({
        interventions: [{ ...OLD, capacity: 2 }, NEW],
        existing_grants: [E_OLD, laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old', status })],
      });

    it('fixture 自检：可撤回的只有 e-old，e-out 被锁定', () => {
      const norm = createJointEvaluator(withOutsider()).norm;
      expect(norm.revocable.map((g) => g.id)).toEqual(['e-old']);
      expect(norm.locked.map((g) => g.id)).toEqual(['e-out']);
    });

    it('撤回场景外学生的 grant → revocation 不通过（approved 与 pending、两种模式都一样），detail 写明原因', () => {
      for (const status of ['approved', 'pending'] as const) {
        const scenario = withOutsider(status);
        const plan: JointPlan = { selected_intervention_ids: [], allocations: [], revoked_grant_ids: ['e-out'] };
        for (const o of [TRADE0, TRADE1, undefined]) {
          const res = verifyPlan(scenario, plan, o);
          expect(check(res, 'input_validity').passed).toBe(true);
          expectFail(res, 'revocation');
          expect(check(res, 'revocation').detail).toContain('e-out');
          expect(check(res, 'revocation').detail).toContain('outside the scenario');
        }
        // 重算时 X 不含 e-out：它照样占容量 → 撤回列表虽非法，R1 不变（L = 0）
        const m = verifyAndMeasure(createJointEvaluator(scenario), plan, TRADE1).metrics;
        expect(m.revoked_grant_ids).toEqual([]);
        expect(m.L).toBe(0);
      }
    });

    it('选中与锁定措施互斥的措施 → mutual_exclusion 不通过（protect 与 tradeoff 都是），即使撤回了全部可撤回的 grant', () => {
      const scenario = withOutsider();
      for (const o of [undefined, { mode: 'protect' as const }, TRADE0, TRADE1, { mode: 'tradeoff' as const, loss_cap: 5 }]) {
        const res = verifyPlan(scenario, SWAP, o);
        expectFail(res, 'mutual_exclusion');
        const d = check(res, 'mutual_exclusion').detail;
        expect(d).toContain('"new"');
        expect(d).toContain('"old"');
        expect(d).toContain('e-out');
        expect(d).toContain('non-revocable');
        // 强制撤回只针对可撤回的 grant：tradeoff 下撤回 e-old 就满足 revocation，不要求（也不允许）撤回 e-out
        if (o?.mode === 'tradeoff') expect(failedNames(res)).toEqual(['mutual_exclusion']);
      }
      // 再加上撤回 e-out：revocation 也不通过（不可撤回），mutual_exclusion 照样不通过
      const both = verifyPlan(scenario, { ...SWAP, revoked_grant_ids: ['e-old', 'e-out'] }, TRADE0);
      expect(failedNames(both)).toEqual(['mutual_exclusion', 'revocation']);
      // 互斥只由一方列出也算：把互斥写在 old 上
      const reversed = rev({
        interventions: [{ ...OLD, capacity: 2, mutually_exclusive_with: ['new'] }, { ...NEW, mutually_exclusive_with: undefined }],
        existing_grants: [laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old' })],
      });
      expectFail(verifyPlan(reversed, { selected_intervention_ids: ['new'], allocations: [alloc('new', 's1', 'o1', 60)] }, TRADE1), 'mutual_exclusion');
    });

    it('对照：没有场景外 grant 时同一方案（tradeoff）全部通过；锁定措施本身仍可选', () => {
      expect(failedNames(verifyPlan(rev({ interventions: [{ ...OLD, capacity: 2 }, NEW] }), SWAP, TRADE0))).toEqual([]);
      // 选 old 本身不受影响（不与自己互斥）：给 s2 分配 old
      const plan: JointPlan = { selected_intervention_ids: ['old'], allocations: [alloc('old', 's2', 'o1', 100)] };
      const scenario = rev({
        interventions: [{ ...OLD, capacity: 3 }, NEW],
        existing_grants: [E_OLD, laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old', status: 'pending' })],
      });
      expect(failedNames(verifyPlan(scenario, plan))).toEqual([]);
    });

    it('不可撤回的 grant 仍占容量', () => {
      // old 容量 2：s1（e-old）+ outsider（e-out）已占满；再给 s2 分配 old 超容量
      const scenario = withOutsider('approved');
      const plan: JointPlan = { selected_intervention_ids: ['old'], allocations: [alloc('old', 's2', 'o1', 100)] };
      expectFail(verifyPlan(scenario, plan), 'capacity');
      expect(check(verifyPlan(scenario, plan), 'capacity').detail).toContain('outsider');
      // tradeoff 下自愿撤回 e-old（可撤回）能腾出 1 个名额 → 通过（L = 1 ≤ 1）；撤回 e-out 不行
      expect(failedNames(verifyPlan(scenario, { ...plan, revoked_grant_ids: ['e-old'] }, TRADE1))).toEqual([]);
      expect(failedNames(verifyPlan(scenario, { ...plan, revoked_grant_ids: ['e-out'] }, TRADE1))).toEqual(['revocation', 'capacity']);
    });

    it('不可撤回的 approved grant 仍让 (措施, 学生) 免成本；pending 的不免（记账口径不因锁定改变）', () => {
      // outsider 不在场景内，给他分配本身违反 allocation_validity；这里只看 cost_accounting 的记账口径。
      const toOutsider = (cost: number): JointPlan => ({ selected_intervention_ids: ['old'], allocations: [alloc('old', 'outsider', 'o1', cost)] });
      const approved = withOutsider('approved');
      expect(failedNames(verifyPlan(approved, toOutsider(0)))).toEqual(['allocation_validity']);
      expectFail(verifyPlan(approved, toOutsider(100)), 'cost_accounting');
      const pending = withOutsider('pending');
      expect(check(verifyPlan(pending, toOutsider(100)), 'cost_accounting').passed).toBe(true);
      expectFail(verifyPlan(pending, toOutsider(0)), 'cost_accounting');
      // 容量预检同样计入锁定的 grant
      const over = rev({
        interventions: [{ ...OLD, capacity: 1 }, NEW],
        existing_grants: [
          laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old' }),
          laptopGrant('outsider2', null, { id: 'e-out2', intervention_id: 'old' }),
        ],
      });
      expectFail(verifyPlan(over, { selected_intervention_ids: [], allocations: [] }), 'input_validity');
    });
  });

  it('撤回列表不合法：不存在的 id、重复、不可撤回、非字符串、不是数组', () => {
    const scenario = rev({
      existing_grants: [
        E_OLD,
        laptopGrant('s5', null, { id: 'e-free' }), // 无 intervention_id：不可撤回
        laptopGrant('s5', 'o2', { id: 'e-gone', intervention_id: 'gone' }), // 指向场景外：不可撤回
      ],
    });
    const empty = { selected_intervention_ids: [], allocations: [] };
    const bad: [unknown, string][] = [
      [['ghost'], 'ghost'],
      [['e-old', 'e-old'], 'Revoked more than once'],
      [['e-free'], 'cannot be revoked'],
      [['e-gone'], 'cannot be revoked'],
      [[42], 'is not a string'],
      ['e-old', 'is not an array'],
    ];
    for (const [ids, text] of bad) {
      const res = verifyPlan(scenario, { ...empty, revoked_grant_ids: ids as string[] }, TRADE1);
      expect(check(res, 'input_validity').passed).toBe(true); // 方案的撤回列表不合法不触发 UNSUPPORTED_INPUT
      expectFail(res, 'revocation');
      expect(check(res, 'revocation').detail).toContain(text);
    }
    // null / 缺省 = 不撤回
    expect(failedNames(verifyPlan(scenario, { ...empty, revoked_grant_ids: null as unknown as string[] }, TRADE1))).toEqual([]);
    expect(failedNames(verifyPlan(scenario, empty, TRADE1))).toEqual([]);
  });

  it('重算时 X 只取合法部分：非法 id 不影响 R1，合法的 e-old 照样生效（L = 1）', () => {
    const ev = createJointEvaluator(rev());
    const r = verifyAndMeasure(ev, { selected_intervention_ids: [], allocations: [], revoked_grant_ids: ['ghost', 'e-old', 'e-old'] }, TRADE1);
    expectFail(r.result, 'revocation');
    expect(r.metrics).toMatchObject({ L: 1, G: 0, N: -1, revoked_grant_ids: ['e-old'], lost_pairs: [P('s1', 'o1')] });
    expect(r.metrics.revocations).toEqual([{ grant_id: 'e-old', intervention_id: 'old', student_id: 's1', forced_by: null }]);
  });

  it('撤回后又给同一 (措施, 学生) 分配：revocation 不通过；且该学生不再免成本', () => {
    const scenario = rev({ interventions: [{ ...OLD, capacity: 2 }, NEW] });
    const reissueFree: JointPlan = { selected_intervention_ids: ['old'], allocations: [alloc('old', 's1', 'o1', 0)], revoked_grant_ids: ['e-old'] };
    const r1 = verifyPlan(scenario, reissueFree, TRADE1);
    expectFail(r1, 'revocation');
    expect(check(r1, 'revocation').detail).toContain('(old, s1)');
    expectFail(r1, 'cost_accounting'); // 被撤回的 grant 不再免成本
    const reissuePaid = { ...reissueFree, allocations: [alloc('old', 's1', 'o1', 100)] };
    const r2 = verifyPlan(scenario, reissuePaid, TRADE1);
    expect(failedNames(r2)).toEqual(['revocation']);
    // 对照：不撤回时 (old, s1) 记 0 是对的
    expect(failedNames(verifyPlan(scenario, { ...reissueFree, revoked_grant_ids: [] }))).toEqual([]);
  });

  it('自愿撤回腾出名额：撤回后新分配不超容量；不撤回则超容量', () => {
    const plan: JointPlan = { selected_intervention_ids: ['old'], allocations: [alloc('old', 's2', 'o1', 100)], revoked_grant_ids: ['e-old'] };
    const r = verifyAndMeasure(createJointEvaluator(rev()), plan, TRADE1);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics).toMatchObject({ G: 1, L: 1, N: 0, lost_pairs: [P('s1', 'o1')] });
    expect(r.metrics.revocations[0].forced_by).toBeNull();
    expect(check(r.result, 'revocation').detail).toContain('1 voluntary');
    expectFail(verifyPlan(rev(), { ...plan, revoked_grant_ids: [] }, TRADE1), 'capacity');
  });

  it('tradeoff 下 L 超过 / 等于 / 低于 loss_cap', () => {
    const plan: JointPlan = { selected_intervention_ids: ['new'], allocations: [alloc('new', 's2', 'o1', 60)], revoked_grant_ids: ['e-old'] };
    expect(failedNames(verifyPlan(rev(), plan, { mode: 'tradeoff', loss_cap: 0 }))).toEqual(['coverage_loss']);
    expect(failedNames(verifyPlan(rev(), plan, { mode: 'tradeoff', loss_cap: 1 }))).toEqual([]);
    expect(failedNames(verifyPlan(rev(), plan, { mode: 'tradeoff', loss_cap: 2 }))).toEqual([]);
    expect(check(verifyPlan(rev(), plan, { mode: 'tradeoff', loss_cap: 0 }), 'coverage_loss').detail).toContain('(s1, o1)');
  });

  it('撤回 pending 的已有 grant：不产生损失、腾出容量、照样列入 revocations', () => {
    const scenario = makeScenario({
      students: [S1, S2, S5],
      opportunities: [O1],
      interventions: [OLD],
      existing_grants: [laptopGrant('s2', null, { id: 'e-pend', intervention_id: 'old', status: 'pending' })],
    });
    const plan: JointPlan = { selected_intervention_ids: ['old'], allocations: [alloc('old', 's1', 'o1', 100)], revoked_grant_ids: ['e-pend'] };
    const r = verifyAndMeasure(createJointEvaluator(scenario), plan, TRADE0);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics).toMatchObject({ G: 1, L: 0, lost_pairs: [] });
    expect(r.metrics.revocations).toEqual([{ grant_id: 'e-pend', intervention_id: 'old', student_id: 's2', forced_by: null }]);
    expectFail(verifyPlan(scenario, { ...plan, revoked_grant_ids: [] }, TRADE0), 'capacity');
    expect(failedNames(verifyPlan(scenario, plan))).toEqual(['revocation']); // protect 下 pending 也不能撤回
    // 撤回了 (old, s2) 的 pending grant 后也不能再给 s2 分配 old
    expectFail(verifyPlan(scenario, { ...plan, allocations: [alloc('old', 's2', 'o1', 100)] }, TRADE0), 'revocation');
  });

  it('existing grant 的 id 不是字符串或重复 → input_validity 不通过', () => {
    for (const eg of [
      [E_OLD, { ...E_OLD, student_id: 's2' }],
      [{ ...E_OLD, id: 7 as unknown as string }],
    ]) {
      const res = verifyPlan(rev({ existing_grants: eg, interventions: [{ ...OLD, capacity: 3 }, NEW] }), { selected_intervention_ids: [], allocations: [] });
      expectFail(res, 'input_validity');
      expect(check(res, 'input_validity').detail).toContain('id');
    }
  });

  it('容量预检按全部已有 grant（不考虑撤回）', () => {
    const scenario = rev({ existing_grants: [E_OLD, laptopGrant('s2', null, { id: 'e-2', intervention_id: 'old' })] });
    const res = verifyPlan(scenario, { selected_intervention_ids: [], allocations: [], revoked_grant_ids: ['e-2'] }, TRADE1);
    expectFail(res, 'input_validity');
  });

  describe('plan 自带的 lost_pairs / revocations 造假', () => {
    const lossPlan: JointPlan = { selected_intervention_ids: ['new'], allocations: [alloc('new', 's2', 'o1', 60)], revoked_grant_ids: ['e-old'] };
    const honest = {
      ...lossPlan,
      R0: [P('s1', 'o1')],
      R1: [P('s2', 'o1')],
      G: 1,
      L: 1,
      N: 0,
      cost: { fixed_usd: 0, marginal_usd: 60, total_usd: 60 },
      lost_pairs: [P('s1', 'o1')],
      revocations: [{ grant_id: 'e-old', intervention_id: 'old', student_id: 's1', forced_by: 'new' }],
    };
    it('诚实的指标通过', () => {
      expect(failedNames(verifyPlan(rev(), honest, TRADE1))).toEqual([]);
    });
    const variants: [string, unknown][] = [
      ['lost_pairs empty', { ...honest, lost_pairs: [] }],
      ['lost_pairs has an extra pair', { ...honest, lost_pairs: [P('s1', 'o1'), P('s2', 'o1')] }],
      ['lost_pairs duplicated', { ...honest, lost_pairs: [P('s1', 'o1'), P('s1', 'o1')] }],
      ['lost_pairs not an array', { ...honest, lost_pairs: 'x' }],
      ['revocations empty', { ...honest, revocations: [] }],
      ['forced_by written as null', { ...honest, revocations: [{ ...honest.revocations[0], forced_by: null }] }],
      ['forced_by missing', { ...honest, revocations: [{ grant_id: 'e-old', intervention_id: 'old', student_id: 's1' }] }],
      ['wrong student_id', { ...honest, revocations: [{ ...honest.revocations[0], student_id: 's2' }] }],
      ['one extra entry', { ...honest, revocations: [...honest.revocations, { grant_id: 'e-x', intervention_id: 'old', student_id: 's2', forced_by: null }] }],
      ['duplicate grant_id', { ...honest, revocations: [honest.revocations[0], honest.revocations[0]] }],
      ['R1 still counts the student whose grant was revoked', { ...honest, R1: [P('s1', 'o1'), P('s2', 'o1')], L: 0, N: 1, lost_pairs: [] }],
    ];
    for (const [name, plan] of variants) {
      it(name, () => {
        const res = verifyPlan(rev(), plan as JointPlan, TRADE1);
        expectFail(res, 'metrics');
      });
    }
  });
});

// ───────────────────────────── 第 3 层：公平底线 ─────────────────────────────

const F1 = makeStudent('f1', { statuses: ['high_school_student', 'low_income'] });
const F2 = makeStudent('f2', { statuses: ['low_income', 'first_generation'] });
const F3 = makeStudent('f3', { statuses: null, devices: ['laptop'] }); // 没填 statuses：不属于任何群体（本来可达）
const F4 = makeStudent('f4', { grade: 7, statuses: ['low_income'] }); // 资格不符：不计入分母
const F5 = makeStudent('f5', { statuses: ['first_generation'], devices: ['laptop'] }); // 本来可达

const floor = (id: string, statuses: StudentStatus[], min_ratio: number): FairnessFloor => ({
  id,
  label: `Sample group ${id}`,
  basis: 'Fictional grouping basis (sample)',
  statuses_any_of: statuses,
  min_ratio,
});
const LOW = floor('low', ['low_income'], 0.5);
const FG = floor('fg', ['first_generation'], 1);
const UG = floor('ug', ['undergraduate'], 1);
const HS = floor('hs', ['high_school_student'], 1);

function fair(overrides: Partial<Scenario> = {}): Scenario {
  return makeScenario({ students: [F1, F2, F3, F4, F5], opportunities: [O1], interventions: [LOAN], budget_usd: 1000, ...overrides });
}
const EMPTY: JointPlan = { selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] };
const TO = (s: string): JointPlan => ({ selected_intervention_ids: ['loan'], allocations: [alloc('loan', s, 'o1', 100)], revoked_grant_ids: [] });

function fairnessOf(scenario: Scenario, plan: JointPlan, floors: FairnessFloor[]) {
  return verifyAndMeasure(createJointEvaluator(scenario), plan, { fairness_floors: floors });
}

describe('verifyPlan：公平底线（第 4 条）', () => {
  it('不达标：空方案下低收入群体 0/2（f4 资格不符不计入分母）', () => {
    const r = fairnessOf(fair(), EMPTY, [LOW]);
    expect(failedNames(r.result)).toEqual(['fairness']);
    expect(r.metrics.fairness).toEqual([{ floor_id: 'low', eligible_members: 2, covered_members: 0, ratio: 0, min_ratio: 0.5, satisfied: false }]);
    expect(check(r.result, 'fairness').detail).toContain('0/2');
  });

  it('达标：恰好等于 min_ratio（1/2 = 0.5）', () => {
    const r = fairnessOf(fair(), TO('f1'), [LOW]);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics.fairness?.[0]).toMatchObject({ covered_members: 1, ratio: 0.5, satisfied: true });
  });

  it('比较容差 1e-9：0.5 + 1e-10 仍满足，0.5 + 1e-8 不满足', () => {
    expect(fairnessOf(fair(), TO('f1'), [{ ...LOW, min_ratio: 0.5 + 1e-10 }]).metrics.fairness?.[0].satisfied).toBe(true);
    expect(fairnessOf(fair(), TO('f1'), [{ ...LOW, min_ratio: 0.5 + 1e-8 }]).metrics.fairness?.[0].satisfied).toBe(false);
  });

  it('分母为 0：ratio = null，视为不适用、自动满足', () => {
    const r = fairnessOf(fair(), EMPTY, [UG]);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics.fairness).toEqual([{ floor_id: 'ug', eligible_members: 0, covered_members: 0, ratio: null, min_ratio: 1, satisfied: true }]);
    expect(check(r.result, 'fairness').detail).toContain('not applicable');
  });

  it('statuses 没填（null / undefined / 非数组）的学生不属于任何群体', () => {
    for (const st of [null, undefined, 'high_school_student']) {
      const f3 = { ...F3, statuses: st as StudentStatus[] | null };
      const r = fairnessOf(fair({ students: [F1, F2, f3, F4, F5] }), TO('f1'), [HS]);
      // 只有 f1 属于 high_school_student 群体（f3 本来可达，但没填 statuses 不计入）
      expect(r.metrics.fairness?.[0]).toMatchObject({ eligible_members: 1, covered_members: 1, ratio: 1, satisfied: true });
    }
  });

  it('多群体、多条底线：同一学生在每个所属群体各计一次，报告按输入顺序', () => {
    const r = fairnessOf(fair(), TO('f2'), [FG, LOW, UG]);
    expect(failedNames(r.result)).toEqual([]);
    expect(r.metrics.fairness?.map((x) => [x.floor_id, x.covered_members, x.eligible_members])).toEqual([
      ['fg', 2, 2],
      ['low', 1, 2],
      ['ug', 0, 0],
    ]);
    // 给 f1 时：低收入达标但第一代不达标
    const r1 = fairnessOf(fair(), TO('f1'), [FG, LOW]);
    expect(failedNames(r1.result)).toEqual(['fairness']);
    expect(check(r1.result, 'fairness').detail).toContain('fg');
    expect(r1.metrics.fairness?.map((x) => x.satisfied)).toEqual([false, true]);
  });

  it('按学生计：一个学生有多个可达对也只算 1 人', () => {
    const scenario = fair({ opportunities: [O1, O2] });
    const plan: JointPlan = { selected_intervention_ids: ['loan'], allocations: [alloc('loan', 'f1', 'o1', 100), alloc('loan', 'f1', 'o2', 0)], revoked_grant_ids: [] };
    expect(fairnessOf(scenario, plan, [LOW]).metrics.fairness?.[0]).toMatchObject({ eligible_members: 2, covered_members: 1, ratio: 0.5 });
  });

  it('撤回导致的不可达也影响底线（R1 按 E\' 计算）', () => {
    const scenario = rev({ students: [{ ...S1, statuses: ['low_income'] }, S2] });
    const lowOnly = floor('low', ['low_income'], 1);
    const plan: JointPlan = { selected_intervention_ids: ['new'], allocations: [alloc('new', 's2', 'o1', 60)], revoked_grant_ids: ['e-old'] };
    const r = verifyAndMeasure(createJointEvaluator(scenario), plan, { ...TRADE1, fairness_floors: [lowOnly] });
    expect(failedNames(r.result)).toEqual(['fairness']);
    expect(r.metrics.fairness?.[0]).toMatchObject({ eligible_members: 1, covered_members: 0 });
  });

  it('只有给出 fairness_floors（含空数组）时才输出 fairness；空数组直接通过；null 视同未给', () => {
    expect(verifyPlan(fair(), EMPTY).checks.some((c) => c.name === 'fairness')).toBe(false);
    expect(verifyPlan(fair(), EMPTY, { fairness_floors: null as unknown as FairnessFloor[] }).checks.some((c) => c.name === 'fairness')).toBe(false);
    const r = fairnessOf(fair(), EMPTY, []);
    expect(check(r.result, 'fairness').passed).toBe(true);
    expect(r.metrics.fairness).toEqual([]);
    expect(verifyAndMeasure(createJointEvaluator(fair()), EMPTY).metrics.fairness).toBeNull();
  });

  it('不读取学校名、显示名：只改这两个字段，公平结果相同', () => {
    const renamed = [F1, F2, F3, F4, F5].map((s, k) => ({ ...s, school_name: k % 2 ? 'Fictional Elite Academy' : 'Fictional Rural High', display_name: `Alias ${k}` }));
    const a = fairnessOf(fair(), TO('f2'), [FG, LOW]);
    const b = fairnessOf(fair({ students: renamed }), TO('f2'), [FG, LOW]);
    expect(b.result).toEqual(a.result);
    expect(b.metrics.fairness).toEqual(a.metrics.fairness);
  });

  describe('不合法的底线输入 → input_validity 不通过（fairness 检查同样不通过）', () => {
    const bad: [string, unknown][] = [
      ['not an array', { low: LOW }],
      ['entry is not an object', [null]],
      ['id empty', [{ ...LOW, id: '' }]],
      ['id not a string', [{ ...LOW, id: 3 }]],
      ['duplicate id', [LOW, { ...FG, id: 'low' }]],
      ['label only spaces', [{ ...LOW, label: '   ' }]],
      ['basis missing', [{ id: 'x', label: 'x', statuses_any_of: ['low_income'], min_ratio: 0.5 }]],
      ['statuses_any_of empty', [{ ...LOW, statuses_any_of: [] }]],
      ['statuses_any_of not an array', [{ ...LOW, statuses_any_of: 'low_income' }]],
      ['statuses_any_of has an invalid value', [{ ...LOW, statuses_any_of: ['low_income', 'rich'] }]],
      ['min_ratio greater than 1', [{ ...LOW, min_ratio: 1.5 }]],
      ['min_ratio negative', [{ ...LOW, min_ratio: -0.1 }]],
      ['min_ratio NaN', [{ ...LOW, min_ratio: Number.NaN }]],
      ['min_ratio is a string', [{ ...LOW, min_ratio: '0.5' }]],
    ];
    for (const [name, floors] of bad) {
      it(name, () => {
        const res = verifyPlan(fair(), TO('f1'), { fairness_floors: floors as FairnessFloor[] });
        expectFail(res, 'input_validity');
        expect(check(res, 'input_validity').detail).toContain('fairness_floors');
        expectFail(res, 'fairness');
      });
    }
    it('边界合法：min_ratio 为 0 与 1、statuses_any_of 有重复值', () => {
      const res = verifyPlan(fair(), TO('f2'), { fairness_floors: [{ ...LOW, min_ratio: 0 }, { ...FG, statuses_any_of: ['first_generation', 'first_generation'] }] });
      expect(failedNames(res)).toEqual([]);
    });
  });

  describe('plan 自带的 fairness 造假', () => {
    const truth = fairnessOf(fair(), TO('f2'), [FG, LOW]).metrics.fairness as FairnessReport[];
    const honest = { ...TO('f2'), fairness: truth };
    it('诚实的 fairness 通过', () => {
      expect(failedNames(verifyPlan(fair(), honest, { fairness_floors: [FG, LOW] }))).toEqual([]);
    });
    const variants: [string, unknown][] = [
      ['covered_members over-reported', [{ ...truth[0], covered_members: 3 }, truth[1]]],
      ['eligible_members under-reported', [truth[0], { ...truth[1], eligible_members: 1, ratio: 1 }]],
      ['ratio mismatch', [truth[0], { ...truth[1], ratio: 0.6 }]],
      ['satisfied faked', [truth[0], { ...truth[1], satisfied: false }]],
      ['min_ratio lowered', [{ ...truth[0], min_ratio: 0.5 }, truth[1]]],
      ['order reversed', [truth[1], truth[0]]],
      ['one entry missing', [truth[0]]],
      ['not an array', 'ok'],
    ];
    for (const [name, f] of variants) {
      it(name, () => {
        expectFail(verifyPlan(fair(), { ...honest, fairness: f } as JointPlan, { fairness_floors: [FG, LOW] }), 'metrics');
      });
    }
    it('规则 R3：复核选项没给底线（缺省 / null）时不比较 plan 自带的 fairness（任何内容都通过 metrics）', () => {
      for (const f of [truth, [], null, 'ok', [{ ...truth[0], covered_members: 99 }]]) {
        for (const o of [undefined, {}, { fairness_floors: null }]) {
          const res = verifyPlan(fair(), { ...honest, fairness: f } as unknown as JointPlan, o as VerifyOptions | undefined);
          expect(failedNames(res)).toEqual([]);
          expect(res.checks.some((c) => c.name === 'fairness')).toBe(false);
        }
      }
      expect(check(verifyPlan(fair(), honest), 'metrics').detail).toContain("the plan's own fairness was not compared");
    });
  });

  describe('规则 R3：已放松底线的 alternative（reviewer 复现）', () => {
    // 名额 0：第一代底线（f2 需要设备）达不到 → INFEASIBLE；alternative 放松 fairness_floors，空方案，
    // 但仍按原底线报告 fairness（covered 1/2，不满足）。
    const scenario = fair({ interventions: [{ ...LOAN, capacity: 0 }] });
    const reported = fairnessOf(scenario, EMPTY, [FG]).metrics;
    const alternative = {
      ...EMPTY,
      R0: reported.R0,
      R1: reported.R1,
      G: 0,
      L: 0,
      N: 0,
      cost: { fixed_usd: 0, marginal_usd: 0, total_usd: 0 },
      lost_pairs: [],
      revocations: [],
      fairness: reported.fairness as FairnessReport[],
    };
    it('前提：按原底线报告的 fairness 不满足', () => {
      expect(alternative.fairness).toEqual([{ floor_id: 'fg', eligible_members: 2, covered_members: 1, ratio: 0.5, min_ratio: 1, satisfied: false }]);
      expectFail(verifyPlan(scenario, alternative, { fairness_floors: [FG] }), 'fairness');
    });
    it('用去掉底线的复核选项复核：通过（不再因自带 fairness 判 metrics 不通过）', () => {
      expect(failedNames(verifyPlan(scenario, alternative, {}))).toEqual([]);
      expect(failedNames(verifyPlan(scenario, alternative, { fairness_floors: null } as unknown as VerifyOptions))).toEqual([]);
    });
    it('给出底线时，造假的 fairness 仍被 metrics 查出', () => {
      const faked = { ...alternative, fairness: [{ ...alternative.fairness[0], covered_members: 2, ratio: 1, satisfied: true }] };
      const res = verifyPlan(scenario, faked, { fairness_floors: [FG] });
      expectFail(res, 'metrics');
      expect(check(res, 'metrics').detail).toContain('covered_members');
      // 诚实的报告在给出底线时只有 fairness 本身不通过
      expect(failedNames(verifyPlan(scenario, alternative, { fairness_floors: [FG] }))).toEqual(['fairness']);
    });
  });
});

describe('verifyPlan：第 3 层正确方案全部通过', () => {
  it('撤回 + 底线 + 全部软要求 + 自带全部指标', () => {
    const scenario = rev({ students: [{ ...S1, statuses: ['low_income'] }, { ...S2, statuses: ['low_income'] }] });
    const floors = [floor('low', ['low_income'], 1)];
    const opts: VerifyOptions = { ...TRADE0, fairness_floors: floors, min_gain: 1, required_intervention_ids: ['new'] };
    const m = verifyAndMeasure(createJointEvaluator(scenario), SWAP, opts).metrics;
    const full = {
      ...SWAP,
      R0: m.R0,
      R1: m.R1,
      G: m.G,
      L: m.L,
      N: m.N,
      cost: { fixed_usd: m.fixed_usd, marginal_usd: m.marginal_usd, total_usd: m.total_usd },
      lost_pairs: m.lost_pairs,
      revocations: m.revocations,
      fairness: m.fairness ?? undefined,
    };
    const res = verifyPlan(scenario, full, opts);
    expect(failedNames(res)).toEqual([]);
    expect(res.checks.map((c) => c.name)).toEqual([...ALL_CHECKS.slice(0, -1), 'organizer_requirements', 'fairness', 'metrics']);
  });

  it('畸形的撤回 / 底线输入不抛异常', () => {
    const weird: unknown[] = [{ ...SWAP, revoked_grant_ids: [null, {}, ['e-old']] }, { ...SWAP, revocations: [null, 1] }, { ...SWAP, fairness: [null] }];
    for (const plan of weird) {
      expect(() => verifyPlan(rev(), plan as JointPlan, { ...TRADE0, fairness_floors: [LOW, null] as unknown as FairnessFloor[] })).not.toThrow();
    }
    expect(() => verifyPlan(rev(), SWAP, { fairness_floors: 'x' as unknown as FairnessFloor[] })).not.toThrow();
  });

  it('不修改输入（含撤回与底线）', () => {
    const scenario = rev();
    const plan = { ...SWAP };
    const opts = { ...TRADE0, fairness_floors: [LOW] };
    const before = JSON.stringify([scenario, plan, opts]);
    const a = verifyPlan(scenario, plan, opts);
    expect(JSON.stringify([scenario, plan, opts])).toBe(before);
    expect(verifyPlan(scenario, plan, opts)).toEqual(a);
  });
});

describe('exhaustiveBest / naiveBest：撤回与底线（对照手算与不剪枝的暴力枚举）', () => {
  it('protect：不能换用互斥的 new（要撤回 e-old），最优为空方案', () => {
    expect(exhaustiveBest(rev())).toMatchObject({ feasible: true, N: 0, L: 0, total_usd: 0, revokedCount: 0 });
  });

  it('tradeoff loss_cap 0：换用 new、强制撤回 e-old，由 new 给 s1 补位（R0 中的对需要分配）', () => {
    const r = exhaustiveBest(rev(), TRADE0);
    expect(r).toMatchObject({ feasible: true, N: 1, G: 1, L: 0, total_usd: 120, allocationCount: 2, revokedCount: 1 });
    const n = naiveBest(rev(), TRADE0);
    expect(n.plan).toEqual(SWAP);
    expect(n.revocations).toEqual([{ grant_id: 'e-old', intervention_id: 'old', student_id: 's1', forced_by: 'new' }]);
  });

  it('底线不可行 → 不可行；去掉底线后可行', () => {
    const scenario = makeScenario({ students: [F1, F2, F5], opportunities: [O1], interventions: [{ ...LOAN, capacity: 0 }] });
    expect(exhaustiveBest(scenario, { fairness_floors: [FG] }).feasible).toBe(false);
    expect(exhaustiveBest(scenario).feasible).toBe(true);
  });

  it('底线改变人选：没有底线时按学生编号给 f1，有第一代底线时给 f2', () => {
    const scenario = makeScenario({ students: [F1, F2, F5], opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }] });
    expect(naiveBest(scenario).plan?.allocations.map((a) => a.student_id)).toEqual(['f1']);
    const withFloor = naiveBest(scenario, { fairness_floors: [FG] });
    expect(withFloor.plan?.allocations.map((a) => a.student_id)).toEqual(['f2']);
    expect(withFloor.fairness?.[0]).toMatchObject({ covered_members: 2, eligible_members: 2 });
  });

  const tiny: [string, Scenario, VerifyOptions][] = [
    ['switch to the mutually exclusive measure (protect)', rev(), {}],
    ['switch to the mutually exclusive measure (tradeoff 0)', rev(), TRADE0],
    ['switch to the mutually exclusive measure (tradeoff 1)', rev(), TRADE1],
    [
      'revoke a pending grant to free capacity',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1],
        interventions: [OLD],
        existing_grants: [laptopGrant('s2', null, { id: 'e-pend', intervention_id: 'old', status: 'pending' })],
      }),
      TRADE0,
    ],
    [
      'voluntary revocation not worth it (N unchanged, L larger)',
      makeScenario({
        students: [S1, S2],
        opportunities: [O1],
        interventions: [OLD],
        existing_grants: [E_OLD],
      }),
      { mode: 'tradeoff', loss_cap: 2 },
    ],
    [
      'floor + revocation',
      rev({ students: [{ ...S1, statuses: ['low_income'] }, { ...S2, statuses: ['first_generation'] }] }),
      { mode: 'tradeoff', loss_cap: 1, fairness_floors: [floor('fg', ['first_generation'], 1)] },
    ],
    ['floor (three students, one measure)', makeScenario({ students: [F1, F2, F5], opportunities: [O1], interventions: [{ ...LOAN, capacity: 1 }] }), { fairness_floors: [FG, LOW] }],
    [
      'R1: an outside student grant blocks the mutually exclusive measure (tradeoff 2)',
      rev({
        interventions: [{ ...OLD, capacity: 2 }, NEW],
        existing_grants: [E_OLD, laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old', status: 'pending' })],
      }),
      { mode: 'tradeoff', loss_cap: 2 },
    ],
  ];

  it('R1：场景外学生的 grant 封锁互斥措施——两种模式下 new 都不可选；撤回 e-out 腾名额也不行', () => {
    const scenario = rev({
      interventions: [{ ...OLD, capacity: 2 }, NEW],
      existing_grants: [E_OLD, laptopGrant('outsider', null, { id: 'e-out', intervention_id: 'old', status: 'pending' })],
    });
    // old 已满（s1 + outsider），new 被封锁 → protect 与 tradeoff 都只能是空方案
    for (const o of [{}, TRADE0, TRADE1, { mode: 'tradeoff' as const, loss_cap: 2 }]) {
      const n = naiveBest(scenario, o);
      expect(n.plan?.selected_intervention_ids).toEqual([]);
      expect(n.N).toBe(0);
      expect(exhaustiveBest(scenario, o)).toMatchObject({ feasible: true, N: 0 });
    }
    // 必须启用 new → 不可行
    expect(exhaustiveBest(scenario, { ...TRADE0, required_intervention_ids: ['new'] }).feasible).toBe(false);
    expect(naiveBest(scenario, { required_intervention_ids: ['new'] }).feasible).toBe(false);
  });
  for (const [name, scenario, options] of tiny) {
    it(`剪枝不改变最优指标：${name}`, () => {
      const brute = bruteNoPrune(scenario, options);
      const ex = exhaustiveBest(scenario, options);
      if (!brute) expect(ex.feasible).toBe(false);
      else expect({ N: ex.N, L: ex.L, total: ex.total_usd, count: ex.allocationCount, selected: ex.selectedCount, revoked: ex.revokedCount }).toEqual(brute);
    });
  }
});

describe('独立性守卫', () => {
  for (const file of ['./verify.ts', './exhaustive.ts']) {
    it(`${file} 不 import 求解器 / index / scenarios / baselines / whatif`, () => {
      const src = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      const specifiers = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const spec of specifiers) {
        expect(spec).not.toMatch(/^\.\/(solve|index|scenarios|baselines|whatif)(\.ts)?$/);
        expect(spec).not.toMatch(/^\.\/?$|^\.\.\/joint|^@\/lib\/joint(\/(solve|index|scenarios|baselines|whatif))?$/);
      }
      expect(specifiers.every((s) => ['../types', '../reachability', '../eligibility', '../eligibility/dates', '../format', './verify'].includes(s))).toBe(true);
    });
  }
});
