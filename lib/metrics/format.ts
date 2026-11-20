/**
 * lib/metrics/format — 把 ./reliability 的结果排成可读的纯文本表（英文）。
 * 开头固定写明：示例 / 模拟场景；只是这些输入上的算法正确性证据，不代表真实影响。
 * 基线的头条数字只取每个场景的默认用例（每个（学生, 机会）对只计一次）；跨用例的和一律标明是「对 × 用例」实例数。
 * 纯函数：不读时钟、无 IO、不修改输入、不抛异常。运行时间由调用方（run.metrics.ts）测量后作为可选参数传入，
 * 并标注「依赖机器」。输出只含计数、金额、状态与检查项名称，不含任何学生信息。
 */
import { JOINT_STATUSES } from '../types';
import type { BaselineId } from '../types';
import {
  BASELINE_DEFINITION_NOTE,
  BASELINE_IDS,
  DISCLAIMER,
  RUNTIME_NOT_MEASURED_HERE,
  VALID_ROUTE_DEFINITION,
} from './reliability';
import type {
  BaselineAggregate,
  CaseMetrics,
  CoordinationSummary,
  CoverageNumbers,
  DExceedsReproducer,
  DVsJointSummary,
  ExhaustiveLimits,
  GapCheck,
  ReliabilityReport,
  ReliabilitySummary,
  ScenarioMetrics,
} from './reliability';

/** 运行时间（由 run.metrics.ts 测量；依赖机器）。 */
export interface RuntimeEntry {
  scenario_id: string;
  /** 每个用例单独调用一次 solveJoint 的墙钟时间之和（毫秒）。 */
  solver_ms: number;
  /** 计时的 solveJoint 调用次数（= 用例数）。 */
  solves: number;
  /** measureScenario 整体（两次求解、基线对比、复核、穷举对照）的墙钟时间（毫秒）。 */
  harness_ms: number;
}

export interface FormatOptions {
  runtime?: readonly RuntimeEntry[];
}

export const REPORT_TITLE = 'Opportunity Compass - reliability metrics (joint solver and baselines A/B/C/D)';

export const PAIR_CASE_LABEL = 'pair-case instances summed over the cases; the same pair counts once per case';

const APPROACH_LABELS: Record<BaselineId, string> = {
  A_eligibility_only: 'A eligibility only',
  B_student_side: 'B student-side',
  C_organizer_side: 'C organizer-side',
  D_coordinated: 'Coordinated separate planners',
  joint: 'Joint solver',
};

const SHORT: Record<BaselineId, string> = {
  A_eligibility_only: 'A',
  B_student_side: 'B',
  C_organizer_side: 'C',
  D_coordinated: 'D',
  joint: 'joint',
};

// ───────────────────────────── 工具 ─────────────────────────────

function num(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}

