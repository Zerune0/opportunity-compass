/**
 * 「回到学生端的桥」——主办方 What-if 页面上明确标注的**本地演示操作**（纯函数，无 IO）。
 *
 * 作用：把当前方案（已证明最优、且通过独立复核）里**已批准措施**给「本浏览器里载入的示例档案」的分配，
 * 写成模拟的 approved grant（由页面经 lib/store 的 addGrants 写入），学生端的 Quest Details 就能看到效果；
 * 撤回时只删除本场景的桥写入的那几条（removeGrants，按 id），别的 grant 一律不动。
 *
 * - `bridgeGrantId` / `isBridgeGrantOf` / `findBridgeGrants`：桥写入的 grant 用可区分的 id
 *   `organizer-bridge:<场景 id>:<措施 id>:<档案 id>:<机会 id>`；判定「是不是本场景的桥写入的」时，
 *   要求 id **恰好等于**用该 grant 自己的字段重建出来的 id（不做前缀匹配），所以刷新页面后仍能从存储里找回、
 *   且不会误删别人写的 grant。
 * - `decideBridge`：按固定顺序判定能不能写、写什么，以及页面上关于这位学生**唯一**可以说的一句话
 *   （在 / 不在本方案的分配里 / 不在本场景里）。只读档案的 `id` 与 `is_sample`，不读姓名、学校、年龄。
 *   永不写入：pending 措施的分配、条件性结果（`conditional_allocations`）、没有通过复核或不是 OPTIMAL 的方案。
 * - `buildClientBridgeInfo`：服务器端用。原始场景与匿名化后的场景按下标一一对应，只为「可载入的示例档案」
 *   （data/profiles.json 里的示例档案，id 本来就在 Skill Passport 公开）给出 原始 id → 匿名编号；
 *   场景专用的示例学生不出现在结果里。`rosterStudentId`：浏览器端按档案 id 查匿名编号（只认自有属性）。
 *
 * 不 import ./scenarios、lib/data、lib/store 或任何 JSON（客户端组件会 import 本文件）。
 * 所有支持都是模拟；可达 ≠ 录取。字符串比较按 UTF-16 码元（`<`），不用 localeCompare。
 */
import { STATUS_LABELS } from './whatif';
import type { WhatIfPlanDetail } from './whatif';
import type { Allocation, Intervention, ResourceGrant, Scenario } from '../types';

// ───────────────────────────── grant id ─────────────────────────────

export const BRIDGE_GRANT_ID_PREFIX = 'organizer-bridge';

/** 桥写入的每条 grant 的 note。 */
export const BRIDGE_GRANT_NOTE = 'Written by the Organizer What-if local demo. Simulated support, not a real award.';

/** `organizer-bridge:<scenarioId>:<interventionId>:<profileId>:<opportunityId>` */
export function bridgeGrantId(scenarioId: string, interventionId: string, profileId: string, opportunityId: string): string {
  // 每一段先 encodeURIComponent（把段内的 `:` 转义掉），不同的 (场景, 措施, 档案, 机会) 就不会拼出同一个 id；
  // 现有 id 不含需要转义的字符，写法不变。
  return [BRIDGE_GRANT_ID_PREFIX, scenarioId, interventionId, profileId, opportunityId].map(encodeURIComponent).join(':');
}

/**
 * 严格判定：g 的 id 必须恰好等于用它自己的字段重建出来的 id（不做前缀匹配），且 intervention_id / opportunity_id 是字符串。
 * 字段固定时，重建出来的 id 只随场景 id 变化，所以别的场景（哪怕场景 id 是本场景 id 的前缀）写入的 grant 不会被认作本场景的。
 */
