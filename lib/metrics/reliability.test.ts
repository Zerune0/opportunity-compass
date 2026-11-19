/**
 * lib/metrics 的性质测试（随 npm test 运行）。只断言必须成立的关系，不钉死会随场景数据调整而变化的总数：
 * - 求解器的假可行在每个用例上都是 0（验证器复核求解器给出的每个可行方案）；
 * - 每个与穷举对照过的求解 gap 都是 0、前六级目标一致、状态一致；跳过的用例不报告 gap（不当作 0）；
 * - 同一用例求解两次结果相同，测量本身也是确定性的；
 * - 净覆盖、公平底线、基线行之间的关系；基线头条只取默认用例，跨用例的和标明是「对 × 用例」实例数；
 * - summarize 在手工构造的数据上正确计数（拒绝、跳过、状态不一致、达到搜索上限）；
 * - 输出（JSON 与文字表）不含任何学生的 id、显示名、学校名；文字表开头写明 Sample / simulated。
 * 篡改求解器结果的测试在 ./false-feasibility.test.ts（vi.mock 作用于整个文件，所以单独放）。
 * 全部是示例 / 模拟数据。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BaselineId, Scenario } from '../types';
import { SCENARIOS } from '../joint/scenarios';
import { solveJoint } from '../joint';
import { formatReliabilityReport, PAIR_CASE_LABEL, REPORT_TITLE } from './format';
import {
  BASELINE_DEFINITION_NOTE,
  BASELINE_IDS,
  buildCases,
  DEFAULT_EXHAUSTIVE_LIMITS,
  FAIRNESS_BASELINE_NOTE,
  measureAll,
  measureCase,
  measureScenario,
  SHARED_MODEL_NOTE,
  summarize,
} from './reliability';
import type { BaselineAggregate, CaseMetrics, GapCheck, MetricsCase, ReliabilityReport } from './reliability';

let report: ReliabilityReport;
let text: string;
let inputBefore: string;
let inputAfter: string;

beforeAll(() => {
  inputBefore = JSON.stringify(SCENARIOS);
  report = measureAll(SCENARIOS);
  inputAfter = JSON.stringify(SCENARIOS);
  text = formatReliabilityReport(report, {
    runtime: report.scenarios.map((s) => ({ scenario_id: s.id, solver_ms: 1.5, solves: s.cases.length, harness_ms: 10 })),
  });
}, 60_000);

const allCases = (): CaseMetrics[] => report.scenarios.flatMap((s) => s.cases);

describe('reliability metrics on the sample scenarios', () => {
  it('measures every sample scenario without errors or unsupported input; one default case per scenario', () => {
    expect(report.scenarios.map((s) => s.id)).toEqual(SCENARIOS.map((e) => e.id));
    for (const s of report.scenarios) {
      const entry = SCENARIOS.find((e) => e.id === s.id)!;
      expect(s.cases.length).toBe(buildCases(entry).length);
      expect(s.cases.filter((c) => c.is_default)).toHaveLength(1);
      // 第一项是默认用例：protect、场景预算、不设底线。
      expect(s.cases[0]).toMatchObject({ is_default: true, mode: 'protect', budget_usd: entry.scenario.budget_usd, floor_ids: [] });
    }
    expect(report.totals.errors).toBe(0);
    expect(report.totals.status_counts.UNSUPPORTED_INPUT).toBe(0);
    expect(report.totals.cases).toBe(allCases().length);
    expect(report.totals.default_cases).toBe(SCENARIOS.length);
    expect(report.kind).toBe('sample_simulated');
    expect(report.exhaustive_limits).toEqual(DEFAULT_EXHAUSTIVE_LIMITS);
  });

  it('does not mutate the scenario entries', () => {
    expect(inputAfter).toBe(inputBefore);
  });

  it('solver false feasibility is 0 on every case', () => {
    for (const c of allCases()) {
      expect(c.solver_false_feasible, `${c.scenario_id} ${c.case_id}`).toBe(0);
      if (c.main?.claimed_feasible) expect(c.main.verifier_passed, `${c.scenario_id} ${c.case_id}`).toBe(true);
      if (c.conditional?.claimed_feasible) expect(c.conditional.verifier_passed).toBe(true);
      if (c.alternative) expect(c.alternative.verifier_passed).toBe(true);
    }
    const ff = report.totals.solver_false_feasibility;
    expect(ff.rejected).toBe(0);
    expect(ff.reproducers).toEqual([]);
    // 每个 OPTIMAL 主结果都交给了验证器，而且其中确实有改变了什么的方案（不是空洞地通过）。
    expect(ff.by_kind.main.checked).toBeGreaterThanOrEqual(report.totals.status_counts.OPTIMAL);
    expect(ff.non_empty_plans_checked).toBeGreaterThan(0);
    expect(ff.non_empty_plans_checked + ff.empty_plans_checked).toBe(ff.plans_checked);
  });

  it('conditional results assume exactly the scenario\'s pending measures', () => {
    const withCond = allCases().filter((c) => c.conditional);
    expect(withCond.length).toBeGreaterThan(0);
    for (const c of withCond) expect(c.conditional!.pending_ids_match, `${c.scenario_id} ${c.case_id}`).toBe(true);
  });

  it('optimality gap is 0 on every cross-checked solve, objective levels 1-6 agree, and statuses agree with exhaustive search', () => {
    const checks: GapCheck[] = allCases().flatMap((c) => [c.optimality.main, ...(c.optimality.conditional ? [c.optimality.conditional] : [])]);
    for (const g of checks) {
      if (!g.checked) continue;
      expect(g.status_agrees).toBe(true);
      if (g.exhaustive_feasible && g.solver_status === 'OPTIMAL') {
        expect(g.gap_N).toBe(0);
        expect(g.objective_levels_1_6_agree).toBe(true);
        expect(g.mismatched_levels).toEqual([]);
      }
    }
    const gap = report.totals.optimality_gap;
    expect(gap.cross_checked).toBeGreaterThan(0);
    expect(gap.zero_gap_positive_N).toBeGreaterThan(0);
    expect(gap.nonzero_gap).toBe(0);
    expect(gap.status_mismatches).toBe(0);
    expect(gap.objective_level_mismatches).toBe(0);
    expect(gap.reproducers).toEqual([]);
    expect(gap.zero_gap + gap.both_infeasible + gap.search_limited).toBe(gap.cross_checked);
    expect(gap.both_infeasible_zero_budget).toBeLessThanOrEqual(gap.both_infeasible);
  });

  it('a scenario over the exhaustive size limits is reported as skipped, never as gap 0', () => {
    const entry = SCENARIOS[SCENARIOS.length - 1];
    const s = measureScenario(entry, buildCases(entry).slice(0, 2), { exhaustiveLimits: { pairs: 0, interventions: 0, revocableGrants: 0 } });
    expect(s.within_exhaustive_limits).toBe(false);
    for (const c of s.cases) {
      expect(c.optimality.main).toEqual({ checked: false, reason: 'too_large' });
    }
    expect(s.summary.optimality_gap.cross_checked).toBe(0);
    expect(s.summary.optimality_gap.zero_gap).toBe(0);
    expect(s.summary.optimality_gap.max_gap).toBeNull();
    expect(s.summary.optimality_gap.skipped_too_large).toBeGreaterThanOrEqual(s.cases.length);
    expect(formatReliabilityReport({ ...report, scenarios: [s], totals: s.summary })).toContain('skipped as too large');
  });

  it('is deterministic: each case solves identically twice, and measuring again gives the same data', () => {
    for (const c of allCases()) expect(c.deterministic, `${c.scenario_id} ${c.case_id}`).toBe(true);
    expect(report.totals.determinism.identical).toBe(report.totals.determinism.cases);
    // 再测一次最小的场景，结果与第一次完全相同。
    const smallest = [...SCENARIOS].sort(
      (a, b) => a.scenario.students.length * a.scenario.opportunities.length - b.scenario.students.length * b.scenario.opportunities.length,
    )[0];
    const again = measureScenario(smallest);
    expect(JSON.stringify(again)).toBe(JSON.stringify(report.scenarios.find((s) => s.id === smallest.id)));
  });

  it('net coverage numbers are consistent (N = G - L, R1 = R0 + G - L, protect never loses, cost within budget)', () => {
    for (const c of allCases()) {
      const label = `${c.scenario_id} ${c.case_id}`;
      expect(c.main, label).not.toBeNull();
      const cov = c.main!.coverage;
      expect(cov.N, label).toBe(cov.G - cov.L);
      expect(cov.R1, label).toBe(cov.R0 + cov.G - cov.L);
      expect(cov.cost_usd, label).toBeLessThanOrEqual(c.budget_usd + 1e-6);
      if (c.mode === 'protect') {
        expect(cov.L, label).toBe(0);
        expect(cov.revoked_grants, label).toBe(0);
      } else {
        expect(cov.L, label).toBeLessThanOrEqual(c.loss_cap!);
      }
      if (c.status === 'INFEASIBLE') {
        expect(cov).toMatchObject({ G: 0, L: 0, N: 0, cost_usd: 0 });
        expect(c.main!.empty_plan).toBe(true);
        expect(c.alternative, label).not.toBeNull();
      }
    }
  });

  it('fairness compliance: OPTIMAL plans meet every floor; INFEASIBLE ones are not relaxed silently and agree with exhaustive search', () => {
    const withFloors = allCases().filter((c) => c.floor_ids.length > 0);
    const fc = report.totals.fairness_compliance;
    expect(fc.cases_with_floors).toBe(withFloors.length);
    for (const c of withFloors) {
      expect(c.main!.fairness).not.toBeNull();
      expect(c.main!.fairness!.map((f) => f.floor_id)).toEqual(c.floor_ids);
      if (c.status === 'OPTIMAL') expect(c.main!.all_floors_met).toBe(true);
      if (c.status === 'INFEASIBLE') {
        expect(c.main!.all_floors_met).toBe(false);
        expect(c.alternative!.relaxed).toContain('fairness_floors');
      }
    }
    for (const c of allCases().filter((x) => x.floor_ids.length === 0)) {
      expect(c.main!.fairness).toBeNull();
      expect(c.baselines.every((r) => r.floors_met === null)).toBe(true);
    }
    expect(fc.infeasible).toBe(withFloors.filter((c) => c.status === 'INFEASIBLE').length);
    expect(fc.infeasible_confirmed_by_exhaustive + fc.infeasible_not_cross_checked).toBe(fc.infeasible);
    expect(fc.main_plan_meets_all).toBeLessThanOrEqual(fc.cases_with_floors);
    expect(fc.by_approach.joint).toBe(fc.main_plan_meets_all);
    expect(fc.baseline_note).toBe(FAIRNESS_BASELINE_NOTE);
  });

  it('baseline rows: fixed order, verifier-confirmed counts never exceed claims, the joint row is fully confirmed', () => {
    for (const c of allCases()) {
      const label = `${c.scenario_id} ${c.case_id}`;
      expect(c.baselines.map((r) => r.id), label).toEqual([...BASELINE_IDS]);
      for (const r of c.baselines) {
        expect(r.confirmed_reachable, `${label} ${r.id}`).toBeLessThanOrEqual(r.claimed_reachable);
        expect(r.unconfirmed_claims).toBe(r.claimed_reachable - r.confirmed_reachable);
        if (!r.executable) expect(r.confirmed_reachable, `${label} ${r.id}`).toBe(c.main!.coverage.R0);
      }
      const joint = c.baselines.find((r) => r.id === 'joint')!;
      expect(joint.executable, label).toBe(true);
      expect(joint.unconfirmed_claims, label).toBe(0);
      expect(joint.confirmed_reachable, label).toBe(c.main!.coverage.R1);
      const a = c.baselines.find((r) => r.id === 'A_eligibility_only')!;
      expect(a.executable).toBe(true);
      expect(a.confirmed_new).toBe(0);
    }
  });

  it('baseline aggregates equal explicit sums: headline over default cases, second over all cases, protect-only', () => {
    const sumOver = (cases: CaseMetrics[], id: BaselineId) => {
      const rows = cases.map((c) => c.baselines.find((r) => r.id === id)!);
      return {
        cases: rows.length,
        claimed_reachable: rows.reduce((n, r) => n + r.claimed_reachable, 0),
        confirmed_reachable: rows.reduce((n, r) => n + r.confirmed_reachable, 0),
        confirmed_new: rows.reduce((n, r) => n + r.confirmed_new, 0),
        unconfirmed_claims: rows.reduce((n, r) => n + r.unconfirmed_claims, 0),
        not_executable_cases: rows.filter((r) => !r.executable).length,
      };
    };
    const pick = (b: BaselineAggregate) => ({
      cases: b.cases,
      claimed_reachable: b.claimed_reachable,
      confirmed_reachable: b.confirmed_reachable,
      confirmed_new: b.confirmed_new,
      unconfirmed_claims: b.unconfirmed_claims,
      not_executable_cases: b.not_executable_cases,
    });
    const t = report.totals;
    for (const id of BASELINE_IDS) {
      expect(pick(t.baselines[id]), id).toEqual(sumOver(allCases(), id));
      expect(pick(t.baselines_default[id]), id).toEqual(sumOver(allCases().filter((c) => c.is_default), id));
      expect(pick(t.baselines_protect[id]), id).toEqual(sumOver(allCases().filter((c) => c.mode === 'protect'), id));
      expect(t.valid_route_discovery.default_cases[id].confirmed_reachable).toBe(t.baselines_default[id].confirmed_reachable);
    }
    // 头条（默认用例）中每个对只计一次：A 声称的对数不超过场景内全部（学生, 机会）对数。
    const distinctPairs = report.scenarios.reduce((n, s) => n + s.size.students * s.size.opportunities, 0);
    expect(t.baselines_default.A_eligibility_only.claimed_reachable).toBeLessThanOrEqual(distinctPairs);
  });

  it('reports coordination rounds and runtime as not measured, with a reason and no number', () => {
    const names = report.not_measured.map((m) => m.metric);
    expect(names).toEqual(expect.arrayContaining(['coordination_rounds', 'runtime']));
    for (const m of report.not_measured) expect(m.reason.trim().length).toBeGreaterThan(10);
    expect(report.totals.coordination_rounds).toEqual({ status: 'not_measured', reason: expect.any(String) });
    expect(text).toMatch(/\[coordination rounds\] not measured: /);
    expect(report.definitions.shared_model).toBe(SHARED_MODEL_NOTE);
  });

  it('never outputs a student display name, id or school', () => {
    const json = JSON.stringify(report);
    const tokens = new Set<string>();
    for (const e of SCENARIOS) {
      for (const s of e.scenario.students) {
        tokens.add(s.id);
        if (typeof s.display_name === 'string' && s.display_name.length >= 3) tokens.add(s.display_name);
        if (typeof s.school_name === 'string' && s.school_name.length >= 3) tokens.add(s.school_name);
      }
    }
    expect(tokens.size).toBeGreaterThan(0);
    for (const t of tokens) {
      expect(json.includes(t), t).toBe(false);
      expect(text.includes(t), t).toBe(false);
    }
  });

  it('the pure source files do not read student identity fields, the clock, the file system or the process', () => {
    for (const f of ['reliability.ts', 'format.ts']) {
      const src = readFileSync(join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/display_name|school_name|birth_date|\.age\b/);
      expect(src).not.toMatch(/Date\.now|new Date|performance\.now|Math\.random|localStorage|writeFile|node:fs|process\./);
    }
  });

  it('the text table starts with the sample / simulated header, labels sums over cases, and has no NaN or undefined', () => {
    const head = text.split('\n').slice(0, 5).join('\n');
    expect(head).toContain(REPORT_TITLE);
    expect(head).toContain('Sample / simulated scenarios');
    expect(head).toContain('not about real-world impact');
    for (const s of report.scenarios) expect(text).toContain(`Scenario ${s.id}`);
    expect(text).toContain('machine-dependent');
    expect(text).toContain('Exhaustive search limits:');
    expect(text).toContain(PAIR_CASE_LABEL);
    expect(text).toContain(BASELINE_DEFINITION_NOTE);
    expect(text).toContain(FAIRNESS_BASELINE_NOTE);
    expect(text).toContain('the final lexicographic tie-break is not compared');
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object Object\]/);
  });

  it('prints a scenario\'s real-opportunity note when given, and says "placeholder" otherwise', () => {
    const entry = SCENARIOS[0];
    const withNote = measureScenario({ ...entry, realOpportunityNote: 'Example real-listing note.' }, []);
    const plain = measureScenario(entry, []);
    expect(withNote.real_opportunity_note).toBe('Example real-listing note.');
    const out = formatReliabilityReport({ ...report, scenarios: [withNote, plain], totals: summarize([]) });
    expect(out).toContain('Real opportunity note: Example real-listing note.');
    expect(out).toContain('Opportunity: sample / placeholder');
  });
});

describe('SEARCH_LIMIT_REACHED handling', () => {
  it('a search-limited non-empty plan is checked by the verifier and counted as search-limited, not as a gap', () => {
    // 找一个能让求解器达到上限、但已给出非空方案的 max_search_nodes（确定性；不钉死具体数值）。
    let found: { entryIndex: number; nodes: number } | null = null;
    for (let k = 0; k < SCENARIOS.length && !found; k++) {
      for (const nodes of [5, 10, 20, 50, 100, 200, 500, 1000, 2000]) {
        const r = solveJoint(SCENARIOS[k].scenario, { mode: 'protect', max_search_nodes: nodes });
        if (r.status === 'SEARCH_LIMIT_REACHED' && (r.selected_intervention_ids.length > 0 || r.allocations.length > 0)) {
          found = { entryIndex: k, nodes };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const entry = SCENARIOS[found!.entryIndex];
    const base = buildCases(entry)[0];
    const c: MetricsCase = {
      spec: { ...base.spec, case_id: `protect/budget-x1/max-nodes-${found!.nodes}`, is_default: false },
      scenario: base.scenario,
      options: { ...base.options, max_search_nodes: found!.nodes },
    };
    const m = measureCase(entry.id, c, true);
    expect(m.status).toBe('SEARCH_LIMIT_REACHED');
    expect(m.main!.claimed_feasible).toBe(true);
    expect(m.main!.empty_plan).toBe(false);
    expect(m.solver_plans_checked).toBeGreaterThanOrEqual(1);
    expect(m.solver_false_feasible).toBe(0);
    const s = summarize([m]);
    expect(s.solver_false_feasibility.by_kind.main.checked).toBe(1);
    expect(s.optimality_gap.search_limited).toBeGreaterThanOrEqual(1);
    expect(s.optimality_gap.nonzero_gap).toBe(0);
    expect(s.optimality_gap.zero_gap).toBe(0);
  });
});

// ───────────────────────── summarize：手工构造的数据 ─────────────────────────

const COV = { R0: 0, R1: 1, G: 1, L: 0, N: 1, cost_usd: 10, revoked_grants: 0 };
const OK_GAP: GapCheck = {
  checked: true,
  exhaustive_feasible: true,
  exhaustive_N: 1,
  solver_status: 'OPTIMAL',
  verified_N: 1,
  gap_N: 0,
  status_agrees: true,
  objective_levels_1_6_agree: true,
  mismatched_levels: [],
};

function fakeCase(over: Partial<CaseMetrics> = {}): CaseMetrics {
  return {
    case_id: 'case-1',
    label: 'hand-built',
    mode: 'protect',
    loss_cap: null,
    budget_usd: 100,
    budget_factor: 1,
    floor_ids: [],
    is_default: true,
    scenario_id: 'hand-built-scenario',
    error: null,
    status: 'OPTIMAL',
    main: { claimed_feasible: true, empty_plan: false, verifier_passed: true, failed_checks: [], coverage: COV, fairness: null, all_floors_met: null },
    conditional: null,
    alternative: null,
    solver_plans_checked: 1,
    solver_false_feasible: 0,
    optimality: { main: OK_GAP, conditional: null },
    deterministic: true,
    baselines: [],
    ...over,
  };
}

describe('summarize on hand-built case data', () => {
  it('counts a verifier-rejected solver plan as false feasibility, with a reproducer', () => {
    const c = fakeCase({
      main: { claimed_feasible: true, empty_plan: false, verifier_passed: false, failed_checks: ['budget', 'metrics'], coverage: COV, fairness: null, all_floors_met: null },
      solver_false_feasible: 1,
    });
    const s = summarize([c, fakeCase({ case_id: 'case-2' })]);
    expect(s.solver_false_feasibility.plans_checked).toBe(2);
    expect(s.solver_false_feasibility.rejected).toBe(1);
    expect(s.solver_false_feasibility.reproducers).toEqual([
      { scenario_id: 'hand-built-scenario', case_id: 'case-1', kind: 'main', failed_checks: ['budget', 'metrics'] },
    ]);
    expect(formatReliabilityReport({ ...report, scenarios: [], totals: s })).toContain('verifier rejected solver main plan');
  });

  it('does not count a plan the solver did not claim feasible (INFEASIBLE empty main result)', () => {
    const c = fakeCase({
      status: 'INFEASIBLE',
      main: { claimed_feasible: false, empty_plan: true, verifier_passed: false, failed_checks: ['fairness'], coverage: COV, fairness: null, all_floors_met: null },
    });
    expect(summarize([c]).solver_false_feasibility).toMatchObject({ plans_checked: 0, rejected: 0 });
  });

  it('too_large is counted as skipped, never as gap 0', () => {
    const s = summarize([fakeCase({ optimality: { main: { checked: false, reason: 'too_large' }, conditional: { checked: false, reason: 'too_large' } } })]);
    expect(s.optimality_gap).toMatchObject({ cross_checked: 0, skipped_too_large: 2, zero_gap: 0, max_gap: null });
  });

  it('counts status mismatches, nonzero gaps and objective-level mismatches as problems with reproducers', () => {
    const mismatch = fakeCase({
      case_id: 'mismatch',
      optimality: { main: { ...OK_GAP, solver_status: 'INFEASIBLE', gap_N: null, status_agrees: false, objective_levels_1_6_agree: null }, conditional: null },
    });
    const nonzero = fakeCase({ case_id: 'nonzero', optimality: { main: { ...OK_GAP, exhaustive_N: 3, verified_N: 2, gap_N: 1, objective_levels_1_6_agree: false, mismatched_levels: ['N'] }, conditional: null } });
    const tie = fakeCase({ case_id: 'tie', optimality: { main: { ...OK_GAP, objective_levels_1_6_agree: false, mismatched_levels: ['total_cost'] }, conditional: null } });
    const s = summarize([mismatch, nonzero, tie]).optimality_gap;
    expect(s).toMatchObject({ cross_checked: 3, status_mismatches: 1, nonzero_gap: 1, objective_level_mismatches: 1, zero_gap: 0, max_gap: 1 });
    expect(s.reproducers.map((r) => [r.case_id, r.problem])).toEqual([
      ['mismatch', 'status_mismatch'],
      ['nonzero', 'nonzero_gap'],
      ['tie', 'objective_level_mismatch'],
    ]);
  });

  it('a search-limited solve is counted as such (its gap is not an error)', () => {
    const s = summarize([fakeCase({ status: 'SEARCH_LIMIT_REACHED', optimality: { main: { ...OK_GAP, solver_status: 'SEARCH_LIMIT_REACHED', exhaustive_N: 4, verified_N: 2, gap_N: 2 }, conditional: null } })]);
    expect(s.optimality_gap).toMatchObject({ cross_checked: 1, search_limited: 1, nonzero_gap: 0, zero_gap: 0, max_gap: 2 });
  });

  it('both-infeasible solves at a $0 budget are counted separately', () => {
    const infeasibleGap: GapCheck = { ...OK_GAP, exhaustive_feasible: false, exhaustive_N: null, solver_status: 'INFEASIBLE', gap_N: null, objective_levels_1_6_agree: null };
    const s = summarize([
      fakeCase({ case_id: 'zero', budget_usd: 0, optimality: { main: infeasibleGap, conditional: null } }),
      fakeCase({ case_id: 'half', budget_usd: 50, optimality: { main: infeasibleGap, conditional: null } }),
    ]).optimality_gap;
    expect(s).toMatchObject({ both_infeasible: 2, both_infeasible_zero_budget: 1, zero_gap: 0 });
  });
});

describe('robustness', () => {
  it('never throws on malformed input, and a scenario whose cases cannot be built still shows up with one errored case', () => {
    const base = SCENARIOS[0].scenario;
    const bad = measureScenario({ id: 'bad-budget', scenario: { ...base, budget_usd: Number.NaN } });
    expect(bad.cases).toHaveLength(1);
    expect(bad.cases[0].status).toBe('UNSUPPORTED_INPUT');
    expect(bad.cases[0].main).toBeNull();
    expect(bad.cases[0].optimality.main).toEqual({ checked: false, reason: 'not_applicable' });

    const broken = measureScenario({ id: 'broken', scenario: null as unknown as Scenario });
    expect(broken.cases.every((c) => c.status === null || c.status === 'UNSUPPORTED_INPUT')).toBe(true);

    // 底线的 statuses_any_of 不是数组：不抛错，求解器按 UNSUPPORTED_INPUT 处理带底线的用例。
    const badFloor = { ...SCENARIOS[0].suggestedFairnessFloors[0], statuses_any_of: 'low_income' } as unknown as (typeof SCENARIOS)[number]['suggestedFairnessFloors'][number];
    const floorCases = buildCases({ id: 'bad-floor', scenario: base, suggestedFairnessFloors: [badFloor] });
    expect(floorCases.length).toBeGreaterThan(0);
    const withBadFloor = floorCases.find((c) => c.spec.floor_ids.length > 0)!;
    expect(measureCase('bad-floor', withBadFloor, false).status).toBe('UNSUPPORTED_INPUT');

    // 构建用例本身抛错：场景照样出现，带一条出错用例。
    const throwing = { id: 'throwing', scenario: base } as unknown as Parameters<typeof measureScenario>[0];
    Object.defineProperty(throwing, 'suggestedFairnessFloors', {
      get() {
        throw new Error('boom');
      },
    });
    expect(buildCases(throwing)).toEqual([]);
    const m = measureScenario(throwing);
    expect(m.cases).toHaveLength(1);
    expect(m.cases[0].error).toBe('exception during buildCases');
    expect(m.summary.errors).toBe(1);
    expect(formatReliabilityReport(measureAll([]))).not.toContain('NaN');

    expect(measureAll(undefined as unknown as []).scenarios).toEqual([]);
    expect(() => formatReliabilityReport({} as ReliabilityReport)).not.toThrow();
    expect(() => formatReliabilityReport({ ...report, scenarios: [m], totals: m.summary })).not.toThrow();
  });
});
