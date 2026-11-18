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
    expect(json.includes(s.id), `含学生 id ${s.id}`).toBe(false);
    expect(json.includes(s.display_name), `含姓名 ${s.display_name}`).toBe(false);
    if (s.school_name) expect(json.includes(s.school_name), `含学校 ${s.school_name}`).toBe(false);
  }
}

describe('runWhatIf', () => {
  it('只启用设备借用、预算充足：G=5、L=0、N=5、OPTIMAL、独立复核通过', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [], budget: 400 });
    expect(v.status).toBe('OPTIMAL');
    expect(v.status_label).toBe('已找到最优方案');
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
    // 仍未覆盖的 5 人：缺设备，名额已满（只给人数）。
    expect(v.uncovered?.students).toBe(5);
    expect(v.uncovered?.reasons.find((r) => r.kind === 'device')).toMatchObject({ students: 5, cause: '名额已满' });
    assertNoStudentInfo(v);
  });

  it('设备借用设为必须启用、预算不足：INFEASIBLE，有 alternative 并写明放松了什么', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP], requiredIds: [LAPTOP], budget: 50 });
    expect(v.status).toBe('INFEASIBLE');
    expect(v.status_label).toBe('做不到');
    expect([v.G, v.L, v.N]).toEqual([0, 0, 0]);
    expect(v.alternative).not.toBeNull();
    expect(v.alternative!.relaxed.length).toBeGreaterThan(0);
    expect(v.alternative!.note).toContain('放松');
    expect(v.alternative!.note).toContain('笔记本电脑借用（示例）');
    expect(v.verification.note).not.toBeNull();
    assertNoStudentInfo(v);
  });

  it('纳入待审批措施时给出 conditional，且 assumptions 写明待审批未计入', () => {
    const v = runWhatIf(S, { enabledIds: [LAPTOP, SUBSIDY, SATELLITE], requiredIds: [], budget: 400 });
    expect(v.conditional).not.toBeNull();
    expect(v.conditional!.assumed_approved).toEqual(['卫星会场（示例，待审批）']);
    expect(v.conditional!.note).toContain('目前尚未生效');
    expect(v.conditional!.delta.N).toBe(v.conditional!.N - v.N!);
    expect(v.selected.some((x) => x.id === SATELLITE)).toBe(false);
    expect(v.assumptions.some((a) => a.includes('待审批') && a.includes('未计入当前结果'))).toBe(true);
    assertNoStudentInfo(v);
  });

  it('默认输入下序列化结果不含任何学生 id、姓名、学校；labels 含必需标注', () => {
    const v = runWhatIf(S, defaultWhatIfInput(S));
    assertNoStudentInfo(v);
    expect(v.labels.simulation).toBe('模拟结果，不代表真实影响');
    expect(v.labels.sample).toContain('示例');
    expect(v.labels).toEqual(WHATIF_LABELS);
    expect(v.opportunities.every((o) => o.is_placeholder)).toBe(true);
  });

  it('assumptions 覆盖：示例 / 占位机会 / 可达≠录取 / 接受资源 / 示例成本 / 评估日期 / 待审批', () => {
    const v = runWhatIf(S, defaultWhatIfInput(S));
    const all = v.assumptions.join('\n');
    for (const kw of ['示例 / 模拟', '占位', '不等于录取', '接受分配到的资源', '示例数字', S.evaluation_date, '待审批']) {
      expect(all).toContain(kw);
    }
  });

  it('前置依赖未纳入：线上入口被排除（不参与求解）并写明原因，不悄悄生效', () => {
    const v = runWhatIf(S, { enabledIds: [ONLINE, SUBSIDY], requiredIds: [ONLINE], budget: 400 });
    expect(v.effective.enabled_ids).toEqual([SUBSIDY]);
    expect(v.excluded).toHaveLength(1);
    expect(v.excluded[0]).toMatchObject({ id: ONLINE, missing_requires: ['笔记本电脑借用（示例）'] });
    expect(v.selected.some((x) => x.id === ONLINE)).toBe(false);
    expect(v.ignored_required.map((r) => r.id)).toEqual([ONLINE]);
    expect(v.effective.required_ids).toEqual([]);
    expect(v.assumptions.some((a) => a.includes('线上参与入口') && a.includes('需要同时纳入'))).toBe(true);
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
    const t = scrubStudentInfo('超出（「dl-s01」、「dl-s10」，Example Harbor High School（虚构））', S);
    expect(t).not.toContain('dl-s');
    expect(t).not.toContain('Example Harbor');
    expect(t).toContain('某学生');
    expect(t).toContain('涉及');
    expect(scrubStudentInfo('无学生信息', S)).toBe('无学生信息');
  });

  it('scrubStudentInfo：短姓名 / 学校名不做子串替换（"X" 不改坏 "Xavier"），id 仍按边界替换', () => {
    const sc: Scenario = {
      ...S,
      students: [{ ...S.students[0], id: 'q1', display_name: 'Al', school_name: 'X' }],
    };
    const t = scrubStudentInfo('Xavier 和 Alice 的老师；「q1」；q10 与 aq1 不是学生 id', sc);
    expect(t).toContain('Xavier');
    expect(t).toContain('Alice');
    expect(t).toContain('「某学生」');
    expect(t).toContain('q10');
    expect(t).toContain('aq1');
    expect(t).toContain('涉及 1 名学生');
    // 先长后短：s1 与 s10 同时存在时各自只替换自己
    const sc2: Scenario = {
      ...S,
      students: [
        { ...S.students[0], id: 's1', display_name: 'Bo', school_name: null },
        { ...S.students[1], id: 's10', display_name: 'Cy', school_name: null },
      ],
    };
    expect(scrubStudentInfo('「s10」、「s1」', sc2)).toBe('「某学生」、「某学生」（涉及 2 名学生，已隐去身份）');
  });
});

