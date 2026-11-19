/**
 * 交给浏览器的场景（./client-entry 的 toClientScenarioEntry，page.tsx 用的就是它）测试。全部示例 / 模拟数据。
 *
 * - fixture（lib/joint/testing/shared-support-fixtures：模板 + 像目录机会的虚构机会 + 虚构的演示学生）：
 *   进入浏览器的 JSON 里没有任何场景专用学生的 id、姓名、学校，也没有演示学生的姓名、学校与自由文本；
 *   唯一出现的原始学生 id 是 roster 里演示学生的 id。
 * - 端到端（同 ./bridge-store.test.ts 的做法，内存版 localStorage）：桥写入 → 学生端可达 → 撤回 → 又不可达。
 * - 真实数据（共享支持场景的两个 ref 都填好后自动运行）：页面对第三个场景交给浏览器的内容同样满足上面的要求。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeReachability } from '@/lib/reachability';
import { grantsFor } from '@/lib/store';
import { decideBridge, rosterStudentId } from '@/lib/joint/bridge';
import { findCatalogOpportunity, sampleProfiles } from '@/lib/data';
import { buildScenarioFromTemplate } from '@/lib/joint/scenario-template';
import {
  REAL_OPPORTUNITY_NOTE,
  SCENARIOS,
  sharedSupportLowIncomeFloor,
  sharedSupportScenario,
  sharedSupportTemplate,
} from '@/lib/joint/scenarios';
import type { ScenarioEntry } from '@/lib/joint/scenarios';
import { defaultWhatIfInput, runWhatIfWithPlan } from '@/lib/joint/whatif';
import {
  FIXTURE_DEMO_STUDENT as DEMO,
  FIXTURE_OPPORTUNITY as OPP,
  FIXTURE_SCENARIO_STUDENTS,
  fixtureTemplate,
} from '@/lib/joint/testing/shared-support-fixtures';
import type { ClientScenarioEntry } from './what-if';
import { applyBridgeGrants, readAppliedBridgeGrants, undoBridgeGrants } from './bridge-store';
import { toClientScenarioEntry } from './client-entry';

const PROVIDER = 'Sample community partner (simulated)';

/** 与 lib/joint/scenarios 里共享支持场景的条目同形（fixture 版）。 */
function fixtureEntry(): ScenarioEntry {
  const scenario = buildScenarioFromTemplate(fixtureTemplate(), { opportunity: OPP, demoStudent: DEMO });
  return {
    id: scenario.id,
    title: scenario.title,
    description: 'Sample: fixture description.',
    scenario,
    suggestedFairnessFloors: [sharedSupportLowIncomeFloor()],
    sampleOrganizer: PROVIDER,
    realOpportunityNote: REAL_OPPORTUNITY_NOTE,
  };
}

/** page.tsx 的做法：可载入档案 = 示例档案（这里额外加上 fixture 演示学生），目录机会由调用方给出。 */
const toClient = (entry: ScenarioEntry, catalog: readonly string[], extraLoadable: string[] = []) =>
  toClientScenarioEntry(entry, { loadableProfileIds: [...sampleProfiles().map((p) => p.id), ...extraLoadable], catalogOpportunityIds: catalog });

/** 检查：JSON 里没有场景专用学生的 id / 姓名 / 学校；演示学生的原始 id 只在 roster 里。 */
function expectNoStudentInfo(client: ClientScenarioEntry, scenarioOnly: readonly { id: string; display_name: string; school_name?: string | null }[], demo: typeof DEMO) {
  const json = JSON.stringify(client);
  for (const s of scenarioOnly) {
    expect(json.includes(`"${s.id}"`), `contains id ${s.id}`).toBe(false);
    expect(json.includes(s.display_name), `contains name of ${s.id}`).toBe(false);
    if (s.school_name) expect(json.includes(s.school_name), `contains school of ${s.id}`).toBe(false);
  }
  expect(json.includes(demo.display_name)).toBe(false);
  if (demo.school_name) expect(json.includes(demo.school_name)).toBe(false);
  if (demo.transport?.note) expect(json.includes(demo.transport.note)).toBe(false);
  for (const ev of demo.evidence) {
    expect(json.includes(ev.title)).toBe(false);
    if (ev.description) expect(json.includes(ev.description)).toBe(false);
  }
  // 演示学生的原始 id 只出现在 roster 里（roster 也只有它）
  expect(Object.keys(client.bridge.roster)).toEqual([demo.id]);
  const withoutRoster = JSON.stringify({ ...client, bridge: { ...client.bridge, roster: {} } });
  expect(withoutRoster.includes(demo.id)).toBe(false);
}

