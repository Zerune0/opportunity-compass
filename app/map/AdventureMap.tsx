"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { diffRoutes, planRoutes } from "@/lib/path";
import { loadProfile } from "@/lib/store";
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
    refresh();
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    return () => {
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
        <h2>{opportunity.title}</h2>
        {(opportunity.is_sample || profile?.is_sample) && <p><StatusTag tone="warning">Sample data</StatusTag></p>}
        <p className="rpg-muted">{opportunity.organizer}</p>
        {opportunity.deadline && <p>Apply by {opportunity.deadline}</p>}
        <p>The routes help you prepare. You can apply directly.</p>
        <div className="rpg-row">
          {!opportunity.is_sample && <a className="rpg-button rpg-button--primary" href={opportunity.official_url}>Go directly to the official application</a>}
          <a className="rpg-button rpg-button--secondary" href={passport}>Open Skill Passport</a>
        </div>
      </header>
      {!context && <p role="status">Loading profile…</p>}
      {context && !profile && <p>Add a profile in the Skill Passport to see routes.</p>}
      {plan?.status === "blocked" && (
        <QuestCard><h2>Routes unavailable</h2>
          <ul className="rpg-list">{plan.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <ul className="rpg-list">{plan.alternatives.map((hint, index) => <li key={index}>{hint.text}</li>)}</ul>
        </QuestCard>
      )}
      {plan?.status === "routes" && (
        <section className="rpg-stack rpg-stack--loose" aria-label="Preparation routes">
          {plan.warnings.map((warning, index) => <p key={index} className="rpg-muted">{warning}</p>)}
          <div className="rpg-route-grid">
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
                <p>{item.rationale}</p>
                {item.warnings.map((warning, index) => <p key={index} className="rpg-muted rpg-small">{warning}</p>)}
                <RpgButton aria-pressed={route?.id === item.id} onClick={() => setSelected(item.id)}>Select {item.title}</RpgButton>
              </QuestCard>
            ))}
          </div>
          {route && (
            <section className="rpg-stack">
              <div className="rpg-row">
                <h2>{route.title} steps</h2>
                <RpgButton variant="secondary" aria-pressed={classic} onClick={() => setClassic(!classic)}>Classic view</RpgButton>
              </div>
              {route.steps.length === 0 && <p>No preparation steps listed.</p>}
              <ol className={classic ? "rpg-stack rpg-steps" : "rpg-stack rpg-steps rpg-trail"}>
                {route.steps.map((step) => {
                  const prep = opportunity.preparation.find((item) => item.id === step.prep_item_id);
                  return <li key={step.id}><QuestCard className={step.skipped ? "rpg-card--skipped" : ""}>
                    <h3>{step.title}</h3>
                    {step.skipped && <p className="rpg-row"><StatusTag tone="success">Skipped</StatusTag> {step.skip_reason}</p>}
                    {step.description && <p>{step.description}</p>}
                    <dl>
                      <dt>Time</dt><dd>{step.hours} h</dd>
                      <dt>Cost</dt><dd>{money.format(step.cost_usd)}</dd>
                      {prep && <><dt>Evidence</dt><dd>{prep.evidence_kind ?? "Not specified"}</dd></>}
                      {prep && <><dt>Kind</dt><dd>{prep.required_for_application ? "Required for application" : "Preparation step"}</dd></>}
                      {prep?.source_text?.trim() && <><dt>Source</dt><dd>{prep.source_text}</dd></>}
                      {step.depends_on.length > 0 && <><dt>After</dt><dd>{step.depends_on.map((id) => route.steps.find((item) => item.id === id)?.title ?? id).join(", ")}</dd></>}
                    </dl>
                  </QuestCard></li>;
                })}
              </ol>
            </section>
          )}
        </section>
      )}
      {replay && latest && before && plan && (
        <QuestCard>
          <h2>Recommendation replay</h2>
          <p className="rpg-muted">Compared using this profile with and without its latest evidence item.</p>
          <h3>Before</h3>
          {before.routes.length === 0 ? <p>No routes</p> : (
            <div className="rpg-row">
              {before.routes.map((item) => (
                <p key={item.id} className="rpg-score"><span>{item.title}:</span> <span className="rpg-figure">{item.total_hours}</span> <span className="rpg-unit">h</span></p>
              ))}
            </div>
          )}
          <h3>Latest evidence</h3>
          <p>{latest.title}</p>
          <h3>Updated routes</h3>
          {plan.routes.length === 0 ? <p>No routes</p> : (
            <div className="rpg-row">
              {plan.routes.map((item) => (
                <p key={item.id} className="rpg-score"><span>{item.title}:</span> <span className="rpg-figure rpg-figure--answer">{item.total_hours}</span> <span className="rpg-unit">h</span></p>
              ))}
            </div>
          )}
          <h3>Why</h3>
          <ul className="rpg-list">{replay.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
        </QuestCard>
      )}
    </div>
  );
}
