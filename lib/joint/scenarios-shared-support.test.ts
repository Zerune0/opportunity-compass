/**
 * ./scenarios 对共享支持场景模板的接线测试（真实机会与演示学生的 id 还没定，所以用 vi.doMock 替换模板 JSON 与 lib/data）：
 * - 两个 ref 都填好 → sharedSupportScenario 由目录机会与示例档案的原对象拼成，SCENARIOS 追加第三项；
 * - 只填了一个 → 仍为 null，清单只有两项（填了的那个仍要能解析到）；
 * - ref 拼错（目录 / 示例档案里没有）→ import 时抛错，信息写明是哪个 ref。
 * 模板用 ./testing/shared-support-fixtures 的 fixture 模板（不随真实数据调整而变）。全部示例 / 模拟数据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as DataModule from '../data';
import type * as ScenariosModule from './scenarios';
import { buildScenarioFromTemplate, scenarioReadinessProblems } from './scenario-template';
import { buildClientBridgeInfo, decideBridge, rosterStudentId } from './bridge';
import { anonymizeScenarioForClient } from './scenario-utils';
import { defaultWhatIfInput, runWhatIfWithPlan } from './whatif';
import { analyzeReachability } from '../reachability';
import { FIXTURE_DEMO_STUDENT as DEMO, FIXTURE_OPPORTUNITY as OPP, fixtureTemplate } from './testing/shared-support-fixtures';

const TEMPLATE_PATH = '@/data/scenarios/shared-support.json';

/** 换掉模板 JSON（refs 按参数）与 lib/data（目录里多一条 fixture 机会、示例档案里多一个 fixture 演示学生），重新 import ./scenarios。 */
async function loadScenarios(refs: { opportunity_ref: string | null; demo_student_ref: string | null }): Promise<typeof ScenariosModule> {
  vi.resetModules();
  vi.doMock(TEMPLATE_PATH, () => ({ default: { ...fixtureTemplate(), ...refs } }));
  vi.doMock('../data', async (importOriginal) => {
    const actual = await importOriginal<typeof DataModule>();
    return {
      ...actual,
      findCatalogOpportunity: (id: string | null | undefined) => (id === OPP.id ? OPP : actual.findCatalogOpportunity(id)),
      sampleProfiles: () => [...actual.sampleProfiles(), DEMO],
    };
  });
  return import('./scenarios');
}

afterEach(() => {
  vi.doUnmock(TEMPLATE_PATH);
  vi.doUnmock('../data');
  vi.resetModules();
});

