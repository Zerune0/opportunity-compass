/**
 * compareBaselines(scenario, options?) — 基线对比（CONTRACT.md「联合求解模型」第 10 条，逐条实现）。
 *
 * 四行，固定顺序：
 * - A `A_eligibility_only`「基础资格筛选」：只调用 checkEligibility，方案为空方案。
 * - B `B_student_side`「学生端约束规划器」：每个（学生, 机会）对单独找最小的措施子集，不协调名额 / 预算 / 互斥；
 *   原方案不可执行时按（学生编号, 机会编号）升序先到先得截断。
 * - C `C_organizer_side`「机构端干预规划器」：按措施 id 升序、按障碍类型贪心分配名额与预算，
 *   不计算学生是否因此完整可达；原方案不可执行时同样先到先得截断。
 * - joint `joint`「联合求解」：solveJoint 的主方案（INFEASIBLE 时为空主方案）。
 *
 * 每一行都用同一个验证器（./verify 的 verifyAndMeasure，与 verifyPlan 同一实现）、同一份复核选项重新复核；
 * `verified` / `repaired` 的数字一律取验证器的独立重算，不用方案自带或基线自己算的数字。
 * 「可执行」= 复核中除 organizer_requirements、fairness 以外的检查全部通过。
 * 基线的顺序规则（按编号升序、先到先得）是确定性的简化，不代表任何真实系统，也不代表谁更需要。
 * 说明书中的基线 D（充分协调的分离式规划器）未实现。
 *
 * 依赖方向：本文件 import ./solve（joint 行）与 ./verify；./verify、./exhaustive 不得 import 本文件。
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入。所有结果都是模拟，可达 ≠ 录取。
 */
import { SUPPORT_RESOLVES } from '../types';
import type {
  Allocation,
  BaselineComparison,
  BaselineMetrics,
  BaselineRow,
  BarrierType,
  Intervention,
  JointPlan,
  ResourceGrant,
  Scenario,
  SolveOptions,
  VerifyOptions,
  VerifyResult,
} from '../types';
import { solveJoint } from './solve';
import { plural } from '../format';
import { createJointEvaluator, verifyAndMeasure } from './verify';
import type { JointEvaluator, RecomputedMetrics } from './verify';

const EPS = 1e-6;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pairKey = (s: string, o: string) => JSON.stringify([s, o]);

/** 软要求检查（不属于「可执行性检查」）。 */
const SOFT_CHECKS = new Set(['organizer_requirements', 'fairness']);

export const BASELINE_LABELS = {
  A_eligibility_only: 'Eligibility filter only',
  B_student_side: 'Student-side planner',
  C_organizer_side: 'Organizer-side planner',
  joint: 'Joint solver',
} as const;

export const BASELINE_DESCRIPTIONS = {
  A_eligibility_only:
    'Only checks official eligibility. It plans no actions and allocates no shared resources, so it treats "eligible" as "able to attend" and counts students who lack a device, transport or other real-world conditions.',
  B_student_side:
    'Plans support measures for each student separately and can find a combination that works for that student, but assumes every resource belongs to that student alone and does not coordinate capacity, budget or mutual exclusions. By rule it never revokes an existing resource (in any mode), so part of its gap to the joint solver in trade-off mode comes from this.',
  C_organizer_side:
    'Allocates measure capacity and budget by barrier type and respects capacity and budget, but does not jointly check eligibility, preparation routes or other conditions. Removing one barrier does not mean the student can attend. By rule it never revokes an existing resource (in any mode), so part of its gap to the joint solver in trade-off mode comes from this.',
  joint:
    'Considers student eligibility and real-world barriers together with the organizer\'s capacity, budget, mutual exclusions, prerequisites and loss cap, and finds the plan with the largest net change in coverage under those constraints.',
} as const;

export const BASELINE_NOTES = {
  same_inputs: 'All rows use the same scenario, budget, capacity, rules and verifier.',
  d_missing: 'Baseline D from the spec (a fully coordinated separate planner) is not implemented.',
  simulation: 'All results are simulated from sample data. They do not represent real-world impact. Reachable does not mean admitted.',
  ordering: 'The baselines\' ordering rule (ascending id, first come first served) is a deterministic simplification. It does not represent any real system or who needs help more.',
  search_limit: 'The joint solver hit its search limit; optimality is not proven.',
  infeasible: 'The joint solver found no solution under the current requirements. The table shows an empty plan; see the solver result for relaxed alternatives.',
  unsupported: 'Invalid input or internal verification failed; no baseline comparison was run.',
} as const;

type Pair = { s: string; o: string };

