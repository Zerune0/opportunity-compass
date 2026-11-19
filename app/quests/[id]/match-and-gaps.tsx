import { StatusTag } from "../../../components/rpg";
import type { GapAnalysis, GapCategory, GapItem, MatchExplanation, MatchReason } from "../../../lib/types";
import { GAP_CATEGORIES } from "../../../lib/types";

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

const gapTitles: Record<GapCategory, string> = {
  knowledge_or_experience: "Knowledge or experience",
  materials: "Materials",
  time_and_cost: "Time and cost",
  unchangeable_eligibility: "Eligibility you can't change right now",
  unknown_info: "Information we don't have",
};

const barrierNames: Record<string, string> = {
  time: "Time", cost: "Cost", transport: "Transportation", device: "Equipment",
};

function GapBasisNote({ item }: { item: GapItem }) {
  const basis = item.basis;
  if (basis.kind === "requirement" || basis.kind === "prep_item") {
    if (!basis.source_text) return null;
    return (
      <>
        <p className="rpg-muted rpg-small">{basis.kind === "requirement" ? "Official wording:" : "Source:"}</p>
        <blockquote className="my-2 border-l-2 pl-3">{basis.source_text}</blockquote>
      </>
    );
  }
  if (basis.kind === "barrier") {
    return <p className="rpg-muted rpg-small">Based on: practical reachability check ({barrierNames[basis.barrier_type] ?? basis.barrier_type})</p>;
  }
  return null;
}

function GapEntry({ item }: { item: GapItem }) {
  const estimates = [
    typeof item.estimated_hours === "number" ? `${item.estimated_hours} h` : null,
    typeof item.estimated_cost_usd === "number" ? `$${item.estimated_cost_usd}` : null,
  ].filter(Boolean);
  return (
    <li className="rpg-stack">
      <h4><strong>{item.title}</strong></h4>
      <p>{item.detail}</p>
      <GapBasisNote item={item} />
      {estimates.length > 0 && <p className="rpg-muted rpg-small">Estimated {estimates.join(" and ")}</p>}
      {item.category === "unchangeable_eligibility" ? (
        <p>There is no workaround for this. We won&apos;t suggest one.</p>
      ) : item.action ? (
        <p>What you can do: {item.action}</p>
      ) : null}
    </li>
  );
}

export function GapAnalysisSection({ gaps }: { gaps: GapAnalysis }) {
  return (
    <section className="rpg-card" aria-labelledby="gaps-heading">
      <h2 id="gaps-heading">Your gaps, in five groups</h2>
      <p>{gaps.summary}</p>
      {GAP_CATEGORIES.map((category) => {
        const items = gaps.items.filter((item) => item.category === category);
        return (
          <div key={category} className="rpg-stack">
            <h3 className="rpg-row">
              <span>{gapTitles[category]}</span>
              <StatusTag>{items.length} {items.length === 1 ? "item" : "items"}</StatusTag>
            </h3>
            {items.length === 0 ? <p className="rpg-muted">Nothing in this group.</p> : (
              <ul className="rpg-list">
                {items.map((item) => <GapEntry key={item.id} item={item} />)}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
