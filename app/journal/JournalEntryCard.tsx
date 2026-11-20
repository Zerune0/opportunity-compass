"use client";

import Link from "next/link";
import { QuestCard, StatusTag } from "@/components/rpg";
import { resolveRecordDate } from "@/lib/journal";
import { recordJournalEvent, removeJournalEntry, toggleJournalTask } from "@/lib/store";
import { journalOfficialUrl } from "@/lib/official-link";
import { CONNECT_POST_TAG, ORGANIZER_DEMO_JOURNAL_NOTE, ORGANIZER_DEMO_TAG, sampleOrigin } from "@/lib/sample-origin";
import type { JournalEntry, JournalEvent, Opportunity, ViewPreference } from "@/lib/types";
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
  /** Classic (default) is the plain card; Adventure is a quest card with the same content and controls. */
  view?: ViewPreference;
};

export function JournalEntryCard({ entry, opportunity, profileId, today, onChange, view = "classic" }: Props) {
  const title = opportunity?.title ?? entry.opportunity_id;
  // Sample / user-posted records and placeholder addresses (example.com) are never shown as an official page.
  const officialUrl = journalOfficialUrl(opportunity, entry.official_url);
  const headingId = `journal-entry-${entry.id}`;

  function record(event: JournalEvent, chosenDate: string) {
    // Never record a future date: the date input has max = today, and anything else falls back to today.
    const on = resolveRecordDate(chosenDate, today);
    // Guide, never block: offer to also record the submission, but record the event either way.
    if (AFTER_SUBMISSION.includes(event) && entry.application === "preparing") {
      const dateText = on === today ? `today (${today})` : on;
      const alsoSubmitted = window.confirm(
        `You have not recorded a submission for this quest yet. Also record a submission dated ${dateText}? Choose Cancel to record only this event; you can record the submission separately with its own button.`,
      );
      if (alsoSubmitted) recordJournalEvent(profileId, entry.opportunity_id, "submitted", on);
    }
    recordJournalEvent(profileId, entry.opportunity_id, event, on);
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

  const titleText = opportunity ? <Link href={`/quests/${encodeURIComponent(entry.opportunity_id)}`}>{title}</Link> : title;

  const sampleNote = opportunity?.source_tier === "user_posted" ? (
    <p className="rpg-row"><StatusTag tone="warning">{sampleOrigin(opportunity) === "organizer_demo" ? ORGANIZER_DEMO_TAG : CONNECT_POST_TAG}</StatusTag></p>
  ) : opportunity?.is_sample && (
    <p className="rpg-row"><StatusTag tone="warning">Sample</StatusTag><span>This is a sample opportunity, not a verified one.</span></p>
  );

  const deadline = opportunity ? (
    <p>
      Deadline: {opportunity.deadline ?? "Unknown, check the official page"}
      {opportunity.deadline_note ? ` (${opportunity.deadline_note})` : ""}
    </p>
  ) : (
    <p><StatusTag tone="warning">Not in catalog</StatusTag> This opportunity is no longer in the catalog.</p>
  );

  const noOfficialPage = (
    <p className="rpg-muted">
      {opportunity?.source_tier === "user_posted"
        ? sampleOrigin(opportunity) === "organizer_demo"
          ? ORGANIZER_DEMO_JOURNAL_NOTE
          : "This is a sample record posted in this browser. It has no official page."
        : opportunity
          ? "This is a sample record. It has no official page."
          : "No official page is on record for this entry."}
    </p>
  );

  const statusLines = <StatusLines entry={entry} today={today} onRecord={record} />;

  const rest = <>
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
        <p className="rpg-small">Shown in the order you recorded them. The date on each line is the date you gave.</p>
        <ol className="rpg-list">
          {entry.history.map((item, index) => (
            <li key={`${item.event}-${item.on}-${index}`}>
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
  </>;

  // The header, status controls and feedback keep their positions when only the view changes.
  return (
    <QuestCard aria-labelledby={headingId} className={view === "adventure" ? "rpg-quest-card" : ""}>
      <header className={view === "adventure" ? "rpg-quest-card__head" : "rpg-stack"}>
        <h3 id={headingId}>{titleText}</h3>
        {sampleNote}
        {deadline}
        {officialUrl ? (
          <p className={view === "adventure" ? "rpg-row" : undefined}>
            <a className={view === "adventure" ? "rpg-button rpg-button--primary" : undefined}
              href={officialUrl} target="_blank" rel="noopener noreferrer">Official page (opens in a new tab)</a>
            {" "}<span>You can apply there directly at any time.</span>
          </p>
        ) : noOfficialPage}
      </header>
      <div className={view === "adventure" ? "rpg-quest-card__status" : undefined}>{statusLines}</div>
      {rest}
    </QuestCard>
  );
}
