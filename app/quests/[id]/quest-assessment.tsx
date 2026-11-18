"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkEligibility } from "../../../lib/eligibility";
import { analyzeReachability } from "../../../lib/reachability";
import { planRoutes } from "../../../lib/path";
import { analyzeGaps } from "../../../lib/gap";
import { explainMatch, findAlternatives } from "../../../lib/match";
import { grantsFor, loadGrants, loadProfile, loadUserPostedOpportunities } from "../../../lib/store";
import opportunities from "../../../data/opportunities.json";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../../lib/types";
import { AlternativesSection } from "./alternatives";
import { JournalButton } from "./journal-button";
import { GapAnalysisSection, MatchExplanationSection } from "./match-and-gaps";

const officialCatalog = opportunities as Opportunity[];

const eligibilityLabels = { eligible: "Requirements satisfied", not_eligible: "Hard requirement not met", unknown: "Eligibility unconfirmed" };
const itemLabels = { satisfied: "Satisfied", not_satisfied: "Not satisfied", unknown: "Unknown" };
const barrierLabels = { time: "Time", cost: "Cost", transport: "Transportation", device: "Equipment" };
const section = "rpg-card";
const itemTones = { satisfied: "rpg-tag rpg-tag--success", not_satisfied: "rpg-tag rpg-tag--danger", unknown: "rpg-tag rpg-tag--warning" };
const overallTones = { eligible: "rpg-tag rpg-tag--success", not_eligible: "rpg-tag rpg-tag--danger", unknown: "rpg-tag rpg-tag--warning" };

type AssessmentContext = {
  profile: StudentProfile | null;
  /** Grants that apply to this student on this opportunity (shared by all engines for this page). */
  grants: ResourceGrant[];
  /** Every grant recorded for this student; alternatives use each candidate's own subset. */
  studentGrants: ResourceGrant[];
  today: string;
  catalog: Opportunity[];
};