function money(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `$${num(n)}` : '-';
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${num(n)} ${n === 1 ? singular : pluralForm}`;
}

/** 等宽表格；right[i] = 第 i 列右对齐。 */
function table(headers: readonly string[], rows: readonly (readonly string[])[], right: readonly boolean[]): string[] {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: readonly string[]) =>
    cells
      .map((c, i) => (right[i] ? (c ?? '').padStart(widths[i]) : (c ?? '').padEnd(widths[i])))
      .join('  ')
      .trimEnd();
  return [line(headers), widths.map((w) => '-'.repeat(w)).join('  '), ...rows.map(line)];
}

const indent = (lines: string[]) => lines.map((l) => `  ${l}`);

function modeText(c: CaseMetrics): string {
  return c.mode === 'tradeoff' ? `trade-off, cap ${num(c.loss_cap)}` : 'protect';
}

function budgetText(c: CaseMetrics): string {
  return `${money(c.budget_usd)} x${num(c.budget_factor)}`;
}

function floorsText(c: CaseMetrics): string {
  return c.floor_ids.length > 0 ? 'suggested' : 'none';
}

function verdict(claimed: boolean, passed: boolean): string {
  if (!claimed) return 'no plan';
  return passed ? 'pass' : 'REJECTED';
}

function gapText(g: GapCheck | null): string {
  if (g === null) return '-';
  if (!g.checked) return g.reason === 'too_large' ? 'skipped' : '-';
  if (!g.status_agrees) return 'STATUS MISMATCH';
  if (!g.exhaustive_feasible) return 'both infeasible';
  const base = num(g.gap_N);
  if (g.solver_status === 'SEARCH_LIMIT_REACHED') return `${base} (search limit)`;
  if (g.objective_levels_1_6_agree === false) return `${base} (levels differ: ${g.mismatched_levels.join(', ')})`;
  return base;
}

function coverageCells(cov: CoverageNumbers | null): string[] {
  if (!cov) return ['-', '-', '-', '-', '-', '-'];
  return [num(cov.R0), num(cov.R1), num(cov.G), num(cov.L), num(cov.N), money(cov.cost_usd)];
}

function floorsMetText(c: CaseMetrics): string {
  if (c.floor_ids.length === 0 || !c.main || !c.main.fairness) return '-';
  const parts = c.main.fairness.map((f) => `${f.covered_members}/${f.eligible_members}`).join('; ');
  return `${c.main.all_floors_met ? 'yes' : 'no'} (${parts})`;
}

function executableText(b: BaselineAggregate): string {
  const exec = b.cases - b.not_executable_cases;
  if (b.cases === 0) return 'no cases';
  if (exec === 0) return 'never executable here';
  if (exec === b.cases) return 'always executable here';
  return `executable in ${exec} of ${plural(b.cases, 'case')}`;
}

/** B 的「完整方案 / 截断后」放在同一行，避免只读到完整方案的数字。 */
function truncationLines(aggs: Record<BaselineId, BaselineAggregate>): string[] {
  return BASELINE_IDS.filter((id) => aggs[id].not_executable_cases > 0).map(
    (id) =>
      `${SHORT[id]} ${aggs[id].confirmed_reachable} with its full plan (${executableText(aggs[id])}); ${aggs[id].reachable_after_truncation} after its own first-come truncation.`,
  );
}

function bExecutabilitySentence(aggs: Record<BaselineId, BaselineAggregate>): string {
  const b = aggs.B_student_side;
  return `B's untruncated plan was executable in ${b.cases - b.not_executable_cases} of ${plural(b.cases, 'case')} here.`;
}

function roundsText(c: CoordinationSummary): string {
  if (c.cases_measured === 0) return `no case had a baseline D row (${plural(c.cases_not_measured, 'case')} not measured)`;
  const dist = c.distribution.map((d) => `${plural(d.rounds, 'round')}: ${plural(d.cases, 'case')}`).join('; ');
  const range = c.min === c.max ? `${num(c.min)}` : `${num(c.min)} to ${num(c.max)}`;
  return `measured in ${plural(c.cases_measured, 'case')} (rounds ${range}; ${dist}); ${c.not_converged} did not converge within the round limit${c.cases_not_measured > 0 ? `; ${plural(c.cases_not_measured, 'case')} not measured (no baseline D row: invalid input or a measurement error)` : ''}`;
}

/** 复现条目里 D 与联合求解的 N、L、成本。 */
function dJointNumbers(r: DExceedsReproducer): string {
  return `D N ${num(r.d_N)}, L ${num(r.d_L)}, cost $${num(r.d_cost_usd)}; joint N ${num(r.joint_N)}, L ${num(r.joint_L)}, cost $${num(r.joint_cost_usd)}`;
}

/** D 与联合求解的对照（D 按目标顺序优于联合求解时醒目标出）。 */
function dVsJointLines(d: DVsJointSummary, pad: string): string[] {
  const out: string[] = [];
  out.push(
    `${pad}Baseline D vs joint solver: tied (same verified N, L and cost) in ${d.ties} of ${plural(d.compared, 'case')}; both plans executable in ${d.both_executable}; D plan not executable in ${d.d_not_executable}; D hit a node or size limit in ${d.d_limited}.`,
  );
  out.push(`${pad}${d.note}`);
  if (d.d_exceeds_joint > 0) {
    out.push(
      `${pad}!!! WARNING: D did better than the joint solver on N, L or cost (objective order: larger N, then smaller L, then lower cost) in ${plural(d.d_exceeds_joint, 'case')}. This points to a problem in the joint solver:`,
    );
    for (const r of d.reproducers) {
      out.push(`${pad}!!!   scenario ${r.scenario_id}, case ${r.case_id}: ${dJointNumbers(r)} (joint status ${r.joint_status})`);
    }
  } else {
    out.push(`${pad}D never did better than the joint solver on N, L or cost (objective order N, then L, then cost; 0 cases).`);
  }
  return out;
}

