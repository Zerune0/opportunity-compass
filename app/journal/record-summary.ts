import type { JournalEntry } from "@/lib/types";

/** Current records for one profile, not inferred outcomes or a funnel. */
export function summarizeRecords(entries: readonly JournalEntry[], profileId: string) {
  const seen = new Set<string>();
  const own = entries.filter((entry) => {
    if (entry.profile_id !== profileId || seen.has(entry.opportunity_id)) return false;
    seen.add(entry.opportunity_id);
    return true;
  });
  const stage = (label: string, recorded: (entry: JournalEntry) => boolean, positive: (entry: JournalEntry) => boolean) => ({
    label,
    count: own.filter(positive).length,
    recorded: own.filter(recorded).length,
  });
  return {
    stages: [
      stage("Opportunities added to your Journal", () => true, () => true),
      stage("Previously unknown opportunities discovered", (e) => typeof e.outcome?.discovered_new_opportunity === "boolean", (e) => e.outcome?.discovered_new_opportunity === true),
      stage("Eligibility understood", (e) => typeof e.outcome?.understood_eligibility === "boolean", (e) => e.outcome?.understood_eligibility === true),
      stage("Materials recorded as completed", (e) => typeof e.outcome?.completed_materials === "boolean", (e) => e.outcome?.completed_materials === true),
      stage("Applications currently recorded as submitted", (e) => e.application !== "preparing", (e) => e.application === "submitted"),
      stage("Eligibility confirmed by the organizer", (e) => e.eligibility_confirmation !== "unconfirmed", (e) => e.eligibility_confirmation === "confirmed"),
      stage("Admission decisions received", (e) => e.decision !== "pending", (e) => e.decision === "admitted" || e.decision === "not_admitted"),
      stage("Actually participated", (e) => typeof e.participated === "boolean", (e) => e.participated === true),
    ],
    notes: own.flatMap((entry) => typeof entry.outcome?.helpful_note === "string" && entry.outcome.helpful_note.trim()
      ? [{ opportunityId: entry.opportunity_id, text: entry.outcome.helpful_note }]
      : []),
  };
}
