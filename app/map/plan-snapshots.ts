import { diffRoutes } from "@/lib/path";
import type {
  Opportunity,
  PlanResult,
  PlanSnapshot,
  PlanSnapshotInputs,
  PlanTrigger,
  RouteDiff,
  StudentProfile,
} from "@/lib/types";

/** English label for each trigger (fallback for unexpected values from storage). */
export const TRIGGER_LABELS: Record<PlanTrigger, string> = {
  initial: "First plan for this opportunity",
  evidence_added: "Evidence added",
  evidence_removed: "Evidence removed",
  evidence_edited: "Evidence edited",
  profile_edited: "Profile edited",
  manual: "Routes recalculated",
};

export function triggerLabel(trigger: string): string {
  return (TRIGGER_LABELS as Record<string, string>)[trigger] ?? "Routes recalculated";
}

const FIELD_LABELS = {
  hours_per_week_available: "Weekly hours",
  budget_usd: "Budget",
  grade: "Grade",
} as const;

type ProfileField = keyof typeof FIELD_LABELS;
const PROFILE_FIELDS = Object.keys(FIELD_LABELS) as ProfileField[];

/** Evidence items that are objects with a string id (stored profiles may hold malformed elements). */
function evidenceItems(profile: StudentProfile): { id: string; title?: unknown }[] {
  const list: unknown[] = Array.isArray(profile.evidence) ? profile.evidence : [];
  return list.filter((item): item is { id: string; title?: unknown } =>
    item !== null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string");
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The inputs recorded with a snapshot (fields as defined by PlanSnapshotInputs). */
export function snapshotInputs(profile: StudentProfile, today: string | null): PlanSnapshotInputs {
  return {
    evidence_ids: evidenceItems(profile).map((item) => item.id),
    hours_per_week_available: numberOrNull(profile.hours_per_week_available),
    budget_usd: numberOrNull(profile.budget_usd),
    grade: numberOrNull(profile.grade),
    today,
  };
}

function show(field: ProfileField, value: number | null): string {
  if (value === null) return "not set";
  if (field === "budget_usd") return `$${value}`;
  if (field === "hours_per_week_available") return `${value} h`;
  return String(value);
}

export interface InputChanges {
  added_ids: string[];
  removed_ids: string[];
  changed_fields: ProfileField[];
  today_changed: boolean;
}

/** What differs between two snapshots' inputs (tolerates malformed stored inputs). */
export function compareInputs(before: Partial<PlanSnapshotInputs>, after: PlanSnapshotInputs): InputChanges {
  const beforeIds = new Set((Array.isArray(before.evidence_ids) ? before.evidence_ids : [])
    .filter((id): id is string => typeof id === "string"));
  const afterIds = new Set(after.evidence_ids);
  return {
    added_ids: after.evidence_ids.filter((id) => !beforeIds.has(id)),
    removed_ids: [...beforeIds].filter((id) => !afterIds.has(id)),
    changed_fields: PROFILE_FIELDS.filter((field) => numberOrNull(before[field]) !== after[field]),
    today_changed: (before.today ?? null) !== after.today,
  };
}

/** True when the plan itself changed (status, any route, or the blocking details). */
export function planChanged(before: PlanResult, after: PlanResult, diff: RouteDiff): boolean {
  try {
    if (diff.status_change) return true;
    if (diff.route_changes.some((change) => change.change !== "unchanged")) return true;
    if (before.status === "blocked" && after.status === "blocked") {
      const pick = (plan: typeof before) => JSON.stringify([plan.blocking_requirements, plan.reasons, plan.alternatives]);
      return pick(before) !== pick(after);
    }
    return false;
  } catch {
    // A malformed stored plan cannot be compared; treat it as changed.
    return true;
  }
}

export function safeDiff(before: PlanResult, after: PlanResult): RouteDiff | null {
  try {
    return diffRoutes(before, after);
  } catch {
    return null;
  }
}

function newId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `plan-snapshot-${random}`;
}

/**
 * Decide whether the current plan needs a new snapshot, given the latest stored one.
 * Returns the snapshot to store, or null when nothing should be stored:
 * - no snapshot yet -> `initial`;
 * - evidence added / removed or profile fields changed -> first matching trigger in that order,
 *   with every change listed in `trigger_detail` (one change per line);
 * - only the date changed, or nothing in the recorded inputs changed -> stored (as `manual`)
 *   only when the plan itself changed, so opening the map every day does not add entries.
 */
export function nextSnapshot(
  latest: PlanSnapshot | null,
  plan: PlanResult,
  profile: StudentProfile,
  opportunity: Opportunity,
  today: string,
): PlanSnapshot | null {
  const inputs = snapshotInputs(profile, today);
  const base = { id: newId(), profile_id: profile.id, opportunity_id: opportunity.id, taken_on: today, plan };
  if (!latest) return { ...base, inputs, trigger: "initial", trigger_detail: null };

  const changes = compareInputs(latest.inputs ?? {}, inputs);
  const evidence = evidenceItems(profile);
  const title = (id: string) => {
    const found = evidence.find((item) => item.id === id)?.title;
    return typeof found === "string" && found.trim() !== "" ? found : "an evidence item";
  };
  const removed = changes.removed_ids.length;
  const lines = [
    ...changes.added_ids.map((id) => `Added evidence: ${title(id)}`),
    ...(removed === 0 ? [] : [removed === 1
      ? "Removed an evidence item that is no longer in your Skill Passport"
      : `Removed ${removed} evidence items that are no longer in your Skill Passport`]),
    ...changes.changed_fields.map((field) =>
      `${FIELD_LABELS[field]}: ${show(field, numberOrNull(latest.inputs?.[field]))} → ${show(field, inputs[field])}`),
    ...(changes.today_changed ? [`Planning date: ${latest.inputs?.today ?? "not set"} → ${today}`] : []),
  ];

  let trigger: PlanTrigger;
  if (changes.added_ids.length > 0) trigger = "evidence_added";
  else if (changes.removed_ids.length > 0) trigger = "evidence_removed";
  else if (changes.changed_fields.length > 0) trigger = "profile_edited";
  else {
    const diff = safeDiff(latest.plan, plan);
    // A stored plan that cannot be compared (corrupted) counts as changed, so a fresh snapshot replaces it.
    if (diff && !planChanged(latest.plan, plan, diff)) return null;
    trigger = "manual";
    if (!changes.today_changed) {
      lines.push(
        "The recorded inputs (evidence list, weekly hours, budget, grade, date) did not change; "
        + "an evidence detail, another profile field, or the opportunity data may have changed.",
      );
    }
  }
  return {
    ...base,
    inputs: trigger === "profile_edited" ? { ...inputs, changed_fields: changes.changed_fields } : inputs,
    trigger,
    trigger_detail: lines.join("\n"),
  };
}
