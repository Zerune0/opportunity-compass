/**
 * 证据覆盖判断（纯函数），供 analyzeReachability 与第 2 层路线规划共用。
 *
 * 一条证据覆盖某准备项，当：
 * - 它的 prep_item_ids 含 `${opp.id}:${prep.id}` 或裸 `prep.id`；或
 * - prep.skill 非空且证据 skills 含该技能，且（prep.evidence_kind 为空，或与证据 kind 相同）。
 */
import type { EvidenceItem, Opportunity, PrepItem, StudentProfile } from '../types';

export function evidenceCoversPrep(evidence: EvidenceItem, opp: Opportunity, prep: PrepItem): boolean {
  const ids = evidence.prep_item_ids ?? [];
  if (ids.includes(`${opp.id}:${prep.id}`) || ids.includes(prep.id)) return true;
  if (prep.skill == null || prep.skill === '') return false;
  const skill = prep.skill.trim().toLowerCase();
  const hasSkill = evidence.skills.some((s) => s.trim().toLowerCase() === skill);
  if (!hasSkill) return false;
  return prep.evidence_kind == null || prep.evidence_kind === evidence.kind;
}

/** 返回档案中覆盖该准备项的全部证据（保持档案中的顺序）。 */
export function findCoveringEvidence(profile: StudentProfile, opp: Opportunity, prep: PrepItem): EvidenceItem[] {
  return profile.evidence.filter((e) => evidenceCoversPrep(e, opp, prep));
}

/** 有限非负数，否则 0（负数 / NaN / Infinity / 非数字都按 0）。 */
export function nonNegOrZero(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 截止前「必须完成」的准备项：未被证据覆盖且 required_for_application 的项，
 * 加上它们未被覆盖的前置依赖（传递闭包）。遇到已被证据覆盖的节点不计入、也不再沿它往前追。
 * analyzeReachability（H、必需准备费）与 planRoutes（「只做申请必需项」）共用，保证两边数字一致。
 *
 * 坏数据健壮：重复 id 只取第一项；依赖不存在的 id、自依赖被忽略；成环不会死循环。
 * excludeIds：调用方要忽略的准备项 id（例如路线规划里与固定步骤冲突的 id）。
 * 返回顺序与 opp.preparation 原顺序一致。
 */
export function requiredPrepClosure(
  profile: StudentProfile,
  opp: Opportunity,
  options?: { excludeIds?: readonly string[] },
): PrepItem[] {
  const exclude = options?.excludeIds ?? [];
  const preps = Array.isArray(opp.preparation) ? opp.preparation : [];
  const byId = new Map<string, PrepItem>();
  for (const p of preps) {
    if (exclude.includes(p.id) || byId.has(p.id)) continue;
    byId.set(p.id, p);
  }
  const covered = (p: PrepItem) => findCoveringEvidence(profile, opp, p).length > 0;
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...byId.values()].filter((p) => p.required_for_application === true).map((p) => p.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node || covered(node)) continue;
    out.add(id);
    for (const d of Array.isArray(node.depends_on) ? node.depends_on : []) {
      if (d !== id && byId.has(d)) stack.push(d);
    }
  }
  return [...byId.values()].filter((p) => out.has(p.id));
}
