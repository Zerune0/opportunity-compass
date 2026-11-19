import { StatusTag } from "@/components/rpg";
import type { JournalEntry, Opportunity } from "@/lib/types";
import { summarizeRecords } from "./record-summary";

export function RecordSummary({ entries, profileId, isSample, findOpportunity }: {
  entries: readonly JournalEntry[];
  profileId: string;
  isSample?: boolean;
  findOpportunity: (id: string) => Opportunity | undefined;
}) {
  const summary = summarizeRecords(entries, profileId);
  return (
    <section className="rpg-card" aria-labelledby="journal-record-summary">
      <h2 id="journal-record-summary">Your record so far</h2>
      <p>Only what you recorded on this device. Nothing here is sent anywhere.</p>
      {isSample && <p><StatusTag tone="warning">Sample</StatusTag></p>}
      <p>Each stage is counted separately from your current records. Submitting an application does not mean eligibility was confirmed, admission was granted, or participation happened. Counts update when you correct or remove a record.</p>
      <dl className="rpg-stack">
        {summary.stages.map((stage) => <div key={stage.label}>
          <dt>{stage.label}</dt>
          <dd>{stage.recorded ? stage.count : "Not recorded"}</dd>
        </div>)}
      </dl>
      <p>A count of 0 means you recorded a response, but none of those records matches this stage. Not recorded means no response is recorded for that stage.</p>
      <h3>Your notes</h3>
      {summary.notes.length ? <ul className="rpg-list">
        {summary.notes.map((note) => <li key={note.opportunityId}>
          <h4>{findOpportunity(note.opportunityId)?.title ?? "Opportunity no longer in the catalog"}</h4>
          <p style={{ whiteSpace: "pre-wrap" }}>{note.text}</p>
        </li>)}
      </ul> : <p>Not recorded</p>}
    </section>
  );
}
