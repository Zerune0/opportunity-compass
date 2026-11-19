"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  createJournalEntry, getJournalEntry, removeJournalEntry, upsertJournalEntry,
} from "../../../lib/store";
import type { ISODate, JournalTask, Opportunity, StudentProfile } from "../../../lib/types";

/** One task per preparation item: required items first, suggested ones marked as such. */
function tasksFromPreparation(opportunity: Opportunity): JournalTask[] {
  const items = Array.isArray(opportunity.preparation) ? opportunity.preparation : [];
  const valid = items.filter((item) => item && typeof item.id === "string" && typeof item.title === "string");
  const ordered = [
    ...valid.filter((item) => item.required_for_application === true),
    ...valid.filter((item) => item.required_for_application !== true),
  ];
  return ordered.map((item) => ({
    id: `task-${item.id}`,
    title: item.required_for_application === true ? item.title : `${item.title} (suggested)`,
    prep_item_id: item.id,
    done: false,
    done_on: null,
  }));
}

export function JournalButton({ opportunity, profile, today }: {
  opportunity: Opportunity; profile: StudentProfile | null; today: ISODate | null;
}) {
  const profileId = profile?.id ?? null;
  const [inJournal, setInJournal] = useState(false);

  useEffect(() => {
    // The journal lives in localStorage, so it is read after mount and re-read when it may have changed.
    const refresh = () => setInJournal(profileId ? getJournalEntry(profileId, opportunity.id) !== null : false);
    const initialRead = window.setTimeout(refresh, 0);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [profileId, opportunity.id]);

  function add() {
    if (!profileId || !today) return;
    // Another tab may already have added it: never overwrite an existing entry.
    if (getJournalEntry(profileId, opportunity.id) !== null) {
      setInJournal(true);
      return;
    }
    const entry = { ...createJournalEntry(profileId, opportunity, today), tasks: tasksFromPreparation(opportunity) };
    const list = upsertJournalEntry(entry);
    setInJournal(list.some((item) => item.opportunity_id === opportunity.id));
  }

  function remove() {
    if (!profileId) return;
    const ok = window.confirm(
      "Remove this opportunity from your Quest Journal? Its status lines, history, tasks and feedback will be deleted. Your materials stay in the Materials list.",
    );
    if (!ok) return;
    const list = removeJournalEntry(profileId, opportunity.id);
    setInJournal(list.some((entry) => entry.opportunity_id === opportunity.id));
  }

  return (
    <section className="rpg-card" aria-labelledby="journal-heading">
      <h2 id="journal-heading">Quest Journal</h2>
      {!profileId ? (
        <>
          <button type="button" className="rpg-button rpg-button--secondary" disabled aria-describedby="journal-needs-profile">
            Add to my Quest Journal
          </button>
          <p id="journal-needs-profile" className="rpg-muted rpg-small">
            You need a student profile first. <Link href="/passport">Create one in your Skill Passport</Link>.
          </p>
        </>
      ) : inJournal ? (
        <p className="rpg-row">
          <span className="rpg-tag rpg-tag--success">In your Quest Journal</span>
          <Link href="/journal">Open Quest Journal</Link>
          <button type="button" className="rpg-button rpg-button--secondary" onClick={remove}>Remove</button>
        </p>
      ) : (
        <button type="button" className="rpg-button rpg-button--primary" onClick={add} disabled={!today}>
          Add to my Quest Journal
        </button>
      )}
    </section>
  );
}
