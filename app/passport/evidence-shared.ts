import opportunities from "@/data/opportunities.json";
import type { EvidenceItem, EvidenceKind, EvidenceStatus, Opportunity, PrepItem } from "@/lib/types";

export const catalog = opportunities as Opportunity[];

export const kinds = ["project", "portfolio", "certificate", "competition_result", "work_experience", "volunteer_experience", "course", "recommendation_letter", "other"] as const satisfies readonly EvidenceKind[];

/** Statuses a student can set on their own evidence. `reviewed` needs someone else, so it is never offered. */
export const studentStatuses = ["self_reported", "evidence_attached", "unverified"] as const satisfies readonly EvidenceStatus[];

export const statusLabels: Record<EvidenceStatus, string> = {
  self_reported: "Self-reported",
  evidence_attached: "Evidence attached",
  reviewed: "Reviewed",
  unverified: "Unverified",
};

export function kindLabel(kind: string): string {
  return kind.replaceAll("_", " ");
}

export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Same normalisation as the add form: trimmed, lower-case, spaces and hyphens become underscores, no duplicates. */
export function parseSkills(text: string): string[] {
  const skills = text.split(",").map((skill) => skill.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
  return [...new Set(skills)];
}

export function toStudentStatus(value: FormDataEntryValue | null): (typeof studentStatuses)[number] {
  return studentStatuses.find((status) => status === value) ?? "self_reported";
}

/** Local calendar date as YYYY-MM-DD. Call only after mount (effects and event handlers). */
export function localToday(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/** Browser-only context for linking evidence; read after mount. */
export type LinkContext = {
  userPosted: Opportunity[];
  journalIds: string[];
  savedIds: string[];
  today: string;
};

function allOpportunities(ctx: LinkContext): Opportunity[] {
  const seen = new Set<string>();
  return [...catalog, ...ctx.userPosted].filter((opp) => {
    if (seen.has(opp.id)) return false;
    seen.add(opp.id);
    return true;
  });
}

export function findOpportunity(id: string, ctx: LinkContext): Opportunity | undefined {
  return allOpportunities(ctx).find((opp) => opp.id === id);
}

export function isCatalogOpportunity(id: string): boolean {
  return catalog.some((opp) => opp.id === id);
}

/** Opportunities that have preparation steps, grouped Journal first, then Saved, then the rest. */
export function linkableGroups(ctx: LinkContext) {
  const withPrep = allOpportunities(ctx).filter((opp) => Array.isArray(opp.preparation) && opp.preparation.length > 0);
  const journal = withPrep.filter((opp) => ctx.journalIds.includes(opp.id));
  const saved = withPrep.filter((opp) => !ctx.journalIds.includes(opp.id) && ctx.savedIds.includes(opp.id));
  const rest = withPrep.filter((opp) => !journal.includes(opp) && !saved.includes(opp));
  return [
    { label: "In your Journal", items: journal },
    { label: "Saved", items: saved },
    { label: "All opportunities with preparation steps", items: rest },
  ].filter((group) => group.items.length > 0);
}

export type ResolvedLink = {
  key: string;
  opp?: Opportunity;
  prep?: PrepItem;
};

/** Reads a stored `prep_item_ids` entry (`<opportunity_id>:<prep_id>`, or a bare prep id). */
export function resolveLink(key: string, ctx: LinkContext): ResolvedLink {
  const opp = allOpportunities(ctx).find((item) => key.startsWith(`${item.id}:`));
  if (!opp) return { key };
  const prepId = key.slice(opp.id.length + 1);
  return { key, opp, prep: opp.preparation.find((prep) => prep.id === prepId) };
}

/** Honest notes when the evidence does not look like what the step asks for. */
export function mismatchNotes(item: EvidenceItem, prep: PrepItem): string[] {
  const notes: string[] = [];
  if (prep.evidence_kind && prep.evidence_kind !== item.kind) {
    notes.push(`This step expects evidence of type "${kindLabel(prep.evidence_kind)}".`);
  }
  const skill = prep.skill?.trim().toLowerCase();
  if (skill && !item.skills.some((entry) => entry.trim().toLowerCase() === skill)) {
    notes.push(`This step expects the skill "${prep.skill}".`);
  }
  return notes;
}
