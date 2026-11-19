import type { EvidenceKind, MaterialKind, PrepItem, RouteStep } from "@/lib/types";

const evidenceLabels: Record<EvidenceKind | MaterialKind, string> = {
  project: "Project", portfolio: "Portfolio", certificate: "Certificate",
  competition_result: "Competition result", work_experience: "Work experience",
  volunteer_experience: "Volunteer experience", course: "Course",
  recommendation_letter: "Recommendation letter", other: "Other",
  resume: "Resume", transcript: "Transcript", personal_statement: "Personal statement", essay: "Essay",
};

export function stepFields(step: RouteStep, prep?: PrepItem): [string, string][] {
  let official = "Not recorded";
  if (step.official === "official_requirement") official = `Stated by the organizer${prep?.source_text ? ` — ${prep.source_text}` : " — source: Not recorded"}`;
  if (step.official === "team_suggestion") official = "Suggested by our team — not required by the organizer";
  if (step.official === "application_step") official = "Application step";
  return [
    ["Why this step", step.relation?.trim() ? step.relation : "Not recorded"],
    ["Time and cost", `${step.hours} h · ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(step.cost_usd)}`],
    ["Evidence you can record", step.evidence_needed ? evidenceLabels[step.evidence_needed] ?? "Not recorded" : "Not recorded"],
    ["Official requirement?", official],
  ];
}
