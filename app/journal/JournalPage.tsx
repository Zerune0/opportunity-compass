"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { StatusTag } from "@/components/rpg";
import {
  loadJournal,
  loadMaterials,
  loadProfile,
  loadUserPostedOpportunities,
} from "@/lib/store";
import { catalogOpportunities } from "@/lib/data";
import type { JournalEntry, Material, Opportunity, StudentProfile } from "@/lib/types";
import { CrossPlanSection } from "./CrossPlanSection";
import { JournalEntryCard } from "./JournalEntryCard";
import { MaterialsSection } from "./MaterialsSection";
import { localToday } from "./labels";

const catalog = catalogOpportunities();

type JournalContext = {
  profile: StudentProfile | null;
  entries: JournalEntry[];
  materials: Material[];
  userPosted: Opportunity[];
  today: string;
};

function readContext(): JournalContext {
  const profile = loadProfile();
  return {
    profile,
    entries: profile ? loadJournal(profile.id) : [],
    materials: profile ? loadMaterials(profile.id) : [],
    userPosted: loadUserPostedOpportunities(),
    today: localToday(),
  };
}

export function JournalPage() {
  const [context, setContext] = useState<JournalContext>();

  // Re-read localStorage after every write so the page always shows what is stored.
  const refresh = useCallback(() => setContext(readContext()), []);

  useEffect(() => {
    // Browser-only data (localStorage, local date) is read after mount.
    const initialRead = window.requestAnimationFrame(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.cancelAnimationFrame(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  const findOpportunity = (id: string): Opportunity | undefined =>
    catalog.find((opp) => opp.id === id) ?? context?.userPosted.find((opp) => opp.id === id);

  const profile = context?.profile;

  return (
    <div className="rpg-stack rpg-stack--loose print:bg-[#fff] print:shadow-[0_0_0_100vmax_white]">
      <header className="rpg-head crt print:bg-[#fff] print:text-black print:[&_*]:text-black print:[&_*]:[text-shadow:none] print:after:hidden">
        <h1>Quest Journal</h1>
        <p>Everything here is recorded by you and stays in this browser. Nothing is sent to any organizer.</p>
        {profile?.is_sample && (
          <p className="rpg-row">
            <StatusTag tone="warning">Sample</StatusTag>
            <span>{profile.display_name} is a sample student profile.</span>
          </p>
        )}
      </header>

      {context === undefined && <p>Loading your Journal…</p>}

      {context && !profile && (
        <section className="rpg-card" aria-labelledby="journal-no-profile">
          <h2 id="journal-no-profile">No profile yet</h2>
          <p>
            The Journal belongs to a student profile. Create one or load a sample in your{" "}
            <Link href="/passport">Skill Passport</Link> first.
          </p>
        </section>
      )}

      {context && profile && (
        <>
          <section className="rpg-stack print:hidden" aria-labelledby="journal-quests">
            <h2 id="journal-quests">My quests</h2>
            {context.entries.length === 0 ? (
              <div className="rpg-card">
                <p>
                  Your Journal is empty. Pick an opportunity on the <Link href="/quests">Quest Board</Link> and use
                  {" "}&quot;Add to my Quest Journal&quot; on its details page.
                </p>
              </div>
            ) : (
              <div className="rpg-stack">
                {context.entries.map((entry) => (
                  <JournalEntryCard
                    key={entry.id}
                    entry={entry}
                    opportunity={findOpportunity(entry.opportunity_id)}
                    profileId={profile.id}
                    today={context.today}
                    onChange={refresh}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Printing is for the cross-quest plan only; the editable sections stay on screen. */}
          <div className="print:hidden">
            <MaterialsSection
              profileId={profile.id}
              materials={context.materials}
              entries={context.entries}
              findOpportunity={findOpportunity}
              onChange={refresh}
            />
          </div>

          {context.entries.length > 0 && (
            <CrossPlanSection
              profile={profile}
              entries={context.entries}
              materials={context.materials}
              findOpportunity={findOpportunity}
              today={context.today}
            />
          )}
        </>
      )}
    </div>
  );
}
