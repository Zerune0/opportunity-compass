"use client";

import type { EvidenceItem, StudentProfile, ViewPreference } from "@/lib/types";
import { EvidenceCard } from "./EvidenceCard";
import type { LinkContext } from "./evidence-shared";

type Props = {
  /** undefined while the profile is still being read from this browser. */
  profile: StudentProfile | null | undefined;
  ctx: LinkContext | undefined;
  view: ViewPreference;
  /** Re-read storage after a write. */
  onChange: () => void;
  onDelete: (item: EvidenceItem) => void;
};

/**
 * The saved evidence list. Classic is a plain card grid; Adventure shows the same cards as an inventory of
 * slots. Both use the same EvidenceCard (same controls and handlers).
 */
export function SavedEvidence({ profile, ctx, view, onChange, onDelete }: Props) {
  const empty = profile !== undefined && !profile?.evidence.length;
  return (
    <section id="saved-evidence" className="rpg-stack" aria-label="Saved evidence">
      <h2>Saved evidence</h2>
      {empty && (
        <p>
          No evidence saved yet. The Adventure / Classic view changes how this list looks once you save an item.
        </p>
      )}
      {Boolean(profile?.evidence.length) && (
        <ul className={view === "adventure" ? "rpg-inventory" : "rpg-route-grid rpg-plain-list"}>
          {profile?.evidence.map((item) => <li key={item.id}>
            <EvidenceCard item={item} ctx={ctx} onChange={onChange} onDelete={onDelete} view={view} />
          </li>)}
        </ul>
      )}
    </section>
  );
}
