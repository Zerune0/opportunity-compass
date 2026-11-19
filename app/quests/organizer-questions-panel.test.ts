import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OrganizerQuestions } from "./organizer-questions-panel";
import type { buildOrganizerQuestions } from "./organizer-questions";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// Fictional fixtures.
const OFFICIAL_URL = "https://programs.fixture-university.edu/summer";
const draft: ReturnType<typeof buildOrganizerQuestions> = {
  questions: ["Could you confirm the participation fee?"],
  profileUpdates: [],
  message: "Subject: Questions about Fixture Program\n\n1. Could you confirm the participation fee?",
};

function render(opportunity: Parameters<typeof OrganizerQuestions>[0]["opportunity"]): string {
  return renderToStaticMarkup(React.createElement(OrganizerQuestions, { opportunity, draft }));
}

describe("Questions to ask the organizer", () => {
  it("links the official program page for a catalog opportunity", () => {
    const page = render({ official_url: OFFICIAL_URL, source_tier: "official", is_sample: false });
    expect(page).toContain(`href="${OFFICIAL_URL}"`);
    expect(page).toContain("Open the official program page");
    expect(page).toContain("Copy questions");
  });
  it("has no official link or organizer contact for a user-posted sample, but keeps the copy button", () => {
    const page = render({ official_url: "https://example.com/sample-post-fixture-1", source_tier: "user_posted", is_sample: true });
    expect(page).not.toContain("example.com");
    expect(page).not.toContain("official program page");
    expect(page).toContain("This is a sample record, so there is no real organizer to contact.");
    expect(page).toContain("Copy questions");
  });
});
