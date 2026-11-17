/**
 * runWhatIf 视图模型测试（演示场景 data/scenarios/device-loan.json，全部示例 / 模拟数据）。
 * 手算依据见 ./joint.test.ts 文件头：10 名示例学生都缺笔记本，借用名额 5（单一时段），
 * 设备借用固定 $100 + 每人 $20；线上入口 requires 设备借用；卫星会场 pending。
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_LOAN_IDS as IDS, assertScenarioShape, deviceLoanScenario } from './scenarios';
import {
  defaultWhatIfInput,
  INFEASIBLE_UNCOVERED_CAUSE,
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

function assertNoStudentInfo(view: WhatIfView) {
  const json = JSON.stringify(view);
  for (const s of S.students) {
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

