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
  // Keep the same keyed list and card positions in both views so drafts stay mounted.
  return (
    <ul className={view === "adventure" ? "rpg-quest-list" : "rpg-stack rpg-plain-list"}>
      {entries.map((entry) => <li key={entry.id}>
        <JournalEntryCard
          entry={entry}
          opportunity={findOpportunity(entry.opportunity_id)}
          profileId={profileId}
          today={today}
          onChange={onChange}
          view={view}
        />
      </li>)}
    </ul>
  );
}
