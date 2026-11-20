import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CrossPlanItem, WeeklyLoad } from "@/lib/types";
import { PlanItemsTable, WeeklyLoadTable } from "./PlanTables";

const note = "Order 1 by deadline (deadline 2026-12-09). Hours are from the route used; a long explanation follows.";
const item = {
  order: 1, opportunity_id: "a", title: "Quest A", deadline: "2026-12-09", status: "planned", route_type: null,
  required_hours: 4, hours_before_reuse: 4, hours_saved_by_reuse: 0, feasible_alone: true, note,
} as unknown as CrossPlanItem;
const week = { week_start: "2026-11-16", days: 7, hours_needed: 3, hours_available: 4, over: false, opportunity_ids: ["a", "b", "c"] } as unknown as WeeklyLoad;

describe("Journal plan tables keep long text out of the cells on screen", () => {
  it("shows a short note label and keeps the full note for printing", () => {
    const html = renderToStaticMarkup(React.createElement(PlanItemsTable, { items: [item] }));
    expect(html).toContain(">Read note</button>");
    expect(html).toContain(`<span class="hidden print:inline">${note}</span>`);
  });

  it("counts the quests in a week and lists them in the card and in print", () => {
    const html = renderToStaticMarkup(React.createElement(WeeklyLoadTable, { weeks: [week], titleOf: (id: string) => `Quest ${id.toUpperCase()}` }));
    expect(html).toContain("3 quests");
    expect(html).toContain(">See which</button>");
    expect(html).toContain('<span class="hidden print:inline">Quest A; Quest B; Quest C</span>');
  });
});