function isGiven(v: unknown): boolean {
  return v !== undefined && v !== null;
}

/** 复核选项（契约第 0 条）：与求解相同的 mode / loss_cap / 软要求，不传 assume_approved。 */
function verifyOptionsOf(opts: SolveOptions): VerifyOptions {
  const vo: VerifyOptions = {};
  if (opts.mode !== undefined) vo.mode = opts.mode;
  if (opts.loss_cap !== undefined) vo.loss_cap = opts.loss_cap;
  if (opts.required_intervention_ids !== undefined) vo.required_intervention_ids = opts.required_intervention_ids;
  if (opts.min_gain !== undefined) vo.min_gain = opts.min_gain;
  if (opts.fairness_floors !== undefined) vo.fairness_floors = opts.fairness_floors;
  return vo;
}

function excl(a: Intervention | undefined, bId: string, b: Intervention | undefined): boolean {
  if (a && (a.mutually_exclusive_with ?? []).includes(bId)) return true;
  if (a && b && (b.mutually_exclusive_with ?? []).includes(a.id)) return true;
  return false;
}

const cmpAlloc = (a: Allocation, b: Allocation) =>
  cmpStr(a.intervention_id, b.intervention_id) || cmpStr(a.student_id, b.student_id) || cmpStr(a.opportunity_id, b.opportunity_id);

/**
 * fill_costs：按第 3 条第 6 款给 cost_usd（B、C 都不撤回，E' = E）。
 * (i, s) 组：E 中有 approved 的 (i, s) grant → 全组 0；否则按稳定排序的第一条记 unit_cost_usd，其余 0。
 */
