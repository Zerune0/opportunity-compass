/**
 * 演示最后一幕的「接线」测试：用仓库里真实的场景文件和真实的示例档案，走主办方端的桥要走的那条路。
 *
 *   主办方场景里的示例机会（data/scenarios/device-loan.json，不在学生端机会目录里）
 *     → addUserPostedOpportunity 存到本地，学生端的 Quest Details 才打得开它
 *     → addGrants 写入一条已批准的笔记本借用
 *     → 学生端用 grantsFor 读到它，analyzeReachability 从不可达变为可达
 *     → removeGrants 撤回，回到不可达
 *
 * lib/demo-mainline.test.ts 用的是本文件内的虚构夹具；这里钉住的是「仓库里现有的数据组合确实走得通」：
 * 如果有人改了场景里的机会、示例档案或存储函数，使最后一幕演示不出来，这里会先失败。
 * 机会与支持都是示例 / 模拟数据；可达 ≠ 录取。
 *
 * 最后一个 describe 钉住线上演示实际走的那条路径：第三个场景 shared-support（data/scenarios/shared-support.json
 * 经 lib/joint/scenario-template / lib/joint/scenarios 生成）→ 页面的匿名化与默认 What-if 输入 → 求解 OPTIMAL 且独立复核通过
 * → lib/joint/bridge 的 decideBridge 产出 grant → lib/store 的 addGrants / removeGrants。
 * （app/organizer/bridge-store 的浏览器封装不在 lib/ 测试里 import；它只是转调这几个 lib/store 函数，见 app/organizer/bridge-store.test.ts。）
 */
import { afterEach, describe, expect, it } from 'vitest';
import scenarioJson from '@/data/scenarios/device-loan.json';
import { catalogOpportunities, findCatalogOpportunity, sampleProfiles } from './data';
import { solveJoint, verifyPlan } from './joint';
import { buildClientBridgeInfo, decideBridge, rosterStudentId } from './joint/bridge';
import { SCENARIOS, SHARED_SUPPORT_IDS, anonymizeScenarioForClient } from './joint/scenarios';
import { defaultWhatIfInput, runWhatIfWithPlan } from './joint/whatif';
import { checkEligibility } from './eligibility';
import { analyzeGaps } from './gap';
import { explainMatch } from './match';
import { analyzeReachability } from './reachability';
import {
  addGrants,
  addUserPostedOpportunity,
  grantsByIntervention,
  grantsFor,
  loadGrants,
  loadUserPostedOpportunities,
  removeGrants,
} from './store';
import type { Opportunity, ResourceGrant, Scenario } from './types';
import { validateOpportunity } from './validation';

const scenario = scenarioJson as unknown as Scenario;
const OPP = scenario.opportunities[0] as Opportunity;
const MAYA = sampleProfiles().find((p) => p.id === 'sample-maya')!;
const TODAY = { today: '2026-11-19' };

const LOAN: ResourceGrant = {
  id: 'iv-laptop-loan:sample-maya',
  student_id: MAYA.id,
  opportunity_id: OPP.id,
  intervention_id: 'iv-laptop-loan',
  type: 'device',
  device: 'laptop',
  status: 'approved',
  provider: 'Sample organizer (placeholder)',
};

