/**
 * 基线 D「充分协调的分离式规划器」测试（CONTRACT.md「联合求解模型」第 10 条 D 行；实现见 ./baseline-d.ts）。
 * 全部是示例 / 模拟数据，不代表真实系统或真实影响；可达 ≠ 录取。
 *
 * 要点：
 * - 三个示例场景（多组选项）与小的夹具场景上：D 的方案可执行；验证器确认的 N ≤ 联合求解的 N（超过即联合求解器 bug）；
 *   小场景上 D 的 N ≤ 穷举参考（./exhaustive，只在测试里用）的最优 N。
 * - 协调：C 把设备名额浪费在缺交通的学生身上，D 经学生端反馈后把名额给能因此可达的学生，轮数 ≥ 2。
 * - 轮数上限（注入很小的 max_rounds）：converged = false，notes 写明，方案仍可执行。
 * - 确定性、不修改输入；保护模式不撤回；权衡模式遵守 loss_cap；不用 pending 措施；baseline-d.ts 不 import ./solve。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareBaselines, compareBaselinesWith } from './baselines';
import { MAX_COORDINATION_ROUNDS } from './baseline-d';
import { exhaustiveBest } from './exhaustive';
import { solveJoint } from './solve';
import { verifyPlan } from './verify';
import { runWhatIf, defaultWhatIfInput } from './whatif';
import { DEVICE_LOAN_IDS, SCENARIOS, deviceLoanScenario, venueTradeoffScenario, withEnabledInterventions } from './scenarios';
import { lcg } from './testing/fixtures';
import type {
  BaselineComparison,
  BaselineRow,
  Intervention,
  ResourceGrant,
  Scenario,
  SolveOptions,
  StudentProfile,
  VerifyOptions,
} from '../types';

const row = (c: BaselineComparison, id: BaselineRow['id']) => c.rows.find((r) => r.id === id)!;

function vo(opts: SolveOptions): VerifyOptions {
  const { mode, loss_cap, required_intervention_ids, min_gain, fairness_floors } = opts;
  return Object.fromEntries(
    Object.entries({ mode, loss_cap, required_intervention_ids, min_gain, fairness_floors }).filter(([, v]) => v !== undefined),
  );
}

const executable = (r: BaselineRow) =>
  r.verification.checks.filter((c) => c.name !== 'organizer_requirements' && c.name !== 'fairness').every((c) => c.passed);

/** D 行的通用性质；返回 D 与 joint 的验证器指标。 */
function checkD(sc: Scenario, opts: SolveOptions, c: BaselineComparison) {
  expect(c.rows.map((r) => r.id)).toEqual(['A_eligibility_only', 'B_student_side', 'C_organizer_side', 'D_coordinated', 'joint']);
  const d = row(c, 'D_coordinated');
  const j = row(c, 'joint');
  expect(d.label).toBe('Coordinated separate planners');
  expect(d.repaired).toBeNull();
  expect(verifyPlan(sc, d.plan, vo(opts))).toEqual(d.verification);
  expect(executable(d)).toBe(true);
  expect(d.verified).not.toBeNull();
  expect(d.coordination).toMatchObject({ max_rounds: MAX_COORDINATION_ROUNDS });
  expect(d.coordination!.converged).toBe(true);
  // D 只用已批准措施
  const pending = new Set(sc.interventions.filter((iv) => iv.status === 'pending').map((iv) => iv.id));
  for (const id of d.plan.selected_intervention_ids) expect(pending.has(id)).toBe(false);
  // 收敛时 D 的声称 = 学生端确认 = 验证器重算
  expect(d.claimed_reachable).toBe(d.verified!.R1_count);
  // 保护模式不撤回；权衡模式遵守 loss_cap
  if (opts.mode !== 'tradeoff') expect(d.plan.revoked_grant_ids).toEqual([]);
  else expect(d.verified!.L).toBeLessThanOrEqual(opts.loss_cap ?? 0);
  return { d: d.verified!, j: j.verified, dSoft: d.soft_requirements_met, jSoft: j.soft_requirements_met };
}

// ───────────────────────────── 三个示例场景 ─────────────────────────────

