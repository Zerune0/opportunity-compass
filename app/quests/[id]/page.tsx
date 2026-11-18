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
    <div lang="en" className="space-y-6">
      <Link className="underline" href="/quests">Back to Quest Board</Link>
      <header className="space-y-2">
        {opportunity.is_sample && <p className="font-semibold">Sample opportunity</p>}
        <h1 className="text-3xl font-bold">{opportunity.title}</h1>
        <p>{opportunity.organizer}{location && ` · ${location}`}</p>
        <p>{opportunity.summary}</p>
        <p>Deadline {opportunity.deadline ?? "unconfirmed"}{opportunity.deadline_note && ` · ${opportunity.deadline_note}`}</p>
      </header>
      {!opportunity.is_sample && <a className="font-semibold underline" href={opportunity.official_url}>Apply on the official site</a>}
      <QuestAssessment opportunity={opportunity} />
    </div>
  );
}
