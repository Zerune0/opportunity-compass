import type { Metadata } from "next";
import Link from "next/link";
import { SCENARIOS } from "@/lib/joint/scenarios";
import { NOT_REMOVABLE_REASONS, NOT_REMOVABLE_REASON_TEXT, summarizeBarriers } from "@/lib/joint/barrier-report";
import type { BarrierRow, BarrierSummary } from "@/lib/joint/barrier-report";

export const metadata: Metadata = {
  title: "Barrier summary (Sample) · Opportunity Compass",
  description:
    "Aggregate counts of (student, opportunity) pairs on sample organizer scenarios: eligibility, real-world barriers (time, cost, transport, device) and how many pairs approved support measures could help (upper bound). Sample data. Not a measure of real need.",
};

/**
 * 主办方「障碍汇总」页面（server component，静态）。
 * 在服务器端对每个演示场景调用 lib/joint/barrier-report 的 summarizeBarriers，只渲染它返回的人数与固定英文文字，
 * 外加场景标题、评估日期与（用真实机会的场景）realOpportunityNote。
 * 不渲染任何单个学生的信息；不使用客户端组件（Link 只拿到固定的 href 与文字），场景与学生对象不会进入浏览器。
 * lib/joint/scenarios 只在这里（服务器端）import，客户端组件不要 import 它。
 * 全部是示例 / 模拟数据；可达 ≠ 录取；「可去掉」的计数都是上界（不看名额、预算等）。
 */

/** 可能比窄屏宽的表格外层：横向滚动（与 what-if.tsx 相同做法），标签含场景标题以保证唯一。 */
function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={`${label} (scrolls horizontally)`}>
      {children}
    </div>
  );
}

const CAPTION_CLASS = "pb-1 text-left font-semibold";
const TH_COL = "py-1 pr-3 font-medium";
const TH_COL_NUM = "py-1 pr-3 text-right font-medium";
const TH_ROW = "py-1 pr-3 text-left font-normal";
const TD_NUM = "py-1 pr-3 text-right tabular-nums";
const ROW_CLASS = "border-b border-gray-200 align-top";
const HEAD_ROW_CLASS = "border-b border-gray-400 text-left";

