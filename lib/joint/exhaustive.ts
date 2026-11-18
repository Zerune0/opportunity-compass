/**
 * exhaustiveBest(scenario, options?) — 联合求解的穷举参考实现，**只用于测试对照**，不追求速度。
 *
 * 独立性：只凭 CONTRACT.md「联合求解模型」写成，不 import 求解器（./solve）、./index、./scenarios、./baselines、./whatif；
 * 每个候选完整方案都交给本目录自己的 verifyPlan（./verify.ts，经带缓存的 verifyAndMeasure）判断是否满足
 * 全部硬约束与软要求（含 required_intervention_ids、min_gain、fairness_floors），并取它重算的指标。
 *
 * 做法：
 * 1. 枚举措施的所有子集（2^|I|）作为选中集合 T。
 * 2. 枚举「可撤回 grant」（规则 R1：E 中 intervention_id 指向场景内措施、且 student_id 是场景内学生的 grant；
 *    即验证器的 norm.revocable）的所有子集作为撤回集合 X。场景外学生的 grant 不可撤回，不进入枚举；
 *    它们封锁的互斥措施（R1 推论）由验证器的 mutual_exclusion 判定，属于下面 (d) 中只依赖 T 的检查。
 *    protect 模式下验证器对任何非空撤回判不通过（见 (d)），因此实际只有 X = ∅。
 * 3. 对每个 (T, X)，枚举每个（学生, 机会）对「不分配 / 分配 T 中某个措施子集」的组合；
 *    分配的 cost_usd 按契约口径记账：每个 (措施, 学生) 组按 (i, s, o) 升序的第一条记 unit_cost_usd、其余 0；
 *    E' = E \ X 中已有同 (措施, 学生) 的 **approved** grant 的组全记 0（pending 的只占容量、不免成本；被撤回的不再免成本）。
 * 4. 只保留 verifyPlan 全部通过的方案，按契约第 5 条前六级目标选最优：N 最大 → L 最小 → total_usd 最小
 *    → 分配条数最少 → 选中措施数最少 → 撤回数最少。并列方案只比较这些指标，不比较具体是谁
 *    （返回的 plan 只是其中一个，供排查）。
 *
 * 另导出 naiveBest：**真正朴素**的枚举（不做下面 (b)(c) 的剪枝），枚举每个撤回子集与每个 (措施, 学生, 机会) 是否分配，
 * 按第 5 条完整七级目标（含字典序）选出唯一的最优方案，用来与求解器逐字段比较完整方案。只适用于极小场景。
 *
 * 安全剪枝（不改变前六级最优指标；每条都只在「输入合法」时用到——输入不合法时 input_validity 不通过，直接返回不可行）：
 * (a) 对的独立性：合成 grant 的 opportunity_id 总是具体机会，analyzeReachability 只看 student_id / opportunity_id
 *     匹配的 grant，所以对 (s, o) 是否可达只取决于 E' 中对它生效的 grant 与「分配到 (s, o) 上的措施集合」。
 * (b) 只给「方案后可达（∈ R1）」的对分配。设 P 可行，P' = P 去掉所有落在「不属于 R1」的对上的分配（T、X 不变）。
 *     由 (a)，其他对的可达性不变；被去掉分配的对去掉前不可达，去掉后少了 grant，按单调性（合法输入下额度非负，
 *     多一条 approved grant 只会多化解障碍，契约第 2 条）仍不可达。于是 R1、G、L 都不变 → coverage_loss、min_gain、
 *     fairness_floors 不变；T 不变 → approval / 互斥 / 依赖 / required 不变；X 不变、分配变少 → revocation 的 a/b/d 不变、
 *     c 只会更容易满足；分配是子集 → 合法性、容量（不同学生数只减不增）不变坏；成本组只减不增 → 成本不增、预算仍满足。
 *     故 P' 可行，N、L 相同，成本 ≤、条数 ≤、措施数与撤回数相同：P' 按第 5 条不劣于 P。
 *     注意：**有撤回时 R0 中的对可能需要分配才能留在 R1**（例如撤回措施 k 的设备、改由措施 i 补上），
 *     所以旧版「R0 中的对一律不分配」的剪枝已删除；这里只用「不属于 R1 的对不分配」。
 * (c) 只用「极小」可达集合：若分配到对 p 的措施集合 A 使 p 在 E' 下可达，而其真子集 A' 也使 p 可达，
 *     把 A 换成 A' 后 p 仍属 R1、其他对不受影响 (a)，分配、容量、成本组都只减不增，revocation 的 c 只会更容易满足 → 不劣。
 *     任一可达集合都含一个极小可达集合，所以每个对只需考虑「不分配」或某个极小可达集合（极小性按当前 X 下的 E' 计算；
 *     只带 E' 就可达的对，极小集合是空集，只考虑「不分配」）。同一措施在同一对上重复分配违反 allocation_validity，
 *     因此只考虑集合而非多重集；不在措施 opportunity_ids 内的组合违反 allocation_validity，
 *     使用「X 中有 (k, s) 的 grant」的措施 k 给学生 s 分配违反 revocation 的 c——这两类都必然不通过，不必枚举。
 * (d) 只依赖 (T, X) 的检查——approval / mutual_exclusion（含「不得与有不可撤回已有 grant 的措施互斥」，只看 T 与场景）
 *     / prerequisite、budget 中的固定成本部分（单价非负，加分配只会
 *     让成本更高；撤回不退款）、revocation 的 a（撤回列表合法）/ b（强制撤回）/ d（protect 下必须为空）——
 *     在空分配方案 (T, [], X) 上就不通过时，该 (T, X) 下所有方案都不通过，直接跳过。
 *     revocation 的 c 只会因分配不通过，空分配上一定通过，所以空分配上 revocation 不通过只能来自 a/b/d。
 *     input_validity 不依赖方案：空方案上不通过则整个场景无可行方案。
 *
 * 适用上限：≤ 8 名学生、≤ 4 项措施、≤ 2 条可撤回 grant、单机会（或学生 × 机会 ≤ 8 对、每对极小可达集合很少）
 * 时可在秒级完成；复杂度约为 2^|I| × 2^|可撤回| × Π_对 (1 + 极小可达集合数)。超出这个规模不要用。
 *
 * 纯函数：确定性、无随机、无 IO、不读系统时钟、不修改输入。
 */
