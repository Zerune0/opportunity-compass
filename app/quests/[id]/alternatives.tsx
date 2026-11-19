import Link from "next/link";
import { StatusTag } from "../../../components/rpg";
import { analyzeReachability } from "../../../lib/reachability";
import type {
  AlternativeSuggestion, ISODate, Opportunity, OverallEligibility, ResourceGrant, StudentProfile,
} from "../../../lib/types";

const eligibilityTags = {
  eligible: { tone: "success" as const, label: "Requirements satisfied" },
  not_eligible: { tone: "danger" as const, label: "Hard requirement not met" },
  unknown: { tone: "warning" as const, label: "Eligibility unconfirmed" },
};

/** Labels for alternative kinds beyond same_field / next_cycle; unknown kinds get a generic label. */
function alternativeKindLabel(kind: string): string | null {
  if (kind === "same_field" || kind === "next_cycle") return null;
  if (kind === "stepping_stone") return "Evidence-building step — not a prerequisite";
  if (kind === "remote_option") return "Online option";
  return "Other option";
}

function reachTag(reachable: boolean | null | undefined) {
  if (reachable === true) return { tone: "success" as const, label: "Practically reachable" };
  if (reachable === false) return { tone: "danger" as const, label: "Open barriers" };
  return { tone: "warning" as const, label: "Reachability: Unknown" };
}

function reachableFor(profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[], today: ISODate) {
  try {
    return analyzeReachability(profile, opp, grants, { today }).reachable;
  } catch {
    return null;
  }
}

/** The grants that apply to this student on one candidate (same rule as grantsFor in lib/store). */
function candidateGrants(studentGrants: ResourceGrant[], studentId: string, oppId: string) {
  return studentGrants.filter((grant) =>
    grant.student_id === studentId && (grant.opportunity_id === null || grant.opportunity_id === oppId),
  );
}

export function AlternativesSection({ suggestions, catalog, profile, studentGrants, today, currentEligibility }: {
  suggestions: AlternativeSuggestion[]; catalog: Opportunity[];
  profile: StudentProfile;
  /** All grants recorded for this student; each candidate uses only the ones that apply to it. */
  studentGrants: ResourceGrant[];
  today: ISODate;
  /** Eligibility of the opportunity this page is about. */
  currentEligibility: OverallEligibility | null;
}) {
  if (suggestions.length === 0) return null;
  return (
    <section className="rpg-card" aria-labelledby="alternatives-heading">
      <h2 id="alternatives-heading">If this one is out of reach</h2>
      <p className="rpg-muted">
        {currentEligibility === "not_eligible"
          ? "These are alternatives; they do not change this opportunity's requirements."
          : "These are alternatives, not prerequisites. You can still go straight to the official page."}
      </p>
      <ul className="rpg-list">
        {suggestions.map((suggestion, index) => {
          const key = `${suggestion.kind}-${suggestion.opportunity_id ?? "none"}-${index}`;
          if (suggestion.kind === "next_cycle") {
            return (
              <li key={key} className="rpg-stack">
                <h3 className="rpg-row"><span>Next cycle</span><StatusTag>{suggestion.title}</StatusTag></h3>
                <p>{suggestion.reason}</p>
              </li>
            );
          }
          const opp = catalog.find((entry) => entry.id === suggestion.opportunity_id);
          const userPosted = opp?.source_tier === "user_posted";
          const eligibility = eligibilityTags[suggestion.eligibility_overall ?? "unknown"];
          const reach = reachTag(opp ? reachableFor(profile, opp, candidateGrants(studentGrants, profile.id, opp.id), today) : null);
          const kindLabel = alternativeKindLabel(suggestion.kind);
          return (
            <li key={key} className="rpg-stack">
              <h3>
                {suggestion.opportunity_id && !userPosted ? (
                  <Link href={`/quests/${encodeURIComponent(suggestion.opportunity_id)}`}>{suggestion.title}</Link>
                ) : suggestion.title}
              </h3>
              <p className="rpg-row">
                {kindLabel && <StatusTag>{kindLabel}</StatusTag>}
                <StatusTag tone={eligibility.tone}>{eligibility.label}</StatusTag>
                <StatusTag tone={reach.tone}>{reach.label}</StatusTag>
                {userPosted && (
                  <StatusTag tone="warning">User-posted · not verified against an official site · Sample</StatusTag>
                )}
              </p>
              <p>{suggestion.reason}</p>
              {suggestion.eligibility_overall !== "eligible" && (
                <p className="rpg-muted rpg-small">Some requirements are unconfirmed. Confirm with the organizer.</p>
              )}
              {reach.tone === "success" && (
                <p className="rpg-muted rpg-small">Reachable describes participation constraints only. Admission decisions are made by the organizer.</p>
              )}
              {userPosted && (
                <p className="rpg-muted rpg-small">Saved on this device only, so it has no Quest Details page.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
