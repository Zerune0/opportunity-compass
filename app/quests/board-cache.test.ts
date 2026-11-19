import { describe, expect, it, vi } from "vitest";
import data from "../../data/opportunities.json";
import profiles from "../../data/profiles.json";
import * as matchEngine from "../../lib/match";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../lib/types";
import { emptyFilters, explainCatalog, filterCatalog, orderedCatalog, orderPreparedCatalog } from "./board-model";

const catalog = data as Opportunity[];
const profile = profiles.find(value => value.id === "sample-noor") as StudentProfile;
const today = "2026-11-19";
const saved = catalog.slice(0, 2).map(value => value.id);
const filters = [
    emptyFilters, { ...emptyFilters, remote: true }, { ...emptyFilters, free: true },
    { ...emptyFilters, savedOnly: true }, { ...emptyFilters, hours: "10" }, { ...emptyFilters, grade: "13" },
];

describe("prepared board explanations", () => {
    it("reuses one explanation per catalog entry across filter and sort changes", () => {
        const spy = vi.spyOn(matchEngine, "explainMatch");
        try {
            const prepared = explainCatalog(catalog, profile, [], today);
            expect(spy).toHaveBeenCalledTimes(catalog.length);
            for (const filter of filters) for (const sort of ["deadline", "match"]) {
                orderPreparedCatalog(filterCatalog(catalog, filter, saved), sort, true, prepared);
            }
            expect(spy).toHaveBeenCalledTimes(catalog.length);
        } finally { spy.mockRestore(); }
    });
    it("preserves ordering and the complete shared-engine explanation for every visible item", () => {
        const prepared = explainCatalog(catalog, profile, [], today);
        for (const filter of filters) for (const sort of ["deadline", "match"]) {
            const selected = filterCatalog(catalog, filter, saved);
            const previous = orderedCatalog(selected, sort, profile, [], today);
            const actual = orderPreparedCatalog(selected, sort, true, prepared);
            expect(actual.map(value => ({ id: value.id, explanation: prepared.get(value.id) }))).toEqual(
                previous.items.map(value => ({ id: value.id, explanation: previous.explanations.get(value.id) })),
            );
        }
    });
    it("creates fresh explanations for changed profile, resource and date contexts", () => {
        const spy = vi.spyOn(matchEngine, "explainMatch");
        const grant: ResourceGrant = { id: "sample-cache-grant", student_id: profile.id, opportunity_id: catalog[0].id, type: "fee_waiver", status: "approved", amount_usd: 10, provider: "Sample provider", is_sample: true };
        try {
            const initial = explainCatalog(catalog, profile, [], today);
            const changedProfile = { ...profile, interests: ["open_source"] };
            const nextProfile = explainCatalog(catalog, changedProfile, [], today);
            const nextResources = explainCatalog(catalog, changedProfile, [grant], today);
            const nextDate = explainCatalog(catalog, changedProfile, [grant], "2026-11-20");
            expect(spy).toHaveBeenCalledTimes(catalog.length * 4);
            expect(nextProfile).not.toBe(initial);
            expect(nextResources).not.toBe(nextProfile);
            expect(nextDate).not.toBe(nextResources);
            expect(spy).toHaveBeenLastCalledWith(changedProfile, catalog[catalog.length - 1], { today: "2026-11-20", grants: [grant] });
        } finally { spy.mockRestore(); }
    });
    it("does not call matching without a profile and retains deadline ordering", () => {
        const spy = vi.spyOn(matchEngine, "explainMatch");
        try {
            const prepared = explainCatalog(catalog, null, [], today);
            expect(spy).not.toHaveBeenCalled();
            expect([...prepared.values()].every(value => value === null)).toBe(true);
            expect(orderPreparedCatalog(catalog, "match", false, prepared)).toEqual(
                orderedCatalog(catalog, "deadline", null, [], today).items,
            );
            expect(spy).not.toHaveBeenCalled();
        } finally { spy.mockRestore(); }
    });
    it("does not mutate the catalog, selected items or prepared map during sorting", () => {
        const prepared = explainCatalog(catalog, profile, [], today);
        const selected = filterCatalog(catalog, emptyFilters, saved);
        const beforeCatalog = catalog.map(value => value.id);
        const beforeSelected = selected.map(value => value.id);
        const beforePrepared = [...prepared.entries()];
        orderPreparedCatalog(selected, "match", true, prepared);
        expect(catalog.map(value => value.id)).toEqual(beforeCatalog);
        expect(selected.map(value => value.id)).toEqual(beforeSelected);
        expect([...prepared.entries()]).toEqual(beforePrepared);
    });
});
