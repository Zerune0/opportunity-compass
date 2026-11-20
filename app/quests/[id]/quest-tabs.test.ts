import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QuestTabs, tabFromSearch } from "./quest-tabs";

describe("quest details tabs", () => {
  const ids = ["eligibility", "fit", "ask"];
  it("reads ?tab= and falls back to the first tab", () => {
    expect(tabFromSearch("", ids)).toBe("eligibility");
    expect(tabFromSearch("?tab=fit", ids)).toBe("fit");
    expect(tabFromSearch("?tab=nope", ids)).toBe("eligibility");
  });

  it("renders every panel (inactive ones hidden on screen but printed) with tab roles", () => {
    const html = renderToStaticMarkup(React.createElement(QuestTabs, { tabs: [
      { id: "eligibility", label: "Eligibility & reach", content: React.createElement("p", null, "first") },
      { id: "fit", label: "Fit & gaps", badge: "3 gaps", content: React.createElement("p", null, "second") },
    ] }));
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("<p>first</p>");
    expect(html).toContain("<p>second</p>");
    expect(html).toContain("hidden print:block");
    expect(html).toContain("3 gaps");
  });
});