function limitsText(l: ExhaustiveLimits): string {
  return `at most ${num(l.pairs)} (student, opportunity) pairs, ${num(l.interventions)} support measures and ${num(l.revocableGrants)} revocable grants per scenario`;
}

// ───────────────────────────── 各节 ─────────────────────────────

function scenarioSection(s: ScenarioMetrics): string[] {
  const out: string[] = [];
  const z = s.size;
  out.push(`Scenario ${s.id} (${plural(s.cases.length, 'case')})`);
  out.push(`  ${s.title}`);
  out.push(
    s.real_opportunity_note
      ? `  Real opportunity note: ${s.real_opportunity_note}`
      : '  Opportunity: sample / placeholder (this scenario has no real-listing note).',
  );
  out.push(
    `  Size: ${plural(z.students, 'student')}, ${plural(z.opportunities, 'opportunity', 'opportunities')}, ${plural(z.measures, 'support measure')} (${num(z.pending_measures)} pending approval), ${plural(z.existing_grants, 'existing grant')} (${num(z.revocable_grants)} revocable).`,
  );
  out.push(
    `  Exhaustive cross-check: ${s.within_exhaustive_limits ? 'yes (scenario is within the exhaustive-search size limits)' : 'skipped: scenario is too large for exhaustive search (not counted as gap 0)'}.`,
  );
  out.push('');

  out.push('  Main result per case (numbers recomputed by the independent verifier; R0/R1/G/L/N count (student, opportunity) pairs):');
  const mainRows = s.cases.map((c) => [
    modeText(c),
    budgetText(c),
    floorsText(c),
    c.error ? `ERROR (${c.error})` : (c.status ?? '-'),
    c.main ? verdict(c.main.claimed_feasible, c.main.verifier_passed) : '-',
    ...coverageCells(c.main ? c.main.coverage : null),
    floorsMetText(c),
    gapText(c.optimality.main),
    c.deterministic === null ? '-' : c.deterministic ? 'yes' : 'NO',
  ]);
  out.push(
    ...indent(
      table(
        ['mode', 'budget', 'floors', 'status', 'verifier', 'R0', 'R1', 'G', 'L', 'N', 'cost', 'floors met (covered/eligible)', 'opt. gap', 'same twice'],
        mainRows,
        [false, false, false, false, false, true, true, true, true, true, true, false, false, false],
      ),
    ),
  );

  const withCond = s.cases.filter((c) => c.conditional);
  if (withCond.length > 0) {
    out.push('');
    out.push('  Conditional result (all pending measures treated as approved; not in effect):');
    out.push(
      ...indent(
        table(
          ['mode', 'budget', 'floors', 'status', 'verifier', 'G', 'L', 'N', 'cost', 'opt. gap'],
          withCond.map((c) => {
            const k = c.conditional!;
            return [
              modeText(c),
              budgetText(c),
              floorsText(c),
              k.status,
              verdict(k.claimed_feasible, k.verifier_passed),
              num(k.coverage.G),
              num(k.coverage.L),
              num(k.coverage.N),
              money(k.coverage.cost_usd),
              gapText(c.optimality.conditional),
            ];
          }),
          [false, false, false, false, false, true, true, true, true, false],
        ),
      ),
    );
  }

  const withAlt = s.cases.filter((c) => c.alternative);
  if (withAlt.length > 0) {
    out.push('');
    out.push('  Relaxed alternative for INFEASIBLE cases (only soft requirements relaxed, stated explicitly; not the main result):');
    out.push(
      ...indent(
        table(
          ['mode', 'budget', 'floors', 'relaxed', 'verifier', 'G', 'L', 'N', 'cost'],
          withAlt.map((c) => {
            const a = c.alternative!;
            return [
              modeText(c),
              budgetText(c),
              floorsText(c),
              a.relaxed.join(' + '),
              a.verifier_passed ? 'pass' : 'REJECTED',
              num(a.coverage.G),
              num(a.coverage.L),
              num(a.coverage.N),
              money(a.coverage.cost_usd),
            ];
          }),
          [false, false, false, false, false, true, true, true, true],
        ),
      ),
    );
  }

  const sum = s.summary;
  out.push('');
  out.push('  Baselines, default case (protect, scenario budget, no floors; each pair counted once). Same scenario, options and verifier for every row.');
  out.push(`  ${BASELINE_DEFINITION_NOTE} ${bExecutabilitySentence(sum.baselines)}`);
  out.push(
    ...indent(
      table(
        ['approach', 'claimed', 'confirmed', 'unconfirmed', 'executable', 'confirmed new', 'after truncation'],
        BASELINE_IDS.map((id) => {
          const b = sum.baselines_default[id];
          return [
            APPROACH_LABELS[id],
            num(b.claimed_reachable),
            num(b.confirmed_reachable),
            num(b.unconfirmed_claims),
            b.cases === 0 ? '-' : b.not_executable_cases === 0 ? 'yes' : 'no',
            num(b.confirmed_new),
            b.not_executable_cases > 0 ? num(b.reachable_after_truncation) : '-',
          ];
        }),
        [false, true, true, true, false, true, true],
      ),
    ),
  );
  out.push('');
  out.push(`  Baselines, all ${plural(s.cases.length, 'case')} (${PAIR_CASE_LABEL}):`);
  out.push(...indent(baselineTable(sum)));
  out.push(`  Baseline D coordination rounds: ${roundsText(sum.coordination_rounds)}.`);
  out.push(...dVsJointLines(sum.d_vs_joint, '  '));
  return out;
}

