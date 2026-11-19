import type { BarrierSummary } from "@/lib/joint/barrier-report";

/**
 * 「障碍汇总」页面（./page.tsx）共用的表格样式，以及资格明细、参与形式、组队要求与材料负担四张表。
 * 单独放一个文件，是为了测试能用小型 fixture 的 summarizeBarriers 结果直接渲染这些表（page.tsx 只能渲染 SCENARIOS）。
 * 只接收 BarrierSummary（人数与固定英文文字），不读任何学生或场景对象。
 * 不是客户端组件（不加 use client 指令）；不要在这里 import lib/joint/scenarios、lib/data 或 data/*.json。
 * 口径见 lib/joint/barrier-report.ts 的文件头；全部是示例 / 模拟数据。
 */

/** 可能比窄屏宽的表格外层：横向滚动（与 what-if.tsx 相同做法），标签含场景标题以保证唯一。 */
export function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-label={`${label} (scrolls horizontally)`}>
      {children}
    </div>
  );
}

export const CAPTION_CLASS = "pb-1 text-left font-semibold";
export const TH_COL = "py-1 pr-3 font-medium";
export const TH_COL_NUM = "py-1 pr-3 text-right font-medium";
export const TH_ROW = "py-1 pr-3 text-left font-normal";
export const TD_NUM = "py-1 pr-3 text-right tabular-nums";
export const ROW_CLASS = "border-b border-gray-200 align-top";
export const HEAD_ROW_CLASS = "border-b border-gray-400 text-left";

/** 资格明细：不符合 / 未知的对按要求类型计数（三列，不加滚动外层）。 */
export function EligibilityDetailTable({ summary }: { summary: BarrierSummary }) {
  const heading = "Eligibility detail by requirement type (pairs)";
  const pairsOf = (status: string) => summary.eligibility.find((e) => e.status === status)?.pairs ?? 0;
  const notEligible = pairsOf("not_eligible");
  const unknown = pairsOf("unknown");
  if (notEligible + unknown === 0) {
    return (
      <p className="text-sm">
        <span className="font-semibold">{heading}: </span>
        {summary.pair_count === 0 ? "No pairs in this scenario." : "Every pair in this scenario is eligible."}
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
              Requirement type
            </th>
            <th scope="col" className={TH_COL_NUM}>
              Not eligible pairs that fail it (of {notEligible})
            </th>
            <th scope="col" className={TH_COL_NUM}>
              Unknown pairs that cannot confirm it (of {unknown})
            </th>
          </tr>
        </thead>
        <tbody>
          {summary.eligibility_detail.map((d) => (
            <tr key={d.requirement_type} className={ROW_CLASS}>
              <th scope="row" className={TH_ROW}>
                {d.label}
              </th>
              <td className={TD_NUM}>{d.not_eligible_pairs}</td>
              <td className={TD_NUM}>{d.unknown_pairs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-700">{summary.eligibility_detail_note}</p>
    </div>
  );
}

/** 不适用的格子：屏幕上显示「—」，读屏软件读「not applicable」。 */
function NotApplicable() {
  return (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">not applicable</span>
    </>
  );
}

/** 参与形式：每种形式的对数，以及该形式适用的学生档案条件（不适用的格子显示「—」）。 */
export function ParticipationTable({ title, summary }: { title: string; summary: BarrierSummary }) {
  const p = summary.participation;
  const cell = (v: number | undefined) => (v === undefined ? <NotApplicable /> : v);
  return (
    <div className="space-y-1">
      <ScrollTable label={`Participation format table for ${title}`}>
        <table className="min-w-[44rem] border-collapse text-sm">
          <caption className={CAPTION_CLASS}>Participation format (pairs)</caption>
          <thead>
            <tr className={HEAD_ROW_CLASS}>
              <th scope="col" className={TH_COL}>
                Format
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Pairs
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Student transport limited or none
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Student transport not recorded or unreadable
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Home internet not listed in the profile
              </th>
              <th scope="col" className={TH_COL_NUM}>
                Student devices not recorded or unreadable
              </th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.format} className={ROW_CLASS}>
                <th scope="row" className={TH_ROW}>
                  {r.label}
                </th>
                <td className={TD_NUM}>{r.pairs}</td>
                <td className={TD_NUM}>{cell(r.transport_limited_or_none)}</td>
                <td className={TD_NUM}>{cell(r.transport_not_recorded)}</td>
                <td className={TD_NUM}>{cell(r.home_internet_not_listed)}</td>
                <td className={TD_NUM}>{cell(r.devices_not_recorded)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollTable>
      <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">
        <li>{p.note} A dash (—) means the column does not apply to that format.</li>
        <li>{p.transport_note}</li>
        <li>{p.internet_note}</li>
      </ul>
    </div>
  );
}

/** 组队要求 / 材料负担共用的三列表格（不加滚动外层）。 */
function DemandTable({
  caption,
  firstColumn,
  rows,
  note,
}: {
  caption: string;
  firstColumn: string;
  rows: { key: string; label: string; pairs: number; eligible_pairs: number }[];
  note: string;
}) {
  return (
    <div className="space-y-1">
      <table className="w-full border-collapse text-sm">
        <caption className={CAPTION_CLASS}>{caption}</caption>
        <thead>
          <tr className={HEAD_ROW_CLASS}>
            <th scope="col" className={TH_COL}>
              {firstColumn}
            </th>
            <th scope="col" className={TH_COL_NUM}>
              Pairs
            </th>
            <th scope="col" className={TH_COL_NUM}>
              Of which eligible
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={ROW_CLASS}>
              <th scope="row" className={TH_ROW}>
                {r.label}
              </th>
              <td className={TD_NUM}>{r.pairs}</td>
              <td className={TD_NUM}>{r.eligible_pairs}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm text-gray-700">{note}</p>
    </div>
  );
}

/** 障碍以外、措施去不掉的要求：组队与材料。 */
export function OtherDemands({ summary }: { summary: BarrierSummary }) {
  const d = summary.other_demands;
  return (
    <div className="space-y-3">
      <div>
        <h3 className="font-semibold">Other demands on students</h3>
        <p className="text-sm text-gray-700">{d.note}</p>
      </div>
      <DemandTable
        caption="Team requirement (pairs)"
        firstColumn="Team requirement"
        rows={d.team_requirement.map((r) => ({ key: r.status, label: r.label, pairs: r.pairs, eligible_pairs: r.eligible_pairs }))}
        note={d.team_requirement_note}
      />
      <DemandTable
        caption="Required application materials still to prepare (pairs)"
        firstColumn="Required items to prepare"
        rows={d.materials.map((r) => ({ key: r.band, label: r.label, pairs: r.pairs, eligible_pairs: r.eligible_pairs }))}
        note={d.materials_note}
      />
    </div>
  );
}