function EligibilityTable({ title, summary }: { title: string; summary: BarrierSummary }) {
  return (
    <div className="space-y-1">
      <ScrollTable label={`Eligibility table for ${title}`}>
        <table className="min-w-[44rem] border-collapse text-sm">
          <caption className={CAPTION_CLASS}>Eligibility (pairs)</caption>
          <thead>
            <tr className={HEAD_ROW_CLASS}>
              <th scope="col" className={TH_COL}>
                Eligibility
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Pairs
              </th>
              <th scope="col" className={TH_COL_NUM}>
                With an unresolved barrier
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Could become reachable with approved measures (upper bound)
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Cannot become reachable with approved measures
              </th>
              <th scope="col" className={TH_COL}>
                Why not
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.eligibility.map((e) => (
              <tr key={e.status} className={ROW_CLASS}>
                <th scope="row" className={TH_ROW}>
                  {e.label}
                </th>
                <td className={TD_NUM}>{e.pairs}</td>
                <td className={TD_NUM}>{e.with_unresolved_barrier}</td>
                <td className={TD_NUM}>{e.could_become_reachable}</td>
                <td className={TD_NUM}>{e.not_removable}</td>
                <td className="py-1 text-xs text-gray-700">{e.not_removable > 0 ? e.not_removable_reason : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-sm text-gray-700">{summary.eligibility_note}</p>
    </div>
  );
}

function BarrierTable({ title, summary }: { title: string; summary: BarrierSummary }) {
  return (
    <div className="space-y-1">
      <ScrollTable label={`Barrier table for ${title}`}>
        <table className="min-w-[40rem] border-collapse text-sm">
          <caption className={CAPTION_CLASS}>Real-world barriers (pairs)</caption>
          <thead>
            <tr className={HEAD_ROW_CLASS}>
              <th scope="col" className={TH_COL}>
                Barrier
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Affected pairs
              </th>
              <th scope="col" className={TH_COL_NUM}>
                An approved measure could remove it (upper bound)
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Not removable by any approved measure
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.barrier_rows.map((r) => (
              <tr key={r.key} className={ROW_CLASS}>
                <th scope="row" className={TH_ROW}>
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-gray-600">{r.description}</span>
                </th>
                <td className={TD_NUM}>{r.affected_pairs}</td>
                <td className={TD_NUM}>{r.removable_by_approved_measure}</td>
                <td className={TD_NUM}>{r.not_removable}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <p className="text-sm font-medium text-amber-950">{summary.upper_bound_note}</p>
    </div>
  );
}

/** 每行障碍按原因键取数（不靠数组下标）。 */
function reasonCount(row: BarrierRow, reason: (typeof NOT_REMOVABLE_REASONS)[number]): number {
  return row.not_removable_by_reason.find((x) => x.reason === reason)?.pairs ?? 0;
}

/** 不可去掉的原因：行 = 原因，列 = 障碍类型（每个受影响的对在每一行障碍里只落入一个原因）。 */
function ReasonTable({ title, rows }: { title: string; rows: BarrierRow[] }) {
  const heading = "Why barriers are not removable (pairs)";
  const affected = rows.reduce((n, r) => n + r.affected_pairs, 0);
  const notRemovable = rows.reduce((n, r) => n + r.not_removable, 0);
  if (affected === 0 || notRemovable === 0) {
    return (
      <p className="text-sm">
        <span className="font-semibold">{heading}: </span>
        {affected === 0
          ? "No pair in this scenario has an unresolved barrier."
          : "Every affected pair has an approved measure that could remove the barrier (upper bound)."}
      </p>
    );
  }
  return (
    <ScrollTable label={`Reasons table for ${title}`}>
      <table className="min-w-[44rem] border-collapse text-sm">
        <caption className={CAPTION_CLASS}>{heading}</caption>
        <thead>
          <tr className={HEAD_ROW_CLASS}>
            <th scope="col" className={TH_COL}>
              Reason
            </th>
            {rows.map((r) => (
              <th key={r.key} scope="col" className={TH_COL_NUM}>
                {r.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {NOT_REMOVABLE_REASONS.map((reason) => (
            <tr key={reason} className={ROW_CLASS}>
              <th scope="row" className={TH_ROW}>
                {NOT_REMOVABLE_REASON_TEXT[reason]}
              </th>
              {rows.map((r) => (
                <td key={r.key} className={TD_NUM}>
                  {reasonCount(r, reason)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollTable>
  );
}

/** 两列的表格不会比窄屏宽，不加滚动外层。 */
function SummaryTable({ summary }: { summary: BarrierSummary }) {
  const m = summary.summary;
  const items: { key: string; label: string; value: number }[] = [
    { key: "reachable", label: "Reachable now, with support already given (reachable does not mean admitted)", value: m.reachable_now },
    { key: "not-eligible", label: "Not eligible", value: m.not_eligible },
    { key: "unknown", label: "Reachability unknown (eligibility to confirm or information missing)", value: m.reachability_unknown },
    { key: "unresolved", label: "With at least one unresolved barrier", value: m.with_unresolved_barrier },
    {
      key: "resolved",
      label: "With at least one barrier already resolved by support already given (sample)",
      value: m.with_barrier_resolved_by_existing_support,
    },
    {
      key: "could-become",
      label:
        "Could become reachable with approved measures in this scenario (upper bound: ignores capacity, budget, prerequisites and mutual exclusions, including measures that would mean stopping support already given)",
      value: m.could_become_reachable,
    },
  ];
  return (
    <table className="w-full border-collapse text-sm">
      <caption className={CAPTION_CLASS}>Summary (pairs)</caption>
      <thead>
        <tr className={HEAD_ROW_CLASS}>
          <th scope="col" className={TH_COL}>
            Count
          </th>
          <th scope="col" className={TH_COL_NUM}>
            Pairs
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.key} className={ROW_CLASS}>
            <th scope="row" className={TH_ROW}>
              {item.label}
            </th>
            <td className={TD_NUM}>{item.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MissingInfoTable({ summary }: { summary: BarrierSummary }) {
  const m = summary.summary;
  const heading = "What is missing (pairs where reachability is unknown)";
  if (m.reachability_unknown_by_category.every((c) => c.pairs === 0)) {
    return (
      <p className="text-sm">
        <span className="font-semibold">{heading}: </span>No pairs in this scenario.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <table className="w-full border-collapse text-sm">
        <caption className={CAPTION_CLASS}>{heading}</caption>
        <thead>
          <tr className={HEAD_ROW_CLASS}>
            <th scope="col" className={TH_COL}>
              Kind of information
            </th>
            <th scope="col" className={TH_COL_NUM}>
              Pairs
            </th>
          </tr>
        </thead>
        <tbody>
          {m.reachability_unknown_by_category.map((c) => (
            <tr key={c.category} className={ROW_CLASS}>
              <th scope="row" className={TH_ROW}>
                {c.label}
              </th>
              <td className={TD_NUM}>{c.pairs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-700">{m.reachability_unknown_note}</p>
    </div>
  );
}

function ScenarioSection({
  id,
  title,
  evaluationDate,
  realOpportunityNote,
  summary,
}: {
  id: string;
  title: string;
  evaluationDate: string;
  realOpportunityNote: string | null;
  summary: BarrierSummary;
}) {
  const headingId = `barriers-${id}`;
  return (
    <section aria-labelledby={headingId} className="space-y-4 rounded border border-gray-300 p-3">
      <div className="space-y-2">
        <h2 id={headingId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="text-sm">
          Sample students: {summary.student_count}. Opportunities: {summary.opportunity_count}. (Student, opportunity) pairs:{" "}
          {summary.pair_count}. Evaluation date: {evaluationDate}.
        </p>
        {realOpportunityNote !== null && (
          <p role="note" className="rounded border border-amber-700 p-2 text-sm text-amber-950">
            {realOpportunityNote}
          </p>
        )}
        <ul className="list-disc space-y-1 rounded border border-amber-600 bg-amber-50 py-2 pl-6 pr-2 text-sm text-amber-950">
          {summary.short_caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
      <EligibilityTable title={title} summary={summary} />
      <div className="space-y-3">
        <BarrierTable title={title} summary={summary} />
        <ReasonTable title={title} rows={summary.barrier_rows} />
      </div>
      <SummaryTable summary={summary} />
      <MissingInfoTable summary={summary} />
      <div>
        <h3 className="font-semibold">Caveats</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-gray-700">
          {summary.caveats.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function BarrierSummaryPage() {
  // 服务器端计算；只把人数与固定文字交给渲染。
  const sections = SCENARIOS.map((e) => ({
    id: e.id,
    title: e.title,
    evaluationDate: e.scenario.evaluation_date,
    realOpportunityNote: e.realOpportunityNote ?? null,
    summary: summarizeBarriers(e.scenario),
  }));
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <p>
          <Link href="/organizer" className="underline">
            Back to Organizer What-if
          </Link>
        </p>
        <h1 className="text-2xl font-bold">Barrier summary (Sample)</h1>
        <div role="note" className="space-y-1 rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-950">
          <p className="font-semibold">Sample data. Not a measure of real need.</p>
          <p className="text-sm">This page shows only aggregate counts of (student, opportunity) pairs, never any individual student.</p>
        </div>
      </header>
      {sections.length === 0 ? (
        <p>No sample scenarios available.</p>
      ) : (
        sections.map((s) => <ScenarioSection key={s.id} {...s} />)
      )}
    </div>
  );
}
