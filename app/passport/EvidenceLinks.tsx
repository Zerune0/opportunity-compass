"use client";

import { useId, useState } from "react";
import { RpgButton } from "@/components/rpg";
import { unlinkEvidenceFromPrep, updateEvidence } from "@/lib/store";
import type { EvidenceItem } from "@/lib/types";
import { isCatalogOpportunity, resolveLink, type LinkContext, type ResolvedLink } from "./evidence-shared";
import { LinkStepForm } from "./LinkStepForm";

type Props = {
  item: EvidenceItem;
  ctx: LinkContext;
  /** Re-read storage after a write. */
  onChange: () => void;
};

function unlink(item: EvidenceItem, link: ResolvedLink) {
  if (link.opp) return unlinkEvidenceFromPrep(item.id, link.opp.id, link.key.slice(link.opp.id.length + 1));
  // A key whose opportunity is gone (or a bare step id) is removed as stored.
  return updateEvidence(item.id, { prep_item_ids: (item.prep_item_ids ?? []).filter((key) => key !== link.key) });
}

export function EvidenceLinks({ item, ctx, onChange }: Props) {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [mapId, setMapId] = useState("");
  const links = (item.prep_item_ids ?? []).map((key) => resolveLink(key, ctx));

  function remove(link: ResolvedLink) {
    const ok = unlink(item, link);
    setMapId("");
    setMessage(ok ? "Link removed." : "Could not remove the link.");
    if (ok) onChange();
  }

  return (
    <div className="rpg-stack">
      {links.length > 0 && <div>
        <h4>Linked preparation steps</h4>
        <ul className="rpg-list">
          {links.map((link, index) => <li key={`${link.key}-${index}`} className="rpg-row">
            <span>{link.opp && link.prep ? `${link.opp.title} → ${link.prep.title}` : "This step is no longer in the catalog."}</span>
            <RpgButton type="button" variant="secondary" onClick={() => remove(link)}
              aria-label={`Unlink ${item.title} from ${link.prep?.title ?? "a step that is no longer in the catalog"}`}>Unlink</RpgButton>
          </li>)}
        </ul>
      </div>}
      <RpgButton type="button" variant="secondary" aria-expanded={open} aria-controls={formId}
        onClick={() => setOpen((value) => !value)}>Link to a preparation step</RpgButton>
      {open && <LinkStepForm id={formId} item={item} ctx={ctx} onLinked={(text, opportunityId) => {
        setMessage(text);
        setMapId(opportunityId);
        onChange();
      }} />}
      <div role="status" className="rpg-small">
        {message && <p>{message}</p>}
        {mapId && (isCatalogOpportunity(mapId)
          ? <p><a href={`/map?opp=${encodeURIComponent(mapId)}`}>See the updated routes and the replay</a></p>
          : <p>Routes for opportunities posted in this browser are not shown on the Adventure Map yet.</p>)}
      </div>
    </div>
  );
}
