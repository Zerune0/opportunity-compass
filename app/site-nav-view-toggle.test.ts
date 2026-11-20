/**
 * The Adventure / Classic toggle in the site nav: shown only on pages it changes, with a line saying what changes.
 * (Lives under app/ because vitest only collects app/** and lib/** tests.)
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

let currentPath = "/";
vi.mock("next/navigation", () => ({ usePathname: () => currentPath }));

import { SiteNav } from "@/components/rpg/SiteNav";
import { viewToggleApplies, viewToggleHint } from "@/components/rpg/view-preference";

beforeAll(() => vi.stubGlobal("React", React));
afterAll(() => vi.unstubAllGlobals());

const items = [{ href: "/quests", label: "Quest Board" }, { href: "/organizer", label: "Organizer" }];
function renderAt(path: string): string {
  currentPath = path;
  return renderToStaticMarkup(React.createElement(SiteNav, { items }));
}

describe("viewToggleApplies", () => {
  it.each(["/map", "/journal", "/passport", "/map/anything", "/passport/x"])("is true on %s", (path) => {
    expect(viewToggleApplies(path)).toBe(true);
  });
  it.each(["/", "", "/quests", "/quests/some-id", "/organizer", "/connect", "/data", "/mapping", "/journals"])(
    "is false on %s",
    (path) => {
      expect(viewToggleApplies(path)).toBe(false);
    },
  );
});

describe("viewToggleHint", () => {
  it("names what changes on each page, linking to sections further down", () => {
    expect(viewToggleHint("/map")).toEqual({ text: "Changes how routes and steps are shown below." });
    expect(viewToggleHint("/journal")?.href).toBe("#journal-quests");
    expect(viewToggleHint("/journal")?.text).toBe('Changes how your quests are shown in "My quests".');
    expect(viewToggleHint("/passport")?.href).toBe("#saved-evidence");
    expect(viewToggleHint("/organizer")).toBeNull();
  });
});

describe("SiteNav view toggle", () => {
  beforeEach(() => {
    currentPath = "/";
  });

  it("does not render the toggle on /organizer", () => {
    const html = renderAt("/organizer");
    expect(html).toContain("Organizer");
    expect(html).not.toContain("View preference");
    expect(html).not.toContain("Adventure View");
    expect(html).not.toContain("Classic View");
    expect(html).not.toContain('role="status"');
  });

  it("does not render the toggle on the home page or the Quest Board", () => {
    expect(renderAt("/")).not.toContain("Adventure View");
    expect(renderAt("/quests")).not.toContain("Adventure View");
    expect(renderAt("/quests/some-id")).not.toContain("Adventure View");
  });

  it("renders the toggle on /journal with the explanation, the in-page link and a status region", () => {
    const html = renderAt("/journal");
    expect(html).toContain('aria-label="View preference"');
    expect(html).toContain("Adventure View");
    expect(html).toContain("Classic View");
    expect(html).toContain("Changes how your quests are shown in &quot;My quests&quot;.");
    expect(html).toContain('href="#journal-quests"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("marks the pressed button with a check mark as well as aria-pressed", () => {
    const html = renderAt("/passport");
    // Before the stored preference is read the hook reports "adventure" (unchanged behaviour).
    expect(html).toMatch(/aria-pressed="true"[^>]*><span aria-hidden="true">✓ <\/span>Adventure View/);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Classic View/);
    expect(html).toContain('href="#saved-evidence"');
  });
});
