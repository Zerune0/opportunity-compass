/**
 * 场景模板（./scenario-template）与共享支持场景（./scenarios 的 sharedSupportScenario）测试。全部示例 / 模拟。
 *
 * data/scenarios/shared-support.json 的两个 ref 已经填好（机会 = 设备借用场景里的示例机会 placeholder-inperson-event，
 * 演示学生 = 一份示例档案），所以：
 * - 结构与手算数字用 ./testing/shared-support-fixtures 的虚构 fixture 检查（数字见那个文件的文件头）；
 * - 「真实数据」一组用填好的 ref 运行（`skipIf(sharedSupportScenario === null)`：ref 被清空时才跳过）。
 *   原来「ref 还没填」时的预演（数据模板 + fixture）已删除：它在 ref 填好后永远被跳过，其断言由「真实数据」一组覆盖。
 * 评审要求：对演示学生，主办方这边的结论（方案让它可达）与学生端的结论（analyzeReachability 带桥写入的 grants）必须一致；
 * 「不够分」按「能被已批准措施帮到的学生」（helpable）计，不把资格不符的学生算进去。
 */
import { describe, expect, it } from 'vitest';
import { findCatalogOpportunity, sampleProfiles } from '../data';
import { analyzeReachability } from '../reachability';
import { validateOpportunity, validateProfile } from '../validation';
import { buildClientBridgeInfo, decideBridge, rosterStudentId } from './bridge';
import {
  DEMO_WINDOW_EXTRA_DAYS,
  MIN_HELPABLE_STUDENTS,
  approvedSupportGrants,
  assertScenarioTemplateShape,
  buildScenarioFromTemplate,
  demoWindowDates,
  helpableStudentIds,
  scenarioReadinessProblems,
  templateInputProblems,
} from './scenario-template';
import type { ScenarioTemplate } from './scenario-template';
import { isPlaceholderOpportunity } from './scenario-utils';
import {
  REAL_OPPORTUNITY_NOTE,
  SCENARIOS,
  SHARED_SUPPORT_IDS,
  anonymizeScenarioForClient,
  assertScenarioShape,
  deviceLoanScenario,
  sharedSupportLowIncomeFloor,
  sharedSupportOpportunitySource,
  sharedSupportReadinessProblems,
  sharedSupportScenario,
  sharedSupportTemplate,
  venueTradeoffScenario,
} from './scenarios';
import { solveJoint } from './solve';
import { defaultWhatIfInput, runWhatIfWithPlan } from './whatif';
import {
  FIXTURE_DEMO_STUDENT as DEMO,
  FIXTURE_EVAL_DATE,
  FIXTURE_IDS as FX,
  FIXTURE_OPPORTUNITY as OPP,
  FIXTURE_SCENARIO_STUDENTS,
  fixtureTemplate,
} from './testing/shared-support-fixtures';
import type { Allocation, FairnessFloor, Opportunity, Requirement, ResourceGrant, Scenario, StudentProfile } from '../types';

const PROVIDER = 'Sample community partner (simulated)';
/** 共享支持场景的低收入底线（≥ 50%，依据写的是模拟支持方）。 */
const FLOORS: FairnessFloor[] = [sharedSupportLowIncomeFloor()];
const LOW_INCOME = FLOORS[0].id;
/** 评估日前一天到后一天（fixture 的评估日是 2026-11-20）。 */
const AROUND_EVAL = ['2026-11-19', '2026-11-20', '2026-11-21'];
const FIXTURE_WINDOW = [
  '2026-11-20',
  '2026-11-21',
  '2026-11-22',
  '2026-11-23',
  '2026-11-24',
  '2026-11-25',
  '2026-11-26',
  '2026-11-27',
];

const build = (template: ScenarioTemplate = fixtureTemplate(), opportunity: Opportunity = OPP, demoStudent: StudentProfile = DEMO) =>
  buildScenarioFromTemplate(template, { opportunity, demoStudent });
/** 分配里的不同学生（可只看某项措施），升序。 */
const studentsOf = (list: readonly Allocation[] | null, ivId?: string) =>
  [...new Set((list ?? []).filter((a) => ivId === undefined || a.intervention_id === ivId).map((a) => a.student_id))].sort();

/** 页面的整条链路：匿名化 → roster → 默认 What-if 输入（可开底线）的方案 → 桥的判定。 */
function demoLoop(
  original: Scenario,
  demoId: string,
  opts: { loadable: readonly string[]; catalog: readonly string[]; provider: string; floorIds?: string[]; floors?: FairnessFloor[] },
) {
  const anonymized = anonymizeScenarioForClient(original);
  const info = buildClientBridgeInfo({
    original,
    anonymized,
    loadableProfileIds: opts.loadable,
    catalogOpportunityIds: opts.catalog,
    provider: opts.provider,
  });
  const { view, plan } = runWhatIfWithPlan(
    anonymized,
    { ...defaultWhatIfInput(anonymized), fairnessFloorIds: opts.floorIds ?? [] },
    opts.floors ?? FLOORS,
  );
  const scenarioStudentId = rosterStudentId(info.roster, demoId);
  const decision = decideBridge({
    scenarioId: anonymized.id,
    plan,
    profile: { id: demoId, is_sample: true },
    scenarioStudentId,
    provider: info.provider,
  });
  return { anonymized, info, view, plan, scenarioStudentId, decision };
}

const reachable = (student: StudentProfile, opp: Opportunity, grants: ResourceGrant[], today: string) =>
  analyzeReachability(student, opp, grants, { today }).reachable;

/**
 * 测试自己算的 helpable（与 helpableStudentIds 独立）：在页面求解的匿名化场景里，不带支持不可达、
 * 但带全部已批准措施的合成 grant 就可达的学生数。
 */
function helpableCount(anonymized: Scenario): number {
  const today = anonymized.evaluation_date;
  return anonymized.students.filter((s) =>
    anonymized.opportunities.some(
      (o) => reachable(s, o, [], today) !== true && reachable(s, o, approvedSupportGrants(anonymized, s.id, o.id), today) === true,
    ),
  ).length;
}

/** 「资源不够所有人」：0 < G < helpable、helpable ≥ 4、笔记本与交通补助都用上、机会是线下的。 */
function expectScarceSupport(
  loop: ReturnType<typeof demoLoop>,
  ids: { laptopLoan: string; transportStipend: string },
): { helpable: number; G: number } {
  const helpable = helpableCount(loop.anonymized);
  const G = loop.view.G!;
  expect(helpable).toBeGreaterThanOrEqual(MIN_HELPABLE_STUDENTS);
  expect(G).toBeGreaterThan(0);
  expect(G).toBeLessThan(helpable);
  expect(loop.view.selected.map((s) => s.id)).toEqual(expect.arrayContaining([ids.laptopLoan, ids.transportStipend]));
  for (const o of loop.anonymized.opportunities) expect(o.location.format).not.toBe('online');
  return { helpable, G };
}

