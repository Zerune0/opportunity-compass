"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import catalogJson from "@/data/opportunities.json";
import { QuestCard, RpgButton, StatusTag } from "@/components/rpg";
import { planRoutes } from "@/lib/path";
import { planAcrossOpportunities } from "@/lib/planner";
import {
  loadProfile, loadJournal, createJournalEntry, upsertJournalEntry, recordJournalEvent,
  toggleJournalTask, loadMaterials, upsertMaterial, setMaterialStatus, getJournalEntry,
} from "@/lib/store";
import { JOURNAL_EVENTS, MATERIAL_STATUSES } from "@/lib/types";
import type { JournalEntry, JournalEvent, Material, Opportunity, StudentProfile } from "@/lib/types";

const catalog = catalogJson as Opportunity[];
const eventLabels: Record<JournalEvent, string> = {
  added: "Added", submitted: "Submitted application", withdrawn: "Withdrew application",
  reopened: "Resume preparation", eligibility_confirmed: "Organizer confirmed eligibility",
  eligibility_rejected: "Organizer rejected eligibility", admitted: "Admitted",
  not_admitted: "Not admitted", participated: "Participated", did_not_participate: "Did not participate",
};

export function Journal({ opportunityId }: { opportunityId?: string }) {
  const [profile, setProfile] = useState<StudentProfile | null>();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [today, setToday] = useState("");
  const [message, setMessage] = useState("");

  function refresh() {
    const current = loadProfile();
    setProfile(current);
    setEntries(current ? loadJournal(current.id) : []);
    setMaterials(current ? loadMaterials(current.id) : []);
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      refresh();
      const date = new Date();
      setToday(new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10));
    });
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  function add(opportunity: Opportunity) {
    if (!profile) return;
    if (getJournalEntry(profile.id, opportunity.id)) {
      setMessage("This opportunity is already in your Journal.");
      return;
    }
    const entry = createJournalEntry(profile.id, opportunity, today);
    upsertJournalEntry(entry);
    refresh();
    setMessage("Opportunity added. Choose a route to create its checklist.");
  }

  function chooseRoute(entry: JournalEntry, opportunity: Opportunity, routeId: string) {
    if (!profile) return;
    const plan = planRoutes(profile, opportunity, { today });
    const route = plan.routes.find((item) => item.id === routeId);
    if (!route) return;
    if (entry.tasks.length && !window.confirm("Replace the checklist with this route? Matching task completion will be kept.")) return;
    upsertJournalEntry({
      ...entry, route_type: route.type,
      tasks: route.steps.map((step) => {
        const previous = entry.tasks.find((task) => task.id === step.id);
        return { id: step.id, title: step.title, prep_item_id: step.prep_item_id,
          done: previous?.done ?? false, done_on: previous?.done_on ?? null };
      }),
    });
    refresh();
  }

  function record(entry: JournalEntry, event: JournalEvent) {
    if (entry.application === "preparing" &&
        ["eligibility_confirmed", "eligibility_rejected", "admitted", "not_admitted"].includes(event) &&
        window.confirm("These results usually follow submission. Also record that you submitted today?")) {
      recordJournalEvent(entry.profile_id, entry.opportunity_id, "submitted", today);
    }
    recordJournalEvent(entry.profile_id, entry.opportunity_id, event, today);
    refresh();
  }

  function addMaterials(entry: JournalEntry, opportunity: Opportunity) {
    const ids = [...entry.material_ids];
    for (const prep of opportunity.preparation) {
      if (!prep.material_kind) continue;
      const reusable = prep.reusable_across_opportunities === true;
      const existing = loadMaterials(entry.profile_id).find((item) =>
        item.kind === prep.material_kind && item.reusable === reusable &&
        (reusable || (item.opportunity_id === opportunity.id && item.prep_item_id === prep.id)));
      const material: Material = existing ?? {
        id: crypto.randomUUID(), profile_id: entry.profile_id, kind: prep.material_kind,
        title: prep.title, reusable, opportunity_id: reusable ? null : opportunity.id,
        prep_item_id: reusable ? null : prep.id,
        estimated_hours: prep.estimated_hours ?? null, status: "not_started",
      };
      if (!existing) upsertMaterial(material);
      ids.push(material.id);
    }
    upsertJournalEntry({ ...entry, material_ids: [...new Set(ids)] });
    refresh();
    setMessage("Available application materials added to the checklist.");
  }

  const selectedOpportunities = catalog.filter((opp) => entries.some((entry) => entry.opportunity_id === opp.id));
  const crossPlan = profile && today && selectedOpportunities.length > 1
    ? planAcrossOpportunities(profile, selectedOpportunities, { today, materials }) : null;
  const requested = catalog.find((opp) => opp.id === opportunityId);

  return <div className="rpg-stack rpg-stack--loose">
    <header className="rpg-head"><h1>Quest Journal</h1>
      <p>Track your own preparation and application records in this browser.</p>
      <p>Submitting an application does not confirm eligibility. Confirmed eligibility does not guarantee admission.</p>
      {profile?.is_sample && <StatusTag>Sample profile</StatusTag>}
    </header>
    <p role="status">{message}</p>
    {profile === undefined && <p>Loading profile...</p>}
    {profile === null && <Link href="/passport">Create a profile or load a sample profile to start.</Link>}
    {profile && <>
      <QuestCard><h2>Add an opportunity</h2>
        {requested && <RpgButton onClick={() => add(requested)}>Add {requested.title}</RpgButton>}
        <form className="rpg-stack" onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const id = new FormData(event.currentTarget).get("opportunity");
          const opportunity = catalog.find((opp) => opp.id === id);
          if (opportunity) add(opportunity);
        }}>
          <label>Opportunity<select name="opportunity">{catalog.map((opp) => <option key={opp.id} value={opp.id}>{opp.title}</option>)}</select></label>
          <RpgButton type="submit">Add to Journal</RpgButton>
        </form>
      </QuestCard>
      {!entries.length && <p>Your Journal is empty.</p>}
      {entries.map((entry) => {
        const opportunity = catalog.find((opp) => opp.id === entry.opportunity_id);
        const plan = opportunity ? planRoutes(profile, opportunity, { today }) : null;
        return <QuestCard key={entry.id}>
          <h2>{opportunity?.title ?? entry.opportunity_id}</h2>
          <p>Deadline: {opportunity?.deadline ?? "Unknown"}</p>
          <a href={entry.official_url}>Go directly to the official application</a>
          <dl>
            <dt>Application</dt><dd>{entry.application}</dd>
            <dt>Official eligibility confirmation</dt><dd>{entry.eligibility_confirmation}</dd>
            <dt>Admission decision</dt><dd>{entry.decision}</dd>
            <dt>Participation</dt><dd>{entry.participated === null ? "Not recorded" : entry.participated ? "Participated" : "Did not participate"}</dd>
          </dl>
          <form className="rpg-stack" onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("event");
            const chosen = JOURNAL_EVENTS.find((item) => item === value);
            if (chosen) record(entry, chosen);
          }}>
            <label>Record an event<select name="event">{JOURNAL_EVENTS.filter((event) => event !== "added").map((event) => <option key={event} value={event}>{eventLabels[event]}</option>)}</select></label>
            <RpgButton type="submit">Record event</RpgButton>
          </form>
          {plan?.status === "routes" && opportunity && <form className="rpg-stack" onSubmit={(event) => {
            event.preventDefault();
            chooseRoute(entry, opportunity, String(new FormData(event.currentTarget).get("route")));
          }}>
            <label>Checklist route<select name="route" defaultValue={plan.routes.find((route) => route.type === entry.route_type)?.id}>
              {plan.routes.map((route) => <option key={route.id} value={route.id}>{route.title}</option>)}
            </select></label>
            <RpgButton type="submit" variant="secondary">Use route checklist</RpgButton>
          </form>}
          <h3>Tasks</h3>
          {!entry.tasks.length && <p>Choose a route to add tasks.</p>}
          {entry.tasks.map((task) => <label className="rpg-check" key={task.id}>
            <input type="checkbox" checked={task.done} onChange={(event) => {
              toggleJournalTask(profile.id, entry.opportunity_id, task.id, event.target.checked, today);
              refresh();
              if (event.target.checked && task.prep_item_id) setMessage("Task marked complete. Record supporting evidence in the Skill Passport.");
            }} /> {task.title}
          </label>)}
          <p><Link href={`/passport?opp=${encodeURIComponent(entry.opportunity_id)}`}>Record evidence in Skill Passport</Link></p>
          <h3>Application materials</h3>
          {opportunity && <RpgButton variant="secondary" onClick={() => addMaterials(entry, opportunity)}>Load material checklist</RpgButton>}
          {materials.filter((material) => entry.material_ids.includes(material.id)).map((material) => <label key={material.id}>
            {material.title} {material.reusable ? "(reusable)" : "(opportunity-specific)"}
            <select value={material.status} onChange={(event) => {
              const status = MATERIAL_STATUSES.find((item) => item === event.target.value);
              if (status) setMaterialStatus(material.id, status);
              refresh();
            }}>{MATERIAL_STATUSES.map((status) => <option key={status}>{status}</option>)}</select>
          </label>)}
          <form className="rpg-stack" onSubmit={(event) => {
            event.preventDefault();
            upsertJournalEntry({ ...entry, notes: String(new FormData(event.currentTarget).get("notes") ?? "") });
            refresh();
            setMessage("Notes saved.");
          }}><label>Notes<textarea name="notes" defaultValue={entry.notes ?? ""} /></label><RpgButton type="submit">Save notes</RpgButton></form>
          <details><summary>Recorded events</summary><ul>{entry.history.map((item, index) => <li key={index}>{item.on} · {eventLabels[item.event]}</li>)}</ul></details>
        </QuestCard>;
      })}
      {crossPlan && <QuestCard><h2>Plan applications together</h2>
        <p>Preparation total: {crossPlan.total_hours} h. Without reuse: {crossPlan.total_hours_without_reuse} h.</p>
        <h3>Deadline timeline</h3><ol>{crossPlan.items.map((item) => <li key={item.opportunity_id}>
          <strong>{item.title}</strong> · {item.deadline ?? "Unknown deadline"} · {item.status} · {item.required_hours} h
          <p>{item.note}</p>
        </li>)}</ol>
        <h3>Weekly preparation load</h3><ul>{crossPlan.weekly_load.map((week) => <li key={week.week_start}>
          Week of {week.week_start}: {week.hours_needed} h needed / {week.hours_available ?? "Unknown"} h available
          {week.over === true && <strong> — Conflict</strong>}
        </li>)}</ul>
        <h3>Materials and reuse</h3><ul>{crossPlan.reuse.map((item, index) => <li key={index}>
          {item.material_kind}: {item.reusable ? "Can be reused" : "Prepare separately"} · {item.hours_saved} h saved. {item.note}
        </li>)}</ul>
        <h3>Conflicts and information to confirm</h3>
        <ul>{[...crossPlan.conflicts, ...crossPlan.warnings].map((note, index) => <li key={index}>{note}</li>)}</ul>
        <p>You decide which opportunities to pursue.</p>
      </QuestCard>}
    </>}
  </div>;
}
