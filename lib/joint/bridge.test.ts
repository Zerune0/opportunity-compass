/**
 * 「回到学生端的桥」（./bridge）测试。全部示例 / 模拟数据。
 *
 * 用到的真实求解结果（data/scenarios/device-loan.json，按页面的做法 anonymizeScenarioForClient 匿名化）：
 * - 默认 What-if 输入：OPTIMAL、独立复核通过；5 台借用笔记本按编号给只缺设备的 s01、s02、s04、s05、s07
 *   （s03 / s06 / s09 还缺交通，s08、s10 名额已满）；条件性结果（卫星会场获批）的分配与主结果相同。
 * - 「只有待审批措施才能覆盖」的真实配置：只纳入 设备借用 + 线上入口 + 卫星会场（不纳入交通补助），预算 $330，
 *   低收入底线 100%。主结果必须覆盖低收入的 4 人（s09 还缺交通 → 线上入口 $150），$330 只够 4 台笔记本
 *   （$150 + $100 + 4 × $20），s01 分不到；条件性结果用卫星会场（$60 + $10）代替线上入口，省下的钱给 s01 一台笔记本
 *   （$270）。所以 s01 只出现在条件性结果的分配里。
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findCatalogOpportunity, sampleProfiles } from '../data';
import {
  BRIDGE_DEMO_NOTICE,
  BRIDGE_GRANT_ID_PREFIX,
  BRIDGE_GRANT_NOTE,
  bridgeGrantId,
  buildClientBridgeInfo,
  decideBridge,
  findBridgeGrants,
  isBridgeGrantOf,
  opportunitiesNeedingLocalCopy,
  rosterStudentId,
  summarizeApplied,
} from './bridge';
import type { BridgeProfileRef } from './bridge';
import { DEVICE_LOAN_IDS as IDS, SCENARIOS, anonymizeScenarioForClient, deviceLoanScenario } from './scenarios';
import { defaultWhatIfInput, runWhatIfWithPlan } from './whatif';
import type { WhatIfInput, WhatIfPlanDetail } from './whatif';
import type { Allocation, Intervention, ResourceGrant, Scenario } from '../types';

const DL = SCENARIOS[0];
/** 与 app/organizer/page.tsx 完全相同的匿名化。 */
const ANON = anonymizeScenarioForClient(deviceLoanScenario);
const FLOORS = DL.suggestedFairnessFloors;
const PROVIDER = DL.sampleOrganizer;
const OPP = IDS.opportunity;
const LAPTOP = IDS.laptopLoan;
const SUBSIDY = IDS.transportSubsidy;
const ONLINE = IDS.onlineEntry;
const SATELLITE = IDS.satelliteVenue;
const LOW_INCOME = 'floor-low-income';

const planFor = (input: Partial<WhatIfInput> = {}): WhatIfPlanDetail =>
  runWhatIfWithPlan(ANON, { ...defaultWhatIfInput(ANON), ...input }, FLOORS).plan;

const DEFAULT_PLAN = planFor();
const SAMPLE: BridgeProfileRef = { id: 'sample-loaded', is_sample: true };

function decide(plan: WhatIfPlanDetail | null, scenarioStudentId: string | null, profile: BridgeProfileRef | null = SAMPLE) {
  return decideBridge({ scenarioId: ANON.id, plan, profile, scenarioStudentId, provider: PROVIDER });
}

const studentsIn = (list: readonly Allocation[] | null) => [...new Set((list ?? []).map((a) => a.student_id))].sort();
const ivOf = (id: string): Intervention => ANON.interventions.find((iv) => iv.id === id)!;

/** 用真实方案明细改出来的方案（只改给出的字段）。 */
const forged = (patch: Partial<WhatIfPlanDetail>): WhatIfPlanDetail => ({ ...DEFAULT_PLAN, ...patch });
const alloc = (intervention_id: string, student_id: string, opportunity_id = OPP): Allocation => ({
  intervention_id,
  student_id,
  opportunity_id,
  cost_usd: 0,
});