function baselineTable(sum: ReliabilitySummary): string[] {
  const floorCases = sum.fairness_compliance.cases_with_floors;
  return table(
    ['approach', 'claimed', 'confirmed', 'unconfirmed', 'not executable', 'confirmed new', 'after truncation', 'floors met'],
    BASELINE_IDS.map((id) => {
      const b = sum.baselines[id];
      return [
        APPROACH_LABELS[id],
        num(b.claimed_reachable),
        num(b.confirmed_reachable),
        num(b.unconfirmed_claims),
        `${num(b.not_executable_cases)}/${num(b.cases)}`,
        num(b.confirmed_new),
        b.not_executable_cases > 0 ? num(b.reachable_after_truncation) : '-',
        floorCases > 0 ? `${num(b.floors_met_cases)}/${num(floorCases)}` : '-',
      ];
    }),
    [false, true, true, true, true, true, true, true],
  );
}

function perApproach(aggs: Record<BaselineId, BaselineAggregate>, pick: (b: BaselineAggregate) => string): string {
  return BASELINE_IDS.map((id) => `${SHORT[id]} ${pick(aggs[id])}`).join(', ');
}

function summarySection(t: ReliabilitySummary, limits: ExhaustiveLimits | null, runtime: readonly RuntimeEntry[] | undefined): string[] {
  const out: string[] = [];
  const allLabel = `all ${plural(t.cases, 'case')} (${PAIR_CASE_LABEL})`;
  const defLabel = `default case of each scenario (${plural(t.default_cases, 'case')}; each pair counted once)`;
  out.push(`Summary over all scenarios (${plural(t.cases, 'case')}${t.errors > 0 ? `, ${plural(t.errors, 'measurement error')}` : ''})`);
  out.push(`  Solver status counts: ${JOINT_STATUSES.map((s) => `${s} ${t.status_counts[s]}`).join(', ')}.`);
  out.push('');

  out.push('  [valid-route discovery] measured as a proxy only.');
  out.push(`    Headline, ${defLabel}:`);
  out.push(`      verifier-confirmed reachable pairs ${perApproach(t.baselines_default, (b) => num(b.confirmed_reachable))}; newly reachable (G) ${perApproach(t.baselines_default, (b) => num(b.confirmed_new))}.`);
  for (const l of truncationLines(t.baselines_default)) out.push(`      ${l}`);
  out.push(`    Second, ${allLabel}:`);
  out.push(`      verifier-confirmed reachable pairs ${perApproach(t.baselines, (b) => num(b.confirmed_reachable))}; newly reachable (G) ${perApproach(t.baselines, (b) => num(b.confirmed_new))}.`);
  for (const l of truncationLines(t.baselines)) out.push(`      ${l}`);
  out.push(
    `      Newly reachable (G), protect-mode cases only (${plural(t.protect_cases, 'case')}; no approach revokes anything there): C ${t.baselines_protect.C_organizer_side.confirmed_new}, D ${t.baselines_protect.D_coordinated.confirmed_new}, joint ${t.baselines_protect.joint.confirmed_new} (all cases: C ${t.baselines.C_organizer_side.confirmed_new}, D ${t.baselines.D_coordinated.confirmed_new}, joint ${t.baselines.joint.confirmed_new}).`,
  );
  out.push(`    ${VALID_ROUTE_DEFINITION}`);

  const ff = t.solver_false_feasibility;
  out.push('  [false feasibility]');
  out.push(
    `    Solver: ${ff.rejected} of ${plural(ff.plans_checked, 'plan')} returned as feasible were rejected by the independent verifier (main ${ff.by_kind.main.rejected}/${ff.by_kind.main.checked}, conditional ${ff.by_kind.conditional.rejected}/${ff.by_kind.conditional.checked}, relaxed alternative ${ff.by_kind.alternative.rejected}/${ff.by_kind.alternative.checked}). Expected 0.`,
  );
  out.push(`    Of those ${plural(ff.plans_checked, 'plan')}, ${ff.non_empty_plans_checked} change something (non-empty plan) and ${ff.empty_plans_checked} are empty plans.`);
  out.push(
    `    Baselines, claimed reachable pairs not confirmed by the verifier. Headline, ${defLabel}: ${perApproach(t.baselines_default, (b) => `${b.unconfirmed_claims} of ${b.claimed_reachable}`)}.`,
  );
  out.push(`    Second, ${allLabel}: ${perApproach(t.baselines, (b) => `${b.unconfirmed_claims} of ${b.claimed_reachable}`)}.`);
  out.push(`    Cases whose plan fails the verifier's executability checks: ${perApproach(t.baselines, (b) => `${b.not_executable_cases}/${b.cases}`)}.`);
  {
    const d = t.baselines.D_coordinated;
    out.push(
      `    Baseline D (${allLabel}): ${d.unconfirmed_claims} of ${d.claimed_reachable} claimed reachable pairs not confirmed by the verifier; plan not executable in ${d.not_executable_cases} of ${plural(d.cases, 'case')}.`,
    );
  }
  out.push(`    ${BASELINE_DEFINITION_NOTE} ${bExecutabilitySentence(t.baselines)}`);

  out.push('  [net coverage] See the per-case rows above (R0, R1, G, L, N and cost from the verifier\'s recomputation).');

  const fc = t.fairness_compliance;
  out.push('  [fairness compliance]');
  if (fc.cases_with_floors === 0) {
    out.push('    No case was run with fairness floors.');
  } else {
    const agree =
      fc.infeasible === 0
        ? ''
        : `; exhaustive search agrees in ${fc.infeasible_confirmed_by_exhaustive} of them${fc.infeasible_not_cross_checked > 0 ? ` (${fc.infeasible_not_cross_checked} not cross-checked: skipped as too large or errored)` : ''}`;
    out.push(
      `    Joint solver main plan meets every floor in ${fc.main_plan_meets_all} of ${plural(fc.cases_with_floors, 'case')} run with the suggested floors. ${fc.infeasible} of the ${fc.cases_with_floors} are INFEASIBLE per the solver (the floors cannot be met under that budget, capacity and eligibility, and were not relaxed silently)${agree}.`,
    );
    out.push(
      `    Plans that are executable and meet every floor, by approach: ${BASELINE_IDS.map((id) => `${SHORT[id]} ${fc.by_approach[id]}/${fc.cases_with_floors}`).join(', ')}.`,
    );
    out.push(`    ${fc.baseline_note}`);
  }

  const g = t.optimality_gap;
  out.push('  [optimality gap]');
  if (limits) out.push(`    Exhaustive search limits: ${limitsText(limits)}.`);
  out.push(
    `    ${plural(g.cross_checked, 'solve')} cross-checked against exhaustive search (main and conditional results): ${g.zero_gap} with gap 0 (${g.zero_gap_positive_N} of them with optimal N > 0), ${g.both_infeasible} both infeasible (${g.both_infeasible_zero_budget} of them $0-budget cases), ${g.search_limited} hit the search limit, ${g.nonzero_gap} with a nonzero gap, ${g.status_mismatches} status mismatches, ${g.objective_level_mismatches} objective-level mismatches. Max gap: ${g.max_gap === null ? 'n/a' : num(g.max_gap)}.`,
  );
  out.push('    Gap 0 means objective levels 1-6 agree (N, L, total cost, allocation count, measure count, revocation count, using the verifier\'s recomputed N, L and cost); the final lexicographic tie-break is not compared.');
  out.push(`    ${plural(g.skipped_too_large, 'solve')} skipped as too large for exhaustive search (not counted as gap 0).`);

  out.push(`  [determinism] ${t.determinism.identical} of ${plural(t.determinism.cases, 'case')} gave identical results when solved twice.`);
  out.push(`  [coordination rounds] baseline D: ${roundsText(t.coordination_rounds)}.`);
  out.push(`    ${t.coordination_rounds.definition}`);
  out.push(`    ${t.coordination_rounds.note}`);
  out.push('  [baseline D vs joint solver]');
  out.push(...dVsJointLines(t.d_vs_joint, '    '));
  if (runtime && runtime.length > 0) {
    out.push('  [runtime] measured by the runner; machine-dependent, see the runtime table below.');
  } else {
    out.push(`  [runtime] not measured here: ${RUNTIME_NOT_MEASURED_HERE}`);
  }

  if (ff.reproducers.length > 0 || g.reproducers.length > 0 || t.d_vs_joint.reproducers.length > 0) {
    out.push('');
    out.push('  Problems to investigate (reproducing cases):');
    for (const r of ff.reproducers) {
      out.push(`    verifier rejected solver ${r.kind} plan: scenario ${r.scenario_id}, case ${r.case_id}; failed checks: ${r.failed_checks.join(', ') || '(none listed)'}`);
    }
    for (const r of g.reproducers) {
      out.push(
        `    ${r.problem.replace(/_/g, ' ')} (${r.which}): scenario ${r.scenario_id}, case ${r.case_id}; exhaustive N ${r.exhaustive_N === null ? 'infeasible' : num(r.exhaustive_N)}, solver ${r.solver_status} with verified N ${num(r.verified_N)}${r.mismatched_levels.length > 0 ? `; levels differ: ${r.mismatched_levels.join(', ')}` : ''}`,
      );
    }
    for (const r of t.d_vs_joint.reproducers) {
      out.push(`    D did better than the joint solver on N, L or cost: scenario ${r.scenario_id}, case ${r.case_id}; ${dJointNumbers(r)} (joint ${r.joint_status})`);
    }
  }
  return out;
}