// ───────────────────────────── 形状校验 ─────────────────────────────

describe('assertScenarioTemplateShape', () => {
  it('fixture 模板与 data/scenarios/shared-support.json 都通过，返回原对象', () => {
    const t = fixtureTemplate();
    expect(assertScenarioTemplateShape(t)).toBe(t);
    expect(sharedSupportTemplate.id).toBe('shared-support');
    expect(sharedSupportTemplate.is_sample).toBe(true);
  });

  const bad = (patch: Record<string, unknown>, drop: string[] = []) => {
    const t: Record<string, unknown> = { ...fixtureTemplate(), ...patch };
    for (const k of drop) delete t[k];
    return t;
  };
  const cases: [string, unknown, RegExp][] = [
    ['不是对象', null, /not an object/],
    ['is_sample 不是 true', bad({ is_sample: false }), /is_sample must be true/],
    ['评估日不是严格的 YYYY-MM-DD', bad({ evaluation_date: '2026-2-30' }), /evaluation_date is not a valid YYYY-MM-DD date/],
    ['不存在的日期', bad({ evaluation_date: '2026-02-30' }), /evaluation_date is not a valid YYYY-MM-DD date/],
    ['预算为负', bad({ budget_usd: -1 }), /budget_usd is not a finite number of 0 or more/],
    ['缺 opportunity_ref', bad({}, ['opportunity_ref']), /opportunity_ref is missing \(use null until it is known\)/],
    ['demo_student_ref 是空串', bad({ demo_student_ref: '  ' }), /demo_student_ref must be null or a non-empty string/],
    ['位置是负数', bad({ demo_student_position: -1 }), /demo_student_position is not a whole number of 0 or more/],
    ['位置不是整数', bad({ demo_student_position: 1.5 }), /demo_student_position is not a whole number of 0 or more/],
    ['模板里写了 opportunities', bad({ opportunities: [OPP] }), /opportunities must not be in the template/],
    ['模板里写了 opportunity_time_slots', bad({ opportunity_time_slots: { x: 'y' } }), /opportunity_time_slots must not be in the template/],
    [
      '措施带 opportunity_ids',
      bad({ interventions: [{ ...fixtureTemplate().interventions[0], opportunity_ids: ['x'] }] }),
      /support measure "iv-fx-laptop-loan" has opportunity_ids/,
    ],
    ['场景专用学生不是示例', bad({ students: [{ ...FIXTURE_SCENARIO_STUDENTS[0], is_sample: false }] }), /student "fx-s01" must be is_sample: true/],
    ['学生 id 重复', bad({ students: [FIXTURE_SCENARIO_STUDENTS[0], FIXTURE_SCENARIO_STUDENTS[0]] }), /student id "fx-s01" appears more than once/],
    ['existing_grants 不是数组', bad({ existing_grants: {} }), /existing_grants is not an array/],
  ];
  for (const [name, value, re] of cases) {
    it(`拒绝：${name}`, () => {
      expect(() => assertScenarioTemplateShape(value, 'T')).toThrow(/^T has the wrong shape: /);
      expect(() => assertScenarioTemplateShape(value, 'T')).toThrow(re);
    });
  }

  it('一次列出全部问题', () => {
    expect(() => assertScenarioTemplateShape(bad({ is_sample: false, budget_usd: -5 }))).toThrow(
      /is_sample must be true; budget_usd is not a finite number of 0 or more/,
    );
  });
});

// ───────────────────────────── 构建 ─────────────────────────────

