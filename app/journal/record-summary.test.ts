import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/lib/types";
import { applyJournalEvent } from "@/lib/journal";
import { summarizeRecords } from "./record-summary";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return { id: "journal-one", profile_id: "one", opportunity_id: "opp-one", added_on: "2026-11-19", application: "preparing", submitted_on: null, eligibility_confirmation: "unconfirmed", decision: "pending", participated: null, history: [], tasks: [], material_ids: [], official_url: "https://example.org", ...overrides };
}
describe("student's own record summary", () => {
  it("does not infer later stages from a submission", () => {
    const result = summarizeRecords([entry({ application: "submitted" })], "one");
    expect(result.stages.map((s) => s.count)).toEqual([1, 0, 0, 0, 1, 0, 0, 0]);
    expect(result.stages[5].recorded).toBe(0);
  });
  it("distinguishes explicit negative feedback from no response", () => {
    const result = summarizeRecords([entry({ outcome: { discovered_new_opportunity: false, understood_eligibility: true, completed_materials: null }, participated: false })], "one");
    expect(result.stages[1]).toMatchObject({ count: 0, recorded: 1 });
    expect(result.stages[2]).toMatchObject({ count: 1, recorded: 1 });
    expect(result.stages[3]).toMatchObject({ count: 0, recorded: 0 });
    expect(result.stages[7]).toMatchObject({ count: 0, recorded: 1 });
  });
  it("counts both positive and negative admission decisions as received", () => {
    const result = summarizeRecords([entry({ decision: "admitted" }), entry({ opportunity_id: "opp-two", decision: "not_admitted" })], "one");
    expect(result.stages[6]).toMatchObject({ count: 2, recorded: 2 });
    expect(result.stages[7].recorded).toBe(0);
  });
  it("isolates profiles and counts a stored opportunity once", () => {
    const original = entry({ outcome: { helpful_note: "  My note\nunchanged  " } });
    const rows = [original, entry(), entry({ profile_id: "other", opportunity_id: "secret", participated: true })];
    const before = JSON.stringify(rows);
    const result = summarizeRecords(rows, "one");
    expect(result.stages[0].count).toBe(1);
    expect(result.notes).toEqual([{ opportunityId: "opp-one", text: "  My note\nunchanged  " }]);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("uses current corrected values rather than old history events", () => {
    let current = entry({ application: "submitted", eligibility_confirmation: "confirmed", decision: "admitted", participated: true });
    for (const event of ["reopened", "eligibility_cleared", "decision_cleared", "participation_cleared"] as const) current = applyJournalEvent(current, event, "2026-11-19");
    expect(summarizeRecords([current], "one").stages.slice(4).map((s) => s.recorded)).toEqual([0, 0, 0, 0]);
  });
  it("handles an empty journal and blank notes", () => {
    expect(summarizeRecords([], "one").stages.every((s) => s.recorded === 0)).toBe(true);
    expect(summarizeRecords([entry({ outcome: { helpful_note: " \n " } })], "one").notes).toEqual([]);
  });
});