function installFakeWindow(): void {
  const data = new Map<string, string>();
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
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('演示最后一幕：仓库里现有的场景与示例档案走得通', () => {
  it('前提：场景里的机会是标明的示例，不在学生端的机会目录里，结构合法', () => {
    expect(scenario.is_sample).toBe(true);
    expect(OPP.id).toBe('placeholder-inperson-event');
    expect(OPP.is_sample).toBe(true);
    expect(OPP.official_url).toContain('example.com');
    expect(catalogOpportunities().some((o) => o.id === OPP.id)).toBe(false);
    expect(validateOpportunity(OPP)).toEqual([]);
    expect(scenario.interventions.some((i) => i.id === 'iv-laptop-loan')).toBe(true);
    expect(MAYA.is_sample).toBe(true);
  });

  it('没有支持时：Maya 资格符合，唯一未化解的障碍是设备，结果不可达', () => {
    expect(checkEligibility(MAYA, OPP, TODAY).overall).toBe('eligible');
    const reach = analyzeReachability(MAYA, OPP, [], TODAY);
    expect(reach.reachable).toBe(false);
    expect(reach.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);
    expect(reach.missing_info).toEqual([]);

    const gaps = analyzeGaps(MAYA, OPP, [], TODAY);
    expect(gaps.counts.time_and_cost).toBe(1);
    expect(gaps.counts.unchangeable_eligibility).toBe(0);
    expect(explainMatch(MAYA, OPP, TODAY).reasons.find((r) => r.kind === 'device')?.positive).toBe(false);
  });

  it('桥的路径：存机会 → 写入支持 → 学生端读到并变为可达 → 撤回后回到不可达', () => {
    installFakeWindow();

    // 学生端只认机会目录和本地存的机会；存进去之后 Quest Details 才打得开。
    addUserPostedOpportunity(OPP);
    const posted = loadUserPostedOpportunities().find((o) => o.id === OPP.id);
    expect(posted).toBeDefined();
    expect(posted!.is_sample).toBe(true);
    expect(posted!.source_tier).toBe('user_posted');

    // 写入：调用方没标 is_sample，存储层一律标上，学生端据此显示 "Simulated support"。
    addGrants([LOAN]);
    const mine = grantsFor(MAYA.id, OPP.id);
    expect(mine.map((g) => g.id)).toEqual([LOAN.id]);
    expect(mine[0].is_sample).toBe(true);

    const after = analyzeReachability(MAYA, posted!, mine, TODAY);
    expect(after.reachable).toBe(true);
    const device = after.barriers.find((b) => b.type === 'device')!;
    expect(device.resolved).toBe(true);
    expect(device.resolved_by_grant_ids).toEqual([LOAN.id]);
    expect(explainMatch(MAYA, posted!, { ...TODAY, grants: mine }).reasons.find((r) => r.kind === 'device')?.positive).toBe(true);
    expect(analyzeGaps(MAYA, posted!, mine, TODAY).counts.time_and_cost).toBe(0);

    // 撤回：刷新页面后按措施找回，再按 id 删除。
    removeGrants(grantsByIntervention('iv-laptop-loan').map((g) => g.id));
    expect(loadGrants()).toEqual([]);
    expect(analyzeReachability(MAYA, posted!, grantsFor(MAYA.id, OPP.id), TODAY).reachable).toBe(false);
  });

  it('待审批的支持、给别的学生的支持，都不会让 Maya 变为可达', () => {
    const pending: ResourceGrant = { ...LOAN, id: 'pending', status: 'pending', is_sample: true };
    const other: ResourceGrant = { ...LOAN, id: 'other', student_id: 'dl-s01', is_sample: true };
    expect(analyzeReachability(MAYA, OPP, [pending], TODAY).reachable).toBe(false);
    expect(analyzeReachability(MAYA, OPP, [other], TODAY).reachable).toBe(false);
  });

  it('其他三名示例学生在这条机会上资格不符：演示这一步只能用 Maya', () => {
    const others = sampleProfiles().filter((p) => p.id !== MAYA.id);
    expect(others.map((p) => checkEligibility(p, OPP, TODAY).overall)).toEqual(others.map(() => 'not_eligible'));
  });
});

describe('演示最后一幕（线上实际路径）：shared-support 场景 → 桥 → Maya 的设备支持', () => {
  const entry = SCENARIOS.find((e) => e.id === 'shared-support');
  const SS_OPP_ID = 'placeholder-inperson-event';

  /** 页面的做法：匿名化、roster（只认可载入的示例档案）、默认 What-if 输入的方案明细。 */
  function pageSetup() {
    expect(entry, 'shared-support is listed as a demo scenario').toBeDefined();
    const original = entry!.scenario;
    const anonymized = anonymizeScenarioForClient(original);
    const info = buildClientBridgeInfo({
      original,
      anonymized,
      loadableProfileIds: sampleProfiles().map((p) => p.id),
      catalogOpportunityIds: original.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id),
      provider: entry!.sampleOrganizer,
    });
    const { plan } = runWhatIfWithPlan(anonymized, defaultWhatIfInput(anonymized), entry!.suggestedFairnessFloors);
    const decide = (profileId: string, p = plan) =>
      decideBridge({
        scenarioId: anonymized.id,
        plan: p,
        profile: { id: profileId, is_sample: true },
        scenarioStudentId: rosterStudentId(info.roster, profileId),
        provider: info.provider,
      });
    return { original, anonymized, info, plan, decide, today: { today: original.evaluation_date } };
  }

  it('前提：场景是示例，含 sample-maya 与示例机会；求解 OPTIMAL 且独立复核通过', () => {
    const { original, plan } = pageSetup();
    expect(original.is_sample).toBe(true);
    expect(original.students.some((s) => s.id === MAYA.id)).toBe(true);
    expect(original.opportunities.map((o) => o.id)).toEqual([SS_OPP_ID]);
    expect(original.opportunities[0].is_sample).toBe(true);
    expect(catalogOpportunities().some((o) => o.id === SS_OPP_ID)).toBe(false);

    // 页面那一次（匿名化后的场景）
    expect(plan.status).toBe('OPTIMAL');
    expect(plan.verification_passed).toBe(true);
    // 原始场景上独立求解 + 复核一次
    const result = solveJoint(original);
    expect(result.status).toBe('OPTIMAL');
    expect(verifyPlan(original, result).passed).toBe(true);
  });

  it('桥只给 Maya 产出 1 条 grant：笔记本借用、已批准、模拟、指向示例机会', () => {
    const { decide } = pageSetup();
    const d = decide(MAYA.id);
    expect(d.state).toBe('ready');
    expect(d.grants).toHaveLength(1);
    expect(d.grants[0]).toMatchObject({
      student_id: MAYA.id,
      intervention_id: SHARED_SUPPORT_IDS.laptopLoan,
      type: 'device',
      status: 'approved',
      is_sample: true,
      opportunity_id: SS_OPP_ID,
    });
    expect(d.grants[0].intervention_id).toBe('iv-ss-laptop-loan');
    expect(d.opportunity_ids).toEqual([SS_OPP_ID]);
  });

  it('pending 的措施不产出 grant：条件性结果里 Maya 的待审批分配不写；只剩待审批分配时什么都不写', () => {
    const { plan, decide } = pageSetup();
    const pendingId = SHARED_SUPPORT_IDS.extraLaptops;
    expect(plan.interventions.find((iv) => iv.id === pendingId)?.status).toBe('pending');
    expect(plan.allocations.some((a) => a.intervention_id === pendingId)).toBe(false);
    // 条件性结果（把 pending 当作已批准）里确实有待审批措施的分配，但它们永远不写入。
    expect((plan.conditional_allocations ?? []).some((a) => a.intervention_id === pendingId)).toBe(true);
    expect(decide(MAYA.id).grants.some((g) => g.intervention_id === pendingId)).toBe(false);

    // 构造：把主结果里的分配都换成待审批措施 → 桥拒绝写入。
    const pendingOnly = { ...plan, allocations: plan.allocations.map((a) => ({ ...a, intervention_id: pendingId })) };
    const d = decide(MAYA.id, pendingOnly);
    expect(d.state).toBe('pending_only');
    expect(d.can_apply).toBe(false);
    expect(d.grants).toEqual([]);
  });

  it('另外三名示例学生（leo、ana、noor）得不到 grant', () => {
    const { decide, info } = pageSetup();
    const others = sampleProfiles().filter((p) => p.id !== MAYA.id);
    expect(others.map((p) => p.id).sort()).toEqual(['sample-ana', 'sample-leo', 'sample-noor']);
    for (const p of others) {
      expect(rosterStudentId(info.roster, p.id)).toBeNull();
      const d = decide(p.id);
      expect(d.can_apply).toBe(false);
      expect(d.grants).toEqual([]);
    }
  });

  it('写入前不可达（唯一未化解障碍是 device）→ addGrants 后可达 → removeGrants 撤回后恢复不可达', () => {
    const { anonymized, decide, today } = pageSetup();
    installFakeWindow();
    const opp = anonymized.opportunities.find((o) => o.id === SS_OPP_ID)!;
    // 不在目录里的机会：先存本地示例副本，学生端才打得开。
    addUserPostedOpportunity(opp);
    const posted = loadUserPostedOpportunities().find((o) => o.id === SS_OPP_ID)!;
    expect(posted.is_sample).toBe(true);
    expect(posted.source_tier).toBe('user_posted');

    const before = analyzeReachability(MAYA, posted, grantsFor(MAYA.id, SS_OPP_ID), today);
    expect(before.reachable).toBe(false);
    expect(before.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);

    const grants = decide(MAYA.id).grants;
    const stored = addGrants(grants);
    expect(stored.map((g) => g.id)).toEqual(grants.map((g) => g.id));
    const mine = grantsFor(MAYA.id, SS_OPP_ID);
    expect(mine).toHaveLength(1);
    const after = analyzeReachability(MAYA, posted, mine, today);
    expect(after.reachable).toBe(true);
    expect(after.barriers.find((b) => b.type === 'device')?.resolved_by_grant_ids).toEqual([grants[0].id]);

    removeGrants(grants.map((g) => g.id));
    expect(loadGrants()).toEqual([]);
    const undone = analyzeReachability(MAYA, posted, grantsFor(MAYA.id, SS_OPP_ID), today);
    expect(undone.reachable).toBe(false);
    expect(undone.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);
  });
});
