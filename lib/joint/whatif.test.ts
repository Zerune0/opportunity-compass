/**
 * runWhatIf 视图模型测试（演示场景 data/scenarios/device-loan.json，全部示例 / 模拟数据）。
 * 手算依据见 ./joint.test.ts 文件头：10 名示例学生都缺笔记本，借用名额 5（单一时段），
 * 设备借用固定 $100 + 每人 $20；线上入口 requires 设备借用；卫星会场 pending。
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_LOAN_IDS as IDS, deviceLoanScenario } from './scenarios';
import { defaultWhatIfInput, runWhatIf, scrubStudentInfo, WHATIF_LABELS } from './whatif';
import type { WhatIfView } from './whatif';

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
    expect(v.conditional!.delta.N).toBe(v.conditional!.N - v.N);
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
});
