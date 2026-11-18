"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkEligibility } from "../../../lib/eligibility";
import { analyzeReachability } from "../../../lib/reachability";
import { grantsFor, loadProfile } from "../../../lib/store";
import type { Opportunity, ResourceGrant, StudentProfile } from "../../../lib/types";

const eligibilityLabels = { eligible: "Requirements satisfied", not_eligible: "Hard requirement not met", unknown: "Eligibility unconfirmed" };
const itemLabels = { satisfied: "Satisfied", not_satisfied: "Not satisfied", unknown: "Unknown" };
const barrierLabels = { time: "Time", cost: "Cost", transport: "Transportation", device: "Equipment" };
const section = "min-w-0 space-y-3 rounded-lg border p-4 wrap-break-word";

export function QuestAssessment({ opportunity }: { opportunity: Opportunity }) {
  const [context, setContext] = useState<{
    profile: StudentProfile | null; grants: ResourceGrant[]; today: string;
  } | null>(null);

  useEffect(() => {
    const profile = loadProfile();
    const date = new Date();
    const today = [
      date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    // Browser-only data (localStorage, local date) can only be read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContext({ profile, today, grants: profile ? grantsFor(profile.id, opportunity.id) : [] });
  }, [opportunity.id]);

  const profile = context?.profile;
  const eligibility = context && profile && checkEligibility(profile, opportunity, { today: context.today });
  const reach = context && profile && analyzeReachability(profile, opportunity, context.grants, { today: context.today });
  const gaps = reach?.readiness_gaps ?? [];
  const covered = reach ? opportunity.preparation.filter((item) =>
    !gaps.some((gap) => gap.prep_item_id === item.id),
  ) : [];

  return (
    <>
      {profile?.is_sample && <p className="font-semibold">Sample student profile</p>}
      {context?.grants.some((grant) => grant.is_sample) && <p className="font-semibold">Assessment includes simulated support.</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className={section}>
          <h2 className="text-xl font-semibold">Official eligibility</h2>
          <p>{eligibility ? eligibilityLabels[eligibility.overall] :
            context ? "Eligibility unconfirmed. No student profile is loaded." : "Loading profile…"}</p>
          {opportunity.requirements.length === 0 && <p>No official requirements have been entered. Confirm with the organizer.</p>}
          {opportunity.requirements.length > 0 && (
            <ul className="space-y-3">
              {opportunity.requirements.map((rule, index) => {
                const item = eligibility?.items[index];
                return (
                  <li key={rule.id}>
                    <details>
                      <summary className="cursor-pointer">
                        {rule.label} · {rule.hard ? "Required" : "Official preference"} · {itemLabels[item?.status ?? "unknown"]}
                      </summary>
                      <blockquote className="my-2 border-l pl-3">{rule.source_text}</blockquote>
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
          <h2 className="text-xl font-semibold">Preparation readiness</h2>
          {!reach && <p>Load a student profile to compare preparation with recorded evidence.</p>}
          {reach && covered.map((item) => <p key={item.id}>Covered · {item.title}</p>)}
          {gaps.map((gap) => (
            <div key={gap.prep_item_id}>
              <p className="font-medium">{gap.title} · {gap.required_for_application ? "Required material" : "Suggested preparation"}</p>
              <p>{gap.reason} · Estimated {gap.estimated_hours} h and ${gap.estimated_cost_usd}</p>
            </div>
          ))}
          {reach && opportunity.preparation.length === 0 && <p>No preparation items have been entered.</p>}
        </section>
        <section className={section}>
          <h2 className="text-xl font-semibold">Practical reachability</h2>
          <p>{reach?.summary ?? "Load a student profile to assess participation constraints."}</p>
          {reach?.barriers.map((barrier, index) => (
            <div key={`${barrier.type}-${index}`}>
              <p className="font-medium">{barrierLabels[barrier.type]} · {barrier.resolved ? "Support applied" : "Open barrier"}</p>
              <p>{barrier.description}</p>
              {!!barrier.pending_grant_ids?.length && !barrier.resolved && <p>Support approval is pending.</p>}
            </div>
          ))}
          {!!reach?.missing_info.length && <p>Some information still needs confirmation. Review your profile and the official listing.</p>}
          <p>The assessment describes participation constraints. Admission decisions are made by the organizer.</p>
        </section>
      </div>
      {eligibility?.overall !== "not_eligible" && (
        <Link className="font-semibold underline" href={`/map?opp=${encodeURIComponent(opportunity.id)}`}>View growth routes</Link>
      )}
    </>
  );
}
