"use client";

import { useState, type FormEvent } from "react";
import { getJournalEntry, upsertJournalEntry } from "@/lib/store";
import type { JournalEntry, OutcomeFeedback } from "@/lib/types";

const questions = [
  { name: "discovered_new_opportunity", label: "Did you find this opportunity through this app (one you did not know before)?" },
  { name: "understood_eligibility", label: "Did you understand the eligibility requirements?" },
  { name: "completed_materials", label: "Did you finish your application materials?" },
] as const;

type QuestionName = (typeof questions)[number]["name"];

function toSelect(value: boolean | null | undefined): string {
  return value === true ? "yes" : value === false ? "no" : "";
}

function fromSelect(value: FormDataEntryValue | null): boolean | null {
  return value === "yes" ? true : value === "no" ? false : null;
}

/** Optional, voluntary feedback (JournalEntry.outcome). Saved through upsertJournalEntry; never sent anywhere. */
export function FeedbackForm({ entry, today, onChange }: { entry: JournalEntry; today: string; onChange: () => void }) {
  const [message, setMessage] = useState("");
  const outcome = entry.outcome ?? {};
  const formId = `feedback-${entry.id}`;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const current = getJournalEntry(entry.profile_id, entry.opportunity_id);
    if (!current) {
      setMessage("This entry no longer exists.");
      return;
    }
    const note = String(data.get("helpful_note") ?? "").trim();
    const next: OutcomeFeedback = { helpful_note: note || null, recorded_on: today };
    for (const q of questions) next[q.name as QuestionName] = fromSelect(data.get(q.name));
    upsertJournalEntry({ ...current, outcome: next });
    setMessage("Feedback saved in this browser.");
    onChange();
  }

  return (
    <details>
      <summary>Optional: your own feedback</summary>
      <form className="rpg-stack rpg-evidence-form" onSubmit={save} aria-describedby={`${formId}-note`}>
        <p id={`${formId}-note`} className="rpg-muted rpg-small">
          Voluntary and private to this browser. It is your own note, not a measure of any result.
          {outcome.recorded_on ? ` Last saved on ${outcome.recorded_on}.` : ""}
        </p>
        {questions.map((q) => (
          <label key={q.name}>
            {q.label}
            <select name={q.name} defaultValue={toSelect(outcome[q.name])}>
              <option value="">Not recorded</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
        ))}
        <label>
          What helped or did not help? (optional)
          <textarea name="helpful_note" rows={2} defaultValue={outcome.helpful_note ?? ""} />
        </label>
        <div className="rpg-row">
          <button type="submit" className="rpg-button rpg-button--secondary">Save feedback</button>
          <span role="status">{message}</span>
        </div>
      </form>
    </details>
  );
}
