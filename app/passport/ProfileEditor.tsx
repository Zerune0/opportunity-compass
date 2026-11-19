"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QuestCard, RpgButton } from "@/components/rpg";
import { loadProfile, saveProfile } from "@/lib/store";
import { validateProfile, TRANSPORT_LEVELS, DEVICE_TYPES, STUDENT_STATUSES, SKILL_LEVELS } from "@/lib/validation";
import { ageOn } from "@/lib/eligibility/dates";
import type { StudentProfile, StudentSkill } from "@/lib/types";

const devices = DEVICE_TYPES;
const statuses = STUDENT_STATUSES;
const levels = SKILL_LEVELS;

/** Local calendar date as YYYY-MM-DD. Call only after mount (effects and event handlers). */
function localToday(): string {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function ProfileEditor({ profile, onSave }: {
  profile: StudentProfile | null;
  onSave: (profile: StudentProfile) => void;
}) {
  const [message, setMessage] = useState("");
  const [skills, setSkills] = useState(profile?.skills ?? []);
  const [ageInput, setAgeInput] = useState(profile?.age != null ? String(profile.age) : "");
  const [birthDate, setBirthDate] = useState(profile?.birth_date ?? "");
  // Today's date is read after mount (no clock reads during render).
  const [today, setToday] = useState("");
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setToday(localToday()));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const ageFromBirth = today && birthDate ? ageOn(birthDate, today) : null;
  const ageMismatch = ageFromBirth !== null && ageInput.trim() !== "" && Number(ageInput) !== ageFromBirth;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) ?? "").trim();
    const number = (name: string) => value(name) === "" ? null : Number(value(name));
    const list = (name: string) => [...new Set(value(name).split(",").map((entry) => entry.trim()).filter(Boolean))];
    const country = value("country").toUpperCase();
    const state = value("state").toUpperCase();
    const locality = (["urban", "suburban", "rural"] as const).find((item) => item === value("locality"));
    const transport = TRANSPORT_LEVELS.find((item) => item === value("transport"));
    if ((!country && (state || locality)) || (!transport && number("commute") !== null)) {
      setMessage("Enter a country code for region details and choose a transport level for a commute limit.");
      return;
    }

    const current = loadProfile();
    const selectedDevices = devices.filter((item) => data.has(item));
    const selectedStatuses = statuses.filter((item) => data.has(item));
    if ((data.has("devicesKnown") && selectedDevices.length > 0) ||
        (data.has("statusesKnown") && selectedStatuses.length > 0)) {
      setMessage("Choose individual options or None, then save again.");
      return;
    }
    const editedSkills: StudentSkill[] = skills.map((skill) => ({
      ...skill, name: skill.name.trim().toLowerCase().replace(/[\s-]+/g, "_"),
    })).filter((skill) => skill.name);
    const next: StudentProfile = {
      id: current?.id ?? crypto.randomUUID(),
      is_sample: current?.is_sample ?? false,
      display_name: current?.display_name ?? "My profile",
      evidence: current?.evidence ?? [],
      grade: number("grade"), age: number("age"),
      birth_date: value("birth_date") === "" ? null : value("birth_date"),
      region: country ? { ...current?.region, country, state: state || null, locality: locality ?? null } : null,
      hours_per_week_available: number("hours"), budget_usd: number("budget"),
      transport: transport ? { ...current?.transport, level: transport, max_one_way_minutes: number("commute") } : null,
      devices: selectedDevices.length || data.has("devicesKnown") ? selectedDevices : null,
      statuses: selectedStatuses.length || data.has("statusesKnown") ? selectedStatuses : null,
      skills: editedSkills.length ? editedSkills : null,
      citizenships: list("citizenships").map((item) => item.toUpperCase()),
      interests: list("interests").map((item) => item.toLowerCase()),
    };
    if (!next.citizenships?.length) next.citizenships = null;
    if (!next.interests?.length) next.interests = null;
    const problems = validateProfile(next, { today: today || localToday() });
    if (problems.length) {
      setMessage(problems.some((problem) => problem.includes("birth_date"))
        ? "Check the date of birth: use a real date that is not in the future, or leave it blank."
        : "Check the grade, country codes, and skill entries, then try saving again.");
      return;
    }
    if (!saveProfile(next)) {
      setMessage("Could not save the profile in this browser.");
      return;
    }
    onSave(next);
    setMessage("Profile saved.");
  }

  return <QuestCard>
    <h2>{profile ? "Edit profile" : "Create your profile"}</h2>
    <p>Your profile stays in this browser. Leave any field blank if you prefer. Related assessments may show Unknown.</p>
    <form className="rpg-stack rpg-evidence-form" onSubmit={submit}>
      <label>Grade (1–12 school, 13–16 undergraduate, 17 graduate)
        <input name="grade" type="number" min={1} max={17} defaultValue={profile?.grade ?? ""} />
      </label>
      <label>Age <input name="age" type="number" min={0} value={ageInput} onChange={(event) => setAgeInput(event.target.value)} /></label>
      <label>Date of birth (optional)
        <input name="birth_date" type="date" max={today || undefined} value={birthDate} onChange={(event) => setBirthDate(event.target.value)} aria-describedby="birth-date-help" />
      </label>
      <p id="birth-date-help">Only used to check age requirements exactly. Stays in this browser.</p>
      {ageMismatch && <p role="note">Your date of birth makes you {ageFromBirth} today, but Age says {ageInput}. Age requirements use your date of birth.</p>}
      <label>Country code <input name="country" pattern="[A-Za-z]{2}" placeholder="US" defaultValue={profile?.region?.country ?? ""} /></label>
      <label>State or province code <input name="state" defaultValue={profile?.region?.state ?? ""} /></label>
      <label>Area type <select name="locality" defaultValue={profile?.region?.locality ?? ""}>
        <option value="">Unknown</option>
        <option value="urban">Urban</option><option value="suburban">Suburban</option><option value="rural">Rural</option>
      </select></label>
      <label>Available hours per week <input name="hours" type="number" min={0} max={168} step="any" defaultValue={profile?.hours_per_week_available ?? ""} /></label>
      <label>Budget (USD) <input name="budget" type="number" min={0} step="any" defaultValue={profile?.budget_usd ?? ""} /></label>
      <label>Transport access <select name="transport" defaultValue={profile?.transport?.level ?? ""}>
        <option value="">Unknown</option>{TRANSPORT_LEVELS.map((item) => <option key={item}>{item}</option>)}
      </select></label>
      <label>Maximum one-way commute (minutes) <input name="commute" type="number" min={0} defaultValue={profile?.transport?.max_one_way_minutes ?? ""} /></label>
      <fieldset>
        <legend>Available devices</legend>
        {devices.map((item) => <label key={item}><input type="checkbox" name={item} defaultChecked={profile?.devices?.includes(item)} /> {item.replaceAll("_", " ")}</label>)}
        <label><input type="checkbox" name="devicesKnown" defaultChecked={profile?.devices?.length === 0} /> I have none of these devices</label>
      </fieldset>
      <fieldset>
        <legend>Skills and proficiency</legend>
        {skills.map((skill, index) => <div className="rpg-stack" key={index}>
          <label>Skill {index + 1} <input value={skill.name} onChange={(event) => setSkills(skills.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></label>
          <label>Proficiency <select value={skill.level} onChange={(event) => {
            const level = levels.find((item) => item === event.target.value);
            if (level) setSkills(skills.map((item, position) => position === index ? { ...item, level } : item));
          }}>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
          <RpgButton type="button" variant="secondary" onClick={() => setSkills(skills.filter((_, position) => position !== index))}>Remove skill {index + 1}</RpgButton>
        </div>)}
        <RpgButton type="button" variant="secondary" onClick={() => setSkills([...skills, { name: "", level: "beginner" }])}>Add skill</RpgButton>
      </fieldset>
      <label>Interests (comma-separated) <input name="interests" defaultValue={profile?.interests?.join(", ")} /></label>
      <fieldset>
        <legend>Optional eligibility information</legend>
        <label>Citizenship or legal residence country codes (comma-separated) <input name="citizenships" defaultValue={profile?.citizenships?.join(", ")} /></label>
        {statuses.map((item) => <label key={item}><input type="checkbox" name={item} defaultChecked={profile?.statuses?.includes(item)} /> {item.replaceAll("_", " ")}</label>)}
        <label><input type="checkbox" name="statusesKnown" defaultChecked={profile?.statuses?.length === 0} /> None of these apply</label>
      </fieldset>
      <RpgButton type="submit">Save profile</RpgButton>
      <p role="status">{message}</p>
    </form>
  </QuestCard>;
}
