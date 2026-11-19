"use client";
import { useMemo } from "react";
import Link from "next/link";
import { analyzeReachability } from "../../lib/reachability";
import type { BarrierType, OverallEligibility } from "../../lib/types";
import type { QuestContext } from "./use-quest-context";
import { comparisonFacts, savedComparisonOpportunities } from "./saved-comparison-model";

const eligibilityLabels: Record<OverallEligibility, string> = {
    eligible: "Recorded rules satisfied", not_eligible: "Hard requirement not met", unknown: "Unconfirmed",
};
const barrierLabels: Record<BarrierType, string> = {
    time: "Time", cost: "Cost", transport: "Transportation", device: "Equipment",
};
export function SavedComparison({ context, enabled }: {
    context: Pick<QuestContext, "catalog" | "saved" | "profile" | "grants" | "today">;
    enabled: boolean;
}) {
    const { catalog, saved, profile, grants, today } = context;
    const selected = useMemo(() => savedComparisonOpportunities(catalog, saved), [catalog, saved]);
    const rows = useMemo(() => {
        if (!enabled || selected.length < 2) return [];
        return selected.map(opportunity => ({
            opportunity,
            facts: comparisonFacts(opportunity),
            reach: profile ? analyzeReachability(profile, opportunity, grants.filter(grant =>
                grant.student_id === profile.id && (grant.opportunity_id === null || grant.opportunity_id === opportunity.id),
            ), { today }) : null,
        }));
    }, [enabled, selected, profile, grants, today]);
    if (!enabled || selected.length < 2) return null;
    return <details className="rpg-card" style={{ minWidth: 0 }}>
        <summary>Compare saved opportunities ({selected.length})</summary>
        <p>This comparison does not rank opportunities or estimate admission chances. Reachability does not guarantee admission.</p>
        <p>Includes all saved catalog entries, including entries hidden by the current filters. Order follows your saved list. Fees exclude travel and accommodation.</p>
        {profile?.is_sample && <p className="rpg-tag rpg-tag--warning">Sample student profile</p>}
        <p>On a small screen, scroll the table horizontally to view all columns.</p>
        <div role="region" aria-label="Saved opportunity comparison table" tabIndex={0} style={{ overflowX: "auto", maxWidth: "100%" }}>
            <table style={{ width: "100%", minWidth: "60rem" }}>
                <caption>Saved opportunities comparison</caption>
                <thead><tr>
                    <th scope="col">Opportunity</th><th scope="col">Deadline</th><th scope="col">Format</th>
                    <th scope="col">Location</th><th scope="col">Program or application fee</th><th scope="col">Weekly hours</th>
                    <th scope="col">Eligibility check</th><th scope="col">Practical reachability</th><th scope="col">Barrier types</th>
                </tr></thead>
                <tbody>{rows.map(({ opportunity, facts, reach }) => <tr key={opportunity.id}>
                    <th scope="row">{opportunity.source_tier === "user_posted" ? opportunity.title : <Link href={`/quests/${encodeURIComponent(opportunity.id)}`}>{opportunity.title}</Link>}
                        {opportunity.source_tier === "user_posted" ? <p>User-posted · unverified · Sample</p> : opportunity.is_sample && <p>Sample opportunity</p>}
                    </th>
                    <td>{facts.deadline}{opportunity.deadline_note && <p>{opportunity.deadline_note}</p>}</td>
                    <td>{facts.format}</td><td>{facts.location}</td>
                    <td>{facts.fee}<p>{facts.travel}</p>{opportunity.cost.note && <p>{opportunity.cost.note}</p>}</td>
                    <td>{facts.hours}</td>
                    <td>{!reach ? "Not assessed — no profile loaded" : !opportunity.requirements.length ? "Unconfirmed — no official requirements recorded" : eligibilityLabels[reach.eligibility.overall]}</td>
                    <td>{!reach ? "Not assessed — no profile loaded" : reach.reachable === true ? "Practically reachable" : reach.reachable === false ? "Open barriers or unmet eligibility" : "Unconfirmed"}
                        {reach && reach.missing_info.length > 0 && <p>Some participation details remain unconfirmed.</p>}
                        {reach && grants.some(grant => grant.is_sample && reach.applied_grant_ids.includes(grant.id)) && <p>Simulated support</p>}
                    </td>
                    <td>{!reach ? "Not assessed" : reach.barriers.length ? <ul>{reach.barriers.map((barrier, index) =>
                        <li key={`${barrier.type}-${index}`}>{barrierLabels[barrier.type]}: {barrier.resolved ? "support applied" : "open"}</li>,
                    )}</ul> : "No recorded barriers"}</td>
                </tr>)}</tbody>
            </table>
        </div>
    </details>;
}
