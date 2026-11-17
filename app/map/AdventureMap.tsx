"use client";

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

  if (!opportunity) return <QuestCard><h1>Adventure Map</h1><p>Choose an opportunity to see its preparation routes.</p><a href="/quests">Open Quest Board</a></QuestCard>;
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
    <div className="rpg-stack">
      <QuestCard>
        <h1>Adventure Map</h1>
        <h2>{opportunity.title}</h2>
        {(opportunity.is_sample || profile?.is_sample) && <StatusTag>Sample data</StatusTag>}
        <p>{opportunity.organizer}{opportunity.deadline && ` · Apply by ${opportunity.deadline}`}</p>
        {!opportunity.is_sample && <a href={opportunity.official_url}>Go directly to the official application</a>}
        <p>The routes help you prepare. You can apply directly.</p>
        <a href={passport}>Open Skill Passport</a>
      </QuestCard>
      {!context && <p role="status">Loading profile…</p>}
      {context && !profile && <p>Add a profile in the Skill Passport to see routes.</p>}
      {plan?.status === "blocked" && (
        <QuestCard><h2>Routes unavailable</h2>
          <ul>{plan.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
          <ul>{plan.alternatives.map((hint, index) => <li key={index}>{hint.kind === "next_cycle" ? "Check the next cycle" : "Explore similar opportunities"}</li>)}</ul>
        </QuestCard>
      )}
      {plan?.status === "routes" && (
        <section className="rpg-stack" aria-label="Preparation routes">
          {plan.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
          <div className="rpg-route-grid">
            {plan.routes.map((item) => (
              <QuestCard key={item.id}>
                <h2>{item.title}</h2>
                <p>{item.total_hours} h · {money.format(item.total_cost_usd)}</p>
                <StatusTag tone={item.feasible_by_deadline === false ? "warning" : "neutral"}>
                  {item.feasible_by_deadline === null ? "Deadline feasibility unknown" : item.feasible_by_deadline ? "Fits deadline" : "Exceeds deadline"}
                </StatusTag>
                <p>{item.rationale}</p>
                {item.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
                <RpgButton aria-pressed={route?.id === item.id} onClick={() => setSelected(item.id)}>Select {item.title}</RpgButton>
              </QuestCard>
            ))}
          </div>
          {route && (
            <section>
              <h2>{route.title} steps</h2>
              <RpgButton variant="secondary" aria-pressed={classic} onClick={() => setClassic(!classic)}>Classic view</RpgButton>
              {route.steps.length === 0 && <p>No preparation steps listed.</p>}
              <ol className={classic ? "rpg-stack" : "rpg-stack rpg-trail"}>
                {route.steps.map((step) => {
                  const prep = opportunity.preparation.find((item) => item.id === step.prep_item_id);
                  return <li key={step.id}><QuestCard>
                    <h3>{step.title}</h3>
                    {step.description && <p>{step.description}</p>}
                    <p>{step.hours} h · {money.format(step.cost_usd)}</p>
                    {prep && <p>Evidence: {prep.evidence_kind ?? "Not specified"} · {prep.required_for_application ? "Required for application" : "Preparation step"}</p>}
                    {step.depends_on.length > 0 && <p>After: {step.depends_on.map((id) => route.steps.find((item) => item.id === id)?.title ?? id).join(", ")}</p>}
                    {step.skipped && <p><StatusTag tone="success">Skipped</StatusTag> {step.skip_reason}</p>}
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
          <p>Compared using this profile with and without its latest evidence item.</p>
          <dl>
            <dt>Before</dt><dd>{before.routes.map((item) => `${item.title}: ${item.total_hours} h`).join(" · ") || "No routes"}</dd>
            <dt>Latest evidence</dt><dd>{latest.title}</dd>
            <dt>Updated routes</dt><dd>{plan.routes.map((item) => `${item.title}: ${item.total_hours} h`).join(" · ") || "No routes"}</dd>
            <dt>Why</dt><dd><ul>{replay.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></dd>
          </dl>
        </QuestCard>
      )}
    </div>
  );
}
