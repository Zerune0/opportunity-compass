"use client";

import { useEffect, useState, type FormEvent } from "react";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { addEvidence, loadProfile, saveProfile } from "@/lib/store";
import type { EvidenceItem, EvidenceKind, StudentProfile } from "@/lib/types";

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
      .map((skill) => skill.trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean);
    const item: EvidenceItem = {
      id: crypto.randomUUID(), title, kind, skills: [...new Set(skills)],
      status: url ? "evidence_attached" : "self_reported",
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
  }

  return (
    <div className="rpg-stack">
      <h1>Skill Passport</h1>
      {profile?.is_sample && <StatusTag>Sample profile</StatusTag>}
      {opportunityId && <a href={`/map?opp=${encodeURIComponent(opportunityId)}`}>Return to Adventure Map</a>}
      <QuestCard>
        <h2>Add evidence</h2>
        <form className="rpg-stack rpg-evidence-form" onSubmit={submit}>
          <label>Title <input name="title" required /></label>
          <label>Type <select name="kind">{kinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll("_", " ")}</option>)}</select></label>
          <label>Skills, separated by commas <input name="skills" /></label>
          <label>Link <input name="url" type="url" /></label>
          <label>Description <textarea name="description" /></label>
          <RpgButton type="submit" disabled={profile === undefined}>Save evidence</RpgButton>
          <p role="status">{message}</p>
        </form>
      </QuestCard>
      <section className="rpg-stack" aria-label="Saved evidence">
        <h2>Saved evidence</h2>
        {profile !== undefined && !profile?.evidence.length && <p>No evidence saved yet.</p>}
        {profile?.evidence.map((item) => <QuestCard key={item.id}>
          <h3>{item.title}</h3>
          <StatusTag>{labels[item.status]}</StatusTag>
          {item.skills.length > 0 && <p>{item.skills.join(", ")}</p>}
          {item.description && <p>{item.description}</p>}
          {item.url && /^https?:\/\//i.test(item.url) && <a href={item.url}>View attached evidence</a>}
        </QuestCard>)}
      </section>
    </div>
  );
}
