/**
 * compareBaselines 测试（CONTRACT.md「联合求解模型」第 10 条）。全部是示例 / 模拟数据，不代表真实系统或真实影响。
 *
 * 设备借用场景（data/scenarios/device-loan.json）的手算依据：
 * - 1 个占位线下机会；10 名示例学生 dl-s01…dl-s10 全部符合资格、都缺笔记本；dl-s03 / dl-s06 / dl-s09 还缺交通。
 *   R0 = ∅。
 * - 措施：iv-laptop-loan 笔记本借用（固定 $100 + 每人 $20，名额 5，按时段）；iv-transport-subsidy 交通补助
 *   （每人 $25，不限）；iv-online-entry 线上入口（固定 $150，requires 笔记本借用，与卫星会场互斥）；
 *   iv-satellite-venue 卫星会场（pending）。预算 $400。
 *
 * 【只启用笔记本借用、预算 $400】
 * - A：10 个对都 eligible → 声称 10；空方案复核：R1 = R0 = 0，G = 0。
 * - B：每个对的候选只有 {笔记本}。缺交通的 s03 / s06 / s09 只靠笔记本仍不可达 → 找不到 T_p，不计入；
 *   其余 7 人找到 {笔记本} → 声称 0 + 7 = 7（不是 10：B 也调用 analyzeReachability，只是不协调名额）。
 *   原方案 7 人用 5 个名额 → capacity 不通过（不可执行，verified = null）。
 *   先到先得截断：按编号 s01、s02、s04、s05、s07 加入（$100 + 5 × $20 = $200），s08、s10 超名额被跳过
 *   → 保留 5、跳过 2，G = 5，$200。因为 P_B 本来就不含缺交通的学生，截断后的前 5 名都可达，所以这里是 5 而不少于 5。
 * - C：笔记本借用按障碍类型 device 分配，按编号 s01…s05（名额 5），$200；声称 5。
 *   复核：s03 还缺交通 → 只有 4 人可达，G = 4，$200（可执行）。
 * - joint：G = 5（s01、s02、s04、s05、s07），L = 0，$200。
 *
 * 【全部措施（卫星会场 pending 不参与 B / C）、预算 $400】
 * - A：声称 10，G = 0。
 * - B：没交通的 3 人找到 {笔记本, 线上入口}（大小 2 中字典序第一个可行的），其余 7 人 {笔记本} → 声称 10；
 *   原方案 10 人用笔记本（超名额 5）、成本 $100 + $150 + 10 × $20 = $450 > $400 → capacity、budget 不通过。
 *   截断：s01、s02、s03（带线上入口）、s04、s05 加入（$100 + $150 + 5 × $20 = $350），其余 5 人超名额被跳过 → G = 5，$350。
 * - C：按 id 升序：笔记本借用 → s01…s05（$200，余 $200）；线上入口（依赖已选、$150 ≤ $200）→ 给缺交通的 s03、s06、s09
 *   （每人 $0，余 $50）；交通补助：没交通的 3 人已被认为化解了 transport，其他人没有 transport 障碍 → 无分配、不选。
 *   声称 = 不同的有分配的对 s01…s05 + s06 + s09 = 7。复核：s06、s09 没拿到笔记本仍不可达 → G = 5，$350（可执行）。
 * - joint：G = 5，$200（与 C 的 G 打平，但便宜 $150）。
 *
 * 【权衡场景 venue-tradeoff】9 名学生都没有交通、都符合两场资格 → 18 个对 eligible；R0 = 3（接驳车已有 grant）。
 * - protect：A 声称 18、R1 = 3、G = 0。B：WD 的 s04…s09 找到 {拼车}（字典序在接驳车之前），WE 的 9 人找到 {卫星会场}
 *   → 声称 3 + 15 = 18；原方案选了互斥的拼车 + 卫星会场、且需要撤回接驳车 grant 而没撤回、超名额、超预算 → 不可执行。
 *   截断：s04、s05 的拼车可以；加卫星会场的任何对都违反互斥 / 撤回 → 保留 2、跳过 13，G = 2，$50。
 *   C：按 id 升序先拼车（s04、s05，$50）；接驳车名额已被 3 条已有 grant 占满；卫星会场与已选的拼车互斥 → 跳过。
 *   声称 5，复核 G = 2，$50。joint：G = 2，$50。C 与 joint 在这里打平（如实断言）。
 * - tradeoff loss_cap = 2：与 protect 相同（卫星会场会造成 L = 3）。
 * - tradeoff loss_cap = 3：A / B / C 不变（B、C 不撤回，规则与模式无关；C 的方案不撤回、L = 0）；joint 启用卫星会场，
 *   强制撤回 3 条接驳车 grant：G = 6、L = 3、N = 3，$140。
 */
