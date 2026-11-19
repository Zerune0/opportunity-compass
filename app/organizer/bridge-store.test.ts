/**
 * 「回到学生端的桥」的存储读写（./bridge-store）测试：内存版 window.localStorage（同 lib/store.test.ts 的做法）。
 * 全部示例 / 模拟数据。
 *
 * 端到端：device-loan 场景按页面的做法匿名化、默认 What-if 输入 → 有分配的匿名学生 s01 对应原始场景里下标 0 的学生；
 * 把它复制成一个可载入的示例档案（id 换成 sample-loaded-test）→ 页面的 roster 把它对应到 s01 →
 * decideBridge → applyBridgeGrants → 学生端用 grantsFor + analyzeReachability 看到设备障碍被这条 grant 化解 →
 * 模拟刷新（丢掉内存里的一切，只从存储找回）→ undoBridgeGrants → 又不可达。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeReachability } from '@/lib/reachability';
import {
  addGrants,
  grantsFor,
  loadGrants,
  loadUserPostedOpportunities,
  saveProfile,
  storageKey,
  STORE_KEYS,
} from '@/lib/store';
import { findCatalogOpportunity, sampleProfiles } from '@/lib/data';
import {
  bridgeGrantId,
  buildClientBridgeInfo,
  decideBridge,
  opportunitiesNeedingLocalCopy,
  rosterStudentId,
} from '@/lib/joint/bridge';
import { DEVICE_LOAN_IDS as IDS, SCENARIOS, anonymizeScenarioForClient, deviceLoanScenario } from '@/lib/joint/scenarios';
import { defaultWhatIfInput, runWhatIfWithPlan } from '@/lib/joint/whatif';
import type { ResourceGrant, Scenario, StudentProfile } from '@/lib/types';
import {
  applyBridgeGrants,
  readAppliedBridgeGrants,
  readLoadedProfileRef,
  readLocalOpportunityIds,
  storeLocalOpportunities,
  undoBridgeGrants,
} from './bridge-store';

const DL = SCENARIOS[0];
const OPP = IDS.opportunity;
const LAPTOP = IDS.laptopLoan;
const GRANTS_KEY = storageKey(STORE_KEYS.grants);
const PROFILE_KEY = storageKey(STORE_KEYS.profile);
const LOADED_ID = 'sample-loaded-test';

/** 测试内的内存版 localStorage；返回底层 Map，方便检查原始字符串。 */
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

