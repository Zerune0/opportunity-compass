/**
 * runWhatIf 视图模型测试（演示场景 data/scenarios/device-loan.json，全部示例 / 模拟数据）。
 * 手算依据见 ./joint.test.ts 文件头：10 名示例学生都缺笔记本，借用名额 5（单一时段），
 * 设备借用固定 $100 + 每人 $20；线上入口 requires 设备借用；卫星会场 pending。
 */
import { describe, expect, it } from 'vitest';
import {
  DEVICE_LOAN_IDS as IDS,
  SCENARIOS,
  VENUE_TRADEOFF_IDS as V,
  assertScenarioShape,
  deviceLoanScenario,
  venueTradeoffScenario,
} from './scenarios';
import {
  defaultWhatIfInput,
  INFEASIBLE_UNCOVERED_CAUSE,
  MODE_EXPLANATIONS,
  PROTECT_LOSS_NOTE,
  missingPrerequisites,
  runWhatIf,
  scrubStudentInfo,
  WHATIF_LABELS,
} from './whatif';
import type { WhatIfView } from './whatif';
import type { Intervention, Scenario } from '../types';

const S = deviceLoanScenario;
const LAPTOP = IDS.laptopLoan;
const SUBSIDY = IDS.transportSubsidy;
const ONLINE = IDS.onlineEntry;
const SATELLITE = IDS.satelliteVenue;

function assertNoStudentInfo(view: WhatIfView, sc: Scenario = S) {
  const json = JSON.stringify(view);
  for (const s of sc.students) {
    expect(json.includes(s.id), `contains student id ${s.id}`).toBe(false);
    expect(json.includes(s.display_name), `contains name ${s.display_name}`).toBe(false);
    if (s.school_name) expect(json.includes(s.school_name), `contains school ${s.school_name}`).toBe(false);
  }
}

