"use client";

import Link from "next/link";
import { useState } from "react";
import { catalogOpportunities, sampleProfiles } from "@/lib/data";
import { saveProfile } from "@/lib/store";
import type { StudentProfile } from "@/lib/types";

/** The demo pairing: a sample student whose routes for this real opportunity show several steps on the map. */
export const demoMapProfileId = "sample-maya";
export const demoMapOpportunityId = "noaa-hollings-scholarship-2027";

export function mapHref(opportunityId: string): string {
  return `/map?opp=${encodeURIComponent(opportunityId)}`;
}

/** The sample profile used for the one-click demo map, or null if the data no longer has it. */
export function demoMapProfile(): StudentProfile | null {
  return sampleProfiles().find((p) => p.id === demoMapProfileId) ?? null;
}

/**
 * One click from an empty map to a working one: loads the sample student into this browser and opens the map.
 * Only offered when no profile is loaded, so it never replaces a profile the student made.
 */
export function LoadSampleAndOpenMap({ opportunityId = demoMapOpportunityId }: { opportunityId?: string }) {
  const [error, setError] = useState<string>();
  const sample = demoMapProfile();
  if (!sample) return null;
  function start() {
    if (!sample || !saveProfile(structuredClone(sample))) {
      setError("Could not save the sample profile in this browser.");
      return;
    }
    // A full load, so the map reads the profile just saved (it reads storage once on mount).
    window.location.assign(mapHref(opportunityId));
  }
  return (
    <div className="rpg-stack">
      <button type="button" className="rpg-button rpg-button--primary" onClick={start}>
        Load {sample.display_name} and show the map
      </button>
      <p className="rpg-small rpg-muted">
        Sample: a fictional student, labelled Sample. You can switch or clear it in the Skill Passport.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

/** The map page without a chosen opportunity: a demo entry point and a list of opportunities to map. */
export function MapStart({ hasProfile, profileName }: { hasProfile: boolean; profileName?: string }) {
  const catalog = catalogOpportunities();
  const demo = catalog.find((o) => o.id === demoMapOpportunityId);
  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
        <h1>Adventure Map</h1>
        <p>Pick a real opportunity as your main quest. The map shows two or three preparation routes toward it, step by step.</p>
      </header>
      <section className="rpg-card rpg-stack" aria-labelledby="map-demo-title">
        <h2 id="map-demo-title">See a sample map</h2>
        {hasProfile ? (
          <>
            <p>Using your current profile{profileName ? ` (${profileName})` : ""}.</p>
            {demo && (
              <Link className="rpg-button rpg-button--primary" href={mapHref(demo.id)}>
                Open the map for {demo.title}
              </Link>
            )}
          </>
        ) : (
          <>
            <p>No profile is loaded in this browser yet.{demo ? ` This opens the map for ${demo.title}.` : ""}</p>
            <LoadSampleAndOpenMap />
          </>
        )}
      </section>
      <section className="rpg-stack" aria-labelledby="map-pick-title">
        <h2 id="map-pick-title">Or choose any opportunity</h2>
        <ul className="rpg-list">
          {catalog.map((o) => (
            <li key={o.id}>
              <Link href={mapHref(o.id)}>{o.title}</Link>
              <span className="rpg-small rpg-muted"> &middot; {o.organizer}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
