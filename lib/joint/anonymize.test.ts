/**
 * anonymizeScenarioForClient：交给浏览器的场景不含示例学生的 id、姓名、学校与自由文本，
 * 且求解结果（状态、G、L、N、成本）与匿名化前一致。全部示例 / 模拟数据。
 */
import { describe, expect, it } from 'vitest';
import { DEVICE_LOAN_IDS as IDS, deviceLoanScenario, withBudget, withEnabledInterventions } from './scenarios';
import { anonymizeScenarioForClient } from './scenario-utils';
import { solveJoint } from './solve';
import { runWhatIf } from './whatif';
import type { Scenario, SolveOptions } from '../types';

const S = deviceLoanScenario;

/** 加了证据、交通备注和已有 grant 的变体，用来检查自由文本被去掉、student_id 被同步改写。 */
const RICH: Scenario = {
  ...S,
  students: S.students.map((s, i) =>
    i === 0
      ? {
          ...s,
          evidence: [
            {
              id: `ev-${s.id}-1`,
              title: `${s.display_name} 的作品集`,
              kind: 'project',
              skills: ['python'],
              prep_item_ids: ['p1'],
              status: 'evidence_attached',
              url: 'https://example.com/private-portfolio',
              description: `${s.school_name} 课堂作业`,
              added_on: '2026-10-01',
            },
          ],
        }
      : s,
  ),
  existing_grants: [
    {
      id: `g-${S.students[1].id}`,
      student_id: S.students[1].id,
      opportunity_id: null,
      intervention_id: IDS.laptopLoan,
      type: 'device',
      device: 'laptop',
      status: 'approved',
      provider: '示例主办方',
      note: `${S.students[1].display_name} 已借出`,
      is_sample: true,
    },
  ],
};

function assertNoOriginalInfo(json: string, src: Scenario) {
  for (const s of src.students) {
    expect(json.includes(s.id), `含学生 id ${s.id}`).toBe(false);
    expect(json.includes(s.display_name), `含姓名 ${s.display_name}`).toBe(false);
    if (s.school_name) expect(json.includes(s.school_name), `含学校 ${s.school_name}`).toBe(false);
  }
}

const pick = (r: ReturnType<typeof solveJoint>) => ({
  status: r.status,
  G: r.G,
  L: r.L,
  N: r.N,
  cost: r.cost,
  R0: r.R0.length,
  R1: r.R1.length,
  selected: r.selected_intervention_ids,
});

describe('anonymizeScenarioForClient', () => {
  it('结果不含原学生 id / 姓名 / 学校；id、显示名换成编号', () => {
    for (const src of [S, RICH]) {
      const a = anonymizeScenarioForClient(src);
      const json = JSON.stringify(a);
      assertNoOriginalInfo(json, src);
      expect(a.students.map((s) => s.id)).toEqual(['s01', 's02', 's03', 's04', 's05', 's06', 's07', 's08', 's09', 's10']);
      expect(a.students[0].display_name).toBe('示例学生 1');
      expect(a.students.every((s) => !('school_name' in s))).toBe(true);
      expect(a.students.every((s) => s.transport?.note == null)).toBe(true);
    }
  });

  it('证据只留结构字段；existing_grants 的 student_id 同步改写、note 去掉', () => {
    const a = anonymizeScenarioForClient(RICH);
    const ev = a.students[0].evidence[0];
    expect(ev).toEqual({
      id: 's01-ev1',
      title: '示例证据',
      kind: 'project',
      skills: ['python'],
      prep_item_ids: ['p1'],
      status: 'evidence_attached',
      added_on: '2026-10-01',
    });
    expect(a.existing_grants![0]).toMatchObject({ id: 'g1', student_id: 's02', note: null, intervention_id: IDS.laptopLoan });
    expect(JSON.stringify(a)).not.toContain('private-portfolio');
  });

  it('不修改输入；判断用字段原样保留', () => {
    const before = JSON.stringify(RICH);
    const a = anonymizeScenarioForClient(RICH);
    expect(JSON.stringify(RICH)).toBe(before);
    for (let i = 0; i < S.students.length; i++) {
      const o = S.students[i];
      const n = a.students[i];
      expect(n.grade).toBe(o.grade);
      expect(n.age).toBe(o.age);
      expect(n.region).toEqual(o.region);
      expect(n.devices).toEqual(o.devices);
      expect(n.transport?.level).toBe(o.transport?.level);
      expect(n.hours_per_week_available).toBe(o.hours_per_week_available);
      expect(n.budget_usd).toBe(o.budget_usd);
    }
    expect(a.interventions).toEqual(RICH.interventions);
    expect(a.opportunities).toEqual(RICH.opportunities);
  });

  const variants: [string, Scenario, SolveOptions][] = [
    ['默认场景', S, {}],
    ['只开设备借用、预算 150', withBudget(withEnabledInterventions(S, [IDS.laptopLoan]), 150), {}],
    ['全部措施、必须启用线上入口', S, { required_intervention_ids: [IDS.onlineEntry] }],
    ['最低新增 6（做不到）', S, { min_gain: 6 }],
    ['带证据和已有 grant 的变体', RICH, {}],
  ];
  for (const [name, src, opts] of variants) {
    it(`求解结果一致：${name}`, () => {
      const before = pick(solveJoint(src, opts));
      const after = pick(solveJoint(anonymizeScenarioForClient(src), opts));
      expect(after).toEqual(before);
    });
  }

  it('默认 What-if 视图在匿名化场景上仍为 G=5 / L=0 / N=+5', () => {
    const a = anonymizeScenarioForClient(S);
    const v = runWhatIf(a, {
      enabledIds: a.interventions.map((iv) => iv.id),
      requiredIds: [],
      budget: a.budget_usd,
    });
    expect([v.G, v.L, v.N]).toEqual([5, 0, 5]);
  });
});
