import Link from "next/link";
import { notFound } from "next/navigation";
import opportunities from "../../../data/opportunities.json";
import type { Opportunity } from "../../../lib/types";
import { QuestAssessment } from "./quest-assessment";

const catalog = opportunities as Opportunity[];

export default async function QuestDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const opportunity = catalog.find((entry) => entry.id === id);
  if (!opportunity) notFound();

  const location = [opportunity.location.city, opportunity.location.state, opportunity.location.country]
    .filter(Boolean).join(", ");
  return (
    <div lang="en" className="rpg-stack rpg-stack--loose">
      <p><Link href="/quests">Back to Quest Board</Link></p>
      <header className="rpg-head crt">
        {opportunity.is_sample && <p><span className="rpg-tag rpg-tag--warning">Sample opportunity</span></p>}
        <h1>{opportunity.title}</h1>
        <p className="rpg-muted">{opportunity.organizer}{location && `, ${location}`}</p>
        <p>{opportunity.summary}</p>
        <dl>
          <dt>Deadline</dt>
          <dd>{opportunity.deadline ?? "unconfirmed"}{opportunity.deadline_note && <span className="rpg-muted"> ({opportunity.deadline_note})</span>}</dd>
        </dl>
        {!opportunity.is_sample && <a className="rpg-button rpg-button--primary" href={opportunity.official_url}>Apply on the official site</a>}
      </header>
      <QuestAssessment opportunity={opportunity} />
    </div>
  );
}
