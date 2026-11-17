"use client";

/**
 * 主办方 What-if 页面（客户端组件）。
 * 所有计算都在 lib/joint/whatif.ts 的纯函数 runWhatIf 里完成，这里只负责输入控件和渲染。
 * 只显示汇总数字，不显示任何单个学生的姓名、学校或材料。所有结果都是模拟。
 */
import { useId, useMemo, useState } from "react";
import { deviceLoanScenario } from "@/lib/joint/scenarios";
import { defaultWhatIfInput, runWhatIf } from "@/lib/joint/whatif";
import type { WhatIfView } from "@/lib/joint/whatif";
import type { Intervention, JointStatus, SupportType } from "@/lib/types";

const SCENARIO = deviceLoanScenario;
const DEFAULT_INPUT = defaultWhatIfInput(SCENARIO);
const BUDGET_MAX = Math.max(100, Math.ceil((SCENARIO.budget_usd * 2) / 10) * 10);

const TYPE_ZH: Record<SupportType, string> = {
  device: "借用设备",
  transport_subsidy: "交通补助",
  fee_waiver: "费用减免",
  time_support: "时间支持",
  alternative_access: "替代参与方式",
};

const usd = (x: number) => (Number.isFinite(x) ? `$${Math.round(x * 100) / 100}` : "—");
const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

function titleOf(id: string): string {
  return SCENARIO.interventions.find((iv) => iv.id === id)?.title ?? id;
}

/** 互斥关系按对称处理：A 列出 B 或 B 列出 A 都算。 */
function exclusiveWith(iv: Intervention): string[] {
  const set = new Set(iv.mutually_exclusive_with ?? []);
  for (const other of SCENARIO.interventions) {
    if (other.mutually_exclusive_with?.includes(iv.id)) set.add(other.id);
  }
  return SCENARIO.interventions.filter((o) => set.has(o.id)).map((o) => o.id);
}

function relationText(iv: Intervention): string {
  const parts: string[] = [];
  if (iv.requires && iv.requires.length > 0) {
    parts.push(`需要同时纳入${iv.requires.map((r) => `「${titleOf(r)}」`).join("、")}`);
  }
  const ex = exclusiveWith(iv);
  if (ex.length > 0) parts.push(`与${ex.map((r) => `「${titleOf(r)}」`).join("、")}互斥，不能同时启用`);
  return parts.length > 0 ? parts.join("；") + "。" : "没有依赖或互斥关系。";
}

const STATUS_STYLE: Record<JointStatus, string> = {
  OPTIMAL: "border-green-700 bg-green-50 text-green-900",
  INFEASIBLE: "border-red-700 bg-red-50 text-red-900",
  SEARCH_LIMIT_REACHED: "border-amber-700 bg-amber-50 text-amber-900",
  UNSUPPORTED_INPUT: "border-gray-700 bg-gray-100 text-gray-900",
};

