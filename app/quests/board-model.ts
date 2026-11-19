import { checkEligibility } from "../../lib/eligibility";
import { explainMatch } from "../../lib/match";
import { normalizeTag } from "../../lib/tags";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../lib/types";
export type BoardFilters = {
    category: string;
    field: string;
    country: string;
    state: string;
    hours: string;
    grade: string;
    remote: boolean;
    free: boolean;
    savedOnly: boolean;
};
export const emptyFilters: BoardFilters = { category: "", field: "", country: "", state: "", hours: "", grade: "", remote: false, free: false, savedOnly: false };
export function filterCatalog(catalog: Opportunity[], f: BoardFilters, saved: string[]) {
    return catalog.filter(o => {
        if (f.category && o.category !== f.category)
            return false;
        if (f.field && !o.fields.some(t => normalizeTag(t) === f.field))
            return false;
        if (f.country && o.location.country !== f.country)
            return false;
        if (f.state && o.location.state !== f.state)
            return false;
        // 「Online or hybrid」只放行明确的 online / hybrid；参与形式未知（unknown）不算线上，排除。
        if (f.remote && o.location.format !== "online" && o.location.format !== "hybrid")
            return false;
        if (f.free && (o.cost.fee_usd !== 0 || o.cost.requires_travel_expense !== false))
            return false;
        if (f.hours && (o.time_commitment.hours_per_week == null || o.time_commitment.hours_per_week > Number(f.hours)))
            return false;
        if (f.savedOnly && !saved.includes(o.id))
            return false;
        if (f.grade) {
            const profile: StudentProfile = { id: "grade-filter", is_sample: true, display_name: "Grade filter", grade: Number(f.grade), evidence: [] };
            if (checkEligibility(profile, { ...o, deadline: null, requirements: o.requirements.filter(r => r.type === "grade") }).overall === "not_eligible")
                return false;
        }
        return true;
    });
}
export function orderedCatalog(catalog: Opportunity[], sort: string, profile: StudentProfile | null, grants: ResourceGrant[], today: string) {
    const explanations = new Map(catalog.map(o => [o.id, profile ? explainMatch(profile, o, { today, grants }) : null]));
    const items = [...catalog].sort((a, b) => {
        const tier = Number(a.source_tier === "user_posted") - Number(b.source_tier === "user_posted");
        if (tier)
            return tier;
        if (sort === "match" && profile) {
            const interest = Number(!!explanations.get(b.id)?.shared_interests.length) - Number(!!explanations.get(a.id)?.shared_interests.length);
            if (interest)
                return interest;
        }
        return (a.deadline ?? "9999-12-31").localeCompare(b.deadline ?? "9999-12-31") || a.title.localeCompare(b.title);
    });
    return { items, explanations };
}
