import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../lib/types";
import type { QuestContext } from "./use-quest-context";
import { comparisonFacts, savedComparisonOpportunities } from "./saved-comparison-model";
import { SavedComparison } from "./saved-comparison";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const first: Opportunity = {
    id: "sample-comparison-a", title: "Sample research A", organizer: "Sample organizer",
    category: "research", fields: ["life_sciences"], summary: "Fictional comparison fixture.",
    official_url: "https://example.org/sample", verified_on: "2026-11-19", verified_by: "Sample verifier",
    deadline: "2027-01-01", location: { format: "online", country: null, state: null, city: null },
    cost: { fee_usd: 10, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 1 }, required_devices: [],
    requirements: [{ id: "grade", type: "grade", min: 13, max: 16, hard: true, label: "Undergraduate", source_text: "Fictional undergraduate rule." }],
    preparation: [], source_tier: "official", is_sample: true, team_requirement: { required: false, source_text: "Fictional individual participation." },
};
const second: Opportunity = { ...first, id: "sample-comparison-b", title: "Sample research B", cost: { fee_usd: 0, requires_travel_expense: false } };
const profile: StudentProfile = { id: "sample-comparison-student", is_sample: true, display_name: "Sample student", grade: 13, hours_per_week_available: 8, budget_usd: 0, devices: [], skills: [], evidence: [] };
type Context = Pick<QuestContext, "catalog" | "saved" | "profile" | "grants" | "today">;
const baseContext: Context = { catalog: [first, second], saved: [first.id, second.id], profile: null, grants: [], today: "2026-11-19" };
const render = (changes: Partial<Context> = {}, enabled = true) =>
    renderToStaticMarkup(React.createElement(SavedComparison, { context: { ...baseContext, ...changes }, enabled }));

describe("saved comparison facts", () => {
    it("preserves saved order, removes duplicates and ignores removed catalog records", () => {
        expect(savedComparisonOpportunities([first, second], [second.id, "removed", second.id, first.id])).toEqual([second, first]);
        expect(savedComparisonOpportunities([first, second], [])).toEqual([]);
    });
    it("distinguishes unknown amounts and hours from recorded zero values", () => {
        const unknown: Opportunity = { ...first, deadline: null, cost: { fee_usd: null, requires_travel_expense: null }, time_commitment: { hours_per_week: null, total_weeks: null } };
        expect(comparisonFacts(unknown)).toMatchObject({ fee: "Unknown", hours: "Unknown", deadline: "Unknown", travel: "Travel costs unconfirmed" });
        expect(comparisonFacts({ ...second, time_commitment: { hours_per_week: 0, total_weeks: 1 } })).toMatchObject({ fee: "$0", hours: "0 h/week" });
    });
    it("does not infer a physical location from an unknown or hybrid format", () => {
        expect(comparisonFacts({ ...first, location: { format: "unknown", country: null, state: null, city: null } })).toMatchObject({ format: "Unconfirmed", location: "Unknown" });
        expect(comparisonFacts({ ...first, location: { format: "hybrid", country: null, state: null, city: null } }).location).toBe("Unknown");
        expect(comparisonFacts(first).location).toBe("Online");
    });
});
describe("saved comparison rendering", () => {
    it("hides outside Saved only and when fewer than two distinct catalog records are saved", () => {
        expect(render({}, false)).toBe("");
        expect(render({ saved: [] })).toBe("");
        expect(render({ saved: [first.id, first.id, "removed"] })).toBe("");
    });
    it("renders facts, fixed disclaimer, accessible scroll region and unassessed profile state", () => {
        const page = render();
        expect(page).toContain("Saved opportunities comparison");
        expect(page).toContain("does not rank opportunities or estimate admission chances");
        expect(page).toContain("Reachability does not guarantee admission");
        expect(page).toContain('role="region"');
        expect(page).toContain('tabindex="0"');
        expect(page).toContain("Not assessed");
        expect(page).toContain('href="/quests/sample-comparison-a"');
        expect(page).toContain("Weekly hours");
        expect(page).toContain("Barrier types");
    });
    it("keeps user-posted entries labelled and avoids unavailable detail links", () => {
        const posted: Opportunity = { ...first, id: "sample-user-post", source_tier: "user_posted" };
        const page = render({ catalog: [posted, second], saved: [posted.id, second.id] });
        expect(page).toContain("User-posted");
        expect(page).toContain("Sample");
        expect(page).not.toContain('href="/quests/sample-user-post"');
    });
    it("uses shared-engine barriers and keeps pending support unresolved", () => {
        const grant: ResourceGrant = { id: "pending-fee", student_id: profile.id, opportunity_id: first.id, type: "fee_waiver", status: "pending", amount_usd: 10, provider: "Sample provider", is_sample: true };
        const page = render({ profile, grants: [grant] });
        expect(page).toContain("Recorded rules satisfied");
        expect(page).toContain("Cost: open");
        expect(page).toContain("Sample student profile");
        expect(page).not.toContain("Cost: support applied");
    });
    it("applies approved support only to its student and opportunity and labels simulation", () => {
        const grant: ResourceGrant = { id: "approved-fee", student_id: profile.id, opportunity_id: first.id, type: "fee_waiver", status: "approved", amount_usd: 10, provider: "Sample provider", is_sample: true };
        expect(render({ profile, grants: [grant] })).toContain("Cost: support applied");
        expect(render({ profile, grants: [grant] })).toContain("Simulated support");
        expect(render({ profile, grants: [{ ...grant, student_id: "another-student" }] })).toContain("Cost: open");
        expect(render({ profile, grants: [{ ...grant, opportunity_id: "another-opportunity" }] })).toContain("Cost: open");
    });
    it("does not label an empty requirements list as confirmed official eligibility", () => {
        const page = render({ profile, catalog: [{ ...first, requirements: [] }, second] });
        expect(page).toContain("Unconfirmed — no official requirements recorded");
    });
});
