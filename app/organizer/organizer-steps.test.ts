import { describe, expect, it } from "vitest";
import { ORGANIZER_STEPS, stepFromSearch } from "./what-if";

describe("organizer what-if steps", () => {
  it("reads the step from ?step= and falls back to settings", () => {
    expect(stepFromSearch("")).toBe(1);
    expect(stepFromSearch("?step=2")).toBe(2);
    expect(stepFromSearch("?step=3&x=1")).toBe(3);
    expect(stepFromSearch("?step=9")).toBe(1);
    expect(stepFromSearch("?step=results")).toBe(1);
  });

  it("has settings, results, then compare and apply", () => {
    expect(ORGANIZER_STEPS.map((s) => s.label)).toEqual(["Settings", "Results", "Compare and apply"]);
  });
});