import { describe, expect, it } from 'vitest';
import { BASELINE_NOTES, compareBaselines } from './baselines';
import { verifyPlan } from './verify';
import {
  DEVICE_LOAN_IDS as D,
  SCENARIOS,
  deviceLoanScenario,
  venueTradeoffScenario,
  withBudget,
  withEnabledInterventions,
} from './scenarios';
import type { BaselineComparison, BaselineRow, Scenario, SolveOptions, VerifyOptions } from '../types';

const DL = deviceLoanScenario;
const VT = venueTradeoffScenario;
const LAPTOP_ONLY = withEnabledInterventions(DL, [D.laptopLoan]);
const DL_FLOORS = SCENARIOS[0].suggestedFairnessFloors;
const VT_FLOORS = SCENARIOS[1].suggestedFairnessFloors;

const row = (c: BaselineComparison, id: BaselineRow['id']) => c.rows.find((r) => r.id === id)!;
const fails = (r: BaselineRow) => r.verification.checks.filter((c) => !c.passed).map((c) => c.name);
const served = (r: BaselineRow) => [...new Set(r.plan.allocations.map((a) => a.student_id))].sort();

function vo(opts: SolveOptions): VerifyOptions {
  const { mode, loss_cap, required_intervention_ids, min_gain, fairness_floors } = opts;
  return Object.fromEntries(
    Object.entries({ mode, loss_cap, required_intervention_ids, min_gain, fairness_floors }).filter(([, v]) => v !== undefined),
  );
}

function expectConsistent(sc: Scenario, opts: SolveOptions, c: BaselineComparison) {
  expect(c.rows.map((r) => r.id)).toEqual(['A_eligibility_only', 'B_student_side', 'C_organizer_side', 'D_coordinated', 'joint']);
  for (const r of c.rows) {
    expect(Object.keys(r.plan).sort()).toEqual(['allocations', 'revoked_grant_ids', 'selected_intervention_ids']);
    expect(verifyPlan(sc, r.plan, vo(opts))).toEqual(r.verification);
    const executable = r.verification.checks
      .filter((x) => x.name !== 'organizer_requirements' && x.name !== 'fairness')
      .every((x) => x.passed);
    expect(r.verified === null).toBe(!executable);
    if (r.verified) expect(r.verified.N).toBe(r.verified.G - r.verified.L);
    if (r.id === 'A_eligibility_only' || r.id === 'D_coordinated' || r.id === 'joint') expect(r.repaired).toBeNull();
    if (r.id === 'D_coordinated') expect(r.coordination).not.toBeNull();
    else expect(r).not.toHaveProperty('coordination');
    if (executable) expect(r.repaired).toBeNull();
    else if (r.id === 'B_student_side' || r.id === 'C_organizer_side') expect(r.repaired).not.toBeNull();
    expect(r.label.length).toBeGreaterThan(0);
    expect(r.description.length).toBeGreaterThan(0);
  }
  for (const n of [BASELINE_NOTES.same_inputs, BASELINE_NOTES.d_tie, BASELINE_NOTES.simulation, BASELINE_NOTES.ordering]) {
    expect(c.notes).toContain(n);
  }
}