describe('buildScenarioFromTemplate', () => {
  it('fixture 前提：机会像目录里的真实机会（不是示例、official、不是占位）、演示学生是示例档案，都通过校验', () => {
    expect(validateOpportunity(OPP)).toEqual([]);
    expect(OPP.is_sample).toBe(false);
    expect(OPP.source_tier).toBe('official');
    expect(isPlaceholderOpportunity(OPP)).toBe(false);
    expect(validateProfile(DEMO)).toEqual([]);
    expect(DEMO.is_sample).toBe(true);
  });

  it('演示学生（同一个对象）插在位置 0，机会（同一个对象）是唯一的机会；容量按整个场景计、没有时段；结果通过 assertScenarioShape', () => {
    const t = fixtureTemplate();
    const s = build(t);
    expect(assertScenarioShape(s, 'built')).toBe(s);
    expect(s.students).toHaveLength(8);
    expect(s.students[0]).toBe(DEMO);
    expect(s.students.slice(1)).toEqual([...FIXTURE_SCENARIO_STUDENTS]);
    expect(s.opportunities).toHaveLength(1);
    expect(s.opportunities[0]).toBe(OPP);
    expect(s).toMatchObject({
      id: t.id,
      title: t.title,
      is_sample: true,
      evaluation_date: FIXTURE_EVAL_DATE,
      budget_usd: 150,
      existing_grants: [],
    });
    expect(s.interventions.map((iv) => iv.id)).toEqual([FX.laptopLoan, FX.transportStipend, FX.extraLaptops]);
    expect(s.interventions.every((iv) => iv.opportunity_ids === undefined)).toBe(true);
    expect(s.interventions.every((iv) => iv.capacity_scope === undefined || iv.capacity_scope === 'total')).toBe(true);
    expect(s.interventions).toEqual(t.interventions);
    expect(Object.keys(s).sort()).toEqual(
      ['budget_usd', 'evaluation_date', 'existing_grants', 'id', 'interventions', 'is_sample', 'opportunities', 'students', 'title'].sort(),
    );
  });

  it('数据模板的措施容量也按整个场景计（页面不会显示「per time slot」）', () => {
    expect(sharedSupportTemplate.interventions.every((iv) => iv.capacity_scope === undefined || iv.capacity_scope === 'total')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(sharedSupportTemplate, 'opportunity_time_slot')).toBe(false);
  });

  it('位置按配置插入，越界时夹到最后', () => {
    expect(build({ ...fixtureTemplate(), demo_student_position: 3 }).students.map((x) => x.id)).toEqual([
      'fx-s01',
      'fx-s02',
      'fx-s03',
      DEMO.id,
      'fx-s04',
      'fx-s05',
      'fx-s06',
      'fx-s07',
    ]);
    const last = build({ ...fixtureTemplate(), demo_student_position: 99 });
    expect(last.students[7]).toBe(DEMO);
    expect(last.students).toHaveLength(8);
  });

  it('不修改输入；结果的措施与 grants 是副本', () => {
    const t = fixtureTemplate();
    t.existing_grants = [
      { id: 'g-other', student_id: 'fx-s06', opportunity_id: OPP.id, type: 'device', device: 'laptop', status: 'pending', provider: 'Sample (fixture)' },
    ];
    const before = JSON.stringify({ t, OPP, DEMO });
    const s = build(t);
    expect(JSON.stringify({ t, OPP, DEMO })).toBe(before);
    s.interventions[0].resolves.push('time');
    s.interventions[0].title = 'changed';
    s.existing_grants![0].status = 'approved';
    expect(JSON.stringify({ t, OPP, DEMO })).toBe(before);
    expect(build(t)).toEqual(build(t));
  });

  describe('拒绝构建（templateInputProblems 给原因，buildScenarioFromTemplate 抛错）', () => {
    const refuse = (
      name: string,
      inputs: { template?: ScenarioTemplate; opportunity?: Opportunity; demoStudent?: StudentProfile; loadableProfileIds?: string[] },
      reason: RegExp,
    ) =>
      it(name, () => {
        const template = inputs.template ?? fixtureTemplate();
        const args = { opportunity: inputs.opportunity ?? OPP, demoStudent: inputs.demoStudent ?? DEMO, loadableProfileIds: inputs.loadableProfileIds };
        const problems = templateInputProblems(template, args);
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join('\n')).toMatch(reason);
        expect(() => buildScenarioFromTemplate(template, args)).toThrow(/^fixture-shared-support: cannot build the scenario: /);
        expect(() => buildScenarioFromTemplate(template, args)).toThrow(reason);
      });

    it('好的输入：没有原因', () => {
      expect(templateInputProblems(fixtureTemplate(), { opportunity: OPP, demoStudent: DEMO })).toEqual([]);
      // 可载入档案里有演示学生自己的 id 是正常的
      expect(templateInputProblems(fixtureTemplate(), { opportunity: OPP, demoStudent: DEMO, loadableProfileIds: [DEMO.id, 'sample-maya'] })).toEqual([]);
      // ref 还没填（null）时不比对 id
      expect(templateInputProblems({ ...fixtureTemplate(), opportunity_ref: null, demo_student_ref: null }, { opportunity: OPP, demoStudent: DEMO })).toEqual([]);
    });

    refuse('演示学生不是示例档案', { demoStudent: { ...DEMO, is_sample: false } }, /Demo student "sample-fixture-demo" is not a sample profile/);
    refuse(
      '演示学生 id 与场景专用学生重复',
      { template: { ...fixtureTemplate(), demo_student_ref: 'fx-s02' }, demoStudent: { ...DEMO, id: 'fx-s02' } },
      /Demo student id "fx-s02" is also used by a scenario-only student/,
    );
    refuse(
      '场景专用学生的 id 是可载入示例档案的 id',
      { loadableProfileIds: [DEMO.id, 'fx-s03'] },
      /Scenario-only student id "fx-s03" is also a loadable sample profile id/,
    );
    it('接受示例 / 占位机会（设备借用场景的那个机会，同一个对象）', () => {
      const placeholder = deviceLoanScenario.opportunities[0];
      expect(isPlaceholderOpportunity(placeholder)).toBe(true);
      const t = { ...fixtureTemplate(), opportunity_ref: placeholder.id };
      expect(templateInputProblems(t, { opportunity: placeholder, demoStudent: DEMO })).toEqual([]);
      expect(buildScenarioFromTemplate(t, { opportunity: placeholder, demoStudent: DEMO }).opportunities[0]).toBe(placeholder);
    });
    refuse(
      '机会是用户发布的',
      { opportunity: { ...OPP, source_tier: 'user_posted', is_sample: true, posted_by: 'sample-publisher' } },
      /is user-posted; this template needs a verified catalog opportunity or a sample scenario's opportunity/,
    );
    refuse(
      'existing_grants 指向演示学生',
      {
        template: {
          ...fixtureTemplate(),
          existing_grants: [
            { id: 'g1', student_id: DEMO.id, opportunity_id: OPP.id, type: 'device', device: 'laptop', status: 'approved', provider: 'Sample (fixture)' },
          ],
        },
      },
      /existing_grants reference demo student "sample-fixture-demo"/,
    );
    refuse('机会与 opportunity_ref 对不上', { opportunity: { ...OPP, id: 'other-opp' } }, /Opportunity "other-opp" does not match opportunity_ref "fixture-inperson-build-day"/);
    refuse('演示学生与 demo_student_ref 对不上', { demoStudent: { ...DEMO, id: 'sample-other' } }, /Demo student "sample-other" does not match demo_student_ref/);

    it('多个原因一起列出', () => {
      const problems = templateInputProblems(fixtureTemplate(), {
        opportunity: { ...OPP, source_tier: 'user_posted', is_sample: true },
        demoStudent: { ...DEMO, is_sample: false },
      });
      expect(problems).toHaveLength(2);
    });

    it('措施标题里写进了演示学生的显示名：抛错（页面脱敏挡不住）', () => {
      const t = fixtureTemplate();
      t.interventions = [{ ...t.interventions[0], title: `Laptop for ${DEMO.display_name}` }];
      expect(() => build(t)).toThrow(/contains student display name "Sample student Quinn \(fixture\)"/);
    });
  });
});

// ───────────────────────────── fixture 场景：默认 What-if 输入 ─────────────────────────────

