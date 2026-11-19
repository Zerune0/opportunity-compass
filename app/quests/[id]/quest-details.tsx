"use client";
import Link from "next/link";
import { sourceLabels, useQuestContext } from "../use-quest-context";
import { QuestAssessment } from "./quest-assessment";
export function QuestDetails({ id }: {
    id: string;
}) {
    const context = useQuestContext();
    const opportunity = context.catalog.find(o => o.id === id);
    if (!opportunity)
        return <div className="rpg-stack"><h1>{context.loaded ? "Opportunity not found" : "Loading opportunity"}</h1><p>{context.loaded ? "This opportunity may have been removed or may only exist in another browser's local demo." : "Checking this browser's local opportunities."}</p><Link href="/quests">Back to Quest Board</Link></div>;
    const posted = opportunity.source_tier === "user_posted";
    return <div className="rpg-stack rpg-stack--loose" style={{ minWidth: 0, overflowWrap: "anywhere" }}><p><Link href="/quests">Back to Quest Board</Link></p><header className="rpg-head crt">
 {posted ? <p className="rpg-tag rpg-tag--warning">User-posted · not verified against an official site · Sample</p> : opportunity.is_sample && <p className="rpg-tag rpg-tag--warning">Sample opportunity</p>}
 <h1>{opportunity.title}</h1><p>{opportunity.organizer}{[opportunity.location.city, opportunity.location.state, opportunity.location.country].filter(Boolean).length > 0 && `, ${[opportunity.location.city, opportunity.location.state, opportunity.location.country].filter(Boolean).join(", ")}`}</p><p>{opportunity.summary}</p>
 <dl><dt>Source</dt><dd>{sourceLabels[opportunity.source_tier ?? "official"]}</dd><dt>{posted ? "Sample record" : "Verified"}</dt><dd>{opportunity.verified_on} · {opportunity.verified_by}</dd><dt>Deadline</dt><dd>{opportunity.deadline ?? "Unknown, confirm with the organizer"}</dd><dt>Program fee</dt><dd>{opportunity.cost.fee_usd == null ? "Unknown, confirm with the organizer" : opportunity.cost.fee_usd === 0 ? "Free" : `${opportunity.cost.fee_usd}`}</dd><dt>Weekly hours</dt><dd>{opportunity.time_commitment.hours_per_week ?? "Unknown, confirm with the organizer"}</dd><dt>Duration in weeks</dt><dd>{opportunity.time_commitment.total_weeks ?? "Unknown, confirm with the organizer"}</dd><dt>Self-funded travel</dt><dd>{opportunity.cost.requires_travel_expense == null ? "Unknown, confirm with the organizer" : opportunity.cost.requires_travel_expense ? "Required" : "Not required"}</dd></dl>
 {opportunity.deadline_note && <p>{opportunity.deadline_note}</p>}
 {!posted && !opportunity.is_sample && <a className="rpg-button rpg-button--primary" href={opportunity.official_url}>Apply on the official site</a>}
 {posted && <p>This is a local demonstration. There is no real publisher or contact taking place.</p>}
 </header><QuestAssessment opportunity={opportunity} context={context}/></div>;
}