import type { Allocation, CoveragePair, FairnessReport, GrantRevocation, JointPlan, Scenario, VerifyOptions } from '../types';
import { createJointEvaluator, EPS, verifyAndMeasure, type JointEvaluator } from './verify';

export interface ExhaustiveResult {
  feasible: boolean;
  N: number;
  G: number;
  L: number;
  total_usd: number;
  allocationCount: number;
  /** 选中措施数（第 5 条第 5 步）。 */
  selectedCount: number;
  /** 撤回的 grant 数（第 5 条第 6 步）。 */
  revokedCount: number;
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

/** 按 (i, s, o) 升序排序，并按契约口径记 cost_usd（免成本只认 E' 中 approved 的已有 grant）。 */
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

/** 所有子集（含空集），每个子集按输入顺序。 */
function allSubsets<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) out.push(items.filter((_, k) => mask & (1 << k)));
  return out;
}

/** 在 (T, X) 下不依赖分配的检查（见文件头 (d)）。 */
const SELECTION_ONLY_CHECKS = ['approval', 'mutual_exclusion', 'prerequisite', 'budget', 'revocation'];

/** 可撤回 grant 的 id（规则 R1：措施与学生都在场景内；去重、升序）。 */
function revocableIds(ev: JointEvaluator): string[] {
  return [...new Set(ev.norm.revocable.map((g) => g.id))].sort(cmpStr);
}

/** E' 下的免成本判定。 */
function coveredFn(ev: JointEvaluator, revoked: ReadonlySet<string>) {
  return (i: string, s: string) =>
    ev.norm.existing.some(
      (g) => g.intervention_id === i && g.student_id === s && g.status === 'approved' && !(typeof g.id === 'string' && revoked.has(g.id)),
    );
}