describe('runWhatIf：输入无效时的防线（M-a）', () => {
  const ALL = S.interventions.map((iv) => iv.id);
  const bad: [string, Parameters<typeof runWhatIf>[1]][] = [
    ['预算 NaN', { enabledIds: ALL, requiredIds: [], budget: NaN }],
    ['预算 Infinity', { enabledIds: ALL, requiredIds: [], budget: Infinity }],
    ['预算 -Infinity', { enabledIds: ALL, requiredIds: [], budget: -Infinity }],
    ['预算负数', { enabledIds: ALL, requiredIds: [], budget: -5 }],
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
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `含 ${w}`).toBe(false);
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
    ['最低新增目标 6（最多只能新增 5）', { enabledIds: ALL, requiredIds: [], budget: 400, minGain: 6 }],
    ['必须启用待审批的卫星会场', { enabledIds: ALL, requiredIds: [SATELLITE], budget: 400 }],
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
        expect(r.text).not.toContain('互斥');
        expect(r.text).not.toContain('名额已满');
      }
      assertNoStudentInfo(v);
    });
  }
});

describe('missingPrerequisites（S5：一键纳入补齐传递依赖）', () => {
  const iv = (id: string, requires?: string[]): Intervention => ({
    id,
    title: `措施 ${id}`,
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
      interventions: [...S.interventions, { ...S.interventions[1], id: 'ride-dl-s03', title: '接送（示例）' }],
    };
    expect(() => assertScenarioShape(bad, 'bad')).toThrow(/dl-s03/);
  });
  it('措施标题含学生姓名或学校名被拒绝', () => {
    const s0 = S.students[0];
    const byName = { ...S, interventions: [{ ...S.interventions[0], title: `给${s0.display_name}的电脑` }] };
    expect(() => assertScenarioShape(byName)).toThrow(/学生显示名/);
    const bySchool = { ...S, interventions: [{ ...S.interventions[0], title: `${s0.school_name} 专车` }] };
    expect(() => assertScenarioShape(bySchool)).toThrow(/学校名/);
  });
  it('短姓名 / 学校名（< 3 字符）不参与校验；演示场景本身通过', () => {
    const sc = {
      ...S,
      students: [{ ...S.students[0], id: 'q1', display_name: 'Al', school_name: 'X' }],
      interventions: [{ ...S.interventions[0], title: 'Xavier 的 Alpha 电脑' }],
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
    expect(v.mode_label).toBe('保护模式');
    expect(v.mode_explanation).toBe(MODE_EXPLANATIONS.protect);
    expect(v.loss_cap).toBeNull();
    expect(v.loss).toEqual({ lost_pairs: 0, affected_students: 0, groups: [], headline: null, protect_note: PROTECT_LOSS_NOTE });
    expect(v.revocations).toEqual({ total: 0, forced: 0, voluntary: 0, pending: 0, items: [] });
    expect(v.fairness).toEqual([]);
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)?.slots[0]).toMatchObject({ used: 3, full: true });
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式、损失上限 2：与保护模式相同（卫星会场会失去 3 个）', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 2 }));
    expect([v.G, v.L, v.N]).toEqual([2, 0, 2]);
    expect(v.mode_label).toBe('权衡模式');
    expect(v.loss_cap).toBe(2);
    expect(v.loss?.headline).toBeNull();
    expect(v.loss?.protect_note).toBeNull();
    expect(v.revocations?.total).toBe(0);
    expect(v.assumptions.some((a) => a.includes('权衡模式的含义') && a.includes('损失上限 2'))).toBe(true);
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式、损失上限 3：G 6 / L 3 / N 3、$140；失去与收回只给汇总', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3 }));
    expect(v.status).toBe('OPTIMAL');
    expect([v.R0_count, v.R1_count, v.G, v.L, v.N]).toEqual([3, 6, 6, 3, 3]);
    expect(v.cost).toMatchObject({ fixed_usd: 80, per_student_usd: 60, total_usd: 140, remaining_usd: 160 });
    expect(v.loss?.lost_pairs).toBe(3);
    expect(v.loss?.affected_students).toBe(3);
    expect(v.loss?.headline).toBe('为了新增 6 个，有 3 个原本可达的（学生, 机会）对在此方案下不再可达。');
    expect(v.loss?.groups).toEqual([
      expect.objectContaining({
        revoked_title: '工作日接驳车（示例，已在运行）',
        forced_by_title: '周末卫星会场（示例）',
        revoked_count: 3,
        students: 3,
        pairs: 3,
      }),
    ]);
    expect(v.revocations).toMatchObject({ total: 3, forced: 3, voluntary: 0 });
    expect(v.revocations?.items).toEqual([
      { title: '工作日接驳车（示例，已在运行）', count: 3, reason: expect.stringContaining('互斥') },
    ]);
    // 被收回的接驳车不再占名额
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)?.slots[0]).toMatchObject({ used: 0, full: false });
    expect(v.uncovered?.reasons.find((r) => r.kind === 'revoked')).toMatchObject({ students: 3 });
    expect(v.verification.passed).toBe(true);
    expect(v.verification.checks.find((c) => c.name === 'revocation')?.label).toBe('收回已有资源的规则');
    assertNoStudentInfo(v, VT);
  });

  it('权衡模式 + 低收入底线：底线结果按人数与比例给出', () => {
    const v = runWhatIf(VT, vtInput({ mode: 'tradeoff', lossCap: 3, fairnessFloorIds: [LOW_INCOME] }), VT_FLOORS);
    expect([v.G, v.L, v.N]).toEqual([6, 3, 3]);
    expect(v.effective.fairness_floor_ids).toEqual([LOW_INCOME]);
    expect(v.fairness).toEqual([
      expect.objectContaining({
        floor_id: LOW_INCOME,
        label: '低收入学生',
        eligible_members: 4,
        covered_members: 2,
        ratio_percent: 50,
        min_ratio_percent: 50,
        satisfied: true,
        not_applicable: false,
      }),
    ]);
    expect(v.fairness[0].basis).toContain('示例');
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
    expect(v.verification.checks.find((c) => c.name === 'fairness')).toMatchObject({ passed: true, label: '公平底线' });
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
    expect(rows[1].failed_checks).toEqual(['未超出名额', '未超出预算']);
    expect(rows[1].repaired).toMatchObject({ G: 5, total_usd: 350 });
    expect(rows[2].verified?.total_usd).toBe(350);
    expect(rows[3].verified?.total_usd).toBe(200);
    expect(rows.map((r) => r.soft_label)).toEqual(['未设要求', '未设要求', '未设要求', '未设要求']);
    expect(v.baselines!.notes.join('')).toContain('基线 D');
    // 视图里的基线行不带方案（方案里有学生 id）
    for (const r of rows) expect(Object.keys(r)).not.toContain('plan');
  });

  it('带底线时：不可执行的行写「方案不可执行，不评估」', () => {
    const v = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect(v.baselines!.rows.map((r) => r.soft_label)).toEqual(['不满足', '方案不可执行，不评估', '不满足', '满足']);
  });

  it('输入不合法（负预算）：基线 rows 为空，notes 写明原因', () => {
    const v = runWhatIf(S, dlInput({ budget: -1 }));
    expect(v.baselines?.rows).toEqual([]);
    expect(v.baselines?.notes[0]).toContain('未做基线对比');
  });
});

