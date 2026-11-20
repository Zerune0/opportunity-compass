import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { markupControls } from "@/components/rpg/markup-controls";
import { renderedView } from "@/components/rpg/view-preference";
import type { JournalEntry, Opportunity, ViewPreference } from "@/lib/types";
import { JournalEntryCard } from "./JournalEntryCard";
import { QuestList } from "./QuestList";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// Fictional fixtures; only the fields the cards read are filled in.
const OFFICIAL_URL = "https://programs.fixture-university.edu/summer";
const catalogOpp = {
  id: "fixture-catalog-program", title: "Fixture Summer Program", deadline: "2027-01-15", deadline_note: "11:59 pm local time",
  official_url: OFFICIAL_URL, source_tier: "official", is_sample: false,
} as unknown as Opportunity;
const sampleOpp = {
  ...catalogOpp, id: "fixture-sample-program", title: "Fixture Sample Workshop", deadline: null, deadline_note: null,
  official_url: "https://example.com/fixture-sample", is_sample: true,
} as unknown as Opportunity;
const postedOpp = {
  ...catalogOpp, id: "sample-post-fixture-club-1", title: "Fixture Club Quest",
  official_url: "https://example.com/sample-post-fixture-club-1", source_tier: "user_posted", is_sample: true, posted_by: "sample-club",
} as unknown as Opportunity;
const opportunities = [catalogOpp, sampleOpp, postedOpp];

function entry(opportunity_id: string, official_url: string, extra: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: `journal-${opportunity_id}`, profile_id: "fixture-student", opportunity_id, added_on: "2026-11-01",
    application: "preparing", submitted_on: null, eligibility_confirmation: "unconfirmed", decision: "pending",
    participated: null, history: [{ event: "added", on: "2026-11-01" }], tasks: [], material_ids: [], official_url,
    ...extra,
  };
}

const entries: JournalEntry[] = [
  entry(catalogOpp.id, OFFICIAL_URL, {
    tasks: [
      { id: "t1", title: "Draft the project summary", done: true, done_on: "2026-11-10" },
      { id: "t2", title: "Ask a teacher for a reference", done: false },
    ],
  }),
  entry(sampleOpp.id, sampleOpp.official_url, {
    application: "submitted", submitted_on: "2026-11-12", eligibility_confirmation: "confirmed", decision: "admitted", participated: true,
    history: [
      { event: "added", on: "2026-11-01" }, { event: "submitted", on: "2026-11-12" },
      { event: "eligibility_confirmed", on: "2026-11-14" }, { event: "admitted", on: "2026-11-16" }, { event: "participated", on: "2026-11-18" },
    ],
    outcome: { discovered_new_opportunity: true, understood_eligibility: null, completed_materials: false, helpful_note: "The checklist", recorded_on: "2026-11-18" },
  }),
  entry(postedOpp.id, postedOpp.official_url, { application: "withdrawn", eligibility_confirmation: "rejected", decision: "not_admitted", participated: false }),
  entry("fixture-gone-program", "https://programs.fixture-university.edu/gone"),
];

const STATUS_LABELS = ["Your application", "Eligibility confirmed by the organizer", "Admission decision", "Participation"];

function list(view: ViewPreference): string {
  return renderToStaticMarkup(React.createElement(QuestList, {
    entries, findOpportunity: (id: string) => opportunities.find((opp) => opp.id === id),
    profileId: "fixture-student", today: "2026-11-19", onChange: () => {}, view,
  }));
}

function card(e: JournalEntry, view?: ViewPreference): string {
  const opportunity = opportunities.find((opp) => opp.id === e.opportunity_id);
  return renderToStaticMarkup(React.createElement(JournalEntryCard, {
    entry: e, opportunity, profileId: "fixture-student", today: "2026-11-19", onChange: () => {}, ...(view ? { view } : {}),
  }));
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

describe("markupControls", () => {
  it("lists buttons, links, inputs, selects, textareas and summaries by name", () => {
    const html = '<button aria-label="Edit evidence: A">Edit</button><button>Save <span>it</span></button>'
      + '<a href="/x?a=1&amp;b=2">Go</a><input type="date" id="d"/><input name="title"/>'
      + '<select name="kind"><option>x</option></select><textarea name="note"></textarea><details><summary>More (2)</summary></details>';
    expect(markupControls(html)).toEqual([
      "button: Edit evidence: A", "button: Save it", "input: date | ", "input: text | title",
      "link: /x?a=1&b=2 | Go", "select: kind", "summary: More (2)", "textarea: note",
    ]);
  });
});

describe("renderedView", () => {
  it("keeps the classic markup until the stored preference has been read", () => {
    expect(renderedView("adventure", false)).toBe("classic");
    expect(renderedView("classic", false)).toBe("classic");
    expect(renderedView("adventure", true)).toBe("adventure");
    expect(renderedView("classic", true)).toBe("classic");
  });
});

describe("Quest Journal: Adventure and Classic offer the same controls", () => {
  const classic = list("classic");
  const adventure = list("adventure");

  it("has the same buttons, links, inputs, selects, textareas and summaries in both views", () => {
    const classicControls = markupControls(classic);
    expect(classicControls.length).toBeGreaterThan(40);
    expect(markupControls(adventure)).toEqual(classicControls);
  });

  it("checks each entry card on its own too", () => {
    for (const e of entries) expect(markupControls(card(e, "adventure"))).toEqual(markupControls(card(e, "classic")));
  });

  it("keeps Classic exactly as the card renders without a view", () => {
    for (const e of entries) expect(card(e, "classic")).toBe(card(e));
    expect(classic).toContain('<div class="rpg-stack">');
    expect(classic).not.toContain("rpg-quest");
  });

  it("shows one quest card per entry, as a list with a heading each", () => {
    expect(count(adventure, '<ul class="rpg-quest-list">')).toBe(1);
    expect(count(adventure, '<article aria-labelledby="journal-entry-')).toBe(entries.length);
    expect(count(adventure, '<h3 id="journal-entry-')).toBe(entries.length);
    expect(count(adventure, '<li><article')).toBe(entries.length);
  });

  it("keeps the four status lines separate in every card", () => {
    for (const e of entries) {
      const html = card(e, "adventure");
      for (const label of STATUS_LABELS) expect(count(html, `<dt><strong>${label}</strong></dt>`)).toBe(1);
    }
  });

  it("adds no score, level, streak or progress bar", () => {
    expect(adventure).not.toContain("%");
    expect(adventure).not.toMatch(/<progress|role="progressbar"|role="meter"/);
    expect(adventure).not.toMatch(/\blevel\b|\bXP\b|streak|badge|complet(e|ion) rate/i);
  });

  it("puts the official page in the card head, and never for samples or user-posted records", () => {
    const head = (html: string) => html.slice(html.indexOf('<header class="rpg-quest-card__head">'), html.indexOf("</header>"));
    expect(head(card(entries[0], "adventure"))).toContain(`href="${OFFICIAL_URL}"`);
    expect(head(card(entries[0], "adventure"))).toContain("Official page (opens in a new tab)");
    for (const e of entries.slice(1, 3)) {
      const html = card(e, "adventure");
      expect(html).not.toContain("example.com");
      expect(html).not.toContain("Official page");
    }
    expect(head(card(entries[1], "adventure"))).toContain("This is a sample record. It has no official page.");
    expect(head(card(entries[2], "adventure"))).toContain("This is a sample record posted in this browser. It has no official page.");
    expect(head(card(entries[3], "adventure"))).toContain("no longer in the catalog");
  });
});
