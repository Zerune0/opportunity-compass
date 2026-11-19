import type { Opportunity } from "../../lib/types";
import type { BoardFilters } from "./board-model";

const queryKeys = ["q", "category", "field", "country", "state", "hours", "grade", "remote", "free", "savedOnly", "maxFee", "closingSoon"] as const;
const booleanKeys = new Set(["remote", "free", "savedOnly", "closingSoon"]);
const validNumber = (value: string) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
function dateNumber(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const time = Date.parse(value + "T00:00:00Z");
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : NaN;
}
/** Only discovery filters; shared engines still decide eligibility and reachability. */
export function matchesDiscovery(opportunity: Pick<Opportunity, "title" | "organizer" | "fields" | "summary" | "deadline" | "cost">, filters: Pick<BoardFilters, "q" | "maxFee" | "closingSoon">, today: string) {
    const query = filters.q.trim().toLowerCase();
    if (query && ![opportunity.title, opportunity.organizer, opportunity.summary, ...opportunity.fields, ...opportunity.fields.map(field => field.replaceAll("_", " "))].some(text => text.toLowerCase().includes(query))) return false;
    if (validNumber(filters.maxFee) && (opportunity.cost.fee_usd == null || opportunity.cost.fee_usd > Number(filters.maxFee))) return false;
    if (filters.closingSoon) {
        const start = dateNumber(today);
        const deadline = opportunity.deadline ? dateNumber(opportunity.deadline) : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(deadline) || deadline < start || deadline > start + 30 * 86400000) return false;
    }
    return true;
}
/** Parse only owned query parameters; malformed numeric values do not activate filters. */
export function readBoardQuery(search: string, defaults: BoardFilters) {
    const params = new URLSearchParams(search);
    const filters = { ...defaults };
    for (const key of queryKeys) {
        if (booleanKeys.has(key)) continue;
        const value = params.get(key);
        if (value !== null) Object.assign(filters, { [key]: value });
    }
    for (const key of ["remote", "free", "savedOnly", "closingSoon"] as const) filters[key] = params.get(key) === "1";
    for (const key of ["hours", "maxFee"] as const) if (!validNumber(filters[key])) filters[key] = "";
    if (!/^(9|1[0-7])$/.test(filters.grade)) filters.grade = "";
    return { filters, sort: params.get("sort") === "match" ? "match" : "deadline" };
}
/** Preserve unrelated parameters; reset removes every board-owned parameter. */
export function writeBoardQuery(search: string, filters: BoardFilters, sort: string) {
    const params = new URLSearchParams(search);
    for (const key of queryKeys) {
        params.delete(key);
        const value = filters[key];
        if (value !== "" && value !== false) params.set(key, value === true ? "1" : String(value));
    }
    params.delete("sort");
    if (sort === "match") params.set("sort", sort);
    return params.toString();
}
