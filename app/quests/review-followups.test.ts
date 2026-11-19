import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as matchEngine from "../../lib/match";
import type { Opportunity, StudentProfile } from "../../lib/types";
import { useQuestContext } from "./use-quest-context";
import { QuestDetails } from "./[id]/quest-details";
import { QuestAssessment } from "./[id]/quest-assessment";

vi.mock("./use-quest-context", () => ({
    sourceLabels: { official: "Official" }, useQuestContext: vi.fn(),
}));
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const fixture: Opportunity = {
    id: "sample-review", title: "Sample review opportunity", organizer: "Sample organizer",
    category: "research", fields: ["life_sciences"], summary: "Fictional fixture.",
    official_url: "https://example.org/sample", verified_on: "2026-11-19", verified_by: "Sample verifier",
    deadline: "2027-02-01", location: { format: "online", country: null, state: null, city: null },
    cost: { fee_usd: 25, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 1 }, required_devices: [],
    requirements: [], preparation: [], source_tier: "official", is_sample: true,
};
const profile: StudentProfile = {
    id: "sample-review-student", is_sample: true, display_name: "Sample student",
    grade: 13, hours_per_week_available: 8, budget_usd: 0, devices: [], skills: [], evidence: [],
};
const gradeRule = { id: "undergraduate", type: "grade" as const, min: 13, max: 16, hard: true, label: "Undergraduate", source_text: "Fictional undergraduate requirement." };
const contextFor = (opportunity: Opportunity, student: StudentProfile | null) => ({
    catalog: [opportunity], saved: [], profile: student, grants: [], today: "2026-11-19", loaded: true,
});

describe("Quest Details review follow-ups", () => {
    it.each([[25, "$25"], [0, "Free"], [null, "Unknown, confirm with the organizer"]] as const)(
        "formats fee %s without converting unknown amounts", (fee, expected) => {
            const opportunity = { ...fixture, cost: { ...fixture.cost, fee_usd: fee } };
            vi.mocked(useQuestContext).mockReturnValue(contextFor(opportunity, null) as ReturnType<typeof useQuestContext>);
            const page = renderToStaticMarkup(React.createElement(QuestDetails, { id: opportunity.id }));
            expect(page).toContain("<dt>Program fee</dt><dd>" + expected + "</dd>");
        },
    );
    it.each([null, profile])("keeps missing official requirements unconfirmed with profile %s", student => {
        const page = renderToStaticMarkup(React.createElement(QuestAssessment, {
            opportunity: fixture, context: contextFor(fixture, student),
        }));
        expect(page).toContain("<h2>Official eligibility</h2><p>Unconfirmed — no official requirements recorded</p>");
    });
    it("retains a satisfied status when an entered official rule is actually satisfied", () => {
        const opportunity = { ...fixture, requirements: [gradeRule] };
        const page = renderToStaticMarkup(React.createElement(QuestAssessment, {
            opportunity, context: contextFor(opportunity, profile),
        }));
        expect(page).toContain("<h2>Official eligibility</h2><p>Requirements satisfied</p>");
    });
    it("keeps an alternative without recorded requirements unconfirmed too", () => {
        const opportunity = { ...fixture, requirements: [gradeRule] };
        const alternative = { ...fixture, id: "sample-review-alternative", title: "Sample alternative" };
        const spy = vi.spyOn(matchEngine, "findAlternatives").mockReturnValueOnce([{
            kind: "same_field", opportunity_id: alternative.id, title: alternative.title,
            reason: "Shared field, eligibility still needs confirmation.", eligibility_overall: "eligible", shared_fields: ["life_sciences"],
        }]);
        try {
            const page = renderToStaticMarkup(React.createElement(QuestAssessment, {
                opportunity, context: { ...contextFor(opportunity, profile), catalog: [opportunity, alternative] },
            }));
            expect(page).toContain('href="/quests/sample-review-alternative"');
            expect(page).toContain("Unconfirmed — no official requirements recorded");
        } finally { spy.mockRestore(); }
    });
});
