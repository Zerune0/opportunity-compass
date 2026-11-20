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
  if (view === "adventure") {
    return (
      <section className="rpg-stack" aria-label="Saved evidence">
        <h2>Saved evidence</h2>
        {empty && <p>No evidence saved yet.</p>}
        {Boolean(profile?.evidence.length) && <ul className="rpg-inventory">
          {profile?.evidence.map((item) => <li key={item.id}>
            <EvidenceCard item={item} ctx={ctx} onChange={onChange} onDelete={onDelete} view="adventure" />
          </li>)}
        </ul>}
      </section>
    );
  }
  return (
    <section className="rpg-stack" aria-label="Saved evidence">
      <h2>Saved evidence</h2>
      <div className="rpg-route-grid">
      {empty && <p>No evidence saved yet.</p>}
      {profile?.evidence.map((item) => <EvidenceCard key={item.id} item={item} ctx={ctx} onChange={onChange} onDelete={onDelete} />)}
      </div>
    </section>
  );
}
