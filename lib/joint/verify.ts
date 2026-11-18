/**
 * verifyPlan(scenario, plan, options?) — 联合求解方案的独立复核（按 CONTRACT.md「联合求解模型」第 8 条）。
 *
 * 独立性：本文件只凭契约写成，不 import 求解器（./solve）、./index、./scenarios、./baselines、./whatif 的任何代码；
 * 只调用学生端的 analyzeReachability / checkEligibility（它们不是求解器）与日期工具。
 * 不信任 plan 自带的任何指标或可行性标记：R0、R1、G、L、N、成本、lost_pairs、revocations、fairness 全部自己重算。
 *
 * 记号（契约第 0 条）：E = existing_grants；X = 方案撤回的 grant id 中**合法**的部分（字符串、是可撤回 grant 的 id、去重）；
 * E' = E 去掉 id ∈ X 的 grant。
 * 「可撤回」（规则 R1）= intervention_id 是场景内措施 id、**且 student_id 是场景内学生**的已有 grant。
 * intervention_id 指向场景内措施、但学生不在场景内的 grant「锁定」：该学生的损失无法评估（缺信息不猜），所以不可撤回；
 * 它仍占容量、approved 的仍免成本；与它所属措施互斥的措施在两种模式下都不能被选中（归入 mutual_exclusion）。
 * R0 按全部 E 计算；R1、容量、免成本、barrier_resolution 都按 E'（∪ 方案合成的 grant）计算。
 *
 * 检查项（顺序固定；除 organizer_requirements / fairness 外每项都输出；passed = 全部通过）：
 * - input_validity：scenario / options 是否命中第 6 条 UNSUPPORTED_INPUT 的条件（max_search_nodes 除外），
 *   或 assume_approved_intervention_ids 引用了不存在的措施。命中则不通过，其余检查照常给出。
 *   规则与求解器的输入校验相同，但由本文件独立实现（不共用代码）；options 中值为 null 的字段视同未给。
 *   第 3 层新增：existing grant 的 id 不是字符串或重复；fairness_floors 格式不合法。
 * - approval：选中的措施存在、不重复、已批准（pending 只有在 assume_approved 中列出时才算已批准）。
 * - mutual_exclusion：选中集合内没有互斥的两项（mutually_exclusive_with 按对称关系处理）；并且没有选中与
 *   「有不可撤回已有 grant 的场景内措施 k」互斥的措施（R1；protect 与 tradeoff 都一样，detail 写明是哪条 grant 锁定了 k）。
 * - prerequisite：每个选中措施的 requires 全部在选中集合里。
 * - revocation（始终输出，第 3 条第 8 款）：
 *   a. revoked_grant_ids 缺省 / null 视为 []；给出时必须是数组，元素是字符串、不重复、是 E 中可撤回 grant 的 id
 *      （列出场景外学生的 grant → 不通过）；
 *   b. 强制撤回：可撤回的 g ∈ E，若存在选中的措施 i（i ∈ I）满足 excl(i, g.intervention_id)，则 g.id ∈ X
 *      （只针对可撤回的 grant；不可撤回的由 mutual_exclusion 封锁）；
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
 *   规则 R3：复核选项没给 fairness_floors（缺省 / null）时**不比较** plan 自带的 fairness（已放松底线的 alternative
 *   仍按原底线报告 fairness）；给出了底线时照常逐条比较。
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
import { fmt, plural, pluralNoun } from '../format';
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
  return `"${String(id)}"`;
}

/** 列表展示：最多列 8 项，其余写「等 n 项」。 */
function list(items: string[]): string {
  if (items.length <= 8) return items.join('; ');
  return `${items.slice(0, 8).join('; ')}; ... ${items.length} items in total`;
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
  /**
   * 可撤回的已有 grant（R1）：id 是字符串、intervention_id 是场景内措施 id、且 student_id 是场景内学生，保持输入顺序。
   */
  revocable: ResourceGrant[];
  /**
   * 「锁定」的已有 grant（R1）：intervention_id 是场景内措施 id，但 student_id 不是场景内学生——该学生的损失无法评估
   * （缺信息不猜），所以不可撤回；它仍占容量、approved 的仍免成本，并使与其措施互斥的措施不能被选中。保持输入顺序。
   */
  locked: ResourceGrant[];
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
  const linked = (g: ResourceGrant) => isStr(g.intervention_id) && intById.has(g.intervention_id);
  const inScenario = (g: ResourceGrant) => isStr(g.student_id) && studentById.has(g.student_id);
  const revocable = existing.filter((g) => isStr(g.id) && linked(g) && inScenario(g));
  const locked = existing.filter((g) => linked(g) && !inScenario(g));
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
    locked,
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
  return slot === 'D' ? 'the default time slot' : `time slot "${slot.slice(2)}"`;
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
  if (!Array.isArray(floors)) return ['fairness_floors is not an array'];
  const problems: string[] = [];
  const seen = new Set<string>();
  floors.forEach((f, k) => {
    const at = `fairness_floors[${k}]`;
    if (!isObj(f)) {
      problems.push(`${at} is not an object`);
      return;
    }
    if (!isStr(f.id) || f.id === '') problems.push(`${at}: id is not a non-empty string`);
    else if (seen.has(f.id)) problems.push(`fairness_floors id ${q(f.id)} is duplicated`);
    else seen.add(f.id);
    for (const field of ['label', 'basis'] as const) {
      const v = f[field];
      if (!isStr(v) || v.trim() === '') problems.push(`${at}: ${field} is not a non-empty string (empty after trim, or not a string)`);
    }
    const any = f.statuses_any_of;
    if (!Array.isArray(any) || any.length === 0) problems.push(`${at}: statuses_any_of is not a non-empty array`);
    else {
      const bad = any.filter((x) => !(STUDENT_STATUSES as readonly unknown[]).includes(x));
      if (bad.length > 0) problems.push(`${at}: statuses_any_of has invalid values: ${bad.map(q).join(', ')}`);
    }
    if (!isFiniteNum(f.min_ratio) || f.min_ratio < 0 || f.min_ratio > 1) {
      problems.push(`${at}: min_ratio is not a finite number from 0 to 1 (${String(f.min_ratio)})`);
    }
  });
  return problems;
}

