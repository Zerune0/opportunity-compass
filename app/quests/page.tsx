"use client";

import Link from "next/link";
import { useState } from "react";
import opportunities from "../../data/opportunities.json";
import type { Opportunity } from "../../lib/types";

const catalog = opportunities as Opportunity[];
const categories: Record<Opportunity["category"], string> = {
  research: "Research", scholarship: "Scholarship", hackathon: "Hackathon",
  competition: "Competition", internship: "Internship", fellowship: "Fellowship",
  summer_program: "Summer program", public_service: "Public service",
  project: "Project", other: "Other",
};
const formats = { online: "Online", hybrid: "Hybrid", in_person: "In person" };

export default function QuestBoard() {
  const [category, setCategory] = useState("");
  const [remote, setRemote] = useState(false);
  const [free, setFree] = useState(false);
  const [grade, setGrade] = useState("");
  const visible = catalog.filter((opportunity) => {
    if (category && opportunity.category !== category) return false;
    if (remote && opportunity.location.format === "in_person") return false;
    if (free && (opportunity.cost.fee_usd !== 0 ||
      opportunity.cost.requires_travel_expense !== false)) return false;
    return grade === "" || opportunity.requirements.every((rule) =>
      rule.type !== "grade" || !rule.hard ||
      (Number(grade) >= (rule.min ?? 1) && Number(grade) <= (rule.max ?? 17)),
    );
  });

  return (
    <div className="rpg-stack rpg-stack--loose">
      <h1>Quest Board</h1>
      <fieldset className="rpg-toolbar">
        <legend>Filter opportunities</legend>
        <label className="rpg-field">Type
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="rpg-field">Grade or year
          <select value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All grades</option>
            {[9, 10, 11, 12, 13, 14, 15, 16, 17].map((level) =>
              <option key={level} value={level}>{level <= 12 ? `Grade ${level}` :
                level === 17 ? "Graduate or above" : `College year ${level - 12}`}</option>,
            )}
          </select>
        </label>
        <label className="rpg-check">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          Online or hybrid
        </label>
        <label className="rpg-check">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          No program or travel fee
        </label>
      </fieldset>
      <div className="rpg-stack">
        <p role="status" className="rpg-muted">{visible.length} {visible.length === 1 ? "opportunity" : "opportunities"}</p>
        {visible.length === 0 && <p>{catalog.length === 0 ?
          "Verified opportunities will appear here once they are added." : "No opportunities match these filters."}</p>}
        <ul className="rpg-route-grid">
          {visible.map((opportunity) => (
            <li key={opportunity.id} className="rpg-card">
              <p className="rpg-row">
                <span className="rpg-tag">{categories[opportunity.category]}</span>
                <span className="rpg-tag">{formats[opportunity.location.format]}</span>
              </p>
              <h2>
                <Link href={`/quests/${encodeURIComponent(opportunity.id)}`}>{opportunity.title}</Link>
              </h2>
              <p className="rpg-muted">{opportunity.organizer}</p>
              <p>{opportunity.summary}</p>
              <dl>
                <dt>Deadline</dt><dd>{opportunity.deadline ?? "Check with organizer"}</dd>
                <dt>Program fee</dt><dd>{opportunity.cost.fee_usd === null ? "Unknown" :
                  opportunity.cost.fee_usd === 0 ? "Free" : `$${opportunity.cost.fee_usd}`}</dd>
                <dt>Source</dt><dd>{opportunity.is_sample ? "Sample" : "Official organizer"}</dd>
                {opportunity.verified_on && <><dt>Verified</dt><dd>{opportunity.verified_on}</dd></>}
              </dl>
              {!opportunity.is_sample && <p><a href={opportunity.official_url}>Official application</a></p>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