describe('runWhatIf', () => {
  it('只启用设备借用、预算充足：G=5、L=0、N=5、OPTIMAL、独立复核通过', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [], budget: 400 });
    expect(v.status).toBe('OPTIMAL');
    expect(v.status_label).toBe('Optimal plan found');
    expect([v.G, v.L, v.N]).toEqual([5, 0, 5]);
    expect(v.R0_count).toBe(0);
    expect(v.R1_count).toBe(5);
    expect(v.student_count).toBe(10);
    expect(v.cost).toEqual({ fixed_usd: 100, per_student_usd: 100, total_usd: 200, budget_usd: 400, remaining_usd: 200 });
    expect(v.selected).toEqual([
      expect.objectContaining({ id: LAPTOP, students_served: 5, subtotal_usd: 200 }),
    ]);
    expect(v.capacity_usage[0].slots[0]).toMatchObject({ used: 5, capacity: 5, full: true });
    expect(v.verification.passed).toBe(true);
    expect(v.verification.checks.length).toBeGreaterThan(5);
    expect(v.verification.checks.every((c) => c.passed && c.label.length > 0)).toBe(true);
    expect(v.alternative).toBeNull();
    expect(v.conditional).toBeNull();
    // 仍未覆盖的 5 人：缺设备，名额已满（只给人数）。单机会场景：5 个对 = 5 名学生，他们都没有任何可达的机会。
    expect(v.uncovered?.students).toBe(5);
    expect(v.uncovered).toMatchObject({ pairs: 5, students: 5, students_with_some_reachable: 0, students_with_none_reachable: 5 });
    expect(v.uncovered?.summary).toBe(
      '5 (student, opportunity) pairs are still not reachable after the plan, involving 5 sample students; 0 of them still have at least one reachable opportunity after the plan, and 5 students have no reachable opportunity after the plan.',
    );
    expect(v.uncovered?.reasons.find((r) => r.kind === 'device')).toMatchObject({ pairs: 5, students: 5, cause: 'capacity is full' });
    assertNoStudentInfo(v);
  });

  it('设备借用设为必须启用、预算不足：INFEASIBLE，有 alternative 并写明放松了什么', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [LAPTOP], budget: 50 });
    expect(v.status).toBe('INFEASIBLE');
    expect(v.status_label).toBe('Not achievable');
    expect([v.G, v.L, v.N]).toEqual([0, 0, 0]);
    expect(v.alternative).not.toBeNull();
    expect(v.alternative!.relaxed.length).toBeGreaterThan(0);
    expect(v.alternative!.note).toContain('relaxes');
    expect(v.alternative!.note).toContain('Laptop loan (sample)');
    expect(v.verification.note).not.toBeNull();
    assertNoStudentInfo(v);
  });

  it('纳入待审批措施时给出 conditional，且 assumptions 写明待审批未计入', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP, SUBSIDY, SATELLITE], requiredIds: [], budget: 400 });
    expect(v.conditional).not.toBeNull();
    expect(v.conditional!.assumed_approved).toEqual(['Satellite venue (sample, pending approval)']);
    expect(v.conditional!.note).toContain('Not in effect yet');
    expect(v.conditional!.delta.N).toBe(v.conditional!.N - v.N!);
    expect(v.selected.some((x) => x.id === SATELLITE)).toBe(false);
    expect(v.assumptions.some((a) => a.includes('pending approval') && a.includes('not counted in the current result'))).toBe(true);
    assertNoStudentInfo(v);
  });

  it('默认输入下序列化结果不含任何学生 id、姓名、学校；labels 含必需标注', () => {
    const v = runWhatIf(S, defaultWhatIfInput(S));
    assertNoStudentInfo(v);
    expect(v.labels.simulation).toBe('Simulated results. They do not represent real-world impact.');
    expect(v.labels.sample).toContain('Sample');
    expect(v.labels).toEqual(WHATIF_LABELS);
    expect(v.opportunities.every((o) => o.is_placeholder)).toBe(true);
  });

  it('assumptions 覆盖：示例 / 占位机会 / 可达≠录取 / 接受资源 / 示例成本 / 评估日期 / 待审批', () => {
    const v = runWhatIf(S, defaultWhatIfInput(S));
    const all = v.assumptions.join('\n');
    for (const kw of ['sample / simulated', 'placeholders', 'does not mean admitted', 'accept the resources they are given', 'sample numbers', S.evaluation_date, 'pending approval']) {
      expect(all).toContain(kw);
    }
  });

  it('前置依赖未纳入：线上入口被排除（不参与求解）并写明原因，不悄悄生效', () => {
    const v = runWhatIf(S, { enabledIds: [ONLINE, SUBSIDY], requiredIds: [ONLINE], budget: 400 });
    expect(v.effective.enabled_ids).toEqual([SUBSIDY]);
    expect(v.excluded).toHaveLength(1);
    expect(v.excluded[0]).toMatchObject({ id: ONLINE, missing_requires: ['Laptop loan (sample)'] });
    expect(v.selected.some((x) => x.id === ONLINE)).toBe(false);
    expect(v.ignored_required.map((r) => r.id)).toEqual([ONLINE]);
    expect(v.effective.required_ids).toEqual([]);
    expect(v.assumptions.some((a) => a.includes('Online participation option') && a.includes('requires'))).toBe(true);
    // 依赖一起纳入时不排除
    const v2 = runWhatIf(S, { enabledIds: [ONLINE, LAPTOP], requiredIds: [], budget: 400 });
    expect(v2.excluded).toEqual([]);
    expect(v2.effective.enabled_ids).toEqual([LAPTOP, ONLINE]);
  });

  it('必须启用的措施不在纳入范围内：忽略并说明', () => {
    const v = runWhatIf(S, { enabledIds: [SUBSIDY], requiredIds: [LAPTOP], budget: 400 });
    expect(v.ignored_required).toEqual([expect.objectContaining({ id: LAPTOP })]);
    expect(v.status).not.toBe('INFEASIBLE');
  });

  it('输入不合法（负预算）：UNSUPPORTED_INPUT，uncovered 为 null', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [], budget: -1 });
    expect(v.status).toBe('UNSUPPORTED_INPUT');
    expect(v.uncovered).toBeNull();
    expect(v.verification.passed).toBe(false);
    assertNoStudentInfo(v);
  });

  it('确定性：同输入同输出，且不修改输入', () => {
    const before = JSON.stringify(S);
    const input = defaultWhatIfInput(S);
    const a = runWhatIf(S, input);
    const b = runWhatIf(S, defaultWhatIfInput(S));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(S)).toBe(before);
    expect(input).toEqual(defaultWhatIfInput(S));
  });

  it('scrubStudentInfo 替换 id / 姓名 / 学校，并注明人数（长 id 优先，dl-s1 不误伤 dl-s10）', () => {
    const t = scrubStudentInfo('Over capacity ("dl-s01", "dl-s10", Example Harbor High School (fictional))', S);
    expect(t).not.toContain('dl-s');
    expect(t).not.toContain('Example Harbor');
    expect(t).toContain('a student');
    expect(t).toContain('involves');
    expect(scrubStudentInfo('No student info', S)).toBe('No student info');
  });

  it('scrubStudentInfo：短姓名 / 学校名不做子串替换（"X" 不改坏 "Xavier"），id 仍按边界替换', () => {
    const sc: Scenario = {
      ...S,
      students: [{ ...S.students[0], id: 'q1', display_name: 'Al', school_name: 'X' }],
    };
    const t = scrubStudentInfo('Teacher of Xavier and Alice; "q1"; q10 and aq1 are not student ids', sc);
    expect(t).toContain('Xavier');
    expect(t).toContain('Alice');
    expect(t).toContain('"a student"');
    expect(t).toContain('q10');
    expect(t).toContain('aq1');
    expect(t).toContain('involves 1 student; identities hidden');
    // 先长后短：s1 与 s10 同时存在时各自只替换自己
    const sc2: Scenario = {
      ...S,
      students: [
        { ...S.students[0], id: 's1', display_name: 'Bo', school_name: null },
        { ...S.students[1], id: 's10', display_name: 'Cy', school_name: null },
      ],
    };
    expect(scrubStudentInfo('"s10", "s1"', sc2)).toBe('"a student", "a student" (involves 2 students; identities hidden)');
  });
});

describe('runWhatIf：输入无效时的防线（M-a）', () => {
  const ALL = S.interventions.map((iv) => iv.id);
  const bad: [string, Parameters<typeof runWhatIf>[1]][] = [
    ['budget NaN', { enabledIds: ALL, requiredIds: [], budget: NaN }],
    ['budget Infinity', { enabledIds: ALL, requiredIds: [], budget: Infinity }],
    ['budget -Infinity', { enabledIds: ALL, requiredIds: [], budget: -Infinity }],
    ['negative budget', { enabledIds: ALL, requiredIds: [], budget: -5 }],
    ['minGain NaN', { enabledIds: ALL, requiredIds: [], budget: 400, minGain: NaN }],
    ['minGain Infinity', { enabledIds: ALL, requiredIds: [], budget: 400, minGain: Infinity }],
  ];
  for (const [name, input] of bad) {
    it(`${name}：不抛错，序列化结果不含 NaN / Infinity / undefined`, () => {
      let v: WhatIfView | undefined;
      expect(() => {
        v = runWhatIf(S, input);
      }).not.toThrow();
      const json = JSON.stringify(v);
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `contains ${w}`).toBe(false);
      assertNoStudentInfo(v!);
    });
  }

  it('预算非有限数：budget_usd 为 null，文字用「未填写或无效」', () => {
    const v = runWhatIf(S, { enabledIds: ALL, requiredIds: [], budget: NaN });
    expect(v.cost.budget_usd).toBeNull();
    expect(v.effective.budget_usd).toBeNull();
    expect(v.cost.remaining_usd).toBeNull();
  });
});

