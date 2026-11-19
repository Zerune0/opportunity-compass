import { describe, expect, it } from "vitest";
import { alternativeQuestHref } from "./alternative-links";
const catalog = [{ id: "target" }, { id: "another online" }];

describe("alternative quest links", () => {
  it("keeps a hybrid remote hint about the current quest as plain text", () => {
    expect(alternativeQuestHref("remote_option", "target", "target", catalog)).toBeNull();
  });
  it("still links a different verified online opportunity", () => {
    expect(alternativeQuestHref("remote_option", "another online", "target", catalog)).toBe("/quests/another%20online");
  });
  it("links verified stepping stones, but never unknown catalog IDs or future cycles", () => {
    expect(alternativeQuestHref("stepping_stone", "another online", "target", catalog)).toBe("/quests/another%20online");
    expect(alternativeQuestHref("same_field", "missing", "target", catalog)).toBeNull();
    expect(alternativeQuestHref("remote_option", null, "target", catalog)).toBeNull();
    expect(alternativeQuestHref("next_cycle", "target", "target", catalog)).toBeNull();
  });
});
