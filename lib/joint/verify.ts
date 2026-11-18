/**
 * verifyPlan(scenario, plan, options?) — 联合求解方案的独立复核（按 CONTRACT.md「联合求解模型」第 8 条）。
 *
 * 独立性：本文件只凭契约写成，不 import 求解器（./solve）、./index、./scenarios、./baselines、./whatif 的任何代码；
 * 只调用学生端的 analyzeReachability / checkEligibility（它们不是求解器）与日期工具。
 * 不信任 plan 自带的任何指标或可行性标记：R0、R1、G、L、N、成本、lost_pairs、revocations、fairness 全部自己重算。
 *
 * 记号（契约第 0 条）：E = existing_grants；X = 方案撤回的 grant id 中**合法**的部分（字符串、是可撤回 grant 的 id、去重）；
 * E' = E 去掉 id ∈ X 的 grant。「可撤回」= intervention_id 是字符串且是场景内措施 id 的已有 grant。
 * R0 按全部 E 计算；R1、容量、免成本、barrier_resolution 都按 E'（∪ 方案合成的 grant）计算。
 *
 * 检查项（顺序固定；除 organizer_requirements / fairness 外每项都输出；passed = 全部通过）：
 * - input_validity：scenario / options 是否命中第 6 条 UNSUPPORTED_INPUT 的条件（max_search_nodes 除外），
 *   或 assume_approved_intervention_ids 引用了不存在的措施。命中则不通过，其余检查照常给出。
 *   规则与求解器的输入校验相同，但由本文件独立实现（不共用代码）；options 中值为 null 的字段视同未给。
 *   第 3 层新增：existing grant 的 id 不是字符串或重复；fairness_floors 格式不合法。
 * - approval：选中的措施存在、不重复、已批准（pending 只有在 assume_approved 中列出时才算已批准）。
 * - mutual_exclusion：选中集合内没有互斥的两项（mutually_exclusive_with 按对称关系处理）。
 * - prerequisite：每个选中措施的 requires 全部在选中集合里。
 * - revocation（始终输出，第 3 条第 8 款）：
 *   a. revoked_grant_ids 缺省 / null 视为 []；给出时必须是数组，元素是字符串、不重复、是 E 中可撤回 grant 的 id；
 *   b. 强制撤回：可撤回的 g ∈ E，若存在选中的措施 i（i ∈ I）满足 excl(i, g.intervention_id)，则 g.id ∈ X；
 *   c. X 中 grant 的 (intervention_id, student_id) 不得再出现在 allocations 中；
 *   d. protect 模式（mode 缺省 / 'protect' / 其他非 'tradeoff' 取值）下 revoked_grant_ids 必须为空（用户侧决定：
 *      保护模式不动任何已有承诺，强制与自愿撤回都不允许，approved 与 pending 都一样）。
 * - allocation_validity：分配引用的措施已选中且存在、学生 / 机会在场景内、机会在措施的 opportunity_ids 内、无重复 (i, s, o)。
 * - capacity：按 capacity_scope（total / per_time_slot）统计不同学生数（含 E' 中已有 grant 占位）≤ capacity。
 * - cost_accounting：每个 (i, s) 组恰好一条记 unit_cost_usd、其余 0（E' 中 approved 的已有 grant 覆盖的组全为 0；
 *   pending 的已有 grant 只占容量、不免成本；被撤回的 grant 不再免成本）；
 *   cost_usd 必须是有限数；plan 若带 cost 字段，还核对 fixed / marginal / total 的记账口径。
 * - budget：重算的正确总成本 ≤ budget_usd（撤回不退款）。
 * - eligibility / deadline / barrier_resolution：对新增覆盖（重算的 R1 \ R0，并上 plan 自带 R1 中声称新增的对）
 *   做交叉检查：资格 eligible、截止日期为 null 或不早于评估日、所有障碍已化解且至少一条由 'alloc:' 合成 grant 化解
 *   （barrier_resolution 用 E' ∪ 合成 grant）。
 * - coverage_loss：L = |R0 \ R1|；protect（缺省）要求 L = 0；tradeoff 要求给出 loss_cap 且 L ≤ loss_cap。
 * - organizer_requirements：只有 options 传了 required_intervention_ids 或 min_gain 时才输出。
 * - fairness：只有 options 给出 fairness_floors（非 null，含空数组）时才输出；每条底线按重算的 R1 计算。
 * - metrics：始终输出；plan 带 R0 / R1 / G / L / N / cost / lost_pairs / revocations / fairness 任一字段时逐项与重算值比较。
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不修改输入；不读取学校名、显示名。
 * 对任意畸形 plan / scenario / options（空、缺字段、未知 id、负成本、非数字）都不抛异常，只判检查不通过。
 * 所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 *
 * 另导出 createJointEvaluator / verifyPlanWithEvaluator / verifyAndMeasure：带缓存的同一套复核
 * （verifyAndMeasure 额外返回重算的 R0 / R1 / G / L / N / 成本 / lost_pairs / revocations / fairness），
 * 供 ./exhaustive.ts 与基线模块在大量候选方案上复用。缓存只按 (学生, 机会, 该对的合成 grant 措施多重集,
 * 该对受影响的被撤回 grant) 记忆 analyzeReachability 的结果、按 (学生, 机会) 记忆 checkEligibility，不改变任何判定。
 */
import { analyzeReachability } from '../reachability';
import { checkEligibility } from '../eligibility';
import { compareYMD, parseISODate } from '../eligibility/dates';
import { fmt } from '../format';
import { STUDENT_STATUSES } from '../types';
import type {
  Allocation,
  CoveragePair,
  FairnessFloor,
  FairnessReport,
  GrantRevocation,
  Intervention,
  JointPlan,
  Opportunity,
  ReachabilityResult,
  ResourceGrant,
  Scenario,
  StudentProfile,
  VerifyCheck,
  VerifyOptions,
  VerifyResult,
} from '../types';

export const EPS = 1e-6;
/** 公平底线比较的容差（契约第 0 条的唯一例外）。 */
export const FAIRNESS_EPS = 1e-9;

// ───────────────────────────── 小工具 ─────────────────────────────