describe('runWhatIf：UNSUPPORTED_INPUT 时没有评估的数字为 null（S2）', () => {
  it('负预算：成本、余额、G / L / N 都是 null，预算本身照常显示', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [], budget: -1 });
    expect(v.status).toBe('UNSUPPORTED_INPUT');
    expect(v.cost).toEqual({ fixed_usd: null, per_student_usd: null, total_usd: null, budget_usd: -1, remaining_usd: null });
    expect([v.R0_count, v.R1_count, v.G, v.L, v.N]).toEqual([null, null, null, null, null]);
  });
});

describe('runWhatIf：INFEASIBLE 时「仍未覆盖」的原因（S1）', () => {
  const ALL = S.interventions.map((iv) => iv.id);
  const cases: [string, Parameters<typeof runWhatIf>[1]][] = [
    ['min gain target 6 (at most 5 possible)', { enabledIds: ALL, requiredIds: [], budget: 400, minGain: 6 }],
    ['require the pending satellite venue', { enabledIds: ALL, requiredIds: [SATELLITE], budget: 400 }],
  ];
  for (const [name, input] of cases) {
    it(name, () => {
      const v = runWhatIf(S, input);
      expect(v.status).toBe('INFEASIBLE');
      expect(v.uncovered).not.toBeNull();
      expect(v.uncovered!.students).toBe(10);
      const barrierReasons = v.uncovered!.reasons.filter((r) => r.kind !== 'eligibility' && r.kind !== 'unknown');
      expect(barrierReasons.length).toBeGreaterThan(0);
      for (const r of barrierReasons) {
        expect(r.cause).toBe(INFEASIBLE_UNCOVERED_CAUSE);
        expect(r.text).not.toContain('mutually exclusive');
        expect(r.text).not.toContain('capacity is full');
      }
      assertNoStudentInfo(v);
    });
  }
});

describe('missingPrerequisites（S5：一键纳入补齐传递依赖）', () => {
  const iv = (id: string, requires?: string[]): Intervention => ({
    id,
    title: `Support measure ${id}`,
    type: 'device',
    resolves: ['device'],
    unit_cost_usd: 0,
    capacity: null,
    status: 'approved',
    ...(requires ? { requires } : {}),
  });
  const chain: Scenario = { ...S, interventions: [iv('a'), iv('b', ['a']), iv('c', ['b']), iv('d', ['c', 'a'])] };

  it('演示场景：线上入口缺设备借用', () => {
    expect(missingPrerequisites(S, [ONLINE], ONLINE)).toEqual([LAPTOP]);
    expect(missingPrerequisites(S, [ONLINE, LAPTOP], ONLINE)).toEqual([]);
  });
  it('传递闭包：d → c → b → a，全部缺失时都列出（按场景顺序）', () => {
    expect(missingPrerequisites(chain, ['d'], 'd')).toEqual(['a', 'b', 'c']);
    expect(missingPrerequisites(chain, ['d', 'b'], 'd')).toEqual(['a', 'c']);
    expect(missingPrerequisites(chain, ['a', 'b', 'c', 'd'], 'd')).toEqual([]);
  });
  it('补上后不再被排除；有环也不死循环', () => {
    const add = missingPrerequisites(chain, ['d'], 'd');
    const v = runWhatIf(chain, { enabledIds: ['d', ...add], requiredIds: [], budget: 400 });
    expect(v.excluded).toEqual([]);
    const cyc: Scenario = { ...S, interventions: [iv('p', ['q']), iv('q', ['p'])] };
    expect(missingPrerequisites(cyc, [], 'p')).toEqual(['q']);
  });
});

describe('assertScenarioShape：措施不得含学生信息（S4）', () => {
  it('措施 id 含学生 id（ride-dl-s03）被拒绝', () => {
    const bad = {
      ...S,
      interventions: [...S.interventions, { ...S.interventions[1], id: 'ride-dl-s03', title: 'Ride (sample)' }],
    };
    expect(() => assertScenarioShape(bad, 'bad')).toThrow(/dl-s03/);
  });
  it('措施标题含学生姓名或学校名被拒绝', () => {
    const s0 = S.students[0];
    const byName = { ...S, interventions: [{ ...S.interventions[0], title: `Laptop for ${s0.display_name}` }] };
    expect(() => assertScenarioShape(byName)).toThrow(/student display name/);
    const bySchool = { ...S, interventions: [{ ...S.interventions[0], title: `${s0.school_name} shuttle` }] };
    expect(() => assertScenarioShape(bySchool)).toThrow(/school name/);
  });
  it('短姓名 / 学校名（< 3 字符）不参与校验；演示场景本身通过', () => {
    const sc = {
      ...S,
      students: [{ ...S.students[0], id: 'q1', display_name: 'Al', school_name: 'X' }],
      interventions: [{ ...S.interventions[0], title: "Xavier's Alpha laptop" }],
    };
    expect(() => assertScenarioShape(sc)).not.toThrow();
    expect(() => assertScenarioShape(S)).not.toThrow();
  });
});


