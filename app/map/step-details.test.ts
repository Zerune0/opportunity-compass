import { describe, expect, it } from "vitest";
import type { PrepItem, RouteStep } from "@/lib/types";
import { stepFields } from "./step-details";
import { resolveViewPreference } from "@/components/rpg/view-preference";

const step: RouteStep = { id: "step", title: "Prepare", hours: 1, cost_usd: 0, depends_on: [], skipped: false, skip_reason: null, satisfied_by_evidence_ids: [] };
const values = (value: RouteStep, prep?: PrepItem) => Object.fromEntries(stepFields(value, prep));

describe("step details preserve the recorded contract", () => {
  it("does not infer missing snapshot fields from descriptions or preparation flags", () => {
    const result = values({ ...step, description: "Official-looking description" }, { required_for_application: true, evidence_kind: "project", source_text: "Original source" } as PrepItem);
    expect(result["Why this step"]).toBe("Not recorded");
    expect(result["Evidence you can record"]).toBe("Not recorded");
    expect(result["Official requirement?"]).toBe("Not recorded");
  });
  it("preserves the engine explanation and labels evidence codes", () => {
    const result = values({ ...step, relation: "Builds a portfolio for this target.", evidence_needed: "competition_result", official: "team_suggestion" });
    expect(result["Why this step"]).toBe("Builds a portfolio for this target.");
    expect(result["Evidence you can record"]).toBe("Competition result");
    expect(result["Official requirement?"]).toBe("Suggested by our team — not required by the organizer");
  });
  it("shows original organizer source only for a recorded official classification", () => {
    expect(values({ ...step, official: "official_requirement" }, { source_text: "Submit the original report." } as PrepItem)["Official requirement?"]).toBe("Stated by the organizer — “Submit the original report.”");
    expect(values({ ...step, official: "official_requirement" })["Official requirement?"]).toBe("Stated by the organizer — source: Not recorded");
    expect(values({ ...step, official: "application_step" })["Official requirement?"]).toBe("Application step");
  });
  it("quotes only the official excerpt as the organizer's words and labels our verification note separately", () => {
    const prep = { source_text: 'Official excerpt: "Two Letters of Support" Human-verified application instructions: At least two support letters. Preparation hours and cost are team estimates for this task, not official program commitments or fees.' } as PrepItem;
    expect(values({ ...step, official: "official_requirement" }, prep)["Official requirement?"]).toBe(
      "Stated by the organizer — “Two Letters of Support” Our note: Human-verified application instructions: At least two support letters. Preparation hours and cost are team estimates for this task, not official program commitments or fees.",
    );
    const inner = { source_text: 'Official excerpt: "Complete the “Expression of Interest” essay to be shared with state legislators."' } as PrepItem;
    expect(values({ ...step, official: "official_requirement" }, inner)["Official requirement?"]).toBe("Stated by the organizer — “Complete the “Expression of Interest” essay to be shared with state legislators.”");
    expect(values({ ...step, official: "official_requirement" }, { source_text: 'Official excerpt: ""' } as PrepItem)["Official requirement?"]).toBe("Stated by the organizer — source: Not recorded");
  });
  it("retains details for skipped steps", () => {
    expect(values({ ...step, skipped: true, relation: "Already evidenced", evidence_needed: "project" })["Why this step"]).toBe("Already evidenced");
  });
});

describe("map view precedence", () => {
  it("uses either explicit map URL preference before the saved value", () => {
    expect(resolveViewPreference("/map", "?view=classic", "adventure")).toBe("classic");
    expect(resolveViewPreference("/map", "?view=adventure", "classic")).toBe("adventure");
  });
  it("ignores malformed overrides and leaves other pages on the saved preference", () => {
    expect(resolveViewPreference("/map", "?view=garbage", "classic")).toBe("classic");
    expect(resolveViewPreference("/passport", "?view=classic", "adventure")).toBe("adventure");
  });
});
