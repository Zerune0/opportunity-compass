"use client";

import { useId, useState } from "react";
import { buildDeadlineCalendar, type CalendarItem, type CalendarSkipped } from "@/lib/calendar";
import { plural } from "@/lib/format";
import { localToday } from "./labels";

const FILE_NAME = "opportunity-compass-deadlines.ics";

/** "No deadline event for: …", noting quests whose program dates are still in the file. */
function noDeadlineNote(skipped: CalendarSkipped[], programIncluded: string[]): string {
  const names = skipped.map((s) =>
    programIncluded.includes(s.opportunity_id) ? `${s.title} (program dates are included)` : s.title,
  );
  return `No deadline event for: ${names.join("; ")}. The catalog lists no usable deadline for these.`;
}

type Props = {
  /** Active (not withdrawn) quests that are in the catalog, in Journal order. */
  items: CalendarItem[];
  /** Today's date, already read after mount by the Journal page. */
  today: string;
};

/** Download the Journal's deadlines as an .ics file, and print the plan. Everything stays on this device. */
export function CalendarExport({ items, today }: Props) {
  const [includeProgram, setIncludeProgram] = useState(false);
  const [status, setStatus] = useState("");
  const checkboxId = useId();
  const helpId = useId();

  const preview = buildDeadlineCalendar(items, { generatedOn: today, includeProgramDates: includeProgram });
  const canExport = preview.included.length > 0 || preview.program_included.length > 0;
  const noDeadline = preview.skipped.filter((s) => s.reason !== "withdrawn");

  function download() {
    const result = buildDeadlineCalendar(items, { generatedOn: localToday(), includeProgramDates: includeProgram });
    if (result.included.length === 0 && result.program_included.length === 0) return;
    const blob = new Blob([result.ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = FILE_NAME;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Give the browser a moment to start the download before releasing the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);

    const parts = [`Created ${FILE_NAME} with ${plural(result.included.length, "deadline")}`];
    if (includeProgram) parts.push(` and ${plural(result.program_included.length, "program period")}`);
    let message = `${parts.join("")}.`;
    const left = result.skipped.filter((s) => s.reason !== "withdrawn");
    if (left.length > 0) {
      message += ` ${noDeadlineNote(left, result.program_included)}`;
    }
    setStatus(message);
  }

  return (
    <section className="rpg-card print:hidden" aria-labelledby="journal-export">
      <h3 id="journal-export">Calendar and print</h3>
      <p className="rpg-small" id={helpId}>
        This creates a file on your device. Nothing is sent anywhere. Open it with your calendar app; add your own
        reminders there. Deadlines can change — confirm on the official page.
      </p>
      <p className="rpg-small">
        Each deadline is an all-day event. Any listed deadline time (for example a time zone) is written in the event
        notes, not as the event time. The file has no reminders.
      </p>
      <label htmlFor={checkboxId} className="rpg-row">
        <input
          id={checkboxId}
          type="checkbox"
          checked={includeProgram}
          onChange={(event) => setIncludeProgram(event.target.checked)}
        />
        <span>Also include program dates when the catalog lists them</span>
      </label>
      <div className="rpg-row">
        <button
          type="button"
          className="rpg-button rpg-button--primary"
          onClick={download}
          disabled={!canExport}
          aria-describedby={helpId}
        >
          Add deadlines to my calendar (.ics)
        </button>
        <button type="button" className="rpg-button rpg-button--secondary" onClick={() => window.print()}>
          Print this plan
        </button>
      </div>
      {!canExport && (
        <p className="rpg-small">
          {items.length === 0
            ? "No active quests from the catalog to export."
            : "None of your active quests has a deadline listed in the catalog, so there is nothing to put in a calendar file."}
        </p>
      )}
      {canExport && noDeadline.length > 0 && (
        <p className="rpg-small">
          {noDeadlineNote(noDeadline, preview.program_included)}
        </p>
      )}
      <p role="status" className="rpg-small">{status}</p>
    </section>
  );
}
