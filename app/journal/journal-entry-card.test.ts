import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { JournalEntry, Opportunity } from "@/lib/types";
import { JournalEntryCard } from "./JournalEntryCard";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// Fictional fixtures; only the fields the card reads are filled in.
const OFFICIAL_URL = "https://programs.fixture-university.edu/summer";
const catalogOpp = {
  id: "fixture-catalog-program", title: "Fixture Summer Program", deadline: "2027-01-15", deadline_note: null,
  official_url: OFFICIAL_URL, source_tier: "official", is_sample: false,
} as unknown as Opportunity;
const postedOpp = {
  ...catalogOpp, id: "sample-post-fixture-club-1", title: "Fixture Club Quest",
  official_url: "https://example.com/sample-post-fixture-club-1", source_tier: "user_posted", is_sample: true, posted_by: "sample-club",
} as unknown as Opportunity;

function entry(opportunity_id: string, official_url: string): JournalEntry {
  return {
    id: `journal-${opportunity_id}`, profile_id: "fixture-student", opportunity_id, added_on: "2026-11-19",
    application: "preparing", submitted_on: null, eligibility_confirmation: "unconfirmed", decision: "pending",
    participated: null, history: [], tasks: [], material_ids: [], official_url,
  };
}

function render(e: JournalEntry, opportunity: Opportunity | undefined): string {
  return renderToStaticMarkup(React.createElement(JournalEntryCard, { entry: e, opportunity, profileId: "fixture-student", today: "2026-11-19", onChange: () => {} }));
}

describe("Quest Journal entry: official page link", () => {
  it("keeps the official link for a catalog opportunity", () => {
    const page = render(entry(catalogOpp.id, OFFICIAL_URL), catalogOpp);
    expect(page).toContain(`href="${OFFICIAL_URL}"`);
    expect(page).toContain("Official page (opens in a new tab)");
    expect(page).toContain("You can apply there directly at any time.");
  });
  it("never shows a user-posted sample as an official page", () => {
    const page = render(entry(postedOpp.id, postedOpp.official_url), postedOpp);
    expect(page).not.toContain("example.com");
    expect(page).not.toContain("Official page");
    expect(page).not.toContain("apply there directly");
    expect(page).toContain("This is a sample record posted in this browser. It has no official page.");
  });
  it("does not show the saved example.com address once the posted sample is withdrawn", () => {
    const page = render(entry(postedOpp.id, postedOpp.official_url), undefined);
    expect(page).toContain("no longer in the catalog");
    expect(page).not.toContain("example.com");
    expect(page).not.toContain("Official page");
    expect(page).toContain("No official page is on record for this entry.");
  });
  it("still links the saved address of a catalog opportunity that left the catalog", () => {
    const page = render(entry(catalogOpp.id, OFFICIAL_URL), undefined);
    expect(page).toContain(`href="${OFFICIAL_URL}"`);
  });
});