function readContext(opportunityId: string): AssessmentContext {
  const profile = loadProfile();
  const date = new Date();
  const today = [
    date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  return {
    profile, today,
    grants: profile ? grantsFor(profile.id, opportunityId) : [],
    studentGrants: profile ? loadGrants().filter((grant) => grant.student_id === profile.id) : [],
    catalog: [...officialCatalog, ...loadUserPostedOpportunities()],
  };
}

export function QuestAssessment({ opportunity }: { opportunity: Opportunity }) {
  const [context, setContext] = useState<AssessmentContext | null>(null);

  useEffect(() => {
    // Browser-only data (localStorage, local date) is read after mount and re-read when it may have changed.
    const refresh = () => setContext(readContext(opportunity.id));
    const initialRead = window.requestAnimationFrame(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.cancelAnimationFrame(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [opportunity.id]);

  const profile = context?.profile;
  const eligibility = context && profile && checkEligibility(profile, opportunity, { today: context.today });
  const reach = context && profile && analyzeReachability(profile, opportunity, context.grants, { today: context.today });
  const plan = context && profile && eligibility?.overall === "not_eligible" ? planRoutes(profile, opportunity, { today: context.today }) : null;
  // All four engines share the same grants and today so their conclusions agree.
  const evalOptions = context ? { today: context.today, grants: context.grants } : null;
  const match = context && profile && evalOptions && explainMatch(profile, opportunity, evalOptions);
  const gapAnalysis = context && profile && analyzeGaps(profile, opportunity, context.grants, { today: context.today });
  // findAlternatives only applies grants through analyzeReachability, which keeps the ones matching each
  // opportunity, so passing all of the student's grants lets every candidate use its own grants while this
  // opportunity still sees exactly context.grants.
  const alternatives = context && profile && evalOptions
    ? findAlternatives(profile, opportunity, context.catalog, { today: context.today, grants: context.studentGrants })
    : [];
  const gaps = reach?.readiness_gaps ?? [];
  const covered = reach ? opportunity.preparation.filter((item) =>
    !gaps.some((gap) => gap.prep_item_id === item.id),
  ) : [];

  return (
    <>
      {(profile?.is_sample || context?.grants.some((grant) => grant.is_sample)) && (
        <p className="rpg-row">
          {profile?.is_sample && <span className="rpg-tag rpg-tag--warning">Sample student profile</span>}
          {context?.grants.some((grant) => grant.is_sample) && <span className="rpg-tag rpg-tag--warning">Assessment includes simulated support.</span>}
        </p>
      )}
      <div className="rpg-route-grid">
        <section className={section}>
          <h2>Official eligibility</h2>
          <p>{eligibility ? <span className={overallTones[eligibility.overall]}>{eligibilityLabels[eligibility.overall]}</span> :
            context ? "Eligibility unconfirmed. No student profile is loaded." : "Loading profile…"}</p>
          {opportunity.requirements.length === 0 && <p>No official requirements have been entered. Confirm with the organizer.</p>}
          {opportunity.requirements.length > 0 && (
            <ul className="rpg-list">
              {opportunity.requirements.map((rule) => {
                const item = eligibility?.items.find((result) => result.requirement_id === rule.id);
                return (
                  <li key={rule.id}>
                    <details>
                      <summary>
                        <span className="rpg-row">
                          <strong>{rule.label}</strong>
                          <span className="rpg-tag">{rule.hard ? "Required" : "Official preference"}</span>
                          <span className={itemTones[item?.status ?? "unknown"]}>{itemLabels[item?.status ?? "unknown"]}</span>
                        </span>
                      </summary>
                      <blockquote className="my-2 border-l-2 pl-3">{rule.source_text}</blockquote>
                      {item && <p>{item.explanation}</p>}
                      {(!item || item.status === "unknown") && <p>{item?.confirm_with_official ?? "Confirm with the organizer."}</p>}
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className={section}>
          <h2>Preparation readiness</h2>
          {!reach && <p>Load a student profile to compare preparation with recorded evidence.</p>}
          {reach && covered.map((item) => (
            <p key={item.id} className="rpg-row"><span className="rpg-tag rpg-tag--success">Covered</span> {item.title}</p>
          ))}
          {gaps.map((gap) => (
            <div key={gap.prep_item_id} className="rpg-stack">
              <p className="rpg-row">
                <strong>{gap.title}</strong>
                <span className="rpg-tag">{gap.required_for_application ? "Required material" : "Suggested preparation"}</span>
              </p>
              <p>{gap.reason}</p>
              <p className="rpg-muted rpg-small">Estimated {gap.estimated_hours} h and ${gap.estimated_cost_usd}</p>
            </div>
          ))}
          {reach && opportunity.preparation.length === 0 && <p>No preparation items have been entered.</p>}
        </section>
        <section className={section}>
          <h2>Practical reachability</h2>
          <p>{reach?.summary ?? "Load a student profile to assess participation constraints."}</p>
          {reach?.barriers.map((barrier, index) => (
            <div key={`${barrier.type}-${index}`} className="rpg-stack">
              <p className="rpg-row">
                <strong>{barrierLabels[barrier.type]}</strong>
                <span className={barrier.resolved ? "rpg-tag rpg-tag--success" : "rpg-tag rpg-tag--danger"}>{barrier.resolved ? "Support applied" : "Open barrier"}</span>
              </p>
              <p>{barrier.description}</p>
              {!!barrier.pending_grant_ids?.length && !barrier.resolved && <p>Support approval is pending.</p>}
            </div>
          ))}
          {!!reach?.missing_info.length && <p>Some information still needs confirmation. Review your profile and the official listing.</p>}
          <p className="rpg-muted rpg-small">The assessment describes participation constraints. Admission decisions are made by the organizer.</p>
        </section>
      </div>
      {plan?.status === "blocked" && alternatives.length === 0 && plan.alternatives.length > 0 && <section className="rpg-card"><h2>Other options</h2><ul>{plan.alternatives.map((hint, index) => <li key={index}>{hint.text}</li>)}</ul></section>}
      {eligibility?.overall !== "not_eligible" && (
        <Link className="rpg-button rpg-button--secondary" href={`/map?opp=${encodeURIComponent(opportunity.id)}`}>View growth routes</Link>
      )}
      {context && !profile && (
        <section className="rpg-card">
          <h2>Personal fit and gaps</h2>
          <p>Load or create a student profile to see why this fits, your gaps and alternatives. <Link href="/passport">Go to Skill Passport</Link></p>
        </section>
      )}
      {match && <MatchExplanationSection match={match} />}
      {gapAnalysis && <GapAnalysisSection gaps={gapAnalysis} />}
      {context && profile && (
        <AlternativesSection suggestions={alternatives} catalog={context.catalog}
          profile={profile} studentGrants={context.studentGrants} today={context.today}
          currentEligibility={eligibility ? eligibility.overall : null} />
      )}
      {context && <JournalButton opportunity={opportunity} profile={profile ?? null} today={context.today} />}
    </>
  );
}
