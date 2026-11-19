import { planRoutes } from "@/lib/path";
import type { Opportunity, PlanSnapshot, StudentProfile } from "@/lib/types";
import { nextSnapshot } from "./plan-snapshots";

/** Build snapshots from a successful explicit link action, without guessing its cause later. */
export function evidenceLinkSnapshots(
  latest: PlanSnapshot | null,
  before: StudentProfile,
  after: StudentProfile,
  opportunity: Opportunity,
  evidenceId: string,
  prepId: string,
  today: string,
): PlanSnapshot[] {
  if (before.id !== after.id) return [];
  const evidence = after.evidence.find((item) => item.id === evidenceId);
  const previous = before.evidence.find((item) => item.id === evidenceId);
  const prep = opportunity.preparation.find((item) => item.id === prepId);
  const key = `${opportunity.id}:${prepId}`;
  if (!evidence || !previous || !prep || previous.prep_item_ids?.includes(key) || !evidence.prep_item_ids?.includes(key)) return [];
  const baseline = nextSnapshot(latest, planRoutes(before, opportunity, { today }), before, opportunity, today);
  // Even if the step was already covered, preserve the actual link action and let Why say routes did not change.
  const updated = nextSnapshot(null, planRoutes(after, opportunity, { today }), after, opportunity, today)!;
  return [
    ...(baseline ? [baseline] : []),
    { ...updated, trigger: "evidence_edited", trigger_detail:
      `Linked existing evidence "${evidence.title}" to preparation step "${prep.title}" for "${opportunity.title}". No new evidence item was added.` },
  ];
}