describe('compareBaselines：设备借用场景，只启用笔记本借用（预算 $400）', () => {
  const c = compareBaselines(LAPTOP_ONLY);

  it('五行固定顺序（A、B、C、D、joint），标签固定', () => {
    expect(c.rows.map((r) => r.label)).toEqual([
      'Eligibility filter only',
      'Student-side planner',
      'Organizer-side planner',
      'Coordinated separate planners',
      'Joint solver',
    ]);
    expectConsistent(LAPTOP_ONLY, {}, c);
  });

  it('A：声称 10（都符合资格），复核后 R1 = 0、G = 0', () => {
    const a = row(c, 'A_eligibility_only');
    expect(a.claimed_reachable).toBe(10);
    expect(a.plan).toEqual({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });
    expect(a.verified).toEqual({ R1_count: 0, G: 0, L: 0, N: 0, total_usd: 0 });
    expect(a.soft_requirements_met).toBeNull();
  });

  it('B：声称 7（缺交通的 3 人只靠笔记本仍不可达，不计入），原方案超名额不可执行；截断后 G = 5', () => {
    const b = row(c, 'B_student_side');
    expect(b.claimed_reachable).toBe(7);
    expect(served(b)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07', 'dl-s08', 'dl-s10']);
    expect(fails(b)).toEqual(['capacity']);
    expect(b.verified).toBeNull();
    expect(b.repaired).toMatchObject({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 200 });
    expect(b.repaired!.note).toContain('kept 5 pairs, skipped 2 pairs');
    expect(b.repaired!.note).toContain('does not represent who needs help more');
  });

  it('C：声称 5，复核后只有 4 人可达（s03 还缺交通），$200', () => {
    const cc = row(c, 'C_organizer_side');
    expect(cc.claimed_reachable).toBe(5);
    expect(served(cc)).toEqual(['dl-s01', 'dl-s02', 'dl-s03', 'dl-s04', 'dl-s05']);
    expect(cc.verified).toEqual({ R1_count: 4, G: 4, L: 0, N: 4, total_usd: 200 });
    expect(cc.repaired).toBeNull();
  });

  it('joint：G = 5、L = 0、$200', () => {
    const j = row(c, 'joint');
    expect(j.claimed_reachable).toBe(5);
    expect(j.verified).toEqual({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 200 });
    expect(j.verification.passed).toBe(true);
  });
});

describe('compareBaselines：设备借用场景，全部措施（预算 $400）', () => {
  const c = compareBaselines(DL);
  it('A 10 / 0；B 声称 10、超名额超预算、截断后 5（$350）；C 声称 7、复核 5（$350）；joint 5（$200）', () => {
    expectConsistent(DL, {}, c);
    expect(row(c, 'A_eligibility_only').claimed_reachable).toBe(10);
    expect(row(c, 'A_eligibility_only').verified!.G).toBe(0);

    const b = row(c, 'B_student_side');
    expect(b.claimed_reachable).toBe(10);
    expect(b.plan.selected_intervention_ids).toEqual([D.laptopLoan, D.onlineEntry]);
    expect(fails(b)).toEqual(['capacity', 'budget']);
    expect(b.repaired).toMatchObject({ G: 5, L: 0, total_usd: 350 });
    expect(b.repaired!.note).toContain('kept 5 pairs, skipped 5 pairs');

    const cc = row(c, 'C_organizer_side');
    expect(cc.claimed_reachable).toBe(7);
    expect(cc.plan.selected_intervention_ids).toEqual([D.laptopLoan, D.onlineEntry]);
    expect(cc.verified).toEqual({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 350 });

    expect(row(c, 'joint').verified).toEqual({ R1_count: 5, G: 5, L: 0, N: 5, total_usd: 200 });
    // B、C 都不碰待审批的卫星会场
    for (const r of c.rows) expect(r.plan.selected_intervention_ids).not.toContain(D.satelliteVenue);
  });
});

describe('compareBaselines：权衡场景', () => {
  const expectBaselinesABC = (c: BaselineComparison) => {
    const a = row(c, 'A_eligibility_only');
    expect(a.claimed_reachable).toBe(18);
    expect(a.verified).toEqual({ R1_count: 3, G: 0, L: 0, N: 0, total_usd: 0 });
    const b = row(c, 'B_student_side');
    expect(b.claimed_reachable).toBe(18);
    expect(b.verified).toBeNull();
    expect(fails(b)).toEqual(expect.arrayContaining(['mutual_exclusion', 'revocation']));
    expect(b.repaired).toMatchObject({ R1_count: 5, G: 2, L: 0, N: 2, total_usd: 50 });
    expect(b.repaired!.note).toContain('kept 2 pairs, skipped 13 pairs');
    const cc = row(c, 'C_organizer_side');
    expect(cc.claimed_reachable).toBe(5);
    expect(cc.plan.selected_intervention_ids).toEqual(['iv-weekday-carpool']);
    expect(cc.plan.revoked_grant_ids).toEqual([]);
    expect(cc.verified).toEqual({ R1_count: 5, G: 2, L: 0, N: 2, total_usd: 50 });
  };

  it('protect：C 与 joint 打平（G = 2、$50）', () => {
    const c = compareBaselines(VT);
    expectConsistent(VT, {}, c);
    expectBaselinesABC(c);
    expect(row(c, 'joint').verified).toEqual({ R1_count: 5, G: 2, L: 0, N: 2, total_usd: 50 });
  });

  it('tradeoff loss_cap = 2：与 protect 相同', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 2 };
    const c = compareBaselines(VT, opts);
    expectConsistent(VT, opts, c);
    expectBaselinesABC(c);
    expect(row(c, 'joint').verified).toEqual({ R1_count: 5, G: 2, L: 0, N: 2, total_usd: 50 });
  });

  it('tradeoff loss_cap = 3：joint 启用卫星会场并撤回 3 条接驳车 grant（G 6、L 3、N 3、$140），A / B / C 不变', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3 };
    const c = compareBaselines(VT, opts);
    expectConsistent(VT, opts, c);
    expectBaselinesABC(c);
    const j = row(c, 'joint');
    expect(j.plan.revoked_grant_ids).toEqual(['shuttle-grant-1', 'shuttle-grant-2', 'shuttle-grant-3']);
    expect(j.claimed_reachable).toBe(6);
    expect(j.verified).toEqual({ R1_count: 6, G: 6, L: 3, N: 3, total_usd: 140 });
  });
});

