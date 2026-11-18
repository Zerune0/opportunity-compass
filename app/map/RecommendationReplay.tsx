import { QuestCard } from "@/components/rpg";
import type { PlanResult } from "@/lib/types";

function RouteSummary({ plan }: { plan: PlanResult }) {
  if (plan.status === "blocked") return <p>No routes available.</p>;
  return (
    <ul className="rpg-list">
      {plan.routes.map((route) => (
        <li key={route.id}>{route.title} · {route.total_hours} h</li>
      ))}
    </ul>
  );
}

export function RecommendationReplay({ before, updated, change, reasons, note }: {
  before: PlanResult;
  updated: PlanResult;
  change: string;
  reasons: readonly string[];
  note?: string;
}) {
  return (
    <QuestCard>
      <h2>Recommendation replay</h2>
      {note && <p className="rpg-muted">{note}</p>}
      <h3>Before</h3>
      <RouteSummary plan={before} />
      <h3>What changed</h3>
      <p>{change}</p>
      <h3>Updated path</h3>
      <RouteSummary plan={updated} />
      <h3>Why</h3>
      <ul className="rpg-list">
        {reasons.map((reason, index) => <li key={index}>{reason}</li>)}
      </ul>
    </QuestCard>
  );
}