const MSG = {
  noProfile: 'No student profile is loaded in this browser. Load a sample profile in Skill Passport first.',
  notSample:
    'This demo action only works with sample profiles. The profile loaded in this browser is not a sample profile, so nothing is written.',
  notInScenario: 'The loaded sample profile is not part of this scenario.',
  noPlan: 'Nothing was computed with the current settings, so there is no plan to write.',
  notVerified: 'This plan did not pass independent verification, so nothing is written.',
  pendingOnly:
    'There is nothing to write. Support from measures still pending approval is never written.',
  notAllocated: 'There is nothing to write. Support from measures still pending approval is never written.',
  inPlan: "The loaded sample profile is in this plan's allocation.",
  notInPlan: "The loaded sample profile is not in this plan's allocation.",
};

// ───────────────────────────── grant id ─────────────────────────────

describe('bridgeGrantId / isBridgeGrantOf / findBridgeGrants', () => {
  const ours = (extra: Partial<ResourceGrant> = {}): ResourceGrant => ({
    id: bridgeGrantId('device-loan', LAPTOP, 'sample-maya', OPP),
    student_id: 'sample-maya',
    opportunity_id: OPP,
    intervention_id: LAPTOP,
    type: 'device',
    device: 'laptop',
    status: 'approved',
    provider: PROVIDER,
    is_sample: true,
    ...extra,
  });

  it('id 格式固定', () => {
    expect(BRIDGE_GRANT_ID_PREFIX).toBe('organizer-bridge');
    expect(bridgeGrantId('device-loan', LAPTOP, 'sample-maya', OPP)).toBe(
      'organizer-bridge:device-loan:iv-laptop-loan:sample-maya:placeholder-inperson-event',
    );
  });

  it('段内的冒号被转义：不同的 (场景, 措施) 拼不出同一个 id；带冒号的 id 也能认回来', () => {
    expect(bridgeGrantId('a', 'b:c', 'p', 'o')).not.toBe(bridgeGrantId('a:b', 'c', 'p', 'o'));
    expect(bridgeGrantId('a', 'b:c', 'p', 'o')).toBe('organizer-bridge:a:b%3Ac:p:o');
    const odd = ours({ id: bridgeGrantId('a', 'b:c', 'sample-maya', OPP), intervention_id: 'b:c' });
    expect(isBridgeGrantOf('a', odd)).toBe(true);
    expect(isBridgeGrantOf('a:b', { ...odd, intervention_id: 'c' })).toBe(false);
  });

  it('用自己的字段重建出同一个 id 的才是本场景的桥写入的', () => {
    expect(isBridgeGrantOf('device-loan', ours())).toBe(true);
  });

  it('不是我们的：同措施但 id 不同 / 别的场景 / opportunity_id 为 null / 只是前缀匹配 / 字段与 id 对不上', () => {
    // 同一措施、同一学生、同一机会，但 id 是别人起的（例如主办方手工发的）
    expect(isBridgeGrantOf('device-loan', ours({ id: 'manual-laptop-1' }))).toBe(false);
    // 别的场景（含：场景 id 互为前缀）
    const other = ours({ id: bridgeGrantId('venue-tradeoff', LAPTOP, 'sample-maya', OPP) });
    expect(isBridgeGrantOf('device-loan', other)).toBe(false);
    expect(isBridgeGrantOf('venue-tradeoff', other)).toBe(true);
    const longer = ours({ id: bridgeGrantId('device-loan-2', LAPTOP, 'sample-maya', OPP) });
    expect(isBridgeGrantOf('device-loan', longer)).toBe(false);
    expect(isBridgeGrantOf('device', ours())).toBe(false);
    // opportunity_id 为 null（即使 id 里写的是 "null"）
    expect(isBridgeGrantOf('device-loan', ours({ id: bridgeGrantId('device-loan', LAPTOP, 'sample-maya', 'null'), opportunity_id: null }))).toBe(false);
    // 只是前缀：多了一段 / 少了一段
    expect(isBridgeGrantOf('device-loan', ours({ id: `${ours().id}:extra` }))).toBe(false);
    expect(isBridgeGrantOf('device-loan', ours({ id: 'organizer-bridge:device-loan:iv-laptop-loan' }))).toBe(false);
    expect(isBridgeGrantOf('device-loan', ours({ id: 'organizer-bridge:device-loan' }))).toBe(false);
    // id 是对的，但字段不是（学生、措施、机会任一不同）
    expect(isBridgeGrantOf('device-loan', ours({ student_id: 'sample-leo' }))).toBe(false);
    expect(isBridgeGrantOf('device-loan', ours({ intervention_id: SUBSIDY }))).toBe(false);
    expect(isBridgeGrantOf('device-loan', ours({ opportunity_id: 'other-opp' }))).toBe(false);
    // 没有 intervention_id
    expect(isBridgeGrantOf('device-loan', ours({ intervention_id: null }))).toBe(false);
    expect(isBridgeGrantOf('device-loan', ours({ intervention_id: undefined }))).toBe(false);
  });

  it('findBridgeGrants 只挑本场景的，保持原顺序', () => {
    const a = ours();
    const b = ours({ id: bridgeGrantId('device-loan', SUBSIDY, 'sample-leo', OPP), student_id: 'sample-leo', intervention_id: SUBSIDY });
    const stored: ResourceGrant[] = [
      ours({ id: 'manual-laptop-1' }),
      b,
      ours({ id: bridgeGrantId('venue-tradeoff', LAPTOP, 'sample-maya', OPP) }),
      a,
      ours({ id: `${a.id}:extra` }),
    ];
    expect(findBridgeGrants(stored, 'device-loan')).toEqual([b, a]);
    expect(findBridgeGrants([], 'device-loan')).toEqual([]);
  });
});

