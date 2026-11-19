import type { Opportunity } from "@/lib/types";

const fields: Record<string, string> = {
  deadline: "Application deadline — check the official page",
  requirements: "Official eligibility requirements",
  cost: "Participation costs",
  "cost.fee_usd": "Participation fee",
  location: "Location and participation format",
  time_commitment: "Program dates and time commitment",
  "time_commitment.hours_per_week": "Weekly program hours",
};

/** Presentation only: never changes which information the planner considers missing. */
export function missingInfoLabel(path: string, opportunities: readonly Pick<Opportunity, "id" | "title">[]): string {
  if (path === "options.today") return "Planning date — reload this page to try again";
  if (path === "profile.hours_per_week_available") return "Your available hours per week — add them in Skill Passport";
  if (path.startsWith("profile.")) return "Your profile needs more information — check Skill Passport";
  if (path.startsWith("opportunity.")) {
    const opportunity = [...opportunities].sort((a, b) => b.id.length - a.id.length)
      .find((opp) => path === `opportunity.${opp.id}` || path.startsWith(`opportunity.${opp.id}.`));
    const title = opportunity?.title ?? "An opportunity";
    const field = opportunity ? path.slice(`opportunity.${opportunity.id}`.length + 1) : "";
    return `${title}: ${fields[field] ?? "More opportunity information is needed — check the official page"}`;
  }
  if (/^(options|student|profile|opportunity)\./.test(path)) return "More planning information is needed";
  return path;
}