// ───────────────────────────── 第 3 层：模式、损失、公平底线、基线 ─────────────────────────────

const VT = venueTradeoffScenario;
const DL_FLOORS = SCENARIOS[0].suggestedFairnessFloors;
const VT_FLOORS = SCENARIOS[1].suggestedFairnessFloors;
const LOW_INCOME = 'floor-low-income';
const vtInput = (extra: Partial<Parameters<typeof runWhatIf>[1]> = {}) => ({ ...defaultWhatIfInput(VT), ...extra });
const dlInput = (extra: Partial<Parameters<typeof runWhatIf>[1]> = {}) => ({ ...defaultWhatIfInput(S), ...extra });

describe('runWhatIf：权衡场景（手算见 ./solve-tradeoff.test.ts 文件头）', () => {
  it('保护模式：G 2 / L 0 / N 2、$50；写明不收回任何已有资源', () => {
    const v = runWhatIf(VT, vtInput(), VT_FLOORS);
    expect(v.status).toBe('OPTIMAL');
    expect([v.R0_count, v.R1_count, v.G, v.L, v.N]).toEqual([3, 5, 2, 0, 2]);
    expect(v.cost.total_usd).toBe(50);
    expect(v.mode).toBe('protect');
    expect(v.mode_label).toBe('Protected mode');
    expect(v.mode_explanation).toBe(MODE_EXPLANATIONS.protect);
    expect(v.loss_cap).toBeNull();
    expect(v.loss).toEqual({
      lost_pairs: 0,
      affected_students: 0,
      affected_students_still_reachable: 0,
      summary: null,
      groups: [],
      headline: null,
      protect_note: PROTECT_LOSS_NOTE,
    });
    expect(v.revocations).toEqual({ total: 0, forced: 0, voluntary: 0, pending: 0, items: [] });
    expect(v.fairness).toEqual([]);
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)?.slots[0]).toMatchObject({ used: 3, full: true });
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式、损失上限 2：与保护模式相同（卫星会场会失去 3 个）', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 2 }));
    expect([v.G, v.L, v.N]).toEqual([2, 0, 2]);
    expect(v.mode_label).toBe('Trade-off mode');
    expect(v.loss_cap).toBe(2);
    expect(v.loss?.headline).toBeNull();
    expect(v.loss?.protect_note).toBeNull();
    expect(v.revocations?.total).toBe(0);
    expect(v.assumptions.some((a) => a.includes('What trade-off mode means') && a.includes('loss cap of 2'))).toBe(true);
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式、损失上限 3：G 6 / L 3 / N 3、$140；失去与收回只给汇总', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3 }));
    expect(v.status).toBe('OPTIMAL');
    expect([v.R0_count, v.R1_count, v.G, v.L, v.N]).toEqual([3, 6, 6, 3, 3]);
    expect(v.cost).toMatchObject({ fixed_usd: 80, per_student_usd: 60, total_usd: 140, remaining_usd: 160 });
    expect(v.loss?.lost_pairs).toBe(3);
    expect(v.loss?.affected_students).toBe(3);
    expect(v.loss?.headline).toBe('To add 6 newly reachable pairs, 3 previously reachable (student, opportunity) pairs are no longer reachable under this plan.');
    expect(v.loss?.groups).toEqual([
      expect.objectContaining({
        revoked_title: 'Weekday shuttle (sample, already running)',
        forced_by_title: 'Weekend satellite venue (sample)',
        revoked_count: 3,
        students: 3,
        pairs: 3,
      }),
    ]);
    expect(v.revocations).toMatchObject({ total: 3, forced: 3, voluntary: 0 });
    expect(v.revocations?.items).toEqual([
      { title: 'Weekday shuttle (sample, already running)', count: 3, reason: expect.stringContaining('Mutually exclusive with') },
    ]);
    // 被收回的接驳车不再占名额
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)?.slots[0]).toMatchObject({ used: 0, full: false });
    expect(v.uncovered?.reasons.find((r) => r.kind === 'revoked')).toMatchObject({ students: 3 });
    expect(v.verification.passed).toBe(true);
    expect(v.verification.checks.find((c) => c.name === 'revocation')?.label).toBe('Rules for revoking existing resources');
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式 + 低收入底线：底线结果按人数与比例给出', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3, fairnessFloorIds: [LOW_INCOME] }), VT_FLOORS);
    expect([v.G, v.L, v.N]).toEqual([6, 3, 3]);
    expect(v.effective.fairness_floor_ids).toEqual([LOW_INCOME]);
    expect(v.fairness).toEqual([
      expect.objectContaining({
        floor_id: LOW_INCOME,
        label: 'Low-income students',
        eligible_members: 4,
        covered_members: 2,
        ratio_percent: 50,
        min_ratio_percent: 50,
        satisfied: true,
        not_applicable: false,
      }),
    ]);
    expect(v.fairness[0].basis).toContain('Sample');
    assertNoStudentInfo(v, VT);
  });
});