describe('compareBaselines：公平底线时 soft_requirements_met', () => {
  it('设备借用全部措施 + 低收入 ≥ 50%：A false、B true（但不可执行）、C false、D true、joint true', () => {
    const opts: SolveOptions = { fairness_floors: DL_FLOORS };
    const c = compareBaselines(DL, opts);
    expectConsistent(DL, opts, c);
    expect(c.rows.map((r) => r.soft_requirements_met)).toEqual([false, true, false, true, true]);
    expect(row(c, 'B_student_side').verified).toBeNull();
    // C 服务 s01…s05，低收入的 s07…s10 一个都没覆盖
    expect(row(c, 'C_organizer_side').verification.checks.find((x) => x.name === 'fairness')?.passed).toBe(false);
    const j = row(c, 'joint');
    expect(served(j)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s07', 'dl-s08']);
    expect(j.verified?.G).toBe(5);
  });

  it('权衡场景 protect + 低收入底线：joint 把拼车名额给低收入学生，C 不满足', () => {
    const opts: SolveOptions = { fairness_floors: VT_FLOORS };
    const c = compareBaselines(VT, opts);
    expectConsistent(VT, opts, c);
    expect(row(c, 'C_organizer_side').soft_requirements_met).toBe(false);
    expect(row(c, 'joint').soft_requirements_met).toBe(true);
    expect(served(row(c, 'joint'))).toEqual(['vt-s06', 'vt-s07']);
  });

  it('不设软要求时全部为 null；min_gain 给出时按 organizer_requirements 判', () => {
    expect(compareBaselines(DL).rows.map((r) => r.soft_requirements_met)).toEqual([null, null, null, null, null]);
    const c = compareBaselines(DL, { min_gain: 5 });
    expect(c.rows.map((r) => r.soft_requirements_met)).toEqual([false, true, true, true, true]);
  });
});

describe('compareBaselines：通用性质', () => {
  it('确定性，不修改输入', () => {
    const before = JSON.stringify(VT);
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3, fairness_floors: VT_FLOORS };
    const optsBefore = JSON.stringify(opts);
    const a = compareBaselines(VT, opts);
    const b = compareBaselines(VT, opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(VT)).toBe(before);
    expect(JSON.stringify(opts)).toBe(optsBefore);
  });

  it('输入不合法：rows 为空，notes 写明原因', () => {
    const c = compareBaselines(withBudget(DL, -1));
    expect(c.rows).toEqual([]);
    expect(c.notes[0]).toBe(BASELINE_NOTES.unsupported);
    expect(compareBaselines(VT, { mode: 'tradeoff' }).rows).toEqual([]);
  });

  it('INFEASIBLE：joint 行为空主方案，notes 加说明', () => {
    const c = compareBaselines(DL, { min_gain: 6 });
    expect(c.notes).toContain(BASELINE_NOTES.infeasible);
    const j = row(c, 'joint');
    expect(j.plan.selected_intervention_ids).toEqual([]);
    expect(j.verified).toEqual({ R1_count: 0, G: 0, L: 0, N: 0, total_usd: 0 });
    expect(j.soft_requirements_met).toBe(false);
  });

  it('SEARCH_LIMIT_REACHED：notes 加说明', () => {
    const c = compareBaselines(DL, { max_search_nodes: 1 });
    expect(c.notes).toContain(BASELINE_NOTES.search_limit);
  });
});