// ───────────────────────────── 真实方案 ─────────────────────────────

describe('device-loan（按页面的做法匿名化）+ 默认输入的真实方案', () => {
  it('OPTIMAL、复核通过；分配只用已批准的设备借用，给 s01 s02 s04 s05 s07', () => {
    expect(DEFAULT_PLAN.scenario_id).toBe('device-loan');
    expect(DEFAULT_PLAN.status).toBe('OPTIMAL');
    expect(DEFAULT_PLAN.verification_passed).toBe(true);
    expect(DEFAULT_PLAN.allocations.every((a) => a.intervention_id === LAPTOP && a.opportunity_id === OPP)).toBe(true);
    expect(studentsIn(DEFAULT_PLAN.allocations)).toEqual(['s01', 's02', 's04', 's05', 's07']);
    expect(DEFAULT_PLAN.conditional_allocations).toEqual(DEFAULT_PLAN.allocations);
  });

  it('ready：给有分配的学生写一条设备借用 grant（字段逐项固定）', () => {
    const allocated = studentsIn(DEFAULT_PLAN.allocations)[0];
    expect(allocated).toBe('s01');
    const d = decide(DEFAULT_PLAN, allocated);
    expect(d).toEqual({
      state: 'ready',
      can_apply: true,
      membership_sentence: MSG.inPlan,
      reason: null,
      grants: [
        {
          id: 'organizer-bridge:device-loan:iv-laptop-loan:sample-loaded:placeholder-inperson-event',
          student_id: 'sample-loaded',
          opportunity_id: 'placeholder-inperson-event',
          intervention_id: 'iv-laptop-loan',
          type: 'device',
          amount_usd: null,
          device: 'laptop',
          hours_per_week: null,
          status: 'approved',
          provider: 'Sample organizer (placeholder)',
          note: 'Written by the Organizer What-if local demo. Simulated support, not a real award.',
          is_sample: true,
        },
      ],
      opportunity_ids: ['placeholder-inperson-event'],
    });
    expect(d.grants[0].note).toBe(BRIDGE_GRANT_NOTE);
  });

  it('not_allocated：没有分配、也不在条件性结果里的学生', () => {
    const allocated = studentsIn(DEFAULT_PLAN.allocations);
    const conditional = studentsIn(DEFAULT_PLAN.conditional_allocations);
    const unallocated = ANON.students.map((s) => s.id).filter((id) => !allocated.includes(id) && !conditional.includes(id));
    expect(unallocated).toEqual(['s03', 's06', 's08', 's09', 's10']);
    for (const sid of unallocated) {
      expect(decide(DEFAULT_PLAN, sid)).toEqual({
        state: 'not_allocated',
        can_apply: false,
        membership_sentence: MSG.notInPlan,
        reason: MSG.notAllocated,
        grants: [],
        opportunity_ids: [],
      });
    }
  });

  it('确定性、不修改输入；输出不含档案的其他字段，也不含匿名编号', () => {
    const before = JSON.stringify(DEFAULT_PLAN);
    const profile = { id: 'sample-loaded', is_sample: true, display_name: 'Secret Name', school_name: 'Secret School', age: 15 } as BridgeProfileRef;
    const a = decide(DEFAULT_PLAN, 's01', profile);
    const b = decide(DEFAULT_PLAN, 's01', profile);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(DEFAULT_PLAN)).toBe(before);
    const json = JSON.stringify(a);
    for (const w of ['Secret', '15', '"s01"', ':s01:']) expect(json.includes(w), `contains ${w}`).toBe(false);
  });
});