export function isBridgeGrantOf(scenarioId: string, g: ResourceGrant): boolean {
  if (typeof g !== 'object' || g === null) return false;
  const { id, student_id, intervention_id, opportunity_id } = g as Partial<ResourceGrant>;
  if (typeof id !== 'string' || typeof student_id !== 'string') return false;
  if (typeof intervention_id !== 'string' || typeof opportunity_id !== 'string') return false;
  return id === bridgeGrantId(scenarioId, intervention_id, student_id, opportunity_id);
}

/** 从一批已存的 grants 里挑出本场景的桥写入的那些（保持原顺序）。 */
export function findBridgeGrants(stored: readonly ResourceGrant[], scenarioId: string): ResourceGrant[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter((g) => isBridgeGrantOf(scenarioId, g));
}

// ───────────────────────────── 判定 ─────────────────────────────

/** 桥只读档案的这两个字段。 */
export interface BridgeProfileRef {
  id: string;
  is_sample: boolean;
}

export type BridgeState =
  | 'no_profile'
  | 'not_sample'
  | 'not_in_scenario'
  | 'no_plan'
  | 'not_optimal'
  | 'not_verified'
  | 'pending_only'
  | 'not_allocated'
  | 'ready';

export interface BridgeDecision {
  state: BridgeState;
  /** 只有 'ready' 为 true。 */
  can_apply: boolean;
  /** 页面上关于这位学生唯一可以说的一句话（BRIDGE_MEMBERSHIP 之一），或 null。 */
  membership_sentence: string | null;
  /** 按钮不可用的原因（'ready' 时为 null）。 */
  reason: string | null;
  /** 将要写入的 grants（只有 'ready' 时非空），按 (intervention_id, opportunity_id) 升序。 */
  grants: ResourceGrant[];
  /** grants 里不同的 opportunity_id，升序。 */
  opportunity_ids: string[];
}

/** 页面必须显示的说明（原文不得改动）。 */
export const BRIDGE_DEMO_NOTICE = 'This is a local demo action. In real life the organizer delivers support through its own process.';

/** 关于载入的示例档案，页面只能说下面三句中的一句。 */
export const BRIDGE_MEMBERSHIP = {
  in_plan: "The loaded sample profile is in this plan's allocation.",
  not_in_plan: "The loaded sample profile is not in this plan's allocation.",
  not_in_scenario: 'The loaded sample profile is not part of this scenario.',
} as const;

/** 按钮不可用的原因（not_optimal 的原因带状态名，见 decideBridge）。 */
export const BRIDGE_REASONS = {
  no_profile: 'No student profile is loaded in this browser. Load a sample profile in Skill Passport first.',
  not_sample:
    'This demo action only works with sample profiles. The profile loaded in this browser is not a sample profile, so nothing is written.',
  not_in_scenario: BRIDGE_MEMBERSHIP.not_in_scenario,
  no_plan: 'Nothing was computed with the current settings, so there is no plan to write.',
  not_verified: 'This plan did not pass independent verification, so nothing is written.',
  // 这两种状态用同一句原因：页面关于学生只说 membership 那一句，原因不再透露「待审批措施获批后会不会分到」。
  pending_only: 'There is nothing to write. Support from measures still pending approval is never written.',
  not_allocated: 'There is nothing to write. Support from measures still pending approval is never written.',
} as const;

