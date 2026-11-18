"use client";

import { useEffect, useState } from "react";
import { diffRoutes, planRoutes } from "@/lib/path";
import { loadPlanSnapshots, pushPlanSnapshot } from "@/lib/store";
import type { Opportunity, PlanSnapshot, StudentProfile } from "@/lib/types";
import { RecommendationReplay } from "./RecommendationReplay";

export function ReplayHistory({ profile, opportunity, today }: {
  profile: StudentProfile; opportunity: Opportunity; today: string;
}) {
  const [snapshots, setSnapshots] = useState<PlanSnapshot[]>([]);
  const [selected, setSelected] = useState<string>("");

  useEffect(() => {
    const frame = window.setTimeout(() => {
      const history = loadPlanSnapshots(opportunity.id, profile.id);
      const previous = history.at(-1);
      const plan = planRoutes(profile, opportunity, { today });
      const inputs = {
        evidence_ids: profile.evidence.map((item) => item.id),
        hours_per_week_available: profile.hours_per_week_available ?? null,
        budget_usd: profile.budget_usd ?? null,
        grade: profile.grade ?? null, today,
      };
      if (previous && JSON.stringify(previous.inputs) === JSON.stringify(inputs) &&
          JSON.stringify(previous.plan) === JSON.stringify(plan)) {
        setSnapshots(history);
        return;
      }
      const added = inputs.evidence_ids.filter((id) => !previous?.inputs.evidence_ids.includes(id));
      const removed = previous?.inputs.evidence_ids.filter((id) => !inputs.evidence_ids.includes(id)) ?? [];
      const trigger = !previous ? "initial" : added.length ? "evidence_added" : removed.length ? "evidence_removed" : "profile_edited";
      const detail = added.length
        ? "Added evidence: " + profile.evidence.filter((item) => added.includes(item.id)).map((item) => item.title).join(", ")
        : removed.length ? "Removed supporting evidence."
        : "Profile or evaluation inputs changed; routes were recalculated.";
      setSnapshots(pushPlanSnapshot({
        id: crypto.randomUUID(), profile_id: profile.id, opportunity_id: opportunity.id,
        taken_on: today, plan, inputs, trigger, trigger_detail: detail,
      }));
    });
    return () => window.clearTimeout(frame);
  }, [profile, opportunity, today]);

  const after = snapshots.find((snapshot) => snapshot.id === selected) ?? snapshots.at(-1);
  const position = snapshots.findIndex((snapshot) => snapshot.id === after?.id);
  const before = snapshots[position - 1];
  if (!after || !before) return <p>Return after changing your profile or evidence to compare with this saved plan.</p>;
  const difference = diffRoutes(before.plan, after.plan);

  return <section className="rpg-stack">
    <label>Saved recommendation changes<select value={after.id} onChange={(event) => setSelected(event.target.value)}>
      {snapshots.slice(1).map((snapshot, index) => <option key={snapshot.id} value={snapshot.id}>
        {index + 1}. {snapshot.taken_on} · {snapshot.trigger.replaceAll("_", " ")}
      </option>)}
    </select></label>
    <RecommendationReplay before={before.plan} updated={after.plan}
      change={after.trigger_detail ?? after.trigger.replaceAll("_", " ")}
      reasons={difference.reasons} note="Recent plans are saved in this browser for this profile and opportunity." />
  </section>;
}
