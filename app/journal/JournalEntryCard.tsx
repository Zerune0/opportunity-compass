"use client";

import Link from "next/link";
import { QuestCard, StatusTag } from "@/components/rpg";
import { recordJournalEvent, removeJournalEntry, toggleJournalTask } from "@/lib/store";
import type { JournalEntry, JournalEvent, Opportunity } from "@/lib/types";
import { FeedbackForm } from "./FeedbackForm";
import { StatusLines } from "./StatusLines";
import { eventLabels } from "./labels";

/** Events that usually only happen after an application is submitted. */
const AFTER_SUBMISSION: readonly JournalEvent[] = [
  "eligibility_confirmed",
  "eligibility_rejected",
  "admitted",
  "not_admitted",
];

type Props = {
  entry: JournalEntry;
  opportunity: Opportunity | undefined;
  profileId: string;
  today: string;
  onChange: () => void;
};

export function JournalEntryCard({ entry, opportunity, profileId, today, onChange }: Props) {
  const title = opportunity?.title ?? entry.opportunity_id;
  const officialUrl = opportunity?.official_url ?? entry.official_url;
  const headingId = `journal-entry-${entry.id}`;

  function record(event: JournalEvent) {
    // Guide, never block: offer to also record the submission, but record the event either way.
    if (AFTER_SUBMISSION.includes(event) && entry.application === "preparing") {
      const alsoSubmitted = window.confirm(
        `You have not recorded a submission for this quest yet. Also record a submission dated today (${today})? Choose Cancel to record only this event; you can record the submission separately with its own button.`,
      );
      if (alsoSubmitted) recordJournalEvent(profileId, entry.opportunity_id, "submitted", today);
    }
    recordJournalEvent(profileId, entry.opportunity_id, event, today);
    onChange();
  }

  function toggleTask(taskId: string, done: boolean) {
    toggleJournalTask(profileId, entry.opportunity_id, taskId, done, today);
    onChange();
  }

  function remove() {
    if (!window.confirm(`Remove "${title}" from your Quest Journal? Its history and tasks will be deleted. Your materials are kept.`)) return;
    removeJournalEntry(profileId, entry.opportunity_id);
    onChange();
  }

  const history = entry.history
    .map((item, index) => ({ ...item, index }))
    .sort((a, b) => (a.on === b.on ? a.index - b.index : a.on < b.on ? -1 : 1));

  return (
    <QuestCard aria-labelledby={headingId}>
      <h3 id={headingId}>
        {opportunity ? <Link href={`/quests/${encodeURIComponent(entry.opportunity_id)}`}>{title}</Link> : title}
      </h3>
      {opportunity?.source_tier === "user_posted" ? (
        <p className="rpg-row"><StatusTag tone="warning">User-posted · not verified against an official site · Sample</StatusTag></p>
      ) : opportunity?.is_sample && (
        <p className="rpg-row"><StatusTag tone="warning">Sample</StatusTag><span>This is a sample opportunity, not a verified one.</span></p>
      )}
      {opportunity ? (
        <p>
          Deadline: {opportunity.deadline ?? "Unknown, check the official page"}
          {opportunity.deadline_note ? ` (${opportunity.deadline_note})` : ""}
        </p>
      ) : (
        <p><StatusTag tone="warning">Not in catalog</StatusTag> This opportunity is no longer in the catalog.</p>
      )}
      {officialUrl && (
        <p>
          <a href={officialUrl} target="_blank" rel="noopener noreferrer">Official page (opens in a new tab)</a>
          {" "}· You can apply there directly at any time.
        </p>
      )}

      <StatusLines entry={entry} onRecord={record} />

      <section aria-labelledby={`${headingId}-tasks`} className="rpg-stack">
        <h4 id={`${headingId}-tasks`}>Tasks</h4>
        <p className="rpg-muted rpg-small">Ticking a task is your own note. It does not add evidence to your Skill Passport.</p>
        {entry.tasks.length === 0 ? (
          <p className="rpg-muted">The catalog lists no preparation steps for this opportunity yet. Check the official page for what to prepare.</p>
        ) : (
          <ul className="rpg-list">
            {entry.tasks.map((task) => (
              <li key={task.id}>
                <label className="rpg-check">
                  <input type="checkbox" checked={task.done} onChange={(event) => toggleTask(task.id, event.target.checked)} />
                  <span>{task.title}</span>
                  <span className="rpg-muted rpg-small">{task.done ? `Done${task.done_on ? ` on ${task.done_on}` : ""}` : "Not done"}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details>
        <summary>History ({entry.history.length})</summary>
        <ol className="rpg-list">
          {history.map((item) => (
            <li key={`${item.event}-${item.on}-${item.index}`}>
              <time dateTime={item.on}>{item.on}</time> · {eventLabels[item.event]}
            </li>
          ))}
        </ol>
      </details>

      <FeedbackForm entry={entry} today={today} onChange={onChange} />

      <div className="rpg-row">
        <button type="button" className="rpg-button rpg-button--secondary" onClick={remove}>
          Remove from Journal
        </button>
      </div>
    </QuestCard>
  );
}
