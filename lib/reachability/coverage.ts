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