describe('fixture 场景：默认 What-if 输入（按页面的做法匿名化）', () => {
  const S = build();
  const loop = () => demoLoop(S, DEMO.id, { loadable: [DEMO.id, 'sample-someone-else'], catalog: [OPP.id], provider: PROVIDER });

  it('OPTIMAL、独立复核通过；R0 = 0，G = 4，L = 0，N = 4，成本 $130（预算 $150）；N = G − L，R1 = R0 + G − L', () => {
    const { view } = loop();
    expect(view.status).toBe('OPTIMAL');
    expect(view.verification.passed).toBe(true);
    expect({ R0: view.R0_count, R1: view.R1_count, G: view.G, L: view.L, N: view.N }).toEqual({ R0: 0, R1: 4, G: 4, L: 0, N: 4 });
    expect(view.N).toBe(view.G! - view.L!);
    expect(view.R1_count).toBe(view.R0_count! + view.G! - view.L!);
    expect(view.cost.total_usd).toBe(130);
    expect(view.cost.budget_usd).toBe(150);
  });

  it('资源不够所有人：8 人都能被已批准措施帮到（helpable），只覆盖 4 人；笔记本与交通补助都用上；机会是线下的', () => {
    const l = loop();
    expect(expectScarceSupport(l, FX)).toEqual({ helpable: 8, G: 4 });
    // 与 helpableStudentIds 一致（测试自己独立算了一遍）
    expect(helpableStudentIds(l.anonymized)).toHaveLength(8);
    // 具体缺什么：6 人缺笔记本（只有 3 台），4 人缺交通（预算付完 3 台笔记本后只够 1 份交通补助）
    const opp = l.anonymized.opportunities[0];
    const without = l.anonymized.students.map((s) => analyzeReachability(s, opp, [], { today: l.anonymized.evaluation_date }));
    const lacking = (type: string) => without.filter((r) => r.barriers.some((b) => b.type === type && !b.resolved)).length;
    expect([lacking('device'), lacking('transport')]).toEqual([6, 4]);
  });

  it('分配：笔记本给只缺笔记本的 s1 s2 s3（s1 = 位置 0 的演示学生），交通补助给只缺交通的 s7；只用已批准措施', () => {
    const { anonymized, plan } = loop();
    expect(anonymized.students[0].id).toBe('s1');
    expect(studentsOf(plan.allocations, FX.laptopLoan)).toEqual(['s1', 's2', 's3']);
    expect(studentsOf(plan.allocations, FX.transportStipend)).toEqual(['s7']);
    expect(plan.allocations.some((a) => a.intervention_id === FX.extraLaptops)).toBe(false);
  });

  it('条件性结果（第二批笔记本获批）：G = 5、$150；只用于说明，桥不写它', () => {
    const { view, decision } = loop();
    expect(view.conditional).not.toBeNull();
    expect(view.conditional!.G).toBe(5);
    expect(view.conditional!.cost.total_usd).toBe(150);
    expect(decision.grants.every((g) => g.intervention_id !== FX.extraLaptops)).toBe(true);
  });

  it('低收入底线（≥ 50%）开启（演示时可以放心打开）：仍 OPTIMAL、复核通过、G = 4、$130，覆盖 3 / 5 名低收入学生，演示学生仍分到', () => {
    const { view, plan, decision } = demoLoop(S, DEMO.id, {
      loadable: [DEMO.id],
      catalog: [OPP.id],
      provider: PROVIDER,
      floorIds: [LOW_INCOME],
    });
    expect(view.status).toBe('OPTIMAL');
    expect(view.verification.passed).toBe(true);
    expect([view.G, view.L, view.cost.total_usd]).toEqual([4, 0, 130]);
    expect(view.fairness).toHaveLength(1);
    expect(view.fairness[0]).toMatchObject({ eligible_members: 5, covered_members: 3, satisfied: true, basis: FLOORS[0].basis });
    expect(studentsOf(plan.allocations, FX.laptopLoan)).toEqual(['s1', 's2', 's5']);
    expect(studentsOf(plan.allocations, FX.transportStipend)).toEqual(['s8']);
    expect(decision.state).toBe('ready');
  });
});

// ───────────────────────────── fixture 场景：整条演示闭环 ─────────────────────────────

describe('fixture 场景：主办方方案 → 桥 → 学生端（两边结论一致）', () => {
  const S = build();

  it('roster 只有演示学生（→ s1）；机会有 Quest Details 页面；桥 ready，写一条借用笔记本的 grant', () => {
    const { info, decision, scenarioStudentId } = demoLoop(S, DEMO.id, {
      loadable: [DEMO.id, 'sample-someone-else'],
      catalog: [OPP.id],
      provider: PROVIDER,
    });
    expect(info).toEqual({ provider: PROVIDER, roster: { [DEMO.id]: 's1' }, quest_opportunity_ids: [OPP.id] });
    expect(scenarioStudentId).toBe('s1');
    expect(decision.state).toBe('ready');
    expect(decision.grants).toHaveLength(1);
    expect(decision.grants[0]).toMatchObject({
      student_id: DEMO.id,
      opportunity_id: OPP.id,
      intervention_id: FX.laptopLoan,
      type: 'device',
      device: 'laptop',
      status: 'approved',
      provider: PROVIDER,
      is_sample: true,
    });
    expect(decision.grants[0].provider).not.toBe(OPP.organizer);
  });

  it('学生端：原始档案不带 grant 不可达，带桥的 grants 可达（评估日前一天与整个演示窗口都一样）；主办方的 R0 / R1 结论相同', () => {
    const { anonymized, decision, scenarioStudentId } = demoLoop(S, DEMO.id, { loadable: [DEMO.id], catalog: [OPP.id], provider: PROVIDER });
    expect(demoWindowDates(S.evaluation_date)).toEqual(FIXTURE_WINDOW);
    for (const today of [...AROUND_EVAL, ...FIXTURE_WINDOW]) {
      expect(reachable(DEMO, OPP, [], today), `without grants on ${today}`).not.toBe(true);
      expect(reachable(DEMO, OPP, decision.grants, today), `with grants on ${today}`).toBe(true);
    }
    const r = analyzeReachability(DEMO, OPP, decision.grants, { today: S.evaluation_date });
    expect(r.barriers.map((b) => [b.type, b.resolved])).toEqual([['device', true]]);
    expect(r.barriers[0].resolved_by_grant_ids).toEqual([decision.grants[0].id]);
    // 主办方这边：同一份匿名化场景，演示学生的对在 R1 里、不在 R0 里
    const joint = solveJoint(anonymized);
    const pair = { student_id: scenarioStudentId!, opportunity_id: OPP.id };
    expect(joint.R0).not.toContainEqual(pair);
    expect(joint.R1).toContainEqual(pair);
  });

  it('演示学生不在可载入档案里时不进 roster，桥说「不在本场景」', () => {
    const { info, decision } = demoLoop(S, DEMO.id, { loadable: ['sample-someone-else'], catalog: [OPP.id], provider: PROVIDER });
    expect(info.roster).toEqual({});
    expect(decision.state).toBe('not_in_scenario');
  });
});

// ───────────────────────────── 演示闭环的数据检查 ─────────────────────────────