function arr<T = unknown>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function isStr(x: unknown): x is string {
  return typeof x === 'string';
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isNonNegFinite(x: unknown): x is number {
  return isFiniteNum(x) && x >= 0;
}

function leq(a: number, b: number): boolean {
  return a <= b + EPS;
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPS;
}

/** UTF-16 码元比较（不用 localeCompare）。 */
function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pairKey(s: string, o: string): string {
  return JSON.stringify([s, o]);
}

function groupKey(i: string, s: string): string {
  return JSON.stringify([i, s]);
}

function q(id: unknown): string {
  return `「${String(id)}」`;
}

/** 列表展示：最多列 8 项，其余写「等 n 项」。 */
function list(items: string[]): string {
  if (items.length <= 8) return items.join('；');
  return `${items.slice(0, 8).join('；')}；……等共 ${items.length} 项`;
}

function money(n: number): string {
  return `$${fmt(Math.round(n * 1e6) / 1e6)}`;
}

function pairText(p: CoveragePair): string {
  return `(${p.student_id}, ${p.opportunity_id})`;
}

function sortPairs(pairs: CoveragePair[]): CoveragePair[] {
  return [...pairs].sort(
    (a, b) => cmpStr(a.student_id, b.student_id) || cmpStr(a.opportunity_id, b.opportunity_id),
  );
}

function check(name: string, passed: boolean, detail: string): VerifyCheck {
  return { name, passed, detail };
}

/** 对称互斥：a 的 mutually_exclusive_with 含 b，或 b 的含 a。 */
function excl(a: Intervention | undefined, b: Intervention | undefined): boolean {
  if (!a || !b) return false;
  return arr<unknown>(a.mutually_exclusive_with).includes(b.id) || arr<unknown>(b.mutually_exclusive_with).includes(a.id);
}

// ───────────────────────────── 场景归一化 ─────────────────────────────

export interface JointNorm {
  students: StudentProfile[];
  opps: Opportunity[];
  interventions: Intervention[];
  /** 首次出现的 id → 对象（重复 id 在 input_validity 中报告）。 */
  studentById: Map<string, StudentProfile>;
  oppById: Map<string, Opportunity>;
  intById: Map<string, Intervention>;
  /** E：existing_grants 中的对象条目（非对象条目在 input_validity 中报告）。 */
  existing: ResourceGrant[];
  /** 可撤回的已有 grant（id 是字符串、intervention_id 是场景内措施 id），保持输入顺序。 */
  revocable: ResourceGrant[];
  evaluationDate: string;
  timeSlots: Record<string, unknown>;
}

function normalizeScenario(scenario: Scenario): JointNorm {
  const sc: Record<string, unknown> = isObj(scenario) ? (scenario as unknown as Record<string, unknown>) : {};
  const students = arr<StudentProfile>(sc.students).filter((s) => isObj(s) && isStr(s.id));
  const opps = arr<Opportunity>(sc.opportunities).filter((o) => isObj(o) && isStr(o.id));
  const interventions = arr<Intervention>(sc.interventions).filter((i) => isObj(i) && isStr(i.id));
  const studentById = new Map<string, StudentProfile>();
  for (const s of students) if (!studentById.has(s.id)) studentById.set(s.id, s);
  const oppById = new Map<string, Opportunity>();
  for (const o of opps) if (!oppById.has(o.id)) oppById.set(o.id, o);
  const intById = new Map<string, Intervention>();
  for (const i of interventions) if (!intById.has(i.id)) intById.set(i.id, i);
  const existing = arr<ResourceGrant>(sc.existing_grants).filter((g) => isObj(g));
  const revocable = existing.filter((g) => isStr(g.id) && isStr(g.intervention_id) && intById.has(g.intervention_id));
  const timeSlots = isObj(sc.opportunity_time_slots) ? (sc.opportunity_time_slots as Record<string, unknown>) : {};
  return {
    students,
    opps,
    interventions,
    studentById,
    oppById,
    intById,
    existing,
    revocable,
    evaluationDate: isStr(sc.evaluation_date) ? sc.evaluation_date : '',
    timeSlots,
  };
}

/** 时段：显式标签返回 'L:' + 标签；没列出的机会（含未知 / 缺失 id）属于默认时段 'D'。 */
function slotOf(norm: JointNorm, oppId: unknown): string {
  if (isStr(oppId) && Object.prototype.hasOwnProperty.call(norm.timeSlots, oppId)) {
    const label = norm.timeSlots[oppId];
    if (isStr(label)) return 'L:' + label;
  }
  return 'D';
}

function allSlots(norm: JointNorm): string[] {
  const labels = new Set<string>();
  for (const k of Object.keys(norm.timeSlots)) {
    const v = norm.timeSlots[k];
    if (isStr(v)) labels.add('L:' + v);
  }
  return [...[...labels].sort(cmpStr), 'D'];
}

function slotName(slot: string): string {
  return slot === 'D' ? '默认时段' : `时段「${slot.slice(2)}」`;
}

/**
 * 某措施在某范围内被占用的不同学生集合。grants = 计入占位的已有 grant（input_validity 用全部 E，方案复核用 E'）。
 * scope total：已有 grant（intervention_id 相同，不看 status / 学生是否在场景内）∪ 分配学生。
 * scope per_time_slot：按时段 t 统计；opportunity_id 为 null 的已有 grant 计入每个时段。
 */
function occupancy(
  norm: JointNorm,
  grants: readonly ResourceGrant[],
  intervention: Intervention,
  allocs: { student_id: string; opportunity_id: string }[],
): { slot: string; students: Set<string> }[] {
  const ei = grants.filter((g) => g.intervention_id === intervention.id);
  if (intervention.capacity_scope === 'per_time_slot') {
    return allSlots(norm).map((t) => {
      const set = new Set<string>();
      for (const g of ei) {
        if (g.opportunity_id === null || slotOf(norm, g.opportunity_id) === t) set.add(String(g.student_id));
      }
      for (const a of allocs) if (slotOf(norm, a.opportunity_id) === t) set.add(a.student_id);
      return { slot: t, students: set };
    });
  }
  const set = new Set<string>();
  for (const g of ei) set.add(String(g.student_id));
  for (const a of allocs) set.add(a.student_id);
  return [{ slot: 'total', students: set }];
}

// ───────────────────────────── 可达性评估（带缓存） ─────────────────────────────

/** 按契约第 2 条合成一条 grant。 */
function synthGrant(scenarioTitle: string, i: Intervention, s: string, o: string): ResourceGrant {
  return {
    id: 'alloc:' + i.id + ':' + s + ':' + o,
    student_id: s,
    opportunity_id: o,
    intervention_id: i.id,
    type: i.type,
    amount_usd: i.amount_usd ?? null,
    device: i.device ?? null,
    hours_per_week: i.hours_per_week ?? null,
    status: 'approved',
    provider: scenarioTitle,
    is_sample: true,
  };
}

const NO_REVOKE: ReadonlySet<string> = new Set();

export interface JointEvaluator {
  readonly scenario: Scenario;
  readonly norm: JointNorm;
  /**
   * 对场景内的 (学生, 机会) 对，带「E 去掉 id ∈ revoked 的 grant + 该对上 interventionIds 各合成一条 grant」
   * 调用 analyzeReachability。只有 opportunity_id === o、student_id === s 的合成 grant 会影响该对，
   * 所以只需传该对自己的分配措施。interventionIds 中必须都是场景内存在的措施 id。revoked 缺省 = 不撤回。
   */
  evaluate(
    studentId: string,
    oppId: string,
    interventionIds: readonly string[],
    revoked?: ReadonlySet<string>,
  ): ReachabilityResult | null;
  /** checkEligibility(student, opp, { today: evaluation_date }).overall（带缓存；学生或机会不存在 / 抛错为 null）。 */
  eligibility(studentId: string, oppId: string): string | null;
}

export function createJointEvaluator(scenario: Scenario): JointEvaluator {
  const norm = normalizeScenario(scenario);
  const title = isObj(scenario) && isStr((scenario as Scenario).title) ? (scenario as Scenario).title : '';
  const cache = new Map<string, ReachabilityResult | null>();
  const eligCache = new Map<string, string | null>();
  return {
    scenario,
    norm,
    evaluate(studentId, oppId, interventionIds, revoked = NO_REVOKE) {
      const sortedIds = [...interventionIds].sort(cmpStr);
      // 只有对本对生效的已有 grant（student_id === s 且 opportunity_id 为 null 或 === o）被撤回才影响结果。
      const relevantRevoked: string[] = [];
      if (revoked.size > 0) {
        for (const g of norm.existing) {
          if (
            isStr(g.id) &&
            revoked.has(g.id) &&
            g.student_id === studentId &&
            (g.opportunity_id === null || g.opportunity_id === oppId)
          ) {
            relevantRevoked.push(g.id);
          }
        }
        relevantRevoked.sort(cmpStr);
      }
      const key = JSON.stringify([studentId, oppId, sortedIds, relevantRevoked]);
      if (cache.has(key)) return cache.get(key) ?? null;
      const student = norm.studentById.get(studentId);
      const opp = norm.oppById.get(oppId);
      let result: ReachabilityResult | null = null;
      if (student && opp) {
        const grants: ResourceGrant[] =
          revoked.size > 0 ? norm.existing.filter((g) => !(isStr(g.id) && revoked.has(g.id))) : [...norm.existing];
        for (const id of interventionIds) {
          const i = norm.intById.get(id);
          if (i) grants.push(synthGrant(title, i, studentId, oppId));
        }
        try {
          result = analyzeReachability(student, opp, grants, { today: norm.evaluationDate });
        } catch {
          // 畸形数据导致学生端函数抛错：按「不可达」处理（不猜）。
          result = null;
        }
      }
      cache.set(key, result);
      return result;
    },
    eligibility(studentId, oppId) {
      const key = pairKey(studentId, oppId);
      if (eligCache.has(key)) return eligCache.get(key) ?? null;
      const s = norm.studentById.get(studentId);
      const o = norm.oppById.get(oppId);
      let overall: string | null = null;
      if (s && o) {
        try {
          overall = checkEligibility(s, o, { today: norm.evaluationDate }).overall;
        } catch {
          overall = null;
        }
      }
      eligCache.set(key, overall);
      return overall;
    },
  };
}

// ───────────────────────────── input_validity ─────────────────────────────

/** 公平底线格式问题（契约第 6 条）；fairness_floors 为 null / undefined 时返回 []。 */
function fairnessFloorProblems(floors: unknown): string[] {
  if (floors == null) return [];
  if (!Array.isArray(floors)) return ['fairness_floors 不是数组'];
  const problems: string[] = [];
  const seen = new Set<string>();
  floors.forEach((f, k) => {
    const at = `fairness_floors[${k}]`;
    if (!isObj(f)) {
      problems.push(`${at} 不是对象`);
      return;
    }
    if (!isStr(f.id) || f.id === '') problems.push(`${at} 的 id 不是非空字符串`);
    else if (seen.has(f.id)) problems.push(`fairness_floors 的 id ${q(f.id)} 重复`);
    else seen.add(f.id);
    for (const field of ['label', 'basis'] as const) {
      const v = f[field];
      if (!isStr(v) || v.trim() === '') problems.push(`${at} 的 ${field} 不是非空字符串（trim 后为空或不是字符串）`);
    }
    const any = f.statuses_any_of;
    if (!Array.isArray(any) || any.length === 0) problems.push(`${at} 的 statuses_any_of 不是非空数组`);
    else {
      const bad = any.filter((x) => !(STUDENT_STATUSES as readonly unknown[]).includes(x));
      if (bad.length > 0) problems.push(`${at} 的 statuses_any_of 含不合法的取值：${bad.map(q).join('、')}`);
    }
    if (!isFiniteNum(f.min_ratio) || f.min_ratio < 0 || f.min_ratio > 1) {
      problems.push(`${at} 的 min_ratio 不是 0–1 的有限数（${String(f.min_ratio)}）`);
    }
  });
  return problems;
}

function inputValidity(scenario: Scenario, norm: JointNorm, options: VerifyOptions): VerifyCheck {
  const problems: string[] = [];
  const sc: Record<string, unknown> = isObj(scenario) ? (scenario as unknown as Record<string, unknown>) : {};
  if (!isObj(scenario)) problems.push('scenario 不是对象');
  if (!Array.isArray(sc.students)) problems.push('students 不是数组');
  if (!Array.isArray(sc.opportunities)) problems.push('opportunities 不是数组');
  if (!Array.isArray(sc.interventions)) problems.push('interventions 不是数组');
  if (sc.existing_grants != null && !Array.isArray(sc.existing_grants)) problems.push('existing_grants 不是数组');
  else {
    const badGrants = arr(sc.existing_grants).filter((g) => !isObj(g)).length;
    if (badGrants > 0) problems.push(`existing_grants 中有 ${badGrants} 个条目不是对象`);
  }
  // existing grant 的 id：字符串且唯一（方案按 id 撤回）。
  {
    const ids = norm.existing.map((g) => g.id);
    const nonStr = ids.filter((id) => !isStr(id)).length;
    if (nonStr > 0) problems.push(`existing_grants 中有 ${nonStr} 条 grant 的 id 不是字符串`);
    const strIds = ids.filter(isStr);
    const dup = [...new Set(strIds.filter((id, k) => strIds.indexOf(id) !== k))];
    if (dup.length > 0) problems.push(`existing_grants 的 id 重复：${dup.map(q).join('、')}`);
  }
  const slotsRaw = sc.opportunity_time_slots;
  if (slotsRaw != null && (!isObj(slotsRaw) || Array.isArray(slotsRaw))) {
    problems.push('opportunity_time_slots 不是对象（机会 id → 时段标签）');
  }

  if (!isNonNegFinite(sc.budget_usd)) problems.push(`budget_usd 为负或不是有限数（${String(sc.budget_usd)}）`);
  // 严格 YYYY-MM-DD（前后不得有空格），且是合法日期。
  const ed = sc.evaluation_date;
  if (!isStr(ed) || !/^\d{4}-\d{2}-\d{2}$/.test(ed) || parseISODate(ed) == null) {
    problems.push(`evaluation_date 不是合法的 YYYY-MM-DD（${JSON.stringify(ed)}）`);
  }

  // options（值为 null 的字段视同未给）
  if (options.mode != null && options.mode !== 'protect' && options.mode !== 'tradeoff') {
    problems.push(`mode 只能是 protect 或 tradeoff（${String(options.mode)}）`);
  }
  if (options.mode === 'tradeoff' && options.loss_cap == null) problems.push("mode 为 'tradeoff' 但没给 loss_cap");
  if (options.loss_cap != null && !isNonNegFinite(options.loss_cap)) {
    problems.push(`loss_cap 为负或不是有限数（${String(options.loss_cap)}）`);
  }
  if (options.min_gain != null && !isNonNegFinite(options.min_gain)) {
    problems.push(`min_gain 为负或不是有限数（${String(options.min_gain)}）`);
  }
  problems.push(...fairnessFloorProblems(options.fairness_floors));

  // 重复 id
  const dupes = (ids: string[]) => ids.filter((id, k) => ids.indexOf(id) !== k);
  const rawIds = (x: unknown) => arr(x).map((e) => (isObj(e) ? e.id : undefined));
  for (const [field, raw] of [
    ['students', rawIds(sc.students)],
    ['opportunities', rawIds(sc.opportunities)],
    ['interventions', rawIds(sc.interventions)],
  ] as const) {
    if (raw.some((id) => !isStr(id))) problems.push(`${field} 中有缺少字符串 id 的条目`);
    const d = [...new Set(dupes(raw.filter(isStr)))];
    if (d.length > 0) problems.push(`${field} 的 id 重复：${d.map(q).join('、')}`);
  }

  // options 引用
  if (options.required_intervention_ids != null) {
    if (!Array.isArray(options.required_intervention_ids)) problems.push('required_intervention_ids 不是数组');
    else {
      const bad = options.required_intervention_ids.filter((id) => !norm.intById.has(id));
      if (bad.length > 0) problems.push(`required_intervention_ids 引用了不存在的措施：${bad.map(q).join('、')}`);
    }
  }
  if (options.assume_approved_intervention_ids != null) {
    if (!Array.isArray(options.assume_approved_intervention_ids)) problems.push('assume_approved_intervention_ids 不是数组');
    else {
      const bad = options.assume_approved_intervention_ids.filter((id) => !norm.intById.has(id));
      if (bad.length > 0) problems.push(`assume_approved_intervention_ids 引用了不存在的措施：${bad.map(q).join('、')}`);
    }
  }

  // 措施字段
  for (const i of norm.interventions) {
    for (const field of ['requires', 'mutually_exclusive_with'] as const) {
      const v = i[field];
      if (v == null) continue;
      if (!Array.isArray(v)) {
        problems.push(`措施 ${q(i.id)} 的 ${field} 不是数组`);
        continue;
      }
      for (const ref of v) {
        if (ref === i.id) problems.push(`措施 ${q(i.id)} 的 ${field} 引用了自己`);
        else if (!norm.intById.has(ref)) problems.push(`措施 ${q(i.id)} 的 ${field} 引用了不存在的措施 ${q(ref)}`);
      }
    }
    if (i.opportunity_ids != null) {
      if (!Array.isArray(i.opportunity_ids)) problems.push(`措施 ${q(i.id)} 的 opportunity_ids 不是数组`);
      else {
        const bad = i.opportunity_ids.filter((o) => !norm.oppById.has(o));
        if (bad.length > 0) problems.push(`措施 ${q(i.id)} 的 opportunity_ids 引用了不存在的机会：${bad.map(q).join('、')}`);
      }
    }
    if (i.capacity != null && !isNonNegFinite(i.capacity)) {
      problems.push(`措施 ${q(i.id)} 的 capacity 为负或不是有限数（${String(i.capacity)}）`);
    }
    if (!isNonNegFinite(i.unit_cost_usd)) {
      problems.push(`措施 ${q(i.id)} 的 unit_cost_usd 为负或不是有限数（${String(i.unit_cost_usd)}）`);
    }
    if (i.fixed_cost_usd !== undefined && !isNonNegFinite(i.fixed_cost_usd)) {
      problems.push(`措施 ${q(i.id)} 的 fixed_cost_usd 为负或不是有限数（${String(i.fixed_cost_usd)}）`);
    }
    // 资源额度：null / 缺省 = 未给；给出时必须是非负有限数（保证 grant 只会帮助、不会让原本可达的变为不可达）。
    for (const field of ['amount_usd', 'hours_per_week'] as const) {
      const v = i[field];
      if (v != null && !isNonNegFinite(v)) problems.push(`措施 ${q(i.id)} 的 ${field} 为负或不是有限数（${String(v)}）`);
    }
  }
  for (const g of norm.existing) {
    for (const field of ['amount_usd', 'hours_per_week'] as const) {
      const v = g[field];
      if (v != null && !isNonNegFinite(v)) problems.push(`已有 grant ${q(g.id)} 的 ${field} 为负或不是有限数（${String(v)}）`);
    }
  }

  // 时段表：键必须是场景内的机会，标签必须是非空字符串
  const badSlotKeys = Object.keys(norm.timeSlots).filter((k) => !norm.oppById.has(k));
  if (badSlotKeys.length > 0) problems.push(`opportunity_time_slots 的键引用了不存在的机会：${badSlotKeys.map(q).join('、')}`);
  const badLabels = Object.keys(norm.timeSlots).filter((k) => {
    const v = norm.timeSlots[k];
    return !isStr(v) || v === '';
  });
  if (badLabels.length > 0) {
    problems.push(`opportunity_time_slots 中这些机会的时段标签不是非空字符串：${badLabels.map(q).join('、')}`);
  }

  // 只算**全部** existing grant（不考虑任何撤回）就超过容量
  for (const i of norm.intById.values()) {
    if (i.capacity == null || !isNonNegFinite(i.capacity)) continue;
    for (const { slot, students } of occupancy(norm, norm.existing, i, [])) {
      if (students.size > i.capacity + EPS) {
        const where = slot === 'total' ? '全场景' : slotName(slot);
        problems.push(
          `只算已有 grant，措施 ${q(i.id)} 在${where}已占用 ${students.size} 名不同学生，超过容量 ${fmt(i.capacity)}（${[...students].map(q).join('、')}）`,
        );
      }
    }
  }

  return problems.length === 0
    ? check('input_validity', true, '场景与选项未命中 UNSUPPORTED_INPUT 的任何条件（max_search_nodes 不在复核范围内）。')
    : check('input_validity', false, `输入不合法（等同 UNSUPPORTED_INPUT）：${list(problems)}。`);
}

// ───────────────────────────── 公平底线 ─────────────────────────────

/**
 * 按契约第 4 条对给定的 R1 计算每条底线（按输入顺序）。floors 不是数组时返回 null。
 * 不合法的底线条目也尽量计算（字段按「没有成员 / min_ratio = NaN」处理），并在 invalid 中标出下标；
 * 只读学生的 statuses，不读学校名、显示名。
 */
function computeFairness(
  evaluator: JointEvaluator,
  floors: unknown,
  r1Keys: ReadonlySet<string>,
): { reports: FairnessReport[]; invalid: Set<number> } | null {
  if (!Array.isArray(floors)) return null;
  const norm = evaluator.norm;
  const reports: FairnessReport[] = [];
  const invalid = new Set<number>();
  const oppIds = [...norm.oppById.keys()];
  const eligibleSomewhere = new Map<string, boolean>();
  const isEligibleSomewhere = (sid: string) => {
    if (!eligibleSomewhere.has(sid)) {
      eligibleSomewhere.set(sid, oppIds.some((oid) => evaluator.eligibility(sid, oid) === 'eligible'));
    }
    return eligibleSomewhere.get(sid) as boolean;
  };
  floors.forEach((raw, k) => {
    const f: Partial<FairnessFloor> & Record<string, unknown> = isObj(raw) ? (raw as Record<string, unknown>) : {};
    if (fairnessFloorProblems([raw]).length > 0) invalid.add(k);
    const anyOf = arr<unknown>(f.statuses_any_of);
    let eligible = 0;
    let covered = 0;
    for (const s of norm.studentById.values()) {
      const st = s.statuses;
      if (!Array.isArray(st) || !st.some((x) => anyOf.includes(x))) continue;
      if (!isEligibleSomewhere(s.id)) continue;
      eligible++;
      if (oppIds.some((oid) => r1Keys.has(pairKey(s.id, oid)))) covered++;
    }
    const ratio = eligible === 0 ? null : covered / eligible;
    const minRatio = isFiniteNum(f.min_ratio) ? f.min_ratio : Number.NaN;
    reports.push({
      floor_id: isStr(f.id) ? f.id : String(f.id),
      eligible_members: eligible,
      covered_members: covered,
      ratio,
      min_ratio: minRatio,
      satisfied: ratio === null || ratio >= minRatio - FAIRNESS_EPS,
    });
  });
  return { reports, invalid };
}

function fairnessText(r: FairnessReport): string {
  const ratio = r.ratio === null ? '不适用（分母为 0）' : fmt(Math.round(r.ratio * 1e4) / 1e4);
  return `${q(r.floor_id)} ${r.covered_members}/${r.eligible_members} = ${ratio}，底线 ${String(r.min_ratio)}，${r.satisfied ? '满足' : '不满足'}`;
}

// ───────────────────────────── verifyPlan ─────────────────────────────

/** 复核时重算出的指标（与 metrics 检查同一套重算；供 ./exhaustive.ts 与基线模块使用）。 */
export interface RecomputedMetrics {
  R0: CoveragePair[];
  R1: CoveragePair[];
  G: number;
  L: number;
  N: number;
  fixed_usd: number;
  marginal_usd: number;
  total_usd: number;
  /** R0 \ R1，按 (student_id, opportunity_id) 升序。 */
  lost_pairs: CoveragePair[];
  /** X（revoked_grant_ids 中合法的部分）按 id 升序。 */
  revoked_grant_ids: string[];
  /** X 中每条 grant 的明细，按 grant_id 升序。 */
  revocations: GrantRevocation[];
  /** options 给出 fairness_floors（数组）时的每条底线结果（输入顺序）；没给（或不是数组）时为 null。 */
  fairness: FairnessReport[] | null;
}

/** 与 verifyPlan 相同，但复用调用方传入的带缓存评估器（evaluator 必须由同一 scenario 创建）。 */
export function verifyPlanWithEvaluator(
  evaluator: JointEvaluator,
  plan: JointPlan,
  options: VerifyOptions = {},
): VerifyResult {
  return verifyAndMeasure(evaluator, plan, options).result;
}

/** 复核并返回重算指标（同一次计算）。 */
export function verifyAndMeasure(
  evaluator: JointEvaluator,
  plan: JointPlan,
  options: VerifyOptions = {},
): { result: VerifyResult; metrics: RecomputedMetrics } {
  const scenario = evaluator.scenario;
  const norm = evaluator.norm;
  const opts: VerifyOptions = isObj(options) ? options : {};
  const p: Record<string, unknown> = isObj(plan) ? (plan as unknown as Record<string, unknown>) : {};
  const checks: VerifyCheck[] = [];
  const tradeoff = opts.mode === 'tradeoff';

  checks.push(inputValidity(scenario, norm, opts));

  // ── 方案归一化 ──
  const selectedIsArray = Array.isArray(p.selected_intervention_ids);
  const selectedRaw = arr<unknown>(p.selected_intervention_ids);
  const selectedStrs = selectedRaw.filter(isStr);
  const selectedSet = new Set(selectedStrs);
  /** 选中且存在的措施（去重，升序）。 */
  const selectedExisting = [...selectedSet].filter((id) => norm.intById.has(id)).sort(cmpStr);

  const allocIsArray = Array.isArray(p.allocations);
  const allocRaw = arr<unknown>(p.allocations);
  /** 字段形状合法（三个 id 都是字符串）的分配。 */
  const allocs: Allocation[] = allocRaw.filter(
    (a): a is Allocation =>
      isObj(a) && isStr(a.intervention_id) && isStr(a.student_id) && isStr(a.opportunity_id),
  );

  const assumed = new Set(arr<unknown>(opts.assume_approved_intervention_ids).filter(isStr));
  const isApproved = (i: Intervention) => i.status !== 'pending' || assumed.has(i.id);

  // ── 撤回集合 X（只取合法部分） ──
  const revokedGiven = p.revoked_grant_ids != null;
  const revokedIsArray = Array.isArray(p.revoked_grant_ids);
  const revokedRaw = arr<unknown>(p.revoked_grant_ids);
  const revocableById = new Map<string, ResourceGrant>();
  for (const g of norm.revocable) if (!revocableById.has(g.id)) revocableById.set(g.id, g);
  const X = new Set<string>(revokedRaw.filter((x): x is string => isStr(x) && revocableById.has(x)));
  const revokedSorted = [...X].sort(cmpStr);
  /** E'：未被撤回的已有 grant。 */
  const ePrime = norm.existing.filter((g) => !(isStr(g.id) && X.has(g.id)));

  // ── 1. approval ──
  {
    const problems: string[] = [];
    if (!selectedIsArray) problems.push('selected_intervention_ids 不是数组');
    const nonStr = selectedRaw.filter((x) => !isStr(x));
    if (nonStr.length > 0) problems.push(`有 ${nonStr.length} 个非字符串的措施 id`);
    const unknown = [...selectedSet].filter((id) => !norm.intById.has(id));
    if (unknown.length > 0) problems.push(`不存在的措施：${unknown.map(q).join('、')}`);
    const dup = [...new Set(selectedStrs.filter((id, k) => selectedStrs.indexOf(id) !== k))];
    if (dup.length > 0) problems.push(`重复选中：${dup.map(q).join('、')}`);
    const pending = selectedExisting.filter((id) => !isApproved(norm.intById.get(id) as Intervention));
    if (pending.length > 0) {
      problems.push(`选中了未批准（pending）且未在 assume_approved_intervention_ids 中列出的措施：${pending.map(q).join('、')}`);
    }
    const assumedUsed = selectedExisting.filter(
      (id) => (norm.intById.get(id) as Intervention).status === 'pending' && assumed.has(id),
    );
    checks.push(
      problems.length === 0
        ? check(
            'approval',
            true,
            `选中 ${selectedExisting.length} 项措施（${selectedExisting.map(q).join('、') || '无'}），都存在、不重复、已批准` +
              (assumedUsed.length > 0 ? `（其中 ${assumedUsed.map(q).join('、')} 为 pending，按 assume_approved 视为已批准）` : '') +
              '。',
          )
        : check('approval', false, `措施不合法：${list(problems)}。`),
    );
  }

  // ── 2. mutual_exclusion ──
  {
    const conflicts: string[] = [];
    for (let a = 0; a < selectedExisting.length; a++) {
      for (let b = a + 1; b < selectedExisting.length; b++) {
        const A = norm.intById.get(selectedExisting[a]) as Intervention;
        const B = norm.intById.get(selectedExisting[b]) as Intervention;
        if (excl(A, B)) conflicts.push(`${q(A.id)} 与 ${q(B.id)}`);
      }
    }
    checks.push(
      conflicts.length === 0
        ? check('mutual_exclusion', true, '选中集合内没有互斥的两项（互斥按对称关系检查）。')
        : check('mutual_exclusion', false, `同时选中了互斥的措施：${list(conflicts)}。`),
    );
  }

  // ── 3. prerequisite ──
  {
    const missing: string[] = [];
    for (const id of selectedExisting) {
      const i = norm.intById.get(id) as Intervention;
      for (const r of arr<unknown>(i.requires)) {
        if (!isStr(r) || !selectedSet.has(r)) missing.push(`${q(id)} 需要 ${q(r)}`);
      }
    }
    checks.push(
      missing.length === 0
        ? check('prerequisite', true, '每个选中措施的前置依赖（requires）都已选中。')
        : check('prerequisite', false, `前置依赖缺失：${list(missing)}。`),
    );
  }

  // ── 撤回明细（forced_by） ──
  const forcedBy = (g: ResourceGrant): string | null => {
    const k = norm.intById.get(g.intervention_id as string);
    for (const id of selectedExisting) if (excl(norm.intById.get(id), k)) return id; // selectedExisting 已升序
    return null;
  };
  const revocations: GrantRevocation[] = revokedSorted.map((id) => {
    const g = revocableById.get(id) as ResourceGrant;
    return { grant_id: id, intervention_id: g.intervention_id as string, student_id: g.student_id, forced_by: forcedBy(g) };
  });

  // ── 3½. revocation ──
  {
    const problems: string[] = [];
    // a. 合法性
    if (revokedGiven && !revokedIsArray) problems.push('revoked_grant_ids 不是数组');
    const existingIds = new Set(norm.existing.map((g) => g.id).filter(isStr));
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const x of revokedRaw) {
      if (!isStr(x)) {
        problems.push(`非字符串的撤回 id（${String(x)}）`);
        continue;
      }
      if (seen.has(x)) dup.add(x);
      seen.add(x);
      if (!existingIds.has(x)) problems.push(`撤回的 grant ${q(x)} 不在 existing_grants 中`);
      else if (!revocableById.has(x)) problems.push(`撤回的 grant ${q(x)} 不可撤回（没有指向场景内措施的 intervention_id）`);
    }
    for (const d of dup) problems.push(`重复撤回 ${q(d)}`);
    // b. 强制撤回
    const missingForced: string[] = [];
    for (const g of norm.revocable) {
      const by = forcedBy(g);
      if (by !== null && !X.has(g.id)) {
        missingForced.push(`${q(g.id)}（措施 ${q(g.intervention_id)} 与选中的 ${q(by)} 互斥）`);
      }
    }
    if (missingForced.length > 0) problems.push(`该强制撤回而没撤回的 grant：${missingForced.join('、')}`);
    // c. 撤回后不再补发同一 (措施, 学生)
    const revokedGroups = new Set(revocations.map((r) => groupKey(r.intervention_id, r.student_id)));
    const reissued = [
      ...new Set(
        allocs
          .filter((a) => revokedGroups.has(groupKey(a.intervention_id, a.student_id)))
          .map((a) => `(${a.intervention_id}, ${a.student_id})`),
      ),
    ];
    if (reissued.length > 0) problems.push(`撤回后又分配的 (措施, 学生)：${reissued.join('、')}`);
    // d. protect 模式不允许任何撤回
    if (!tradeoff && revokedRaw.length > 0) {
      problems.push(`protect 模式不动任何已有承诺，revoked_grant_ids 必须为空（实际 ${revokedRaw.length} 条）`);
    }
    const forcedCount = revocations.filter((r) => r.forced_by !== null).length;
    checks.push(
      problems.length === 0
        ? check(
            'revocation',
            true,
            revocations.length === 0
              ? '没有撤回已有 grant，也没有需要强制撤回的 grant。'
              : `撤回 ${revocations.length} 条已有 grant（其中强制撤回 ${forcedCount} 条、自愿撤回 ${revocations.length - forcedCount} 条），都合法，撤回后没有再分配同一 (措施, 学生)。`,
          )
        : check('revocation', false, `撤回不合法：${list(problems)}。`),
    );
  }

  // ── 4. allocation_validity ──
  {
    const problems: string[] = [];
    if (!allocIsArray) problems.push('allocations 不是数组');
    const malformed = allocRaw.length - allocs.length;
    if (malformed > 0) problems.push(`有 ${malformed} 条分配缺少字符串类型的 intervention_id / student_id / opportunity_id`);
    const seen = new Set<string>();
    const dupKeys = new Set<string>();
    for (const a of allocs) {
      const label = `(${a.intervention_id}, ${a.student_id}, ${a.opportunity_id})`;
      const i = norm.intById.get(a.intervention_id);
      if (!i) problems.push(`${label} 引用了不存在的措施 ${q(a.intervention_id)}`);
      else if (!selectedSet.has(a.intervention_id)) problems.push(`${label} 引用了未选中的措施 ${q(a.intervention_id)}`);
      if (!norm.studentById.has(a.student_id)) problems.push(`${label} 引用了不存在的学生 ${q(a.student_id)}`);
      if (!norm.oppById.has(a.opportunity_id)) problems.push(`${label} 引用了不存在的机会 ${q(a.opportunity_id)}`);
      if (i && Array.isArray(i.opportunity_ids) && !i.opportunity_ids.includes(a.opportunity_id)) {
        problems.push(`${label}：措施 ${q(i.id)} 的 opportunity_ids 不含机会 ${q(a.opportunity_id)}`);
      }
      const k = JSON.stringify([a.intervention_id, a.student_id, a.opportunity_id]);
      if (seen.has(k)) dupKeys.add(label);
      seen.add(k);
    }
    for (const d of dupKeys) problems.push(`重复的分配 ${d}`);
    checks.push(
      problems.length === 0
        ? check('allocation_validity', true, `${allocs.length} 条分配都引用了选中的措施、场景内的学生与机会，机会在措施适用范围内，没有重复。`)
        : check('allocation_validity', false, `分配不合法：${list(problems)}。`),
    );
  }

  // ── 5. capacity（只数 E'） ──
  {
    const problems: string[] = [];
    const notes: string[] = [];
    for (const id of selectedExisting) {
      const i = norm.intById.get(id) as Intervention;
      if (i.capacity == null) {
        notes.push(`${q(id)} 不限容量`);
        continue;
      }
      const mine = allocs.filter((a) => a.intervention_id === id);
      for (const { slot, students } of occupancy(norm, ePrime, i, mine)) {
        const where = slot === 'total' ? '全场景' : slotName(slot);
        const ok = isFiniteNum(i.capacity) && students.size <= i.capacity + EPS;
        const text = `${q(id)} 在${where}服务 ${students.size} 名不同学生（含未撤回的已有 grant 占位），容量 ${String(i.capacity)}`;
        if (ok) notes.push(text);
        else problems.push(`${text}，超出（${[...students].sort(cmpStr).map(q).join('、')}）`);
      }
    }
    checks.push(
      problems.length === 0
        ? check('capacity', true, `容量都满足：${list(notes) || '没有选中的措施'}。`)
        : check('capacity', false, `容量超出：${list(problems)}。`),
    );
  }

  // ── 6. 成本重算 ──
  let fixedUsd = 0;
  for (const id of selectedExisting) {
    const f = (norm.intById.get(id) as Intervention).fixed_cost_usd ?? 0;
    fixedUsd += isFiniteNum(f) ? f : 0;
  }
  /** 正确的边际成本：每个不同 (i, s)（i 存在、且 E' 中没有同 i 同 s 的 approved grant）计一次 unit_cost_usd。 */
  let marginalUsd = 0;
  const groups = new Map<string, { i: Intervention; s: string; costs: unknown[] }>();
  for (const a of allocs) {
    const i = norm.intById.get(a.intervention_id);
    if (!i) continue;
    const k = groupKey(a.intervention_id, a.student_id);
    const g = groups.get(k) ?? { i, s: a.student_id, costs: [] };
    g.costs.push(a.cost_usd);
    groups.set(k, g);
  }
  // 免成本只认 E' 中 approved 的已有 grant（pending 的只占容量；被撤回的不再免成本）。
  const coveredByExisting = (iid: string, s: string) =>
    ePrime.some((g) => g.intervention_id === iid && g.student_id === s && g.status === 'approved');
  for (const g of groups.values()) {
    if (!coveredByExisting(g.i.id, g.s) && isFiniteNum(g.i.unit_cost_usd)) marginalUsd += g.i.unit_cost_usd;
  }
  const totalUsd = fixedUsd + marginalUsd;
  const reportedMarginal = allocs.reduce((sum, a) => sum + (isFiniteNum(a.cost_usd) ? a.cost_usd : 0), 0);

  // cost_accounting
  {
    const problems: string[] = [];
    for (const a of allocRaw) {
      if (isObj(a) && !isNonNegFinite(a.cost_usd)) {
        problems.push(
          `分配 (${String(a.intervention_id)}, ${String(a.student_id)}, ${String(a.opportunity_id)}) 的 cost_usd 为负或不是有限数（${String(a.cost_usd)}）`,
        );
      }
    }
    for (const g of groups.values()) {
      const label = `(${g.i.id}, ${g.s})`;
      const nums = g.costs.map((c) => (isFiniteNum(c) ? c : NaN));
      if (coveredByExisting(g.i.id, g.s)) {
        if (!nums.every((c) => approxEq(c, 0))) {
          problems.push(`${label} 已由未撤回的 approved 已有 grant 覆盖，应全部记 0，实际记了 ${nums.map((c) => String(c)).join(' + ')}`);
        }
        continue;
      }
      const unit = g.i.unit_cost_usd;
      if (!isFiniteNum(unit)) continue; // 已在 input_validity 报告
      if (approxEq(unit, 0)) {
        if (!nums.every((c) => approxEq(c, 0))) problems.push(`${label} 单价为 0，应全部记 0，实际记了 ${nums.join(' + ')}`);
        continue;
      }
      const full = nums.filter((c) => approxEq(c, unit)).length;
      const zero = nums.filter((c) => approxEq(c, 0)).length;
      if (!(full === 1 && zero === nums.length - 1)) {
        problems.push(
          `${label} 共 ${nums.length} 条分配，应恰好一条记单价 ${money(unit)}、其余记 0，实际记了 ${nums.map((c) => String(c)).join(' + ')}`,
        );
      }
    }
    const unknownInt = allocs.filter((a) => !norm.intById.has(a.intervention_id)).length;
    // plan 自带 cost 字段时，核对记账口径。
    if (p.cost !== undefined) {
      const c = isObj(p.cost) ? p.cost : {};
      if (!isFiniteNum(c.fixed_usd) || !approxEq(c.fixed_usd, fixedUsd)) {
        problems.push(`cost.fixed_usd 记为 ${String(c.fixed_usd)}，应为选中措施固定成本之和（每项一次）${money(fixedUsd)}`);
      }
      if (!isFiniteNum(c.marginal_usd) || !approxEq(c.marginal_usd, reportedMarginal)) {
        problems.push(`cost.marginal_usd 记为 ${String(c.marginal_usd)}，与各分配 cost_usd 之和 ${money(reportedMarginal)} 不一致`);
      }
      if (
        !isFiniteNum(c.total_usd) ||
        !isFiniteNum(c.fixed_usd) ||
        !isFiniteNum(c.marginal_usd) ||
        !approxEq(c.total_usd, c.fixed_usd + c.marginal_usd)
      ) {
        problems.push(`cost.total_usd 记为 ${String(c.total_usd)}，不等于 fixed_usd + marginal_usd`);
      }
    }
    const tail = unknownInt > 0 ? `（另有 ${unknownInt} 条分配引用不存在的措施，无法核对单价，已在 allocation_validity 中报告）` : '';
    checks.push(
      problems.length === 0
        ? check(
            'cost_accounting',
            true,
            `成本记账正确：固定成本 ${money(fixedUsd)}（${selectedExisting.length} 项各计一次），边际成本 ${money(marginalUsd)}（${groups.size} 个不同 (措施, 学生) 组，未撤回的 approved 已有 grant 覆盖的记 0），合计 ${money(totalUsd)}${tail}。`,
          )
        : check('cost_accounting', false, `成本记账不正确：${list(problems)}${tail}。`),
    );
  }

  // budget
  {
    const budget = isObj(scenario) ? (scenario as Scenario).budget_usd : undefined;
    const ok = isFiniteNum(budget) && leq(totalUsd, budget);
    const reported = fixedUsd + reportedMarginal;
    const reportedNote = approxEq(reported, totalUsd) ? '' : `（plan 中各分配记的边际成本合计为 ${money(reportedMarginal)}，按记录算总成本 ${money(reported)}）`;
    checks.push(
      ok
        ? check('budget', true, `重算总成本 ${money(totalUsd)} ≤ 预算 ${money(budget as number)}${reportedNote}。`)
        : check(
            'budget',
            false,
            `重算总成本 ${money(totalUsd)}（固定 ${money(fixedUsd)} + 边际 ${money(marginalUsd)}）超过预算 ${String(budget)}${reportedNote}。`,
          ),
    );
  }

  // ── 评估 R0（全部 E）/ R1（E' ∪ 合成 grant） ──
  const pairAllocs = new Map<string, string[]>();
  for (const a of allocs) {
    if (!norm.intById.has(a.intervention_id)) continue;
    if (!norm.studentById.has(a.student_id) || !norm.oppById.has(a.opportunity_id)) continue;
    const k = pairKey(a.student_id, a.opportunity_id);
    const l = pairAllocs.get(k) ?? [];
    l.push(a.intervention_id);
    pairAllocs.set(k, l);
  }
  const R0: CoveragePair[] = [];
  const R1: CoveragePair[] = [];
  const r0Keys = new Set<string>();
  const r1Keys = new Set<string>();
  for (const sid of norm.studentById.keys()) {
    for (const oid of norm.oppById.keys()) {
      const k = pairKey(sid, oid);
      if (evaluator.evaluate(sid, oid, [])?.reachable === true) {
        R0.push({ student_id: sid, opportunity_id: oid });
        r0Keys.add(k);
      }
      if (evaluator.evaluate(sid, oid, pairAllocs.get(k) ?? [], X)?.reachable === true) {
        R1.push({ student_id: sid, opportunity_id: oid });
        r1Keys.add(k);
      }
    }
  }
  const gained = sortPairs(R1.filter((x) => !r0Keys.has(pairKey(x.student_id, x.opportunity_id))));
  const lost = sortPairs(R0.filter((x) => !r1Keys.has(pairKey(x.student_id, x.opportunity_id))));
  const G = gained.length;
  const L = lost.length;
  const N = G - L;

  // 交叉检查对象：重算的新增覆盖 ∪ plan 自带 R1 中声称新增（不在重算 R0 中）的对。
  const crossPairs: CoveragePair[] = [...gained];
  const crossKeys = new Set(gained.map((x) => pairKey(x.student_id, x.opportunity_id)));
  for (const raw of arr<unknown>(p.R1)) {
    if (!isObj(raw)) continue;
    const s = raw.student_id;
    const o = raw.opportunity_id;
    const k = pairKey(String(s), String(o));
    if (r0Keys.has(k) || crossKeys.has(k)) continue;
    crossKeys.add(k);
    crossPairs.push({ student_id: String(s), opportunity_id: String(o) });
  }
  const claimedOnly = crossPairs.length - gained.length;
  const scopeText =
    `新增覆盖 ${G} 对` + (claimedOnly > 0 ? `，另有 plan 自带 R1 声称新增、但重算不可达的 ${claimedOnly} 对` : '');

  // eligibility
  {
    const bad: string[] = [];
    for (const pr of crossPairs) {
      if (!norm.studentById.has(pr.student_id) || !norm.oppById.has(pr.opportunity_id)) {
        bad.push(`${pairText(pr)} 引用了场景中不存在的学生或机会`);
        continue;
      }
      const overall = evaluator.eligibility(pr.student_id, pr.opportunity_id) ?? 'error';
      if (overall !== 'eligible') bad.push(`${pairText(pr)} 资格为 ${overall}`);
    }
    checks.push(
      bad.length === 0
        ? check('eligibility', true, `${scopeText}，资格都为 eligible（措施不能改变官方资格）。`)
        : check('eligibility', false, `${scopeText}；其中资格不是 eligible 的：${list(bad)}。`),
    );
  }

  // deadline
  {
    const evalDay = parseISODate(norm.evaluationDate);
    const bad: string[] = [];
    for (const pr of crossPairs) {
      const o = norm.oppById.get(pr.opportunity_id);
      if (!o) {
        bad.push(`${pairText(pr)} 引用了不存在的机会`);
        continue;
      }
      if (o.deadline === null) continue;
      const d = parseISODate(o.deadline);
      if (d == null || evalDay == null) bad.push(`${pairText(pr)} 截止日期 ${String(o.deadline)} 或评估日 ${norm.evaluationDate} 无法解析`);
      else if (compareYMD(d, evalDay) < 0) bad.push(`${pairText(pr)} 截止日期 ${o.deadline} 早于评估日 ${norm.evaluationDate}`);
    }
    checks.push(
      bad.length === 0
        ? check('deadline', true, `${scopeText}，截止日期都为 null（滚动）或不早于评估日 ${norm.evaluationDate}。`)
        : check('deadline', false, `${scopeText}；其中截止日期不合格的：${list(bad)}。`),
    );
  }

  // barrier_resolution（E' ∪ 合成 grant）
  {
    const bad: string[] = [];
    for (const pr of crossPairs) {
      const ok = norm.studentById.has(pr.student_id) && norm.oppById.has(pr.opportunity_id);
      const res = ok
        ? evaluator.evaluate(pr.student_id, pr.opportunity_id, pairAllocs.get(pairKey(pr.student_id, pr.opportunity_id)) ?? [], X)
        : null;
      if (!res) {
        bad.push(`${pairText(pr)} 无法评估（学生或机会不存在）`);
        continue;
      }
      const unresolved = res.barriers.filter((b) => !b.resolved).map((b) => b.type);
      const byAlloc = res.barriers.some((b) => b.resolved_by_grant_ids.some((id) => id.startsWith('alloc:')));
      if (unresolved.length > 0) bad.push(`${pairText(pr)} 仍有未化解的障碍（${unresolved.join('、')}）`);
      else if (!byAlloc) bad.push(`${pairText(pr)} 没有任何障碍是由方案合成的 alloc: grant 化解的`);
    }
    checks.push(
      bad.length === 0
        ? check('barrier_resolution', true, `${scopeText}，带未撤回的已有 grant 与方案合成 grant 后障碍都已化解，且每对至少一条障碍由 alloc: grant 化解。`)
        : check('barrier_resolution', false, `${scopeText}；其中不合格的：${list(bad)}。`),
    );
  }

  // coverage_loss
  {
    const lostText = lost.length > 0 ? `（失去覆盖的对：${list(lost.map(pairText))}）` : '';
    if (tradeoff) {
      if (opts.loss_cap == null) {
        checks.push(check('coverage_loss', false, `tradeoff 模式但没给 loss_cap，无法判定损失是否允许；L = ${L}${lostText}。`));
      } else {
        const ok = isFiniteNum(opts.loss_cap) && leq(L, opts.loss_cap);
        checks.push(
          check(
            'coverage_loss',
            ok,
            ok
              ? `tradeoff 模式：损失 L = ${L} ≤ loss_cap = ${String(opts.loss_cap)}${lostText}。`
              : `tradeoff 模式：损失 L = ${L} 超过 loss_cap = ${String(opts.loss_cap)}${lostText}。`,
          ),
        );
      }
    } else {
      checks.push(
        L === 0
          ? check('coverage_loss', true, 'protect 模式：损失 L = 0，原有覆盖没有减少。')
          : check('coverage_loss', false, `protect 模式要求 L = 0，实际 L = ${L}${lostText}。`),
      );
    }
  }

  // organizer_requirements
  if (opts.required_intervention_ids != null || opts.min_gain != null) {
    const problems: string[] = [];
    const notes: string[] = [];
    if (opts.required_intervention_ids != null) {
      const req = arr<unknown>(opts.required_intervention_ids);
      if (!Array.isArray(opts.required_intervention_ids)) problems.push('required_intervention_ids 不是数组');
      const miss = req.filter((id) => !isStr(id) || !selectedSet.has(id));
      if (miss.length > 0) problems.push(`必须启用但未选中的措施：${miss.map(q).join('、')}`);
      else notes.push(`必须启用的措施 ${req.map(q).join('、') || '（空列表）'} 都已选中`);
    }
    if (opts.min_gain != null) {
      const ok = isFiniteNum(opts.min_gain) && G >= opts.min_gain - EPS;
      if (ok) notes.push(`G = ${G} ≥ min_gain = ${String(opts.min_gain)}`);
      else problems.push(`G = ${G} 未达到 min_gain = ${String(opts.min_gain)}`);
    }
    checks.push(
      problems.length === 0
        ? check('organizer_requirements', true, `主办方软要求满足：${notes.join('；')}。`)
        : check('organizer_requirements', false, `主办方软要求不满足：${list(problems)}。`),
    );
  }

  // fairness
  const fairnessComputed = computeFairness(evaluator, opts.fairness_floors, r1Keys);
  if (opts.fairness_floors != null) {
    if (!fairnessComputed) {
      checks.push(check('fairness', false, 'fairness_floors 不是数组，无法计算公平底线。'));
    } else {
      const { reports, invalid } = fairnessComputed;
      const unmet = reports.filter((r) => !r.satisfied);
      const problems: string[] = [];
      if (invalid.size > 0) problems.push(`底线格式不合法：${[...invalid].map((k) => `fairness_floors[${k}]`).join('、')}`);
      if (unmet.length > 0) problems.push(`未达到的底线：${unmet.map(fairnessText).join('；')}`);
      checks.push(
        problems.length === 0
          ? check(
              'fairness',
              true,
              reports.length === 0
                ? '没有设定公平底线（空列表），直接通过。'
                : `公平底线都满足（按学生计、分母为 0 不适用）：${reports.map(fairnessText).join('；')}。`,
            )
          : check('fairness', false, `公平底线不满足：${list(problems)}。全部结果：${reports.map(fairnessText).join('；')}。`),
      );
    }
  }
  const fairness = fairnessComputed ? fairnessComputed.reports : null;

  // metrics
  {
    const fields = (['R0', 'R1', 'G', 'L', 'N', 'cost', 'lost_pairs', 'revocations', 'fairness'] as const).filter(
      (f) => p[f] !== undefined,
    );
    const recomputed =
      `重算：G = ${G}，L = ${L}，N = ${N}，|R0| = ${R0.length}，|R1| = ${R1.length}，成本 ${money(totalUsd)}（固定 ${money(fixedUsd)} + 边际 ${money(marginalUsd)}），` +
      `撤回 ${revocations.length} 条，受损失影响 ${lost.length} 对`;
    if (fields.length === 0) {
      checks.push(check('metrics', true, `plan 未携带指标，仅重算。${recomputed}。`));
    } else {
      const problems: string[] = [];
      const show = (k: string) => {
        const [s, o] = JSON.parse(k) as [string, string];
        return `(${s}, ${o})`;
      };
      const cmpPairs = (name: 'R0' | 'R1' | 'lost_pairs', truth: CoveragePair[]) => {
        if (p[name] === undefined) return;
        if (!Array.isArray(p[name])) {
          problems.push(`${name} 不是数组`);
          return;
        }
        const keys: string[] = [];
        for (const x of p[name] as unknown[]) {
          if (!isObj(x) || !isStr(x.student_id) || !isStr(x.opportunity_id)) {
            problems.push(`${name} 中有格式不对的条目`);
            return;
          }
          keys.push(pairKey(x.student_id, x.opportunity_id));
        }
        const set = new Set(keys);
        if (set.size !== keys.length) problems.push(`${name} 中有重复的对`);
        const truthKeys = new Set(truth.map((t) => pairKey(t.student_id, t.opportunity_id)));
        const extra = [...set].filter((k) => !truthKeys.has(k));
        const missing = [...truthKeys].filter((k) => !set.has(k));
        if (extra.length > 0) problems.push(`${name} 多出了重算不可达 / 不属于该集合的对：${extra.map(show).join('、')}`);
        if (missing.length > 0) problems.push(`${name} 缺少重算应包含的对：${missing.map(show).join('、')}`);
      };
      cmpPairs('R0', R0);
      cmpPairs('R1', R1);
      cmpPairs('lost_pairs', lost);
      for (const [name, truth] of [
        ['G', G],
        ['L', L],
        ['N', N],
      ] as const) {
        if (p[name] === undefined) continue;
        if (!isFiniteNum(p[name]) || !approxEq(p[name] as number, truth)) {
          problems.push(`${name} 自带 ${String(p[name])}，重算为 ${truth}`);
        }
      }
      if (p.cost !== undefined) {
        const c = isObj(p.cost) ? p.cost : {};
        for (const [name, truth] of [
          ['fixed_usd', fixedUsd],
          ['marginal_usd', marginalUsd],
          ['total_usd', totalUsd],
        ] as const) {
          if (!isFiniteNum(c[name]) || !approxEq(c[name] as number, truth)) {
            problems.push(`cost.${name} 自带 ${String(c[name])}，重算为 ${money(truth)}`);
          }
        }
      }
      if (p.revocations !== undefined) {
        if (!Array.isArray(p.revocations)) problems.push('revocations 不是数组');
        else {
          const truthById = new Map(revocations.map((r) => [r.grant_id, r]));
          const seen = new Set<string>();
          for (const x of p.revocations as unknown[]) {
            if (!isObj(x) || !isStr(x.grant_id)) {
              problems.push('revocations 中有格式不对的条目');
              continue;
            }
            if (seen.has(x.grant_id)) {
              problems.push(`revocations 中 grant_id ${q(x.grant_id)} 重复`);
              continue;
            }
            seen.add(x.grant_id);
            const t = truthById.get(x.grant_id);
            if (!t) {
              problems.push(`revocations 多出了重算中没有撤回的 ${q(x.grant_id)}`);
              continue;
            }
            for (const f of ['intervention_id', 'student_id', 'forced_by'] as const) {
              if (x[f] !== t[f]) problems.push(`revocations 中 ${q(x.grant_id)} 的 ${f} 自带 ${String(x[f])}，重算为 ${String(t[f])}`);
            }
          }
          const missing = revocations.filter((r) => !seen.has(r.grant_id)).map((r) => q(r.grant_id));
          if (missing.length > 0) problems.push(`revocations 缺少重算中撤回的 ${missing.join('、')}`);
        }
      }
      if (p.fairness !== undefined) {
        if (fairness === null) {
          if (!(p.fairness === null || (Array.isArray(p.fairness) && p.fairness.length === 0))) {
            problems.push('options 没给公平底线，但 plan 自带了非空的 fairness');
          }
        } else if (!Array.isArray(p.fairness)) {
          problems.push('fairness 不是数组');
        } else if (p.fairness.length !== fairness.length) {
          problems.push(`fairness 自带 ${p.fairness.length} 条，重算 ${fairness.length} 条`);
        } else {
          fairness.forEach((t, k) => {
            const x = (p.fairness as unknown[])[k];
            if (!isObj(x)) {
              problems.push(`fairness[${k}] 格式不对`);
              return;
            }
            for (const f of ['floor_id', 'eligible_members', 'covered_members', 'satisfied'] as const) {
              if (x[f] !== t[f]) problems.push(`fairness[${k}].${f} 自带 ${String(x[f])}，重算为 ${String(t[f])}`);
            }
            const ratioOk =
              t.ratio === null ? x.ratio === null : isFiniteNum(x.ratio) && Math.abs(x.ratio - t.ratio) <= EPS;
            if (!ratioOk) problems.push(`fairness[${k}].ratio 自带 ${String(x.ratio)}，重算为 ${String(t.ratio)}`);
            if (!isFiniteNum(x.min_ratio) || !(Math.abs(x.min_ratio - t.min_ratio) <= EPS)) {
              problems.push(`fairness[${k}].min_ratio 自带 ${String(x.min_ratio)}，应为 ${String(t.min_ratio)}`);
            }
          });
        }
      }
      checks.push(
        problems.length === 0
          ? check('metrics', true, `plan 自带的 ${fields.join(' / ')} 与重算一致。${recomputed}。`)
          : check('metrics', false, `plan 自带的指标与重算不一致：${list(problems)}。${recomputed}。`),
      );
    }
  }

  return {
    result: { passed: checks.every((c) => c.passed), checks },
    metrics: {
      R0: sortPairs(R0),
      R1: sortPairs(R1),
      G,
      L,
      N,
      fixed_usd: fixedUsd,
      marginal_usd: marginalUsd,
      total_usd: totalUsd,
      lost_pairs: lost,
      revoked_grant_ids: revokedSorted,
      revocations,
      fairness,
    },
  };
}

/** 独立复核一个候选方案（见文件头）。 */
export function verifyPlan(scenario: Scenario, plan: JointPlan, options?: VerifyOptions): VerifyResult {
  return verifyPlanWithEvaluator(createJointEvaluator(scenario), plan, options ?? {});
}