function failWrites(): void {
  const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
  storage.setItem = () => {
    throw new Error('QuotaExceededError');
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** 页面的整条链路：匿名化、roster、默认输入的方案明细、判定。 */
function pageSetup() {
  // 从真实求解结果里取第一个有分配的匿名学生，找到它在原始场景里的下标（匿名化按下标编号），
  // 把原始场景里的这名学生当作一个可载入的示例档案。
  const pagePlan = runWhatIfWithPlan(
    anonymizeScenarioForClient(deviceLoanScenario),
    defaultWhatIfInput(deviceLoanScenario),
    DL.suggestedFairnessFloors,
  ).plan;
  const allocatedAnonId = [...new Set(pagePlan.allocations.map((a) => a.student_id))].sort()[0];
  const index = anonymizeScenarioForClient(deviceLoanScenario).students.findIndex((s) => s.id === allocatedAnonId);
  const original: Scenario = {
    ...deviceLoanScenario,
    students: deviceLoanScenario.students.map((s, i) => (i === index ? { ...s, id: LOADED_ID } : s)),
  };
  const anonymized = anonymizeScenarioForClient(original);
  const bridge = buildClientBridgeInfo({
    original,
    anonymized,
    loadableProfileIds: [LOADED_ID],
    catalogOpportunityIds: [],
    provider: DL.sampleOrganizer,
  });
  const { plan } = runWhatIfWithPlan(anonymized, defaultWhatIfInput(anonymized), DL.suggestedFairnessFloors);
  const profile: StudentProfile = { ...deviceLoanScenario.students[index], id: LOADED_ID, is_sample: true };
  return { index, allocatedAnonId, original, anonymized, bridge, plan, profile };
}

describe('bridge-store：无 window（SSR）', () => {
  it('读为空、写不成功、撤回无事可做；都不抛异常', () => {
    expect(typeof window).toBe('undefined');
    const g: ResourceGrant = {
      id: bridgeGrantId('device-loan', LAPTOP, 'sample-maya', OPP),
      student_id: 'sample-maya',
      opportunity_id: OPP,
      intervention_id: LAPTOP,
      type: 'device',
      device: 'laptop',
      status: 'approved',
      provider: DL.sampleOrganizer,
      is_sample: true,
    };
    expect(readLoadedProfileRef()).toBeNull();
    expect(applyBridgeGrants([g])).toEqual({ ok: false });
    expect(readAppliedBridgeGrants(deviceLoanScenario)).toEqual([]);
    expect(undoBridgeGrants(deviceLoanScenario)).toEqual({ ok: true, removed: 0 });
  });
});

describe('bridge-store：读档案只取 id 与 is_sample', () => {
  it('没有档案 → null；有档案 → 只有两个字段', () => {
    installFakeWindow();
    expect(readLoadedProfileRef()).toBeNull();
    const { profile } = pageSetup();
    expect(saveProfile({ ...profile, display_name: 'Secret Name', school_name: 'Secret School' })).toBe(true);
    const ref = readLoadedProfileRef();
    expect(ref).toEqual({ id: LOADED_ID, is_sample: true });
    expect(Object.keys(ref!).sort()).toEqual(['id', 'is_sample']);
    saveProfile({ ...profile, is_sample: false });
    expect(readLoadedProfileRef()).toEqual({ id: LOADED_ID, is_sample: false });
  });

  it('没有写入任何东西时 applyBridgeGrants([]) 不成功、存储不变', () => {
    const data = installFakeWindow();
    expect(applyBridgeGrants([])).toEqual({ ok: false });
    expect(data.has(GRANTS_KEY)).toBe(false);
  });
});

describe('端到端：device-loan 的方案经桥写到学生端，刷新后撤回', () => {
  it('写入前不可达（设备障碍）→ 写入后可达（障碍由桥的 grant 化解）→ 刷新后撤回 → 又不可达', () => {
    const data = installFakeWindow();
    const { index, allocatedAnonId, anonymized, bridge, plan, profile } = pageSetup();
    // 默认输入下第一个有分配的是 s01（原始场景下标 0 的学生）
    expect([allocatedAnonId, index]).toEqual(['s01', 0]);
    // 匿名化结果与页面的完全相同（只是原始 id 换了一个）
    expect(anonymized).toEqual(anonymizeScenarioForClient(deviceLoanScenario));
    expect(bridge.roster).toEqual({ [LOADED_ID]: 's01' });
    expect(plan.allocations.some((a) => a.student_id === anonymized.students[index].id)).toBe(true);
    expect(saveProfile(profile)).toBe(true);

    const opp = deviceLoanScenario.opportunities.find((o) => o.id === OPP)!;
    const today = { today: deviceLoanScenario.evaluation_date };

    // 写入前
    const before = analyzeReachability(profile, opp, grantsFor(LOADED_ID, OPP), today);
    expect(before.reachable).toBe(false);
    expect(before.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);

    // 页面：读档案 → 查 roster → 判定 → 写入
    const loaded = readLoadedProfileRef();
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: loaded,
      scenarioStudentId: loaded ? rosterStudentId(bridge.roster, loaded.id) : null,
      provider: bridge.provider,
    });
    expect(decision.state).toBe('ready');
    expect(decision.membership_sentence).toBe("The loaded sample profile is in this plan's allocation.");
    const bridgeId = 'organizer-bridge:device-loan:iv-laptop-loan:sample-loaded-test:placeholder-inperson-event';
    expect(decision.grants.map((g) => g.id)).toEqual([bridgeId]);
    expect(readAppliedBridgeGrants(anonymized)).toEqual([]);
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });

    // 学生端（Quest Details 用同样的规则）
    const effective = grantsFor(LOADED_ID, OPP);
    expect(effective).toEqual([decision.grants[0]]);
    expect(effective[0]).toMatchObject({ status: 'approved', is_sample: true, type: 'device', device: 'laptop', provider: 'Sample organizer (placeholder)' });
    const after = analyzeReachability(profile, opp, effective, today);
    expect(after.reachable).toBe(true);
    const device = after.barriers.find((b) => b.type === 'device')!;
    expect(device.resolved).toBe(true);
    expect(device.resolved_by_grant_ids).toContain(bridgeId);
    expect(after.barriers.every((b) => b.resolved)).toBe(true);

    // 模拟刷新：丢掉内存里的一切（新的 window 对象、重新匿名化的场景），只从存储里找回
    installFakeWindow(data);
    const reloaded = anonymizeScenarioForClient(deviceLoanScenario);
    const applied = readAppliedBridgeGrants(reloaded);
    expect(applied.map((g) => g.id)).toEqual([bridgeId]);
    expect(undoBridgeGrants(reloaded)).toEqual({ ok: true, removed: 1 });
    expect(readAppliedBridgeGrants(reloaded)).toEqual([]);
    expect(grantsFor(LOADED_ID, OPP)).toEqual([]);
    const undone = analyzeReachability(profile, opp, grantsFor(LOADED_ID, OPP), today);
    expect(undone.reachable).toBe(false);
    expect(undone.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);
    // 档案没有被动过
    expect(JSON.parse(data.get(PROFILE_KEY)!)).toEqual(profile);
    // 再撤回一次：无事可做
    expect(undoBridgeGrants(reloaded)).toEqual({ ok: true, removed: 0 });
  });
});

