"use client";

import { useId, useRef, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import type { EvidenceItem, ViewPreference } from "@/lib/types";
import { EvidenceEditForm } from "./EvidenceEditForm";
import { EvidenceLinks } from "./EvidenceLinks";
import { isHttpUrl, kindLabel, statusLabels, type LinkContext } from "./evidence-shared";
import { StatusHelp } from "./StatusHelp";

type Props = {
  item: EvidenceItem;
  ctx: LinkContext | undefined;
  /** Re-read storage after a write. */
  onChange: () => void;
  onDelete: (item: EvidenceItem) => void;
  /** Classic (default) is a plain card; Adventure is an inventory slot with the same controls. */
  view?: ViewPreference;
};

export function EvidenceCard({ item, ctx, onChange, onDelete, view = "classic" }: Props) {
  const editId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");

  function closeEditor(text: string) {
    setEditing(false);
    setMessage(text);
    editButton.current?.focus();
  }

  // The details and controls are the same in both views; only the card's head and frame differ.
  const body = <>
      {item.skills.length > 0 && <p className="rpg-row">{item.skills.map((skill) => <span key={skill} className="rpg-tag rpg-tag--success">{skill}</span>)}</p>}
      {item.description && <p>{item.description}</p>}
      {item.url && isHttpUrl(item.url) && <p><a href={item.url}>View attached evidence</a></p>}
      {/* Plain button with RpgButton's classes: RpgButton does not forward refs, and focus returns here after editing. */}
      <button ref={editButton} type="button" className="rpg-button rpg-button--secondary" aria-expanded={editing} aria-controls={editId}
        aria-label={`Edit evidence: ${item.title}`} onClick={() => { setEditing((value) => !value); setMessage(""); }}>Edit</button>
      {editing && <EvidenceEditForm id={editId} item={item}
        onSaved={(text) => { onChange(); closeEditor(text); }}
        onCancel={() => closeEditor("")} />}
      <p role="status" className="rpg-small">{message}</p>
      {ctx && <EvidenceLinks item={item} ctx={ctx} onChange={onChange} />}
      <RpgButton type="button" variant="secondary" onClick={() => onDelete(item)}>Delete evidence: {item.title}</RpgButton>
  </>;

  if (view === "adventure") return (
    <QuestCard className="rpg-slot">
      <h3>{item.title}</h3>
      <p className="rpg-slot__meta">
        <span className="rpg-slot__kind">{kindLabel(item.kind)}</span>
        <StatusTag>{statusLabels[item.status]}</StatusTag>
      </p>
      <StatusHelp />
      {body}
    </QuestCard>
  );

  return (
    <QuestCard>
      <h3>{item.title}</h3>
      <p className="rpg-row"><StatusTag>{statusLabels[item.status]}</StatusTag> <span>{kindLabel(item.kind)}</span></p>
      <StatusHelp />
      {body}
    </QuestCard>
  );
}
