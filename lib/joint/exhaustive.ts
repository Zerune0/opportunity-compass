/**
 * exhaustiveBest(scenario, options?) — 联合求解的朴素穷举参考实现，**只用于测试对照**，不追求速度。
 *
 * 独立性：只凭 CONTRACT.md「联合求解模型」写成，不 import 求解器（./solve）、./index、./scenarios；
 * 每个候选完整方案都交给本目录自己的 verifyPlan（./verify.ts，经带缓存的 verifyAndMeasure）判断是否满足
 * 全部硬约束与软要求，并取它重算的指标。
 *
 * 做法：
 * 1. 枚举措施的所有子集（2^|I|）作为选中集合。
 * 2. 对每个选中集合，枚举每个（学生, 机会）对「不分配 / 分配选中措施的某个子集」的组合；
 *    分配的 cost_usd 按契约口径记账：每个 (措施, 学生) 组按 (i, s, o) 升序的第一条记 unit_cost_usd、其余 0；
 *    existing_grants 中已有同 (措施, 学生) 的 **approved** grant 的组全记 0（pending 的只占容量、不免成本）。
 * 3. 只保留 verifyPlan 全部通过的方案，按契约第 5 条目标选最优：N 最大 → total_usd 最小 → 分配条数最少
 *    → 选中措施数最少。并列方案只比较这些指标，返回指标，不比较具体是谁（返回的 plan 只是其中一个，供排查）。
 *
 * 另导出 naiveBest：**真正朴素**的枚举（不做下面 (b)(c) 的剪枝），枚举每个 (措施, 学生, 机会) 是否分配，
 * 按第 5 条完整目标（含字典序）选出唯一的最优方案，用来与求解器逐字段比较完整方案。只适用于极小场景。
 *
 * 安全剪枝（不改变最优指标）：
 * (a) 对的独立性：合成 grant 的 opportunity_id 总是具体机会，analyzeReachability 只看 student_id / opportunity_id
 *     匹配的 grant，所以对 (s, o) 是否可达只取决于 existing grants 与「分配到 (s, o) 上的措施多重集」。
 * (b) 只给「最终新增可达」的对分配：设 P 可行，P' = P 去掉所有落在「不属于 R1 \ R0」的对上的分配。
 *     由 (a)，其他对的可达性不变；被去掉分配的对若原属 R0，则只带 existing grant 仍可达（L 不增反可能减），
 *     若不属 R0，则去掉前后都不属于 R1 \ R0（G 不变）。选中集合不变 → approval / 互斥 / 依赖 / 软要求
 *     中的 required 不变；分配是子集 → 合法性、容量（不同学生数只减不增）不变坏；成本 = 固定 + 每个不同 (i, s)
 *     一次单价，组只减不增 → 成本不增、预算仍满足；G 不变 → min_gain 仍满足；L' ≤ L → coverage_loss 仍满足。
 *     于是 N' ≥ N，且 N' = N 时 cost' ≤ cost、条数' ≤ 条数、选中措施数不变：P' 按第 5 条不劣于 P。故最优指标可在
 *     「每个有分配的对都属于 R1 \ R0」的方案中取到；R0 中的对一律不分配。
 * (c) 只用「极小」可达集合：若分配到对 p 的措施集合 A 使 p 可达，而其真子集 A' 也使 p 可达，
 *     把 A 换成 A' 后 p 仍属 R1 \ R0、其他对不受影响 (a)，分配、容量、成本组都只减不增 → 不劣。
 *     任一可达集合都含一个极小可达集合，所以每个对只需考虑「不分配」或某个极小可达集合（同一措施在同一对上
 *     重复分配违反 allocation_validity，因此只考虑集合而非多重集）。不在措施 opportunity_ids 内的组合违反
 *     allocation_validity，同样不必枚举。
 * (d) 只依赖选中集合的检查（approval / mutual_exclusion / prerequisite）以及「固定成本已超预算」（单价非负，
 *     加分配只会让成本更高），在空分配方案上就不通过时，该选中集合下所有方案都不通过，直接跳过。
 *     input_validity 不依赖方案：空方案上不通过则整个场景无可行方案。
 *
 * 适用上限：≤ 8 名学生、≤ 4 项措施、单机会（或学生 × 机会 ≤ 8 对、每对极小可达集合很少）时可在秒级完成；
 * 复杂度约为 2^|I| × Π_对 (1 + 极小可达集合数)。超出这个规模不要用。
 *
 * 纯函数：确定性、无随机、无 IO、不读系统时钟、不修改输入。
 */