describe('toClientScenarioEntry：两个占位场景', () => {
  it('没有真实机会的说明、roster 为空、没有 Quest Details 页面', () => {
    for (const e of SCENARIOS.slice(0, 2)) {
      const c = toClient(e, []);
      expect(c.realOpportunityNote).toBeNull();
      expect(c.bridge).toEqual({ provider: e.sampleOrganizer, roster: {}, quest_opportunity_ids: [] });
      expect(c.floors).toEqual(e.suggestedFairnessFloors);
      expect(c.floors[0]).not.toBe(e.suggestedFairnessFloors[0]);
    }
  });
});

describe('toClientScenarioEntry：fixture 共享支持场景', () => {
  it('交给浏览器的内容：说明原样、roster 只有演示学生（s1）、机会有 Quest Details 页面', () => {
    const c = toClient(fixtureEntry(), [OPP.id], [DEMO.id]);
    expect(c.realOpportunityNote).toBe(REAL_OPPORTUNITY_NOTE);
    expect(c.bridge).toEqual({ provider: PROVIDER, roster: { [DEMO.id]: 's1' }, quest_opportunity_ids: [OPP.id] });
    expect(c.scenario.students.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8']);
    expect(c.scenario.opportunities).toEqual([OPP]);
  });

  it('JSON 里没有场景专用学生的 id、姓名、学校；演示学生的原始 id 只在 roster 里', () => {
    const c = toClient(fixtureEntry(), [OPP.id], [DEMO.id]);
    expectNoStudentInfo(c, FIXTURE_SCENARIO_STUDENTS, DEMO);
    expect(JSON.stringify(c).includes('fx-s0')).toBe(false);
  });

  it('不修改输入', () => {
    const e = fixtureEntry();
    const before = JSON.stringify(e);
    toClient(e, [OPP.id], [DEMO.id]);
    expect(JSON.stringify(e)).toBe(before);
  });
});

// ───────────────────────────── 端到端：浏览器存储 ─────────────────────────────

function installFakeWindow(data: Map<string, string> = new Map()): Map<string, string> {
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return data;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('端到端（fixture）：页面方案 → 桥写入 → 学生端可达 → 撤回 → 又不可达', () => {
  it('学生端（grantsFor + analyzeReachability）与主办方的结论一致', () => {
    installFakeWindow();
    const c = toClient(fixtureEntry(), [OPP.id], [DEMO.id]);
    const { plan, view } = runWhatIfWithPlan(c.scenario, defaultWhatIfInput(c.scenario), c.floors);
    expect([view.status, view.verification.passed]).toEqual(['OPTIMAL', true]);
    const decision = decideBridge({
      scenarioId: c.scenario.id,
      plan,
      profile: { id: DEMO.id, is_sample: true },
      scenarioStudentId: rosterStudentId(c.bridge.roster, DEMO.id),
      provider: c.bridge.provider,
    });
    expect(decision.state).toBe('ready');
    const today = { today: c.scenario.evaluation_date };
    expect(analyzeReachability(DEMO, OPP, grantsFor(DEMO.id, OPP.id), today).reachable).toBe(false);

    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });
    const effective = grantsFor(DEMO.id, OPP.id);
    expect(effective.map((g) => g.id)).toEqual(decision.grants.map((g) => g.id));
    expect(effective.every((g) => g.provider === PROVIDER && g.provider !== OPP.organizer)).toBe(true);
    expect(analyzeReachability(DEMO, OPP, effective, today).reachable).toBe(true);

    expect(readAppliedBridgeGrants(c.scenario).map((g) => g.id)).toEqual(decision.grants.map((g) => g.id));
    expect(undoBridgeGrants(c.scenario)).toEqual({ ok: true, removed: decision.grants.length });
    expect(grantsFor(DEMO.id, OPP.id)).toEqual([]);
    expect(analyzeReachability(DEMO, OPP, grantsFor(DEMO.id, OPP.id), today).reachable).toBe(false);
  });
});

// ───────────────────────────── 真实数据（两个 ref 都填好后自动运行）─────────────────────────────

describe.skipIf(sharedSupportScenario === null)('真实数据：页面交给浏览器的共享支持场景', () => {
  it('与 page.tsx 相同的做法：说明、roster（演示学生）、Quest Details 机会；没有场景专用学生的信息', () => {
    const entry = SCENARIOS[2];
    const catalog = entry.scenario.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id);
    const c = toClient(entry, catalog);
    const demo = sampleProfiles().find((p) => p.id === sharedSupportTemplate.demo_student_ref)!;
    expect(c.realOpportunityNote).toBe(REAL_OPPORTUNITY_NOTE);
    expect(c.floors).toEqual([sharedSupportLowIncomeFloor()]);
    expect(c.bridge.provider).toBe('Sample community partner (simulated)');
    expect(Object.keys(c.bridge.roster)).toEqual([demo.id]);
    expect(c.bridge.quest_opportunity_ids).toEqual([sharedSupportTemplate.opportunity_ref]);
    expectNoStudentInfo(c, sharedSupportTemplate.students, demo);
  });
});