// ───────────────────────────── 判定顺序 ─────────────────────────────

describe('decideBridge：每一种状态（固定的句子与原因）', () => {
  const blockedWith = (state: string, membership: string | null, reason: string) => ({
    state,
    can_apply: false,
    membership_sentence: membership,
    reason,
    grants: [],
    opportunity_ids: [],
  });

  it('1 no_profile（排在最前：方案、编号是什么都一样）', () => {
    expect(decide(DEFAULT_PLAN, 's01', null)).toEqual(blockedWith('no_profile', null, MSG.noProfile));
    expect(decide(null, null, null)).toEqual(blockedWith('no_profile', null, MSG.noProfile));
  });

  it('2 not_sample', () => {
    expect(decide(DEFAULT_PLAN, 's01', { id: 'my-own', is_sample: false })).toEqual(blockedWith('not_sample', null, MSG.notSample));
  });

  it('3 not_in_scenario：句子与原因相同（排在「没有方案」之前）', () => {
    expect(decide(DEFAULT_PLAN, null)).toEqual(blockedWith('not_in_scenario', MSG.notInScenario, MSG.notInScenario));
    expect(decide(null, null)).toEqual(blockedWith('not_in_scenario', MSG.notInScenario, MSG.notInScenario));
  });

  it('4 no_plan：plan 为 null；别的场景的方案也按没有方案处理', () => {
    expect(decide(null, 's01')).toEqual(blockedWith('no_plan', null, MSG.noPlan));
    expect(decide(forged({ scenario_id: 'venue-tradeoff' }), 's01')).toEqual(blockedWith('no_plan', null, MSG.noPlan));
  });

  it('5 not_optimal：INFEASIBLE（最低新增 6 达不到）、输入无效、达到搜索上限', () => {
    const infeasible = planFor({ minGain: 6 });
    expect(infeasible.status).toBe('INFEASIBLE');
    expect(decide(infeasible, 's01')).toEqual(
      blockedWith('not_optimal', null, 'Only a proven-optimal plan can be written. The current result is "Not achievable".'),
    );
    const unsupported = planFor({ mode: 'tradeoff', lossCap: null });
    expect(unsupported.status).toBe('UNSUPPORTED_INPUT');
    expect(decide(unsupported, 's01')).toEqual(
      blockedWith('not_optimal', null, 'Only a proven-optimal plan can be written. The current result is "Unsupported input".'),
    );
    expect(decide(forged({ status: 'SEARCH_LIMIT_REACHED' }), 's01')).toEqual(
      blockedWith('not_optimal', null, 'Only a proven-optimal plan can be written. The current result is "Search limit reached".'),
    );
  });

  it('6 not_verified：真实方案把复核结果改成不通过', () => {
    expect(decide(forged({ verification_passed: false }), 's01')).toEqual(blockedWith('not_verified', null, MSG.notVerified));
  });

  it('7 pending_only：真实配置下 s01 只出现在条件性结果的分配里', () => {
    const plan = planFor({
      enabledIds: [LAPTOP, ONLINE, SATELLITE],
      budget: 330,
      fairnessFloorIds: [LOW_INCOME],
      minRatioOverrides: { [LOW_INCOME]: 1 },
    });
    expect(plan.status).toBe('OPTIMAL');
    expect(plan.verification_passed).toBe(true);
    const main = studentsIn(plan.allocations);
    const onlyConditional = studentsIn(plan.conditional_allocations).filter((sid) => !main.includes(sid));
    expect(onlyConditional).toEqual(['s01']);
    // 主结果只含已批准措施；条件性结果用了待审批的卫星会场
    expect(plan.allocations.every((a) => ivOf(a.intervention_id).status !== 'pending')).toBe(true);
    expect(plan.conditional_allocations!.some((a) => a.intervention_id === SATELLITE)).toBe(true);
    expect(decide(plan, 's01')).toEqual(blockedWith('pending_only', MSG.notInPlan, MSG.pendingOnly));
    // 主结果里有分配的学生照常可写，且不会写出条件性结果的任何东西
    const d = decide(plan, main[0]);
    expect(d.state).toBe('ready');
    expect(d.grants.every((g) => g.intervention_id !== SATELLITE)).toBe(true);
  });

  it('7 pending_only（防线）：伪造的主结果里出现 pending 措施，也不写它', () => {
    const interventions = ANON.interventions.map((iv) => ({ ...iv }));
    const onlyPending = forged({ interventions, allocations: [alloc(SATELLITE, 's03')], conditional_allocations: null });
    expect(decide(onlyPending, 's03')).toEqual(blockedWith('pending_only', MSG.notInPlan, MSG.pendingOnly));
    const mixed = forged({ interventions, allocations: [alloc(LAPTOP, 's03'), alloc(SATELLITE, 's03')], conditional_allocations: null });
    const d = decide(mixed, 's03');
    expect(d.state).toBe('ready');
    expect(d.grants.map((g) => g.intervention_id)).toEqual([LAPTOP]);
  });

  it('8 not_allocated：分配指向不在 plan.interventions 里的措施，不算可写', () => {
    const plan = forged({ allocations: [alloc('iv-unknown', 's03')], conditional_allocations: null });
    expect(decide(plan, 's03')).toEqual(blockedWith('not_allocated', MSG.notInPlan, MSG.notAllocated));
  });

  it('9 ready：多条分配按 (intervention_id, opportunity_id) 排序，资源字段抄自措施', () => {
    const plan = forged({
      interventions: ANON.interventions.map((iv) => ({ ...iv })),
      allocations: [alloc(SUBSIDY, 's03'), alloc(LAPTOP, 's03'), alloc(LAPTOP, 's04')],
      conditional_allocations: null,
    });
    const d = decide(plan, 's03');
    expect(d.state).toBe('ready');
    expect(d.grants.map((g) => [g.intervention_id, g.type, g.amount_usd, g.device, g.hours_per_week])).toEqual([
      [LAPTOP, 'device', null, 'laptop', null],
      [SUBSIDY, 'transport_subsidy', 25, null, null],
    ]);
    expect(d.grants.every((g) => g.student_id === 'sample-loaded' && g.status === 'approved' && g.is_sample === true)).toBe(true);
    expect(d.opportunity_ids).toEqual([OPP]);
    expect(d.grants.every((g) => isBridgeGrantOf('device-loan', g))).toBe(true);
  });

  it('页面必须显示的说明原文', () => {
    expect(BRIDGE_DEMO_NOTICE).toBe('This is a local demo action. In real life the organizer delivers support through its own process.');
  });
});