describe('基线 D：三个示例场景（多组选项）', () => {
  for (const entry of SCENARIOS) {
    const optionSets: [string, SolveOptions][] = [
      ['protect', {}],
      ['protect + fairness floor', { fairness_floors: entry.suggestedFairnessFloors }],
      ['tradeoff loss_cap 0', { mode: 'tradeoff', loss_cap: 0 }],
      ['tradeoff loss_cap 2', { mode: 'tradeoff', loss_cap: 2 }],
      ['tradeoff loss_cap 3', { mode: 'tradeoff', loss_cap: 3 }],
      ['min_gain 1', { min_gain: 1 }],
    ];
    for (const [name, opts] of optionSets) {
      it(`${entry.id} / ${name}：可执行，N 不超过联合求解（这些场景上打平），软要求如实`, () => {
        const c = compareBaselines(entry.scenario, opts);
        const { d, j, dSoft, jSoft } = checkD(entry.scenario, opts, c);
        const J = solveJoint(entry.scenario, opts);
        expect(J.status).not.toBe('UNSUPPORTED_INPUT');
        expect(j).not.toBeNull();
        if (J.status === 'OPTIMAL') expect(d.N).toBeLessThanOrEqual(j!.N);
        // 事实（不是要求）：在这些示例场景上 D 与联合求解在 N、L、成本上打平。
        expect([d.N, d.L, d.total_usd]).toEqual([j!.N, j!.L, j!.total_usd]);
        expect(dSoft).toBe(jSoft);
      });
    }
  }

  it('数字钉住：设备借用 G 5 / $200，权衡场景 protect G 2 / $50、tradeoff 3 G 6 L 3 / $140，共享支持 G 4 / $130', () => {
    const dOf = (sc: Scenario, o: SolveOptions = {}) => row(compareBaselines(sc, o), 'D_coordinated');
    expect(dOf(deviceLoanScenario).verified).toEqual({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 200 });
    expect(dOf(venueTradeoffScenario).verified).toEqual({ R1_count: 5, G: 2, L: 0, N: 2, total_usd: 50 });
    const t3 = dOf(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 3 });
    expect(t3.verified).toEqual({ R1_count: 6, G: 6, L: 3, N: 3, total_usd: 140 });
    expect(t3.plan.revoked_grant_ids).toEqual(['shuttle-grant-1', 'shuttle-grant-2', 'shuttle-grant-3']);
    const shared = SCENARIOS.find((e) => e.id === 'shared-support');
    if (shared) expect(dOf(shared.scenario).verified).toMatchObject({ G: 4, L: 0, N: 4, total_usd: 130 });
    for (const sc of [deviceLoanScenario, venueTradeoffScenario]) {
      expect(dOf(sc).coordination).toEqual({ rounds: 2, converged: true, max_rounds: 50 });
    }
  });
});

// ───────────────────────────── 协调：C 浪费名额，D 转给能可达的学生 ─────────────────────────────

/** 设备借用只启用笔记本借用（5 个名额），并让编号最小的 3 名学生（s01–s03）没有交通、其余 7 人交通稳定。 */
function wastedSlotsScenario(): Scenario {
  const base = withEnabledInterventions(deviceLoanScenario, [DEVICE_LOAN_IDS.laptopLoan]);
  const noTransport = new Set(['dl-s01', 'dl-s02', 'dl-s03']);
  return {
    ...base,
    students: base.students.map((s) => ({
      ...s,
      transport: noTransport.has(s.id)
        ? { level: 'none' as const, max_one_way_minutes: null, note: 'Sample: no transport' }
        : { level: 'reliable' as const, max_one_way_minutes: 40, note: 'Sample: bus' },
    })),
  };
}

