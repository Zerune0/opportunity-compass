"use client";

/**
 * 主办方 What-if 页面（客户端组件）。
 * 所有计算都在 lib/joint/whatif.ts 的纯函数 runWhatIfWithPlan（即 runWhatIf 加上方案明细）里完成，这里只负责输入控件和渲染。
 * 只显示汇总数字，不显示任何单个学生的姓名、学校或材料。所有结果都是模拟。
 *
 * 场景（可切换的演示场景）由 server component（./page.tsx，经 ./client-entry）匿名化后连同预设公平底线作为 prop 传入；
 * 用真实目录机会的场景另带一句说明（realOpportunityNote），显示在机会列表旁。
 * 本文件不要 import lib/joint/scenarios（那个文件顶层导入了场景 JSON，会把示例学生的姓名、学校打包进浏览器），也不要 import lib/data。
 * 结果区下方的「回到学生端的桥」（./student-bridge）是明确标注的本地演示操作：拿同一次计算的方案明细
 * （runWhatIfWithPlan 的 plan，不再求解一次），只渲染关于载入档案的一句话，不渲染方案明细里的任何学生信息。
 */
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import {
  defaultWhatIfInput,
  isPlaceholderOpportunity,
  MODE_EXPLANATIONS,
  MODE_LABELS,
  missingPrerequisites,
  runWhatIfWithPlan,
  WHATIF_LABELS,
} from "@/lib/joint/whatif";
import type { WhatIfBaselineRow, WhatIfFairnessRow, WhatIfView } from "@/lib/joint/whatif";
import type { ClientBridgeInfo } from "@/lib/joint/bridge";
import { plural, pluralNoun } from "@/lib/format";
import type { FairnessFloor, Intervention, JointStatus, Scenario, SupportType } from "@/lib/types";
import StudentBridge from "./student-bridge";

/** 交给客户端的一个演示场景（已匿名化；底线为示例）。 */
export interface ClientScenarioEntry {
  id: string;
  title: string;
  description: string;
  scenario: Scenario;
  floors: FairnessFloor[];
  /** 「回到学生端的桥」：可载入示例档案的匿名编号对应、示例主办方名、有 Quest Details 页面的机会。 */
  bridge: ClientBridgeInfo;
  /**
   * 场景用的是已核实目录里的真实机会时，在机会列表旁原样显示的说明（真实机会 + 示例学生 + 模拟支持方，
   * 真实主办方没有参与）；占位机会的场景为 null。
   */
  realOpportunityNote: string | null;
}

type Mode = "protect" | "tradeoff";

const TYPE_ZH: Record<SupportType, string> = {
  device: "Device loan",
  transport_subsidy: "Transport stipend",
  fee_waiver: "Fee waiver",
  time_support: "Time support",
  alternative_access: "Alternative way to take part",
};

/** null / 非有限数 → 「—」（没有评估出来的数字不显示 $0）。 */
const usd = (x: number | null | undefined) =>
  typeof x === "number" && Number.isFinite(x) ? `$${Math.round(x * 100) / 100}` : "—";
const signed = (x: number | null | undefined) =>
  typeof x === "number" && Number.isFinite(x) ? (x > 0 ? `+${x}` : `${x}`) : "—";
const num = (x: number | null | undefined) => (typeof x === "number" && Number.isFinite(x) ? String(x) : "—");

function titleOf(scenario: Scenario, id: string): string {
  return scenario.interventions.find((iv) => iv.id === id)?.title ?? id;
}

/** 互斥关系按对称处理：A 列出 B 或 B 列出 A 都算。 */
function exclusiveWith(scenario: Scenario, iv: Intervention): string[] {
  const set = new Set(iv.mutually_exclusive_with ?? []);
  for (const other of scenario.interventions) {
    if (other.mutually_exclusive_with?.includes(iv.id)) set.add(other.id);
  }
  return scenario.interventions.filter((o) => set.has(o.id)).map((o) => o.id);
}

function relationText(scenario: Scenario, iv: Intervention): string {
  const parts: string[] = [];
  if (iv.requires && iv.requires.length > 0) {
    parts.push(`Requires ${iv.requires.map((r) => `"${titleOf(scenario, r)}"`).join(", ")}`);
  }
  const ex = exclusiveWith(scenario, iv);
  if (ex.length > 0) parts.push(`Mutually exclusive with ${ex.map((r) => `"${titleOf(scenario, r)}"`).join(", ")}; cannot be enabled together`);
  return parts.length > 0 ? parts.join("; ") + "." : "No prerequisites or mutual exclusions.";
}

/** 预算输入：空 → 提示填写；不是有限非负数 → 提示；否则返回数值。 */
function parseBudget(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: "Please enter a budget (US dollars, 0 or more)." };
  const x = Number(t);
  if (!Number.isFinite(x) || x < 0) return { value: null, error: "The budget must be a valid number, 0 or more." };
  return { value: x, error: null };
}

/** 最低新增目标：空 = 不设目标；为负或不是整数 → 提示。 */
function parseMinGain(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: null };
  const x = Number(t);
  if (!Number.isFinite(x) || x < 0 || !Number.isInteger(x)) {
    return { value: null, error: "The minimum new coverage target must be a whole number, 0 or more; leave it blank for no target." };
  }
  return { value: x, error: null };
}

/** 损失上限：权衡模式下必填，0 或以上的整数。 */
function parseLossCap(mode: Mode, text: string): { value: number | null; error: string | null } {
  if (mode !== "tradeoff") return { value: null, error: null };
  const t = text.trim();
  if (t === "") return { value: null, error: "Trade-off mode needs a loss cap (a whole number, 0 or more); nothing is computed until it is filled in." };
  const x = Number(t);
  if (!Number.isFinite(x) || x < 0 || !Number.isInteger(x)) return { value: null, error: "The loss cap must be a whole number, 0 or more." };
  return { value: x, error: null };
}

