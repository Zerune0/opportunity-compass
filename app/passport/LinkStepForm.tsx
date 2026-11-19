"use client";

import { useState, type FormEvent } from "react";
import { RpgButton } from "@/components/rpg";
import { catalogOpportunities } from "@/lib/data";
import { planRoutes } from "@/lib/path";
import { latestPlanSnapshot, linkEvidenceToPrep, loadProfile, prepLinkKey, pushPlanSnapshot } from "@/lib/store";
import type { EvidenceItem, Opportunity, StudentProfile } from "@/lib/types";
import { evidenceLinkSnapshots } from "@/app/map/evidence-link-snapshots";
import { findOpportunity, isCatalogOpportunity, kindLabel, linkableGroups, mismatchNotes, type LinkContext } from "./evidence-shared";

type Props = {
  id: string;
  item: EvidenceItem;
  ctx: LinkContext;
  /** Called after a successful write, with what the planner now says and the opportunity that was linked. */
  onLinked: (message: string, opportunityId: string) => void;
};

/** Ask the planner (lib/path) whether the linked step is now skipped. The page does not apply its own rule. */
// Same catalog the map page passes to planRoutes, so the replay does not show a competition route coming and going.
const catalog = catalogOpportunities();

function plannerVerdict(profile: StudentProfile, opp: Opportunity, prepId: string, today: string): string {
  const plan = planRoutes(profile, opp, { today, catalog });
  if (plan.status === "blocked") {
    const reason = plan.reasons[0] ?? "A required eligibility condition is not met.";
    return `Linked, but the planner shows no routes for this opportunity. ${reason}`;
  }
  const steps = plan.routes.flatMap((route) => route.steps).filter((step) => step.prep_item_id === prepId);
  if (steps.length === 0) return "Linked. The planner does not show this step in any route, so there is nothing to skip.";
  if (steps.some((step) => step.skipped)) return "The planner now treats this step as covered.";
  return "Linked, but the planner still lists this step.";
}

export function LinkStepForm({ id, item, ctx, onLinked }: Props) {
  const [oppId, setOppId] = useState("");
  const [prepId, setPrepId] = useState("");
  const [error, setError] = useState("");
  const groups = linkableGroups(ctx);
  const opp = oppId ? findOpportunity(oppId, ctx) : undefined;
  const prep = opp?.preparation.find((entry) => entry.id === prepId);
  const alreadyLinked = Boolean(opp && prep && (item.prep_item_ids ?? []).includes(prepLinkKey(opp.id, prep.id)));
  const notes = prep ? mismatchNotes(item, prep) : [];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!opp || !prep) {
      setError("Choose an opportunity and one of its preparation steps.");
      return;
    }
    const before = loadProfile();
    if (!linkEvidenceToPrep(item.id, opp.id, prep.id)) {
      setError("Could not save the link in this browser.");
      return;
    }
    const profile = loadProfile();
    if (before && profile && isCatalogOpportunity(opp.id)) {
      const snapshots = evidenceLinkSnapshots(latestPlanSnapshot(opp.id, profile.id), before, profile, opp, item.id, prep.id, ctx.today, catalog);
      snapshots.forEach((snapshot) => pushPlanSnapshot(snapshot));
    }
    setError("");
    setPrepId("");
    onLinked(profile ? plannerVerdict(profile, opp, prep.id, ctx.today) : "Linked.", opp.id);
  }

  if (groups.length === 0) return <p id={id}>No opportunity with preparation steps is available yet.</p>;

  return (
    <form id={id} className="rpg-stack rpg-evidence-form" onSubmit={submit} aria-label={`Link ${item.title} to a preparation step`}>
      <label>Opportunity
        <select value={oppId} onChange={(event) => { setOppId(event.target.value); setPrepId(""); setError(""); }}>
          <option value="">Select an opportunity</option>
          {groups.map((group) => <optgroup key={group.label} label={group.label}>
            {group.items.map((entry) => <option key={entry.id} value={entry.id}>
              {entry.title}{entry.is_sample ? " (Sample)" : ""}
            </option>)}
          </optgroup>)}
        </select>
      </label>
      <label>Preparation step
        <select value={prepId} disabled={!opp} onChange={(event) => { setPrepId(event.target.value); setError(""); }}>
          <option value="">Select a step</option>
          {opp?.preparation.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
        </select>
      </label>
      {prep && <div className="rpg-small">
        <p>Expected evidence type: {prep.evidence_kind ? kindLabel(prep.evidence_kind) : "not specified"} · Expected skill: {prep.skill || "not specified"}</p>
        {notes.length > 0 && <p>{notes.join(" ")} If you link it, the planner will count this step as covered even though the type or skill differs. Link it only if this evidence really shows this step.</p>}
        {alreadyLinked && <p>This evidence is already linked to this step.</p>}
      </div>}
      <div className="rpg-row">
        <RpgButton type="submit" disabled={!prep || alreadyLinked}>Link evidence to this step</RpgButton>
      </div>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