import type { Allocation, JointPlan, Scenario, VerifyOptions } from '../types';
import { createJointEvaluator, EPS, verifyAndMeasure } from './verify';

export interface ExhaustiveResult {
  feasible: boolean;
  N: number;
  G: number;
  L: number;
  total_usd: number;
  allocationCount: number;
  /** 选中措施数（第 5 条的第 4 步）。 */
  selectedCount: number;
  /** 取到最优指标的一个方案（仅供排查；并列方案之间不比较具体是谁）。不可行时为 null。 */
  plan: JointPlan | null;
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function cmpAlloc(a: Allocation, b: Allocation): number {
  return (
    cmpStr(a.intervention_id, b.intervention_id) ||
    cmpStr(a.student_id, b.student_id) ||
    cmpStr(a.opportunity_id, b.opportunity_id)
  );
}

/** 按 (i, s, o) 升序排序，并按契约口径记 cost_usd。 */
function costed(
  raw: { intervention_id: string; student_id: string; opportunity_id: string }[],
  unitCost: (i: string) => number,
  coveredByExisting: (i: string, s: string) => boolean,
): Allocation[] {
  const sorted = raw.map((a) => ({ ...a, cost_usd: 0 })).sort(cmpAlloc);
  const charged = new Set<string>();
  for (const a of sorted) {
    const k = JSON.stringify([a.intervention_id, a.student_id]);
    if (charged.has(k)) continue;
    charged.add(k);
    a.cost_usd = coveredByExisting(a.intervention_id, a.student_id) ? 0 : unitCost(a.intervention_id);
  }
  return sorted;
}

/** 所有非空子集，按大小升序（同大小按下标字典序）。 */
function subsetsBySize<T>(items: T[]): T[][] {
  const out: T[][] = [];
  const n = items.length;
  for (let mask = 1; mask < 1 << n; mask++) {
    const s: T[] = [];
    for (let k = 0; k < n; k++) if (mask & (1 << k)) s.push(items[k]);
    out.push(s);
  }
  return out.sort((a, b) => a.length - b.length);
}

const SELECTION_ONLY_CHECKS = ['approval', 'mutual_exclusion', 'prerequisite', 'budget'];

export function exhaustiveBest(scenario: Scenario, options: VerifyOptions = {}): ExhaustiveResult {
  const infeasible: ExhaustiveResult = {
    feasible: false,
    N: 0,
    G: 0,
    L: 0,
    total_usd: 0,
    allocationCount: 0,
    selectedCount: 0,
    plan: null,
  };
  const ev = createJointEvaluator(scenario);
  const norm = ev.norm;

  // (d) input_validity 与方案无关。
  const emptyCheck = verifyAndMeasure(ev, { selected_intervention_ids: [], allocations: [] }, options);
  if (!emptyCheck.result.checks.find((c) => c.name === 'input_validity')?.passed) return infeasible;

  const ints = [...norm.intById.values()].sort((a, b) => cmpStr(a.id, b.id));
  if (ints.length > 16) throw new Error('exhaustiveBest：措施过多，超出穷举适用范围');
  const studentIds = [...norm.studentById.keys()];
  const oppIds = [...norm.oppById.keys()];
  const unitCost = (id: string) => norm.intById.get(id)?.unit_cost_usd ?? 0;
  const coveredByExisting = (i: string, s: string) =>
    norm.existing.some((g) => g.intervention_id === i && g.student_id === s && g.status === 'approved');

  const pairs: { s: string; o: string }[] = [];
  for (const s of studentIds) {
    for (const o of oppIds) {
      // (b) R0 中的对一律不分配。
      if (ev.evaluate(s, o, [])?.reachable === true) continue;
      pairs.push({ s, o });
    }
  }

  let best: ExhaustiveResult = infeasible;
  const better = (N: number, total: number, count: number, selectedCount: number): boolean => {
    if (!best.feasible) return true;
    if (N !== best.N) return N > best.N;
    if (Math.abs(total - best.total_usd) > EPS) return total < best.total_usd;
    if (count !== best.allocationCount) return count < best.allocationCount;
    return selectedCount < best.selectedCount;
  };

  for (let mask = 0; mask < 1 << ints.length; mask++) {
    const selected = ints.filter((_, k) => mask & (1 << k)).map((i) => i.id);

    // (d) 只依赖选中集合的检查。
    const base = verifyAndMeasure(ev, { selected_intervention_ids: selected, allocations: [] }, options);
    if (base.result.checks.some((c) => SELECTION_ONLY_CHECKS.includes(c.name) && !c.passed)) continue;

    // (b)(c) 每个对的候选：不分配，或某个极小可达集合（限于适用该机会的选中措施）。
    const choices: string[][][] = [];
    for (const { s, o } of pairs) {
      const applicable = selected.filter((id) => {
        const ids = norm.intById.get(id)?.opportunity_ids;
        return !Array.isArray(ids) || ids.includes(o);
      });
      const minimal: string[][] = [];
      for (const sub of subsetsBySize(applicable)) {
        if (minimal.some((m) => m.every((x) => sub.includes(x)))) continue; // 含更小的可达集合 → 非极小
        if (ev.evaluate(s, o, sub)?.reachable === true) minimal.push(sub);
      }
      choices.push([[], ...minimal]);
    }

    // 笛卡尔积枚举。
    const idx = new Array(pairs.length).fill(0);
    for (;;) {
      const raw: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
      for (let k = 0; k < pairs.length; k++) {
        for (const id of choices[k][idx[k]]) {
          raw.push({ intervention_id: id, student_id: pairs[k].s, opportunity_id: pairs[k].o });
        }
      }
      const plan: JointPlan = { selected_intervention_ids: selected, allocations: costed(raw, unitCost, coveredByExisting) };
      const { result, metrics } = verifyAndMeasure(ev, plan, options);
      if (result.passed && better(metrics.N, metrics.total_usd, plan.allocations.length, selected.length)) {
        best = {
          feasible: true,
          N: metrics.N,
          G: metrics.G,
          L: metrics.L,
          total_usd: metrics.total_usd,
          allocationCount: plan.allocations.length,
          selectedCount: selected.length,
          plan,
        };
      }
      // 进位
      let k = 0;
      while (k < pairs.length) {
        idx[k]++;
        if (idx[k] < choices[k].length) break;
        idx[k] = 0;
        k++;
      }
      if (k === pairs.length) break;
    }
  }
  return best;
}

// ───────────────────────────── 朴素枚举（完整方案对照） ─────────────────────────────

/** naiveBest 的适用上限（学生数、机会数、措施数，以及「措施 × 学生 × 机会」三元组总数）。 */
export const NAIVE_LIMITS = { students: 3, opportunities: 2, interventions: 3, triples: 12 } as const;

export interface NaiveResult {
  feasible: boolean;
  /** 按第 5 条完整目标（含字典序）唯一确定的最优方案；不可行时为 null。cost_usd 已按契约口径记账。 */
  plan: JointPlan | null;
  N: number;
  G: number;
  L: number;
  fixed_usd: number;
  marginal_usd: number;
  total_usd: number;
  /** 实际复核过的候选方案数（供测试确认确实在枚举）。 */
  evaluated: number;
}

function cmpStrArrays(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const c = cmpStr(a[k], b[k]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

/** 第 5 条完整目标：负数 = a 更优。selected 与 allocations 都已排序。 */
function cmpFull(
  a: { N: number; total: number; plan: JointPlan },
  b: { N: number; total: number; plan: JointPlan },
): number {
  if (a.N !== b.N) return b.N - a.N;
  if (Math.abs(a.total - b.total) > EPS) return a.total - b.total;
  const la = a.plan.allocations.length;
  const lb = b.plan.allocations.length;
  if (la !== lb) return la - lb;
  const sa = a.plan.selected_intervention_ids;
  const sb = b.plan.selected_intervention_ids;
  if (sa.length !== sb.length) return sa.length - sb.length;
  const c = cmpStrArrays(sa, sb);
  if (c !== 0) return c;
  for (let k = 0; k < la; k++) {
    const d = cmpAlloc(a.plan.allocations[k], b.plan.allocations[k]);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 真正朴素的枚举：对措施的每个子集 T（升序），枚举 T × 学生 × 机会 的每个子集作为分配（不按可达性剪枝，
 * 也不跳过 R0 中的对），交给 verifyPlan 判断，按第 5 条完整目标取最优。
 * 唯一的跳过：approval / mutual_exclusion / prerequisite 只取决于选中集合，在空分配上不通过时整个 T 跳过
 * （这些检查与分配无关，跳过不改变结果）。超出 NAIVE_LIMITS 时抛错。
 */
export function naiveBest(scenario: Scenario, options: VerifyOptions = {}): NaiveResult {
  const none: NaiveResult = {
    feasible: false,
    plan: null,
    N: 0,
    G: 0,
    L: 0,
    fixed_usd: 0,
    marginal_usd: 0,
    total_usd: 0,
    evaluated: 0,
  };
  const ev = createJointEvaluator(scenario);
  const norm = ev.norm;
  const ints = [...norm.intById.values()].sort((a, b) => cmpStr(a.id, b.id));
  const students = [...norm.studentById.keys()].sort(cmpStr);
  const opps = [...norm.oppById.keys()].sort(cmpStr);
  if (
    students.length > NAIVE_LIMITS.students ||
    opps.length > NAIVE_LIMITS.opportunities ||
    ints.length > NAIVE_LIMITS.interventions ||
    ints.length * students.length * opps.length > NAIVE_LIMITS.triples
  ) {
    throw new Error('naiveBest：场景超出朴素枚举的适用范围');
  }
  const unitCost = (id: string) => norm.intById.get(id)?.unit_cost_usd ?? 0;
  const coveredByExisting = (i: string, s: string) =>
    norm.existing.some((g) => g.intervention_id === i && g.student_id === s && g.status === 'approved');

  let best: { N: number; total: number; plan: JointPlan; metrics: NaiveResult } | null = null;
  let evaluated = 0;
  for (let mask = 0; mask < 1 << ints.length; mask++) {
    const selected = ints.filter((_, k) => mask & (1 << k)).map((i) => i.id);
    const base = verifyAndMeasure(ev, { selected_intervention_ids: selected, allocations: [] }, options);
    if (base.result.checks.some((c) => ['approval', 'mutual_exclusion', 'prerequisite'].includes(c.name) && !c.passed)) continue;
    const triples: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
    for (const i of selected) for (const s of students) for (const o of opps) triples.push({ intervention_id: i, student_id: s, opportunity_id: o });
    for (let bits = 0; bits < 1 << triples.length; bits++) {
      const raw = triples.filter((_, k) => bits & (1 << k));
      const plan: JointPlan = { selected_intervention_ids: selected, allocations: costed(raw, unitCost, coveredByExisting) };
      evaluated++;
      const { result, metrics } = verifyAndMeasure(ev, plan, options);
      if (!result.passed) continue;
      const cand = { N: metrics.N, total: metrics.total_usd, plan };
      if (!best || cmpFull(cand, best) < 0) {
        best = {
          ...cand,
          metrics: {
            feasible: true,
            plan,
            N: metrics.N,
            G: metrics.G,
            L: metrics.L,
            fixed_usd: metrics.fixed_usd,
            marginal_usd: metrics.marginal_usd,
            total_usd: metrics.total_usd,
            evaluated: 0,
          },
        };
      }
    }
  }
  return best ? { ...best.metrics, evaluated } : { ...none, evaluated };
}
