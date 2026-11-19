"use client";

import { useId, useState, type ReactNode } from "react";
import { StatusTag } from "@/components/rpg";
import { resolveRecordDate } from "@/lib/journal";
import type { JournalEntry, JournalEvent } from "@/lib/types";
import {
  applicationLabels,
  decisionLabels,
  eligibilityLabels,
  participationLabel,
} from "./labels";

type Action = { event: JournalEvent; label: string; primary?: boolean };

/** Records an event on a given date (already checked: a real date, not after today). */
export type RecordHandler = (event: JournalEvent, on: string) => void;

const CLEAR_CONFIRM = "Clear this record? It stays in the history as a correction.";

function Line({
  label,
  value,
  tone,
  actions,
  clearEvent,
  hint,
  today,
  onRecord,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
  actions: Action[];
  /** Shown only when this line has a record to clear. */
  clearEvent?: JournalEvent;
  hint?: ReactNode;
  today: string;
  onRecord: RecordHandler;
}) {
  const dateId = useId();
  const [date, setDate] = useState(today);
  const on = resolveRecordDate(date, today);

  function clear() {
    if (!clearEvent || !window.confirm(CLEAR_CONFIRM)) return;
    onRecord(clearEvent, on);
  }

  return (
    <div className="rpg-stack">
      <dt><strong>{label}</strong></dt>
      <dd className="rpg-stack">
        <span><StatusTag tone={tone}>{value}</StatusTag></span>
        {hint && <span className="rpg-muted rpg-small">{hint}</span>}
        <span className="rpg-row">
          <label className="rpg-field rpg-small" htmlFor={dateId}>
            Date to record
            <input
              id={dateId}
              type="date"
              value={date}
              max={today}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
        </span>
        <span className="rpg-row">
          {actions.map((action) => (
            <button
              key={action.event}
              type="button"
              className={`rpg-button ${action.primary ? "rpg-button--primary" : "rpg-button--secondary"}`}
              onClick={() => onRecord(action.event, on)}
            >
              {action.label}
            </button>
          ))}
          {clearEvent && (
            <button type="button" className="rpg-button rpg-button--secondary" onClick={clear}>
              Clear this record
            </button>
          )}
        </span>
        {date && on !== date && (
          <span className="rpg-muted rpg-small">
            That date is in the future or not a valid date, so {today} (today) will be used.
          </span>
        )}
      </dd>
    </div>
  );
}

/** The four independent things a student records. Each is shown and recorded on its own line. */
export function StatusLines({
  entry,
  today,
  onRecord,
}: {
  entry: JournalEntry;
  today: string;
  onRecord: RecordHandler;
}) {
  const notSubmitted = entry.application !== "submitted";
  const afterSubmissionHint = notSubmitted ? "Usually only happens after you submit." : undefined;

  const applicationActions: Action[] =
    entry.application === "preparing"
      ? [
          { event: "submitted", label: "Record: I submitted", primary: true },
          { event: "withdrawn", label: "Record: I withdrew" },
        ]
      : entry.application === "submitted"
        ? [
            { event: "submitted", label: "Change the submission date" },
            { event: "withdrawn", label: "Record: I withdrew" },
            { event: "reopened", label: "I haven't submitted (back to preparing)" },
          ]
        : [{ event: "reopened", label: "Reopen: back to preparing", primary: true }];

  const applicationValue =
    entry.application === "submitted" && entry.submitted_on
      ? `${applicationLabels.submitted} on ${entry.submitted_on}`
      : applicationLabels[entry.application];

  const eligibilityActions: Action[] = ([
    { event: "eligibility_confirmed", label: "Record: organizer confirmed" },
    { event: "eligibility_rejected", label: "Record: organizer said not eligible" },
  ] as Action[]).filter((a) =>
    !(a.event === "eligibility_confirmed" && entry.eligibility_confirmation === "confirmed") &&
    !(a.event === "eligibility_rejected" && entry.eligibility_confirmation === "rejected"));

  const decisionActions: Action[] = ([
    { event: "admitted", label: "Record: admitted" },
    { event: "not_admitted", label: "Record: not admitted" },
  ] as Action[]).filter((a) => a.event !== entry.decision);

  const participationActions: Action[] = ([
    { event: "participated", label: "Record: I took part" },
    { event: "did_not_participate", label: "Record: I did not take part" },
  ] as Action[]).filter((a) =>
    !(a.event === "participated" && entry.participated === true) &&
    !(a.event === "did_not_participate" && entry.participated === false));

  return (
    <section className="rpg-stack" aria-label="What you have recorded">
      <p className="rpg-small">
        Submitting is not the same as being confirmed eligible, being admitted, or taking part. Each line is recorded
        separately, by you. You can pick an earlier date if something happened before today, and clear a record you
        made by mistake.
      </p>
      <dl className="rpg-stack">
        <Line
          label="Your application"
          value={applicationValue}
          tone={entry.application === "submitted" ? "success" : entry.application === "withdrawn" ? "danger" : "neutral"}
          actions={applicationActions}
          hint={entry.application === "withdrawn" ? "You recorded that you withdrew. You can reopen it at any time." : undefined}
          today={today}
          onRecord={onRecord}
        />
        <Line
          label="Eligibility confirmed by the organizer"
          value={eligibilityLabels[entry.eligibility_confirmation]}
          tone={entry.eligibility_confirmation === "confirmed" ? "success" : entry.eligibility_confirmation === "rejected" ? "danger" : "neutral"}
          actions={eligibilityActions}
          clearEvent={entry.eligibility_confirmation !== "unconfirmed" ? "eligibility_cleared" : undefined}
          hint={afterSubmissionHint}
          today={today}
          onRecord={onRecord}
        />
        <Line
          label="Admission decision"
          value={decisionLabels[entry.decision]}
          tone={entry.decision === "admitted" ? "success" : entry.decision === "not_admitted" ? "danger" : "neutral"}
          actions={decisionActions}
          clearEvent={entry.decision !== "pending" ? "decision_cleared" : undefined}
          hint={afterSubmissionHint}
          today={today}
          onRecord={onRecord}
        />
        <Line
          label="Participation"
          value={participationLabel(entry.participated)}
          tone={entry.participated === true ? "success" : entry.participated === false ? "warning" : "neutral"}
          actions={participationActions}
          clearEvent={entry.participated !== null ? "participation_cleared" : undefined}
          today={today}
          onRecord={onRecord}
        />
      </dl>
    </section>
  );
}
