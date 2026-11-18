"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { diffRoutes, planRoutes } from "@/lib/path";
import { loadProfile } from "@/lib/store";
import { RecommendationReplay } from "./RecommendationReplay";
import type { Opportunity, StudentProfile } from "@/lib/types";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function AdventureMap({ opportunity }: { opportunity?: Opportunity }) {
  const [context, setContext] = useState<{ profile: StudentProfile | null; today: string }>();
  const [selected, setSelected] = useState<string>();
  const [classic, setClassic] = useState(false);

  useEffect(() => {
    function refresh() {
      const date = new Date();
      const today = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString().slice(0, 10);
      setContext({ profile: loadProfile(), today });
    }
    const initialRead = window.requestAnimationFrame(refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.cancelAnimationFrame(initialRead);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  if (!opportunity) return (
    <div className="rpg-head crt">
      <h1>Adventure Map</h1>
      <p>Choose an opportunity to see its preparation routes.</p>
      <Link className="rpg-button rpg-button--primary" href="/quests">Open Quest Board</Link>
    </div>
  );
  const passport = `/passport?opp=${encodeURIComponent(opportunity.id)}`;
  const profile = context?.profile;
  const plan = context && profile ? planRoutes(profile, opportunity, { today: context.today }) : null;
  const route = plan?.routes.find((item) => item.id === selected) ?? plan?.routes[0];
  const latest = profile?.evidence.at(-1);
  const before = latest && plan && profile && context
    ? planRoutes({ ...profile, evidence: profile.evidence.slice(0, -1) }, opportunity, { today: context.today })
    : null;
  const replay = before && plan ? diffRoutes(before, plan) : null;

  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
        <h1>Adventure Map</h1>
        <h2>Main Quest: {opportunity.title}</h2>
        {(opportunity.is_sample || profile?.is_sample) && <p><StatusTag tone="warning">Sample data</StatusTag></p>}
        <p className="rpg-muted">{opportunity.organizer}</p>
        {opportunity.deadline && <p>Apply by {opportunity.deadline}</p>}
        <p>Quests help you prepare. You can apply directly at any time.</p>
        <div className="rpg-row">
          {!opportunity.is_sample && <a className="rpg-button rpg-button--primary" href={opportunity.official_url}>Go directly to the official application</a>}
          <a className="rpg-button rpg-button--secondary" href={passport}>Open Skill Passport</a>
        </div>
      </header>
      {!context && <p role="status">Loading profile…</p>}
      {context && !profile && <p><Link href={passport}>Create a profile or load a sample in the Skill Passport</Link> to see routes.</p>}
      {plan?.status === "blocked" && (
        <QuestCard><h2>Routes unavailable</h2>
          <ul className="rpg-list">{plan.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <ul className="rpg-list">{plan.blocking_requirements.map((requirement, index) => <li key={index}>{requirement.source_text}</li>)}</ul>
          <ul className="rpg-list">{plan.alternatives.map((hint, index) => <li key={index}>{hint.text}</li>)}</ul>
        </QuestCard>
      )}
      {plan?.status === "routes" && (
        <section className="rpg-stack rpg-stack--loose" aria-label="Preparation routes">
          {plan.warnings.map((warning, index) => <p key={index} className="rpg-muted">{warning}</p>)}
          <RpgButton variant="secondary" aria-pressed={classic} onClick={() => setClassic(!classic)}>Classic View</RpgButton>
          {classic ? (
            <table className="rpg-classic-table">
              <caption>Route comparison</caption>
              <thead><tr><th scope="col">Route</th><th scope="col">Time</th><th scope="col">Cost</th><th scope="col">Weeks</th><th scope="col">Deadline</th><th scope="col">Reason</th></tr></thead>
              <tbody>{plan.routes.map((item) => <tr key={item.id}>
                <th scope="row"><RpgButton aria-pressed={route?.id === item.id} onClick={() => setSelected(item.id)}>{item.title}{route?.id === item.id ? " (selected)" : ""}</RpgButton></th>
                <td data-label="Time">{item.total_hours} h</td>
                <td data-label="Cost">{money.format(item.total_cost_usd)}</td>
                <td data-label="Weeks">{item.estimated_weeks ?? "Unknown"}</td>
                <td data-label="Deadline">{item.feasible_by_deadline === null ? "Unknown" : item.feasible_by_deadline ? "Fits deadline" : "Exceeds deadline"}</td>
                <td data-label="Reason">{item.rationale}{item.warnings.map((warning) => <p key={warning}>{warning}</p>)}</td>
              </tr>)}</tbody>
            </table>
          ) : <div className="rpg-route-grid">
            {plan.routes.map((item) => (
              <QuestCard key={item.id} aria-current={route?.id === item.id ? "true" : undefined}>
                <h2>{item.title}</h2>
                <p className="rpg-score">
                  <span className="rpg-figure">{item.total_hours}</span>
                  <span className="rpg-unit">h</span>
                  <span className="rpg-muted">{money.format(item.total_cost_usd)}</span>
                </p>
                <p>
                  <StatusTag tone={item.feasible_by_deadline === false ? "warning" : "neutral"}>
                    {item.feasible_by_deadline === null ? "Deadline feasibility unknown" : item.feasible_by_deadline ? "Fits deadline" : "Exceeds deadline"}
                  </StatusTag>
                </p>
                <p>Estimated weeks: {item.estimated_weeks ?? "Unknown"}</p>
                <p>{item.rationale}</p>
                {item.warnings.map((warning, index) => <p key={index} className="rpg-muted rpg-small">{warning}</p>)}
                <RpgButton aria-pressed={route?.id === item.id} onClick={() => setSelected(item.id)}>{route?.id === item.id ? "Selected: " : "Select "}{item.title}</RpgButton>
              </QuestCard>
            ))}
          </div>}
          {route && (
            <section className="rpg-stack">
              <h2>Side Quests: {route.title}</h2>
              {route.steps.length === 0 && <p>No preparation steps listed.</p>}
              {(() => {
                const steps = route.steps.map((step) => {
                  const prep = opportunity.preparation.find((item) => item.id === step.prep_item_id);
                  return {
                    step,
                    relation: prep
                      ? prep.required_for_application ? "Required to apply to this opportunity." : "Helps strengthen your application."
                      : step.description || "Supports preparation for this opportunity.",
                    evidence: prep?.evidence_kind ?? "Not specified",
                    requirement: prep?.required_for_application ? "Required for application" : "Team suggestion",
                    source: prep?.source_text?.trim(),
                    dependencies: step.depends_on.map((id) => route.steps.find((item) => item.id === id)?.title ?? id).join(", ") || "None",
                  };
                });
                const timeline = steps.reduce<{ hours: number; entries: { id: string; label: string; title: string }[] }>((schedule, { step }) => {
                  const capacity = profile?.hours_per_week_available;
                  if (step.skipped || !capacity) return schedule;
                  const start = Math.floor(schedule.hours / capacity) + 1;
                  const hours = schedule.hours + step.hours;
                  const end = Math.max(start, Math.ceil(hours / capacity));
                  return { hours, entries: [...schedule.entries, {
                    id: step.id, title: step.title, label: start === end ? `Week ${start}` : `Weeks ${start}–${end}`,
                  }] };
                }, { hours: 0, entries: [] });
                const fields = (item: typeof steps[number]) => [
                  ["Goal relationship", item.relation],
                  ["Time", `${item.step.hours} h`],
                  ["Cost", money.format(item.step.cost_usd)],
                  ["Evidence", item.evidence],
                  ["Dependency", item.dependencies],
                  ["Application requirement", item.requirement],
                  ["Source", item.source ?? "Not specified"],
                ];
                return <>
                  {classic ? <table className="rpg-classic-table">
                    <caption>Preparation checklist</caption>
                    <thead><tr><th scope="col">Step</th>{["Goal relationship", "Time", "Cost", "Evidence", "Dependency", "Application requirement", "Source"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                    <tbody>{steps.map((item) => <tr key={item.step.id}>
                      <th scope="row">{item.step.title}{item.step.skipped && <p>Skipped, excluded from totals. {item.step.skip_reason}</p>}</th>
                      {fields(item).map(([label, value]) => <td data-label={label} key={label}>{value}</td>)}
                    </tr>)}</tbody>
                  </table> : <ol className="rpg-stack rpg-steps rpg-trail">{steps.map((item) => <li key={item.step.id}>
                    <QuestCard className={item.step.skipped ? "rpg-card--skipped" : ""}>
                      <h3>{item.step.title}</h3>
                      {item.step.skipped && <p><StatusTag tone="success">Skipped, excluded from totals</StatusTag> {item.step.skip_reason}</p>}
                      <dl>{fields(item).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                    </QuestCard>
                  </li>)}</ol>}
                  <h3>Weekly timeline</h3>
                  {!profile?.hours_per_week_available ? <p>Add available weekly hours in the Skill Passport to see a timeline.</p> : timeline.entries.length ? (
                    <ol className="rpg-list">{timeline.entries.map((entry) => <li key={entry.id}><strong>{entry.label}</strong> · {entry.title}</li>)}</ol>
                  ) : <p>No steps remaining to schedule.</p>}
                </>;
              })()}
            </section>
          )}
        </section>
      )}
      {replay && latest && before && plan && (
        <RecommendationReplay
          before={before}
          updated={plan}
          change={`Added evidence: ${latest.title}`}
          reasons={replay.reasons}
          note="This comparison uses the current profile with and without the most recently added evidence."
        />
      )}
    </div>
  );
}