function runtimeSection(runtime: readonly RuntimeEntry[]): string[] {
  return [
    'Runtime (wall-clock on this machine; machine-dependent, not evidence of correctness)',
    ...indent(
      table(
        ['scenario', 'solveJoint calls', 'solver ms (sum)', 'harness ms'],
        runtime.map((r) => [r.scenario_id, num(r.solves), num(Math.round(r.solver_ms * 10) / 10), num(Math.round(r.harness_ms))]),
        [false, true, true, true],
      ),
    ),
    '  harness = two solves, baseline comparison (including baseline D\'s coordination), verifier checks and exhaustive cross-check for every case.',
    '  The first scenario\'s times include warm-up (module loading, JIT compilation, caches).',
  ];
}

// ───────────────────────────── 主函数 ─────────────────────────────

export function formatReliabilityReport(report: ReliabilityReport, options: FormatOptions = {}): string {
  const rule = '='.repeat(100);
  const out: string[] = [rule, REPORT_TITLE, DISCLAIMER, rule, ''];
  try {
    for (const s of report.scenarios) {
      out.push(...scenarioSection(s), '');
    }
    out.push(...summarySection(report.totals, report.exhaustive_limits ?? null, options.runtime), '');
    if (options.runtime && options.runtime.length > 0) out.push(...runtimeSection(options.runtime), '');
    out.push('Definitions');
    for (const [k, v] of Object.entries(report.definitions)) out.push(`  ${k}: ${v}`);
  } catch {
    out.push('The report could not be formatted (malformed input).');
  }
  return out.join('\n');
}
