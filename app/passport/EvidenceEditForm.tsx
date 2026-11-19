"use client";

import { useState, type FormEvent } from "react";
import { RpgButton } from "@/components/rpg";
import { updateEvidence } from "@/lib/store";
import type { EvidenceItem } from "@/lib/types";
import { isHttpUrl, kindLabel, kinds, parseSkills, statusLabels, studentStatuses, toStudentStatus } from "./evidence-shared";
import { StatusHelp } from "./StatusHelp";

type Props = {
  id: string;
  item: EvidenceItem;
  /** Called after a successful write; `message` is announced by the card. */
  onSaved: (message: string) => void;
  onCancel: () => void;
};

export function EvidenceEditForm({ id, item, onSaved, onCancel }: Props) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const url = String(data.get("url") ?? "").trim();
    const kind = kinds.find((value) => value === data.get("kind"));
    if (!title || !kind || (url && !isHttpUrl(url))) {
      setError("Enter a title, select a type, and use an HTTP or HTTPS link.");
      return;
    }
    const statusValue = data.get("status");
    const updated = updateEvidence(item.id, {
      title,
      kind,
      skills: parseSkills(String(data.get("skills") ?? "")),
      // A status set by someone else ("reviewed") is kept only if the student leaves it unchanged.
      status: statusValue === "reviewed" && item.status === "reviewed" ? "reviewed" : toStudentStatus(statusValue),
      url: url || null,
      description: String(data.get("description") ?? "").trim() || null,
    });
    if (!updated) {
      setError("Could not save the changes in this browser.");
      return;
    }
    onSaved("Changes saved.");
  }

  return (
    <form id={id} className="rpg-stack rpg-evidence-form" onSubmit={submit} aria-label={`Edit evidence: ${item.title}`}>
      <label>Title <input name="title" required defaultValue={item.title} /></label>
      <label>Type <select name="kind" defaultValue={item.kind}>
        {kinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
      </select></label>
      <label>Skills, separated by commas <input name="skills" defaultValue={item.skills.join(", ")} /></label>
      <label>Status <select name="status" defaultValue={item.status}>
        {studentStatuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
        {item.status === "reviewed" && <option value="reviewed">{statusLabels.reviewed} (keep as is)</option>}
      </select></label>
      <StatusHelp />
      <label>Link <input name="url" type="url" defaultValue={item.url ?? ""} /></label>
      <label>Description <textarea name="description" defaultValue={item.description ?? ""} /></label>
      <div className="rpg-row">
        <RpgButton type="submit">Save changes</RpgButton>
        <RpgButton type="button" variant="secondary" onClick={onCancel}>Cancel</RpgButton>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