function fillCosts(
  raw: { intervention_id: string; student_id: string; opportunity_id: string }[],
  ivById: Map<string, Intervention>,
  existing: readonly ResourceGrant[],
): Allocation[] {
  const sorted = raw.map((a) => ({ ...a, cost_usd: 0 })).sort(cmpAlloc);
  const seen = new Set<string>();
  for (const a of sorted) {
    const key = JSON.stringify([a.intervention_id, a.student_id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const waived = existing.some(
      (g) => g.intervention_id === a.intervention_id && g.student_id === a.student_id && g.status === 'approved',
    );
    a.cost_usd = waived ? 0 : ivById.get(a.intervention_id)?.unit_cost_usd ?? 0;
  }
  return sorted;
}

/** 按 requires 取传递闭包（只取场景内存在的 id），升序。 */
function withRequiresClosure(ids: Iterable<string>, ivById: Map<string, Intervention>): string[] {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (out.has(id) || !ivById.has(id)) continue;
    out.add(id);
    for (const r of ivById.get(id)?.requires ?? []) if (!out.has(r)) stack.push(r);
  }
  return [...out].sort(cmpStr);
}

/** 大小 1…n 的组合，同一大小内按（已排序 id 数组的）字典序。items 必须已升序。 */
function* combinationsBySize(items: readonly string[]): Generator<string[]> {
  const n = items.length;
  for (let k = 1; k <= n; k++) {
    const idx = Array.from({ length: k }, (_, j) => j);
    while (true) {
      yield idx.map((j) => items[j]);
      let j = k - 1;
      while (j >= 0 && idx[j] === n - k + j) j--;
      if (j < 0) break;
      idx[j]++;
      for (let m = j + 1; m < k; m++) idx[m] = idx[m - 1] + 1;
    }
  }
}

interface Ctx {
  scenario: Scenario;
  evaluator: JointEvaluator;
  vo: VerifyOptions;
  softGiven: boolean;
}

interface Measured {
  verification: VerifyResult;
  metrics: RecomputedMetrics;
  executable: boolean;
}

function measure(ctx: Ctx, plan: JointPlan): Measured {
  const { result, metrics } = verifyAndMeasure(ctx.evaluator, plan, ctx.vo);
  const executable = result.checks.filter((c) => !SOFT_CHECKS.has(c.name)).every((c) => c.passed);
  return { verification: result, metrics, executable };
}

function metricsOf(m: RecomputedMetrics): BaselineMetrics {
  return { R1_count: m.R1.length, G: m.G, L: m.L, N: m.N, total_usd: m.total_usd };
}

function rowOf(
  ctx: Ctx,
  id: BaselineRow['id'],
  claimed: number,
  plan: JointPlan,
  repair: ((m: Measured) => BaselineRow['repaired']) | null,
): BaselineRow {
  const m = measure(ctx, plan);
  const soft = ctx.softGiven
    ? m.verification.checks.filter((c) => SOFT_CHECKS.has(c.name)).every((c) => c.passed)
    : null;
  return {
    id,
    label: BASELINE_LABELS[id],
    description: BASELINE_DESCRIPTIONS[id],
    claimed_reachable: claimed,
    plan,
    verification: m.verification,
    verified: m.executable ? metricsOf(m.metrics) : null,
    soft_requirements_met: soft,
    repaired: m.executable || repair === null ? null : repair(m),
  };
}

function truncationNote(kept: number, skipped: number): string {
  return `Truncated first come first served by ascending (student id, opportunity id): kept ${plural(kept, 'pair')}, skipped ${plural(skipped, 'pair')}. This is a deterministic rule in the simulation and does not represent who needs help more.`;
}

/** 先到先得截断：按 units 顺序逐个加入，加入后不可执行则跳过。 */
function firstComeTruncate(ctx: Ctx, units: readonly Pair[], build: (acc: Pair[]) => JointPlan): BaselineRow['repaired'] {
  const acc: Pair[] = [];
  let last: Measured | null = null;
  for (const p of units) {
    const m = measure(ctx, build([...acc, p]));
    if (m.executable) {
      acc.push(p);
      last = m;
    }
  }
  const final = last ?? measure(ctx, build([]));
  return { ...metricsOf(final.metrics), note: truncationNote(acc.length, units.length - acc.length) };
}

export function compareBaselines(scenario: Scenario, options?: SolveOptions): BaselineComparison {
  const opts: SolveOptions = options ?? {};
  const J = solveJoint(scenario, opts);
  if (J.status === 'UNSUPPORTED_INPUT') {
    return { rows: [], notes: [BASELINE_NOTES.unsupported, ...J.notes] };
  }

  const vo = verifyOptionsOf(opts);
  const evaluator = createJointEvaluator(scenario);
  const ctx: Ctx = {
    scenario,
    evaluator,
    vo,
    softGiven: isGiven(vo.required_intervention_ids) || isGiven(vo.min_gain) || isGiven(vo.fairness_floors),
  };

  const students = [...scenario.students].sort((a, b) => cmpStr(a.id, b.id));
  const opps = [...scenario.opportunities].sort((a, b) => cmpStr(a.id, b.id));
  const pairs: Pair[] = [];
  for (const s of students) for (const o of opps) pairs.push({ s: s.id, o: o.id });

  const ivById = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const AP = scenario.interventions.filter((iv) => iv.status !== 'pending').sort((a, b) => cmpStr(a.id, b.id));
  const E = scenario.existing_grants ?? [];
  const applicable = (iv: Intervention, o: string) => iv.opportunity_ids == null || iv.opportunity_ids.includes(o);
  const reach = (p: Pair, ivIds: readonly string[]) => evaluator.evaluate(p.s, p.o, ivIds)?.reachable === true;

  const R0 = new Set(pairs.filter((p) => reach(p, [])).map((p) => pairKey(p.s, p.o)));
  const emptyPlan = (): JointPlan => ({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });

  // ── A：只看资格 ──
  const aClaimed = pairs.filter((p) => evaluator.eligibility(p.s, p.o) === 'eligible').length;
  const rowA = rowOf(ctx, 'A_eligibility_only', aClaimed, emptyPlan(), null);

  // ── B：学生端，每个对单独找最小措施子集 ──
  const T = new Map<string, string[]>();
  const PB: Pair[] = [];
  for (const p of pairs) {
    if (R0.has(pairKey(p.s, p.o))) continue;
    const cands = AP.filter((iv) => applicable(iv, p.o)).map((iv) => iv.id);
    for (const subset of combinationsBySize(cands)) {
      if (reach(p, subset)) {
        T.set(pairKey(p.s, p.o), subset);
        PB.push(p);
        break;
      }
    }
  }
  const buildB = (Q: readonly Pair[]): JointPlan => {
    const raw: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
    for (const p of Q) for (const i of T.get(pairKey(p.s, p.o)) ?? []) raw.push({ intervention_id: i, student_id: p.s, opportunity_id: p.o });
    const allocations = fillCosts(raw, ivById, E);
    return {
      selected_intervention_ids: withRequiresClosure(new Set(allocations.map((a) => a.intervention_id)), ivById),
      allocations,
      revoked_grant_ids: [],
    };
  };
  const rowB = rowOf(ctx, 'B_student_side', R0.size + PB.length, buildB(PB), () => firstComeTruncate(ctx, PB, buildB));

  // ── C：机构端，按障碍类型贪心 ──
  const U = new Map<string, Set<BarrierType>>();
  for (const p of pairs) {
    const rr = evaluator.evaluate(p.s, p.o, []);
    U.set(pairKey(p.s, p.o), new Set((rr?.barriers ?? []).filter((b) => b.resolved === false).map((b) => b.type)));
  }
  const believed = new Map<string, Set<BarrierType>>();
  const slotOf = (oid: string | null | undefined): string => {
    const slots = scenario.opportunity_time_slots;
    if (slots && oid != null && Object.prototype.hasOwnProperty.call(slots, oid)) return 'L:' + slots[oid];
    return 'D';
  };
  const withExisting = new Set(E.map((g) => g.intervention_id).filter((x): x is string => typeof x === 'string'));
  let remaining = scenario.budget_usd;
  const sel: string[] = [];
  const cAlloc: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
  for (const iv of AP) {
    if ((iv.requires ?? []).some((r) => !sel.includes(r))) continue;
    if (sel.some((k) => excl(iv, k, ivById.get(k)))) continue;
    if ([...withExisting].some((k) => excl(iv, k, ivById.get(k)))) continue;
    const fixed = iv.fixed_cost_usd ?? 0;
    if (fixed > remaining + EPS) continue;
    let r = remaining - fixed;
    const t = SUPPORT_RESOLVES[iv.type];
    const trial: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
    const trialBelieved: string[] = [];
    const ei = E.filter((g) => g.intervention_id === iv.id);
    for (const p of pairs) {
      const key = pairKey(p.s, p.o);
      if (!applicable(iv, p.o)) continue;
      if (!U.get(key)?.has(t)) continue;
      if (believed.get(key)?.has(t)) continue;
      // 容量
      const perSlot = iv.capacity_scope === 'per_time_slot';
      const slot = slotOf(p.o);
      const occupied = new Set<string>();
      for (const g of ei) {
        if (!perSlot || g.opportunity_id === null || slotOf(g.opportunity_id) === slot) occupied.add(String(g.student_id));
      }
      for (const a of trial) if (!perSlot || slotOf(a.opportunity_id) === slot) occupied.add(a.student_id);
      if (!occupied.has(p.s) && iv.capacity != null && occupied.size + 1 > iv.capacity + EPS) continue;
      // 成本
      const already =
        trial.some((a) => a.student_id === p.s) ||
        E.some((g) => g.intervention_id === iv.id && g.student_id === p.s && g.status === 'approved');
      const cost = already ? 0 : iv.unit_cost_usd;
      if (cost > r + EPS) continue;
      trial.push({ intervention_id: iv.id, student_id: p.s, opportunity_id: p.o });
      r -= cost;
      trialBelieved.push(key);
    }
    if (trial.length > 0) {
      sel.push(iv.id);
      remaining = r;
      cAlloc.push(...trial);
      for (const key of trialBelieved) {
        const set = believed.get(key) ?? new Set<BarrierType>();
        set.add(t);
        believed.set(key, set);
      }
    }
  }
  const cSel = [...sel].sort(cmpStr);
  const cPairs: Pair[] = pairs.filter((p) => cAlloc.some((a) => a.student_id === p.s && a.opportunity_id === p.o));
  const buildC = (Q: readonly Pair[]): JointPlan => {
    const keys = new Set(Q.map((p) => pairKey(p.s, p.o)));
    return {
      selected_intervention_ids: [...cSel],
      allocations: fillCosts(
        cAlloc.filter((a) => keys.has(pairKey(a.student_id, a.opportunity_id))),
        ivById,
        E,
      ),
      revoked_grant_ids: [],
    };
  };
  const rowC = rowOf(ctx, 'C_organizer_side', R0.size + cPairs.length, buildC(cPairs), () =>
    firstComeTruncate(ctx, cPairs, buildC),
  );

  // ── joint ──
  const jointPlan: JointPlan = {
    selected_intervention_ids: [...J.selected_intervention_ids],
    allocations: J.allocations.map((a) => ({ ...a })),
    revoked_grant_ids: [...(J.revoked_grant_ids ?? [])],
  };
  const rowJ = rowOf(ctx, 'joint', J.R1.length, jointPlan, null);

  const notes: string[] = [BASELINE_NOTES.same_inputs, BASELINE_NOTES.d_missing, BASELINE_NOTES.simulation, BASELINE_NOTES.ordering];
  if (J.status === 'SEARCH_LIMIT_REACHED') notes.push(BASELINE_NOTES.search_limit);
  if (J.status === 'INFEASIBLE') notes.push(BASELINE_NOTES.infeasible);
  return { rows: [rowA, rowB, rowC, rowJ], notes };
}