describe('runWhatIf：视图不含任何学生标识（两个场景、各种模式）', () => {
  const cases: [string, Scenario, Parameters<typeof runWhatIf>[1]][] = [
    ['设备借用默认', S, dlInput()],
    ['设备借用 + 底线 100%', S, dlInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } })],
    ['设备借用 tradeoff 0', S, dlInput({ mode: 'tradeoff', lossCap: 0 })],
    ['设备借用 最低新增 6（做不到）', S, dlInput({ minGain: 6, fairnessFloorIds: [LOW_INCOME] })],
    ['设备借用 只开笔记本、预算 0', S, dlInput({ enabledIds: [LAPTOP], budget: 0 })],
    ['权衡 protect', VT, vtInput()],
    ['权衡 tradeoff 2', VT, vtInput({ mode: 'tradeoff', lossCap: 2 })],
    ['权衡 tradeoff 3', VT, vtInput({ mode: 'tradeoff', lossCap: 3 })],
    ['权衡 tradeoff 3 + 底线', VT, vtInput({ mode: 'tradeoff', lossCap: 3, fairnessFloorIds: [LOW_INCOME] })],
    ['权衡 tradeoff 9 + 底线 100%', VT, vtInput({ mode: 'tradeoff', lossCap: 9, fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1 } })],
    ['权衡 必须启用卫星会场（protect 做不到）', VT, vtInput({ requiredIds: [V.weekendSatellite] })],
    ['权衡 tradeoff 未填上限', VT, vtInput({ mode: 'tradeoff', lossCap: null })],
  ];
  for (const [name, sc, input] of cases) {
    it(name, () => {
      const floors = sc === S ? DL_FLOORS : VT_FLOORS;
      const v = runWhatIf(sc, input, floors);
      assertNoStudentInfo(v, sc);
      // 也不含已有 grant 的 id（它们和具体学生一一对应）
      const json = JSON.stringify(v);
      for (const g of sc.existing_grants ?? []) expect(json.includes(g.id), `含 grant id ${g.id}`).toBe(false);
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `含 ${w}`).toBe(false);
    });
  }
});

