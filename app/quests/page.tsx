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
const control = "rounded-md border border-current px-3 py-2 focus-visible:outline-2";

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
    <div lang="en" className="space-y-6">
      <h1 className="text-3xl font-bold">Quest Board</h1>
      <fieldset className="flex flex-wrap items-end gap-4">
        <legend className="mb-3 font-semibold">Filter opportunities</legend>
        <label className="grid gap-1">Type
          <select className={control} value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All types</option>
            {Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1">Grade or year
          <select className={control} value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All grades</option>
            {[9, 10, 11, 12, 13, 14, 15, 16, 17].map((level) =>
              <option key={level} value={level}>{level <= 12 ? `Grade ${level}` :
                level === 17 ? "Graduate or above" : `College year ${level - 12}`}</option>,
            )}
          </select>
        </label>
        <label className="flex items-center gap-2 py-2">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          Online or hybrid
        </label>
        <label className="flex items-center gap-2 py-2">
          <input type="checkbox" checked={free} onChange={(e) => setFree(e.target.checked)} />
          No program or travel fee
        </label>
      </fieldset>
      <p role="status">{visible.length} {visible.length === 1 ? "opportunity" : "opportunities"}</p>
      {visible.length === 0 && <p>{catalog.length === 0 ?
        "Verified opportunities will appear here once they are added." : "No opportunities match these filters."}</p>}
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((opportunity) => (
          <li key={opportunity.id} className="min-w-0 space-y-3 rounded-lg border p-4 wrap-break-word">
            <p>{categories[opportunity.category]} · {formats[opportunity.location.format]}</p>
            <h2 className="text-xl font-semibold">
              <Link className="underline" href={`/quests/${encodeURIComponent(opportunity.id)}`}>{opportunity.title}</Link>
            </h2>
            <p>{opportunity.organizer}</p>
            <p>{opportunity.summary}</p>
            <dl className="grid grid-cols-2 gap-2">
              <dt>Deadline</dt><dd>{opportunity.deadline ?? "Check with organizer"}</dd>
              <dt>Program fee</dt><dd>{opportunity.cost.fee_usd === null ? "Unknown" :
                opportunity.cost.fee_usd === 0 ? "Free" : `$${opportunity.cost.fee_usd}`}</dd>
              <dt>Source</dt><dd>{opportunity.is_sample ? "Sample" : "Official organizer"}</dd>
              {opportunity.verified_on && <><dt>Verified</dt><dd>{opportunity.verified_on}</dd></>}
            </dl>
            {!opportunity.is_sample && <a className="underline" href={opportunity.official_url}>Official application</a>}
          </li>
        ))}
      </ul>
    </div>
  );
}
