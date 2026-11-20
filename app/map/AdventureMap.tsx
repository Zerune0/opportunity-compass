"use client";

import Link from "next/link";
import { PixelLoader } from "@/components/rpg/pixel-loader";
import { DetailDialog } from "@/components/rpg/DetailDialog";
import { useViewPreference } from "@/components/rpg/view-preference";
import { alternativeQuestHref } from "./alternative-links";
import { splitOfficial, stepFields } from "./step-details";
import { useCallback, useEffect, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { catalogOpportunities } from "@/lib/data";
import { findAlternatives } from "@/lib/match";
import { planRoutes } from "@/lib/path";
import { clearPlanSnapshots, latestPlanSnapshot, loadGrants, loadPlanSnapshots, loadProfile, pushPlanSnapshot } from "@/lib/store";
import { nextSnapshot } from "./plan-snapshots";
import { RecommendationReplay } from "./RecommendationReplay";
import { LoadSampleAndOpenMap, MapStart } from "./SampleMapStart";
import type { Opportunity, PlanSnapshot, ResourceGrant, RouteStep, StudentProfile } from "@/lib/types";

/** Labels for alternative kinds beyond same_field / next_cycle; unknown kinds get a generic label. */
function alternativeKindLabel(kind: string): string {
  if (kind === "stepping_stone") return "Evidence-building step — not a prerequisite";
  if (kind === "remote_option") return "Online option";
  return "Other option";
}

const catalog = catalogOpportunities();

/** A competition step links to that competition's own page, when it is in the verified catalog. */
function competitionLink(step: RouteStep) {
  const id = step.related_opportunity_id;
  if (!id || !catalog.some((item) => item.id === id)) return null;
  return <p><Link href={`/quests/${encodeURIComponent(id)}`}>View this competition</Link>{step.description ? <> — {step.description}</> : null}</p>;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function AdventureMap({ opportunity }: { opportunity?: Opportunity }) {
  const [context, setContext] = useState<{ profile: StudentProfile | null; today: string; grants: ResourceGrant[] }>();
  const [selected, setSelected] = useState<string>();
  const [view, chooseView] = useViewPreference();
  const classic = view === "classic";
  const [snapshots, setSnapshots] = useState<PlanSnapshot[]>([]);

  useEffect(() => {
    function refresh() {
      const date = new Date();
      const today = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString().slice(0, 10);
      const loaded = loadProfile();
      // The student's own grants, so alternatives here match Quest Details (support already approved counts).
      const grants = loaded ? loadGrants().filter((grant) => grant.student_id === loaded.id) : [];
      setContext({ profile: loaded, today, grants });
    }
    const initialRead = window.setTimeout(refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Store a plan snapshot when the planning inputs changed since the latest one. Synchronous
  // read-compare-write, so the second effect run in React strict mode finds the snapshot just
  // stored and does not add a duplicate.
  const syncSnapshots = useCallback(() => {
    const current = context?.profile;
    if (!opportunity || !context || !current) return [];
    const plan = planRoutes(current, opportunity, { today: context.today, catalog });
    const snapshot = nextSnapshot(latestPlanSnapshot(opportunity.id, current.id), plan, current, opportunity, context.today);
    return snapshot ? pushPlanSnapshot(snapshot) : loadPlanSnapshots(opportunity.id, current.id);
  }, [context, opportunity]);

  useEffect(() => {
    // localStorage is only available after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSnapshots(syncSnapshots());
  }, [syncSnapshots]);

  function clearReplay() {
    if (!opportunity) return;
    if (!window.confirm("Clear the replay history for this opportunity? This removes it for every profile in this browser and cannot be undone.")) return;
    clearPlanSnapshots(opportunity.id);
    setSnapshots(syncSnapshots());
  }

  if (!opportunity) return context
    ? <MapStart hasProfile={Boolean(context.profile)} profileName={context.profile?.display_name} />
    : <PixelLoader label="Loading profile…" />;
  const passport = `/passport?opp=${encodeURIComponent(opportunity.id)}`;
  const profile = context?.profile;
  const plan = context && profile ? planRoutes(profile, opportunity, { today: context.today, catalog }) : null;
  const route = plan?.routes.find((item) => item.id === selected) ?? plan?.routes[0];

  const alternatives = profile && context
    ? findAlternatives(profile, opportunity, catalog, { today: context.today, grants: context.grants })
    : [];

  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
        <h1>Adventure Map</h1>
        <h2>Main Quest: {opportunity.title}</h2>
        {(opportunity.is_sample || profile?.is_sample) && <p><StatusTag tone="warning">Sample data</StatusTag></p>}
        <p className="rpg-muted">{opportunity.organizer}</p>
        {opportunity.deadline && <p>Apply by {opportunity.deadline}</p>}
        <p>{plan?.status === "blocked"
          ? "Your profile does not meet the listed eligibility requirements. Check the official source for the requirements and future rounds."
          : "Quests help you prepare. You can apply directly at any time."}</p>
        <div className="rpg-row">
          {!opportunity.is_sample && <a className="rpg-button rpg-button--primary" href={opportunity.official_url}>{plan?.status === "blocked" ? "View official requirements and application" : "Go directly to the official application"}</a>}
          <a className="rpg-button rpg-button--secondary" href={passport}>Open Skill Passport</a>
          <Link className="rpg-button rpg-button--secondary" href={`/quests/${encodeURIComponent(opportunity.id)}`}>Details and Quest Journal</Link>
        </div>
      </header>
      {!context && <PixelLoader label="Loading profile…" />}
      {context && !profile && (
        <QuestCard>
          <h2>No profile loaded</h2>
          <p>Routes depend on a student profile. <Link href={passport}>Create your own in the Skill Passport</Link>, or try the sample.</p>
          <LoadSampleAndOpenMap opportunityId={opportunity.id} />
        </QuestCard>
      )}
      {plan?.status === "blocked" && (
        <QuestCard><h2>Routes unavailable</h2>
          <ul className="rpg-list">{plan.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <ul className="rpg-list">{plan.blocking_requirements.map((requirement, index) => <li key={index}>{requirement.source_text}</li>)}</ul>
          {/* The concrete list below replaces these general hints when it has anything to show. */}
          {alternatives.length === 0 && <ul className="rpg-list">{plan.alternatives.map((hint, index) => <li key={index}>{hint.text}</li>)}</ul>}
        </QuestCard>
      )}
      {plan?.status === "routes" && (
        <section className="rpg-stack rpg-stack--loose" aria-label="Preparation routes">
          {plan.warnings.map((warning, index) => <p key={index} className="rpg-muted">{warning}</p>)}
          <RpgButton variant="secondary" aria-pressed={classic} onClick={() => chooseView(classic ? "adventure" : "classic")}>Classic View</RpgButton>
          {classic ? (
            <table className="rpg-classic-table">
              <caption>Route comparison</caption>
              <thead><tr><th scope="col">Route</th><th scope="col">Time</th><th scope="col">Cost</th><th scope="col">Weeks</th><th scope="col">Deadline</th><th scope="col">Why this route</th></tr></thead>
              <tbody>{plan.routes.map((item) => <tr key={item.id}>
                <th scope="row"><RpgButton aria-pressed={route?.id === item.id} onClick={() => setSelected(item.id)}>{item.title}{route?.id === item.id ? " (selected)" : ""}</RpgButton></th>
                <td data-label="Time">{item.total_hours} h</td>
                <td data-label="Cost">{money.format(item.total_cost_usd)}</td>
                <td data-label="Weeks">{item.estimated_weeks ?? "Unknown"}</td>
                <td data-label="Deadline">{item.feasible_by_deadline === null ? "Unknown" : item.feasible_by_deadline ? "Fits deadline" : "Exceeds deadline"}</td>
                <td data-label="Why this route">
                  <DetailDialog label="Read why" subject={item.title} title={`${item.title}: why this route`}>
                    {item.type === "competition" && <p>Not an official requirement of this opportunity.</p>}
                    <p>{item.rationale}</p>
                    {item.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </DetailDialog>
                </td>
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
                {item.type === "competition" && <p>Not an official requirement of this opportunity.</p>}
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
                    fields: stepFields(step, prep),
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
                  ...item.fields,
                  ["Dependency", item.dependencies],
                ];
                return <>
                  {classic ? <table className="rpg-classic-table">
                    <caption>Preparation checklist</caption>
                    <thead><tr><th scope="col">Step</th>{["Why this step", "Time and cost", "Evidence you can record", "Official requirement?", "Dependency"].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
                    <tbody>{steps.map((item) => <tr key={item.step.id}>
                      <th scope="row">{item.step.title}{competitionLink(item.step)}{item.step.skipped && <p>Skipped, excluded from totals. {item.step.skip_reason}</p>}</th>
                      {fields(item).map(([label, value]) => {
                        // Short labels in the cells; the longer text opens in a centered card.
                        if (label === "Why this step") return <td data-label={label} key={label}>
                          {value === "Not recorded" ? value : <DetailDialog label="Read why" subject={item.step.title} title={`Why this step: ${item.step.title}`}><p>{value}</p></DetailDialog>}
                        </td>;
                        if (label !== "Official requirement?") return <td data-label={label} key={label}>{value}</td>;
                        const official = splitOfficial(value);
                        return <td data-label={label} key={label}>
                          <span style={{ display: "block" }}>{official.label}</span>
                          {official.detail && <DetailDialog label="View source" subject={item.step.title} title={`Organizer source: ${item.step.title}`}><p>{official.detail}</p></DetailDialog>}
                        </td>;
                      })}
                    </tr>)}</tbody>
                  </table> : <ol className="rpg-stack rpg-steps rpg-trail">{steps.map((item) => <li key={item.step.id}>
                    <QuestCard className={item.step.skipped ? "rpg-card--skipped" : ""}>
                      <h3>{item.step.title}</h3>
                      {competitionLink(item.step)}
                      {item.step.skipped && <p><StatusTag tone="success">Skipped, excluded from totals</StatusTag> {item.step.skip_reason}</p>}
                      <details><summary>Step details: {item.step.title}</summary><dl>{fields(item).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
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
      {alternatives.length > 0 && <QuestCard>
        <h2>Other opportunities and future rounds</h2>
        <p className="rpg-muted">{plan?.status === "blocked"
          ? "These are alternatives; they do not change this opportunity's requirements."
          : "These are alternatives, not prerequisites."}</p>
        <ul className="rpg-list">{alternatives.map((alternative, index) => {
          const href = alternativeQuestHref(alternative.kind, alternative.opportunity_id, opportunity.id, catalog);
          return <li key={index}>
          {href ? <Link href={href}>{alternative.title}</Link> : <strong>{alternative.title}</strong>}
          {alternative.kind === "next_cycle" ? " · Future round" : alternative.kind !== "same_field" && ` · ${alternativeKindLabel(alternative.kind)}`}
          <p>{alternative.reason}</p>
        </li>; })}</ul>
      </QuestCard>}
      {plan && profile && snapshots.length > 0 && (
        <RecommendationReplay snapshots={snapshots} isSample={profile.is_sample} onClear={clearReplay} />
      )}
    </div>
  );
}