describe('demoWindowDates', () => {
  it('评估日及其后 7 天；跨月、跨年、闰日都按日历算；读不出来的日期只返回它自己', () => {
    expect(DEMO_WINDOW_EXTRA_DAYS).toBe(7);
    expect(demoWindowDates('2026-11-20')).toEqual(FIXTURE_WINDOW);
    expect(demoWindowDates('2026-12-28', 4)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
    expect(demoWindowDates('2028-02-27', 3)).toEqual(['2028-02-27', '2028-02-28', '2028-02-29', '2028-03-01']);
    expect(demoWindowDates('2026-02-30')).toEqual(['2026-02-30']);
    expect(demoWindowDates(' 2026-11-20')).toEqual([' 2026-11-20']);
  });
});

describe('scenarioReadinessProblems', () => {
  const withOpp = (patch: Partial<Opportunity>) => build(fixtureTemplate(), { ...OPP, ...patch });
  const withDemo = (patch: Partial<StudentProfile>) => build(fixtureTemplate(), OPP, { ...DEMO, ...patch });
  const fewer = (n: number) =>
    `Fewer than 4 scenario students can be helped by the approved measures (${n}), so the scenario would not show scarce support.`;
  const ageRule = (min: number | undefined, max: number | undefined): Requirement => ({
    id: 'req-age',
    type: 'age',
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    hard: true,
    label: 'Age rule (fixture)',
    source_text: '(Fictional fixture text) Age rule.',
  });

  it('好的 fixture：没有问题', () => {
    expect(scenarioReadinessProblems(build(), DEMO.id)).toEqual([]);
  });

  it('演示学生不在场景里', () => {
    expect(scenarioReadinessProblems(build(), 'nobody')).toEqual(['The demo student "nobody" is not in this scenario.']);
  });

  it('fee_usd 为 null：引擎当作缺信息（没人能被帮到）', () => {
    expect(scenarioReadinessProblems(withOpp({ cost: { ...OPP.cost, fee_usd: null } }), DEMO.id)).toEqual([
      fewer(0),
      'The opportunity fee (cost.fee_usd) is null. The engine treats it as missing information, so no student can be judged reachable.',
    ]);
  });

  it('hours_per_week、requires_travel_expense 为 null（演示学生交通可靠），截止日期读不出来：各一条，顺序同引擎的 missing_info', () => {
    const p = scenarioReadinessProblems(
      withOpp({
        time_commitment: { ...OPP.time_commitment, hours_per_week: null },
        cost: { ...OPP.cost, requires_travel_expense: null },
        deadline: '15 Jan 2027',
      }),
      DEMO.id,
    );
    expect(p).toEqual([
      fewer(0),
      'Whether participants must pay for their own travel (cost.requires_travel_expense) is null. The demo student has no transport barrier, so the engine treats it as missing information and cannot judge the demo student reachable.',
      'The weekly hours (time_commitment.hours_per_week) are null. The engine treats them as missing information, so no student can be judged reachable.',
      'The deadline "15 Jan 2027" cannot be read as a YYYY-MM-DD date, so no student can be judged reachable.',
    ]);
  });

  describe('requires_travel_expense 为 null：只有演示学生没有交通障碍时才算缺信息（与引擎一致）', () => {
    const travelUnknown: Partial<Opportunity> = { cost: { ...OPP.cost, requires_travel_expense: null } };

    it('演示学生交通有限 + 已批准交通补助：没有问题，演示闭环照常（笔记本 + 交通补助都写给它）', () => {
      const demo: StudentProfile = { ...DEMO, transport: { level: 'limited', max_one_way_minutes: null, note: 'Fixture note: rare buses' } };
      const s = build(fixtureTemplate(), { ...OPP, ...travelUnknown }, demo);
      expect(scenarioReadinessProblems(s, DEMO.id)).toEqual([]);
      const l = demoLoop(s, DEMO.id, { loadable: [DEMO.id], catalog: [OPP.id], provider: PROVIDER });
      expect([l.view.status, l.view.verification.passed]).toEqual(['OPTIMAL', true]);
      expect(expectScarceSupport(l, FX)).toEqual({ helpable: 5, G: 3 });
      expect(l.decision.state).toBe('ready');
      expect(l.decision.grants.map((g) => g.intervention_id)).toEqual([FX.laptopLoan, FX.transportStipend]);
      const opp = s.opportunities[0];
      for (const today of demoWindowDates(s.evaluation_date)) {
        expect(reachable(demo, opp, [], today)).toBe(false);
        expect(reachable(demo, opp, l.decision.grants, today)).toBe(true);
      }
    });

    it('演示学生交通可靠：报告（引擎判断不了它）', () => {
      expect(scenarioReadinessProblems(withOpp(travelUnknown), DEMO.id)).toEqual([
        'Whether participants must pay for their own travel (cost.requires_travel_expense) is null. The demo student has no transport barrier, so the engine treats it as missing information and cannot judge the demo student reachable.',
      ]);
    });
  });

  it('硬性要求是 manual：引擎判断不了，资格一直是 unknown', () => {
    const manual: Requirement = {
      id: 'req-interview',
      type: 'manual',
      hard: true,
      label: 'Interview with the organizer',
      source_text: '(Fictional fixture text) Shortlisted applicants are interviewed.',
    };
    expect(scenarioReadinessProblems(withOpp({ requirements: [...OPP.requirements, manual] }), DEMO.id)).toEqual([
      fewer(0),
      'The hard requirement "Interview with the organizer" is manual, so the engine cannot check it and eligibility stays unknown.',
    ]);
  });

  it('机会不要求设备（required_devices 为空）：演示学生不带支持就可达，没有可演示的东西', () => {
    expect(scenarioReadinessProblems(withOpp({ required_devices: [] }), DEMO.id)).toEqual([
      'The demo student is already reachable without any support, so there is nothing to demonstrate.',
    ]);
  });

  it('机会是线上的：场景讲的是线下机会', () => {
    expect(scenarioReadinessProblems(withOpp({ location: { format: 'online' } }), DEMO.id)).toEqual([
      'The opportunity is online, but the scenario is about an in-person opportunity.',
    ]);
  });

  it('演示学生没填交通', () => {
    expect(scenarioReadinessProblems(withDemo({ transport: null }), DEMO.id)).toEqual([
      "The demo student's profile is missing transport, so the engine cannot decide reachability.",
    ]);
  });

  it('演示学生不满足硬性要求（8 年级）：措施改变不了资格', () => {
    expect(scenarioReadinessProblems(withDemo({ grade: 8 }), DEMO.id)).toEqual([
      'The demo student does not meet the hard requirement "High school student (grades 9–12)". Support measures cannot change eligibility.',
    ]);
  });

  it('硬性要求因演示学生缺信息而 unknown（没填地区）', () => {
    const p = scenarioReadinessProblems(withDemo({ region: null }), DEMO.id);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/^The hard requirement "California resident" is unknown for the demo student/);
  });

  it('场景里没有已批准措施能化解的障碍：费用超出预算 / 只有待审批的笔记本 / 截止日期已过', () => {
    const cost = scenarioReadinessProblems(withOpp({ cost: { ...OPP.cost, fee_usd: 50 } }), DEMO.id);
    expect(cost).toHaveLength(2);
    expect(cost[0]).toBe(fewer(0));
    expect(cost[1]).toMatch(/^No approved support measure in this scenario resolves the demo student's cost barrier: Needs about \$50/);

    const t = fixtureTemplate();
    t.interventions = t.interventions.filter((iv) => iv.id !== FX.laptopLoan);
    expect(scenarioReadinessProblems(build(t), DEMO.id)).toEqual([
      fewer(2),
      "No approved support measure in this scenario resolves the demo student's device barrier: Needs a laptop, which is not in your profile.",
    ]);

    const late = scenarioReadinessProblems(withOpp({ deadline: '2026-11-01' }), DEMO.id);
    expect(late).toHaveLength(2);
    expect(late[0]).toBe(fewer(0));
    expect(late[1]).toMatch(/time barrier: The deadline \(2026-11-01\) has passed/);
  });

  it('演示窗口：截止日期落在窗口里（2026-11-23）→ 之后几天学生端会显示已截止', () => {
    expect(scenarioReadinessProblems(withOpp({ deadline: '2026-11-23' }), DEMO.id)).toEqual([
      'The deadline (2026-11-23) falls inside the demo window (2026-11-20 to 2026-11-27), so from 2026-11-24 the student side would show it as passed.',
    ]);
    // 截止日期正好是窗口最后一天：整个窗口都还没截止
    expect(scenarioReadinessProblems(withOpp({ deadline: '2026-11-27' }), DEMO.id)).toEqual([]);
  });

  it('演示窗口：带支持的结论在窗口里变了（按今天算年龄、窗口里过 19 岁生日、上限 18 岁）', () => {
    const s = build(
      fixtureTemplate(),
      { ...OPP, deadline: null, requirements: [...OPP.requirements, ageRule(undefined, 18)] },
      { ...DEMO, age: 18, birth_date: '2007-11-23' },
    );
    const p = scenarioReadinessProblems(s, DEMO.id);
    expect(p).toContain(
      'With every approved measure the demo student is reachable on 2026-11-20 but not on 2026-11-23, 2026-11-24, 2026-11-25, 2026-11-26, 2026-11-27, inside the demo window (2026-11-20 to 2026-11-27).',
    );
    expect(p).toContain('The demo profile has a birth date, which the organizer view ignores.');
  });

  it('演示窗口：不带支持在窗口里就变得可达（不需要设备、窗口里满 17 岁）', () => {
    const s = build(
      fixtureTemplate(),
      { ...OPP, deadline: null, required_devices: [], requirements: [...OPP.requirements, ageRule(17, undefined)] },
      { ...DEMO, age: 16, birth_date: '2009-11-22' },
    );
    expect(scenarioReadinessProblems(s, DEMO.id)).toContain(
      'Without any support the demo student becomes reachable on 2026-11-22, 2026-11-23, 2026-11-24, 2026-11-25, 2026-11-26, 2026-11-27, inside the demo window (2026-11-20 to 2026-11-27), so there would be nothing to demonstrate on those days.',
    );
  });

  it('主办方页面（匿名化副本，没有出生日期）与学生端（原始档案）结论不同：报告；只是有出生日期时只提醒', () => {
    // 年龄按截止日（2027-01-15）算、至少 17 岁；档案写 16 岁，出生日期 2010-01-10 → 截止日已满 17。
    // 原始档案：按出生日期判为满足 → 带支持可达；匿名化副本没有出生日期：16 或 17 岁 → unknown → 带支持不可判断。
    const flip = build(fixtureTemplate(), { ...OPP, requirements: [...OPP.requirements, ageRule(17, undefined)] }, { ...DEMO, age: 16, birth_date: '2010-01-10' });
    expect(scenarioReadinessProblems(flip, DEMO.id)).toEqual([
      `The organizer page (anonymized copy) and the student side (original profile) reach different conclusions about the demo student on ${FIXTURE_WINDOW.join(', ')}.`,
      'The demo profile has a birth date, which the organizer view ignores.',
    ]);
    // 演示学生自己的结论确实是可达（学生端），而页面看到的副本是 null
    const anon = anonymizeScenarioForClient(flip);
    expect(anon.students[0].birth_date).toBeUndefined();
    expect(reachable(DEMO, OPP, [], FIXTURE_EVAL_DATE)).toBe(false);
    const oppFlip = flip.opportunities[0];
    expect(reachable(flip.students[0], oppFlip, approvedSupportGrants(flip, DEMO.id, oppFlip.id), FIXTURE_EVAL_DATE)).toBe(true);
    expect(reachable(anon.students[0], oppFlip, approvedSupportGrants(anon, 's1', oppFlip.id), FIXTURE_EVAL_DATE)).toBeNull();

    // 没有年龄要求时出生日期不影响结论：只提醒
    expect(scenarioReadinessProblems(withDemo({ birth_date: '2010-01-10' }), DEMO.id)).toEqual([
      'The demo profile has a birth date, which the organizer view ignores.',
    ]);
  });

  it('演示学生在 existing_grants 里已有 grant（直接改场景，绕过构建器的检查）', () => {
    const s = build();
    const withGrant: Scenario = {
      ...s,
      existing_grants: [
        { id: 'g1', student_id: DEMO.id, opportunity_id: OPP.id, type: 'device', device: 'laptop', status: 'approved', provider: 'Sample (fixture)' },
      ],
    };
    expect(scenarioReadinessProblems(withGrant, DEMO.id)).toEqual([
      'The demo student already has existing grants in this scenario; the bridge leaves such students out of the roster.',
      'The demo student is already reachable without any support, so there is nothing to demonstrate.',
    ]);
  });

  it('不修改输入', () => {
    const s = build();
    const before = JSON.stringify(s);
    scenarioReadinessProblems(s, DEMO.id);
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ───────────────────────────── 数据模板本身 ─────────────────────────────

describe('data/scenarios/shared-support.json（与真实机会无关的结构检查）', () => {
  const t = sharedSupportTemplate;
  const iv = (id: string) => t.interventions.find((x) => x.id === id);

  it('措施 id 与 SHARED_SUPPORT_IDS 一致：已批准的限量借用笔记本、已批准的交通补助、一项待审批措施', () => {
    expect(t.interventions.map((x) => x.id)).toEqual([SHARED_SUPPORT_IDS.laptopLoan, SHARED_SUPPORT_IDS.transportStipend, SHARED_SUPPORT_IDS.extraLaptops]);
    expect(iv(SHARED_SUPPORT_IDS.laptopLoan)).toMatchObject({ type: 'device', device: 'laptop', status: 'approved' });
    expect(iv(SHARED_SUPPORT_IDS.laptopLoan)!.capacity).toEqual(expect.any(Number));
    expect(iv(SHARED_SUPPORT_IDS.transportStipend)).toMatchObject({ type: 'transport_subsidy', status: 'approved' });
    expect(iv(SHARED_SUPPORT_IDS.extraLaptops)!.status).toBe('pending');
    expect(t.interventions.every((x) => x.opportunity_ids === undefined)).toBe(true);
  });

  it('场景专用学生：6–8 名、全部示例、id 以 ss- 开头、名字写明是示例、学校是虚构的；部分低收入；没有已有 grant；不与可载入档案重名', () => {
    expect(t.students.length).toBeGreaterThanOrEqual(6);
    expect(t.students.length).toBeLessThanOrEqual(8);
    const loadable = new Set(sampleProfiles().map((p) => p.id));
    for (const s of t.students) {
      expect(s.is_sample).toBe(true);
      expect(s.id).toMatch(/^ss-s\d\d$/);
      expect(loadable.has(s.id)).toBe(false);
      expect(s.display_name).toMatch(/^Sample student .* \(shared support scenario\)$/);
      expect(s.school_name).toMatch(/\(fictional\)$/);
      expect(validateProfile(s)).toEqual([]);
    }
    const low = t.students.filter((s) => (s.statuses ?? []).includes('low_income')).length;
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(t.students.length);
    expect(t.existing_grants ?? []).toEqual([]);
  });

  it('资源不够所有人：缺笔记本的学生多于借用名额；预算付完全部笔记本后，不够给每个缺交通的学生发交通补助', () => {
    const laptop = iv(SHARED_SUPPORT_IDS.laptopLoan)!;
    const stipend = iv(SHARED_SUPPORT_IDS.transportStipend)!;
    const noLaptop = t.students.filter((s) => !(s.devices ?? []).includes('laptop')).length;
    const noTransport = t.students.filter((s) => s.transport?.level !== 'reliable').length;
    expect(noLaptop).toBeGreaterThan(laptop.capacity!);
    expect(noTransport).toBeGreaterThan(0);
    const allLaptops = (laptop.fixed_cost_usd ?? 0) + laptop.capacity! * laptop.unit_cost_usd;
    expect(t.budget_usd).toBeLessThan(allLaptops + noTransport * stipend.unit_cost_usd);
  });
});

// ───────────────────────────── 真实数据（两个 ref 都填好后自动运行）─────────────────────────────

describe.skipIf(sharedSupportScenario === null)('真实数据：共享支持场景（填好的 ref：机会 + 演示学生）', () => {
  // describe 体在跳过时也会执行：这里只放函数，取值都在 it 里。
  const real = () => {
    const scenario = sharedSupportScenario!;
    const ref = sharedSupportTemplate.opportunity_ref;
    // 与 ./scenarios 相同的解析规则：先查已核实目录，查不到再用设备借用场景自己的示例 / 占位机会。
    const fromCatalog = findCatalogOpportunity(ref);
    const opp = fromCatalog ?? deviceLoanScenario.opportunities.find((o) => o.id === ref)!;
    const isCatalog = fromCatalog !== null;
    const demo = sampleProfiles().find((p) => p.id === sharedSupportTemplate.demo_student_ref)!;
    const loadable = sampleProfiles().map((p) => p.id);
    const catalog = scenario.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id);
    const entry = SCENARIOS[2];
    const loop = (floorIds: string[] = []) =>
      demoLoop(scenario, demo.id, { loadable, catalog, provider: entry.sampleOrganizer, floors: entry.suggestedFairnessFloors, floorIds });
    return { scenario, opp, isCatalog, demo, entry, loop, window: demoWindowDates(scenario.evaluation_date) };
  };

  it('机会就是目录 / 设备借用场景里的那个对象，演示学生就是示例档案里的那条记录（原样，不改动）；机会是线下的', () => {
    const { scenario, opp, isCatalog, demo } = real();
    expect(opp).toBeDefined();
    expect(demo).toBeDefined();
    expect(scenario.opportunities).toHaveLength(1);
    expect(scenario.opportunities[0]).toBe(opp);
    expect(sharedSupportOpportunitySource).toBe(isCatalog ? 'catalog' : 'sample');
    const at = Math.min(sharedSupportTemplate.demo_student_position, sharedSupportTemplate.students.length);
    expect(scenario.students[at]).toBe(demo);
    expect(scenario.students.filter((s) => s.id === demo.id)).toHaveLength(1);
    expect(opp.source_tier ?? 'official').not.toBe('user_posted');
    // 目录里的机会不会被标成占位；示例场景的机会照常是占位
    expect(isPlaceholderOpportunity(opp)).toBe(!isCatalog);
    expect(opp.location.format).not.toBe('online');
  });

  it('页面文字：只有目录机会才说「真实」并带说明；占位机会照常标 Placeholder、假设说明是「机会是占位的」', () => {
    const { isCatalog, entry, loop } = real();
    const { view } = loop();
    expect(entry.realOpportunityNote).toBe(isCatalog ? REAL_OPPORTUNITY_NOTE : undefined);
    expect(entry.description.includes('real')).toBe(isCatalog);
    expect(view.opportunities.map((o) => o.is_placeholder)).toEqual([!isCatalog]);
    expect(
      view.assumptions.includes(
        'Opportunities are placeholders for now, to be replaced with real opportunities verified by a person (official link + verification date).',
      ),
    ).toBe(!isCatalog);
  });

  it('演示闭环的数据检查没有问题（import 时算好的 sharedSupportReadinessProblems 与现算的一致）', () => {
    const { scenario, demo } = real();
    expect(sharedSupportReadinessProblems, `Readiness problems:\n${sharedSupportReadinessProblems.join('\n')}`).toEqual([]);
    expect(scenarioReadinessProblems(scenario, demo.id)).toEqual(sharedSupportReadinessProblems);
  });

  it('默认输入：OPTIMAL、复核通过；资源不够所有人（0 < G < helpable、helpable ≥ 4、笔记本与交通补助都用上）；N = G − L', () => {
    const { loop } = real();
    const l = loop();
    expect(l.view.status).toBe('OPTIMAL');
    expect(l.view.verification.passed).toBe(true);
    expect(l.view.N).toBe(l.view.G! - l.view.L!);
    expect(l.view.R1_count).toBe(l.view.R0_count! + l.view.G! - l.view.L!);
    expectScarceSupport(l, SHARED_SUPPORT_IDS);
  });

  it('桥：roster 里有演示学生；演示学生拿到 grants，学生端从不可达变为可达（整个演示窗口都一样）', () => {
    const { scenario, opp, demo, loop, window } = real();
    const { info, decision } = loop();
    expect(Object.keys(info.roster)).toEqual([demo.id]);
    expect(decision.state).toBe('ready');
    expect(decision.grants.length).toBeGreaterThan(0);
    expect(decision.grants.every((g) => g.provider !== opp.organizer && g.is_sample === true && g.status === 'approved')).toBe(true);
    expect(window).toHaveLength(DEMO_WINDOW_EXTRA_DAYS + 1);
    expect(window[0]).toBe(scenario.evaluation_date);
    for (const today of window) {
      expect(reachable(demo, opp, [], today), `without grants on ${today}`).not.toBe(true);
      expect(reachable(demo, opp, decision.grants, today), `with grants on ${today}`).toBe(true);
    }
  });

  it('开启预设的低收入底线（演示时可以放心打开）：仍 OPTIMAL、复核通过，演示学生仍分到', () => {
    const { loop, entry } = real();
    const l = loop([LOW_INCOME]);
    expect([l.view.status, l.view.verification.passed]).toEqual(['OPTIMAL', true]);
    expect(l.view.fairness.map((f) => [f.floor_id, f.basis])).toEqual([[LOW_INCOME, entry.suggestedFairnessFloors[0].basis]]);
    expect(l.decision.state).toBe('ready');
  });

  it('SCENARIOS 有三项：前两项不变，第三项用模拟支持方与自己的底线依据', () => {
    const { scenario, opp } = real();
    expect(SCENARIOS).toHaveLength(3);
    expect(SCENARIOS[0].scenario).toBe(deviceLoanScenario);
    expect(SCENARIOS[1].scenario).toBe(venueTradeoffScenario);
    const third = SCENARIOS[2];
    expect(third.scenario).toBe(scenario);
    expect(third.sampleOrganizer).toBe(PROVIDER);
    expect(third.sampleOrganizer).not.toBe(opp.organizer);
    expect(third.suggestedFairnessFloors).toEqual([sharedSupportLowIncomeFloor()]);
  });
});

// ───────────────────────────── 场景清单与页面文字 ─────────────────────────────

describe('SCENARIOS 与 sharedSupportScenario（不需要随 ref 改动）', () => {
  it('ref 没填齐时为 null、清单只有两项；填好后追加第三项。前两项永远是原来的两个场景', () => {
    const refsFilled = sharedSupportTemplate.opportunity_ref !== null && sharedSupportTemplate.demo_student_ref !== null;
    expect(sharedSupportScenario !== null).toBe(refsFilled);
    expect(SCENARIOS).toHaveLength(sharedSupportScenario ? 3 : 2);
    expect(SCENARIOS[0].scenario).toBe(deviceLoanScenario);
    expect(SCENARIOS[1].scenario).toBe(venueTradeoffScenario);
    expect(SCENARIOS.slice(0, 2).map((e) => [e.id, e.sampleOrganizer, e.realOpportunityNote])).toEqual([
      ['device-loan', 'Sample organizer (placeholder)', undefined],
      ['venue-tradeoff', 'Sample organizer (placeholder)', undefined],
    ]);
  });

  it('真实机会说明的原文（最后一句说明页面上的 organizer 指模拟支持方）', () => {
    expect(REAL_OPPORTUNITY_NOTE).toBe(
      'This scenario uses a real opportunity listing with sample students and a simulated support provider. The real organizer is not involved and offers none of these measures. Results are simulated. On this page, "organizer" means the simulated support provider.',
    );
  });

  it('共享支持场景的低收入底线：id / 标签 / 群体 / 比例与原来相同，依据写模拟支持方；两个占位场景的底线不变', () => {
    const oldFloor = SCENARIOS[0].suggestedFairnessFloors[0];
    expect(sharedSupportLowIncomeFloor()).toEqual({
      ...oldFloor,
      basis:
        "Sample: the simulated support provider's charter prioritizes low-income students (fictional basis, for demo only; groups follow each student's self-reported status).",
    });
    for (const e of SCENARIOS.slice(0, 2)) {
      expect(e.suggestedFairnessFloors).toEqual([
        {
          id: 'floor-low-income',
          label: 'Low-income students',
          basis:
            "Sample: the organizer's funding charter prioritizes low-income students (fictional basis, for demo only; groups follow each student's self-reported status).",
          statuses_any_of: ['low_income'],
          min_ratio: 0.5,
        },
      ]);
    }
  });

  describe('What-if 假设说明与 Placeholder 标签用同一个判定（isPlaceholderOpportunity）', () => {
    const viewOf = (s: Scenario) => {
      const anonymized = anonymizeScenarioForClient(s);
      return runWhatIfWithPlan(anonymized, defaultWhatIfInput(anonymized), FLOORS).view;
    };
    const REAL_DATA =
      'All students, support measures, costs and budgets are sample / simulated, not real students or real programs. Results do not represent real-world impact.';
    const placeholderOpp = deviceLoanScenario.opportunities[0];

    it('全是占位机会：前两句与原来逐字相同', () => {
      const v = runWhatIfWithPlan(deviceLoanScenario, defaultWhatIfInput(deviceLoanScenario), FLOORS).view;
      expect(v.assumptions.slice(0, 2)).toEqual([
        'All students and scenario data are sample / simulated, not real students. Results do not represent real-world impact.',
        'Opportunities are placeholders for now, to be replaced with real opportunities verified by a person (official link + verification date).',
      ]);
      expect(v.opportunities.every((o) => o.is_placeholder)).toBe(true);
    });

    it('一个真实机会：不说「全部数据是示例」、不说「机会是占位的」', () => {
      const v = viewOf(build());
      expect(v.opportunities).toEqual([{ title: OPP.title, is_placeholder: false }]);
      expect(v.assumptions.slice(0, 2)).toEqual([
        REAL_DATA,
        'The opportunity is a real listing, used here with sample students and a simulated support provider. Its real organizer is not involved and offers none of these support measures.',
      ]);
      expect(v.assumptions.join('\n')).not.toContain('placeholder');
    });

    it('两个真实机会 / 一个占位 + 一个真实：句子随数量变化；is_placeholder 与 isPlaceholderOpportunity 一致', () => {
      const base = build();
      const second: Opportunity = { ...OPP, id: 'fixture-second-real', title: 'Fictional second listing (test fixture)' };
      const two = viewOf({ ...base, opportunities: [OPP, second] });
      expect(two.assumptions.slice(0, 2)).toEqual([
        REAL_DATA,
        'Both opportunities are real listings, used here with sample students and a simulated support provider. Their real organizers are not involved and offer none of these support measures.',
      ]);
      const mixedOpps = [OPP, placeholderOpp];
      const mixed = viewOf({ ...base, opportunities: mixedOpps });
      expect(mixed.assumptions.slice(0, 2)).toEqual([
        REAL_DATA,
        'One opportunity is a placeholder; the other is a real listing, used here with sample students and a simulated support provider. Its real organizer is not involved and offers none of these support measures.',
      ]);
      expect(mixed.opportunities.map((o) => o.is_placeholder)).toEqual(mixedOpps.map(isPlaceholderOpportunity));
      expect(mixed.opportunities.map((o) => o.is_placeholder)).toEqual([false, true]);
    });
  });
});