describe('runWhatIf：损失上限 / 底线比例不合法时不调用求解器', () => {
  const bad: [string, Parameters<typeof runWhatIf>[1], RegExp][] = [
    ['tradeoff 未填上限（null）', vtInput({ mode: 'tradeoff', lossCap: null }), /需要填写损失上限/],
    ['tradeoff 未填上限（缺省）', { ...vtInput({ mode: 'tradeoff' }), lossCap: undefined }, /需要填写损失上限/],
    ['上限负数', vtInput({ mode: 'tradeoff', lossCap: -1 }), /0 或以上的整数/],
    ['上限非整数', vtInput({ mode: 'tradeoff', lossCap: 1.5 }), /0 或以上的整数/],
    ['上限 NaN', vtInput({ mode: 'tradeoff', lossCap: NaN }), /0 或以上的整数/],
    ['上限 Infinity', vtInput({ mode: 'tradeoff', lossCap: Infinity }), /0 或以上的整数/],
    ['底线比例 1.5', vtInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: 1.5 } }), /0% 到 100%/],
    ['底线比例 NaN', vtInput({ fairnessFloorIds: [LOW_INCOME], minRatioOverrides: { [LOW_INCOME]: NaN } }), /0% 到 100%/],
    ['未知底线', vtInput({ fairnessFloorIds: ['nope'] }), /没有找到所选的公平底线/],
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
      for (const w of ['NaN', 'Infinity', 'undefined']) expect(json.includes(w), `含 ${w}`).toBe(false);
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
    if (alt.L > 0) expect(alt.loss_text).toContain(`失去 ${alt.L} 个`);
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
    for (const kw of ['保护模式', '自己声明的身份标签', '分母只算', '各算一次', '不代表任何真实系统', '基线 D', '虚构依据']) {
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
    expect(v.running[0].note).toContain('已有 3 份资源在使用，不能从方案中移除；取消勾选只表示不再新增分配');
    expect(v.effective.frozen_ids).toEqual([]);
    expect(v.capacity_usage.find((c) => c.id === V.weekdayShuttle)).toMatchObject({ running: true, frozen: false });
  });

  it('只勾选卫星会场：接驳车仍运行（不再新增分配），保护模式 G = 0；权衡上限 3 → G 6 / L 3 / N 3', () => {
    const p = runWhatIf(VT, vtInput({ enabledIds: [V.weekendSatellite] }));
    expect(p.running).toEqual([expect.objectContaining({ id: V.weekdayShuttle, accepts_new: false })]);
    expect(p.running[0].note).toContain('本次未勾选');
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
    expect(p.assumptions.some((a) => a.includes('不能从方案中移除'))).toBe(true);
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
    expect(v.fairness[0].bound_text).toContain('当前启用的措施下最多可覆盖 3 / 4');
    expect(v.fairness[0].bound_text).toContain('仍计入分母');
    expect(v.alternative?.fairness[0]).toMatchObject({ covered_members: 1, max_coverable: 3 });
    const all = runWhatIf(S, dlInput({ fairnessFloorIds: [LOW_INCOME] }), DL_FLOORS);
    expect(all.fairness[0]).toMatchObject({ max_coverable: 4 });
    expect(all.fairness[0].bound_text).toContain('不一定能同时达到');
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
    expect(t.assumptions.some((a) => a.includes('损失上限为 0 也不等同保护模式'))).toBe(true);
    assertNoStudentInfo(t, sc);
  });
});
