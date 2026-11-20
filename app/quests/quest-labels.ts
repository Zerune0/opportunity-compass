import type { Opportunity } from "../../lib/types";

/** Display text shared by the Quest Board cards (Adventure) and table (Classic), so both views say the same thing. */
export const categories: Record<Opportunity["category"], string> = { research: "Research", scholarship: "Scholarship", hackathon: "Hackathon", competition: "Competition", internship: "Internship", fellowship: "Fellowship", summer_program: "Summer program", public_service: "Public service", project: "Project", other: "Other" };
export const formats: Record<Opportunity["location"]["format"], string> = { online: "Online", hybrid: "Hybrid", in_person: "In person", unknown: "Format unknown" };

export function deadlineText(o: Opportunity): string {
    return o.deadline ?? "Unknown, confirm with the organizer";
}
export function locationText(o: Opportunity): string {
    return [o.location.city, o.location.state, o.location.country].filter(Boolean).join(", ") || (o.location.format === "online" ? "Online" : o.location.format === "unknown" ? "Format unknown — confirm with the organizer" : "Unknown, confirm with the organizer");
}
export function hoursText(o: Opportunity): string {
    return o.time_commitment.hours_per_week == null ? "Weekly hours unknown" : `${o.time_commitment.hours_per_week} h/week`;
}
export function durationText(o: Opportunity): string {
    return o.time_commitment.total_weeks == null ? "duration unknown" : `${o.time_commitment.total_weeks} ${o.time_commitment.total_weeks === 1 ? "week" : "weeks"}`;
}
export function feeText(o: Opportunity): string {
    return o.cost.fee_usd == null ? "Unknown, confirm with the organizer" : o.cost.fee_usd === 0 ? "Free" : `$${o.cost.fee_usd}`;
}
export function verifiedLabel(o: Opportunity): string {
    return o.source_tier === "user_posted" ? "Sample record date" : "Verified";
}
/** User-posted and sample opportunities have no official page to link to. */
export function showsOfficialLink(o: Opportunity): boolean {
    return o.source_tier !== "user_posted" && !o.is_sample;
}
