import { describe, expect, it } from "vitest";
import { missingInfoLabel } from "./missing-info";
const opportunities = [{ id: "sample.one", title: "Sample opportunity" }];
describe("Journal missing information labels", () => {
  it("names the opportunity and its missing deadline without exposing the path", () => {
    expect(missingInfoLabel("opportunity.sample.one.deadline", opportunities)).toBe("Sample opportunity: Application deadline — check the official page");
  });
  it("gives an action for missing profile hours and planning date", () => {
    expect(missingInfoLabel("profile.hours_per_week_available", [])).toContain("Skill Passport");
    expect(missingInfoLabel("options.today", [])).toContain("Planning date");
  });
  it("hides unknown field paths and removed opportunity IDs", () => {
    expect(missingInfoLabel("opportunity.sample.one.future_field", opportunities)).not.toContain("future_field");
    expect(missingInfoLabel("opportunity.removed.deadline", [])).not.toContain("removed");
    expect(missingInfoLabel("profile.new_field", [])).not.toContain("new_field");
  });
  it("labels the deadline-day closing time without exposing the path", () => {
    expect(missingInfoLabel("opportunity.sample.one.deadline.closing_time", opportunities)).toBe("Sample opportunity: Exact closing time on the deadline day");
    expect(missingInfoLabel("opportunity.deadline.closing_time", [])).toBe("Exact closing time on the deadline day — check the official page");
  });
  it("retains existing human-readable messages", () => {
    expect(missingInfoLabel("Confirm the program dates", [])).toBe("Confirm the program dates");
  });
});
