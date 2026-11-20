import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { markupControls } from "@/components/rpg/markup-controls";
import { localRecordTag } from "../../lib/sample-origin";
import type { Opportunity, StudentProfile } from "../../lib/types";
import { explainCatalog, orderPreparedCatalog } from "./board-model";
import { useQuestContext } from "./use-quest-context";
import QuestBoard from "./page";
import { QuestTable } from "./QuestTable";

vi.mock("./use-quest-context", () => ({
    sourceLabels: { official: "Official organizer", trusted_aggregator: "Trusted aggregator", user_posted: "User posted" },
    useQuestContext: vi.fn(),
}));
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// Fictional fixtures only; not real opportunities.
const official: Opportunity = {
    id: "fixture-official", title: "Fixture Robotics Camp", organizer: "Fixture Robotics League",
    category: "summer_program", fields: ["computer_science"], summary: "Fictional official fixture.",
    official_url: "https://fixture-league.edu/camp", verified_on: "2026-11-10", verified_by: "Fixture",
    deadline: "2026-12-01", location: { format: "online", country: null, state: null, city: null },
    cost: { fee_usd: 0, requires_travel_expense: false }, time_commitment: { hours_per_week: 3, total_weeks: 6 },
    required_devices: [], preparation: [], is_sample: false, source_tier: "official",
    requirements: [{ id: "req-grade", type: "grade", min: 9, max: 12, label: "Grades 9–12", hard: true, source_text: "Grades 9-12." }],
};
/** A user-posted sample (what Quest Creator stores): no official link may be shown for it. */
const posted: Opportunity = {
    ...official, id: "sample-post-fixture-table", title: "Fixture Club Quest", organizer: "Fixture club",
    official_url: "https://example.com/fixture-club", is_sample: true, source_tier: "user_posted", posted_by: "sample-publisher-fixture",
    location: { format: "in_person", country: "US", state: "CA", city: "Example City" }, deadline: "2026-12-20",
};
const catalog = [posted, official];
const today = "2026-11-19";
const profile: StudentProfile = { id: "fixture-student", display_name: "Fixture Student", is_sample: true, grade: 10, interests: ["computer_science"], evidence: [] };

function cards(p: StudentProfile | null = null): string {
    vi.mocked(useQuestContext).mockReturnValue({
        catalog, saved: [official.id], profile: p, grants: [], today, loaded: true, setSaved: () => {},
    } as ReturnType<typeof useQuestContext>);
    return renderToStaticMarkup(React.createElement(QuestBoard));
}
function table(p: StudentProfile | null = null): string {
    const explanations = explainCatalog(catalog, p, [], today);
    const items = orderPreparedCatalog(catalog, "deadline", !!p, explanations);
    return renderToStaticMarkup(React.createElement(QuestTable, {
        items, explanations, hasProfile: !!p, showReasons: false, saved: [official.id], loaded: true, today, onToggleSaved: () => {},
    }));
}

describe("Quest Board: Classic table and Adventure cards show the same opportunities and controls", () => {
    const cardHtml = cards();
    const tableHtml = table();

    it("renders cards before the view preference is read (the board's existing look)", () => {
        expect(cardHtml).toContain('class="rpg-route-grid"');
        expect(cardHtml).not.toContain("<table");
    });

    it("has every title link, save button and source marker in both views", () => {
        for (const html of [cardHtml, tableHtml]) {
            const controls = markupControls(html);
            for (const o of catalog) {
                expect(html).toContain(`href="/quests/${encodeURIComponent(o.id)}"`);
                expect(html).toContain(o.title);
                expect(html).toContain(o.organizer);
            }
            expect(controls).toContain("button: Unsave Fixture Robotics Camp");
            expect(controls).toContain("button: Save Fixture Club Quest");
            expect(html).toContain(localRecordTag(posted)!);
            expect(html).toContain("User posted");
            expect(html).toContain("Official organizer");
            expect(html).toContain("Sample record date");
            expect(html).toContain("Verified");
        }
    });

    it("keeps the official-link rule: only the official opportunity links out, never example.com", () => {
        for (const html of [cardHtml, tableHtml]) {
            expect(html).toContain('href="https://fixture-league.edu/camp"');
            expect(html).not.toContain("example.com");
        }
    });

    it("keeps the card order as the row order", () => {
        // User-posted records sort after official ones in both views (catalog lists the posted one first).
        expect(tableHtml.indexOf(official.title)).toBeLessThan(tableHtml.indexOf(posted.title));
        expect(cardHtml.indexOf(official.title)).toBeLessThan(cardHtml.indexOf(posted.title));
    });

    it("is an accessible table with a caption and scoped headers", () => {
        expect(tableHtml).toContain("<caption>Opportunities, in the current order</caption>");
        expect(tableHtml).toContain('<th scope="col">Opportunity</th>');
        expect(tableHtml).toContain('<th scope="row">');
        expect(tableHtml).toContain('data-label="Weekly hours"');
    });

    it("has no Eligibility or Reachability columns without a profile", () => {
        expect(tableHtml).not.toContain("Eligibility");
        expect(tableHtml).not.toContain("Reachability");
    });

    it("shows Eligibility and Reachability from the same explanations the cards use when there is a profile", () => {
        const html = table(profile);
        expect(html).toContain('<th scope="col">Eligibility</th>');
        expect(html).toContain('<th scope="col">Reachability</th>');
        const explanations = explainCatalog(catalog, profile, [], today);
        const labels = { eligible: "Eligible", not_eligible: "Not eligible", unknown: "Unknown" } as const;
        for (const o of catalog) {
            const e = explanations.get(o.id)!;
            expect(html).toContain(`<td data-label="Eligibility">${labels[e.eligibility_overall]}</td>`);
        }
    });
});
