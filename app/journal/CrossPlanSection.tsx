"use client";

import { useState } from "react";
import { fmt } from "@/lib/format";
import { planAcrossOpportunities } from "@/lib/planner";
import type { JournalEntry, Material, Opportunity, StudentProfile } from "@/lib/types";
import { PlanItemsTable, WeeklyLoadTable } from "./PlanTables";

type Props = {
  profile: StudentProfile;
  entries: JournalEntry[];
  materials: Material[];
  findOpportunity: (id: string) => Opportunity | undefined;
  today: string;
};

function TextList({ id, title, items }: { id: string; title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rpg-card" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ul className="rpg-list">
        {items.map((text, index) => <li key={`${index}-${text}`}>{text}</li>)}
      </ul>
    </section>
  );
}

export function CrossPlanSection({ profile, entries, materials, findOpportunity, today }: Props) {
  // The student's own priority order. Kept only in component state; null = not given.
  const [priorities, setPriorities] = useState<string[] | null>(null);

  const active = entries.filter((entry) => entry.application !== "withdrawn");
  const opps = active.flatMap((entry) => {
    const opp = findOpportunity(entry.opportunity_id);
    return opp ? [opp] : [];
  });
  const missing = active.filter((entry) => !findOpportunity(entry.opportunity_id));
  const withdrawnCount = entries.length - active.length;
  const ids = opps.map((opp) => opp.id);

  // Keep the priority list in step with the current quests (drop removed ones, append new ones).
  const order = priorities === null
    ? ids
    : [...priorities.filter((id) => ids.includes(id)), ...ids.filter((id) => !priorities.includes(id))];

  const plan = opps.length > 0
    ? planAcrossOpportunities(profile, opps, {
        today,
        materials,
        ...(priorities === null ? {} : { priorities: order }),
      })
    : null;

  function move(index: number, delta: number) {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setPriorities(next);
  }

  const titleOf = (id: string) => findOpportunity(id)?.title ?? id;
  const zeroWithoutPrep = plan?.items.some((item) =>
    item.status === "planned" && item.hours_before_reuse === 0 &&
    (findOpportunity(item.opportunity_id)?.preparation.length ?? 0) === 0) ?? false;

  return (
    <section className="rpg-stack" aria-labelledby="journal-plan">
      <h2 id="journal-plan">Plan across my quests</h2>
      <p className="rpg-small">
        Calculated in this browser for {today}. Withdrawn quests are left out
        {withdrawnCount > 0 ? ` (${withdrawnCount} withdrawn)` : ""}. The order follows deadlines and is only a suggestion.
      </p>
      {missing.length > 0 && (
        <p className="rpg-small">
          Not included because they are no longer in the catalog: {missing.map((entry) => entry.opportunity_id).join(", ")}.
        </p>
      )}

      {!plan ? (
        <p className="rpg-muted">No active quests with catalog data to plan.</p>
      ) : (
        <>
          <PlanItemsTable items={plan.items} />
          {zeroWithoutPrep && (
            <p className="rpg-small">
              0 hours means the catalog lists no preparation steps for this opportunity yet, not that no preparation is needed.
            </p>
          )}

          <WeeklyLoadTable weeks={plan.weekly_load} titleOf={titleOf} />

          <section className="rpg-card" aria-labelledby="journal-reuse">
            <h3 id="journal-reuse">Material reuse</h3>
            {plan.reuse.length === 0 ? (
              <p className="rpg-muted">No material type is needed by more than one of these quests.</p>
            ) : (
              <ul className="rpg-list">
                {plan.reuse.map((reuse, index) => (
                  <li key={`${reuse.material_kind}-${index}`}>
                    <p>{reuse.note}</p>
                    <p className="rpg-small">
                      Quests: {reuse.opportunity_ids.map(titleOf).join("; ")} · Hours saved: {fmt(reuse.hours_saved)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <strong>Total: {fmt(plan.total_hours)} hours ({fmt(plan.total_hours_without_reuse)} without reuse)</strong>
            </p>
          </section>

          <TextList id="journal-conflicts" title="Conflicts" items={plan.conflicts} />
          <TextList id="journal-warnings" title="Warnings" items={plan.warnings} />
          <TextList id="journal-missing" title="Missing info" items={plan.missing_info} />

          {order.length > 1 && (
            <section className="rpg-card" aria-labelledby="journal-priority">
              <h3 id="journal-priority">My priority order (optional)</h3>
              <p className="rpg-small">
                Used only to show what the numbers would look like. The app does not tell you to drop anything.
              </p>
              <ol className="rpg-list">
                {order.map((id, index) => (
                  <li key={id} className="rpg-row">
                    <span>{index + 1}. {titleOf(id)}</span>
                    <button type="button" className="rpg-button rpg-button--secondary" disabled={index === 0}
                      onClick={() => move(index, -1)} aria-label={`Move ${titleOf(id)} up`}>
                      Up
                    </button>
                    <button type="button" className="rpg-button rpg-button--secondary" disabled={index === order.length - 1}
                      onClick={() => move(index, 1)} aria-label={`Move ${titleOf(id)} down`}>
                      Down
                    </button>
                  </li>
                ))}
              </ol>
              <p className="rpg-small">
                {priorities === null
                  ? "No priority order given yet."
                  : plan.conflicts.length > 0
                    ? "Your priority order is included in the conflict notes above."
                    : "No week is over your available hours, so your priority order changes nothing right now."}
              </p>
              {priorities !== null && (
                <button type="button" className="rpg-button rpg-button--secondary" onClick={() => setPriorities(null)}>
                  Clear my priority order
                </button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}