function inputValidity(scenario: Scenario, norm: JointNorm, options: VerifyOptions): VerifyCheck {
  const problems: string[] = [];
  const sc: Record<string, unknown> = isObj(scenario) ? (scenario as unknown as Record<string, unknown>) : {};
  if (!isObj(scenario)) problems.push('scenario is not an object');
  if (!Array.isArray(sc.students)) problems.push('students is not an array');
  if (!Array.isArray(sc.opportunities)) problems.push('opportunities is not an array');
  if (!Array.isArray(sc.interventions)) problems.push('interventions is not an array');
  if (sc.existing_grants != null && !Array.isArray(sc.existing_grants)) problems.push('existing_grants is not an array');
  else {
    const badGrants = arr(sc.existing_grants).filter((g) => !isObj(g)).length;
    if (badGrants > 0) problems.push(`existing_grants has ${plural(badGrants, 'entry', 'entries')} that ${pluralNoun(badGrants, 'is', 'are')} not ${pluralNoun(badGrants, 'an object', 'objects')}`);
  }
  // existing grant 的 id：字符串且唯一（方案按 id 撤回）。
  {
    const ids = norm.existing.map((g) => g.id);
    const nonStr = ids.filter((id) => !isStr(id)).length;
    if (nonStr > 0) problems.push(`existing_grants has ${plural(nonStr, 'grant')} whose id is not a string`);
    const strIds = ids.filter(isStr);
    const dup = [...new Set(strIds.filter((id, k) => strIds.indexOf(id) !== k))];
    if (dup.length > 0) problems.push(`Duplicate existing_grants ids: ${dup.map(q).join(', ')}`);
  }
  const slotsRaw = sc.opportunity_time_slots;
  if (slotsRaw != null && (!isObj(slotsRaw) || Array.isArray(slotsRaw))) {
    problems.push('opportunity_time_slots is not an object (opportunity id → time slot label)');
  }

  if (!isNonNegFinite(sc.budget_usd)) problems.push(`budget_usd is negative or not a finite number (${String(sc.budget_usd)})`);
  // 严格 YYYY-MM-DD（前后不得有空格），且是合法日期。
  const ed = sc.evaluation_date;
  if (!isStr(ed) || !/^\d{4}-\d{2}-\d{2}$/.test(ed) || parseISODate(ed) == null) {
    problems.push(`evaluation_date is not a valid YYYY-MM-DD date (${JSON.stringify(ed)})`);
  }

  // options（值为 null 的字段视同未给）
  if (options.mode != null && options.mode !== 'protect' && options.mode !== 'tradeoff') {
    problems.push(`mode must be protect or tradeoff (${String(options.mode)})`);
  }
  if (options.mode === 'tradeoff' && options.loss_cap == null) problems.push("mode is 'tradeoff' but loss_cap is missing");
  if (options.loss_cap != null && !isNonNegFinite(options.loss_cap)) {
    problems.push(`loss_cap is negative or not a finite number (${String(options.loss_cap)})`);
  }
  if (options.min_gain != null && !isNonNegFinite(options.min_gain)) {
    problems.push(`min_gain is negative or not a finite number (${String(options.min_gain)})`);
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
    if (raw.some((id) => !isStr(id))) problems.push(`${field} has entries without a string id`);
    const d = [...new Set(dupes(raw.filter(isStr)))];
    if (d.length > 0) problems.push(`Duplicate ${field} ids: ${d.map(q).join(', ')}`);
  }

  // options 引用
  if (options.required_intervention_ids != null) {
    if (!Array.isArray(options.required_intervention_ids)) problems.push('required_intervention_ids is not an array');
    else {
      const bad = options.required_intervention_ids.filter((id) => !norm.intById.has(id));
      if (bad.length > 0) problems.push(`required_intervention_ids references support measures that do not exist: ${bad.map(q).join(', ')}`);
    }
  }
  if (options.assume_approved_intervention_ids != null) {
    if (!Array.isArray(options.assume_approved_intervention_ids)) problems.push('assume_approved_intervention_ids is not an array');
    else {
      const bad = options.assume_approved_intervention_ids.filter((id) => !norm.intById.has(id));
      if (bad.length > 0) problems.push(`assume_approved_intervention_ids references support measures that do not exist: ${bad.map(q).join(', ')}`);
    }
  }

  // 措施字段
  for (const i of norm.interventions) {
    for (const field of ['requires', 'mutually_exclusive_with'] as const) {
      const v = i[field];
      if (v == null) continue;
      if (!Array.isArray(v)) {
        problems.push(`Support measure ${q(i.id)}: ${field} is not an array`);
        continue;
      }
      for (const ref of v) {
        if (ref === i.id) problems.push(`Support measure ${q(i.id)}: ${field} references itself`);
        else if (!norm.intById.has(ref)) problems.push(`Support measure ${q(i.id)}: ${field} references a support measure that does not exist: ${q(ref)}`);
      }
    }
    if (i.opportunity_ids != null) {
      if (!Array.isArray(i.opportunity_ids)) problems.push(`Support measure ${q(i.id)}: opportunity_ids is not an array`);
      else {
        const bad = i.opportunity_ids.filter((o) => !norm.oppById.has(o));
        if (bad.length > 0) problems.push(`Support measure ${q(i.id)}: opportunity_ids references opportunities that do not exist: ${bad.map(q).join(', ')}`);
      }
    }
    if (i.capacity != null && !isNonNegFinite(i.capacity)) {
      problems.push(`Support measure ${q(i.id)}: capacity is negative or not a finite number (${String(i.capacity)})`);
    }
    if (!isNonNegFinite(i.unit_cost_usd)) {
      problems.push(`Support measure ${q(i.id)}: unit_cost_usd is negative or not a finite number (${String(i.unit_cost_usd)})`);
    }
    if (i.fixed_cost_usd !== undefined && !isNonNegFinite(i.fixed_cost_usd)) {
      problems.push(`Support measure ${q(i.id)}: fixed_cost_usd is negative or not a finite number (${String(i.fixed_cost_usd)})`);
    }
    // 资源额度：null / 缺省 = 未给；给出时必须是非负有限数（保证 grant 只会帮助、不会让原本可达的变为不可达）。
    for (const field of ['amount_usd', 'hours_per_week'] as const) {
      const v = i[field];
      if (v != null && !isNonNegFinite(v)) problems.push(`Support measure ${q(i.id)}: ${field} is negative or not a finite number (${String(v)})`);
    }
  }
  for (const g of norm.existing) {
    for (const field of ['amount_usd', 'hours_per_week'] as const) {
      const v = g[field];
      if (v != null && !isNonNegFinite(v)) problems.push(`Existing grant ${q(g.id)}: ${field} is negative or not a finite number (${String(v)})`);
    }
  }

  // 时段表：键必须是场景内的机会，标签必须是非空字符串
  const badSlotKeys = Object.keys(norm.timeSlots).filter((k) => !norm.oppById.has(k));
  if (badSlotKeys.length > 0) problems.push(`opportunity_time_slots has keys for opportunities that do not exist: ${badSlotKeys.map(q).join(', ')}`);
  const badLabels = Object.keys(norm.timeSlots).filter((k) => {
    const v = norm.timeSlots[k];
    return !isStr(v) || v === '';
  });
  if (badLabels.length > 0) {
    problems.push(`opportunity_time_slots: these opportunities have a time slot label that is not a non-empty string: ${badLabels.map(q).join(', ')}`);
  }

  // 只算**全部** existing grant（不考虑任何撤回）就超过容量
  for (const i of norm.intById.values()) {
    if (i.capacity == null || !isNonNegFinite(i.capacity)) continue;
    for (const { slot, students } of occupancy(norm, norm.existing, i, [])) {
      if (students.size > i.capacity + EPS) {
        const where = slot === 'total' ? 'the whole scenario' : slotName(slot);
        problems.push(
          `Counting existing grants only, support measure ${q(i.id)} already serves ${plural(students.size, 'distinct student')} in ${where}, more than its capacity of ${fmt(i.capacity)} (${[...students].map(q).join(', ')})`,
        );
      }
    }
  }

  return problems.length === 0
    ? check('input_validity', true, 'The scenario and options meet none of the UNSUPPORTED_INPUT conditions (max_search_nodes is not verified).')
    : check('input_validity', false, `Invalid input (same as UNSUPPORTED_INPUT): ${list(problems)}.`);
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
  const ratio = r.ratio === null ? 'not applicable (denominator is 0)' : fmt(Math.round(r.ratio * 1e4) / 1e4);
  return `${q(r.floor_id)} ${r.covered_members}/${r.eligible_members} = ${ratio}, floor ${String(r.min_ratio)}, ${r.satisfied ? 'met' : 'not met'}`;
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
    if (!selectedIsArray) problems.push('selected_intervention_ids is not an array');
    const nonStr = selectedRaw.filter((x) => !isStr(x));
    if (nonStr.length > 0) problems.push(`${plural(nonStr.length, 'support measure id')} ${pluralNoun(nonStr.length, 'is not a string', 'are not strings')}`);
    const unknown = [...selectedSet].filter((id) => !norm.intById.has(id));
    if (unknown.length > 0) problems.push(`Support measures that do not exist: ${unknown.map(q).join(', ')}`);
    const dup = [...new Set(selectedStrs.filter((id, k) => selectedStrs.indexOf(id) !== k))];
    if (dup.length > 0) problems.push(`Selected more than once: ${dup.map(q).join(', ')}`);
    const pending = selectedExisting.filter((id) => !isApproved(norm.intById.get(id) as Intervention));
    if (pending.length > 0) {
      problems.push(`Selected support measures that are pending approval and not listed in assume_approved_intervention_ids: ${pending.map(q).join(', ')}`);
    }
    const assumedUsed = selectedExisting.filter(
      (id) => (norm.intById.get(id) as Intervention).status === 'pending' && assumed.has(id),
    );
    checks.push(
      problems.length === 0
        ? check(
            'approval',
            true,
            `Selected ${plural(selectedExisting.length, 'support measure')} (${selectedExisting.map(q).join(', ') || 'none'}); all exist, none repeated, all approved` +
              (assumedUsed.length > 0 ? ` (${assumedUsed.map(q).join(', ')} pending, treated as approved via assume_approved)` : '') +
              '.',
          )
        : check('approval', false, `Invalid support measures: ${list(problems)}.`),
    );
  }

  // ── 2. mutual_exclusion ──
  {
    const conflicts: string[] = [];
    for (let a = 0; a < selectedExisting.length; a++) {
      for (let b = a + 1; b < selectedExisting.length; b++) {
        const A = norm.intById.get(selectedExisting[a]) as Intervention;
        const B = norm.intById.get(selectedExisting[b]) as Intervention;
        if (excl(A, B)) conflicts.push(`${q(A.id)} and ${q(B.id)}`);
      }
    }
    // R1：与「有不可撤回已有 grant（学生不在场景内）」的场景内措施 k 互斥的措施不能被选中（两种模式都一样）。
    const lockedByInt = new Map<string, string[]>();
    for (const g of norm.locked) {
      const k = g.intervention_id as string;
      const l = lockedByInt.get(k) ?? [];
      l.push(String(g.id));
      lockedByInt.set(k, l);
    }
    const blocked: string[] = [];
    for (const id of selectedExisting) {
      const A = norm.intById.get(id) as Intervention;
      for (const [k, gids] of [...lockedByInt.entries()].sort((a, b) => cmpStr(a[0], b[0]))) {
        if (k !== id && excl(A, norm.intById.get(k))) {
          blocked.push(
            `${q(id)} is mutually exclusive with ${q(k)}, and ${q(k)} has non-revocable existing grants ${gids.map(q).join(', ')} (the students are outside the scenario, so the loss cannot be evaluated and they cannot be revoked)`,
          );
        }
      }
    }
    const problems = [
      ...(conflicts.length > 0 ? [`Mutually exclusive support measures selected together: ${list(conflicts)}`] : []),
      ...(blocked.length > 0 ? [`Selected support measures that are mutually exclusive with a measure holding non-revocable existing grants: ${list(blocked)}`] : []),
    ];
    checks.push(
      problems.length === 0
        ? check(
            'mutual_exclusion',
            true,
            'No two selected support measures are mutually exclusive (checked symmetrically), and none is mutually exclusive with a measure that holds non-revocable existing grants.',
          )
        : check('mutual_exclusion', false, `${problems.join('; ')}.`),
    );
  }

  // ── 3. prerequisite ──
  {
    const missing: string[] = [];
    for (const id of selectedExisting) {
      const i = norm.intById.get(id) as Intervention;
      for (const r of arr<unknown>(i.requires)) {
        if (!isStr(r) || !selectedSet.has(r)) missing.push(`${q(id)} requires ${q(r)}`);
      }
    }
    checks.push(
      missing.length === 0
        ? check('prerequisite', true, 'Every prerequisite (requires) of each selected support measure is selected.')
        : check('prerequisite', false, `Missing prerequisites: ${list(missing)}.`),
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
    if (revokedGiven && !revokedIsArray) problems.push('revoked_grant_ids is not an array');
    const existingIds = new Set(norm.existing.map((g) => g.id).filter(isStr));
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const x of revokedRaw) {
      if (!isStr(x)) {
        problems.push(`Revoked id is not a string (${String(x)})`);
        continue;
      }
      if (seen.has(x)) dup.add(x);
      seen.add(x);
      if (!existingIds.has(x)) problems.push(`Revoked grant ${q(x)} is not in existing_grants`);
      else if (!revocableById.has(x)) {
        const g = norm.existing.find((e) => e.id === x) as ResourceGrant;
        problems.push(
          isStr(g.intervention_id) && norm.intById.has(g.intervention_id)
            ? `Revoked grant ${q(x)} cannot be revoked (student ${q(g.student_id)} is outside the scenario, so the loss cannot be evaluated)`
            : `Revoked grant ${q(x)} cannot be revoked (its intervention_id does not point to a support measure in the scenario)`,
        );
      }
    }
    for (const d of dup) problems.push(`Revoked more than once: ${q(d)}`);
    // b. 强制撤回
    const missingForced: string[] = [];
    for (const g of norm.revocable) {
      const by = forcedBy(g);
      if (by !== null && !X.has(g.id)) {
        missingForced.push(`${q(g.id)} (support measure ${q(g.intervention_id)} is mutually exclusive with selected ${q(by)})`);
      }
    }
    if (missingForced.length > 0) problems.push(`Grants that must be revoked but were not: ${missingForced.join(', ')}`);
    // c. 撤回后不再补发同一 (措施, 学生)
    const revokedGroups = new Set(revocations.map((r) => groupKey(r.intervention_id, r.student_id)));
    const reissued = [
      ...new Set(
        allocs
          .filter((a) => revokedGroups.has(groupKey(a.intervention_id, a.student_id)))
          .map((a) => `(${a.intervention_id}, ${a.student_id})`),
      ),
    ];
    if (reissued.length > 0) problems.push(`(support measure, student) allocated again after revocation: ${reissued.join(', ')}`);
    // d. protect 模式不允许任何撤回
    if (!tradeoff && revokedRaw.length > 0) {
      problems.push(`protect mode never touches existing commitments, so revoked_grant_ids must be empty (got ${revokedRaw.length})`);
    }
    const forcedCount = revocations.filter((r) => r.forced_by !== null).length;
    checks.push(
      problems.length === 0
        ? check(
            'revocation',
            true,
            revocations.length === 0
              ? 'No existing grants revoked, and none needs forced revocation.'
              : `Revoked ${plural(revocations.length, 'existing grant')} (${forcedCount} forced, ${revocations.length - forcedCount} voluntary); all valid, and no (support measure, student) is allocated again after revocation.`,
          )
        : check('revocation', false, `Invalid revocations: ${list(problems)}.`),
    );
  }

  // ── 4. allocation_validity ──
  {
    const problems: string[] = [];
    if (!allocIsArray) problems.push('allocations is not an array');
    const malformed = allocRaw.length - allocs.length;
    if (malformed > 0) problems.push(`${plural(malformed, 'allocation')} ${pluralNoun(malformed, 'lacks', 'lack')} a string intervention_id / student_id / opportunity_id`);
    const seen = new Set<string>();
    const dupKeys = new Set<string>();
    for (const a of allocs) {
      const label = `(${a.intervention_id}, ${a.student_id}, ${a.opportunity_id})`;
      const i = norm.intById.get(a.intervention_id);
      if (!i) problems.push(`${label} references a support measure that does not exist: ${q(a.intervention_id)}`);
      else if (!selectedSet.has(a.intervention_id)) problems.push(`${label} references a support measure that is not selected: ${q(a.intervention_id)}`);
      if (!norm.studentById.has(a.student_id)) problems.push(`${label} references a student that does not exist: ${q(a.student_id)}`);
      if (!norm.oppById.has(a.opportunity_id)) problems.push(`${label} references an opportunity that does not exist: ${q(a.opportunity_id)}`);
      if (i && Array.isArray(i.opportunity_ids) && !i.opportunity_ids.includes(a.opportunity_id)) {
        problems.push(`${label}: opportunity_ids of support measure ${q(i.id)} does not include opportunity ${q(a.opportunity_id)}`);
      }
      const k = JSON.stringify([a.intervention_id, a.student_id, a.opportunity_id]);
      if (seen.has(k)) dupKeys.add(label);
      seen.add(k);
    }
    for (const d of dupKeys) problems.push(`Duplicate allocation ${d}`);
    checks.push(
      problems.length === 0
        ? check('allocation_validity', true, `${allocs.length === 1 ? 'The 1 allocation references' : `All ${allocs.length} allocations reference`} selected support measures and students and opportunities in the scenario, each opportunity is within the measure's scope, and none is repeated.`)
        : check('allocation_validity', false, `Invalid allocations: ${list(problems)}.`),
    );
  }

  // ── 5. capacity（只数 E'） ──
  {
    const problems: string[] = [];
    const notes: string[] = [];
    for (const id of selectedExisting) {
      const i = norm.intById.get(id) as Intervention;
      if (i.capacity == null) {
        notes.push(`${q(id)} has unlimited capacity`);
        continue;
      }
      const mine = allocs.filter((a) => a.intervention_id === id);
      for (const { slot, students } of occupancy(norm, ePrime, i, mine)) {
        const where = slot === 'total' ? 'the whole scenario' : slotName(slot);
        const ok = isFiniteNum(i.capacity) && students.size <= i.capacity + EPS;
        const text = `${q(id)} serves ${plural(students.size, 'distinct student')} in ${where} (including slots held by unrevoked existing grants), capacity ${String(i.capacity)}`;
        if (ok) notes.push(text);
        else problems.push(`${text}, over capacity (${[...students].sort(cmpStr).map(q).join(', ')})`);
      }
    }
    checks.push(
      problems.length === 0
        ? check('capacity', true, `All capacity limits met: ${list(notes) || 'no support measures selected'}.`)
        : check('capacity', false, `Capacity exceeded: ${list(problems)}.`),
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
          `Allocation (${String(a.intervention_id)}, ${String(a.student_id)}, ${String(a.opportunity_id)})  cost_usd is negative or not a finite number (${String(a.cost_usd)})`,
        );
      }
    }
    for (const g of groups.values()) {
      const label = `(${g.i.id}, ${g.s})`;
      const nums = g.costs.map((c) => (isFiniteNum(c) ? c : NaN));
      if (coveredByExisting(g.i.id, g.s)) {
        if (!nums.every((c) => approxEq(c, 0))) {
          problems.push(`${label} is already covered by an unrevoked approved existing grant, so every entry should be 0, but got ${nums.map((c) => String(c)).join(' + ')}`);
        }
        continue;
      }
      const unit = g.i.unit_cost_usd;
      if (!isFiniteNum(unit)) continue; // 已在 input_validity 报告
      if (approxEq(unit, 0)) {
        if (!nums.every((c) => approxEq(c, 0))) problems.push(`${label} has a unit cost of 0, so every entry should be 0, but got ${nums.join(' + ')}`);
        continue;
      }
      const full = nums.filter((c) => approxEq(c, unit)).length;
      const zero = nums.filter((c) => approxEq(c, 0)).length;
      if (!(full === 1 && zero === nums.length - 1)) {
        problems.push(
          `${label} has ${nums.length} allocations; exactly one should carry the unit cost ${money(unit)} and the rest 0, but got ${nums.map((c) => String(c)).join(' + ')}`,
        );
      }
    }
    const unknownInt = allocs.filter((a) => !norm.intById.has(a.intervention_id)).length;
    // plan 自带 cost 字段时，核对记账口径。
    if (p.cost !== undefined) {
      const c = isObj(p.cost) ? p.cost : {};
      if (!isFiniteNum(c.fixed_usd) || !approxEq(c.fixed_usd, fixedUsd)) {
        problems.push(`cost.fixed_usd is ${String(c.fixed_usd)}, but should be the sum of fixed costs of selected support measures (once each), ${money(fixedUsd)}`);
      }
      if (!isFiniteNum(c.marginal_usd) || !approxEq(c.marginal_usd, reportedMarginal)) {
        problems.push(`cost.marginal_usd is ${String(c.marginal_usd)}, which does not match the sum of allocation cost_usd, ${money(reportedMarginal)}`);
      }
      if (
        !isFiniteNum(c.total_usd) ||
        !isFiniteNum(c.fixed_usd) ||
        !isFiniteNum(c.marginal_usd) ||
        !approxEq(c.total_usd, c.fixed_usd + c.marginal_usd)
      ) {
        problems.push(`cost.total_usd is ${String(c.total_usd)}, which does not equal fixed_usd + marginal_usd`);
      }
    }
    const tail = unknownInt > 0 ? ` (${plural(unknownInt, 'more allocation')} ${pluralNoun(unknownInt, 'references', 'reference')} support measures that do not exist, so their unit cost cannot be checked; reported in allocation_validity)` : '';
    checks.push(
      problems.length === 0
        ? check(
            'cost_accounting',
            true,
            `Cost accounting is correct: fixed cost ${money(fixedUsd)} (${plural(selectedExisting.length, 'measure')}, once each), marginal cost ${money(marginalUsd)} (${groups.size} distinct (support measure, student) ${pluralNoun(groups.size, 'group')}; those covered by unrevoked approved existing grants count 0), total ${money(totalUsd)}${tail}.`,
          )
        : check('cost_accounting', false, `Cost accounting is incorrect: ${list(problems)}${tail}.`),
    );
  }

  // budget
  {
    const budget = isObj(scenario) ? (scenario as Scenario).budget_usd : undefined;
    const ok = isFiniteNum(budget) && leq(totalUsd, budget);
    const reported = fixedUsd + reportedMarginal;
    const reportedNote = approxEq(reported, totalUsd) ? '' : ` (the plan's allocations report a marginal cost total of ${money(reportedMarginal)}, so the reported total cost is ${money(reported)})`;
    checks.push(
      ok
        ? check('budget', true, `Recomputed total cost ${money(totalUsd)} ≤ budget ${money(budget as number)}${reportedNote}.`)
        : check(
            'budget',
            false,
            `Recomputed total cost ${money(totalUsd)} (fixed ${money(fixedUsd)} + marginal ${money(marginalUsd)}) exceeds the budget of ${String(budget)}${reportedNote}.`,
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
    `${plural(G, 'newly covered pair')}` + (claimedOnly > 0 ? `, plus ${plural(claimedOnly, 'pair')} the plan's own R1 claims as new but that ${pluralNoun(claimedOnly, 'is', 'are')} not reachable on recomputation` : '');

  // eligibility
  {
    const bad: string[] = [];
    for (const pr of crossPairs) {
      if (!norm.studentById.has(pr.student_id) || !norm.oppById.has(pr.opportunity_id)) {
        bad.push(`${pairText(pr)} references a student or opportunity not in the scenario`);
        continue;
      }
      const overall = evaluator.eligibility(pr.student_id, pr.opportunity_id) ?? 'error';
      if (overall !== 'eligible') bad.push(`${pairText(pr)} eligibility is ${overall}`);
    }
    checks.push(
      bad.length === 0
        ? check('eligibility', true, `${scopeText}; all have eligibility eligible (support measures cannot change official eligibility).`)
        : check('eligibility', false, `${scopeText}; not eligible: ${list(bad)}.`),
    );
  }

  // deadline
  {
    const evalDay = parseISODate(norm.evaluationDate);
    const bad: string[] = [];
    for (const pr of crossPairs) {
      const o = norm.oppById.get(pr.opportunity_id);
      if (!o) {
        bad.push(`${pairText(pr)} references an opportunity that does not exist`);
        continue;
      }
      if (o.deadline === null) continue;
      const d = parseISODate(o.deadline);
      if (d == null || evalDay == null) bad.push(`${pairText(pr)}: deadline ${String(o.deadline)} or evaluation date ${norm.evaluationDate} cannot be parsed`);
      else if (compareYMD(d, evalDay) < 0) bad.push(`${pairText(pr)}: deadline ${o.deadline} is before the evaluation date ${norm.evaluationDate}`);
    }
    checks.push(
      bad.length === 0
        ? check('deadline', true, `${scopeText}; every deadline is null (rolling) or not before the evaluation date ${norm.evaluationDate}.`)
        : check('deadline', false, `${scopeText}; deadline problems: ${list(bad)}.`),
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
        bad.push(`${pairText(pr)} cannot be evaluated (student or opportunity does not exist)`);
        continue;
      }
      const unresolved = res.barriers.filter((b) => !b.resolved).map((b) => b.type);
      const byAlloc = res.barriers.some((b) => b.resolved_by_grant_ids.some((id) => id.startsWith('alloc:')));
      if (unresolved.length > 0) bad.push(`${pairText(pr)} still has unresolved barriers (${unresolved.join(', ')})`);
      else if (!byAlloc) bad.push(`${pairText(pr)} has no barrier resolved by an alloc: grant synthesized from the plan`);
    }
    checks.push(
      bad.length === 0
        ? check('barrier_resolution', true, `${scopeText}; with unrevoked existing grants and the plan's synthesized grants, all barriers are resolved, and each pair has at least one barrier resolved by an alloc: grant.`)
        : check('barrier_resolution', false, `${scopeText}; failing: ${list(bad)}.`),
    );
  }

  // coverage_loss
  {
    const lostText = lost.length > 0 ? ` (pairs that lost coverage: ${list(lost.map(pairText))})` : '';
    if (tradeoff) {
      if (opts.loss_cap == null) {
        checks.push(check('coverage_loss', false, `tradeoff mode without loss_cap, so it cannot tell whether the loss is allowed; L = ${L}${lostText}.`));
      } else {
        const ok = isFiniteNum(opts.loss_cap) && leq(L, opts.loss_cap);
        checks.push(
          check(
            'coverage_loss',
            ok,
            ok
              ? `tradeoff mode: loss L = ${L} ≤ loss_cap = ${String(opts.loss_cap)}${lostText}.`
              : `tradeoff mode: loss L = ${L} exceeds loss_cap = ${String(opts.loss_cap)}${lostText}.`,
          ),
        );
      }
    } else {
      checks.push(
        L === 0
          ? check('coverage_loss', true, 'protect mode: loss L = 0; existing coverage did not drop.')
          : check('coverage_loss', false, `protect mode requires L = 0, but L = ${L}${lostText}.`),
      );
    }
  }

  // organizer_requirements
  if (opts.required_intervention_ids != null || opts.min_gain != null) {
    const problems: string[] = [];
    const notes: string[] = [];
    if (opts.required_intervention_ids != null) {
      const req = arr<unknown>(opts.required_intervention_ids);
      if (!Array.isArray(opts.required_intervention_ids)) problems.push('required_intervention_ids is not an array');
      const miss = req.filter((id) => !isStr(id) || !selectedSet.has(id));
      if (miss.length > 0) problems.push(`Required support measures not selected: ${miss.map(q).join(', ')}`);
      else notes.push(`Required support measures ${req.map(q).join(', ') || '(empty list)'} are all selected`);
    }
    if (opts.min_gain != null) {
      const ok = isFiniteNum(opts.min_gain) && G >= opts.min_gain - EPS;
      if (ok) notes.push(`G = ${G} ≥ min_gain = ${String(opts.min_gain)}`);
      else problems.push(`G = ${G} is below min_gain = ${String(opts.min_gain)}`);
    }
    checks.push(
      problems.length === 0
        ? check('organizer_requirements', true, `Organizer soft requirements met: ${notes.join('; ')}.`)
        : check('organizer_requirements', false, `Organizer soft requirements not met: ${list(problems)}.`),
    );
  }

  // fairness
  const fairnessComputed = computeFairness(evaluator, opts.fairness_floors, r1Keys);
  if (opts.fairness_floors != null) {
    if (!fairnessComputed) {
      checks.push(check('fairness', false, 'fairness_floors is not an array, so fairness floors cannot be computed.'));
    } else {
      const { reports, invalid } = fairnessComputed;
      const unmet = reports.filter((r) => !r.satisfied);
      const problems: string[] = [];
      if (invalid.size > 0) problems.push(`Invalid floor format: ${[...invalid].map((k) => `fairness_floors[${k}]`).join(', ')}`);
      if (unmet.length > 0) problems.push(`Floors not met: ${unmet.map(fairnessText).join('; ')}`);
      checks.push(
        problems.length === 0
          ? check(
              'fairness',
              true,
              reports.length === 0
                ? 'No fairness floors set (empty list); passes.'
                : `All fairness floors met (counted per student; not applicable when the denominator is 0): ${reports.map(fairnessText).join('; ')}.`,
            )
          : check('fairness', false, `Fairness floors not met: ${list(problems)}. All results: ${reports.map(fairnessText).join('; ')}.`),
      );
    }
  }
  const fairness = fairnessComputed ? fairnessComputed.reports : null;

  // metrics
  {
    // R3：复核选项没给 fairness_floors（缺省 / null）时不比较 plan 自带的 fairness——它可能是按原底线报告的
    // （例如已放松底线的 alternative）。给出了底线时照常比较。
    const compareFairness = opts.fairness_floors != null;
    const fields = (['R0', 'R1', 'G', 'L', 'N', 'cost', 'lost_pairs', 'revocations', 'fairness'] as const).filter(
      (f) => p[f] !== undefined && (f !== 'fairness' || compareFairness),
    );
    const fairnessSkipped =
      !compareFairness && p.fairness !== undefined ? 'Verification options have no fairness floors, so the plan\'s own fairness was not compared. ' : '';
    const recomputed =
      `${fairnessSkipped}Recomputed: G = ${G}, L = ${L}, N = ${N}, |R0| = ${R0.length}, |R1| = ${R1.length}, cost ${money(totalUsd)} (fixed ${money(fixedUsd)} + marginal ${money(marginalUsd)}), ` +
      `${revocations.length} revoked, ${plural(lost.length, 'pair')} lost`;
    if (fields.length === 0) {
      checks.push(check('metrics', true, `The plan carries no metrics${p.fairness !== undefined ? ' to compare' : ''}; recomputed only. ${recomputed}.`));
    } else {
      const problems: string[] = [];
      const show = (k: string) => {
        const [s, o] = JSON.parse(k) as [string, string];
        return `(${s}, ${o})`;
      };
      const cmpPairs = (name: 'R0' | 'R1' | 'lost_pairs', truth: CoveragePair[]) => {
        if (p[name] === undefined) return;
        if (!Array.isArray(p[name])) {
          problems.push(`${name} is not an array`);
          return;
        }
        const keys: string[] = [];
        for (const x of p[name] as unknown[]) {
          if (!isObj(x) || !isStr(x.student_id) || !isStr(x.opportunity_id)) {
            problems.push(`${name} has malformed entries`);
            return;
          }
          keys.push(pairKey(x.student_id, x.opportunity_id));
        }
        const set = new Set(keys);
        if (set.size !== keys.length) problems.push(`${name} has duplicate pairs`);
        const truthKeys = new Set(truth.map((t) => pairKey(t.student_id, t.opportunity_id)));
        const extra = [...set].filter((k) => !truthKeys.has(k));
        const missing = [...truthKeys].filter((k) => !set.has(k));
        if (extra.length > 0) problems.push(`${name} has extra pairs that are unreachable on recomputation or do not belong to the set: ${extra.map(show).join(', ')}`);
        if (missing.length > 0) problems.push(`${name} is missing pairs the recomputation includes: ${missing.map(show).join(', ')}`);
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
          problems.push(`${name} reported ${String(p[name])}, recomputed ${truth}`);
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
            problems.push(`cost.${name} reported ${String(c[name])}, recomputed ${money(truth)}`);
          }
        }
      }
      if (p.revocations !== undefined) {
        if (!Array.isArray(p.revocations)) problems.push('revocations is not an array');
        else {
          const truthById = new Map(revocations.map((r) => [r.grant_id, r]));
          const seen = new Set<string>();
          for (const x of p.revocations as unknown[]) {
            if (!isObj(x) || !isStr(x.grant_id)) {
              problems.push('revocations has malformed entries');
              continue;
            }
            if (seen.has(x.grant_id)) {
              problems.push(`revocations: grant_id ${q(x.grant_id)} is duplicated`);
              continue;
            }
            seen.add(x.grant_id);
            const t = truthById.get(x.grant_id);
            if (!t) {
              problems.push(`revocations has extra ${q(x.grant_id)}, which the recomputation did not revoke`);
              continue;
            }
            for (const f of ['intervention_id', 'student_id', 'forced_by'] as const) {
              if (x[f] !== t[f]) problems.push(`revocations: ${q(x.grant_id)} ${f} reported ${String(x[f])}, recomputed ${String(t[f])}`);
            }
          }
          const missing = revocations.filter((r) => !seen.has(r.grant_id)).map((r) => q(r.grant_id));
          if (missing.length > 0) problems.push(`revocations is missing ${missing.join(', ')}, which the recomputation revoked`);
        }
      }
      if (p.fairness !== undefined && compareFairness) {
        if (fairness === null) {
          problems.push('fairness_floors is not an array, so the plan\'s own fairness cannot be compared');
        } else if (!Array.isArray(p.fairness)) {
          problems.push('fairness is not an array');
        } else if (p.fairness.length !== fairness.length) {
          problems.push(`fairness reported ${plural(p.fairness.length, 'entry', 'entries')}, recomputed ${fairness.length}`);
        } else {
          fairness.forEach((t, k) => {
            const x = (p.fairness as unknown[])[k];
            if (!isObj(x)) {
              problems.push(`fairness[${k}] is malformed`);
              return;
            }
            for (const f of ['floor_id', 'eligible_members', 'covered_members', 'satisfied'] as const) {
              if (x[f] !== t[f]) problems.push(`fairness[${k}].${f} reported ${String(x[f])}, recomputed ${String(t[f])}`);
            }
            const ratioOk =
              t.ratio === null ? x.ratio === null : isFiniteNum(x.ratio) && Math.abs(x.ratio - t.ratio) <= EPS;
            if (!ratioOk) problems.push(`fairness[${k}].ratio reported ${String(x.ratio)}, recomputed ${String(t.ratio)}`);
            if (!isFiniteNum(x.min_ratio) || !(Math.abs(x.min_ratio - t.min_ratio) <= EPS)) {
              problems.push(`fairness[${k}].min_ratio reported ${String(x.min_ratio)}, should be ${String(t.min_ratio)}`);
            }
          });
        }
      }
      checks.push(
        problems.length === 0
          ? check('metrics', true, `The plan's own ${fields.join(' / ')} match the recomputation. ${recomputed}.`)
          : check('metrics', false, `The plan's own metrics do not match the recomputation: ${list(problems)}. ${recomputed}.`),
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