// ───────────────────────────── 服务器端：roster ─────────────────────────────

describe('buildClientBridgeInfo / rosterStudentId', () => {
  const loadable = sampleProfiles().map((p) => p.id);
  const catalogIdsOf = (sc: Scenario) => sc.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id);

  it('两个占位场景（SCENARIOS 前两项）：roster 为空、没有 Quest Details 页面；provider 是示例主办方', () => {
    expect(loadable).toEqual(['sample-maya', 'sample-leo', 'sample-ana', 'sample-noor']);
    // 第三项（共享支持场景，用真实机会与演示学生）另见 ./scenario-template.test.ts。
    for (const e of SCENARIOS.slice(0, 2)) {
      const info = buildClientBridgeInfo({
        original: e.scenario,
        anonymized: anonymizeScenarioForClient(e.scenario),
        loadableProfileIds: loadable,
        catalogOpportunityIds: catalogIdsOf(e.scenario),
        provider: e.sampleOrganizer,
      });
      expect(info).toEqual({ provider: 'Sample organizer (placeholder)', roster: {}, quest_opportunity_ids: [] });
      // 示例主办方名与占位机会的 organizer 一致
      expect(e.scenario.opportunities.every((o) => o.organizer === e.sampleOrganizer)).toBe(true);
    }
  });

  it('场景里有可载入的示例档案时：按下标对应到匿名编号；场景专用学生的 id 不出现在结果里', () => {
    const original: Scenario = {
      ...deviceLoanScenario,
      students: deviceLoanScenario.students.map((s, i) => (i === 2 ? { ...s, id: 'sample-maya' } : i === 6 ? { ...s, id: 'sample-noor' } : s)),
    };
    const anonymized = anonymizeScenarioForClient(original);
    const info = buildClientBridgeInfo({
      original,
      anonymized,
      loadableProfileIds: loadable,
      catalogOpportunityIds: [OPP],
      provider: PROVIDER,
    });
    expect(info.roster).toEqual({ 'sample-maya': 's03', 'sample-noor': 's07' });
    for (const [orig, anon] of Object.entries(info.roster)) {
      expect(loadable).toContain(orig);
      const i = original.students.findIndex((s) => s.id === orig);
      expect(anonymized.students[i].id).toBe(anon);
    }
    expect(info.quest_opportunity_ids).toEqual([OPP]);
    const json = JSON.stringify(info);
    for (const s of deviceLoanScenario.students) {
      if (s.id === original.students[2].id || s.id === original.students[6].id) continue;
      expect(json.includes(s.id), `contains ${s.id}`).toBe(false);
      expect(json.includes(s.display_name)).toBe(false);
    }
    expect(json.includes('dl-s')).toBe(false);
  });

  it('人数对不上（不是同一场景的匿名化结果）时不给对应关系；目录外的机会不算有页面', () => {
    const original: Scenario = { ...deviceLoanScenario, students: deviceLoanScenario.students.map((s, i) => (i === 0 ? { ...s, id: 'sample-maya' } : s)) };
    const anonymized = anonymizeScenarioForClient({ ...original, students: original.students.slice(1) });
    expect(
      buildClientBridgeInfo({ original, anonymized, loadableProfileIds: loadable, catalogOpportunityIds: ['not-in-scenario'], provider: PROVIDER }),
    ).toEqual({ provider: PROVIDER, roster: {}, quest_opportunity_ids: [] });
  });

  it('rosterStudentId 只认自有属性（constructor / __proto__ / toString 不会碰到原型）', () => {
    const original: Scenario = {
      ...deviceLoanScenario,
      students: deviceLoanScenario.students.map((s, i) => (i === 0 ? { ...s, id: '__proto__' } : i === 1 ? { ...s, id: 'constructor' } : s)),
    };
    const info = buildClientBridgeInfo({
      original,
      anonymized: anonymizeScenarioForClient(original),
      loadableProfileIds: ['__proto__', 'constructor'],
      catalogOpportunityIds: [],
      provider: PROVIDER,
    });
    expect(Object.getPrototypeOf(info.roster)).toBe(Object.prototype);
    expect(rosterStudentId(info.roster, '__proto__')).toBe('s01');
    expect(rosterStudentId(info.roster, 'constructor')).toBe('s02');
    const empty: Record<string, string> = {};
    for (const key of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'sample-maya']) expect(rosterStudentId(empty, key)).toBeNull();
    expect(rosterStudentId({ 'sample-maya': 's03' }, 'sample-maya')).toBe('s03');
  });
});

