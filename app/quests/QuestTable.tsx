"use client";
import Link from "next/link";
import type { OverallEligibility, Opportunity } from "../../lib/types";
import { localRecordTag, sourceLabelFor } from "../../lib/sample-origin";
import type { BoardExplanations } from "./board-model";
import { categories, deadlineText, durationText, feeText, formats, hoursText, locationText, showsOfficialLink, verifiedLabel } from "./quest-labels";
import { sourceLabels } from "./use-quest-context";
import { VerificationAge } from "./verification-age-badge";

const eligibilityLabels: Record<OverallEligibility, string> = { eligible: "Eligible", not_eligible: "Not eligible", unknown: "Unknown" };
function reachabilityLabel(reachable: boolean | null | undefined): string {
    return reachable === true ? "Reachable (not a guarantee of admission)" : reachable === false ? "Not reachable yet" : "Unknown";
}

export type QuestTableProps = {
    /** Already filtered and ordered, exactly as the card list gets them. */
    items: Opportunity[];
    /** The same explainCatalog() result the cards use; never recomputed here. */
    explanations: BoardExplanations;
    hasProfile: boolean;
    /** Whether the cards would show matching reasons (sort by match). */
    showReasons: boolean;
    saved: string[];
    loaded: boolean;
    today: string;
    onToggleSaved: (id: string) => void;
};

/** Classic View of the Quest Board: one row per opportunity, with everything the Adventure cards show. */
export function QuestTable({ items, explanations, hasProfile, showReasons, saved, loaded, today, onToggleSaved }: QuestTableProps) {
    if (!items.length) return null;
    return <table className="rpg-classic-table">
        <caption>Opportunities, in the current order</caption>
        <thead><tr>
            <th scope="col">Opportunity</th><th scope="col">Type</th><th scope="col">Format &amp; location</th><th scope="col">Deadline</th>
            <th scope="col">Fee</th><th scope="col">Weekly hours</th><th scope="col">Source</th>
            {hasProfile && <><th scope="col">Eligibility</th><th scope="col">Reachability</th></>}
            <th scope="col">Saved</th>
        </tr></thead>
        <tbody>{items.map(o => {
            const explanation = explanations.get(o.id);
            const isSaved = saved.includes(o.id);
            return <tr key={o.id}>
                <th scope="row">
                    <Link href={`/quests/${encodeURIComponent(o.id)}`}>{o.title}</Link>
                    <p className="rpg-small rpg-muted">{o.organizer}</p>
                    {o.source_tier === "user_posted" ? <p className="rpg-tag rpg-tag--warning">{localRecordTag(o)}</p> : o.is_sample && <p className="rpg-tag rpg-tag--warning">Sample opportunity</p>}
                    <p className="rpg-small" style={{ fontWeight: "normal" }}>{o.summary}</p>
                    {showReasons && explanation?.reasons.map(r => <p key={r.kind} className="rpg-small" style={{ fontWeight: "normal" }}>{r.text}</p>)}
                </th>
                <td data-label="Type">{categories[o.category]}</td>
                <td data-label="Format & location">{formats[o.location.format]}; {locationText(o)}</td>
                <td data-label="Deadline">{deadlineText(o)}</td>
                <td data-label="Fee">{feeText(o)}</td>
                <td data-label="Weekly hours">{hoursText(o)}; {durationText(o)}</td>
                <td data-label="Source">
                    {sourceLabelFor(o, sourceLabels[o.source_tier ?? "official"])}
                    <span style={{ display: "block" }}>{verifiedLabel(o)}: {o.verified_on}</span>
                    <VerificationAge opportunity={o} today={today} />
                    {showsOfficialLink(o) && <a href={o.official_url}>Official application</a>}
                </td>
                {hasProfile && <>
                    <td data-label="Eligibility">{explanation ? eligibilityLabels[explanation.eligibility_overall] ?? "Unknown" : "Unknown"}</td>
                    <td data-label="Reachability">{reachabilityLabel(explanation?.reachable)}</td>
                </>}
                <td data-label="Saved">
                    <button type="button" className="rpg-button rpg-button--secondary" disabled={!loaded} aria-pressed={isSaved} aria-label={`${isSaved ? "Unsave" : "Save"} ${o.title}`} onClick={() => onToggleSaved(o.id)}>{isSaved ? "Saved" : "Save opportunity"}</button>
                </td>
            </tr>;
        })}</tbody>
    </table>;
}