/** 底线比例（百分比文本）：0–100 的数字 → 0–1。 */
function parsePercent(text: string): { value: number | null; error: string | null } {
  const t = text.trim();
  if (t === "") return { value: null, error: "Please enter a minimum ratio (0 to 100)." };
  const x = Number(t);
  if (!Number.isFinite(x) || x < 0 || x > 100) return { value: null, error: "The minimum ratio must be a number from 0 to 100." };
  return { value: x / 100, error: null };
}

const pctText = (ratio: number) => String(Math.round(ratio * 1000) / 10);

const STATUS_STYLE: Record<JointStatus, string> = {
  OPTIMAL: "border-green-700 bg-green-50 text-green-900",
  INFEASIBLE: "border-red-700 bg-red-50 text-red-900",
  SEARCH_LIMIT_REACHED: "border-amber-700 bg-amber-50 text-amber-900",
  UNSUPPORTED_INPUT: "border-gray-700 bg-gray-100 text-gray-900",
};

export default function WhatIf({ entries }: { entries: ClientScenarioEntry[] }) {
  const [scenarioId, setScenarioId] = useState<string>(entries[0]?.id ?? "");
  const selectId = useId();
  const descId = useId();
  const entry = entries.find((e) => e.id === scenarioId) ?? entries[0];
  if (!entry) return <p>No sample scenarios available.</p>;
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className="text-2xl font-bold">Organizer What-if</h1>
        <div role="note" className="space-y-1 rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-950">
          <p className="font-semibold">Note: {WHATIF_LABELS.simulation}</p>
          <p className="font-semibold">{WHATIF_LABELS.sample}</p>
          <p className="text-sm">{WHATIF_LABELS.reachable_not_admission}. This page shows only aggregate counts, never any student&apos;s personal information.</p>
        </div>
        <p className="text-sm">
          <Link href="/organizer/barriers" className="inline-flex min-h-11 items-center">
            Barrier summary (Sample): counts by barrier type and eligibility
          </Link>
        </p>
        <div className="space-y-1">
          <label htmlFor={selectId} className="block font-medium">
            Demo scenario (Sample)
          </label>
          <select
            id={selectId}
            value={entry.id}
            onChange={(e) => setScenarioId(e.target.value)}
            aria-describedby={descId}
            className="w-full max-w-full rounded border border-gray-400 bg-white px-2 py-1.5"
          >
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <p id={descId} className="text-sm text-gray-700">
            {entry.description} Switching scenarios resets the settings below to that scenario&apos;s defaults.
          </p>
        </div>
      </header>
      {/* key：切换场景时重新挂载，所有控件回到该场景的默认值。 */}
      <ScenarioWhatIf
        key={entry.id}
        scenario={entry.scenario}
        floors={entry.floors}
        bridge={entry.bridge}
        realOpportunityNote={entry.realOpportunityNote}
      />
    </div>
  );
}