describe('基线 D：协调把名额从用不上的学生转给能因此可达的学生', () => {
  const sc = wastedSlotsScenario();
  const c = compareBaselines(sc);

  it('B 超名额不可执行；C 把 3 个名额给了缺交通的 s01–s03（复核 G = 2）；D 经反馈得到 G = 5，轮数 ≥ 2', () => {
    checkD(sc, {}, c);
    expect(row(c, 'B_student_side').verified).toBeNull();
    const cc = row(c, 'C_organizer_side');
    expect(cc.claimed_reachable).toBe(5);
    expect(cc.verified?.G).toBe(2);
    const d = row(c, 'D_coordinated');
    expect(d.verified).toEqual({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 200 });
    expect(d.verified!.R1_count).toBeGreaterThan(cc.verified!.R1_count);
    expect(d.coordination!.rounds).toBeGreaterThanOrEqual(2);
    expect(d.coordination!.converged).toBe(true);
    // 名额给了能可达的学生（缺交通的 3 人一个都没拿到）
    const served = [...new Set(d.plan.allocations.map((a) => a.student_id))].sort();
    expect(served).toEqual(['dl-s04', 'dl-s05', 'dl-s06', 'dl-s07', 'dl-s08']);
    expect(row(c, 'joint').verified?.N).toBe(5);
  });

  it('notes 只有人数：第 1 轮学生端的报告与收敛说明，不含学生 id', () => {
    const dNotes = c.notes.filter((n) => n.startsWith('Baseline D'));
    expect(dNotes.some((n) => n.includes('round 1'))).toBe(true);
    expect(dNotes.some((n) => n.includes('converged after 2 coordination rounds'))).toBe(true);
    for (const n of c.notes) expect(n).not.toMatch(/dl-s\d/);
  });
});

// ───────────────────────────── 轮数上限 ─────────────────────────────

describe('基线 D：轮数上限', () => {
  it('max_rounds = 1：未收敛（学生端还没确认最后的提议），notes 写明，方案仍可执行', () => {
    const sc = wastedSlotsScenario();
    const c = compareBaselinesWith(sc, {}, 1);
    const d = row(c, 'D_coordinated');
    expect(d.coordination).toEqual({ rounds: 1, converged: false, max_rounds: 1 });
    expect(c.notes.some((n) => n.includes('did not converge') && n.includes('round limit of 1'))).toBe(true);
    expect(executable(d)).toBe(true);
    expect(d.verified?.N).toBeLessThanOrEqual(row(c, 'joint').verified!.N);
    // 其他行不受影响
    const full = compareBaselines(sc);
    for (const id of ['A_eligibility_only', 'B_student_side', 'C_organizer_side', 'joint'] as const) {
      expect(row(c, id)).toEqual(row(full, id));
    }
  });

  it('空方案就是最优时第 1 轮即收敛', () => {
    const sc: Scenario = { ...deviceLoanScenario, interventions: [] };
    const d = row(compareBaselines(sc), 'D_coordinated');
    expect(d.coordination).toEqual({ rounds: 1, converged: true, max_rounds: 50 });
    expect(d.plan).toEqual({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });
  });
});

// ───────────────────────────── 确定性、模式、pending、静态守卫 ─────────────────────────────

