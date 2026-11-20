import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JournalEntry, Opportunity } from "../../lib/types";
import { useQuestContext } from "./use-quest-context";
import QuestBoard from "./page";
import { QuestDetails } from "./[id]/quest-details";
import { JournalEntryCard } from "../journal/JournalEntryCard";

vi.mock("./use-quest-context", () => ({
    sourceLabels: { official: "Official organizer", trusted_aggregator: "Trusted aggregator", user_posted: "User posted" },
    useQuestContext: vi.fn(),
}));
beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// Fictional fixtures (example.com, is_sample: true); not real opportunities.
const base: Opportunity = {
    id: "fixture-local", title: "Fixture local record", organizer: "Fixture organizer",
    category: "project", fields: ["computer_science"], summary: "Fictional fixture.",
    official_url: "https://example.com/fixture-local", verified_on: "2026-11-17", verified_by: "Fixture",
    deadline: "2026-12-15", location: { format: "in_person", country: "US", state: "CA", city: "Example City" },
    cost: { fee_usd: 0, requires_travel_expense: false }, time_commitment: { hours_per_week: 4, total_weeks: 1 },
    required_devices: [], preparation: [], is_sample: true, source_tier: "user_posted",
    requirements: [{ id: "req-grade", type: "grade", min: 9, max: 12, label: "Grades 9–12", hard: true, source_text: "Grades 9-12." }],
};
/** What the /organizer bridge stores: user_posted + is_sample, no posted_by. */
const organizerDemo: Opportunity = { ...base, id: "placeholder-inperson-event", title: "[Sample] In-person coding workshop", posted_by: null };
/** What Quest Creator stores: posted_by points at a sample publisher. */
const connectPost: Opportunity = { ...base, id: "sample-post-fixture-1", title: "Fixture Club Quest", posted_by: "sample-publisher-fixture" };

const DEMO_TAG = "Sample opportunity from the organizer demo · not a real listing";
const POSTED_TAG = "User-posted · not verified against an official site · Sample";

function setContext(opportunity: Opportunity) {
    vi.mocked(useQuestContext).mockReturnValue({
        catalog: [opportunity], saved: [], profile: null, grants: [], today: "2026-11-19", loaded: true, setSaved: () => {},
    } as ReturnType<typeof useQuestContext>);
}
const board = (o: Opportunity) => { setContext(o); return renderToStaticMarkup(React.createElement(QuestBoard)); };
const details = (o: Opportunity) => { setContext(o); return renderToStaticMarkup(React.createElement(QuestDetails, { id: o.id })); };
function journal(o: Opportunity): string {
    const e: JournalEntry = {
        id: `journal-${o.id}`, profile_id: "fixture-student", opportunity_id: o.id, added_on: "2026-11-19",
        application: "preparing", submitted_on: null, eligibility_confirmation: "unconfirmed", decision: "pending",
        participated: null, history: [], tasks: [], material_ids: [], official_url: o.official_url,
    };
    return renderToStaticMarkup(React.createElement(JournalEntryCard, { entry: e, opportunity: o, profileId: "fixture-student", today: "2026-11-19", onChange: () => {} }));
}

describe("organizer demo sample copy is not labelled user-posted", () => {
    it("Quest Board card: new tag and source, no User-posted, no official link", () => {
        const page = board(organizerDemo);
        expect(page).toContain(DEMO_TAG);
        expect(page).toContain("<dt>Source</dt><dd>Organizer demo (sample)</dd>");
        expect(page).not.toContain("User-posted");
        expect(page).not.toContain("User posted");
        expect(page).not.toContain("Official application");
    });
    it("Quest Details: new tag, source and eligibility heading; no official or map links", () => {
        const page = details(organizerDemo);
        expect(page).toContain(DEMO_TAG);
        expect(page).toContain("<dt>Source</dt><dd>Organizer demo (sample)</dd>");
        expect(page).toContain("<h2>Eligibility in the sample scenario</h2>");
        expect(page).toContain("These requirements belong to a sample scenario used by the organizer demo. They are not from an official site.");
        expect(page).not.toContain("User-posted");
        expect(page).not.toContain("User posted");
        expect(page).not.toContain("stated by the poster");
        expect(page).not.toContain("sample publisher");
        expect(page).not.toContain("Apply on the official site");
        expect(page).not.toContain("/map?opp=");
        expect(page).toContain("Growth routes are available for verified catalog opportunities only.");
    });
    it("Journal card: new tag and note; no official page", () => {
        const page = journal(organizerDemo);
        expect(page).toContain(DEMO_TAG);
        expect(page).toContain("This is a sample opportunity saved by the organizer demo in this browser. It has no official page.");
        expect(page).not.toContain("User-posted");
        expect(page).not.toContain("posted in this browser");
        expect(page).not.toContain("example.com");
    });
});

describe("Quest Creator posts keep their existing wording", () => {
    it("Quest Board card", () => {
        const page = board(connectPost);
        expect(page).toContain(`<p class="rpg-tag rpg-tag--warning">${POSTED_TAG}</p>`);
        expect(page).toContain("<dt>Source</dt><dd>User posted</dd>");
        expect(page).not.toContain("organizer demo");
    });
    it("Quest Details", () => {
        const page = details(connectPost);
        expect(page).toContain(`<p class="rpg-tag rpg-tag--warning">${POSTED_TAG}</p>`);
        expect(page).toContain("<dt>Source</dt><dd>User posted</dd>");
        expect(page).toContain("<h2>Eligibility stated by the poster</h2>");
        expect(page).toContain("These requirements were entered by a sample publisher in this browser. They are not from an official site.");
        expect(page).not.toContain("organizer demo");
        expect(page).not.toContain("/map?opp=");
    });
    it("Journal card", () => {
        const page = journal(connectPost);
        expect(page).toContain(POSTED_TAG);
        expect(page).toContain("This is a sample record posted in this browser. It has no official page.");
        expect(page).not.toContain("organizer demo");
    });
});