describe('runWhatIf：设备借用场景的公平底线', () => {
  it('不设底线：fairness 为空，G = 5', () => {
    const v = runWhatIf(S, dlInput(), DL_FLOORS);
    expect(v.fairness).toEqual([]);
    expect(v.G).toBe(5);
  });

  it('低收入 ≥ 50%：G 仍为 5、$200，覆盖 2 / 4', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect([v.G, v.L, v.N, v.cost.total_usd]).toEqual([5, 0, 5, 200]);
    expect(v.fairness[0]).toMatchObject({ eligible_members: 4, covered_members: 2, ratio_percent: 50, satisfied: true });
    expect(v.verification.checks.find((c) => c.name === 'fairness')).toMatchObject({ passed: true, label: 'Fairness floors' });
    assertNoStudentInfo(v);
  });

  it('比例覆盖为 100%：4 / 4，多用一份交通补助（$225）', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } }), DL_FLOORS);
    expect(v.status).toBe('OPTIMAL');
    expect(v.fairness[0]).toMatchObject({ covered_members: 4, ratio_percent: 100, min_ratio_percent: 100, satisfied: true });
    expect(v.cost.total_usd).toBe(225);
    expect(v.G).toBe(5);
  });

  it('没勾选的底线即使有覆盖值也不参与', () => {
    const v = runWhatIf(S, dlInput({ minRatioOverrides: { [LOW_INCOME]: 1 } }), DL_FLOORS);
    expect(v.fairness).toEqual([]);
    expect(v.cost.total_usd).toBe(200);
  });
});

describe('runWhatIf：基线对比表格', () => {
  it('设备借用默认：4 行，声称 / 复核 / 截断数字', () => {
    const v = runWhatIf(S, dlInput());
    const rows = v.baselines!.rows;
    expect(rows.map((r) => r.id)).toEqual(['A_eligibility_only', 'B_student_side', 'C_organizer_side', 'joint']);
    expect(rows.map((r) => r.claimed_reachable)).toEqual([10, 10, 7, 5]);
    expect(rows.map((r) => r.executable)).toEqual([true, false, true, true]);
    expect(rows.map((r) => r.verified?.G ?? null)).toEqual([0, null, 5, 5]);
    expect(rows[1].failed_checks).toEqual(['Within capacity', 'Within budget']);
    expect(rows[1].repaired).toMatchObject({ G: 5, total_usd: 350 });
    expect(rows[2].verified?.total_usd).toBe(350);
    expect(rows[3].verified?.total_usd).toBe(200);
    expect(rows.map((r) => r.soft_label)).toEqual(['No requirement set', 'No requirement set', 'No requirement set', 'No requirement set']);
    expect(v.baselines!.notes.join('')).toContain('Baseline D');
    // 视图里的基线行不带方案（方案里有学生 id）
    for (const r of rows) expect(Object.keys(r)).not.toContain('plan');
  });

  it('带底线时：不可执行的行写「方案不可执行，不评估」', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect(v.baselines!.rows.map((r) => r.soft_label)).toEqual(['Not met', 'Plan not executable; not evaluated', 'Not met', 'Met']);
  });

  it('输入不合法（负预算）：基线 rows 为空，notes 写明原因', () => {
    const v = runWhatIf(S, dlInput({ budget: -1 }));
    expect(v.baselines?.rows).toEqual([]);
    expect(v.baselines?.notes[0]).toContain('no baseline comparison was run');
  });
});

describe('runWhatIf：视图不含任何学生标识（两个场景、各种模式）', () => {
  const cases: [string, Scenario, Parameters<typeof runWhatIf>[1]][] = [
    ['device loan default', S, dlInput()],
    ['device loan + floor 100%', S, dlInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } })],
    ['device loan tradeoff 0', S, dlInput({ mode: 'tradeoff', lossCap: 0 })],
    ['device loan min gain 6 (not achievable)', S, dlInput({ minGain: 6, fairnessFloorIds: [LOW_INCOME] })],
    ['device loan laptop only, budget 0', S, dlInput({ enabledIds: [LAPTOP], budget: 0 })],
    ['trade-off protect', VT, vtInput()],
    ['trade-off tradeoff 2', VT, vtInput({ mode: 'tradeoff', lossCap: 2 })],
    ['trade-off tradeoff 3', VT, vtInput({ mode: 'tradeoff', lossCap: 3 })],
    ['trade-off tradeoff 3 + floor', VT, vtInput({ mode: 'tradeoff', lossCap: 3, fairnessFloorIds: [LOW_INCOME] })],
    ['trade-off tradeoff 9 + floor 100%', VT, vtInput({ mode: 'tradeoff', lossCap: 9, fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } })],
    ['trade-off require satellite venue (not achievable in protect)', VT, vtInput({ requiredIds: [V.weekendSatellite] })],
    ['trade-off tradeoff without cap', VT, vtInput({ mode: 'tradeoff', lossCap: null })],
  ];
  for (const [name, sc, input] of cases) {
    it(name, () => {
      const floors = sc === S ? DL_FLOORS : VT_FLOORS;
      const v = runWhatIf(sc, input, floors);
      assertNoStudentInfo(v, sc);
      // 也不含已有 grant 的 id（它们和具体学生一一对应）
      const json = JSON.stringify(v);
      for (const g of sc.existing_grants ?? []) expect(json.includes(g.id), `contains grant id ${g.id}`).toBe(false);
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `contains ${w}`).toBe(false);
    });
  }
});