describe('buildClientBridgeInfo：场景里已有 grant 的学生不进 roster', () => {
  it('venue-tradeoff：有 existing_grants 的可载入学生被排除，没有的照常对应', () => {
    const vt = SCENARIOS[1].scenario;
    const withGrant = vt.existing_grants![0].student_id;
    const iWith = vt.students.findIndex((s) => s.id === withGrant);
    const held = new Set(vt.existing_grants!.map((g) => g.student_id));
    const iWithout = vt.students.findIndex((s) => !held.has(s.id));
    expect(iWith).toBeGreaterThanOrEqual(0);
    expect(iWithout).toBeGreaterThanOrEqual(0);
    const original: Scenario = {
      ...vt,
      students: vt.students.map((s, i) => (i === iWith ? { ...s, id: 'sample-maya' } : i === iWithout ? { ...s, id: 'sample-leo' } : s)),
      existing_grants: vt.existing_grants!.map((g) => (g.student_id === withGrant ? { ...g, student_id: 'sample-maya' } : g)),
    };
    const anonymized = anonymizeScenarioForClient(original);
    const info = buildClientBridgeInfo({
      original,
      anonymized,
      loadableProfileIds: ['sample-maya', 'sample-leo'],
      catalogOpportunityIds: [],
      provider: PROVIDER,
    });
    expect(info.roster).toEqual({ 'sample-leo': anonymized.students[iWithout].id });
  });
});

// ───────────────────────────── 已写入的汇总 ─────────────────────────────

