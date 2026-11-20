import { describe, expect, it } from "vitest";
import { catalogOpportunities } from "@/lib/data";
import { planRoutes } from "@/lib/path";
import { demoMapOpportunityId, demoMapProfile, mapHref } from "./SampleMapStart";

describe("Adventure Map demo entry", () => {
  it("uses a sample profile that is labelled as a sample", () => {
    const profile = demoMapProfile();
    expect(profile).not.toBeNull();
    expect(profile?.is_sample).toBe(true);
  });

  it("pairs it with the labelled sample opportunity that has routes to show", () => {
    const catalog = catalogOpportunities();
    const opportunity = catalog.find((o) => o.id === demoMapOpportunityId);
    expect(opportunity).toBeDefined();
    expect(opportunity?.is_sample).toBe(true);
    const plan = planRoutes(demoMapProfile()!, opportunity!, { today: "2026-11-20", catalog });
    expect(plan.status).toBe("routes");
    if (plan.status === "routes") expect(plan.routes.length).toBeGreaterThanOrEqual(2);
  });

  it("builds an encoded map link", () => {
    expect(mapHref("a b")).toBe("/map?opp=a%20b");
  });
});