describe('runWhatIf：损失上限 / 底线比例不合法时不调用求解器', () => {
  const bad: [string, Parameters<typeof runWhatIf>[1], RegExp][] = [
    ['tradeoff without cap (null)', vtInput({ mode: 'tradeoff', lossCap: null }), /needs a loss cap/],
    ['tradeoff without cap (omitted)', { ...vtInput({ mode: 'tradeoff' }), lossCap: undefined }, /needs a loss cap/],
    ['negative cap', vtInput({ mode: 'tradeoff', lossCap: -1 }), /whole number, 0 or more/],
    ['cap not an integer', vtInput({ mode: 'tradeoff', lossCap: 1.5 }), /whole number, 0 or more/],
    ['cap NaN', vtInput({ mode: 'tradeoff', lossCap: NaN }), /whole number, 0 or more/],
    ['cap Infinity', vtInput({ mode: 'tradeoff', lossCap: Infinity }), /whole number, 0 or more/],
    ['floor ratio 1.5', vtInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1.5 } }), /0% to 100%/],
    ['floor ratio NaN', vtInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: NaN } }), /0% to 100%/],
    ['unknown floor', vtInput({ fairnessFloorIds: ['nope'] }), /The selected fairness floor \(nope\) was not found/],
  ];
  for (const [name, input, re] of bad) {
    it(name, () => {
      const v = runWhatIf(VT, input, VT_FLOORS);
      expect(v.input_errors.length).toBeGreaterThan(0);
      expect(v.input_errors.join('')).toMatch(re);
      expect(v.status).toBe('UNSUPPORTED_INPUT');
      expect(v.status_explanation).toMatch(re);
      expect([v.R0_count, v.R1_count, v.G, v.L, v.N]).toEqual([null, null, null, null, null]);
      expect(v.loss).toBeNull();
      expect(v.revocations).toBeNull();
      expect(v.baselines).toBeNull();
      expect(v.solver_notes).toEqual([]);
      expect(v.verification.checks).toEqual([]);
      expect(v.effective.loss_cap).toBeNull();
      const json = JSON.stringify(v);
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `contains ${w}`).toBe(false);
      assertNoStudentInfo(v, VT);
    });
  }

  it('保护模式下的损失上限被忽略（不报错，也不传给求解器）', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'protect', lossCap: -1 }));
    expect(v.input_errors).toEqual([]);
    expect(v.loss_cap).toBeNull();
    expect([v.G, v.L, v.N]).toEqual([2, 0, 2]);
  });

  it('上限 0 合法：与保护模式数字相同', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 0 }));
    expect(v.input_errors).toEqual([]);
    expect([v.G, v.L, v.N]).toEqual([2, 0, 2]);
  });
});

describe('runWhatIf：替代方案 / 条件性方案也带 L、收回与公平', () => {
  it('权衡场景必须启用卫星会场：protect 做不到，替代方案放松「必须启用」', () => {
    const v = runWhatIf(VT, vtInput({ requiredIds: [V.weekendSatellite] }));
    expect(v.status).toBe('INFEASIBLE');
    expect(v.alternative).toMatchObject({ G: 2, L: 0, revocation_counts: { total: 0, forced: 0, voluntary: 0 }, loss_text: null });
    expect(v.alternative!.fairness).toEqual([]);
  });

  it('权衡 tradeoff 3 + 必须启用拼车：替代方案的 L 与收回汇总', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3, requiredIds: [V.weekdayCarpool], minGain: 6 }));
    expect(v.status).toBe('INFEASIBLE');
    const alt = v.alternative!;
    expect(alt.N).toBe(alt.G - alt.L);
    if (alt.L > 0) expect(alt.loss_text).toContain(`Lost ${alt.L} previously reachable`);
    expect(alt.revocation_counts.total).toBe(alt.revocation_counts.forced + alt.revocation_counts.voluntary);
    assertNoStudentInfo(v, VT);
  });

  it('设备借用纳入待审批卫星会场 + 底线：conditional 带公平结果', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect(v.conditional).not.toBeNull();
    expect(v.conditional!.fairness).toHaveLength(1);
    expect(v.conditional!.revocation_counts).toEqual({ total: 0, forced: 0, voluntary: 0, pending: 0 });
  });

  it('假设与不确定性补充了模式、公平底线方法与基线说明', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    const all = v.assumptions.join('\n');
    for (const kw of ['Protected mode', 'report themselves', 'The denominator counts only', 'counts once in each group', 'do not represent any real system', 'Baseline D', 'fictional basis']) {
      expect(all).toContain(kw);
    }
  });
});