describe('sharedSupportScenario 的接线（模拟填好 ref）', () => {
  it('两个 ref 都填好：场景由原对象拼成；SCENARIOS 追加第三项（模拟支持方、真实机会的说明），前两项不变', async () => {
    const m = await loadScenarios({ opportunity_ref: OPP.id, demo_student_ref: DEMO.id });
    const s = m.sharedSupportScenario!;
    expect(s).not.toBeNull();
    expect(s).toEqual(buildScenarioFromTemplate(fixtureTemplate(), { opportunity: OPP, demoStudent: DEMO }));
    expect(s.opportunities[0]).toBe(OPP);
    expect(s.students[0]).toBe(DEMO);
    expect(scenarioReadinessProblems(s, DEMO.id)).toEqual([]);

    expect(m.SCENARIOS.map((e) => e.id)).toEqual(['device-loan', 'venue-tradeoff', 'fixture-shared-support']);
    expect(m.SCENARIOS[0].scenario).toBe(m.deviceLoanScenario);
    expect(m.SCENARIOS[1].scenario).toBe(m.venueTradeoffScenario);
    const third = m.SCENARIOS[2];
    expect(third).toMatchObject({
      title: s.title,
      scenario: s,
      sampleOrganizer: 'Sample community partner (simulated)',
      realOpportunityNote: m.REAL_OPPORTUNITY_NOTE,
    });
    expect(third.sampleOrganizer).not.toBe(OPP.organizer);
    expect(third.description).toBe(
      'Sample: a simulated community partner has a few loaner laptops and a small transport budget for sample students interested in a real in-person opportunity. Not enough for everyone.',
    );
    // 自己的底线对象：依据写模拟支持方；前两个场景的底线不变
    expect(third.suggestedFairnessFloors).toEqual([m.sharedSupportLowIncomeFloor()]);
    expect(third.suggestedFairnessFloors[0].basis).toContain('simulated support provider');
    expect(third.suggestedFairnessFloors[0]).toEqual({ ...m.SCENARIOS[0].suggestedFairnessFloors[0], basis: third.suggestedFairnessFloors[0].basis });
    expect(m.SCENARIOS[0].suggestedFairnessFloors[0].basis).toContain("the organizer's funding charter");
    expect(m.SCENARIOS[0].realOpportunityNote).toBeUndefined();
    expect(m.SCENARIOS[1].realOpportunityNote).toBeUndefined();
    // import 时算好的数据检查结果
    expect(m.sharedSupportReadinessProblems).toEqual([]);
  });

  it('两个 ref 都填好但数据有问题：sharedSupportReadinessProblems 在 import 时给出原因（不抛错、不输出）', async () => {
    vi.resetModules();
    vi.doMock(TEMPLATE_PATH, () => ({ default: fixtureTemplate() }));
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof DataModule>();
      return {
        ...actual,
        findCatalogOpportunity: (id: string | null | undefined) => (id === OPP.id ? { ...OPP, required_devices: [] } : null),
        sampleProfiles: () => [DEMO],
      };
    });
    const m = await import('./scenarios');
    expect(m.sharedSupportScenario).not.toBeNull();
    expect(m.sharedSupportReadinessProblems).toEqual([
      'The demo student is already reachable without any support, so there is nothing to demonstrate.',
    ]);
  });

  it('两个 ref 都填好：按页面的做法走完演示闭环（roster → OPTIMAL 方案 → 桥 ready → 学生端可达）', async () => {
    const m = await loadScenarios({ opportunity_ref: OPP.id, demo_student_ref: DEMO.id });
    const entry = m.SCENARIOS[2];
    const anonymized = anonymizeScenarioForClient(entry.scenario);
    const info = buildClientBridgeInfo({
      original: entry.scenario,
      anonymized,
      loadableProfileIds: [DEMO.id],
      catalogOpportunityIds: [OPP.id],
      provider: entry.sampleOrganizer,
    });
    expect(info.roster).toEqual({ [DEMO.id]: 's1' });
    const { view, plan } = runWhatIfWithPlan(anonymized, defaultWhatIfInput(anonymized), entry.suggestedFairnessFloors);
    expect([view.status, view.verification.passed]).toEqual(['OPTIMAL', true]);
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: { id: DEMO.id, is_sample: true },
      scenarioStudentId: rosterStudentId(info.roster, DEMO.id),
      provider: info.provider,
    });
    expect(decision.state).toBe('ready');
    const today = { today: entry.scenario.evaluation_date };
    expect(analyzeReachability(DEMO, OPP, [], today).reachable).toBe(false);
    expect(analyzeReachability(DEMO, OPP, decision.grants, today).reachable).toBe(true);
  });

  it('只填了一个 ref：仍为 null，清单只有两项', async () => {
    for (const refs of [
      { opportunity_ref: OPP.id, demo_student_ref: null },
      { opportunity_ref: null, demo_student_ref: DEMO.id },
      { opportunity_ref: null, demo_student_ref: null },
    ]) {
      const m = await loadScenarios(refs);
      expect(m.sharedSupportScenario).toBeNull();
      expect(m.sharedSupportReadinessProblems).toEqual([]);
      expect(m.SCENARIOS.map((e) => e.id)).toEqual(['device-loan', 'venue-tradeoff']);
    }
  });

  it('场景专用学生的 id 与可载入示例档案重名：构建器拒绝（./scenarios 传入全部可载入档案 id），import 时抛错', async () => {
    vi.resetModules();
    vi.doMock(TEMPLATE_PATH, () => ({ default: fixtureTemplate() }));
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof DataModule>();
      return {
        ...actual,
        findCatalogOpportunity: (id: string | null | undefined) => (id === OPP.id ? OPP : null),
        sampleProfiles: () => [DEMO, { ...DEMO, id: 'fx-s03', display_name: 'Sample student clash (fixture)' }],
      };
    });
    await expect(import('./scenarios')).rejects.toThrow(/Scenario-only student id "fx-s03" is also a loadable sample profile id/);
  });

  it('ref 拼错：import 时抛错，写明是哪个 ref（另一个还是 null 时也一样）', async () => {
    await expect(loadScenarios({ opportunity_ref: 'no-such-opportunity', demo_student_ref: DEMO.id })).rejects.toThrow(
      'fixture-shared-support: opportunity_ref "no-such-opportunity" is not in the verified catalog (data/opportunities.json), or it failed validation.',
    );
    await expect(loadScenarios({ opportunity_ref: null, demo_student_ref: 'sample-nobody' })).rejects.toThrow(
      'fixture-shared-support: demo_student_ref "sample-nobody" is not a loadable sample profile (data/profiles.json), or it failed validation.',
    );
  });

  it('ref 能解析但不合要求（机会是示例数据）：构建器拒绝，import 时抛错', async () => {
    vi.resetModules();
    vi.doMock(TEMPLATE_PATH, () => ({ default: { ...fixtureTemplate() } }));
    vi.doMock('../data', async (importOriginal) => {
      const actual = await importOriginal<typeof DataModule>();
      return {
        ...actual,
        findCatalogOpportunity: (id: string | null | undefined) => (id === OPP.id ? { ...OPP, is_sample: true } : null),
        sampleProfiles: () => [DEMO],
      };
    });
    await expect(import('./scenarios')).rejects.toThrow(/fixture-shared-support: cannot build the scenario: .*is marked is_sample/);
  });
});