function ScenarioWhatIf({
  scenario,
  floors,
  bridge,
  realOpportunityNote,
}: {
  scenario: Scenario;
  floors: FairnessFloor[];
  bridge: ClientBridgeInfo;
  realOpportunityNote: string | null;
}) {
  const defaults = useMemo(() => defaultWhatIfInput(scenario), [scenario]);
  const [enabled, setEnabled] = useState<string[]>(defaults.enabledIds);
  const [required, setRequired] = useState<string[]>(defaults.requiredIds);
  const [budgetText, setBudgetText] = useState<string>(String(defaults.budget));
  const [minGainText, setMinGainText] = useState<string>("");
  const [mode, setMode] = useState<Mode>("protect");
  const [lossCapText, setLossCapText] = useState<string>("");
  const [floorOn, setFloorOn] = useState<string[]>([]);
  const defaultPercents = useMemo(
    () => Object.fromEntries(floors.map((f) => [f.id, pctText(f.min_ratio)])),
    [floors],
  );
  const [percentText, setPercentText] = useState<Record<string, string>>(defaultPercents);

  const budget = parseBudget(budgetText);
  const minGain = parseMinGain(minGainText);
  const lossCap = parseLossCap(mode, lossCapText);
  const percents = Object.fromEntries(floors.map((f) => [f.id, parsePercent(percentText[f.id] ?? "")]));
  const percentErrors = floors
    .filter((f) => floorOn.includes(f.id) && percents[f.id].error !== null)
    .map((f) => `"${f.label}": ${percents[f.id].error}`);
  const inputError = budget.error ?? minGain.error ?? lossCap.error ?? (percentErrors.length > 0 ? percentErrors.join(" ") : null);

  // 只为勾选的底线传比例覆盖；用 JSON 字符串作依赖，避免每次渲染都重新计算。
  const overridesKey = JSON.stringify(
    Object.fromEntries(
      floorOn.flatMap((id) => {
        const v = percents[id]?.value;
        return typeof v === "number" ? [[id, v] as const] : [];
      }),
    ),
  );

  // 输入无效时不调用 runWhatIfWithPlan，结果区只显示提示，桥拿到的方案为 null。
  // 视图与桥用同一次计算（runWhatIfWithPlan），不为了桥再求解一次。
  const computed = useMemo(
    () =>
      inputError !== null || budget.value === null
        ? null
        : runWhatIfWithPlan(
            scenario,
            {
              enabledIds: enabled,
              requiredIds: required,
              budget: budget.value,
              minGain: minGain.value,
              mode,
              lossCap: lossCap.value,
              fairnessFloorIds: floorOn,
              minRatioOverrides: JSON.parse(overridesKey) as Record<string, number>,
            },
            floors,
          ),
    [scenario, floors, enabled, required, budget.value, minGain.value, mode, lossCap.value, floorOn, overridesKey, inputError],
  );
  const view = computed ? computed.view : null;
  const plan = computed ? computed.plan : null;

  const order = (ids: Iterable<string>) => {
    const set = new Set(ids);
    return scenario.interventions.map((iv) => iv.id).filter((x) => set.has(x));
  };
  const toggleEnabled = (id: string, on: boolean) => {
    setEnabled((prev) => order(on ? [...prev, id] : prev.filter((x) => x !== id)));
    if (!on) setRequired((prev) => prev.filter((x) => x !== id));
  };
  const toggleRequired = (id: string, on: boolean) => {
    setRequired((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };
  /** 一键纳入：补齐全部缺失的前置依赖（含依赖的依赖）。 */
  const addRequires = (iv: Intervention) => {
    setEnabled((prev) => order([...prev, ...missingPrerequisites(scenario, prev, iv.id)]));
  };
  const toggleFloor = (id: string, on: boolean) => {
    setFloorOn((prev) => {
      const set = new Set(on ? [...prev, id] : prev.filter((x) => x !== id));
      return floors.map((f) => f.id).filter((x) => set.has(x));
    });
  };
  const reset = () => {
    setEnabled(defaults.enabledIds);
    setRequired(defaults.requiredIds);
    setBudgetText(String(defaults.budget));
    setMinGainText("");
    setMode("protect");
    setLossCapText("");
    setFloorOn([]);
    setPercentText(defaultPercents);
  };

  return (
    <div className="space-y-6">
      <dl className="grid gap-1 text-sm text-gray-700 sm:grid-cols-[auto_1fr] sm:gap-x-3">
        <dt className="font-medium">Scenario</dt>
        <dd className="break-words">
          {scenario.title} ({scenario.students.length} sample students, evaluation date {scenario.evaluation_date})
        </dd>
        <dt className="font-medium">Opportunities</dt>
        <dd className="break-words">
          {scenario.opportunities.map((o) => (
            <span key={o.id} className="block">
              {o.title}
              {/* 与视图的 is_placeholder、假设说明用同一个判定；场景模板拒绝被它判为占位的目录机会。 */}
              {isPlaceholderOpportunity(o) && (
                <span className="ml-2 inline-block rounded border border-gray-500 px-1.5 text-xs text-gray-800">
                  {WHATIF_LABELS.placeholder_opportunity}
                </span>
              )}
            </span>
          ))}
          {/* 真实机会 + 示例学生 + 模拟支持方：说明原样显示，不暗示真实主办方提供任何支持。 */}
          {realOpportunityNote && (
            <p role="note" className="mt-1 rounded border border-blue-700 bg-blue-50 p-2 text-blue-950">
              {realOpportunityNote}
            </p>
          )}
        </dd>
      </dl>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Controls
          scenario={scenario}
          floors={floors}
          view={view}
          enabled={enabled}
          required={required}
          budgetText={budgetText}
          minGainText={minGainText}
          budget={budget.value}
          budgetError={budget.error}
          minGainError={minGain.error}
          mode={mode}
          lossCapText={lossCapText}
          lossCapError={lossCap.error}
          floorOn={floorOn}
          percentText={percentText}
          percentErrors={Object.fromEntries(floors.map((f) => [f.id, percents[f.id].error]))}
          onToggleEnabled={toggleEnabled}
          onToggleRequired={toggleRequired}
          onAddRequires={addRequires}
          onBudget={setBudgetText}
          onMinGain={setMinGainText}
          onMode={setMode}
          onLossCap={setLossCapText}
          onToggleFloor={toggleFloor}
          onPercent={(id, v) => setPercentText((prev) => ({ ...prev, [id]: v }))}
          onReset={reset}
        />
        {view ? <Results view={view} /> : <InvalidInput message={inputError} />}
      </div>

      {/* 全宽，放在设置与结果下方：输入无效时也显示（此时 plan 为 null，仍可撤回之前写入的）。 */}
      <StudentBridge scenario={scenario} bridge={bridge} plan={plan} />
    </div>
  );
}

// ───────────────────────────── 左侧：控件 ─────────────────────────────

function Controls(props: {
  scenario: Scenario;
  floors: FairnessFloor[];
  view: WhatIfView | null;
  enabled: string[];
  required: string[];
  budgetText: string;
  minGainText: string;
  budget: number | null;
  budgetError: string | null;
  minGainError: string | null;
  mode: Mode;
  lossCapText: string;
  lossCapError: string | null;
  floorOn: string[];
  percentText: Record<string, string>;
  percentErrors: Record<string, string | null>;
  onMode: (m: Mode) => void;
  onLossCap: (v: string) => void;
  onToggleFloor: (id: string, on: boolean) => void;
  onPercent: (id: string, v: string) => void;
  onToggleEnabled: (id: string, on: boolean) => void;
  onToggleRequired: (id: string, on: boolean) => void;
  onAddRequires: (iv: Intervention) => void;
  onBudget: (v: string) => void;
  onMinGain: (v: string) => void;
  onReset: () => void;
}) {
  const { scenario, view, enabled, required } = props;
  const budgetId = useId();
  const budgetErrId = useId();
  const sliderId = useId();
  const minGainId = useId();
  const minGainErrId = useId();
  const minGainHintId = useId();
  const modeName = useId();
  const lossCapId = useId();
  const lossCapErrId = useId();
  const lossCapHintId = useId();
  const floorBaseId = useId();
  /** 已有资源（grant）条数：大于 0 = 运行中，不能从方案中移除。 */
  const existingCount = (id: string) => (scenario.existing_grants ?? []).filter((g) => g.intervention_id === id).length;
  const budgetMax = Math.max(100, Math.ceil((scenario.budget_usd * 2) / 10) * 10);
  // 滑块：预算无效时停在 0，并同样标为无效、关联错误说明（拖动滑块即可给出有效预算）。
  const sliderValue = props.budget !== null ? Math.min(Math.max(props.budget, 0), budgetMax) : 0;

  return (
    <section aria-labelledby="controls-heading" className="min-w-0 space-y-5">
      <h2 id="controls-heading" className="text-lg font-semibold">
        Plan settings
      </h2>

      <fieldset className="space-y-3">
        <legend className="mb-2 font-medium">Support measures (Sample)</legend>
        <ul className="space-y-3">
          {scenario.interventions.map((iv) => {
            const isOn = enabled.includes(iv.id);
            const isReq = required.includes(iv.id);
            const pending = iv.status === "pending";
            const missing = (iv.requires ?? []).filter((r) => !enabled.includes(r));
            const toAdd = missingPrerequisites(scenario, enabled, iv.id);
            const excluded = view?.excluded.find((e) => e.id === iv.id);
            const runningCount = existingCount(iv.id);
            const runningView = view?.running.find((r) => r.id === iv.id);
            return (
              <li key={iv.id} className="rounded border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium">{iv.title}</span>
                  <span className="flex shrink-0 flex-wrap gap-1">
                    {runningCount > 0 && (
                      <span className="rounded border border-blue-800 px-1.5 text-xs text-blue-900">Running</span>
                    )}
                    <span
                      className={
                        "rounded border px-1.5 text-xs " +
                        (pending ? "border-amber-700 text-amber-900" : "border-green-700 text-green-900")
                      }
                    >
                      {pending ? "Pending approval" : "Approved"}
                    </span>
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-gray-700">
                  <dt>Type</dt>
                  <dd>{TYPE_ZH[iv.type] ?? iv.type}</dd>
                  <dt>Fixed cost</dt>
                  <dd>{usd(iv.fixed_cost_usd ?? 0)}</dd>
                  <dt>Cost per student</dt>
                  <dd>{usd(iv.unit_cost_usd)} / student</dd>
                  <dt>Capacity</dt>
                  <dd>
                    {iv.capacity == null
                      ? "Unlimited"
                      : `${plural(iv.capacity, "student")}${iv.capacity_scope === "per_time_slot" ? " (per time slot)" : ""}`}
                  </dd>
                </dl>
                <p className="mt-1 text-sm text-gray-600">{relationText(scenario, iv)}</p>
                {runningCount > 0 && (
                  <p className="mt-1 text-sm text-gray-700">
                    {runningView
                      ? runningView.note
                      : `${plural(runningCount, "resource")} already in use; cannot be removed from the plan. Unchecking only stops new allocations.`}
                    {" "}Only trade-off mode can revoke existing resources from students in the scenario.
                  </p>
                )}
                {pending && (
                  <p className="mt-1 text-sm text-amber-900">Pending approval: not counted in the current result; only appears in the &quot;if approved&quot; conditional result.</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      aria-label={`${runningCount > 0 ? "Accept new allocations" : "Include in plan"}: ${iv.title}`}
                      checked={isOn}
                      onChange={(e) => props.onToggleEnabled(iv.id, e.target.checked)}
                    />
                    <span aria-hidden="true">{runningCount > 0 ? "Accept new allocations" : "Include in plan"}</span>
                  </label>
                  <label
                    className={
                      "inline-flex items-center gap-2 rounded px-2 py-1.5 text-sm " +
                      (isOn ? "cursor-pointer hover:bg-gray-50" : "cursor-not-allowed")
                    }
                  >
                    <input
                      type="checkbox"
                      role="switch"
                      className="h-4 w-4"
                      aria-label={`Required: ${iv.title}`}
                      checked={isReq}
                      disabled={!isOn}
                      onChange={(e) => props.onToggleRequired(iv.id, e.target.checked)}
                    />
                    <span aria-hidden="true" className={isOn ? "" : "text-gray-600"}>
                      Required
                    </span>
                  </label>
                </div>
                {isOn && missing.length > 0 && (
                  <div role="alert" className="mt-2 rounded border border-red-700 bg-red-50 p-2 text-sm text-red-900">
                    <p>
                      Requires {missing.map((m) => `"${titleOf(scenario, m)}"`).join(", ")}.
                      {excluded ? " Until it is included, this support measure is left out of the solve." : ""}
                    </p>
                    {toAdd.length > 0 && (
                      <button
                        type="button"
                        onClick={() => props.onAddRequires(iv)}
                        className="mt-1 rounded border border-red-800 px-2 py-0.5 hover:bg-red-100"
                      >
                        Include {toAdd.map((m) => `"${titleOf(scenario, m)}"`).join(", ")}
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={budgetId} className="block font-medium">
          Budget (USD, Sample)
        </label>
        <input
          id={budgetId}
          type="number"
          inputMode="decimal"
          min={0}
          step={10}
          value={props.budgetText}
          onChange={(e) => props.onBudget(e.target.value)}
          aria-invalid={props.budgetError ? true : undefined}
          aria-describedby={props.budgetError ? budgetErrId : undefined}
          className={
            "w-full rounded border px-2 py-1 " + (props.budgetError ? "border-red-700" : "border-gray-300")
          }
        />
        {props.budgetError && (
          <p id={budgetErrId} className="text-sm text-red-800">
            {props.budgetError}
          </p>
        )}
        <label htmlFor={sliderId} className="sr-only">
          Budget slider
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={budgetMax}
          step={10}
          value={sliderValue}
          onChange={(e) => props.onBudget(e.target.value)}
          aria-invalid={props.budgetError ? true : undefined}
          aria-describedby={props.budgetError ? budgetErrId : undefined}
          aria-valuetext={props.budget !== null ? usd(props.budget) : "missing or invalid"}
          className="w-full"
        />
        <p className="flex justify-between text-xs text-gray-600">
          <span>$0</span>
          <span>Scenario budget {usd(scenario.budget_usd)}</span>
          <span>{usd(budgetMax)}</span>
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor={minGainId} className="block font-medium">
          Minimum new coverage target (optional)
        </label>
        <input
          id={minGainId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          placeholder="None"
          value={props.minGainText}
          onChange={(e) => props.onMinGain(e.target.value)}
          aria-invalid={props.minGainError ? true : undefined}
          aria-describedby={props.minGainError ? `${minGainErrId} ${minGainHintId}` : minGainHintId}
          className={
            "w-full rounded border px-2 py-1 " + (props.minGainError ? "border-red-700" : "border-gray-300")
          }
        />
        {props.minGainError && (
          <p id={minGainErrId} className="text-sm text-red-800">
            {props.minGainError}
          </p>
        )}
        <p id={minGainHintId} className="text-xs text-gray-600">
          The plan must make at least this many (student, opportunity) pairs newly reachable; leave blank for no target. If it cannot, you will see &quot;Not achievable&quot; and an alternative.
        </p>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1 font-medium">Solver mode</legend>
        {(["protect", "tradeoff"] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50">
            <input
              type="radio"
              name={modeName}
              className="mt-1 h-4 w-4 shrink-0"
              checked={props.mode === m}
              onChange={() => props.onMode(m)}
            />
            <span className="min-w-0">
              <span className="font-medium">{MODE_LABELS[m]}</span>
              <span className="block text-sm text-gray-700">{MODE_EXPLANATIONS[m]}</span>
            </span>
          </label>
        ))}
        {props.mode === "tradeoff" && (
          <div className="space-y-1 pl-2">
            <label htmlFor={lossCapId} className="block font-medium">
              Loss cap (required)
            </label>
            <input
              id={lossCapId}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              required
              aria-required="true"
              placeholder="e.g. 3"
              value={props.lossCapText}
              onChange={(e) => props.onLossCap(e.target.value)}
              aria-invalid={props.lossCapError ? true : undefined}
              aria-describedby={props.lossCapError ? `${lossCapErrId} ${lossCapHintId}` : lossCapHintId}
              className={
                "w-full rounded border px-2 py-1 " + (props.lossCapError ? "border-red-700" : "border-gray-300")
              }
            />
            {props.lossCapError && (
              <p id={lossCapErrId} className="text-sm text-red-800">
                {props.lossCapError}
              </p>
            )}
            <p id={lossCapHintId} className="text-xs text-gray-600">
              Counted in (student, opportunity) pairs: the most previously reachable pairs allowed to become unreachable under the new plan (a whole number, 0 or more). One student losing two opportunities counts as 2.
              A cap of 0 is still not the same as protected mode: it still allows revoking pending-approval commitments (not counted as losses) and revocations that cause no loss.
              {view?.loss && view.mode === "tradeoff"
                ? ` The current result loses ${plural(view.loss.lost_pairs, "pair")}, involving ${plural(view.loss.affected_students, "student")} (${view.loss.affected_students_still_reachable} of them still ${pluralNoun(view.loss.affected_students_still_reachable, "has", "have")} another reachable opportunity after the plan).`
                : ""}
            </p>
          </div>
        )}
      </fieldset>

      {props.floors.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="mb-1 font-medium">Fairness floors (Sample, optional)</legend>
          <p className="text-xs text-gray-600">
            Groups use only status labels students report themselves; the denominator counts only group members officially eligible for at least one opportunity, counted per student.
          </p>
          <ul className="space-y-3">
            {props.floors.map((f, k) => {
              const on = props.floorOn.includes(f.id);
              const err = on ? props.percentErrors[f.id] : null;
              const inputId = `${floorBaseId}-p${k}`;
              const errId = `${floorBaseId}-e${k}`;
              const basisId = `${floorBaseId}-b${k}`;
              return (
                <li key={f.id} className="rounded border border-gray-200 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        aria-label={`Set fairness floor: ${f.label}`}
                        aria-describedby={basisId}
                        checked={on}
                        onChange={(e) => props.onToggleFloor(f.id, e.target.checked)}
                      />
                      <span aria-hidden="true" className="font-medium">
                        {f.label}
                      </span>
                    </label>
                    <span className="shrink-0 rounded border border-gray-500 px-1.5 text-xs text-gray-800">Sample</span>
                  </div>
                  <p id={basisId} className="mt-1 text-sm text-gray-700">
                    Basis: {f.basis}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label htmlFor={inputId} className="text-sm">
                      Minimum coverage ratio (%)
                    </label>
                    <input
                      id={inputId}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={100}
                      step={5}
                      disabled={!on}
                      aria-label={`Minimum coverage ratio (%): ${f.label}`}
                      value={props.percentText[f.id] ?? ""}
                      onChange={(e) => props.onPercent(f.id, e.target.value)}
                      aria-invalid={err ? true : undefined}
                      aria-describedby={err ? errId : undefined}
                      className={
                        "w-24 rounded border px-2 py-1 disabled:bg-gray-100 " + (err ? "border-red-700" : "border-gray-300")
                      }
                    />
                  </div>
                  {err && (
                    <p id={errId} className="mt-1 text-sm text-red-800">
                      {err}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      )}

      <button
        type="button"
        onClick={props.onReset}
        className="rounded border border-gray-400 px-3 py-1.5 hover:border-gray-700"
      >
        Reset to defaults
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
      <p className="text-xs text-gray-600">{hint}</p>
    </div>
  );
}

function ResultsHeading() {
  return (
    <h2 id="results-heading" className="text-lg font-semibold">
      Simulated results <span className="inline-block text-sm font-normal text-gray-600">(they do not represent real-world impact)</span>
    </h2>
  );
}

function InvalidInput({ message }: { message: string | null }) {
  return (
    <section aria-labelledby="results-heading" className="min-w-0 space-y-5">
      <ResultsHeading />
      <div aria-live="polite" className="rounded border-2 border-gray-700 bg-gray-100 p-3 text-gray-900">
        <p className="font-semibold">Settings are incomplete or invalid, so nothing is computed yet. Fix the settings on the left as prompted to see simulated results.</p>
        {message && <p className="mt-1 text-sm">{message}</p>}
      </div>
    </section>
  );
}

function Results({ view }: { view: WhatIfView }) {
  return (
    <section aria-labelledby="results-heading" className="min-w-0 space-y-5">
      <ResultsHeading />

      {/* 读屏播报只放「求解状态 + 三个数」这一小段，不包住整个结果区。 */}
      <p aria-live="polite" aria-atomic="true" className="sr-only">
        Solver status: {view.status_label}. Newly reachable G {num(view.G)}, lost L {num(view.L)}, net change N {signed(view.N)}.
      </p>

      <div className={"rounded border-2 p-3 " + STATUS_STYLE[view.status]}>
        <p className="font-semibold">
          Solver status: {view.status_label}
          <span className="ml-2 text-xs font-normal">({view.status})</span>
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

      <p className="text-sm text-gray-700">
        Current mode: <span className="font-medium">{view.mode_label}</span>
        {view.mode === "tradeoff" && view.loss_cap !== null ? ` (loss cap ${view.loss_cap})` : ""}. {view.mode_explanation}
      </p>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <BigNumber label="Newly reachable G" value={num(view.G)} hint="(student, opportunity) pairs that become reachable after the plan" />
        <BigNumber label="Lost L" value={num(view.L)} hint="Pairs reachable before but not after the plan" />
        <BigNumber label="Net change N" value={signed(view.N)} hint="N = G − L" />
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-gray-700">Reachable before</dt>
        <dd>{view.R0_count !== null ? `${view.R0_count} (student, opportunity) ${pluralNoun(view.R0_count, "pair")}` : "—"}</dd>
        <dt className="text-gray-700">Reachable after the plan</dt>
        <dd>{view.R1_count !== null ? `${view.R1_count} (student, opportunity) ${pluralNoun(view.R1_count, "pair")}` : "—"}</dd>
        <dt className="text-gray-700">Total cost</dt>
        <dd>
          {view.cost.total_usd !== null
            ? `${usd(view.cost.total_usd)} (fixed ${usd(view.cost.fixed_usd)} + per student ${usd(view.cost.per_student_usd)})`
            : "— (not evaluated)"}
        </dd>
        <dt className="text-gray-700">Budget</dt>
        <dd>
          {usd(view.cost.budget_usd)}, remaining {view.cost.remaining_usd !== null ? usd(view.cost.remaining_usd) : "—"}
        </dd>
      </dl>

      {view.loss && <LossBlock view={view} />}

      {view.fairness.length > 0 && <FairnessTable rows={view.fairness} caption="Fairness floor results (current result, Simulated)" />}

      {view.alternative && (
        <div className="rounded border-2 border-red-700 p-3">
          <h3 className="font-semibold">Original requirements not achievable · Alternative (not the current result)</h3>
          <p className="mt-1 text-sm">
            Relaxed: <strong>{view.alternative.relaxed.join(", ")}</strong>. Hard constraints (approval, mutual exclusion, prerequisites, capacity, budget, lost pairs within the allowed limit) are not relaxed.
          </p>
          <p className="mt-1 text-sm">
            Alternative: newly reachable {view.alternative.G}, lost {view.alternative.L}, net change {signed(view.alternative.N)}; total cost{" "}
            {usd(view.alternative.cost.total_usd)} (fixed {usd(view.alternative.cost.fixed_usd)} + per student{" "}
            {usd(view.alternative.cost.per_student_usd)}).{" "}
            {view.alternative.selected.length > 0
              ? `Enables: ${view.alternative.selected.map((s) => s.title).join(", ")}.`
              : "No support measures enabled."}
          </p>
          {view.alternative.loss_text && <p className="mt-1 text-sm font-medium">{view.alternative.loss_text}</p>}
          {view.alternative.fairness.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {view.alternative.fairness.map((f) => (
                <li key={f.floor_id}>
                  {f.text}
                  {f.bound_text ? ` ${f.bound_text}` : ""}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-sm text-gray-700">{view.alternative.note}</p>
        </div>
      )}

      <div>
        <h3 className="font-semibold">Selected support measures and capacity use</h3>
        {view.selected.length === 0 ? (
          <p className="text-sm text-gray-700">The current result enables no support measures.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-sm">
            {view.selected.map((s) => (
              <li key={s.id} className="break-words">
                <span className="font-medium">{s.title}</span>: serves {plural(s.students_served, "student")}, subtotal {usd(s.subtotal_usd)} (fixed{" "}
                {usd(s.fixed_usd)} + per student {usd(s.per_student_usd)})
              </li>
            ))}
          </ul>
        )}
        {view.capacity_usage.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-sm text-gray-700">
            {view.capacity_usage.map((c) => (
              <li key={c.id} className="break-words">
                {c.title}
                {c.status_note ? ` ${c.status_note}` : ""}
                {c.deactivated
                  ? ""
                  : `: ${
                      c.unlimited
                        ? "Unlimited capacity"
                        : c.slots
                            .map((sl) => `${sl.scope_label} used ${sl.used} / ${sl.capacity}${sl.full ? " (full)" : ""}`)
                            .join("; ")
                    }`}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-gray-300 p-3">
        <h3 className="font-semibold">
          Independent verification: {view.verification.passed ? "Passed" : "Failed"}
        </h3>
        <p className="text-sm text-gray-700">A separate verifier recomputes and checks the current result without relying on the solver&apos;s own judgment.</p>
        {view.verification.note && <p className="mt-1 text-sm text-gray-700">{view.verification.note}</p>}
        <details className="mt-2">
          <summary className="cursor-pointer text-sm">Check by check ({view.verification.checks.length} checks)</summary>
          <ul className="mt-2 space-y-1 text-sm">
            {view.verification.checks.map((c) => (
              <li key={c.name} className="break-words">
                <span className="font-medium">
                  {c.passed ? "Passed" : "Failed"} · {c.label}
                </span>
                <span className="block text-gray-600">{c.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      {view.conditional && (
        <div className="rounded border-2 border-dashed border-amber-700 p-3">
          <h3 className="font-semibold">Conditional result: if the pending-approval measures are approved (not in effect yet)</h3>
          <p className="mt-1 text-sm">
            Assumed approved: {view.conditional.assumed_approved.join(", ")}. Solver status: {view.conditional.status_label}.
          </p>
          <p className="mt-1 text-sm">
            Then newly reachable {view.conditional.G}, lost {view.conditional.L}, net change {signed(view.conditional.N)}; total cost{" "}
            {usd(view.conditional.cost.total_usd)}. Compared with the current result: net change {signed(view.conditional.delta.N)}, cost{" "}
            {view.conditional.delta.total_usd >= 0 ? "+" : "−"}
            {usd(Math.abs(view.conditional.delta.total_usd))}.{" "}
            {view.conditional.selected.length > 0 && `Would enable: ${view.conditional.selected.map((s) => s.title).join(", ")}.`}
          </p>
          {view.conditional.loss_text && <p className="mt-1 text-sm font-medium">{view.conditional.loss_text}</p>}
          {view.conditional.fairness.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {view.conditional.fairness.map((f) => (
                <li key={f.floor_id}>{f.text}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-sm text-gray-700">
            Independent verification of this conditional plan: {view.conditional.verification_passed ? "Passed" : "Failed"}. {view.conditional.note}
          </p>
        </div>
      )}

      {view.uncovered && (
        <div>
          <h3 className="font-semibold">Still not covered</h3>
          <p className="text-sm">{view.uncovered.summary}</p>
          {view.uncovered.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-sm">
              {view.uncovered.reasons.map((r) => (
                <li key={r.kind}>{r.text}</li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-gray-600">Counted in (student, opportunity) pairs; student counts are de-duplicated and only supplementary. A pair can lack several conditions and a student can have several pairs, so the items can add up to more than the total. Reasons are explained by support measure type, for reference only.</p>
        </div>
      )}

      {view.baselines && <BaselinesTable view={view} />}

      {(view.excluded.length > 0 || view.ignored_required.length > 0) && (
        <div className="rounded border border-red-700 p-3 text-sm text-red-900">
          <h3 className="font-semibold">Settings left out of the solve</h3>
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
        <h3 className="font-semibold">Assumptions and uncertainty</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
          {view.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {view.status !== "UNSUPPORTED_INPUT" && (
          <details className="mt-2">
            <summary className="cursor-pointer text-sm">Solver notes</summary>
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

// ───────────────────────────── 第 3 层：失去、公平底线、基线 ─────────────────────────────

function LossBlock({ view }: { view: WhatIfView }) {
  const loss = view.loss!;
  const rev = view.revocations;
  if (view.mode === "protect") {
    return (
      <div className="rounded border border-gray-300 p-3 text-sm">
        <h3 className="font-semibold">Lost L</h3>
        <p className="mt-1">{loss.protect_note}</p>
      </div>
    );
  }
  const hasLoss = loss.lost_pairs > 0;
  return (
    <div className={"rounded p-3 text-sm " + (hasLoss ? "border-2 border-red-700 bg-red-50 text-red-950" : "border border-gray-300")}>
      <h3 className="font-semibold">
        Lost L: {hasLoss ? `${plural(loss.lost_pairs, "pair")} lost` : "nothing lost"}
      </h3>
      {loss.headline && <p className="mt-1 font-semibold">{loss.headline}</p>}
      {hasLoss && loss.summary && (
        <p className="mt-1">
          {loss.summary} (Counts only; no individual students are listed.)
        </p>
      )}
      {loss.groups.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {loss.groups.map((g) => (
            <li key={g.revoked_title + (g.forced_by_title ?? "")}>{g.text}</li>
          ))}
        </ul>
      )}
      {rev && rev.total > 0 ? (
        <div className="mt-2">
          <p className="font-medium">
            Existing resources revoked: {rev.total} in total ({rev.forced} forced by mutual exclusion, {rev.voluntary} voluntary)
          </p>
          {rev.pending > 0 && <p className="mt-0.5">Of these, {rev.pending} were pending-approval commitments (not counted as losses; they only free capacity).</p>}
          <ul className="mt-1 list-disc pl-5">
            {rev.items.map((it) => (
              <li key={it.title + it.reason}>
                &quot;{it.title}&quot; ({it.count}): {it.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-1">This plan revokes no existing resources.</p>
      )}
    </div>
  );
}

function FairnessTable({ rows, caption }: { rows: WhatIfFairnessRow[]; caption: string }) {
  return (
    <div>
      <h3 className="font-semibold">{caption}</h3>
      <div
        className="mt-1 max-w-full overflow-x-auto"
        tabIndex={0}
        role="region"
        aria-label={`${caption} (scrolls horizontally)`}
      >
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-gray-400 text-left">
              <th scope="col" className="py-1 pr-3 font-medium">Group (Sample)</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Eligible (denominator)</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Covered (numerator)</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Ratio</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Required at least</th>
              <th scope="col" className="py-1 pr-3 text-right font-medium">Max coverable with current measures</th>
              <th scope="col" className="py-1 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.floor_id} className="border-b border-gray-200 align-top">
                <th scope="row" className="py-1 pr-3 text-left font-normal">
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-gray-600">Basis: {r.basis}</span>
                </th>
                <td className="py-1 pr-3 text-right tabular-nums">{plural(r.eligible_members, "student")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{plural(r.covered_members, "student")}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.ratio_percent === null ? "—" : `${r.ratio_percent}%`}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{r.min_ratio_percent}%</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  {r.max_coverable === null ? "—" : `${r.max_coverable} / ${r.eligible_members}`}
                </td>
                <td className="py-1 font-medium">
                  {r.not_applicable ? "Not applicable (denominator is 0)" : r.satisfied ? "Met" : "Not met"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.some((r) => r.bound_text) && (
        <ul className="mt-1 list-disc pl-5 text-xs text-gray-700">
          {rows
            .filter((r) => r.bound_text)
            .map((r) => (
              <li key={r.floor_id}>
                {r.label}: {r.bound_text}
              </li>
            ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-gray-600">
        Counted per student: a student is covered with at least one reachable opportunity; a student in several groups counts once in each group. &quot;Max coverable&quot; is an upper bound that ignores capacity and budget.
      </p>
    </div>
  );
}

function metricCells(m: { G: number; L: number; N: number; total_usd: number }) {
  return (
    <>
      <td className="py-1 pr-3 text-right tabular-nums">{m.G}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{m.L}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{signed(m.N)}</td>
      <td className="py-1 pr-3 text-right tabular-nums">{usd(m.total_usd)}</td>
    </>
  );
}

function BaselineRowView({ r }: { r: WhatIfBaselineRow }) {
  return (
    <tr className="border-b border-gray-200 align-top">
      <th scope="row" className="whitespace-nowrap py-1 pr-3 text-left font-medium">
        {r.label}
        {r.coordination_label && (
          <span className="block text-xs font-normal text-gray-600">Coordination: {r.coordination_label}</span>
        )}
      </th>
      <td className="py-1 pr-3 text-right tabular-nums">{r.claimed_reachable}</td>
      <td className="py-1 pr-3">{r.executable ? "Passed" : "Failed"}</td>
      {r.verified ? (
        <>
          <td className="py-1 pr-3 text-right tabular-nums">{r.verified.R1_count}</td>
          {metricCells(r.verified)}
        </>
      ) : (
        <td colSpan={5} className="py-1 pr-3 font-medium text-red-900">
          Not executable (failed: {r.failed_checks.join(", ")}); the original plan&apos;s numbers are not shown
        </td>
      )}
      <td className="py-1 pr-3 tabular-nums">
        {r.repaired
          ? `reachable ${r.repaired.R1_count} / new ${r.repaired.G} / lost ${r.repaired.L} / net ${signed(r.repaired.N)} / ${usd(r.repaired.total_usd)}`
          : "—"}
      </td>
      <td className="py-1">{r.soft_label}</td>
    </tr>
  );
}

function BaselinesTable({ view }: { view: WhatIfView }) {
  const b = view.baselines!;
  return (
    <div className="rounded border border-gray-300 p-3">
      <h3 className="font-semibold">Baseline comparison (Simulated)</h3>
      <p className="text-sm text-gray-700">
        Same scenario, same budget and capacity, same rules: one independent verifier checks the plan from each approach. &quot;Claimed&quot; is how many pairs the approach thinks are reachable; &quot;verified&quot; is the verifier&apos;s recomputed result. Claimed and verified reachable are counted the same way and both include pairs that were already reachable; new / lost / net change are relative to what was reachable before.
      </p>
      {b.rows.length === 0 ? (
        <p className="mt-2 text-sm">No baseline comparison was run (see the notes below).</p>
      ) : (
        <div
          className="mt-2 max-w-full overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label="Baseline comparison table (scrolls horizontally)"
        >
          <table className="min-w-[64rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-400 text-left">
                <th scope="col" className="py-1 pr-3 font-medium">Approach</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Claimed reachable (pairs)</th>
                <th scope="col" className="py-1 pr-3 font-medium">Executable check</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Verified reachable (pairs)</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">New G</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Lost L</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Net change N</th>
                <th scope="col" className="py-1 pr-3 text-right font-medium">Cost</th>
                <th scope="col" className="py-1 pr-3 font-medium">After first-come-first-served truncation (reachable / new / lost / net / cost)</th>
                <th scope="col" className="py-1 font-medium">Meets organizer requirements</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r) => (
                <BaselineRowView key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.d_ties_joint === true && (
        <p className="mt-2 text-sm text-gray-700">
          Baseline D tying with the joint solver is an expected possible outcome. A tie does not show that the joint solver has no value, nor that it has value; it is only what happens on these sample scenarios. All numbers are Simulated.
        </p>
      )}
      {b.d_ties_joint === false && (
        <p className="mt-2 text-sm text-gray-700">
          On this input, the coordinated separate planners and the joint solver reach different results; see the rows above. All numbers are Simulated.
        </p>
      )}
      {b.rows.length > 0 && (
        <dl className="mt-2 space-y-1 text-sm">
          {b.rows.map((r) => (
            <div key={r.id}>
              <dt className="font-medium">{r.label}</dt>
              <dd className="text-gray-700">
                {r.description}
                {r.repaired ? ` ${r.repaired.note}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ul className="mt-2 list-disc pl-5 text-xs text-gray-600">
        {b.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}