describe('runWhatIf：运行中的措施、底线上界、待审批收回（R2 / R4 / R5）', () => {
  it('权衡场景默认：接驳车标为运行中、接受新分配；其他措施不在 running 里', () => {
    const v = runWhatIf(VT, vtInput());
    expect(v.running).toEqual([
      expect.objectContaining({ id: V.weekdayShuttle, existing_grants: 3, accepts_new: true }),
    ]);
    expect(v.running[0].note).toContain('already has 3 resources in use and cannot be removed from the plan; unchecking it only stops new allocations');
    expect(v.effective.frozen_ids).toEqual([]);
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)).toMatchObject({ running: true, frozen: false });
  });

  it('只勾选卫星会场：接驳车仍运行（不再新增分配），保护模式 G = 0；权衡上限 3 → G 6 / L 3 / N 3', () => {
    const p = runWhatIf(VT, vtInput({ enabledIds: [V.weekendSatellite] }));
    expect(p.running).toEqual([expect.objectContaining({ id: V.weekdayShuttle, accepts_new: false })]);
    expect(p.running[0].note).toContain('Unchecked this time');
    expect(p.effective.enabled_ids).toEqual([V.weekendSatellite]);
    expect(p.effective.frozen_ids).toEqual([V.weekdayShuttle]);
    expect(p.excluded).toEqual([]);
    expect([p.G, p.L, p.N]).toEqual([0, 0, 0]);
    expect(p.selected).toEqual([]);
    // 运行中的接驳车照常占名额，标为不再新增分配。
    expect(p.capacity_usage.find((c) => c.id === V.weekdayShuttle)).toMatchObject({
      running: true,
      frozen: true,
      selected: false,
      slots: [expect.objectContaining({ used: 3, capacity: 3, full: true })],
    });
    expect(p.assumptions.some((a) => a.includes('cannot be removed from the plan'))).toBe(true);
    expect(p.verification.passed).toBe(true);
    const t = runWhatIf(VT, vtInput({ enabledIds: [V.weekendSatellite], mode: 'tradeoff', lossCap: 3 }));
    expect([t.G, t.L, t.N]).toEqual([6, 3, 3]);
    expect(t.revocations).toMatchObject({ total: 3, forced: 3, pending: 0 });
    expect(t.capacity_usage.find((c) => c.id === V.weekdayShuttle)?.slots[0]).toMatchObject({ used: 0 });
    expect(t.verification.passed).toBe(true);
    assertNoStudentInfo(t, VT);
  });

  it('公平底线结果给出「当前启用的措施下最多可覆盖 X / Y」，分母不变', () => {
    const v = runWhatIf(S, dlInput({ enabledIds: [LAPTOP], fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } }), DL_FLOORS);
    expect(v.status).toBe('INFEASIBLE');
    expect(v.fairness).toEqual([
      expect.objectContaining({ eligible_members: 4, covered_members: 0, max_coverable: 3 }),
    ]);
    expect(v.fairness[0].bound_text).toContain('With the enabled support measures, at most 3 / 4 can be covered');
    expect(v.fairness[0].bound_text).toContain('still count in the denominator');
    expect(v.alternative?.fairness[0]).toMatchObject({ covered_members: 1, max_coverable: 3 });
    const all = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect(all.fairness[0]).toMatchObject({ max_coverable: 4 });
    expect(all.fairness[0].bound_text).toContain('may not be reachable all at once');
    assertNoStudentInfo(v);
  });

  it('权衡模式、损失上限 0：收回待审批承诺单独计数（不计入损失）', () => {
    const sc: Scenario = {
      ...VT,
      students: VT.students.map((s, k) => (k === 0 ? { ...s, grade: 8 } : s)), // vt-s01 不符合资格，本来就不可达
      interventions: VT.interventions.filter((iv) => iv.id === V.weekdayShuttle).map((iv) => ({ ...iv, capacity: 1, mutually_exclusive_with: [] })),
      existing_grants: [{ ...VT.existing_grants![0], status: 'pending' }],
    };
    const p = runWhatIf(sc, { ...defaultWhatIfInput(sc) });
    expect([p.G, p.L]).toEqual([0, 0]);
    const t = runWhatIf(sc, { ...defaultWhatIfInput(sc), mode: 'tradeoff', lossCap: 0 });
    expect([t.G, t.L, t.N]).toEqual([1, 0, 1]);
    expect(t.revocations).toMatchObject({ total: 1, forced: 0, voluntary: 1, pending: 1 });
    expect(t.assumptions.some((a) => a.includes('A loss cap of 0 is still not the same as protected mode'))).toBe(true);
    assertNoStudentInfo(t, sc);
  });
});