export function exhaustiveBest(scenario: Scenario, options: VerifyOptions = {}): ExhaustiveResult {
  const infeasible: ExhaustiveResult = {
    feasible: false,
    N: 0,
    G: 0,
    L: 0,
    total_usd: 0,
    allocationCount: 0,
    selectedCount: 0,
    revokedCount: 0,
    plan: null,
  };
  const ev = createJointEvaluator(scenario);
  const norm = ev.norm;

  // (d) input_validity 与方案无关。
  const emptyCheck = verifyAndMeasure(ev, { selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] }, options);
  if (!emptyCheck.result.checks.find((c) => c.name === 'input_validity')?.passed) return infeasible;

  const ints = [...norm.intById.values()].sort((a, b) => cmpStr(a.id, b.id));
  if (ints.length > 16) throw new Error('exhaustiveBest：措施过多，超出穷举适用范围');
  const revIds = revocableIds(ev);
  if (revIds.length > 6) throw new Error('exhaustiveBest：可撤回 grant 过多，超出穷举适用范围');
  const studentIds = [...norm.studentById.keys()];
  const oppIds = [...norm.oppById.keys()];
  const unitCost = (id: string) => norm.intById.get(id)?.unit_cost_usd ?? 0;
  const grantById = new Map(norm.revocable.map((g) => [g.id, g] as const));

  let best: ExhaustiveResult = infeasible;
  const better = (N: number, L: number, total: number, count: number, selectedCount: number, revokedCount: number): boolean => {
    if (!best.feasible) return true;
    if (N !== best.N) return N > best.N;
    if (L !== best.L) return L < best.L;
    if (Math.abs(total - best.total_usd) > EPS) return total < best.total_usd;
    if (count !== best.allocationCount) return count < best.allocationCount;
    if (selectedCount !== best.selectedCount) return selectedCount < best.selectedCount;
    return revokedCount < best.revokedCount;
  };

  for (let mask = 0; mask < 1 << ints.length; mask++) {
    const selected = ints.filter((_, k) => mask & (1 << k)).map((i) => i.id);
    for (const revoked of allSubsets(revIds)) {
      const X = new Set(revoked);

      // (d) 只依赖 (T, X) 的检查。
      const base = verifyAndMeasure(ev, { selected_intervention_ids: selected, allocations: [], revoked_grant_ids: revoked }, options);
      if (base.result.checks.some((c) => SELECTION_ONLY_CHECKS.includes(c.name) && !c.passed)) continue;

      // revocation c：X 中有 (k, s) 的 grant 时，k 不得再分配给 s。
      const banned = new Set(revoked.map((id) => JSON.stringify([grantById.get(id)?.intervention_id, grantById.get(id)?.student_id])));

      // (b)(c) 每个对的候选：不分配，或 E' 下的某个极小可达集合（限于适用该机会、未被 c 禁止的选中措施）。
      const pairs: { s: string; o: string }[] = [];
      const choices: string[][][] = [];
      for (const s of studentIds) {
        for (const o of oppIds) {
          pairs.push({ s, o });
          if (ev.evaluate(s, o, [], X)?.reachable === true) {
            choices.push([[]]); // 只带 E' 就可达：极小集合为空集
            continue;
          }
          const applicable = selected.filter((id) => {
            if (banned.has(JSON.stringify([id, s]))) return false;
            const ids = norm.intById.get(id)?.opportunity_ids;
            return !Array.isArray(ids) || ids.includes(o);
          });
          const minimal: string[][] = [];
          for (const sub of subsetsBySize(applicable)) {
            if (minimal.some((m) => m.every((x) => sub.includes(x)))) continue; // 含更小的可达集合 → 非极小
            if (ev.evaluate(s, o, sub, X)?.reachable === true) minimal.push(sub);
          }
          choices.push([[], ...minimal]);
        }
      }

      // 笛卡尔积枚举。
      const covered = coveredFn(ev, X);
      const idx = new Array(pairs.length).fill(0);
      for (;;) {
        const raw: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
        for (let k = 0; k < pairs.length; k++) {
          for (const id of choices[k][idx[k]]) {
            raw.push({ intervention_id: id, student_id: pairs[k].s, opportunity_id: pairs[k].o });
          }
        }
        const plan: JointPlan = {
          selected_intervention_ids: selected,
          allocations: costed(raw, unitCost, covered),
          revoked_grant_ids: revoked,
        };
        const { result, metrics } = verifyAndMeasure(ev, plan, options);
        if (
          result.passed &&
          better(metrics.N, metrics.L, metrics.total_usd, plan.allocations.length, selected.length, revoked.length)
        ) {
          best = {
            feasible: true,
            N: metrics.N,
            G: metrics.G,
            L: metrics.L,
            total_usd: metrics.total_usd,
            allocationCount: plan.allocations.length,
            selectedCount: selected.length,
            revokedCount: revoked.length,
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
  }
  return best;
}

// ───────────────────────────── 朴素枚举（完整方案对照） ─────────────────────────────

/**
 * naiveBest 的适用上限：学生数、机会数、措施数、可撤回 grant 数，
 * 以及「措施 × 学生 × 机会」三元组总数 + 可撤回 grant 数（枚举量约 2^|I| × 2^(三元组 + 可撤回)）。
 */
export const NAIVE_LIMITS = { students: 3, opportunities: 2, interventions: 3, revocable: 2, triples: 12, triplesPlusRevocable: 12 } as const;

export interface NaiveResult {
  feasible: boolean;
  /** 按第 5 条完整七级目标（含字典序）唯一确定的最优方案；不可行时为 null。cost_usd 已按契约口径记账。 */
  plan: JointPlan | null;
  N: number;
  G: number;
  L: number;
  fixed_usd: number;
  marginal_usd: number;
  total_usd: number;
  revokedCount: number;
  /** 验证器对最优方案重算的 lost_pairs / revocations / fairness（不可行时为空 / null）。 */
  lost_pairs: CoveragePair[];
  revocations: GrantRevocation[];
  fairness: FairnessReport[] | null;
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

function cmpAllocArrays(a: readonly Allocation[], b: readonly Allocation[]): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const d = cmpAlloc(a[k], b[k]);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/** 第 5 条完整七级目标：负数 = a 更优。selected、allocations、revoked 都已排序。 */
function cmpFull(
  a: { N: number; L: number; total: number; plan: JointPlan },
  b: { N: number; L: number; total: number; plan: JointPlan },
): number {
  if (a.N !== b.N) return b.N - a.N;
  if (a.L !== b.L) return a.L - b.L;
  if (Math.abs(a.total - b.total) > EPS) return a.total - b.total;
  const la = a.plan.allocations.length;
  const lb = b.plan.allocations.length;
  if (la !== lb) return la - lb;
  const sa = a.plan.selected_intervention_ids;
  const sb = b.plan.selected_intervention_ids;
  if (sa.length !== sb.length) return sa.length - sb.length;
  const ra = a.plan.revoked_grant_ids ?? [];
  const rb = b.plan.revoked_grant_ids ?? [];
  if (ra.length !== rb.length) return ra.length - rb.length;
  return cmpStrArrays(sa, sb) || cmpAllocArrays(a.plan.allocations, b.plan.allocations) || cmpStrArrays(ra, rb);
}

/**
 * 真正朴素的枚举：对措施的每个子集 T（升序）与可撤回 grant 的每个子集 X（升序），枚举 T × 学生 × 机会 的每个子集
 * 作为分配（不按可达性剪枝，也不跳过任何对），交给 verifyPlan 判断，按第 5 条完整七级目标取最优。
 * 唯一的跳过：approval / mutual_exclusion / prerequisite 与 revocation 的 a/b/d 只取决于 (T, X)，
 * 在空分配上不通过时整个 (T, X) 跳过（这些检查与分配无关，跳过不改变结果；revocation 的 c 在空分配上必然通过）。
 * 超出 NAIVE_LIMITS 时抛错。
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
    revokedCount: 0,
    lost_pairs: [],
    revocations: [],
    fairness: null,
    evaluated: 0,
  };
  const ev = createJointEvaluator(scenario);
  const norm = ev.norm;
  const ints = [...norm.intById.values()].sort((a, b) => cmpStr(a.id, b.id));
  const students = [...norm.studentById.keys()].sort(cmpStr);
  const opps = [...norm.oppById.keys()].sort(cmpStr);
  const revIds = revocableIds(ev);
  const triplesTotal = ints.length * students.length * opps.length;
  if (
    students.length > NAIVE_LIMITS.students ||
    opps.length > NAIVE_LIMITS.opportunities ||
    ints.length > NAIVE_LIMITS.interventions ||
    revIds.length > NAIVE_LIMITS.revocable ||
    triplesTotal > NAIVE_LIMITS.triples ||
    triplesTotal + revIds.length > NAIVE_LIMITS.triplesPlusRevocable
  ) {
    throw new Error('naiveBest：场景超出朴素枚举的适用范围');
  }
  const unitCost = (id: string) => norm.intById.get(id)?.unit_cost_usd ?? 0;

  let best: { N: number; L: number; total: number; plan: JointPlan; metrics: NaiveResult } | null = null;
  let evaluated = 0;
  for (let mask = 0; mask < 1 << ints.length; mask++) {
    const selected = ints.filter((_, k) => mask & (1 << k)).map((i) => i.id);
    for (const revoked of allSubsets(revIds)) {
      const base = verifyAndMeasure(ev, { selected_intervention_ids: selected, allocations: [], revoked_grant_ids: revoked }, options);
      if (
        base.result.checks.some(
          (c) => ['approval', 'mutual_exclusion', 'prerequisite', 'revocation'].includes(c.name) && !c.passed,
        )
      ) {
        continue;
      }
      const covered = coveredFn(ev, new Set(revoked));
      const triples: { intervention_id: string; student_id: string; opportunity_id: string }[] = [];
      for (const i of selected) for (const s of students) for (const o of opps) triples.push({ intervention_id: i, student_id: s, opportunity_id: o });
      for (let bits = 0; bits < 1 << triples.length; bits++) {
        const raw = triples.filter((_, k) => bits & (1 << k));
        const plan: JointPlan = {
          selected_intervention_ids: selected,
          allocations: costed(raw, unitCost, covered),
          revoked_grant_ids: revoked,
        };
        evaluated++;
        const { result, metrics } = verifyAndMeasure(ev, plan, options);
        if (!result.passed) continue;
        const cand = { N: metrics.N, L: metrics.L, total: metrics.total_usd, plan };
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
              revokedCount: revoked.length,
              lost_pairs: metrics.lost_pairs,
              revocations: metrics.revocations,
              fairness: metrics.fairness,
              evaluated: 0,
            },
          };
        }
      }
    }
  }
  return best ? { ...best.metrics, evaluated } : { ...none, evaluated };
}