describe('compareBaselines：小的对抗场景', () => {
  it('所有学生本来就可达：A 10 / R1 10；B、C 不分配；joint G = 0', () => {
    const sc: Scenario = {
      ...DL,
      students: DL.students.map((s) => ({
        ...s,
        devices: [...(s.devices ?? []), 'laptop'],
        transport: { level: 'reliable', max_one_way_minutes: 60, note: null },
      })),
    };
    const c = compareBaselines(sc);
    expectConsistent(sc, {}, c);
    expect(row(c, 'A_eligibility_only').verified).toEqual({ R1_count: 10, G: 0, L: 0, N: 0, total_usd: 0 });
    for (const id of ['B_student_side', 'C_organizer_side', 'joint'] as const) {
      const r = row(c, id);
      expect(r.claimed_reachable).toBe(10);
      expect(r.plan.allocations).toEqual([]);
      expect(r.verified).toEqual({ R1_count: 10, G: 0, L: 0, N: 0, total_usd: 0 });
    }
  });

  it('没有任何措施：B、C、D、joint 都是空方案', () => {
    const sc: Scenario = { ...DL, interventions: [] };
    const c = compareBaselines(sc);
    expectConsistent(sc, {}, c);
    for (const r of c.rows) {
      expect(r.plan).toEqual({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });
      expect(r.verified).toEqual({ R1_count: 0, G: 0, L: 0, N: 0, total_usd: 0 });
    }
    expect(row(c, 'B_student_side').claimed_reachable).toBe(0);
    expect(row(c, 'A_eligibility_only').claimed_reachable).toBe(10);
  });

  it('全是 pending 措施：B、C、D 不用 pending，joint 主结果也不含 pending', () => {
    const sc: Scenario = { ...DL, interventions: DL.interventions.map((iv) => ({ ...iv, status: 'pending' as const })) };
    const c = compareBaselines(sc);
    expectConsistent(sc, {}, c);
    for (const r of c.rows) {
      expect(r.plan.selected_intervention_ids).toEqual([]);
      expect(r.verified?.G).toBe(0);
    }
  });

  it('预算 0：B 原方案超预算，截断后一个对都保留不了；C 付不起固定成本，不选任何措施', () => {
    const sc = withBudget(DL, 0);
    const c = compareBaselines(sc);
    expectConsistent(sc, {}, c);
    const b = row(c, 'B_student_side');
    expect(fails(b)).toContain('budget');
    expect(b.repaired).toMatchObject({ R1_count: 0, G: 0, total_usd: 0 });
    expect(b.repaired!.note).toContain('kept 0 pairs, skipped 10 pairs');
    const cc = row(c, 'C_organizer_side');
    expect(cc.plan.selected_intervention_ids).toEqual([]);
    expect(cc.claimed_reachable).toBe(0);
    expect(row(c, 'joint').verified?.G).toBe(0);
  });
});
