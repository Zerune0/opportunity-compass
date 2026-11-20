import { StatusTag } from "../../../components/rpg";
import type { MatchExplanation, MatchReason } from "../../../lib/types";

const reasonLabels: Record<string, string> = {
  interest: "Interest", eligibility: "Eligibility", reachability: "Reachability", format: "Format",
  time: "Time", cost: "Cost", device: "Equipment", transport: "Transportation",
};

function reasonTone(positive: MatchReason["positive"]) {
  if (positive === true) return { tone: "success" as const, label: "Works for you" };
  if (positive === false) return { tone: "danger" as const, label: "A problem" };
  return { tone: "warning" as const, label: "Not enough information" };
}

export function MatchExplanationSection({ match }: { match: MatchExplanation }) {
  return (
    <section className="rpg-card" aria-labelledby="match-heading">
      <h2 id="match-heading">Why this fits / doesn&apos;t fit</h2>
      <p>{match.summary}</p>
      {match.reasons.length > 0 && (
        <ul className="rpg-list">
          {match.reasons.map((reason, index) => {
            const { tone, label } = reasonTone(reason.positive);
            return (
              <li key={`${reason.kind}-${index}`} className="rpg-stack">
                <h3 className="rpg-row">
                  <span>{reasonLabels[reason.kind] ?? String(reason.kind)}</span>
                  <StatusTag tone={tone}>{label}</StatusTag>
                </h3>
                <p>{reason.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
