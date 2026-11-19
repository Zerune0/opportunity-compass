import type {
  CrossPlanItem,
  EligibilityConfirmation,
  JournalApplicationStatus,
  JournalDecision,
  JournalEvent,
  MaterialKind,
  MaterialStatus,
  RouteType,
} from "@/lib/types";

export const applicationLabels: Record<JournalApplicationStatus, string> = {
  preparing: "Preparing",
  submitted: "Submitted",
  withdrawn: "Withdrawn",
};

export const eligibilityLabels: Record<EligibilityConfirmation, string> = {
  unconfirmed: "Not confirmed yet",
  confirmed: "Confirmed by the organizer",
  rejected: "Organizer said not eligible",
};

export const decisionLabels: Record<JournalDecision, string> = {
  pending: "No decision recorded",
  admitted: "Admitted",
  not_admitted: "Not admitted",
};

export function participationLabel(value: boolean | null): string {
  if (value === true) return "Took part";
  if (value === false) return "Did not take part";
  return "Not recorded";
}

export const eventLabels: Record<JournalEvent, string> = {
  added: "Added to the Journal",
  submitted: "Recorded: application submitted",
  withdrawn: "Recorded: withdrew",
  reopened: "Recorded: back to preparing",
  eligibility_confirmed: "Recorded: organizer confirmed eligibility",
  eligibility_rejected: "Recorded: organizer said not eligible",
  admitted: "Recorded: admitted",
  not_admitted: "Recorded: not admitted",
  participated: "Recorded: took part",
  did_not_participate: "Recorded: did not take part",
  eligibility_cleared: "Cleared: eligibility confirmation (correction)",
  decision_cleared: "Cleared: admission decision (correction)",
  participation_cleared: "Cleared: participation (correction)",
};

export const materialKindLabels: Record<MaterialKind, string> = {
  resume: "Resume",
  transcript: "Transcript",
  personal_statement: "Personal statement",
  recommendation_letter: "Recommendation letter",
  portfolio: "Portfolio",
  essay: "Essay",
  other: "Other",
};

export const materialStatusLabels: Record<MaterialStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  ready: "Ready",
};

export const planStatusLabels: Record<CrossPlanItem["status"], string> = {
  planned: "Planned",
  blocked: "Blocked",
  past_deadline: "Past deadline",
  insufficient_data: "Not enough data",
};

export const planStatusTones: Record<CrossPlanItem["status"], "neutral" | "success" | "warning" | "danger"> = {
  planned: "success",
  blocked: "danger",
  past_deadline: "danger",
  insufficient_data: "warning",
};

export const routeLabels: Record<RouteType, string> = {
  learning_first: "Learning first",
  practice_first: "Practice first",
  community: "Community",
};

export function yesNoUnknown(value: boolean | null): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Unknown";
}

/** Local calendar date as YYYY-MM-DD. Call only after mount. */
export function localToday(): string {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function newLocalId(prefix: string): string {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${uuid}`;
}