describe('runWhatIf：多机会场景按（学生, 机会）对表述「仍未覆盖」与「失去」（必须修 2）', () => {
  /*
   * 手算（权衡场景 2 个机会 WD / WE × 9 名学生 = 18 个对；R0 = s01–s03 的 WD）：
   * - 保护模式：R1 = s01–s05 的 WD（5 个对）→ 仍不可达 13 个对，涉及 9 名学生；
   *   方案后至少有一个可达机会的：s01–s05 = 5 人；没有任何可达机会的：s06–s09 = 4 人。
   * - 权衡上限 3、无底线：启用卫星会场，强制收回接驳车 3 条 → s01–s03 的 WD 失去（L = 3，涉及 3 名学生）；
   *   卫星会场 6 个座位按编号给 s01–s06 的 WE → R1 = 6 个对。仍不可达 18 − 6 = 12 个对，涉及 9 名学生
   *   （9 名学生的 WD 都不可达）；至少有一个可达机会的：s01–s06 = 6 人；没有任何可达机会的：s07–s09 = 3 人。
   *   失去的 3 名学生（s01–s03）都拿到了周末场座位 → 3 名在方案后仍有其他可达的机会。
   *   原因：revoked 3 个对 / 3 人；transport：s04–s06 的 WD + s07–s09 的 WD、WE = 9 个对 / 6 人。
   * - 权衡上限 3 + 低收入底线（≥ 50%，低收入 s06–s09 共 4 人，至少覆盖 2 人）：6 个座位给 s01–s04、s06、s07
   *   （先满足底线，其余按编号）→ R1 仍为 6 个对、6 名学生；没有任何可达机会的：s05、s08、s09 = 3 人；
   *   失去的 s01–s03 都有周末场座位 → 仍有其他可达机会的 3 人。各项计数与无底线时相同。
   */
  it('保护模式：13 个对 / 9 名学生，其中 5 名仍有可达机会、4 名没有', () => {
    const v = runWhatIf(VT, vtInput(), VT_FLOORS);
    expect(v.uncovered).toMatchObject({ pairs: 13, students: 9, students_with_some_reachable: 5, students_with_none_reachable: 4 });
    expect(v.uncovered!.summary).toContain('13 (student, opportunity) pairs are still not reachable after the plan, involving 9 sample students');
    expect(v.uncovered!.reasons).toEqual([expect.objectContaining({ kind: 'transport', pairs: 13, students: 9 })]);
  });

  const tradeoffCases: [string, Partial<Parameters<typeof runWhatIf>[1]>][] = [
    ['no floor', {}],
    ['low-income floor', { fairnessFloorIds: [LOW_INCOME] }],
  ];
  for (const [name, extra] of tradeoffCases) {
    it(`权衡上限 3（${name}）：按对表述，失去的 3 名学生都仍有其他可达机会`, () => {
      const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3, ...extra }), VT_FLOORS);
      expect([v.G, v.L, v.N, v.R1_count]).toEqual([6, 3, 3, 6]);
      expect(v.uncovered).toMatchObject({ pairs: 12, students: 9, students_with_some_reachable: 6, students_with_none_reachable: 3 });
      expect(v.uncovered!.summary).toBe(
        '12 (student, opportunity) pairs are still not reachable after the plan, involving 9 sample students; 6 of them still have at least one reachable opportunity after the plan, and 3 students have no reachable opportunity after the plan.',
      );
      expect(v.uncovered!.reasons).toEqual([
        expect.objectContaining({ kind: 'revoked', pairs: 3, students: 3 }),
        expect.objectContaining({ kind: 'transport', pairs: 9, students: 6 }),
      ]);
      // 不再出现「X 人……不再可达 / 仍不可达」这类按人数的说法。
      for (const r of v.uncovered!.reasons) expect(r.text).toMatch(/^\d+ \(student, opportunity\) pairs/);
      expect(v.uncovered!.reasons[0].text).toContain(' (3 students)');
      expect(v.loss).toMatchObject({ lost_pairs: 3, affected_students: 3, affected_students_still_reachable: 3 });
      expect(v.loss!.summary).toBe('Lost 3 (student, opportunity) pairs, involving 3 students; 3 of them still have another reachable opportunity after the plan.');
      expect(v.loss!.groups).toEqual([expect.objectContaining({ pairs: 3, students: 3, students_still_reachable: 3 })]);
      expect(v.loss!.groups[0].text).toContain('lost 3 (student, opportunity) pairs, involving 3 students; 3 of them still have another reachable opportunity after the plan');
      expect(JSON.stringify(v.uncovered) + JSON.stringify(v.loss)).not.toMatch(/\d+ students[^,.]*no longer reachable/);
      assertNoStudentInfo(v, VT);
    });
  }
});

describe('runWhatIf：名额列表中运行中措施的已有资源被收回（建议修 1）', () => {
  it('权衡上限 3：接驳车 3 / 3 份全部收回、无新增 → 本方案中已停用', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3 }));
    const c = v.capacity_usage.find((x) => x.id === V.weekdayShuttle)!;
    expect(c).toMatchObject({ running: true, existing_grants: 3, revoked_existing: 3, deactivated: true });
    expect(c.status_note).toBe('(stopped in this plan; all existing resources revoked)');
    expect(c.status_note).not.toContain('used');
  });

  it('保护模式：接驳车没有收回，仍为「运行中，本方案没有新增分配」', () => {
    const v = runWhatIf(VT, vtInput());
    const c = v.capacity_usage.find((x) => x.id === V.weekdayShuttle)!;
    expect(c).toMatchObject({ revoked_existing: 0, deactivated: false, status_note: '(running, no new allocations in this plan)' });
  });

  it('收回后又有新分配：不算停用，注明收回了几份并显示剩余占用', () => {
    const sc: Scenario = {
      ...VT,
      students: VT.students.map((s, k) => (k === 0 ? { ...s, grade: 8 } : s)),
      interventions: VT.interventions.filter((iv) => iv.id === V.weekdayShuttle).map((iv) => ({ ...iv, capacity: 1, mutually_exclusive_with: [] })),
      existing_grants: [{ ...VT.existing_grants![0], status: 'pending' }],
    };
    const t = runWhatIf(sc, { ...defaultWhatIfInput(sc), mode: 'tradeoff', lossCap: 0 });
    const c = t.capacity_usage.find((x) => x.id === V.weekdayShuttle)!;
    expect(c).toMatchObject({ existing_grants: 1, revoked_existing: 1, deactivated: false });
    expect(c.status_note).toBe('(running; this plan revokes 1 / 1 existing resources; remaining usage below)');
    expect(c.slots[0]).toMatchObject({ used: 1, capacity: 1 });
  });
});

describe('runWhatIf：基线表同口径的复核后可达（必须修 1）', () => {
  it('权衡场景保护模式：联合求解声称 5、复核后可达 5', () => {
    const rows = runWhatIf(VT, vtInput()).baselines!.rows;
    // A 声称 18（全部符合资格），复核后可达 = R0 = 3；B 不可执行，截断后可达 5；C、联合求解声称与复核后都是 5。
    expect(rows.map((r) => [r.claimed_reachable, r.verified?.R1_count ?? null, r.repaired?.R1_count ?? null])).toEqual([
      [18, 3, null],
      [18, null, 5],
      [5, 5, null],
      [5, 5, null],
    ]);
    const B = rows.find((r) => r.id === 'B_student_side')!;
    const C = rows.find((r) => r.id === 'C_organizer_side')!;
    expect(B.description).toContain('never revokes an existing resource');
    expect(C.description).toContain('never revokes an existing resource');
  });
});
