import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { markupControls } from "@/components/rpg/markup-controls";
import type { EvidenceItem, StudentProfile, ViewPreference } from "@/lib/types";
import { catalog, statusLabels, type LinkContext } from "./evidence-shared";
import { SavedEvidence } from "./SavedEvidence";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

// A real catalog step, so one link resolves; the other key points at a fictional opportunity that is gone.
const linkable = catalog.find((opp) => opp.preparation.length > 0)!;
const realKey = `${linkable.id}:${linkable.preparation[0].id}`;

// Fictional evidence, one item per status.
const evidence: EvidenceItem[] = [
  { id: "ev-1", title: "Fixture weather station", kind: "project", skills: ["python", "data_analysis"], status: "self_reported",
    description: "A small sensor project.", url: "https://code.fixture-school.edu/station", prep_item_ids: [realKey, "fixture-gone:step-1"], added_on: "2026-11-01" },
  { id: "ev-2", title: "Fixture design portfolio", kind: "portfolio", skills: [], status: "evidence_attached", url: "https://fixture-portfolio.edu/me", added_on: "2026-11-02" },
  { id: "ev-3", title: "Fixture tutoring hours", kind: "volunteer_experience", skills: ["teaching"], status: "reviewed", url: null, added_on: "2026-11-03" },
  { id: "ev-4", title: "Fixture online course", kind: "course", skills: [], status: "unverified", url: "not-a-link", added_on: "2026-11-04" },
];
const profile: StudentProfile = { id: "fixture-student", display_name: "Fixture Student", is_sample: false, evidence };
const ctx: LinkContext = { userPosted: [], journalIds: [], savedIds: [], today: "2026-11-19" };

function render(view: ViewPreference, p: StudentProfile | null | undefined = profile): string {
  return renderToStaticMarkup(React.createElement(SavedEvidence, { profile: p, ctx, view, onChange: () => {}, onDelete: () => {} }));
}

describe("Skill Passport evidence: Adventure inventory and Classic grid offer the same controls", () => {
  const classic = render("classic");
  const adventure = render("adventure");

  it("has the same buttons, links and inputs in both views", () => {
    const classicControls = markupControls(classic);
    expect(classicControls).toContain("button: Edit evidence: Fixture weather station");
    expect(classicControls).toContain("button: Delete evidence: Fixture online course");
    expect(classicControls).toContain(`button: Unlink Fixture weather station from ${linkable.preparation[0].title}`);
    expect(classicControls).toContain("link: https://code.fixture-school.edu/station | View attached evidence");
    expect(classicControls.filter((c) => c === "button: Link to a preparation step")).toHaveLength(evidence.length);
    expect(markupControls(adventure)).toEqual(classicControls);
  });

  it("keeps Classic as the plain card grid", () => {
    expect(classic).toContain('<ul class="rpg-route-grid rpg-plain-list">');
    expect(classic).not.toContain("rpg-inventory");
    expect(classic).not.toContain("rpg-slot");
  });

  it("shows each item as a slot in a list, with its title, type and status text", () => {
    expect(count(adventure, '<ul class="rpg-inventory">')).toBe(1);
    const slots = adventure.split('<article class="rpg-card rpg-slot">').slice(1);
    expect(slots).toHaveLength(evidence.length);
    slots.forEach((slot, index) => {
      const item = evidence[index];
      expect(slot).toContain(`<h3>${item.title}</h3>`);
      expect(slot).toContain(`<span class="rpg-slot__kind">${item.kind.replaceAll("_", " ")}</span>`);
      expect(slot).toContain(`>${statusLabels[item.status]}</span>`);
    });
    for (const label of ["Self-reported", "Evidence attached", "Reviewed", "Unverified"]) expect(adventure).toContain(`>${label}</span>`);
  });

  it("adds no score, level, streak or progress bar", () => {
    expect(adventure).not.toContain("%");
    expect(adventure).not.toMatch(/<progress|role="progressbar"|role="meter"/);
    expect(adventure).not.toMatch(/\blevel\b|\bXP\b|streak|badge/i);
  });

  it("shows the same empty state, and nothing while the profile is loading", () => {
    const empty = { ...profile, evidence: [] };
    expect(render("classic", empty)).toContain("<p>No evidence saved yet.</p>");
    expect(render("adventure", empty)).toContain("<p>No evidence saved yet.</p>");
    expect(render("adventure", empty)).not.toContain("<ul");
    expect(render("adventure", null)).toContain("<p>No evidence saved yet.</p>");
    expect(render("adventure", undefined)).not.toContain("No evidence");
    expect(render("classic", undefined)).not.toContain("No evidence");
  });
});

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}