export default function WhatIf() {
  const [enabled, setEnabled] = useState<string[]>(DEFAULT_INPUT.enabledIds);
  const [required, setRequired] = useState<string[]>(DEFAULT_INPUT.requiredIds);
  const [budgetText, setBudgetText] = useState<string>(String(DEFAULT_INPUT.budget));
  const [minGainText, setMinGainText] = useState<string>("");

  const budget = budgetText.trim() === "" ? NaN : Number(budgetText);
  const minGain = minGainText.trim() === "" ? null : Number(minGainText);

  const view = useMemo(
    () =>
      runWhatIf(SCENARIO, {
        enabledIds: enabled,
        requiredIds: required,
        budget,
        minGain,
        mode: "protect",
      }),
    [enabled, required, budget, minGain],
  );

  const toggleEnabled = (id: string, on: boolean) => {
    setEnabled((prev) => {
      const next = on ? [...prev, id] : prev.filter((x) => x !== id);
      return SCENARIO.interventions.map((iv) => iv.id).filter((x) => next.includes(x));
    });
    if (!on) setRequired((prev) => prev.filter((x) => x !== id));
  };
  const toggleRequired = (id: string, on: boolean) => {
    setRequired((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };
  const addRequires = (iv: Intervention) => {
    setEnabled((prev) => {
      const next = new Set([...prev, ...(iv.requires ?? [])]);
      return SCENARIO.interventions.map((x) => x.id).filter((x) => next.has(x));
    });
  };
  const reset = () => {
    setEnabled(DEFAULT_INPUT.enabledIds);
    setRequired(DEFAULT_INPUT.requiredIds);
    setBudgetText(String(DEFAULT_INPUT.budget));
    setMinGainText("");
  };

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">主办方 What-if</h1>
        <div role="note" className="space-y-1 rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-950">
          <p className="font-semibold">注意：{view.labels.simulation}</p>
          <p className="font-semibold">{view.labels.sample}</p>
          <p className="text-sm">{view.labels.reachable_not_admission}，不等于录取。页面只显示汇总人数，不显示任何学生的个人信息。</p>
        </div>
        <dl className="grid gap-1 text-sm text-gray-700 sm:grid-cols-[auto_1fr] sm:gap-x-3">
          <dt className="font-medium">场景</dt>
          <dd className="break-words">{view.scenario_title}（示例学生 {view.student_count} 名，评估日期 {view.evaluation_date}）</dd>
          <dt className="font-medium">机会</dt>
          <dd className="break-words">
            {view.opportunities.map((o) => (
              <span key={o.title} className="block">
                {o.title}
                {o.is_placeholder && (
                  <span className="ml-2 inline-block rounded border border-gray-500 px-1.5 text-xs text-gray-800">
                    {view.labels.placeholder_opportunity}
                  </span>
                )}
              </span>
            ))}
          </dd>
        </dl>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Controls
          view={view}
          enabled={enabled}
          required={required}
          budgetText={budgetText}
          minGainText={minGainText}
          budget={budget}
          onToggleEnabled={toggleEnabled}
          onToggleRequired={toggleRequired}
          onAddRequires={addRequires}
          onBudget={setBudgetText}
          onMinGain={setMinGainText}
          onReset={reset}
        />
        <Results view={view} />
      </div>
    </div>
  );
}

// ───────────────────────────── 左侧：控件 ─────────────────────────────

function Controls(props: {
  view: WhatIfView;
  enabled: string[];
  required: string[];
  budgetText: string;
  minGainText: string;
  budget: number;
  onToggleEnabled: (id: string, on: boolean) => void;
  onToggleRequired: (id: string, on: boolean) => void;
  onAddRequires: (iv: Intervention) => void;
  onBudget: (v: string) => void;
  onMinGain: (v: string) => void;
  onReset: () => void;
}) {
  const { view, enabled, required } = props;
  const budgetId = useId();
  const sliderId = useId();
  const minGainId = useId();
  const sliderValue = Number.isFinite(props.budget) ? Math.min(Math.max(props.budget, 0), BUDGET_MAX) : 0;

  return (
    <section aria-labelledby="controls-heading" className="min-w-0 space-y-5">
      <h2 id="controls-heading" className="text-lg font-semibold">
        方案设置
      </h2>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">措施（示例）</legend>
        <ul className="space-y-3">
          {SCENARIO.interventions.map((iv) => {
            const isOn = enabled.includes(iv.id);
            const isReq = required.includes(iv.id);
            const pending = iv.status === "pending";
            const missing = (iv.requires ?? []).filter((r) => !enabled.includes(r));
            const excluded = view.excluded.find((e) => e.id === iv.id);
            return (
              <li key={iv.id} className="rounded border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{iv.title}</span>
                  <span
                    className={
                      "shrink-0 rounded border px-1.5 text-xs " +
                      (pending ? "border-amber-700 text-amber-900" : "border-green-700 text-green-900")
                    }
                  >
                    {pending ? "待审批" : "已批准"}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-gray-700">
                  <dt>类型</dt>
                  <dd>{TYPE_ZH[iv.type] ?? iv.type}</dd>
                  <dt>固定成本</dt>
                  <dd>{usd(iv.fixed_cost_usd ?? 0)}</dd>
                  <dt>人均成本</dt>
                  <dd>{usd(iv.unit_cost_usd)} / 人</dd>
                  <dt>名额</dt>
                  <dd>
                    {iv.capacity == null
                      ? "不限"
                      : `${iv.capacity} 人${iv.capacity_scope === "per_time_slot" ? "（每个时段）" : ""}`}
                  </dd>
                </dl>
                <p className="mt-1 text-sm text-gray-600">{relationText(iv)}</p>
                {pending && (
                  <p className="mt-1 text-sm text-amber-900">待审批：不计入当前结果，只出现在「如果获批」的条件性结果里。</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isOn}
                      onChange={(e) => props.onToggleEnabled(iv.id, e.target.checked)}
                    />
                    <span>纳入方案</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      role="switch"
                      className="h-3.5 w-3.5"
                      checked={isReq}
                      disabled={!isOn}
                      onChange={(e) => props.onToggleRequired(iv.id, e.target.checked)}
                    />
                    <span className={isOn ? "" : "text-gray-400"}>必须启用</span>
                  </label>
                </div>
                {isOn && missing.length > 0 && (
                  <div role="alert" className="mt-2 rounded border border-red-700 bg-red-50 p-2 text-sm text-red-900">
                    <p>
                      需要同时纳入{missing.map((m) => `「${titleOf(m)}」`).join("、")}。
                      {excluded ? "在纳入之前，本措施不参与求解。" : ""}
                    </p>
                    <button
                      type="button"
                      onClick={() => props.onAddRequires(iv)}
                      className="mt-1 rounded border border-red-800 px-2 py-0.5 hover:bg-red-100"
                    >
                      一键纳入{missing.map((m) => `「${titleOf(m)}」`).join("、")}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={budgetId} className="block font-medium">
          预算（美元，示例）
        </label>
        <input
          id={budgetId}
          type="number"
          inputMode="decimal"
          min={0}
          step={10}
          value={props.budgetText}
          onChange={(e) => props.onBudget(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
        <label htmlFor={sliderId} className="sr-only">
          预算滑块
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={BUDGET_MAX}
          step={10}
          value={sliderValue}
          onChange={(e) => props.onBudget(e.target.value)}
          className="w-full"
        />
        <p className="flex justify-between text-xs text-gray-500">
          <span>$0</span>
          <span>场景预算 {usd(SCENARIO.budget_usd)}</span>
          <span>{usd(BUDGET_MAX)}</span>
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={minGainId} className="block font-medium">
          最低新增目标（可选）
        </label>
        <input
          id={minGainId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="不设"
          value={props.minGainText}
          onChange={(e) => props.onMinGain(e.target.value)}
          className="w-full rounded border border-gray-300 px-2 py-1"
        />
        <p className="text-xs text-gray-500">要求方案至少新增这么多可达的（学生, 机会）对；达不到时会显示「做不到」及替代方案。</p>
      </div>

      <button
        type="button"
        onClick={props.onReset}
        className="rounded border border-gray-400 px-3 py-1.5 hover:border-gray-700"
      >
        恢复默认
      </button>
    </section>
  );
}

// ───────────────────────────── 右侧：结果 ─────────────────────────────

function BigNumber({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="min-w-0 rounded border border-gray-300 p-3 text-center">
      <p className="text-sm text-gray-700">{label}</p>
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-gray-500">{hint}</p>
    </div>
  );
}

function Results({ view }: { view: WhatIfView }) {
  const evaluated = view.status !== "UNSUPPORTED_INPUT";
  return (
    <section aria-labelledby="results-heading" aria-live="polite" className="min-w-0 space-y-5">
      <h2 id="results-heading" className="text-lg font-semibold">
        模拟结果 <span className="text-sm font-normal text-gray-600">（{view.labels.simulation}）</span>
      </h2>

      <div className={"rounded border-2 p-3 " + STATUS_STYLE[view.status]}>
        <p className="font-semibold">
          求解状态：{view.status_label}
          <span className="ml-2 text-xs font-normal">（{view.status}）</span>
        </p>
        <p className="mt-1 text-sm">{view.status_explanation}</p>
        {view.status === "UNSUPPORTED_INPUT" && (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {view.solver_notes.slice(1).map((n) => (
              <li key={n} className="break-words">
                {n}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <BigNumber label="新增可达 G" value={evaluated ? String(view.G) : "—"} hint="方案后新变为可达的（学生, 机会）对" />
        <BigNumber label="失去可达 L" value={evaluated ? String(view.L) : "—"} hint="原本可达、方案后不可达的对" />
        <BigNumber label="净变化 N" value={evaluated ? signed(view.N) : "—"} hint="N = G − L" />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-700">原本可达</dt>
        <dd>{evaluated ? `${view.R0_count} 个（学生, 机会）对` : "—"}</dd>
        <dt className="text-gray-700">方案后可达</dt>
        <dd>{evaluated ? `${view.R1_count} 个（学生, 机会）对` : "—"}</dd>
        <dt className="text-gray-700">总成本</dt>
        <dd>
          {usd(view.cost.total_usd)}（固定 {usd(view.cost.fixed_usd)} + 按人 {usd(view.cost.per_student_usd)}）
        </dd>
        <dt className="text-gray-700">预算</dt>
        <dd>
          {usd(view.cost.budget_usd)}，余额 {usd(view.cost.remaining_usd)}
        </dd>
      </dl>

      {view.alternative && (
        <div className="rounded border-2 border-red-700 p-3">
          <h3 className="font-semibold">做不到原要求 · 替代方案（不是当前结果）</h3>
          <p className="mt-1 text-sm">
            放松了：<strong>{view.alternative.relaxed.join("、")}</strong>。硬约束（批准、互斥、前置依赖、名额、预算、不减少原有可达）没有放松。
          </p>
          <p className="mt-1 text-sm">
            替代方案：新增可达 {view.alternative.G}，失去可达 {view.alternative.L}，净变化 {signed(view.alternative.N)}；总成本{" "}
            {usd(view.alternative.cost.total_usd)}（固定 {usd(view.alternative.cost.fixed_usd)} + 按人{" "}
            {usd(view.alternative.cost.per_student_usd)}）。
            {view.alternative.selected.length > 0
              ? `启用：${view.alternative.selected.map((s) => s.title).join("、")}。`
              : "不启用任何措施。"}
          </p>
          <p className="mt-1 text-sm text-gray-700">{view.alternative.note}</p>
        </div>
      )}

      <div>
        <h3 className="font-semibold">选中的措施与名额使用</h3>
        {view.selected.length === 0 ? (
          <p className="text-sm text-gray-700">当前结果不启用任何措施。</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {view.selected.map((s) => (
              <li key={s.id} className="break-words">
                <span className="font-medium">{s.title}</span>：服务 {s.students_served} 人，小计 {usd(s.subtotal_usd)}（固定{" "}
                {usd(s.fixed_usd)} + 按人 {usd(s.per_student_usd)}）
              </li>
            ))}
          </ul>
        )}
        {view.capacity_usage.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
            {view.capacity_usage.map((c) => (
              <li key={c.id} className="break-words">
                {c.title}
                {c.selected ? "" : "（未启用）"}：
                {c.unlimited
                  ? "名额不限"
                  : c.slots.map((sl) => `${sl.scope_label} 已用 ${sl.used} / ${sl.capacity}${sl.full ? "（已满）" : ""}`).join("；")}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-gray-300 p-3">
        <h3 className="font-semibold">
          独立复核：{view.verification.passed ? "通过" : "不通过"}
        </h3>
        <p className="text-sm text-gray-700">由独立的验证器重新计算并检查当前结果，不依赖求解器自己的判断。</p>
        {view.verification.note && <p className="mt-1 text-sm text-gray-700">{view.verification.note}</p>}
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">逐项检查（{view.verification.checks.length} 项）</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {view.verification.checks.map((c) => (
              <li key={c.name} className="break-words">
                <span className="font-medium">
                  {c.passed ? "通过" : "不通过"} · {c.label}
                </span>
                <span className="block text-gray-600">{c.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {view.conditional && (
        <div className="rounded border-2 border-dashed border-amber-700 p-3">
          <h3 className="font-semibold">条件性结果：如果待审批的措施获批（目前尚未生效）</h3>
          <p className="mt-1 text-sm">
            假设获批：{view.conditional.assumed_approved.join("、")}。求解状态：{view.conditional.status_label}。
          </p>
          <p className="mt-1 text-sm">
            则新增可达 {view.conditional.G}，失去可达 {view.conditional.L}，净变化 {signed(view.conditional.N)}；总成本{" "}
            {usd(view.conditional.cost.total_usd)}。与当前结果相比：净变化 {signed(view.conditional.delta.N)}，成本{" "}
            {view.conditional.delta.total_usd >= 0 ? "+" : "−"}
            {usd(Math.abs(view.conditional.delta.total_usd))}。
            {view.conditional.selected.length > 0 && `会启用：${view.conditional.selected.map((s) => s.title).join("、")}。`}
          </p>
          <p className="mt-1 text-sm text-gray-700">
            对这一条件性方案的独立复核：{view.conditional.verification_passed ? "通过" : "不通过"}。{view.conditional.note}
          </p>
        </div>
      )}

      {view.uncovered && (
        <div>
          <h3 className="font-semibold">仍未覆盖</h3>
          <p className="text-sm">
            {view.uncovered.students} 名示例学生（{view.uncovered.pairs} 个（学生, 机会）对）在方案后仍不可达。
          </p>
          {view.uncovered.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {view.uncovered.reasons.map((r) => (
                <li key={r.kind}>{r.text}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-gray-500">只给人数；一名学生可能同时缺多项条件，因此各项人数之和可能大于总人数。原因是按措施类型做的说明，仅供参考。</p>
        </div>
      )}

      {(view.excluded.length > 0 || view.ignored_required.length > 0) && (
        <div className="rounded border border-red-700 p-3 text-sm text-red-900">
          <h3 className="font-semibold">没有参与求解的设置</h3>
          <ul className="mt-1 list-disc pl-5">
            {view.excluded.map((e) => (
              <li key={e.id}>{e.reason}</li>
            ))}
            {view.ignored_required.map((r) => (
              <li key={"req-" + r.id}>{r.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded border border-gray-300 p-3">
        <h3 className="font-semibold">假设与不确定性</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {view.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {view.status !== "UNSUPPORTED_INPUT" && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">求解器说明</summary>
            <ul className="mt-1 list-disc pl-5 text-sm text-gray-600">
              {view.solver_notes.map((n) => (
                <li key={n} className="break-words">
                  {n}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
