import type { EvidenceKind, MaterialKind, PrepItem, RouteStep } from "@/lib/types";
import { parseSourceText } from "@/lib/source-text";

const evidenceLabels: Record<EvidenceKind | MaterialKind, string> = {
  project: "Project", portfolio: "Portfolio", certificate: "Certificate",
  competition_result: "Competition result", work_experience: "Work experience",
  volunteer_experience: "Volunteer experience", course: "Course",
  recommendation_letter: "Recommendation letter", other: "Other",
  resume: "Resume", transcript: "Transcript", personal_statement: "Personal statement", essay: "Essay",
};

/**
 * 「主办方说」只放官网原文：`Official excerpt: "…"` 标了原文时取引号内的内容，我们自己的核实说明另起一句 `Our note:`。
 * 没有这个前缀的旧写法（引擎按整段原文判为官方要求）整段当原文引用。
 */
function organizerSource(prep?: PrepItem): string {
  const parsed = parseSourceText(prep?.source_text);
  const excerpt = parsed.marked_official ? parsed.excerpt : parsed.notes;
  if (excerpt == null) return "Stated by the organizer — source: Not recorded";
  const note = parsed.marked_official && parsed.notes != null ? ` Our note: ${parsed.notes}` : "";
  return `Stated by the organizer — “${excerpt}”${note}`;
}

export function stepFields(step: RouteStep, prep?: PrepItem): [string, string][] {
  let official = "Not recorded";
  if (step.official === "official_requirement") official = organizerSource(prep);
  if (step.official === "team_suggestion") official = "Suggested by our team — not required by the organizer";
  if (step.official === "application_step") official = "Application step";
  return [
    ["Why this step", step.relation?.trim() ? step.relation : "Not recorded"],
    ["Time and cost", `${step.hours} h · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(step.cost_usd)}`],
    ["Evidence you can record", step.evidence_needed ? evidenceLabels[step.evidence_needed] ?? "Not recorded" : "Not recorded"],
    ["Official requirement?", official],
  ];
}

/**
 * Splits an "Official requirement?" value into a short label for a table cell and the longer source text
 * (organizer excerpt, our note), so the Classic table can tuck the long part behind a disclosure.
 */
export function splitOfficial(value: string): { label: string; detail: string | null } {
  const organizer = "Stated by the organizer — ";
  if (value.startsWith(organizer)) return { label: "Stated by the organizer", detail: value.slice(organizer.length) };
  const team = "Suggested by our team — ";
  if (value.startsWith(team)) return { label: "Our suggestion, not required", detail: null };
  return { label: value, detail: null };
}