describe('基线 D：通用性质', () => {
  it('确定性，不修改输入', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3, fairness_floors: SCENARIOS[1].suggestedFairnessFloors };
    const before = JSON.stringify(venueTradeoffScenario);
    const optsBefore = JSON.stringify(opts);
    const a = compareBaselines(venueTradeoffScenario, opts);
    const b = compareBaselines(venueTradeoffScenario, opts);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(venueTradeoffScenario)).toBe(before);
    expect(JSON.stringify(opts)).toBe(optsBefore);
  });

  it('保护模式：D 不撤回任何已有 grant（卫星会场与运行中的接驳车互斥，不能启用）', () => {
    const d = row(compareBaselines(venueTradeoffScenario), 'D_coordinated');
    expect(d.plan.revoked_grant_ids).toEqual([]);
    expect(d.plan.selected_intervention_ids).not.toContain('iv-weekend-satellite');
    expect(d.verified!.L).toBe(0);
  });

  it('权衡模式遵守 loss_cap：上限 2 时不启用卫星会场（会损失 3），上限 3 时启用', () => {
    const d2 = row(compareBaselines(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 2 }), 'D_coordinated');
    expect(d2.verified!.L).toBeLessThanOrEqual(2);
    expect(d2.plan.selected_intervention_ids).not.toContain('iv-weekend-satellite');
    const d3 = row(compareBaselines(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 3 }), 'D_coordinated');
    expect(d3.plan.selected_intervention_ids).toContain('iv-weekend-satellite');
    expect(d3.verified!.L).toBe(3);
  });

  it('pending 措施不被当作已生效：设备借用里的卫星会场（pending）从不出现；全是 pending 时 D 为空方案', () => {
    const d = row(compareBaselines(deviceLoanScenario), 'D_coordinated');
    expect(d.plan.selected_intervention_ids).not.toContain(DEVICE_LOAN_IDS.satelliteVenue);
    const allPending: Scenario = {
      ...deviceLoanScenario,
      interventions: deviceLoanScenario.interventions.map((iv) => ({ ...iv, status: 'pending' as const })),
    };
    const dp = row(compareBaselines(allPending), 'D_coordinated');
    expect(dp.plan.selected_intervention_ids).toEqual([]);
    expect(dp.verified?.G).toBe(0);
  });

  it('软要求做不到时与联合求解一致：空方案、soft_requirements_met = false，notes 写明没有放松', () => {
    const c = compareBaselines(deviceLoanScenario, { min_gain: 6 });
    const d = row(c, 'D_coordinated');
    expect(d.plan).toEqual({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });
    expect(d.soft_requirements_met).toBe(false);
    expect(row(c, 'joint').soft_requirements_met).toBe(false);
    expect(c.notes.some((n) => n.includes('found no plan that meets') && n.includes('not relaxed'))).toBe(true);
  });

  it('必须启用的措施被当作约束（与联合求解一致）', () => {
    const opts: SolveOptions = { required_intervention_ids: [DEVICE_LOAN_IDS.transportSubsidy] };
    const c = compareBaselines(deviceLoanScenario, opts);
    const d = row(c, 'D_coordinated');
    expect(d.plan.selected_intervention_ids).toContain(DEVICE_LOAN_IDS.transportSubsidy);
    expect(d.soft_requirements_met).toBe(true);
    expect([d.verified!.N, d.verified!.total_usd]).toEqual([row(c, 'joint').verified!.N, row(c, 'joint').verified!.total_usd]);
  });

  it('节点上限与联合求解相同：max_search_nodes = 1 时 notes 写明未证明最优，方案仍可执行', () => {
    const c = compareBaselines(deviceLoanScenario, { max_search_nodes: 1 });
    expect(c.notes.some((n) => n.startsWith('Baseline D') && n.includes('node limit'))).toBe(true);
    expect(executable(row(c, 'D_coordinated'))).toBe(true);
  });

  it('静态守卫：baseline-d.ts 不 import ./solve（也不 import ./baselines、./index），只用 ./verify 的类型', () => {
    const src = readFileSync(fileURLToPath(new URL('./baseline-d.ts', import.meta.url)), 'utf8');
    const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(['./solve', './baselines', './index', '.', './whatif']).not.toContain(s);
    expect(src).not.toMatch(/solveJoint/);
    // 反过来：verify.ts / exhaustive.ts 不 import 基线模块
    for (const f of ['./verify.ts', './exhaustive.ts']) {
      const other = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      expect(other).not.toMatch(/from ['"]\.\/baseline-d['"]/);
    }
  });
});

// ───────────────────────────── 小场景：与穷举参考、联合求解对照 ─────────────────────────────

/** 小场景（≤ 6 名学生）：穷举参考可以在测试里跑完。 */
function smallScenarios(): [string, Scenario, SolveOptions][] {
  const dl6: Scenario = { ...deviceLoanScenario, students: deviceLoanScenario.students.slice(0, 6) };
  const dl6Laptop = withEnabledInterventions(dl6, [DEVICE_LOAN_IDS.laptopLoan]);
  const vt5: Scenario = { ...venueTradeoffScenario, students: venueTradeoffScenario.students.slice(0, 5) };
  const waste6: Scenario = { ...wastedSlotsScenario(), students: wastedSlotsScenario().students.slice(0, 6) };
  return [
    ['设备借用前 6 人，全部措施', dl6, {}],
    ['设备借用前 6 人，只有笔记本', dl6Laptop, {}],
    ['设备借用前 6 人，低收入底线', dl6, { fairness_floors: SCENARIOS[0].suggestedFairnessFloors }],
    ['名额浪费场景前 6 人', waste6, {}],
    ['权衡场景前 5 人，protect', vt5, {}],
    ['权衡场景前 5 人，tradeoff 0', vt5, { mode: 'tradeoff', loss_cap: 0 }],
    ['权衡场景前 5 人，tradeoff 3', vt5, { mode: 'tradeoff', loss_cap: 3 }],
  ];
}

