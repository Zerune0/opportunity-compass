"use client";

import type { JournalEntry, Opportunity, ViewPreference } from "@/lib/types";
import { JournalEntryCard } from "./JournalEntryCard";

type Props = {
  entries: JournalEntry[];
  findOpportunity: (id: string) => Opportunity | undefined;
  profileId: string;
  today: string;
  onChange: () => void;
  view: ViewPreference;
};

/** The Journal's entries: a plain stack in Classic, a list of quest cards in Adventure. Same cards, same controls. */
export function QuestList({ entries, findOpportunity, profileId, today, onChange, view }: Props) {
  const card = (entry: JournalEntry) => (
    <JournalEntryCard
      key={entry.id}
      entry={entry}
      opportunity={findOpportunity(entry.opportunity_id)}
      profileId={profileId}
      today={today}
      onChange={onChange}
      view={view}
    />
  );
  if (view === "adventure") {
    return <ul className="rpg-quest-list">{entries.map((entry) => <li key={entry.id}>{card(entry)}</li>)}</ul>;
  }
  return <div className="rpg-stack">{entries.map(card)}</div>;
}