/** not_optimal 的原因：`Only a proven-optimal plan can be written. The current result is "<状态名>".` */
export function notOptimalReason(status: WhatIfPlanDetail['status']): string {
  return `Only a proven-optimal plan can be written. The current result is "${STATUS_LABELS[status] ?? status}".`;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function blocked(state: BridgeState, membership: string | null, reason: string): BridgeDecision {
  return { state, can_apply: false, membership_sentence: membership, reason, grants: [], opportunity_ids: [] };
}

function bridgeGrant(
  scenarioId: string,
  profileId: string,
  provider: string,
  iv: Intervention,
  a: Allocation,
): ResourceGrant {
  return {
    id: bridgeGrantId(scenarioId, a.intervention_id, profileId, a.opportunity_id),
    student_id: profileId,
    opportunity_id: a.opportunity_id,
    intervention_id: a.intervention_id,
    // 资源字段与 CONTRACT「联合求解模型」第 2 条的合成 grant 一致。
    type: iv.type,
    amount_usd: iv.amount_usd ?? null,
    device: iv.device ?? null,
    hours_per_week: iv.hours_per_week ?? null,
    status: 'approved',
    provider,
    note: BRIDGE_GRANT_NOTE,
    is_sample: true,
  };
}

/**
 * 判定能不能写、写什么。检查顺序固定（第一条命中即返回）：
 * 1 没有档案 → 2 不是示例档案 → 3 不在本场景 → 4 没有方案 → 5 不是 OPTIMAL → 6 没有通过独立复核
 * → 7 只有待审批措施的支持 → 8 没有可写的分配 → 9 ready。
 * 「可写的分配」= plan.allocations 中 student_id 等于该档案在本场景的匿名编号、措施在 plan.interventions 里且不是 pending 的条目
 * （主结果本来就不含 pending 措施，这里再挡一次）。每条可写的分配写一条 grant。
 * `plan.scenario_id` 与 `scenarioId` 不同时按「没有方案」处理（别的场景的方案永远不写进本场景）。
 * 纯函数：不修改输入；只读档案的 id 与 is_sample。
 */
export function decideBridge(args: {
  scenarioId: string;
  /** null = 输入无效，没有计算。 */
  plan: WhatIfPlanDetail | null;
  /** null = 本浏览器里没有档案。 */
  profile: BridgeProfileRef | null;
  /** 载入的档案在本场景里的匿名编号；null = 不是本场景的学生。 */
  scenarioStudentId: string | null;
  provider: string;
}): BridgeDecision {
  const { scenarioId, plan, profile, scenarioStudentId, provider } = args;
  if (profile == null) return blocked('no_profile', null, BRIDGE_REASONS.no_profile);
  if (profile.is_sample !== true) return blocked('not_sample', null, BRIDGE_REASONS.not_sample);
  if (typeof scenarioStudentId !== 'string') {
    return blocked('not_in_scenario', BRIDGE_MEMBERSHIP.not_in_scenario, BRIDGE_REASONS.not_in_scenario);
  }
  if (plan == null || plan.scenario_id !== scenarioId) return blocked('no_plan', null, BRIDGE_REASONS.no_plan);
  if (plan.status !== 'OPTIMAL') return blocked('not_optimal', null, notOptimalReason(plan.status));
  if (plan.verification_passed !== true) return blocked('not_verified', null, BRIDGE_REASONS.not_verified);

  const ivById = new Map<string, Intervention>();
  for (const iv of plan.interventions) if (!ivById.has(iv.id)) ivById.set(iv.id, iv);
  const mine = plan.allocations.filter((a) => a.student_id === scenarioStudentId);
  const writable = mine.filter((a) => {
    const iv = ivById.get(a.intervention_id);
    return iv !== undefined && iv.status !== 'pending';
  });

  if (writable.length === 0) {
    const pendingInMain = mine.some((a) => ivById.get(a.intervention_id)?.status === 'pending');
    const inConditional = (plan.conditional_allocations ?? []).some((a) => a.student_id === scenarioStudentId);
    if (pendingInMain || inConditional) {
      return blocked('pending_only', BRIDGE_MEMBERSHIP.not_in_plan, BRIDGE_REASONS.pending_only);
    }
    return blocked('not_allocated', BRIDGE_MEMBERSHIP.not_in_plan, BRIDGE_REASONS.not_allocated);
  }

  const sorted = [...writable].sort(
    (x, y) => cmpStr(x.intervention_id, y.intervention_id) || cmpStr(x.opportunity_id, y.opportunity_id),
  );
  // 同一 (措施, 机会) 只写一条（合法方案里本来就不重复）。
  const grants: ResourceGrant[] = [];
  const ids = new Set<string>();
  for (const a of sorted) {
    const g = bridgeGrant(scenarioId, profile.id, provider, ivById.get(a.intervention_id)!, a);
    if (ids.has(g.id)) continue;
    ids.add(g.id);
    grants.push(g);
  }
  const opportunity_ids = [...new Set(sorted.map((a) => a.opportunity_id))].sort(cmpStr);
  return {
    state: 'ready',
    can_apply: true,
    membership_sentence: BRIDGE_MEMBERSHIP.in_plan,
    reason: null,
    grants,
    opportunity_ids,
  };
}

// ───────────────────────────── 服务器端：交给浏览器的桥信息 ─────────────────────────────

export interface ClientBridgeInfo {
  provider: string;
  /** 可载入的示例档案 id → 匿名学生编号。场景专用的示例学生不出现在这里。 */
  roster: Record<string, string>;
  /** 有 Quest Details 页面的机会 id（在已核实目录里）。 */
  quest_opportunity_ids: string[];
}

/**
 * 载入的档案在本场景里的匿名编号（查 ClientBridgeInfo.roster）；不是本场景的学生时为 null。
 * 只认自有属性：档案 id 是 `constructor`、`__proto__`、`toString` 之类时不会查到原型上的东西。
 */
export function rosterStudentId(roster: Readonly<Record<string, string>>, profileId: string): string | null {
  if (roster == null || typeof profileId !== 'string') return null;
  if (!Object.prototype.hasOwnProperty.call(roster, profileId)) return null;
  const v = roster[profileId];
  return typeof v === 'string' ? v : null;
}

/**
 * 服务器端用：原始场景与匿名化后的场景按下标一一对应，只为「可载入的示例档案」给出 原始 id → 匿名编号。
 * 两边学生人数不同（不是同一场景的匿名化结果）时不给任何对应关系（roster 为空），不猜。
 * 在场景的 existing_grants 里已有 grant 的学生不进 roster（那些 grant 不在浏览器存储里，学生端的结论会对不上）。
 * roster 用 Object.fromEntries 建（`__proto__` 之类的 id 也只是普通的自有属性）；查找时请用 hasOwnProperty。
 * quest_opportunity_ids = 场景里在 catalogOpportunityIds 中的机会（按场景顺序、去重）。纯函数。
 */
export function buildClientBridgeInfo(args: {
  original: Scenario;
  anonymized: Scenario;
  loadableProfileIds: readonly string[];
  /** 场景里在已核实目录中的机会 id。 */
  catalogOpportunityIds: readonly string[];
  provider: string;
}): ClientBridgeInfo {
  const { original, anonymized, provider } = args;
  const loadable = new Set(args.loadableProfileIds.filter((x) => typeof x === 'string' && x !== ''));
  const entries: [string, string][] = [];
  const seen = new Set<string>();
  const withExisting = new Set((original.existing_grants ?? []).map((g) => g?.student_id));
  if (original.students.length === anonymized.students.length) {
    original.students.forEach((s, i) => {
      const anonId = anonymized.students[i]?.id;
      if (typeof s?.id !== 'string' || typeof anonId !== 'string') return;
      if (!loadable.has(s.id) || seen.has(s.id)) return;
      // 场景里已有 grant 的学生不进 roster：existing_grants 不在浏览器存储里，学生端看不到它们，
      // 只写新分配会让 Quest Details 的结论与本页不一致。
      if (withExisting.has(s.id)) return;
      seen.add(s.id);
      entries.push([s.id, anonId]);
    });
  }
  const catalog = new Set(args.catalogOpportunityIds);
  const quest_opportunity_ids: string[] = [];
  for (const o of original.opportunities) {
    if (catalog.has(o.id) && !quest_opportunity_ids.includes(o.id)) quest_opportunity_ids.push(o.id);
  }
  return { provider, roster: Object.fromEntries(entries), quest_opportunity_ids };
}

// ───────────────────────────── 已写入的汇总（页面渲染用）─────────────────────────────

export interface BridgeAppliedSummary {
  /** 存储里本场景的桥写入的条数（所有档案）。 */
  total: number;
  /** 其中不属于当前载入档案的条数。 */
  others: number;
  /** 当前载入档案的那几条与现在显示的方案对不上（方案变了，或现在的方案不能写）。 */
  plan_changed: boolean;
  /** 当前载入档案被写入支持的机会里，有 Quest Details 页面的（升序）。 */
  quest_opportunity_ids: string[];
  /** 当前载入档案被写入支持的机会里，有没有不在目录里的（占位机会）。 */
  has_placeholder: boolean;
}

/** 这些状态下「方案」是算出来了的；其余状态（没有档案、不是示例、不在场景、没有计算）不谈方案变没变。 */
const PLAN_STATES: readonly BridgeState[] = ['ready', 'not_allocated', 'pending_only', 'not_optimal', 'not_verified'];

/**
 * 已写入的 grants 相对当前档案、当前方案的汇总。纯函数。
 * plan_changed：当前档案有已写入的条目，且（现在的方案不能写，或能写但要写的 id 集合与已写入的不同）。
 * 换了档案（当前档案没有已写入的条目）不算方案变了。
 */
export function summarizeApplied(args: {
  applied: readonly ResourceGrant[];
  profile: BridgeProfileRef | null;
  decision: BridgeDecision;
  questOpportunityIds: readonly string[];
}): BridgeAppliedSummary {
  const { applied, profile, decision } = args;
  const mine = profile ? applied.filter((g) => g.student_id === profile.id) : [];
  const mineIds = mine.map((g) => g.id).sort(cmpStr);
  const wantIds = decision.grants.map((g) => g.id).sort(cmpStr);
  const same = mineIds.length === wantIds.length && mineIds.every((id, i) => id === wantIds[i]);
  const oppIds = [...new Set(mine.map((g) => g.opportunity_id).filter((x): x is string => typeof x === 'string'))].sort(cmpStr);
  const quest = new Set(args.questOpportunityIds);
  return {
    total: applied.length,
    others: applied.length - mine.length,
    plan_changed: mine.length > 0 && PLAN_STATES.includes(decision.state) && (decision.state !== 'ready' || !same),
    quest_opportunity_ids: oppIds.filter((id) => quest.has(id)),
    has_placeholder: oppIds.some((id) => !quest.has(id)),
  };
}

// ───────────────────────────── 学生端打不开的机会：本地示例副本 ─────────────────────────────

/**
 * 方案要写入支持的机会里，学生端机会目录里没有的那些（占位 / 示例机会）：桥写入 grants 的同时，
 * 要把它们存成本地示例（lib/store 的 addUserPostedOpportunity，存储层会强制标 user_posted + is_sample），
 * 学生端的 Quest Board 与 Quest Details 才打得开。目录里已有的机会不需要副本，也不得被本地副本顶替。
 * 返回场景里的原对象（不复制、不改动），按场景顺序、按 id 去重。纯函数。
 */
export function opportunitiesNeedingLocalCopy<T extends { id: string }>(args: {
  /** 场景里的机会（页面拿到的那一份）。 */
  scenarioOpportunities: readonly T[];
  /** 这次要写入支持的机会 id（BridgeDecision.opportunity_ids）。 */
  grantOpportunityIds: readonly string[];
  /** 学生端机会目录里已有的机会 id（ClientBridgeInfo.quest_opportunity_ids）。 */
  catalogOpportunityIds: readonly string[];
}): T[] {
  const wanted = new Set(args.grantOpportunityIds);
  const inCatalog = new Set(args.catalogOpportunityIds);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const o of args.scenarioOpportunities) {
    if (typeof o?.id !== 'string' || !wanted.has(o.id) || inCatalog.has(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out;
}