describe('撤回只删本场景的桥写入的 grant，别的都不动', () => {
  const base = { type: 'device' as const, device: 'laptop' as const, status: 'approved' as const, provider: 'Example Org (fictional)', is_sample: true };

  it('预置的 grant（别的学生 / 同措施但非桥 id / 别的场景的桥 / 没有措施）与其他键在写入 + 撤回后逐字不变', () => {
    const data = installFakeWindow();
    const { anonymized, bridge, plan, profile } = pageSetup();
    saveProfile(profile);
    data.set(storageKey(STORE_KEYS.savedOpportunityIds), JSON.stringify(['some-opportunity']));
    const preseed: ResourceGrant[] = [
      // (a) 别的学生
      { ...base, id: 'leo-laptop', student_id: 'sample-leo', opportunity_id: OPP, intervention_id: LAPTOP },
      // (b) 同一措施、同一学生、同一机会，但不是桥的 id（例如主办方手工发的）
      { ...base, id: 'manual-laptop-1', student_id: LOADED_ID, opportunity_id: OPP, intervention_id: LAPTOP },
      // (c) 别的场景的桥（措施 id 相同；也包括场景 id 以本场景 id 开头的）
      { ...base, id: bridgeGrantId('venue-tradeoff', LAPTOP, LOADED_ID, OPP), student_id: LOADED_ID, opportunity_id: OPP, intervention_id: LAPTOP },
      { ...base, id: bridgeGrantId('device-loan-2', LAPTOP, LOADED_ID, OPP), student_id: LOADED_ID, opportunity_id: OPP, intervention_id: LAPTOP },
      // (d) 没有 intervention_id
      { ...base, id: 'no-intervention', student_id: LOADED_ID, opportunity_id: null },
      // 前缀相同但多了一段
      { ...base, id: `${bridgeGrantId('device-loan', LAPTOP, LOADED_ID, OPP)}:copy`, student_id: LOADED_ID, opportunity_id: OPP, intervention_id: LAPTOP },
    ];
    expect(addGrants(preseed).map((g) => g.id)).toEqual(preseed.map((g) => g.id));
    const snapshot = new Map(data);
    expect(readAppliedBridgeGrants(anonymized)).toEqual([]);

    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: readLoadedProfileRef(),
      scenarioStudentId: rosterStudentId(bridge.roster, LOADED_ID),
      provider: bridge.provider,
    });
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });
    expect(loadGrants().map((g) => g.id)).toEqual([...preseed.map((g) => g.id), ...decision.grants.map((g) => g.id)]);
    expect(readAppliedBridgeGrants(anonymized).map((g) => g.id)).toEqual(decision.grants.map((g) => g.id));

    expect(undoBridgeGrants(anonymized)).toEqual({ ok: true, removed: decision.grants.length });
    expect(loadGrants()).toEqual(preseed);
    // 存储里的每个键（grants、档案、收藏）都与写入前逐字相同
    expect(new Map(data)).toEqual(snapshot);
  });

  it('本场景的桥给别的档案写的 grant 也一起撤回（页面会注明）', () => {
    installFakeWindow();
    const other: ResourceGrant = {
      ...base,
      id: bridgeGrantId('device-loan', LAPTOP, 'sample-maya', OPP),
      student_id: 'sample-maya',
      opportunity_id: OPP,
      intervention_id: LAPTOP,
    };
    const unrelated: ResourceGrant = { ...base, id: 'unrelated', student_id: 'sample-maya', opportunity_id: OPP, intervention_id: LAPTOP };
    addGrants([unrelated, other]);
    expect(readAppliedBridgeGrants(deviceLoanScenario)).toEqual([other]);
    expect(undoBridgeGrants(deviceLoanScenario)).toEqual({ ok: true, removed: 1 });
    expect(loadGrants()).toEqual([unrelated]);
  });

  it('存储里同一条 grant 出现两次（例如导入的备份）时按 id 去重；撤回把它们都删掉', () => {
    const data = installFakeWindow();
    const g: ResourceGrant = { ...base, id: bridgeGrantId('device-loan', LAPTOP, 'sample-maya', OPP), student_id: 'sample-maya', opportunity_id: OPP, intervention_id: LAPTOP };
    data.set(GRANTS_KEY, JSON.stringify([g, g]));
    expect(readAppliedBridgeGrants(deviceLoanScenario)).toEqual([g]);
    expect(undoBridgeGrants(deviceLoanScenario)).toEqual({ ok: true, removed: 1 });
    expect(loadGrants()).toEqual([]);
  });
});

