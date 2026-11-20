"use client";

import { useEffect, useRef, useState } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { sampleProfiles as loadSampleProfiles } from "@/lib/data";
import { clearProfile, saveProfile } from "@/lib/store";
import type { StudentProfile } from "@/lib/types";
import { validateProfile } from "@/lib/validation";

// lib/data drops sample profiles that fail validation; problems stay here as a second check.
const sampleProfiles = loadSampleProfiles().map((profile) => ({
  profile,
  problems: validateProfile(profile),
}));

const notProvided = "not provided";

const additionalBackgrounds: Record<string, { name: string; paragraphs: string[] }> = {
  "sample-leo": {
    name: "Leo",
    paragraphs: [
      "Leo is a fictional grade 10 student at Example Valley Rural School in rural Montana. Age, citizenship and other eligibility statuses are not recorded; they should be confirmed rather than inferred from the school or location.",
      "Leo is interested in biology and data science and reports intermediate Python skills. No supporting evidence items are recorded yet, so the profile does not establish completed projects, course certificates or independently verified experience.",
      "The recorded availability is ten hours per week, with a budget of $40. Leo has a laptop and home internet, which can support online learning and project work, subject to each opportunity's requirements.",
      "Travel is the main recorded access constraint: the nearest city is two hours away each way, there is no public transit, and no transport access is recorded. A laptop and available study time alone do not make an in-person opportunity reachable.",
      "Use this sample to explore biology or data-science opportunities, compare remote options and identify evidence that could be built next. These are demo exploration directions, not recorded achievements or a promise of eligibility or admission.",
    ],
  },
  "sample-ana": {
    name: "Ana",
    paragraphs: [
      "Ana is a fictional 17-year-old US citizen in grade 12 at Example Heights High School in suburban New York. The profile records high-school student status; additional personal or family circumstances are not provided.",
      "Ana is interested in computer science and public health. She reports intermediate Python skills and beginner data-analysis skills. No evidence items are recorded, so these skill levels are not accompanied by a saved project, course record or verified credential.",
      "Her recorded availability is twelve hours per week, with a budget of $200. She has a laptop, webcam, home internet and smartphone, giving her equipment for a wider range of online activities, subject to their specific requirements.",
      "Her family can drive her, and her recorded travel limit is 60 minutes each way. This supports some local in-person options, but does not establish access to distant programs, accommodation or travel beyond that limit.",
      "Use this sample to explore opportunities connecting computing and public health, compare preparation routes and decide what evidence to record. More time, equipment and transport do not remove age, grade, deadline or organizer-specific requirements.",
    ],
  },
  "sample-noor": {
    name: "Noor",
    paragraphs: [
      "Noor is a fictional 18-year-old US citizen and first-generation undergraduate at Example Community College in suburban Ohio. Grade 13 represents the first undergraduate year in this demo.",
      "Noor is interested in biomedical research, STEM and data science and reports beginner Python skills. The profile includes a short Python script that cleans lab measurements from an introductory biology course.",
      "That script is recorded as self-reported project evidence with a Python tag. No public link or independent verification is recorded; it should not be presented as a verified research credential or proof of other skills.",
      "The recorded availability is five hours per week, with a budget of $30. Noor has a laptop and smartphone. Home internet is not recorded, so reliable internet access should be confirmed for activities that require it.",
      "Transport is limited: Noor shares a car with family, the bus runs only on weekdays, and the recorded travel limit is 40 minutes each way. Scheduling and transport can therefore constrain opportunities even when the academic requirements fit.",
      "Use this sample to explore research preparation and competition routes, distinguish organizer requirements from team suggestions and build on the existing course project. A suggested competition is not automatically an official requirement of the target opportunity.",
    ],
  },
};

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
            {sample.id === "sample-maya" && (
              <details>
                <summary>About Maya · background and goals</summary>
                <div className="rpg-stack">
                  <p>Maya is a fictional 16-year-old student in grade 11 at Example Bay High School in urban California. She is a US citizen from a low-income family and is a first-generation student.</p>
                  <p>She is interested in computer science and climate. She has started learning Python through introductory exercises on her phone. This is self-reported learning; no project portfolio or independently verified evidence is recorded.</p>
                  <p>She works after school and studies in short sessions. Her recorded availability is four hours per week, with a budget of $20. She has a smartphone, but no laptop is recorded.</p>
                  <p>She takes the bus and can travel up to 45 minutes each way. Opportunities need to fit her time, budget, transport and device access as well as her academic eligibility.</p>
                  <p>Use this sample to explore a practical next step in her interests and see how organizer support can change what is reachable. This background is fictional demo context, not an assessment of a real student.</p>
                </div>
              </details>
            )}
            {additionalBackgrounds[sample.id] && (
              <details>
                <summary>About {additionalBackgrounds[sample.id].name} · background and goals</summary>
                <div className="rpg-stack">
                  {additionalBackgrounds[sample.id].paragraphs.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  <p>This background is fictional demo context, not an assessment of a real student.</p>
                </div>
              </details>
            )}
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
