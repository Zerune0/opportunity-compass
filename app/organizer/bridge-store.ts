/**
 * 「回到学生端的桥」在浏览器里的读写（主办方 What-if 页面专用）。本目录里只有这个文件碰 lib/store。
 *
 * - 只通过 lib/store 的函数读写（不直接碰 localStorage）：写入用 addGrants，找回用 grantsByIntervention，撤回用 removeGrants。
 * - 「这次写入了哪些」一律从存储里推出来（不靠 React state），所以刷新页面后照样能撤回；
 *   只认 lib/joint/bridge 的 isBridgeGrantOf 严格判定为本场景的桥写入的 grant，别的 grant 一律不动。
 * - 读档案只取 id 与 is_sample（BridgeProfileRef），不把姓名、学校等交给页面。
 * - 学生端机会目录里没有的机会（占位 / 示例机会）：写入支持前先用 addUserPostedOpportunity 存一份本地示例，
 *   学生端才打得开它的 Quest Details；存储层会强制标 user_posted + is_sample。撤回支持时这份副本保留
 *   （撤回后学生端仍能打开它，看到障碍重新出现）。
 * - lib/store 的函数不抛异常（SSR、存储被禁用、写入失败时返回存储里实际的列表），这里据此判断是否成功。
 * 只能在浏览器里（effect / 事件处理函数中）调用；SSR 下读到的是空。
 */
import {
  addGrants,
  addUserPostedOpportunity,
  grantsByIntervention,
  loadProfile,
  loadUserPostedOpportunities,
  removeGrants,
} from "@/lib/store";
import { findBridgeGrants } from "@/lib/joint/bridge";
import type { BridgeProfileRef } from "@/lib/joint/bridge";
import type { Opportunity, ResourceGrant, Scenario } from "@/lib/types";

/** 本浏览器里载入的档案的 id 与 is_sample；没有档案时为 null。 */
export function readLoadedProfileRef(): BridgeProfileRef | null {
  const profile = loadProfile();
  if (!profile) return null;
  return { id: profile.id, is_sample: profile.is_sample === true };
}

/**
 * 存储里本场景的桥写入的 grants：对**完整场景**的每项措施取 grantsByIntervention，按 id 去重，
 * 再用 findBridgeGrants 严格筛选。与当前的勾选、预算、方案无关。
 */
export function readAppliedBridgeGrants(scenario: Pick<Scenario, "id" | "interventions">): ResourceGrant[] {
  const byId = new Map<string, ResourceGrant>();
  for (const iv of scenario.interventions) {
    for (const g of grantsByIntervention(iv.id)) if (!byId.has(g.id)) byId.set(g.id, g);
  }
  return findBridgeGrants([...byId.values()], scenario.id);
}

/** 写入后存储里的这条是否就是我们要写的（addGrants 会强制 is_sample: true）。 */
function sameGrant(stored: ResourceGrant, wanted: ResourceGrant): boolean {
  return (
    stored.student_id === wanted.student_id &&
    stored.opportunity_id === wanted.opportunity_id &&
    stored.intervention_id === wanted.intervention_id &&
    stored.type === wanted.type &&
    stored.status === wanted.status &&
    (stored.amount_usd ?? null) === (wanted.amount_usd ?? null) &&
    (stored.device ?? null) === (wanted.device ?? null) &&
    (stored.hours_per_week ?? null) === (wanted.hours_per_week ?? null) &&
    stored.provider === wanted.provider &&
    stored.is_sample === true
  );
}

/**
 * 写入（addGrants）。ok 只有在每条都按 id 出现在返回的列表里、且内容一致时才为 true。
 * 没有可写的条目时不写，ok 为 false。
 */
export function applyBridgeGrants(grants: ResourceGrant[]): { ok: boolean } {
  if (!Array.isArray(grants) || grants.length === 0) return { ok: false };
  const stored = new Map(addGrants(grants).map((g) => [g.id, g]));
  return {
    ok: grants.every((g) => {
      const s = stored.get(g.id);
      return s !== undefined && sameGrant(s, g);
    }),
  };
}

/**
 * 撤回本场景的桥写入的全部 grants（不论属于哪个档案），按 id 交给 removeGrants；别的 grant 不动。
 * 没有要撤回的：ok 为 true、removed 为 0（什么都没写）。ok 只有在这些 id 都已不在存储里时才为 true；
 * removed = 实际删掉的条数（写入失败时为 0）。
 */
export function undoBridgeGrants(scenario: Pick<Scenario, "id" | "interventions">): { ok: boolean; removed: number } {
  const ids = readAppliedBridgeGrants(scenario).map((g) => g.id);
  if (ids.length === 0) return { ok: true, removed: 0 };
  const left = new Set(removeGrants(ids).map((g) => g.id));
  const removed = ids.filter((id) => !left.has(id)).length;
  return { ok: removed === ids.length, removed };
}

/** ids 里已经作为本地示例存在本浏览器里的机会 id（按 ids 的顺序）。 */
export function readLocalOpportunityIds(ids: readonly string[]): string[] {
  const stored = new Set(loadUserPostedOpportunities().map((o) => o.id));
  return ids.filter((id) => stored.has(id));
}

/**
 * 把学生端机会目录里没有的机会存成本地示例（同 id 替换，内容以场景里的为准）。
 * ok 只有在每条都能从存储里读回、且标成了 user_posted + is_sample 时才为 true；空列表 → ok（无事可做）。
 */
export function storeLocalOpportunities(opportunities: readonly Opportunity[]): { ok: boolean } {
  if (opportunities.length === 0) return { ok: true };
  for (const o of opportunities) addUserPostedOpportunity(o);
  const stored = new Map(loadUserPostedOpportunities().map((o) => [o.id, o]));
  return {
    ok: opportunities.every((o) => {
      const s = stored.get(o.id);
      return s !== undefined && s.is_sample === true && s.source_tier === "user_posted" && s.title === o.title;
    }),
  };
}
