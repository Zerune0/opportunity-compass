import type { Opportunity } from "../../lib/types";

/** Saved order is the user's order; filters and recommendation scores do not reorder it. */
export function savedComparisonOpportunities(catalog: readonly Opportunity[], saved: readonly string[]) {
    const byId = new Map(catalog.map(opportunity => [opportunity.id, opportunity]));
    return [...new Set(saved)].flatMap(id => {
        const opportunity = byId.get(id);
        return opportunity ? [opportunity] : [];
    });
}
const formats: Record<Opportunity["location"]["format"], string> = {
    online: "Online", in_person: "In person", hybrid: "Hybrid", unknown: "Unconfirmed",
};
/** Display recorded facts only; unknown cost/hours never become zero. */
export function comparisonFacts(opportunity: Opportunity) {
    return {
        deadline: opportunity.deadline ?? "Unknown",
        format: formats[opportunity.location.format],
        location: [opportunity.location.city, opportunity.location.state, opportunity.location.country].filter(Boolean).join(", ") || (opportunity.location.format === "online" ? "Online" : "Unknown"),
        fee: opportunity.cost.fee_usd == null ? "Unknown" : `$${opportunity.cost.fee_usd}`,
        hours: opportunity.time_commitment.hours_per_week == null ? "Unknown" : `${opportunity.time_commitment.hours_per_week} h/week`,
        travel: opportunity.cost.requires_travel_expense === true ? "Participant-paid travel" : opportunity.cost.requires_travel_expense === false ? "No participant-paid travel recorded" : "Travel costs unconfirmed",
    };
}
