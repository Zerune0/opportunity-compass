import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import type { PlanSnapshot, RouteChange, RouteType } from "@/lib/types";
import { planChanged, safeDiff, triggerLabel } from "./plan-snapshots";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const ROUTE_TYPE_LABELS: Record<RouteType, string> = {
  learning_first: "Learning first",
  practice_first: "Practice first",
  community: "Community",
  competition: "Beginner competition",
};

function routeTypeLabel(type: unknown): string {
  if (typeof type !== "string") return "Route";
  return (ROUTE_TYPE_LABELS as Record<string, string>)[type] ?? "Route";
}

function yesNo(value: unknown): string {
  return value === true ? "Yes" : value === false ? "No" : "Unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hoursText(value: unknown): string {
  const hours = finiteNumber(value);
  return hours === null ? "Unknown" : `${hours} h`;
}

function costText(value: unknown): string {
  const cost = finiteNumber(value);
  return cost === null ? "Unknown" : money.format(cost);
}

/** Only strings from a stored list (snapshots in localStorage may be malformed). */
function textList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** Renders any stored plan shape without throwing; unreadable fields show as Unknown. */
function PlanSummary({ plan }: { plan: unknown }) {
  if (!isRecord(plan)) return <p>This stored plan could not be read.</p>;
  if (plan.status === "blocked") {
    const reasons = textList(plan.reasons);
    return (
      <>
        <p>Status: Blocked. No routes were generated.</p>
        {reasons.length > 0 && (
          <ul className="rpg-list">{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        )}
      </>
    );
  }
  const routes = (Array.isArray(plan.routes) ? plan.routes : []).filter(isRecord);
  return (
    <>
      <p>Status: Routes available.</p>
      {routes.length === 0 ? <p>No routes listed.</p> : (
        <ul className="rpg-list">
          {routes.map((route, index) => {
            const typeLabel = routeTypeLabel(route.type);
            const title = typeof route.title === "string" && route.title.trim() !== "" ? route.title : typeLabel;
            return (
              <li key={typeof route.id === "string" ? `${route.id}-${index}` : index}>
                <strong>{title}</strong>{title !== typeLabel && ` (${typeLabel})`} · {hoursText(route.total_hours)}
                {" · "}{costText(route.total_cost_usd)} · Fits deadline: {yesNo(route.feasible_by_deadline)}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function changeLine(change: RouteChange): string {
  const parts: string[] = [`${routeTypeLabel(change.route_type)} route: ${change.change}`];
  const before = finiteNumber(change.hours_before);
  const after = finiteNumber(change.hours_after);
  if (before !== null || after !== null) {
    parts.push(before === after
      ? `hours unchanged (${before} h)`
      : `hours ${before === null ? "none" : before} → ${after === null ? "none" : after}`);
  }
  const costDelta = finiteNumber(change.cost_delta_usd);
  if (costDelta) parts.push(`cost ${costDelta > 0 ? "+" : "−"}${money.format(Math.abs(costDelta))}`);
  // A route that was removed or added has no "before" or "after" of its own: say "none", not "Unknown".
  if (change.change === "removed") parts.push(`fits deadline ${yesNo(change.feasible_before)} → none`);
  else if (change.change === "added") parts.push(`fits deadline none → ${yesNo(change.feasible_after)}`);
  else if (change.feasible_before !== change.feasible_after) {
    parts.push(`fits deadline ${yesNo(change.feasible_before)} → ${yesNo(change.feasible_after)}`);
  }
  return parts.join(", ");
}

function ReplayStep({ before, after, open }: { before: PlanSnapshot; after: PlanSnapshot; open: boolean }) {
  const diff = safeDiff(before.plan, after.plan);
  const changed = diff ? planChanged(before.plan, after.plan, diff) : false;
  const details = (typeof after.trigger_detail === "string" ? after.trigger_detail : "").split("\n").filter((line) => line.trim() !== "");
  return (
    <details open={open}>
      <summary>
        {after.taken_on}: {triggerLabel(after.trigger)}{open ? " (latest)" : ""}
      </summary>
      <div className="rpg-stack">
        <h3>Before</h3>
        <p className="rpg-muted rpg-small">Planned on {before.taken_on}</p>
        <PlanSummary plan={before.plan} />
        <h3>What changed</h3>
        <p>{triggerLabel(after.trigger)}</p>
        {details.length > 0 && <ul className="rpg-list">{details.map((line, index) => <li key={index}>{line}</li>)}</ul>}
        <h3>After</h3>
        <p className="rpg-muted rpg-small">Planned on {after.taken_on}</p>
        <PlanSummary plan={after.plan} />
        <h3>Why</h3>
        {!diff ? <p>This comparison could not be computed from the stored plans.</p> : !changed ? (
          <p>The routes did not change.</p>
        ) : (
          <>
            {diff.status_change && <p>Status: {diff.status_change.from} → {diff.status_change.to}</p>}
            {diff.route_changes.some((change) => change.change !== "unchanged") && (
              <ul className="rpg-list">
                {diff.route_changes.filter((change) => change.change !== "unchanged").map((change) => (
                  <li key={change.route_type}>{changeLine(change)}</li>
                ))}
              </ul>
            )}
            <ul className="rpg-list">{diff.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          </>
        )}
      </div>
    </details>
  );
}

/** Timeline of stored plan snapshots for one (profile, opportunity), newest step first. */
export function RecommendationReplay({ snapshots, isSample, onClear }: {
  /** Oldest -> newest, as returned by the store. */
  snapshots: PlanSnapshot[];
  isSample: boolean;
  onClear: () => void;
}) {
  const steps = snapshots.slice(1).map((after, index) => ({ before: snapshots[index], after })).reverse();
  return (
    <QuestCard>
      <section className="rpg-stack" aria-labelledby="replay-heading">
        <h2 id="replay-heading">Recommendation replay</h2>
        {isSample && <p><StatusTag tone="warning">Sample</StatusTag> This replay uses a sample profile.</p>}
        <p className="rpg-muted">Replay is stored in this browser only. Each step shows Before → What changed → After → Why.</p>
        {snapshots.length === 1 && (
          <p>This is your first plan for this opportunity. Add evidence in your Skill Passport or change your profile, then come back to see what changed and why.</p>
        )}
        {steps.length > 0 && (
          <ol className="rpg-stack">
            {steps.map((step, index) => (
              <li key={step.after.id}>
                <ReplayStep before={step.before} after={step.after} open={index === 0} />
              </li>
            ))}
          </ol>
        )}
        {snapshots.length > 0 && (
          <div>
            <RpgButton variant="secondary" onClick={onClear}>
              Clear replay history for this opportunity (all profiles in this browser)
            </RpgButton>
          </div>
        )}
      </section>
    </QuestCard>
  );
}
