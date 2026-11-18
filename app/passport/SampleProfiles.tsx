"use client";

import { useEffect, useRef, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import profilesJson from "@/data/profiles.json";
import { clearProfile, saveProfile } from "@/lib/store";
import type { StudentProfile } from "@/lib/types";
import { validateProfile } from "@/lib/validation";

// JSON literals widen to `string`; assert per CONTRACT.md, then validate each profile below.
const sampleProfiles = (profilesJson as unknown as StudentProfile[]).map((profile) => ({
  profile,
  problems: validateProfile(profile),
}));

const notProvided = "not provided";

function location(profile: StudentProfile) {
  const region = profile.region;
  if (!region) return notProvided;
  const parts = [region.country, region.state, region.locality].filter(Boolean);
  return parts.length ? parts.join(", ") : notProvided;
}

function devices(profile: StudentProfile) {
  if (profile.devices == null) return notProvided;
  if (profile.devices.length === 0) return "none reported";
  return profile.devices.map((device) => device.replaceAll("_", " ")).join(", ");
}

type Pending = { kind: "load"; profile: StudentProfile } | { kind: "clear" };

function evidenceCount(count: number) {
  return `${count} evidence item${count === 1 ? "" : "s"}`;
}

/**
 * Lets the demo load one of the sample profiles in data/profiles.json into localStorage
 * (the same key every page reads through loadProfile), or clear the current profile.
 * Overwriting or clearing an existing profile asks for confirmation inline first.
 */
export function SampleProfiles({ profile, onChange }: {
  /** undefined = localStorage not read yet (first render / SSR). */
  profile: StudentProfile | null | undefined;
  onChange: (next: StudentProfile | null) => void;
}) {
  const [pending, setPending] = useState<Pending>();
  const [message, setMessage] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** The button that opened the confirmation; focus goes back to it once the dialog closes. */
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const ready = profile !== undefined;

  // Another tab cleared the profile while "Clear" was waiting for confirmation: nothing left to clear.
  // Adjusting state during render (not in an effect) is the pattern React recommends for this.
  if (pending?.kind === "clear" && !profile) setPending(undefined);

  useEffect(() => {
    if (pending) {
      // Move focus into the inline confirmation so keyboard users land on it.
      document.getElementById("sample-confirm-cancel")?.focus();
      return;
    }
    // Runs after the re-render that re-enabled the buttons, so focus() works now.
    const target = returnFocusRef.current;
    if (!target) return;
    returnFocusRef.current = null;
    if (target.isConnected && !target.disabled) target.focus();
    else statusRef.current?.focus();
  }, [pending]);

  function load(sample: StudentProfile) {
    // Copy so later edits (Add evidence) never touch the imported module object.
    const copy = structuredClone(sample);
    if (!saveProfile(copy)) {
      setMessage("Could not save the profile in this browser.");
      return;
    }
    onChange(copy);
    setMessage(`Loaded sample profile: ${copy.display_name}.`);
  }

  function clear() {
    clearProfile();
    onChange(null);
    setMessage("Profile cleared.");
  }

  function request(next: Pending, trigger: HTMLButtonElement) {
    if (!profile) {
      if (next.kind === "load") load(next.profile);
      else clear();
      return;
    }
    returnFocusRef.current = trigger;
    setPending(next);
  }

  function confirm() {
    if (!pending) return;
    if (pending.kind === "load") load(pending.profile);
    else clear();
    returnFocusRef.current = null;
    setPending(undefined);
    statusRef.current?.focus();
  }

  function cancel() {
    // Focus is returned by the effect above, once the trigger button is enabled again.
    setPending(undefined);
  }

  const current = profile
    ? profile.is_sample
      ? `a sample profile “${profile.display_name}”`
      : "your own profile"
    : "";
  const originalSample = profile?.is_sample ? sampleProfiles.find(({ profile: sample }) => sample.id === profile.id)?.profile : undefined;
  const addedEvidence = profile
    ? !profile.is_sample || !originalSample || profile.evidence.length > originalSample.evidence.length
    : false;
  const evidenceWarning = profile && profile.evidence.length > 0
    ? `Evidence saved in this browser will be lost${addedEvidence ? ", including evidence you added" : ""}. `
    : "";

  return (
    <section className="rpg-stack" aria-labelledby="sample-profiles-heading">
      <h2 id="sample-profiles-heading">Sample profiles</h2>
      <p>These are fictional sample students for the demo. Loading one replaces the profile saved in this browser.</p>
      {pending && (
        <QuestCard
          role="alertdialog"
          aria-labelledby="sample-confirm-title"
          aria-describedby="sample-confirm-text"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
        >
          <h3 id="sample-confirm-title">
            {pending.kind === "load"
              ? profile
                ? `Replace the current profile with ${pending.profile.display_name}?`
                : `Load ${pending.profile.display_name}?`
              : "Clear the current profile?"}
          </h3>
          <p id="sample-confirm-text">
            {profile
              ? <>This browser has {current} with {evidenceCount(profile.evidence.length)}. {evidenceWarning}This cannot be undone.</>
              : "There is no profile saved in this browser right now."}
          </p>
          <div className="rpg-row">
            <RpgButton onClick={confirm}>
              {pending.kind === "load" ? (profile ? `Replace with ${pending.profile.display_name}` : `Load ${pending.profile.display_name}`) : "Clear profile"}
            </RpgButton>
            <RpgButton id="sample-confirm-cancel" variant="secondary" onClick={cancel}>Cancel</RpgButton>
          </div>
        </QuestCard>
      )}
      <div className="rpg-route-grid">
        {sampleProfiles.map(({ profile: sample, problems }) => (
          <QuestCard key={sample.id} className="rpg-stack">
            <h3>{sample.display_name}</h3>
            <p><StatusTag tone="warning">Sample</StatusTag></p>
            <dl>
              <dt>Grade</dt><dd>{sample.grade ?? notProvided}</dd>
              <dt>Location</dt><dd>{location(sample)}</dd>
              <dt>Hours per week</dt><dd>{sample.hours_per_week_available ?? notProvided}</dd>
              <dt>Devices</dt><dd>{devices(sample)}</dd>
              <dt>Evidence items</dt><dd>{sample.evidence.length}</dd>
            </dl>
            {problems.length > 0 ? (
              <div>
                <p>This sample profile cannot be loaded:</p>
                <ul className="rpg-list">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
              </div>
            ) : (
              <RpgButton
                disabled={!ready || pending !== undefined}
                onClick={(event) => request({ kind: "load", profile: sample }, event.currentTarget)}
              >
                {`Load ${sample.display_name}`}
              </RpgButton>
            )}
          </QuestCard>
        ))}
      </div>
      <div>
        <RpgButton
          variant="secondary"
          disabled={!profile || pending !== undefined}
          onClick={(event) => request({ kind: "clear" }, event.currentTarget)}
        >
          Clear profile
        </RpgButton>
      </div>
      <p role="status" ref={statusRef} tabIndex={-1}>{message}</p>
    </section>
  );
}