describe('summarizeApplied', () => {
  const READY = decide(DEFAULT_PLAN, 's01');
  const WRITTEN = READY.grants;
  const QUEST = [OPP];
  const sum = (over: Partial<Parameters<typeof summarizeApplied>[0]> = {}) =>
    summarizeApplied({ applied: WRITTEN, profile: SAMPLE, decision: READY, questOpportunityIds: QUEST, ...over });
  const otherGrant = (studentId: string): ResourceGrant => ({
    ...WRITTEN[0],
    id: bridgeGrantId(ANON.id, LAPTOP, studentId, OPP),
    student_id: studentId,
  });

  it('前提：ready 的决定正好一条设备借用', () => {
    expect(READY.state).toBe('ready');
    expect(WRITTEN.map((g) => g.intervention_id)).toEqual([LAPTOP]);
  });

  it('方案没变：plan_changed 为 false；机会在目录里就给 Quest Details', () => {
    expect(sum()).toEqual({ total: 1, others: 0, plan_changed: false, quest_opportunity_ids: [OPP], has_placeholder: false });
  });

  it('占位机会（不在目录里）：没有 Quest Details，只标 has_placeholder', () => {
    expect(sum({ questOpportunityIds: [] })).toEqual({ total: 1, others: 0, plan_changed: false, quest_opportunity_ids: [], has_placeholder: true });
  });

  it('方案变了：现在的方案不再分给这个学生 / 不是 OPTIMAL / 复核没过 / 只剩待审批措施，都算变了', () => {
    const notAllocated = decide(DEFAULT_PLAN, 's03');
    expect(notAllocated.state).toBe('not_allocated');
    expect(sum({ decision: notAllocated }).plan_changed).toBe(true);
    const notOptimal = decide(planFor({ minGain: 6 }), 's01');
    expect(notOptimal.state).toBe('not_optimal');
    expect(sum({ decision: notOptimal }).plan_changed).toBe(true);
    const notVerified = decide(forged({ verification_passed: false }), 's01');
    expect(notVerified.state).toBe('not_verified');
    expect(sum({ decision: notVerified }).plan_changed).toBe(true);
    const pendingOnly = decide(forged({ allocations: [alloc(SATELLITE, 's01')] }), 's01');
    expect(pendingOnly.state).toBe('pending_only');
    expect(sum({ decision: pendingOnly }).plan_changed).toBe(true);
  });

  it('方案变了：仍然可写，但要写的条目与已写入的不同', () => {
    const two = decide(forged({ allocations: [alloc(LAPTOP, 's01'), alloc(SUBSIDY, 's01')] }), 's01');
    expect(two.state).toBe('ready');
    expect(two.grants).toHaveLength(2);
    expect(sum({ decision: two }).plan_changed).toBe(true);
  });

  it('换了档案（当前档案没有已写入的条目）不算方案变了；别人的条目计入 others，不给它们链接', () => {
    const leo: BridgeProfileRef = { id: 'sample-other', is_sample: true };
    for (const decision of [decide(DEFAULT_PLAN, 's02', leo), decide(DEFAULT_PLAN, 's03', leo), decide(DEFAULT_PLAN, null, leo)]) {
      expect(sum({ profile: leo, decision })).toEqual({ total: 1, others: 1, plan_changed: false, quest_opportunity_ids: [], has_placeholder: false });
    }
    expect(sum({ profile: null, decision: decide(DEFAULT_PLAN, null, null) })).toEqual({
      total: 1,
      others: 1,
      plan_changed: false,
      quest_opportunity_ids: [],
      has_placeholder: false,
    });
  });

  it('没有计算（no_plan）不谈方案变没变；自己的与别人的条目分开数', () => {
    const noPlan = decide(null, 's01');
    expect(noPlan.state).toBe('no_plan');
    const applied = [...WRITTEN, otherGrant('sample-other')];
    expect(sum({ applied, decision: noPlan })).toEqual({ total: 2, others: 1, plan_changed: false, quest_opportunity_ids: [OPP], has_placeholder: false });
  });

  it('不修改输入', () => {
    const applied = [otherGrant('sample-other'), ...WRITTEN];
    const before = JSON.stringify({ applied, READY, QUEST });
    sum({ applied });
    expect(JSON.stringify({ applied, READY, QUEST })).toBe(before);
  });
});

