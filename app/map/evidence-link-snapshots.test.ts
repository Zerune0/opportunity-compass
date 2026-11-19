import { describe, expect, it } from "vitest";
import { sampleProfiles } from "@/lib/data";
import { planRoutes } from "@/lib/path";
import type { Opportunity, StudentProfile } from "@/lib/types";
import { evidenceLinkSnapshots } from "./evidence-link-snapshots";
import { nextSnapshot } from "./plan-snapshots";
const today = "2026-11-19";
// Snapshot of mlh-open-source-week-2026 as of 2026-11-19, kept in the test so data edits do not change it.
const opp = {
  "verified_by": "Jiale Li",
  "verified_on": "2026-11-17",
  "required_devices": [],
  "preparation": [
    {
      "id": "practice-open-source-pr",
      "title": "Practice opening a pull request",
      "skill": "git",
      "evidence_kind": "project",
      "estimated_hours": 1,
      "estimated_cost_usd": 0,
      "depends_on": [],
      "required_for_application": false,
      "source_text": "Team suggestion — not an official requirement",
      "material_kind": null,
      "reusable_across_opportunities": null
    }
  ],
  "id": "mlh-open-source-week-2026",
  "title": "Global Hack Week: Open Source Week",
  "organizer": "Major League Hacking",
  "category": "hackathon",
  "fields": [
    "software_development",
    "open_source"
  ],
  "summary": "A free online week of open-source projects, challenges, and live workshops.",
  "official_url": "https://events.mlh.com/events/15199-global-hack-week-open-source-week",
  "deadline": null,
  "deadline_note": "See the organizer for registration availability.",
  "location": {
    "format": "online",
    "country": null,
    "state": null,
    "city": null
  },
  "cost": {
    "fee_usd": 0,
    "requires_travel_expense": false,
    "note": "Free participation confirmed at https://ghw.mlh.com/ (Global Hack Week umbrella page)."
  },
  "time_commitment": {
    "hours_per_week": null,
    "total_weeks": 1,
    "note": "Check the event schedule for individual sessions.",
    "start_date": "2026-12-04",
    "end_date": "2026-12-10"
  },
  "requirements": [],
  "source_tier": "official",
  "recurring_annually": null,
  "is_sample": false,
  "posted_by": null
} as unknown as Opportunity;
const prep = opp.preparation[0];
const before: StudentProfile = { ...sampleProfiles()[0], evidence: [{ id: "existing", title: "My existing certificate", kind: "certificate", skills: [], status: "self_reported", added_on: today, prep_item_ids: [] }] };
const after: StudentProfile = { ...before, evidence: before.evidence.map((item) => ({ ...item, prep_item_ids: [`${opp.id}:${prep.id}`] })) };
describe("Explicit evidence link replay", () => {
  it("preserves before/after and identifies the existing evidence and linked step", () => {
    const snapshots = evidenceLinkSnapshots(null, before, after, opp, "existing", prep.id, today);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].inputs.evidence_ids).toEqual(snapshots[1].inputs.evidence_ids);
    expect(snapshots[1].trigger).toBe("evidence_edited");
    expect(snapshots[1].trigger_detail).toContain('Linked existing evidence "My existing certificate"');
    expect(snapshots[1].trigger_detail).toContain(prep.title);
    expect(snapshots[1].trigger_detail).toContain("No new evidence item was added");
    expect(nextSnapshot(snapshots[1], planRoutes(after, opp, { today }), after, opp, today)).toBeNull();
  });
  it("does not duplicate an existing baseline", () => {
    const initial = nextSnapshot(null, planRoutes(before, opp, { today }), before, opp, today)!;
    expect(evidenceLinkSnapshots(initial, before, after, opp, "existing", prep.id, today)).toHaveLength(1);
  });
  it("does not record failed, duplicate or cross-profile links", () => {
    expect(evidenceLinkSnapshots(null, before, before, opp, "existing", prep.id, today)).toEqual([]);
    expect(evidenceLinkSnapshots(null, after, after, opp, "existing", prep.id, today)).toEqual([]);
    expect(evidenceLinkSnapshots(null, before, { ...after, id: "another" }, opp, "existing", prep.id, today)).toEqual([]);
  });
});
