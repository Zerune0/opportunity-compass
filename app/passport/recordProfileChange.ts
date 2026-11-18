import catalogJson from "@/data/opportunities.json";
import { planRoutes } from "@/lib/path";
import { loadPlanSnapshots, pushPlanSnapshot } from "@/lib/store";
import type { Opportunity, PlanSnapshot, PlanTrigger, StudentProfile } from "@/lib/types";

/** Save route comparisons for opportunities this profile has already viewed. */
export function recordProfileChange(before: StudentProfile | null | undefined, after: StudentProfile) {
  if (!before || before.id !== after.id || JSON.stringify(before) === JSON.stringify(after)) return;
  const date = new Date();
  const today = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const added = after.evidence.filter((item) => !before.evidence.some((old) => old.id === item.id));
  const removed = before.evidence.filter((item) => !after.evidence.some((next) => next.id === item.id));
  const evidenceChanged = JSON.stringify(before.evidence) !== JSON.stringify(after.evidence);
  const trigger: PlanTrigger = added.length ? "evidence_added" : removed.length ? "evidence_removed" : evidenceChanged ? "evidence_edited" : "profile_edited";
  const fields = (Object.keys(after) as (keyof StudentProfile)[]).filter((field) =>
    field !== "school_name" && field !== "display_name" && JSON.stringify(before[field]) !== JSON.stringify(after[field]));
  if (!fields.length) return;
  const detail = added.length ? "Added evidence: " + added.map((item) => item.title).join(", ")
    : removed.length ? "Removed evidence: " + removed.map((item) => item.title).join(", ")
    : evidenceChanged ? "Updated supporting evidence."
    : "Updated profile fields: " + fields.join(", ");
  const viewed = new Set(loadPlanSnapshots(undefined, after.id).map((snapshot) => snapshot.opportunity_id));

  for (const opportunity of catalogJson as Opportunity[]) {
    if (!viewed.has(opportunity.id)) continue;
    const snapshot: PlanSnapshot = {
      id: crypto.randomUUID(), profile_id: after.id, opportunity_id: opportunity.id, taken_on: today,
      plan: planRoutes(after, opportunity, { today }), trigger, trigger_detail: detail,
      inputs: {
        evidence_ids: after.evidence.map((item) => item.id),
        hours_per_week_available: after.hours_per_week_available ?? null,
        budget_usd: after.budget_usd ?? null, grade: after.grade ?? null, today,
      },
    };
    pushPlanSnapshot(snapshot);
  }
}
