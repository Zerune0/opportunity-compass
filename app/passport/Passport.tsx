"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import opportunities from "@/data/opportunities.json";
import { addEvidence, loadProfile, removeEvidence, saveProfile } from "@/lib/store";
import type { EvidenceItem, EvidenceKind, StudentProfile } from "@/lib/types";
import { ProfileEditor } from "./ProfileEditor";
import { SampleProfiles } from "./SampleProfiles";

const kinds = ["project", "portfolio", "certificate", "competition_result", "work_experience", "volunteer_experience", "course", "recommendation_letter", "other"] as const satisfies readonly EvidenceKind[];
const labels = {
  self_reported: "Self-reported",
  evidence_attached: "Evidence attached",
  reviewed: "Reviewed",
  unverified: "Unverified",
};

export function Passport({ opportunityId }: { opportunityId?: string }) {
  const [profile, setProfile] = useState<StudentProfile | null>();
  const [message, setMessage] = useState("");
  const [skillsInput, setSkillsInput] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const opportunity = opportunities.find((item) => item.id === opportunityId);
  const skillOptions = [...new Set([
    ...(profile?.skills?.map((skill) => skill.name) ?? []),
    ...opportunities.flatMap((item) => item.preparation.flatMap((prep) => prep.skill ? [prep.skill] : [])),
  ])].sort();

  function deleteEvidence(item: EvidenceItem) {
    if (!window.confirm(`Delete evidence "${item.title}"?`)) return;
    const updated = removeEvidence(item.id);
    if (updated) setProfile(updated);
    setMessage(updated ? "Evidence deleted." : "Could not delete the evidence.");
  }
  useEffect(() => {
    function refresh() {
      setProfile(loadProfile());
    }

    const initialRead = window.requestAnimationFrame(refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.cancelAnimationFrame(initialRead);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const url = String(data.get("url") ?? "").trim();
    const kind = kinds.find((value) => value === data.get("kind"));
    if (!title || !kind || (url && !/^https?:\/\//i.test(url))) {
      setMessage("Enter a title, select a type, and use an HTTP or HTTPS link.");
      return;
    }
    const skills = String(data.get("skills") ?? "").split(",")
      .map((skill) => skill.trim().toLowerCase().replace(/[\s-]+/g, "_")).filter(Boolean);
    const item: EvidenceItem = {
      id: crypto.randomUUID(), title, kind, skills: [...new Set(skills)],
      status: data.get("status") === "unverified" ? "unverified" : data.get("status") === "evidence_attached" ? "evidence_attached" : "self_reported",
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
    setProfile(next);
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
      <SampleProfiles profile={profile} onChange={setProfile} />
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
      <section className="rpg-stack" aria-label="Saved evidence">
        <h2>Saved evidence</h2>
        <div className="rpg-route-grid">
        {profile !== undefined && !profile?.evidence.length && <p>No evidence saved yet.</p>}
        {profile?.evidence.map((item) => <QuestCard key={item.id}>
          <h3>{item.title}</h3>
          <RpgButton type="button" variant="secondary" onClick={() => deleteEvidence(item)}>Delete evidence: {item.title}</RpgButton>
          <p><StatusTag>{labels[item.status]}</StatusTag></p>
          {item.skills.length > 0 && <p className="rpg-row">{item.skills.map((skill) => <span key={skill} className="rpg-tag rpg-tag--success">{skill}</span>)}</p>}
          {item.description && <p>{item.description}</p>}
          {item.url && /^https?:\/\//i.test(item.url) && <p><a href={item.url}>View attached evidence</a></p>}
        </QuestCard>)}
        </div>
      </section>
    </div>
  );
}
