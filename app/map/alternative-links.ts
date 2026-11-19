import type { Opportunity } from "@/lib/types";

/** Only verified quest pages are linked; a hybrid remote hint may refer to the current quest. */
export function alternativeQuestHref(kind: string, id: string | null, currentId: string, catalog: readonly Pick<Opportunity, "id">[]): string | null {
  if (!id || kind === "next_cycle" || (kind === "remote_option" && id === currentId)) return null;
  return catalog.some((opportunity) => opportunity.id === id) ? `/quests/${encodeURIComponent(id)}` : null;
}