describe('基线 D：小场景与穷举参考对照', () => {
  for (const [name, sc, opts] of smallScenarios()) {
    it(`${name}：D 的 N ≤ 穷举最优，且 ≤ 联合求解`, () => {
      const c = compareBaselines(sc, opts);
      const { d, j } = checkD(sc, opts, c);
      const ex = exhaustiveBest(sc, vo(opts));
      expect(ex.feasible).toBe(true);
      expect(d.N).toBeLessThanOrEqual(ex.N);
      expect(d.N).toBeLessThanOrEqual(j!.N);
      // 事实：这些小场景上 D 也达到穷举最优的 N、L、成本
      expect([d.N, d.L, d.total_usd]).toEqual([ex.N, ex.L, ex.total_usd]);
    });
  }
});

/** 确定性伪随机的小场景（固定种子）：随机学生条件、措施（名额、成本、互斥、依赖、pending、适用机会）、已有 grant 与模式。 */
function randomCase(seed: number): { scenario: Scenario; options: SolveOptions } {
  const rnd = lcg(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
  const opp1 = deviceLoanScenario.opportunities[0];
  const opp2 = { ...opp1, id: 'rand-opp-2', title: 'Second sample session (placeholder)', required_devices: [] };
  const opps = rnd() < 0.5 ? [opp1] : [opp1, opp2];
  const template = deviceLoanScenario.students[0];
  const nStudents = 3 + Math.floor(rnd() * 3);
  const students: StudentProfile[] = Array.from({ length: nStudents }, (_, k) => ({
    ...template,
    id: `r-s${k + 1}`,
    display_name: `Sample student ${k + 1}`,
    devices: rnd() < 0.3 ? ['smartphone', 'laptop'] : ['smartphone'],
    transport: rnd() < 0.4 ? { level: 'none', max_one_way_minutes: null, note: 'Sample' } : { level: 'reliable', max_one_way_minutes: 40, note: 'Sample' },
    statuses: rnd() < 0.5 ? ['high_school_student', 'low_income'] : ['high_school_student'],
  }));
  const ivs: Intervention[] = [
    {
      id: 'r-laptop',
      title: 'Laptop loan (sample)',
      type: 'device',
      resolves: ['device'],
      device: 'laptop',
      unit_cost_usd: pick([0, 20, 40]),
      fixed_cost_usd: pick([0, 50]),
      capacity: pick([1, 2, 3, null]),
      capacity_scope: pick(['total', 'per_time_slot'] as const),
      status: 'approved',
    },
    {
      id: 'r-ride',
      title: 'Transport stipend (sample)',
      type: 'transport_subsidy',
      resolves: ['transport'],
      amount_usd: 25,
      unit_cost_usd: pick([10, 25]),
      fixed_cost_usd: 0,
      capacity: pick([1, 2, null]),
      status: rnd() < 0.2 ? 'pending' : 'approved',
    },
    {
      id: 'r-remote',
      title: 'Online participation option (sample)',
      type: 'alternative_access',
      resolves: ['transport'],
      unit_cost_usd: pick([0, 5]),
      fixed_cost_usd: pick([30, 80]),
      capacity: pick([2, null]),
      requires: rnd() < 0.4 ? ['r-laptop'] : undefined,
      mutually_exclusive_with: rnd() < 0.5 ? ['r-ride'] : undefined,
      opportunity_ids: opps.length > 1 && rnd() < 0.5 ? [opp1.id] : undefined,
      status: 'approved',
    },
  ];
  const grants: ResourceGrant[] = [];
  if (rnd() < 0.6) {
    const s = students[Math.floor(rnd() * students.length)].id;
    grants.push({
      id: 'r-grant-1',
      student_id: s,
      opportunity_id: rnd() < 0.5 ? opp1.id : null,
      intervention_id: 'r-ride',
      type: 'transport_subsidy',
      amount_usd: 25,
      device: null,
      hours_per_week: null,
      status: rnd() < 0.8 ? 'approved' : 'pending',
      provider: 'Sample provider (simulated)',
      is_sample: true,
    });
  }
  const scenario: Scenario = {
    id: `rand-${seed}`,
    title: 'Random sample scenario (simulated)',
    is_sample: true,
    evaluation_date: deviceLoanScenario.evaluation_date,
    students,
    opportunities: opps,
    opportunity_time_slots: opps.length > 1 && rnd() < 0.5 ? { [opp1.id]: 'slot-a', [opp2.id]: 'slot-b' } : undefined,
    interventions: ivs,
    existing_grants: grants,
    budget_usd: pick([60, 120, 200, 400]),
  };
  const r = rnd();
  const options: SolveOptions =
    r < 0.4
      ? {}
      : r < 0.7
        ? { mode: 'tradeoff', loss_cap: pick([0, 1, 2]) }
        : r < 0.85
          ? { fairness_floors: [{ ...SCENARIOS[0].suggestedFairnessFloors[0], min_ratio: pick([0.5, 1]) }] }
          : { min_gain: pick([1, 2, 3]) };
  return { scenario, options };
}

describe('基线 D：40 个固定种子的随机小场景（与联合求解、穷举参考对照）', () => {
  const seeds = Array.from({ length: 40 }, (_, k) => 9001 + k * 7);
  it('每个场景：D 可执行、收敛；D 的 N ≤ 联合求解（OPTIMAL 时）与穷举最优；记录打平数', () => {
    let compared = 0;
    let ties = 0;
    for (const seed of seeds) {
      const { scenario, options } = randomCase(seed);
      const J = solveJoint(scenario, options);
      if (J.status === 'UNSUPPORTED_INPUT') continue;
      const c = compareBaselines(scenario, options);
      const { d, j, dSoft, jSoft } = checkD(scenario, options, c);
      const ex = exhaustiveBest(scenario, vo(options));
      if (J.status === 'OPTIMAL') {
        compared++;
        expect(d.N, `seed ${seed}`).toBeLessThanOrEqual(j!.N);
        expect(d.N, `seed ${seed}`).toBeLessThanOrEqual(ex.N);
        if (d.N === j!.N && Math.abs(d.L - j!.L) < 1e-6 && Math.abs(d.total_usd - j!.total_usd) < 1e-6) ties++;
      } else if (J.status === 'INFEASIBLE') {
        // 软要求做不到：两边都是空方案，都不满足
        expect(ex.feasible, `seed ${seed}`).toBe(false);
        expect(dSoft, `seed ${seed}`).toBe(false);
        expect(jSoft, `seed ${seed}`).toBe(false);
      }
    }
    expect(compared).toBeGreaterThanOrEqual(20);
    // 事实（不是要求）：这些随机小场景上 D 与联合求解在 N、L、成本上全部打平。
    expect(ties).toBe(compared);
  });
});

// ───────────────────────────── What-if 视图 ─────────────────────────────

describe('基线 D：What-if 视图', () => {
  it('基线表含 D 行与轮数，只有汇总数字，没有任何学生 id', () => {
    for (const entry of SCENARIOS) {
      const v = runWhatIf(entry.scenario, defaultWhatIfInput(entry.scenario));
      const rows = v.baselines!.rows;
      const d = rows.find((r) => r.id === 'D_coordinated')!;
      expect(d.label).toBe('Coordinated separate planners');
      expect(d.coordination).toEqual({ rounds: 2, converged: true, max_rounds: 50 });
      expect(d.coordination_label).toBe('2 rounds, converged');
      for (const r of rows) if (r.id !== 'D_coordinated') expect(r.coordination).toBeNull();
      const json = JSON.stringify(v.baselines);
      for (const s of entry.scenario.students) expect(json).not.toContain(s.id);
      for (const r of rows) expect(Object.keys(r)).not.toContain('plan');
    }
  });
});
