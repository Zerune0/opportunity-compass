"use client";

import { useState, type FormEvent } from "react";
import { QuestCard, StatusTag } from "@/components/rpg";
import { getJournalEntry, removeMaterial, setMaterialStatus, upsertJournalEntry, upsertMaterial } from "@/lib/store";
import {
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  type JournalEntry,
  type Material,
  type MaterialKind,
  type MaterialStatus,
  type Opportunity,
} from "@/lib/types";
import { materialKindLabels, materialStatusLabels, newLocalId } from "./labels";

type Props = {
  profileId: string;
  materials: Material[];
  entries: JournalEntry[];
  findOpportunity: (id: string) => Opportunity | undefined;
  onChange: () => void;
};

export function MaterialsSection({ profileId, materials, entries, findOpportunity, onChange }: Props) {
  const [message, setMessage] = useState("");
  const [reusable, setReusable] = useState(true);
  const titleOf = (id: string) => findOpportunity(id)?.title ?? id;

  function changeStatus(material: Material, status: MaterialStatus) {
    setMaterialStatus(material.id, status);
    onChange();
  }

  function remove(material: Material) {
    if (!window.confirm(`Delete the material "${material.title}"? It will also be removed from every Journal entry that uses it.`)) return;
    removeMaterial(material.id);
    onChange();
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const kind = MATERIAL_KINDS.find((k) => k === data.get("kind")) as MaterialKind | undefined;
    const opportunityId = reusable ? null : String(data.get("opportunity_id") ?? "");
    const hoursRaw = String(data.get("estimated_hours") ?? "").trim();
    const hours = hoursRaw === "" ? null : Number(hoursRaw);
    if (!title || !kind) {
      setMessage("Enter a title and choose a type.");
      return;
    }
    if (!reusable && !opportunityId) {
      setMessage("Choose which quest this material is for, or mark it as reusable.");
      return;
    }
    if (hours !== null && (!Number.isFinite(hours) || hours < 0)) {
      setMessage("Estimated hours must be empty or a number of 0 or more.");
      return;
    }
    const material: Material = {
      id: newLocalId("material"),
      profile_id: profileId,
      kind,
      title,
      reusable,
      opportunity_id: opportunityId,
      estimated_hours: hours,
      status: "not_started",
    };
    upsertMaterial(material);
    // A material for one quest is also referenced from that quest's Journal entry.
    if (opportunityId) {
      const entry = getJournalEntry(profileId, opportunityId);
      if (entry && !entry.material_ids.includes(material.id)) {
        upsertJournalEntry({ ...entry, material_ids: [...entry.material_ids, material.id] });
      }
    }
    form.reset();
    setReusable(true);
    setMessage(`Added "${title}".`);
    onChange();
  }

  return (
    <section className="rpg-stack" aria-labelledby="journal-materials">
      <h2 id="journal-materials">My materials</h2>
      <p>Mark a material Ready and the plan below stops counting hours for the matching preparation step. Your own hour estimate is a note for you; the plan uses the catalog&apos;s hours.</p>

      {materials.length === 0 ? (
        <p className="rpg-muted">No materials yet.</p>
      ) : (
        <ul className="rpg-route-grid" aria-label="Saved materials">
          {materials.map((material) => (
            <li key={material.id} className="rpg-card">
              <h3>{material.title}</h3>
              <p className="rpg-row">
                <StatusTag>{materialKindLabels[material.kind]}</StatusTag>
                <StatusTag tone={material.reusable ? "success" : "neutral"}>
                  {material.reusable ? "Reusable across opportunities" : "For one opportunity"}
                </StatusTag>
              </p>
              {!material.reusable && material.opportunity_id && <p>For: {titleOf(material.opportunity_id)}</p>}
              <p>Estimated hours: {material.estimated_hours ?? "Unknown"}</p>
              <label className="rpg-field">
                Status
                <select
                  value={material.status}
                  onChange={(event) => changeStatus(material, event.target.value as MaterialStatus)}
                >
                  {MATERIAL_STATUSES.map((status) => (
                    <option key={status} value={status}>{materialStatusLabels[status]}</option>
                  ))}
                </select>
              </label>
              <button type="button" className="rpg-button rpg-button--secondary" onClick={() => remove(material)}>
                Delete material
              </button>
            </li>
          ))}
        </ul>
      )}

      <QuestCard aria-labelledby="journal-add-material">
        <h3 id="journal-add-material">Add a material</h3>
        <form className="rpg-stack rpg-evidence-form" onSubmit={add}>
          <label>Title <input name="title" required /></label>
          <label>
            Type
            <select name="kind" defaultValue="resume">
              {MATERIAL_KINDS.map((kind) => <option key={kind} value={kind}>{materialKindLabels[kind]}</option>)}
            </select>
          </label>
          <label className="rpg-check">
            <input type="checkbox" checked={reusable} onChange={(event) => setReusable(event.target.checked)} />
            Reusable across opportunities
          </label>
          {!reusable && (
            entries.length === 0 ? (
              <p className="rpg-muted">Add a quest to your Journal first, or mark the material as reusable.</p>
            ) : (
              <label>
                For which quest
                <select name="opportunity_id" required defaultValue="">
                  <option value="" disabled>Choose a quest</option>
                  {entries.map((entry) => (
                    <option key={entry.id} value={entry.opportunity_id}>{titleOf(entry.opportunity_id)}</option>
                  ))}
                </select>
              </label>
            )
          )}
          <label>
            Estimated hours (optional)
            <input name="estimated_hours" type="number" min="0" step="0.5" inputMode="decimal" />
          </label>
          <div className="rpg-row">
            <button type="submit" className="rpg-button rpg-button--primary">Add material</button>
            <span role="status">{message}</span>
          </div>
        </form>
      </QuestCard>
    </section>
  );
}
