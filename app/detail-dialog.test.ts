/** The short-label + centered card used in Classic tables. (Lives under app/ because vitest only collects app/** and lib/**.) */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DetailDialog } from "@/components/rpg/DetailDialog";

describe("DetailDialog", () => {
  const html = renderToStaticMarkup(React.createElement(DetailDialog, { label: "Read why", title: "Learning first: why this route", children: React.createElement("p", null, "Long reason text") }));

  it("shows only the short label until opened", () => {
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(">Read why</button>");
    expect(html).toMatch(/<dialog(?![^>]*\bopen\b)[^>]*class="rpg-dialog"/);
  });

  it("names the card by its title and keeps the full text and a Close button inside it", () => {
    const id = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
    expect(html).toContain("Learning first: why this route");
    expect(html).toContain("<p>Long reason text</p>");
    expect(html).toContain(">Close</button>");
  });
});