describe('写入失败：返回 ok: false，存储不变', () => {
  it('setItem 抛错（如配额满）：applyBridgeGrants 不成功、存储逐字不变', () => {
    const data = installFakeWindow();
    const { bridge, plan, profile, anonymized } = pageSetup();
    saveProfile(profile);
    addGrants([{ id: 'existing', student_id: 'sample-leo', opportunity_id: null, type: 'device', device: 'laptop', status: 'approved', provider: 'Example Org (fictional)' }]);
    const snapshot = new Map(data);
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: readLoadedProfileRef(),
      scenarioStudentId: rosterStudentId(bridge.roster, LOADED_ID),
      provider: bridge.provider,
    });
    expect(decision.can_apply).toBe(true);
    failWrites();
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: false });
    expect(new Map(data)).toEqual(snapshot);
    expect(readAppliedBridgeGrants(anonymized)).toEqual([]);
  });

  it('setItem 抛错时撤回不成功（removed 0），存储逐字不变', () => {
    const data = installFakeWindow();
    const { bridge, plan, profile, anonymized } = pageSetup();
    saveProfile(profile);
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: readLoadedProfileRef(),
      scenarioStudentId: rosterStudentId(bridge.roster, LOADED_ID),
      provider: bridge.provider,
    });
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });
    const snapshot = new Map(data);
    failWrites();
    expect(undoBridgeGrants(anonymized)).toEqual({ ok: false, removed: 0 });
    expect(new Map(data)).toEqual(snapshot);
    expect(readAppliedBridgeGrants(anonymized).map((g) => g.id)).toEqual(decision.grants.map((g) => g.id));
  });

  it('访问 localStorage 本身就抛错（某些隐私模式）：读为空、写不成功、不抛异常', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        get localStorage(): Storage {
          throw new Error('SecurityError');
        },
      },
    });
    const { plan, bridge, anonymized } = pageSetup();
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: { id: LOADED_ID, is_sample: true },
      scenarioStudentId: rosterStudentId(bridge.roster, LOADED_ID),
      provider: bridge.provider,
    });
    expect(readLoadedProfileRef()).toBeNull();
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: false });
    expect(readAppliedBridgeGrants(anonymized)).toEqual([]);
    expect(undoBridgeGrants(anonymized)).toEqual({ ok: true, removed: 0 });
  });
});

