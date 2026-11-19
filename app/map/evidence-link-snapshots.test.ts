import { describe, expect, it } from "vitest";
import { catalogOpportunities, sampleProfiles } from "@/lib/data";
import { planRoutes } from "@/lib/path";
import type { StudentProfile } from "@/lib/types";
import { evidenceLinkSnapshots } from "./evidence-link-snapshots";
import { nextSnapshot } from "./plan-snapshots";
const today = "2026-11-19";
const opp = catalogOpportunities().find((item) => item.id === "mlh-open-source-week-2026")!;
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