describe('opportunitiesNeedingLocalCopy：学生端目录里没有的机会要存本地示例副本', () => {
  const a = { id: 'a', title: 'A' };
  const b = { id: 'b', title: 'B' };
  const c = { id: 'c', title: 'C' };

  it('只挑这次要写入支持、且不在目录里的机会；返回场景里的原对象，按场景顺序', () => {
    const out = opportunitiesNeedingLocalCopy({
      scenarioOpportunities: [a, b, c],
      grantOpportunityIds: ['c', 'a', 'b'],
      catalogOpportunityIds: ['b'],
    });
    expect(out).toEqual([a, c]);
    expect(out[0]).toBe(a);
  });

  it('目录里已有的机会永远不存副本；没有要写的机会、或 id 不在场景里 → 空', () => {
    expect(opportunitiesNeedingLocalCopy({ scenarioOpportunities: [a], grantOpportunityIds: ['a'], catalogOpportunityIds: ['a'] })).toEqual([]);
    expect(opportunitiesNeedingLocalCopy({ scenarioOpportunities: [a, b], grantOpportunityIds: [], catalogOpportunityIds: [] })).toEqual([]);
    expect(opportunitiesNeedingLocalCopy({ scenarioOpportunities: [a], grantOpportunityIds: ['zzz'], catalogOpportunityIds: [] })).toEqual([]);
  });

  it('场景里重复的 id 只取第一条；不修改输入', () => {
    const dup = { id: 'a', title: 'A again' };
    const input = { scenarioOpportunities: [a, dup], grantOpportunityIds: ['a'], catalogOpportunityIds: [] as string[] };
    const before = JSON.stringify(input);
    expect(opportunitiesNeedingLocalCopy(input)).toEqual([a]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('device-loan 的真实方案：占位机会不在目录里，需要副本', () => {
    const d = decide(DEFAULT_PLAN, 's01');
    expect(
      opportunitiesNeedingLocalCopy({
        scenarioOpportunities: ANON.opportunities,
        grantOpportunityIds: d.opportunity_ids,
        catalogOpportunityIds: [],
      }).map((o) => o.id),
    ).toEqual([OPP]);
  });
});

// ───────────────────────────── 静态守卫 ─────────────────────────────

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SPEC_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
const specifiersOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(SPEC_RE)].map((m) => m[1]);
const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** 把 import 说明符解析成仓库里的文件（包名返回 null）。 */
function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const p of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')]) if (isFile(p)) return p;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const FORBIDDEN = (p: string) => p === 'lib/joint/scenarios.ts' || p === 'lib/data.ts' || (p.startsWith('data/') && p.endsWith('.json'));
const CLIENT_FILES = ['app/organizer/student-bridge.tsx', 'app/organizer/bridge-store.ts', 'app/organizer/what-if.tsx', 'lib/joint/bridge.ts'];

describe('静态守卫：客户端文件不 import 场景数据 / lib/data；verify 不 import bridge', () => {
  for (const file of CLIENT_FILES) {
    it(`${file} 不直接 import lib/joint/scenarios、lib/data 或 data/*.json`, () => {
      const abs = resolve(ROOT, file);
      const specs = specifiersOf(abs);
      expect(specs.length).toBeGreaterThan(0);
      for (const spec of specs) {
        expect(spec).not.toMatch(/(^|\/)scenarios(\.ts)?$/);
        expect(spec).not.toMatch(/^(@\/lib\/data|\.\.?\/(\.\.\/)*(lib\/)?data)(\.ts)?$/);
        expect(spec).not.toMatch(/\.json$/);
        const target = resolveSpecifier(abs, spec);
        if (target) expect(FORBIDDEN(rel(target)), `${file} imports ${rel(target)}`).toBe(false);
      }
    });
  }

  it('从客户端入口出发的整个 import 图里都没有 lib/joint/scenarios、lib/data 或 data/*.json', () => {
    const seen = new Set<string>();
    const stack = CLIENT_FILES.map((f) => resolve(ROOT, f));
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      if (file.endsWith('.json')) continue;
      for (const spec of specifiersOf(file)) {
        const target = resolveSpecifier(file, spec);
        if (target && !seen.has(target)) stack.push(target);
      }
    }
    const files = [...seen].map(rel);
    // 图确实走到了这些文件（守卫本身有效）
    for (const f of ['lib/store.ts', 'lib/joint/whatif.ts', 'lib/joint/solve.ts', 'lib/joint/verify.ts', 'app/organizer/bridge-store.ts']) {
      expect(files).toContain(f);
    }
    expect(files.filter(FORBIDDEN)).toEqual([]);
  });

  it('lib/joint/verify.ts 不 import ./bridge', () => {
    const specs = specifiersOf(resolve(ROOT, 'lib/joint/verify.ts'));
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) expect(spec).not.toMatch(/bridge/);
  });
});