describe('学生端目录里没有的机会：存成本地示例副本', () => {
  const opp = deviceLoanScenario.opportunities[0];

  it('没有 window（SSR）：读为空、存不成功、不抛异常；空列表算成功（无事可做）', () => {
    expect(readLocalOpportunityIds([OPP])).toEqual([]);
    expect(storeLocalOpportunities([opp])).toEqual({ ok: false });
    expect(storeLocalOpportunities([])).toEqual({ ok: true });
  });

  it('存入后读得回来，存储层标成 user_posted + is_sample；内容与场景里的一致；重复存不产生第二条', () => {
    installFakeWindow();
    expect(readLocalOpportunityIds([OPP, 'other'])).toEqual([]);
    expect(storeLocalOpportunities([opp])).toEqual({ ok: true });
    expect(storeLocalOpportunities([opp])).toEqual({ ok: true });
    expect(readLocalOpportunityIds(['other', OPP])).toEqual([OPP]);
    const stored = loadUserPostedOpportunities();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toEqual({ ...opp, source_tier: 'user_posted', is_sample: true });
  });

  it('撤回支持后副本保留（学生端仍打得开，看到障碍重新出现）；别的本地机会不动', () => {
    const { anonymized, bridge, plan } = pageSetup();
    installFakeWindow();
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: { id: LOADED_ID, is_sample: true },
      scenarioStudentId: rosterStudentId(bridge.roster, LOADED_ID),
      provider: bridge.provider,
    });
    expect(decision.state).toBe('ready');
    const other = { ...opp, id: 'sample-post-something-else', title: 'Another local sample' };
    expect(storeLocalOpportunities([other, anonymized.opportunities[0]])).toEqual({ ok: true });
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });
    expect(undoBridgeGrants(anonymized)).toEqual({ ok: true, removed: decision.grants.length });
    expect(loadUserPostedOpportunities().map((o) => o.id)).toEqual(['sample-post-something-else', OPP]);
  });

  it('写不进去（setItem 抛错）：ok 为 false', () => {
    installFakeWindow();
    failWrites();
    expect(storeLocalOpportunities([opp])).toEqual({ ok: false });
  });
});

describe('shared-support（仓库里的真实数据）：页面的整条路径，含本地示例副本', () => {
  it('Maya 在默认方案的分配里 → 存副本 + 写入 → 学生端可达 → 撤回 → 不可达，副本保留', () => {
    const entry = SCENARIOS.find((e) => e.id === 'shared-support');
    expect(entry, 'shared-support is listed').toBeDefined();
    const original = entry!.scenario;
    const anonymized = anonymizeScenarioForClient(original);
    const catalogIds = original.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id);
    const info = buildClientBridgeInfo({
      original,
      anonymized,
      loadableProfileIds: sampleProfiles().map((p) => p.id),
      catalogOpportunityIds: catalogIds,
      provider: entry!.sampleOrganizer,
    });
    // 「有 Quest Details 页面」只认目录里的机会；不在目录里的必须走本地副本，否则链接打不开。
    expect(info.quest_opportunity_ids).toEqual(catalogIds);
    const maya = sampleProfiles().find((p) => p.id === 'sample-maya')!;
    const anonId = rosterStudentId(info.roster, maya.id);
    expect(anonId).not.toBeNull();

    const { plan } = runWhatIfWithPlan(anonymized, defaultWhatIfInput(anonymized), entry!.suggestedFairnessFloors);
    const decision = decideBridge({
      scenarioId: anonymized.id,
      plan,
      profile: { id: maya.id, is_sample: maya.is_sample === true },
      scenarioStudentId: anonId,
      provider: info.provider,
    });
    expect(decision.state).toBe('ready');
    expect(decision.grants.every((g) => g.provider === 'Sample community partner (simulated)')).toBe(true);

    const copies = opportunitiesNeedingLocalCopy({
      scenarioOpportunities: anonymized.opportunities,
      grantOpportunityIds: decision.opportunity_ids,
      catalogOpportunityIds: info.quest_opportunity_ids,
    });
    expect(copies.map((o) => o.id)).toEqual(decision.opportunity_ids.filter((id) => !catalogIds.includes(id)));

    installFakeWindow();
    const today = { today: original.evaluation_date };
    expect(storeLocalOpportunities(copies)).toEqual({ ok: true });
    expect(applyBridgeGrants(decision.grants)).toEqual({ ok: true });
    for (const oppId of decision.opportunity_ids) {
      // 学生端能打开的那一份：目录里的，或刚存的本地副本。
      const seen = findCatalogOpportunity(oppId) ?? loadUserPostedOpportunities().find((o) => o.id === oppId);
      expect(seen, `student side can open ${oppId}`).toBeDefined();
      expect(analyzeReachability(maya, seen!, grantsFor(maya.id, oppId), today).reachable).toBe(true);
      expect(analyzeReachability(maya, seen!, [], today).reachable).toBe(false);
    }
    expect(undoBridgeGrants(anonymized)).toEqual({ ok: true, removed: decision.grants.length });
    expect(loadGrants()).toEqual([]);
    expect(readLocalOpportunityIds(copies.map((o) => o.id))).toEqual(copies.map((o) => o.id));
  });
});
