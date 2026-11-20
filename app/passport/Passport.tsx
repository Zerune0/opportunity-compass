"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { renderedView, useViewPreference } from "@/components/rpg/view-preference";
import {
  addEvidence, loadJournal, loadProfile, loadSavedOpportunityIds, loadUserPostedOpportunities, removeEvidence, saveProfile,
} from "@/lib/store";
import type { EvidenceItem, StudentProfile } from "@/lib/types";
import { catalog as opportunities, isHttpUrl, kinds, localToday, parseSkills, toStudentStatus, type LinkContext } from "./evidence-shared";
import { ProfileEditor } from "./ProfileEditor";
import { SavedEvidence } from "./SavedEvidence";
import { SampleProfiles } from "./SampleProfiles";
import { StatusHelp } from "./StatusHelp";

/** Browser-only: call from effects and event handlers. */
function readLinkContext(profile: StudentProfile | null): LinkContext {
  return {
    userPosted: loadUserPostedOpportunities(),
    journalIds: profile ? loadJournal(profile.id).map((entry) => entry.opportunity_id) : [],
    savedIds: loadSavedOpportunityIds(),
    today: localToday(),
  };
}

export function Passport({ opportunityId }: { opportunityId?: string }) {
  // Read before the profile effect below, so the view is known by the time the evidence appears.
  const [view, , viewReady] = useViewPreference();
  const [profile, setProfile] = useState<StudentProfile | null>();
  const [message, setMessage] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [linkContext, setLinkContext] = useState<LinkContext>();
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  const skillOptions = [...new Set([
    ...(profile?.skills?.map((skill) => skill.name) ?? []),
    ...opportunities.flatMap((item) => item.preparation.flatMap((prep) => prep.skill ? [prep.skill] : [])),
  ])].sort();

  // Re-read localStorage after every write so the page shows what is stored.
  const refresh = useCallback(() => {
    const current = loadProfile();
    setProfile(current);
    setLinkContext(readLinkContext(current));
  }, []);

  function changeProfile(next: StudentProfile | null) {
    setProfile(next);
    setLinkContext(readLinkContext(next));
  }

  function deleteEvidence(item: EvidenceItem) {
    const linkCount = item.prep_item_ids?.length ?? 0;
    const linkNote = linkCount ? ` Its ${linkCount === 1 ? "link" : `${linkCount} links`} to preparation steps will be removed too.` : "";
    if (!window.confirm(`Delete evidence "${item.title}"?${linkNote}`)) return;
    const updated = removeEvidence(item.id);
    if (updated) refresh();
    setMessage(updated ? "Evidence deleted." : "Could not delete the evidence.");
  }

  useEffect(() => {
    const initialRead = window.setTimeout(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const url = String(data.get("url") ?? "").trim();
    const kind = kinds.find((value) => value === data.get("kind"));
    if (!title || !kind || (url && !isHttpUrl(url))) {
      setMessage("Enter a title, select a type, and use an HTTP or HTTPS link.");
      return;
    }
    const item: EvidenceItem = {
      id: crypto.randomUUID(), title, kind, skills: parseSkills(String(data.get("skills") ?? "")),
      status: toStudentStatus(data.get("status")),
      prep_item_ids: opportunity?.preparation.filter((prep) => data.getAll("prep").includes(prep.id)).map((prep) => `${opportunity.id}:${prep.id}`),
      url: url || null, description: String(data.get("description") ?? "").trim() || null,
      added_on: new Date().toISOString().slice(0, 10),
    };
    const current = loadProfile();
    const fresh: StudentProfile = {
      id: crypto.randomUUID(), display_name: "My profile", is_sample: false, evidence: [item],
    };
    const next = current ? addEvidence(item) : saveProfile(fresh) ? fresh : null;
    if (!next) {
      setMessage("Could not save evidence in this browser.");
      return;
    }
    refresh();
    setMessage("Evidence saved.");
    form.reset();
    setSkillsInput("");
    setSelectedSkill("");
  }

  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
      <h1>Skill Passport</h1>
      {profile?.is_sample && <p><StatusTag tone="warning">Sample profile</StatusTag> {profile.display_name}</p>}
      {opportunityId && <a className="rpg-button rpg-button--secondary" href={`/map?opp=${encodeURIComponent(opportunityId)}`}>Return to Adventure Map</a>}
      </header>
      <SampleProfiles profile={profile} onChange={changeProfile} />
      {profile && <QuestCard>
        <h2>Current profile</h2>
        <p>{profile.display_name}</p>
        <p>Grade: {profile.grade ?? "Unknown"} · Age: {profile.age ?? "Unknown"} · Region: {[profile.region?.country, profile.region?.state, profile.region?.locality].filter(Boolean).join(", ") || "Unknown"}</p>
        <p>Hours per week: {profile.hours_per_week_available ?? "Unknown"} · Budget (USD): {profile.budget_usd ?? "Unknown"}</p>
        <p>Transport: {profile.transport?.level ?? "Unknown"} · Devices: {profile.devices?.join(", ") ?? "Unknown"}</p>
        <p>Skills: {profile.skills?.map((skill) => skill.name + " (" + skill.level + ")").join(", ") ?? "Unknown"}</p>
        <p>Interests: {profile.interests?.join(", ") ?? "Unknown"}</p>
      </QuestCard>}
      {profile !== undefined && <ProfileEditor key={profile?.id ?? "new-profile"} profile={profile} onSave={setProfile} />}
      <QuestCard>
        <h2>Add evidence</h2>
        <form className="rpg-stack rpg-evidence-form" onSubmit={submit}>
          <label>Title <input name="title" required /></label>
          <label>Type <select name="kind">{kinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label>
          <label>Skills, separated by commas <input name="skills" value={skillsInput} onChange={(event) => setSkillsInput(event.target.value)} /></label>
          {skillOptions.length > 0 && <div className="rpg-row">
            <label>Choose an existing skill
              <select value={selectedSkill} onChange={(event) => setSelectedSkill(event.target.value)}>
                <option value="">Select a skill</option>
                {skillOptions.map((skill) => <option key={skill} value={skill}>{skill}</option>)}
              </select>
            </label>
            <RpgButton type="button" variant="secondary" disabled={!selectedSkill} onClick={() => {
              const entries = skillsInput.split(",").map((entry) => entry.trim()).filter(Boolean);
              setSkillsInput([...new Set([...entries, selectedSkill])].join(", "));
              setSelectedSkill("");
            }}>Add selected skill</RpgButton>
          </div>}
          <label>Status <select name="status">
            <option value="self_reported">Self-reported</option>
            <option value="evidence_attached">Evidence attached</option>
            <option value="unverified">Unverified</option>
          </select></label>
          <StatusHelp />
          {Boolean(opportunity?.preparation.length) && <fieldset>
            <legend>Related preparation steps for {opportunity?.title}</legend>
            {opportunity?.preparation.map((prep) => <label key={prep.id}>
              <input type="checkbox" name="prep" value={prep.id} /> {prep.title}
            </label>)}
          </fieldset>}
          <label>Link <input name="url" type="url" /></label>
          <label>Description <textarea name="description" /></label>
          <RpgButton type="submit" disabled={profile === undefined}>Save evidence</RpgButton>
          <p role="status">{message}</p>
        </form>
      </QuestCard>
      <SavedEvidence profile={profile} ctx={linkContext} view={renderedView(view, viewReady)} onChange={refresh} onDelete={deleteEvidence} />
    </div>
  );
}
