import { StatusTag } from "@/components/rpg";
import { fmt } from "@/lib/format";
import type { CrossPlanItem, WeeklyLoad } from "@/lib/types";
import { planStatusLabels, planStatusTones, routeLabels, yesNoUnknown } from "./labels";

/** Non-planned rows have no hours computed, so show a dash instead of 0. */
function hoursCell(item: CrossPlanItem, hours: number): string {
  return item.status === "planned" ? fmt(hours) : "—";
}

function doableCell(item: CrossPlanItem): string {
  if (item.status === "planned" && item.required_hours === 0 && item.hours_before_reuse === 0) return "No hours listed";
  return yesNoUnknown(item.feasible_alone);
}

export function PlanItemsTable({ items }: { items: CrossPlanItem[] }) {
  return (
    <div className="overflow-x-auto max-w-full print:overflow-visible">
      <table className="rpg-classic-table">
        <caption>Each quest, in deadline order</caption>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Opportunity</th>
            <th scope="col">Deadline</th>
            <th scope="col">Status</th>
            <th scope="col">Route used</th>
            <th scope="col">Required hours</th>
            <th scope="col">Hours without reuse</th>
            <th scope="col">Hours saved by reuse</th>
            <th scope="col">Doable alone before deadline?</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.opportunity_id}>
              <td data-label="Order">{item.order}</td>
              <th scope="row" data-label="Opportunity">{item.title}</th>
              <td data-label="Deadline">{item.deadline ?? "Unknown"}</td>
              <td data-label="Status"><StatusTag tone={planStatusTones[item.status]}>{planStatusLabels[item.status]}</StatusTag></td>
              <td data-label="Route used">{item.route_type ? routeLabels[item.route_type] : "None"}</td>
              <td data-label="Required hours">{hoursCell(item, item.required_hours)}</td>
              <td data-label="Hours without reuse">{hoursCell(item, item.hours_before_reuse)}</td>
              <td data-label="Hours saved by reuse">{hoursCell(item, item.hours_saved_by_reuse)}</td>
              <td data-label="Doable alone">{doableCell(item)}</td>
              <td data-label="Note">{item.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WeeklyLoadTable({ weeks, titleOf }: { weeks: WeeklyLoad[]; titleOf: (id: string) => string }) {
  const max = Math.max(0, ...weeks.map((week) => week.hours_needed));
  return (
    <section className="rpg-card" aria-labelledby="journal-weekly">
      <h3 id="journal-weekly">Weekly load</h3>
      {weeks.length === 0 ? (
        <p className="rpg-muted">No weekly load to show: no planned quest has hours to spread over the weeks.</p>
      ) : (
        <div className="overflow-x-auto max-w-full print:overflow-visible">
          <table className="rpg-classic-table">
            <caption>Hours needed and available per week (spread evenly by day)</caption>
            <thead>
              <tr>
                <th scope="col">Week of</th>
                <th scope="col">Hours needed</th>
                <th scope="col">Hours available</th>
                <th scope="col">Over?</th>
                <th scope="col">Quests</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week.week_start}>
                  <th scope="row" data-label="Week of">
                    {week.week_start}
                    {week.days < 7 && <span className="rpg-muted rpg-small"> ({week.days} days)</span>}
                  </th>
                  <td data-label="Hours needed">
                    <span>{fmt(week.hours_needed)}</span>
                    <span
                      aria-hidden="true"
                      className="mt-1 block h-2 bg-[var(--color-accent)]"
                      style={{ width: `${max > 0 ? (week.hours_needed / max) * 100 : 0}%` }}
                    />
                  </td>
                  <td data-label="Hours available">{week.hours_available === null ? "Unknown" : fmt(week.hours_available)}</td>
                  <td data-label="Over?">
                    {week.over === true && <StatusTag tone="danger">Over</StatusTag>}
                    {week.over === false && <StatusTag tone="success">Within</StatusTag>}
                    {week.over === null && <span>Unknown, add your weekly hours in your Skill Passport</span>}
                  </td>
                  <td data-label="Quests">{week.opportunity_ids.map(titleOf).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
