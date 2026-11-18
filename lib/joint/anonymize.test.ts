/**
 * anonymizeScenarioForClient：交给浏览器的场景不含示例学生的 id、姓名、学校与自由文本，
 * 且求解结果（状态、G、L、N、成本）与匿名化前一致。全部示例 / 模拟数据。
 */
import { describe, expect, it } from 'vitest';
import {
  DEVICE_LOAN_IDS as IDS,
  SCENARIOS,
  VENUE_TRADEOFF_IDS as V,
  deviceLoanScenario,
  venueTradeoffScenario,
  withBudget,
  withEnabledInterventions,
} from './scenarios';
import { compareBaselines } from './baselines';
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
              title: `${s.display_name}'s portfolio`,
              kind: 'project',
              skills: ['python'],
              prep_item_ids: ['p1'],
              status: 'evidence_attached',
              url: 'https://example.com/private-portfolio',
              description: `${s.school_name} class assignment`,
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
      provider: 'Sample organizer',
      note: `${S.students[1].display_name} has borrowed one`,
      is_sample: true,
    },
  ],
};

function assertNoOriginalInfo(json: string, src: Scenario) {
  for (const s of src.students) {
    expect(json.includes(s.id), `contains student id ${s.id}`).toBe(false);
    expect(json.includes(s.display_name), `contains name ${s.display_name}`).toBe(false);
    if (s.school_name) expect(json.includes(s.school_name), `contains school ${s.school_name}`).toBe(false);
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
      expect(a.students[0].display_name).toBe('Sample student 1');
      expect(a.students.every((s) => !('school_name' in s))).toBe(true);
      expect(a.students.every((s) => s.transport?.note == null)).toBe(true);
    }
  });

  it('证据只留结构字段；existing_grants 的 student_id 同步改写、note 去掉', () => {
    const a = anonymizeScenarioForClient(RICH);
    const ev = a.students[0].evidence[0];
    expect(ev).toEqual({
      id: 's01-ev1',
      title: 'Sample evidence',
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
    ['default scenario', S, {}],
    ['device loan only, budget 150', withBudget(withEnabledInterventions(S, [IDS.laptopLoan]), 150), {}],
    ['all measures, online entry required', S, { required_intervention_ids: [IDS.onlineEntry] }],
    ['min gain 6 (not achievable)', S, { min_gain: 6 }],
    ['variant with evidence and existing grants', RICH, {}],
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

describe('anonymizeScenarioForClient：权衡场景（第 3 层）', () => {
  const VT = venueTradeoffScenario;
  const floors = SCENARIOS[1].suggestedFairnessFloors;
  const a = anonymizeScenarioForClient(VT);

  it('不含原学生信息；statuses 原样保留；已有 grant 的 student_id 改写为新编号', () => {
    assertNoOriginalInfo(JSON.stringify(a), VT);
    expect(a.students.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9']);
    expect(a.students.map((s) => s.statuses)).toEqual(VT.students.map((s) => s.statuses));
    expect(a.existing_grants!.map((g) => [g.id, g.student_id, g.intervention_id, g.status])).toEqual([
      ['shuttle-grant-1', 's1', V.weekdayShuttle, 'approved'],
      ['shuttle-grant-2', 's2', V.weekdayShuttle, 'approved'],
      ['shuttle-grant-3', 's3', V.weekdayShuttle, 'approved'],
    ]);
    expect(a.existing_grants!.every((g) => g.note == null)).toBe(true);
  });

  const pick3 = (r: ReturnType<typeof solveJoint>) => ({
    ...pick(r),
    lost: r.lost_pairs?.length,
    revoked: r.revoked_grant_ids,
    forced: r.revocations?.filter((x) => x.forced_by !== null).length,
    fairness: r.fairness,
  });
  const variants: [string, SolveOptions][] = [
    ['protect', {}],
    ['protect + floor', { fairness_floors: floors }],
    ['tradeoff 2', { mode: 'tradeoff', loss_cap: 2 }],
    ['tradeoff 3', { mode: 'tradeoff', loss_cap: 3 }],
    ['tradeoff 3 + floor', { mode: 'tradeoff', loss_cap: 3, fairness_floors: floors }],
    ['tradeoff 3 + floor 100%', { mode: 'tradeoff', loss_cap: 3, fairness_floors: floors.map((f) => ({ ...f, min_ratio: 1 })) }],
  ];
  for (const [name, opts] of variants) {
    it(`求解结果（含 L、收回数、公平报告）与基线数字一致：${name}`, () => {
      expect(pick3(solveJoint(a, opts))).toEqual(pick3(solveJoint(VT, opts)));
      const strip = (c: ReturnType<typeof compareBaselines>) =>
        c.rows.map((r) => ({ id: r.id, claimed: r.claimed_reachable, verified: r.verified, repaired: r.repaired, soft: r.soft_requirements_met }));
      expect(strip(compareBaselines(a, opts))).toEqual(strip(compareBaselines(VT, opts)));
    });
  }

  it('tradeoff 3 时 L = 3、强制收回 3 条（匿名化前后相同）', () => {
    const r = solveJoint(a, { mode: 'tradeoff', loss_cap: 3 });
    expect([r.G, r.L, r.N]).toEqual([6, 3, 3]);
    expect(r.revocations?.filter((x) => x.forced_by === V.weekendSatellite)).toHaveLength(3);
  });

  it('What-if 视图（tradeoff 3 + 底线）在匿名化前后完全一致（视图本来就不含学生标识）', () => {
    const input = {
      enabledIds: VT.interventions.map((iv) => iv.id),
      requiredIds: [],
      budget: VT.budget_usd,
      mode: 'tradeoff' as const,
      lossCap: 3,
      fairnessFloorIds: [floors[0].id],
    };
    expect(JSON.stringify(runWhatIf(a, input, floors))).toBe(JSON.stringify(runWhatIf(VT, input, floors)));
  });
});
