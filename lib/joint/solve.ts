/**
 * solveJoint(scenario, options?) — 主办方 what-if 联合求解（精确搜索）。
 * 规范：CONTRACT.md「联合求解模型」第 0–7 条（本文件逐条实现）。所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 *
 * 流程：
 * 1. 输入校验（第 6 条 UNSUPPORTED_INPUT 的全部条件）→ 命中则返回空方案，不做评估。
 * 2. R0 = 带**全部** existing_grants 时可达的（学生, 机会）对（与方案是否撤回无关）。
 * 3. 精确搜索（见下）→ OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED；INFEASIBLE 时按第 6 条的统一放松规则
 *    （min_gain / fairness_floors / required_intervention_ids 的子集，按项数从少到多）求 alternative，并明示；
 *    场景里有 pending 措施时，把全部 pending 当作已批准再求解一次得到 conditional。
 *    说明文字：放松公平底线 / 底线不可行时附「当前启用的措施下该群体最多可覆盖 X / Y 名」（上界，见 coverageBounds）；
 *    tradeoff 下必须启用的措施的强制撤回造成的损失下界超过 loss_cap 时写明「必须撤回 N 条，至少损失 M，超过上限」；
 *    「损失来自撤回已有 grant」只在 L > 0 时出现。
 * 4. 对返回的方案调用 ./verify 的 verifyPlan 独立复核（verifyPlan 不依赖本文件，依赖方向只能是 solve → verify）。
 *    复核选项不含底线（已放松或没给）时，验证器不比较 plan 自带的 fairness，所以 alternative 原样带 fairness 复核。
 *    完整搜索得到的最优方案复核不通过时，不返回 OPTIMAL：主结果改为 UNSUPPORTED_INPUT + 空方案
 *    （notes 写「内部复核未通过……」，verification 保留失败的复核）；conditional / alternative 同理不给出该方案。
 *
 * 决策变量：选中的措施集合 T、撤回的已有 grant 集合 X、分配（Allocation）。
 * - 可撤回的 grant = intervention_id 指向场景内措施、**且 student_id 是场景内学生**的已有 grant（第 0 条）。
 *   场景外学生的 grant 不可撤回（其损失无法评估，缺信息不猜），仍占容量、approved 的仍免成本；
 *   与「有这类 grant 的措施」互斥的措施在两种模式下都不能选中（blockedMask，归入 mutual_exclusion）。
 * - 强制撤回 F(T) = 与 T 中某措施互斥的措施的全部可撤回 grant（第 3 条第 8 款 b）。
 * - protect 模式（默认）：X 必须为空（第 8 款 d）→ 凡是 F({i}) 非空的措施 i 直接不可选。
 * - tradeoff 且 loss_cap = 0 不等同 protect：仍允许撤回 pending 的 grant 与不造成损失的撤回（L = 0 即可）。
 * - tradeoff 模式：X = F(T) ∪ V，V 枚举「可撤回、非强制、所属措施 k ∈ T 且 k 有容量上限」的 grant 的全部子集。
 *   只枚举这一类自愿撤回是安全的：撤回其他 grant（所属措施未选中或不限容量）不会腾出任何有用的容量，
 *   把它们恢复后 R1 只增不减（analyzeReachability 对 approved grant 单调）、成本不增（恢复免成本）、
 *   不再受「撤回后不得补发」限制、撤回数更少——按目标顺序不劣，所以最优解不含这类撤回。
 *
 * 搜索算法：
 * - 可达性只通过 analyzeReachability(student, opp, grants, { today: evaluation_date }).reachable === true 判断，
 *   措施只通过合成 grant 起作用，不修改学生档案或机会数据。结果按（学生, 机会, 分到该对的措施集合,
 *   该对相关的被撤回 grant）缓存。
 * - 合成 grant 的 student_id / opportunity_id 都是具体的，所以一个对是否可达只取决于 E'（未撤回的已有 grant）
 *   中与它相关的部分和「分到这个对的措施集合」；各对之间只通过容量、成本（同一 (措施, 学生) 只计一次）和预算相互影响。
 * - 最小可达集合：对每个对（及与它相关的撤回集合），按大小递增枚举（对该机会适用的）已批准措施子集，
 *   找出所有「最小可达集合」（该集合使对可达，且任何真子集都不行；空集可达时只有空集）。
 *   在 (T, X) 下，一个对的可选项 = ⊆ T、且不含「X 撤回过 (k, 该学生)」的措施 k 的最小可达集合
 *   （全局最小集合中满足这两个条件的，恰好就是受限后的最小集合）。最优方案中每个被（重新）覆盖的对只分到一个
 *   最小可达集合：多余的分配不增加 N、不减 L，只会让成本 / 分配条数不减，按目标第 3、4 条不会更优；
 *   给最终不可达的对分配资源同理无益。
 * - 撤回后，R0 中的对可能不再「空集可达」，它们和不在 R0 中的对一样成为决策对（分到新措施即可补位，
 *   否则计入损失 L），求解器不假定 R0 的对无需分配。
 * - 外层：按 id 升序枚举已批准措施的全部子集（位掩码 0…2^k−1），过滤互斥、前置依赖、必须启用（软要求）、
 *   固定成本超预算、protect 模式下会引起强制撤回的组合、以及含「与场景外学生的已有承诺互斥」的措施的组合；
 *   中层：tradeoff 模式下枚举自愿撤回子集 V。
 * - 内层：按 (student_id, opportunity_id) 升序对决策对做深度优先搜索，每个对的选项 = 可选最小集合
 *   （按大小、再按 id 字典序）或「不分配」；边走边检查容量（按 E' 与不同学生、按 capacity_scope / 时段）、预算、
 *   损失上限（protect: L = 0；tradeoff: L ≤ loss_cap）。
 *   叶子处检查 min_gain 与公平底线，并按目标七级顺序（N 大 → L 小 → 成本小 → 分配条数少 → 选中措施数少 →
 *   撤回数少 → 字典序小）与已知最好方案比较。「选中措施数少」一步保证规范化（第 5 条）。
 *
 * 剪枝（每条都只用真正的上界 / 下界，不会剪掉最优解）：
 * - N 上界 = 当前 G + 剩余「不在 R0 中」的决策对数 − 当前 L：剩余每个新对最多 +1；剩余 R0 决策对最好情况下
 *   被补位、不再增加损失；已产生的损失不会消失。上界 < 已知最好 N → 剪掉。
 * - 上界恰好等于已知最好 N 时，只有「剩余决策对全部被覆盖」才能打平，此时最终 L = 当前 L、成本 ≥ 当前成本、
 *   分配条数 ≥ 当前条数（只增不减）；若（当前 L, 当前成本, 当前条数）已按字典序严格劣于已知最好方案 → 剪掉。
 *   外层 / 中层用同样的界：决策对全部覆盖时 N 最大，L 下界 = 固定损失，成本下界 = 固定成本。
 * - 损失：L 只增不减，当前 L 已超过允许值（protect 为 0，tradeoff 为 loss_cap）→ 剪掉。
 * - min_gain：当前 G + 剩余新对数 < min_gain → 剪掉（G 不会超过这个数）。
 * - 公平底线：每条底线的分子上界 = 已被覆盖的成员数 + 还有未决定对的成员数；上界达不到 min_ratio → 剪掉。
 * - 预算 / 容量：分配只会增加成本与占用，超出即不可行，直接拒绝该选项。
 *
 * 节点（max_search_nodes 计数单位），每发生一次以下事件计 1 个节点：
 *   (a) 计算最小可达集合时访问一个（对, 措施子集）（含空集；撤回改变了某对的已有 grant 时按新的撤回集合重新计算）；
 *   (b) 外层访问一个措施组合（无论是否被过滤），以及中层访问一个（措施组合, 撤回集合）；
 *   (c) 内层进入一个搜索状态。
 *   缺省上限 DEFAULT_MAX_SEARCH_NODES = 200000。主搜索、conditional 的搜索、alternative 的每一个放松子集各自单独计数。
 *   达到上限即停止，返回 SEARCH_LIMIT_REACHED（不声称最优，也不等于无解）：从搜索中最近 HISTORY_K（= 8）次
 *   刷新最好方案时记录的候选里，按目标顺序（最新 = 最优）依次独立复核，返回第一个通过的；都不通过返回空方案。
 *   已批准措施超过 30 项、或某个措施组合下可自愿撤回的 grant 超过 20 条（位掩码上限）时直接按达到上限处理。
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入对象。
 * 公平性：不读取学生的学校名、显示名；公平底线只读学生自己声明的 statuses。
 */
import { analyzeReachability } from '../reachability';
import { checkEligibility } from '../eligibility';
import { parseISODate } from '../eligibility/dates';
import { verifyPlan } from './verify';
import { plural, pluralNoun } from '../format';
import { SOFT_REQUIREMENT_RELAX_ORDER, STUDENT_STATUSES } from '../types';
import type {
  Allocation,
  CoveragePair,
  FairnessFloor,
  FairnessReport,
  GrantRevocation,
  Intervention,
  JointAlternative,
  JointConditional,
  JointCost,
  JointOutcome,
  JointPlan,
  JointResult,
  JointStatus,
  ResourceGrant,
  Scenario,
  SoftRequirementKey,
  SolveOptions,
  StudentProfile,
  Opportunity,
  VerifyOptions,
  VerifyResult,
} from '../types';

/** max_search_nodes 的缺省值。 */
export const DEFAULT_MAX_SEARCH_NODES = 200_000;

const EPS = 1e-6;
const RATIO_EPS = 1e-9;
const TIE_NOTE = 'When capacity is tied, slots go in student id order (simulated). This does not represent who needs help more.';
const SIM_NOTE = 'Simulated results based on sample data. They do not represent real-world impact. Reachable only means no eligibility conflict and workable real-world conditions; reachable does not mean admitted.';

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const money = (x: number): string => `$${Math.round(x * 100) / 100}`;
const pct = (x: number): string => `${Math.round(x * 1000) / 10}%`;

function cmpStrArrays(a: readonly string[], b: readonly string[]): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const c = cmpStr(a[k], b[k]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

function cmpAlloc(a: Allocation, b: Allocation): number {
  return (
    cmpStr(a.intervention_id, b.intervention_id) ||
    cmpStr(a.student_id, b.student_id) ||
    cmpStr(a.opportunity_id, b.opportunity_id)
  );
}

function cmpPair(a: CoveragePair, b: CoveragePair): number {
  return cmpStr(a.student_id, b.student_id) || cmpStr(a.opportunity_id, b.opportunity_id);
}

const pairKey = (s: string, o: string) => JSON.stringify([s, o]);
const ivStudentKey = (i: string, s: string) => JSON.stringify([i, s]);
const isApproved = (iv: Intervention) => iv.status !== 'pending';
const finiteNonNeg = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0;
/** grant g 是否与对 (s, o) 相关（analyzeReachability 的匹配规则：只有 === null 表示所有机会）。 */
const grantMatches = (g: ResourceGrant, s: string, o: string) =>
  g.student_id === s && (g.opportunity_id === null || g.opportunity_id === o);

// ───────────────────────────── 输入校验 ─────────────────────────────

const DEFAULT_SLOT = 'D';
const slotKeyOf = (scenario: Scenario, oid: string | undefined): string => {
  const slots = scenario.opportunity_time_slots;
  if (slots && oid !== undefined && Object.prototype.hasOwnProperty.call(slots, oid)) return 'L:' + slots[oid];
  return DEFAULT_SLOT;
};

/** 所有要检查的时段键：显式标签 + 默认时段。 */
function allSlotKeys(scenario: Scenario): string[] {
  const keys = new Set<string>([DEFAULT_SLOT]);
  for (const label of Object.values(scenario.opportunity_time_slots ?? {})) keys.add('L:' + label);
  return [...keys].sort(cmpStr);
}

/**
 * 已有 grant 对措施 iv 的容量占用：范围键 → 学生 id 集合（被撤回的 grant 不占，revoked 缺省 = 不撤回）。
 * total：唯一范围键 'T'；per_time_slot：每个时段键（opportunity_id 为 null 的 grant 计入每个时段）。
 */
function existingOccupancy(scenario: Scenario, iv: Intervention, revoked?: ReadonlySet<string>): Map<string, Set<string>> {
  const occ = new Map<string, Set<string>>();
  const perSlot = iv.capacity_scope === 'per_time_slot';
  const keys = perSlot ? allSlotKeys(scenario) : ['T'];
  for (const k of keys) occ.set(k, new Set());
  for (const g of scenario.existing_grants ?? []) {
    if (g.intervention_id !== iv.id) continue;
    if (revoked && revoked.has(g.id)) continue;
    if (!perSlot) occ.get('T')!.add(g.student_id);
    else if (g.opportunity_id === null) for (const k of keys) occ.get(k)!.add(g.student_id);
    else occ.get(slotKeyOf(scenario, g.opportunity_id))!.add(g.student_id);
  }
  return occ;
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup].sort(cmpStr);
}

const isPlainObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
/** null / undefined 视同未给；给出时必须是非负有限数。 */
const optFiniteNonNeg = (x: unknown): boolean => x == null || finiteNonNeg(x);
const nonBlankString = (x: unknown): boolean => typeof x === 'string' && x.trim() !== '';

/** fairness_floors 的格式问题（规则见第 6 条）。 */
function fairnessFloorProblems(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return ['fairness_floors is not an array.'];
  const reasons: string[] = [];
  const valid = new Set<string>(STUDENT_STATUSES);
  const ids: string[] = [];
  raw.forEach((f: unknown, k: number) => {
    const where = `fairness_floors[${k}]`;
    if (!isPlainObject(f)) {
      reasons.push(`${where} is not an object.`);
      return;
    }
    if (typeof f.id !== 'string' || f.id === '') reasons.push(`${where}: id must be a non-empty string.`);
    else ids.push(f.id);
    if (!nonBlankString(f.label)) reasons.push(`${where}: label must be a non-empty string.`);
    if (!nonBlankString(f.basis)) reasons.push(`${where}: basis (grouping rationale) must be a non-empty string.`);
    if (!Array.isArray(f.statuses_any_of) || f.statuses_any_of.length === 0) {
      reasons.push(`${where}: statuses_any_of must be a non-empty array.`);
    } else {
      for (const st of f.statuses_any_of) {
        if (typeof st !== 'string' || !valid.has(st)) reasons.push(`${where}: statuses_any_of contains an unsupported status ${JSON.stringify(st)}.`);
      }
    }
    const r = f.min_ratio;
    if (!(typeof r === 'number' && Number.isFinite(r) && r >= 0 && r <= 1)) {
      reasons.push(`${where}: min_ratio must be a finite number from 0 to 1 (got ${String(r)}).`);
    }
  });
  const dup = findDuplicates(ids);
  if (dup.length) reasons.push(`Duplicate fairness_floors ids: ${dup.join(', ')}.`);
  return reasons;
}

/**
 * 返回 UNSUPPORTED_INPUT 的原因（空数组 = 输入合法）。规则见 CONTRACT.md「联合求解模型」第 6 条。
 * 验证器（./verify 的 input_validity）按同一套规则各自实现（不共用代码，保持独立）。
 */
export function validateJointInput(scenario: Scenario, rawOptions: SolveOptions = {}): string[] {
  const reasons: string[] = [];
  if (!isPlainObject(scenario)) return ['scenario is not an object.'];
  const options = (isPlainObject(rawOptions) ? rawOptions : {}) as SolveOptions;

  // ── 形状（不合法时后续检查无法安全进行，直接返回） ──
  for (const key of ['students', 'opportunities', 'interventions'] as const) {
    if (!Array.isArray(scenario[key])) reasons.push(`${key} is not an array.`);
  }
  if (scenario.existing_grants != null && !Array.isArray(scenario.existing_grants)) reasons.push('existing_grants is not an array.');
  if (scenario.opportunity_time_slots != null && !isPlainObject(scenario.opportunity_time_slots)) {
    reasons.push('opportunity_time_slots is not an object (opportunity id → time slot label).');
  }
  if (reasons.length) return reasons;
  for (const key of ['students', 'opportunities', 'interventions'] as const) {
    const bad = (scenario[key] as unknown[]).filter((e) => !isPlainObject(e) || typeof e.id !== 'string').length;
    if (bad) reasons.push(`${key} has ${bad} entries that are not objects with a string id.`);
  }
  const badGrants = (scenario.existing_grants ?? []).filter((g) => !isPlainObject(g)).length;
  if (badGrants) reasons.push(`existing_grants has ${plural(badGrants, 'entry', 'entries')} that ${pluralNoun(badGrants, 'is', 'are')} not ${pluralNoun(badGrants, 'an object', 'objects')}.`);
  if (reasons.length) return reasons;

  // ── 已有 grant 的 id：字符串且唯一（方案按 id 撤回） ──
  const grants = scenario.existing_grants ?? [];
  const badIds = grants.filter((g) => typeof g.id !== 'string').length;
  if (badIds) reasons.push(`existing_grants has ${plural(badIds, 'entry', 'entries')} whose id is not a string.`);
  const gDup = findDuplicates(grants.filter((g) => typeof g.id === 'string').map((g) => g.id));
  if (gDup.length) reasons.push(`Duplicate existing grant ids: ${gDup.join(', ')} (plans revoke by id, so ids must be unique).`);

  // ── 预算与选项 ──
  if (!finiteNonNeg(scenario.budget_usd)) reasons.push(`Budget budget_usd must be a non-negative finite number (got ${String(scenario.budget_usd)}).`);
  if (options.mode != null && options.mode !== 'protect' && options.mode !== 'tradeoff') {
    reasons.push(`mode must be protect or tradeoff (got ${String(options.mode)}).`);
  }
  if (options.mode === 'tradeoff' && options.loss_cap == null) reasons.push('tradeoff mode requires loss_cap.');
  if (!optFiniteNonNeg(options.loss_cap)) reasons.push('loss_cap must be a non-negative finite number.');
  if (!optFiniteNonNeg(options.min_gain)) reasons.push('min_gain must be a non-negative finite number.');
  if (
    options.max_search_nodes != null &&
    !(Number.isInteger(options.max_search_nodes) && options.max_search_nodes > 0)
  ) {
    reasons.push('max_search_nodes must be a positive integer.');
  }
  reasons.push(...fairnessFloorProblems(options.fairness_floors));

  const sDup = findDuplicates(scenario.students.map((s) => s.id));
  if (sDup.length) reasons.push(`Duplicate student ids: ${sDup.join(', ')}.`);
  const oDup = findDuplicates(scenario.opportunities.map((o) => o.id));
  if (oDup.length) reasons.push(`Duplicate opportunity ids: ${oDup.join(', ')}.`);
  const iDup = findDuplicates(scenario.interventions.map((i) => i.id));
  if (iDup.length) reasons.push(`Duplicate support measure ids: ${iDup.join(', ')}.`);

  const ivIds = new Set(scenario.interventions.map((i) => i.id));
  const oppIds = new Set(scenario.opportunities.map((o) => o.id));
  if (options.required_intervention_ids != null) {
    if (!Array.isArray(options.required_intervention_ids)) reasons.push('required_intervention_ids is not an array.');
    else {
      for (const id of options.required_intervention_ids) {
        if (!ivIds.has(id)) reasons.push(`required_intervention_ids references a support measure that does not exist: "${String(id)}".`);
      }
    }
  }
  for (const iv of scenario.interventions) {
    for (const [field, refs] of [
      ['requires', iv.requires],
      ['mutually_exclusive_with', iv.mutually_exclusive_with],
    ] as const) {
      if (refs == null) continue;
      if (!Array.isArray(refs)) {
        reasons.push(`Support measure "${iv.id}": ${field} is not an array.`);
        continue;
      }
      for (const r of refs) {
        if (r === iv.id) reasons.push(`Support measure "${iv.id}": ${field} references itself.`);
        else if (!ivIds.has(r)) reasons.push(`Support measure "${iv.id}": ${field} references a support measure that does not exist: "${String(r)}".`);
      }
    }
    if (iv.opportunity_ids != null) {
      if (!Array.isArray(iv.opportunity_ids)) reasons.push(`Support measure "${iv.id}": opportunity_ids is not an array.`);
      else {
        for (const o of iv.opportunity_ids) {
          if (!oppIds.has(o)) reasons.push(`Support measure "${iv.id}": opportunity_ids references an opportunity that does not exist: "${String(o)}".`);
        }
      }
    }
    if (!optFiniteNonNeg(iv.capacity)) reasons.push(`Support measure "${iv.id}": capacity must be a non-negative finite number or null.`);
    if (!finiteNonNeg(iv.unit_cost_usd)) reasons.push(`Support measure "${iv.id}": unit_cost_usd must be a non-negative finite number.`);
    if (iv.fixed_cost_usd !== undefined && !finiteNonNeg(iv.fixed_cost_usd)) {
      reasons.push(`Support measure "${iv.id}": fixed_cost_usd must be a non-negative finite number.`);
    }
    if (!optFiniteNonNeg(iv.amount_usd)) reasons.push(`Support measure "${iv.id}": amount_usd must be a non-negative finite number or null.`);
    if (!optFiniteNonNeg(iv.hours_per_week)) reasons.push(`Support measure "${iv.id}": hours_per_week must be a non-negative finite number or null.`);
  }
  for (const g of grants) {
    if (!optFiniteNonNeg(g.amount_usd)) reasons.push(`Existing grant "${String(g.id)}": amount_usd must be a non-negative finite number or null.`);
    if (!optFiniteNonNeg(g.hours_per_week)) reasons.push(`Existing grant "${String(g.id)}": hours_per_week must be a non-negative finite number or null.`);
  }
  for (const [key, label] of Object.entries(scenario.opportunity_time_slots ?? {})) {
    if (!oppIds.has(key)) reasons.push(`opportunity_time_slots has a key for an opportunity that does not exist: "${key}".`);
    if (typeof label !== 'string' || label === '') {
      reasons.push(`opportunity_time_slots: the time slot label for opportunity "${key}" must be a non-empty string (got ${JSON.stringify(label)}).`);
    }
  }
  const ed = scenario.evaluation_date;
  if (typeof ed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ed) || parseISODate(ed) == null) {
    reasons.push(`evaluation_date is not a valid YYYY-MM-DD date (got ${JSON.stringify(ed)}).`);
  }
  // 只算全部 existing grant（不考虑任何撤回）就超容量（容量本身不合法时上面已报，这里跳过）。
  for (const iv of scenario.interventions) {
    if (iv.capacity == null || !finiteNonNeg(iv.capacity)) continue;
    for (const [k, set] of existingOccupancy(scenario, iv)) {
      if (set.size > iv.capacity + EPS) {
        const scope = k === 'T' ? 'the whole scenario' : k === DEFAULT_SLOT ? 'the default time slot' : `time slot "${k.slice(2)}"`;
        reasons.push(`Support measure "${iv.id}": existing grants alone use ${plural(set.size, 'slot')} in ${scope}, more than its capacity of ${iv.capacity}.`);
      }
    }
  }
  return reasons;
}

/** 输入合法后，把 options 中为 null 的字段去掉（null 视同未给），并复制数组（不修改输入）。 */
function normalizeOptions(raw: SolveOptions | undefined): SolveOptions {
  const o: SolveOptions = {};
  if (!raw) return o;
  if (raw.mode != null) o.mode = raw.mode;
  if (raw.loss_cap != null) o.loss_cap = raw.loss_cap;
  if (raw.max_search_nodes != null) o.max_search_nodes = raw.max_search_nodes;
  if (raw.required_intervention_ids != null) o.required_intervention_ids = [...raw.required_intervention_ids];
  if (raw.min_gain != null) o.min_gain = raw.min_gain;
  if (raw.fairness_floors != null) {
    o.fairness_floors = raw.fairness_floors.map((f) => ({ ...f, statuses_any_of: [...f.statuses_any_of] }));
  }
  return o;
}

// ───────────────────────────── 评估上下文 ─────────────────────────────

interface Ctx {
  scenario: Scenario;
  students: Map<string, StudentProfile>;
  opps: Map<string, Opportunity>;
  ivs: Map<string, Intervention>;
  existing: ResourceGrant[];
  /** 可撤回的已有 grant（intervention_id 指向场景内措施、且 student_id 是场景内的学生），按 id 升序。 */
  revocable: ResourceGrant[];
  /**
   * 有「不可撤回」已有 grant 的场景内措施 id（grant 的 intervention_id 指向它、但学生不在场景内）。
   * 场景外学生的损失无法评估，与这些措施互斥的措施在两种模式下都不能选中（第 0 条、第 3 条第 2 款）。
   */
  outsiderLocked: Set<string>;
  grantById: Map<string, ResourceGrant>;
  cache: Map<string, boolean>;
  eligCache: Map<string, boolean>;
  /** 全部对，按 (student_id, opportunity_id) 升序。 */
  pairs: CoveragePair[];
  r0: Set<string>;
}

function synthGrant(ctx: Ctx, ivId: string, s: string, o: string): ResourceGrant {
  const iv = ctx.ivs.get(ivId)!;
  return {
    id: 'alloc:' + ivId + ':' + s + ':' + o,
    student_id: s,
    opportunity_id: o,
    intervention_id: ivId,
    type: iv.type,
    amount_usd: iv.amount_usd ?? null,
    device: iv.device ?? null,
    hours_per_week: iv.hours_per_week ?? null,
    status: 'approved',
    provider: ctx.scenario.title,
    is_sample: true,
  };
}

/**
 * reach(pair, E' ∪ 分到该对的合成 grant)；ivIds 已升序；revoked = 与该对相关、被撤回的已有 grant id（已升序）。
 * 只有该对自己的合成 grant 与该学生的（匹配的）已有 grant 会影响它的可达性。
 */
function reach(ctx: Ctx, s: string, o: string, ivIds: readonly string[], revoked: readonly string[] = []): boolean {
  const key = JSON.stringify([s, o, ivIds, revoked]);
  const hit = ctx.cache.get(key);
  if (hit !== undefined) return hit;
  const base = revoked.length ? ctx.existing.filter((g) => !revoked.includes(g.id)) : ctx.existing;
  const grants = [...base, ...ivIds.map((i) => synthGrant(ctx, i, s, o))];
  const r = analyzeReachability(ctx.students.get(s)!, ctx.opps.get(o)!, grants, {
    today: ctx.scenario.evaluation_date,
  });
  const ok = r.reachable === true;
  ctx.cache.set(key, ok);
  return ok;
}

function eligible(ctx: Ctx, s: string, o: string): boolean {
  const key = pairKey(s, o);
  const hit = ctx.eligCache.get(key);
  if (hit !== undefined) return hit;
  const ok =
    checkEligibility(ctx.students.get(s)!, ctx.opps.get(o)!, { today: ctx.scenario.evaluation_date }).overall === 'eligible';
  ctx.eligCache.set(key, ok);
  return ok;
}

function makeCtx(scenario: Scenario): Ctx {
  const existing = scenario.existing_grants ?? [];
  const ivs = new Map(scenario.interventions.map((i) => [i.id, i]));
  const studentIds = new Set(scenario.students.map((s) => s.id));
  const inScenarioIv = (g: ResourceGrant) => typeof g.intervention_id === 'string' && ivs.has(g.intervention_id);
  const revocable = existing
    .filter((g) => inScenarioIv(g) && studentIds.has(g.student_id))
    .sort((a, b) => cmpStr(a.id, b.id));
  const outsiderLocked = new Set(
    existing.filter((g) => inScenarioIv(g) && !studentIds.has(g.student_id)).map((g) => g.intervention_id as string),
  );
  const pairs: CoveragePair[] = [];
  for (const s of scenario.students) for (const o of scenario.opportunities) pairs.push({ student_id: s.id, opportunity_id: o.id });
  pairs.sort(cmpPair);
  const ctx: Ctx = {
    scenario,
    students: new Map(scenario.students.map((s) => [s.id, s])),
    opps: new Map(scenario.opportunities.map((o) => [o.id, o])),
    ivs,
    existing,
    revocable,
    outsiderLocked,
    grantById: new Map(existing.map((g) => [g.id, g])),
    cache: new Map(),
    eligCache: new Map(),
    pairs,
    r0: new Set(),
  };
  for (const p of pairs) if (reach(ctx, p.student_id, p.opportunity_id, [])) ctx.r0.add(pairKey(p.student_id, p.opportunity_id));
  return ctx;
}

/** excl(a, b)：对称互斥。 */
function excl(ctx: Ctx, a: string, b: string): boolean {
  return (
    (ctx.ivs.get(a)?.mutually_exclusive_with ?? []).includes(b) ||
    (ctx.ivs.get(b)?.mutually_exclusive_with ?? []).includes(a)
  );
}

/** 与措施 id 互斥、且有场景外学生已有 grant（不可撤回）的措施 k（升序）。非空 = id 在两种模式下都不能选中。 */
function outsiderConflicts(ctx: Ctx, id: string): string[] {
  return [...ctx.outsiderLocked].filter((k) => excl(ctx, id, k)).sort(cmpStr);
}

/** 选中措施集合 ids 时必须强制撤回的可撤回 grant id（升序）。 */
function forcedRevocations(ctx: Ctx, ids: readonly string[]): string[] {
  return ctx.revocable
    .filter((g) => ids.some((i) => excl(ctx, i, g.intervention_id as string)))
    .map((g) => g.id)
    .sort(cmpStr);
}

/** 与 (s, o) 相关、在 X 中的已有 grant id（升序）。 */
function revokedForPair(ctx: Ctx, X: ReadonlySet<string>, s: string, o: string): string[] {
  if (X.size === 0) return [];
  const out: string[] = [];
  for (const id of X) {
    const g = ctx.grantById.get(id);
    if (g && grantMatches(g, s, o)) out.push(id);
  }
  return out.sort(cmpStr);
}

// ───────────────────────────── 公平底线 ─────────────────────────────

interface FloorInfo {
  floor: FairnessFloor;
  /** 分母中的学生（群体成员且至少对一个机会 eligible）。 */
  members: string[];
}

function floorInfos(ctx: Ctx, floors: readonly FairnessFloor[]): FloorInfo[] {
  return floors.map((f) => {
    const any = new Set<string>(f.statuses_any_of);
    const members = ctx.scenario.students
      .filter((s) => Array.isArray(s.statuses) && s.statuses.some((st) => any.has(st)))
      .filter((s) => ctx.scenario.opportunities.some((o) => eligible(ctx, s.id, o.id)))
      .map((s) => s.id);
    return { floor: f, members };
  });
}

const ratioOk = (covered: number, den: number, min: number) => den === 0 || covered / den >= min - RATIO_EPS;

function fairnessReports(ctx: Ctx, floors: readonly FairnessFloor[], R1: readonly CoveragePair[]): FairnessReport[] {
  const covered = new Set(R1.map((p) => p.student_id));
  return floorInfos(ctx, floors).map(({ floor, members }) => {
    const den = members.length;
    const num = members.filter((s) => covered.has(s)).length;
    return {
      floor_id: floor.id,
      eligible_members: den,
      covered_members: num,
      ratio: den === 0 ? null : num / den,
      min_ratio: floor.min_ratio,
      satisfied: ratioOk(num, den, floor.min_ratio),
    };
  });
}

/** 一条公平底线在当前启用的措施下的覆盖上界（只给人数）。 */
export interface FloorCoverageBound {
  floor_id: string;
  /** 分母（同 FairnessReport.eligible_members）。 */
  eligible_members: number;
  /**
   * 分母中「本来就可达，或至少有一个（学生, 机会）对存在可行的措施集合（不考虑名额、预算与其他学生）」的成员数。
   * 任何方案的 covered_members 都不会超过它；它本身不一定能同时达到。
   */
  max_coverable: number;
}

/** 措施集合 ids 的前置依赖传递闭包（含自身；只取场景内的 id），升序。 */
function requiresClosure(ctx: Ctx, ids: readonly string[]): string[] {
  const out = new Set<string>();
  const stack = [...ids];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id) || !ctx.ivs.has(id)) continue;
    out.add(id);
    for (const r of ctx.ivs.get(id)!.requires ?? []) stack.push(r);
  }
  return [...out].sort(cmpStr);
}

/** 精确枚举单个对的措施子集时，可用措施数的上限；超过时改用「全部可用措施一起」的宽松上界。 */
const BOUND_EXACT_LIMIT = 12;

/**
 * 每条底线的覆盖上界（S1 / R5）。可用措施 = 已批准（含 assumed）、前置依赖可满足、不与场景外学生的已有承诺互斥、
 * protect 下不会引起强制撤回的措施。一个对「存在可行的措施集合」= 存在可用措施的子集 S，S 及其前置依赖闭包内两两不互斥，
 * 按 S 的闭包强制撤回后（只在 tradeoff 下可能有）不给被撤回的 (措施, 学生) 再分配，reach 为 true。不考虑名额、预算、其他学生。
 */
function coverageBounds(ctx: Ctx, floors: readonly FairnessFloor[], approved: ReadonlySet<string>, tradeoff: boolean): FloorCoverageBound[] {
  const allowed = new Set(
    [...approved].filter(
      (id) => ctx.ivs.has(id) && outsiderConflicts(ctx, id).length === 0 && (tradeoff || forcedRevocations(ctx, [id]).length === 0),
    ),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of [...allowed]) {
      if ((ctx.ivs.get(id)!.requires ?? []).some((r) => !allowed.has(r))) {
        allowed.delete(id);
        changed = true;
      }
    }
  }
  const allowedSorted = [...allowed].sort(cmpStr);
  const pairOk = (s: string, o: string): boolean => {
    if (ctx.r0.has(pairKey(s, o))) return true;
    const app = allowedSorted.filter((id) => {
      const ids = ctx.ivs.get(id)!.opportunity_ids;
      return ids == null || ids.includes(o);
    });
    if (app.length === 0) return false;
    if (app.length > BOUND_EXACT_LIMIT) return reach(ctx, s, o, app); // 宽松上界：grant 越多越可能可达
    for (const S of [...Array(app.length).keys()].flatMap((m) => subsetsOfSize(app, m + 1))) {
      const C = requiresClosure(ctx, S);
      let ok = true;
      for (let a = 0; a < C.length && ok; a++) for (let b = a + 1; b < C.length && ok; b++) if (excl(ctx, C[a], C[b])) ok = false;
      if (!ok) continue;
      const X = new Set(tradeoff ? forcedRevocations(ctx, C) : []);
      if ([...X].some((gid) => {
        const g = ctx.grantById.get(gid)!;
        return g.student_id === s && S.includes(g.intervention_id as string);
      })) continue;
      if (reach(ctx, s, o, S, revokedForPair(ctx, X, s, o))) return true;
    }
    return false;
  };
  return floorInfos(ctx, floors).map(({ floor, members }) => ({
    floor_id: floor.id,
    eligible_members: members.length,
    max_coverable: members.filter((s) => ctx.scenario.opportunities.some((o) => pairOk(s, o.id))).length,
  }));
}

/**
 * 公开版本：主结果（只含已批准措施）下每条底线最多可覆盖的人数。输入不合法时返回 null。
 * mode 只看 options.mode（tradeoff 允许撤回，可用措施更多）。页面用它显示「当前启用的措施下最多可覆盖 X / Y」。
 */
export function fairnessCoverageBounds(
  scenario: Scenario,
  floors: readonly FairnessFloor[],
  options: SolveOptions = {},
): FloorCoverageBound[] | null {
  if (validateJointInput(scenario, { ...options, fairness_floors: [...floors] }).length > 0) return null;
  const ctx = makeCtx(scenario);
  return coverageBounds(ctx, floors, approvedSet(ctx, []), options.mode === 'tradeoff');
}

function boundsText(ctx: Ctx, floors: readonly FairnessFloor[], approved: ReadonlySet<string>, tradeoff: boolean): string {
  const bounds = coverageBounds(ctx, floors, approved, tradeoff);
  return floors
    .map((f, k) => `"${f.label}": at most ${bounds[k].max_coverable} / ${bounds[k].eligible_members} can be covered`)
    .join(', ');
}

// ───────────────────────────── 方案构造与比较 ─────────────────────────────

interface Candidate {
  selected: string[];
  /** 已排序、已记成本的 Allocation。 */
  allocations: Allocation[];
  /** 撤回的已有 grant id（升序）。 */
  revoked: string[];
  G: number;
  L: number;
  N: number;
  cost: JointCost;
}

/** 由选中措施、撤回集合与「对 → 措施集合」构造带成本的方案（成本按第 3 条第 6 款，免成本只认 E' 中 approved）。 */
function buildCandidate(
  ctx: Ctx,
  selected: string[],
  revoked: string[],
  exempt: ReadonlySet<string>,
  assign: { s: string; o: string; ivs: readonly string[] }[],
  G: number,
  L: number,
): Candidate {
  const allocations: Allocation[] = [];
  for (const a of assign) for (const i of a.ivs) allocations.push({ intervention_id: i, student_id: a.s, opportunity_id: a.o, cost_usd: 0 });
  allocations.sort(cmpAlloc);
  const charged = new Set<string>();
  let marginal = 0;
  for (const al of allocations) {
    const k = ivStudentKey(al.intervention_id, al.student_id);
    if (exempt.has(k) || charged.has(k)) continue;
    charged.add(k);
    al.cost_usd = ctx.ivs.get(al.intervention_id)!.unit_cost_usd;
    marginal += al.cost_usd;
  }
  const fixed = selected.reduce((sum, i) => sum + (ctx.ivs.get(i)!.fixed_cost_usd ?? 0), 0);
  return {
    selected: [...selected].sort(cmpStr),
    allocations,
    revoked: [...revoked].sort(cmpStr),
    G,
    L,
    N: G - L,
    cost: { fixed_usd: fixed, marginal_usd: marginal, total_usd: fixed + marginal },
  };
}

/**
 * a 比 b 更优 → 负数（第 5 条：N 大 → L 小 → 总成本小 → 分配条数少 → 选中措施数少 → 撤回数少 →
 * 字典序小（选中措施、分配、撤回依次比较，前缀更短者更小））。
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.N !== b.N) return b.N - a.N;
  if (a.L !== b.L) return a.L - b.L;
  if (Math.abs(a.cost.total_usd - b.cost.total_usd) > EPS) return a.cost.total_usd - b.cost.total_usd;
  if (a.allocations.length !== b.allocations.length) return a.allocations.length - b.allocations.length;
  if (a.selected.length !== b.selected.length) return a.selected.length - b.selected.length;
  if (a.revoked.length !== b.revoked.length) return a.revoked.length - b.revoked.length;
  const c = cmpStrArrays(a.selected, b.selected);
  if (c !== 0) return c;
  const n = Math.min(a.allocations.length, b.allocations.length);
  for (let k = 0; k < n; k++) {
    const d = cmpAlloc(a.allocations[k], b.allocations[k]);
    if (d !== 0) return d;
  }
  if (a.allocations.length !== b.allocations.length) return a.allocations.length - b.allocations.length;
  return cmpStrArrays(a.revoked, b.revoked);
}

// ───────────────────────────── 精确搜索 ─────────────────────────────

interface SearchParams {
  /** 视为已批准的措施（不含未假设的 pending）。 */
  approved: Set<string>;
  required?: string[];
  minGain?: number;
  floors?: FairnessFloor[];
  /** tradeoff 模式（允许撤回）。 */
  tradeoff: boolean;
  /** 允许的最大损失（protect = 0）。 */
  lossCap: number;
  maxNodes: number;
}

interface SearchOutcome {
  complete: boolean;
  best: Candidate | null;
  nodes: number;
  /**
   * 最近 HISTORY_K 次「刷新最好方案」时的候选（按发现顺序；后发现的严格更优）。
   * 达到搜索上限时，runSearch 从最新（最优）往回依次复核，返回第一个复核通过的。
   */
  history: Candidate[];
}

/** 达到搜索上限时保留、可依次复核的最近改进候选数。 */
const HISTORY_K = 8;
/** 一个措施组合下可自愿撤回的 grant 数上限（子集按位掩码枚举）。 */
const MAX_VOLUNTARY = 20;

class NodeLimit extends Error {}

function search(ctx: Ctx, params: SearchParams): SearchOutcome {
  const { scenario } = ctx;
  let nodes = 0;
  const tick = () => {
    nodes += 1;
    if (nodes > params.maxNodes) throw new NodeLimit();
  };
  let best = null as Candidate | null;
  const history: Candidate[] = [];
  const budget = scenario.budget_usd;
  const lossCap = params.lossCap;

  const U = scenario.interventions.filter((iv) => params.approved.has(iv.id)).map((iv) => iv.id).sort(cmpStr);
  const idx = new Map(U.map((id, k) => [id, k]));

  // 互斥（对称）与前置依赖的位掩码。
  const mutex: number[] = U.map(() => 0);
  const reqMask: number[] = U.map(() => 0);
  let blockedMask = 0; // requires 了未批准措施的措施永远不能选；protect 下会引起强制撤回的措施也不能选
  // 每项措施会强制撤回的可撤回 grant（下标指向 ctx.revocable）。
  const forcedBy: number[][] = U.map(() => []);
  U.forEach((id, k) => {
    const iv = ctx.ivs.get(id)!;
    for (const m of iv.mutually_exclusive_with ?? []) {
      const j = idx.get(m);
      if (j !== undefined) {
        mutex[k] |= 1 << j;
        mutex[j] |= 1 << k;
      }
    }
    for (const r of iv.requires ?? []) {
      const j = idx.get(r);
      if (j === undefined) blockedMask |= 1 << k;
      else reqMask[k] |= 1 << j;
    }
    ctx.revocable.forEach((g, gi) => {
      if (excl(ctx, id, g.intervention_id as string)) forcedBy[k].push(gi);
    });
    if (!params.tradeoff && forcedBy[k].length > 0) blockedMask |= 1 << k;
    // 与场景外学生的已有承诺（不可撤回）互斥：两种模式下都不能选中。
    if (outsiderConflicts(ctx, id).length > 0) blockedMask |= 1 << k;
  });
  let requiredMask = 0;
  let requiredImpossible = false;
  for (const r of params.required ?? []) {
    const j = idx.get(r);
    if (j === undefined) requiredImpossible = true;
    else requiredMask |= 1 << j;
  }

  const floors = params.floors && params.floors.length > 0 ? floorInfos(ctx, params.floors) : [];
  const studentIndex = new Map(scenario.students.map((s, k) => [s.id, k]));
  const floorMembers = floors
    .map((f) => ({ min: f.floor.min_ratio, members: f.members.map((s) => studentIndex.get(s)!) }))
    .filter((f) => f.members.length > 0);

  try {
    // 位掩码最多支持 30 项已批准措施；更多时组合数远超任何合理的节点上限，直接按达到上限处理。
    if (U.length > 30) throw new NodeLimit();
    const maskIds = (mask: number) => U.filter((_, k) => mask & (1 << k));

    // ── 最小可达集合（以 U 的位掩码表示），按（对, 相关撤回集合）缓存 ──
    const minimalCache = new Map<string, number[]>();
    const minimalSets = (s: string, o: string, revoked: readonly string[]): number[] => {
      const key = JSON.stringify([s, o, revoked]);
      const hit = minimalCache.get(key);
      if (hit) return hit;
      const minimal: number[] = [];
      tick();
      if (reach(ctx, s, o, [], revoked)) minimal.push(0);
      else {
        const applicable = U.filter((id) => {
          const ids = ctx.ivs.get(id)!.opportunity_ids;
          return ids == null || ids.includes(o);
        });
        const n = applicable.length;
        const combo: number[] = [];
        // 按大小递增枚举组合；跳过已知最小集合的超集。
        const visit = (start: number, size: number) => {
          if (combo.length === size) {
            tick();
            let mask = 0;
            for (const c of combo) mask |= 1 << idx.get(applicable[c])!;
            if (minimal.some((m) => (m & mask) === m)) return;
            const ids = combo.map((c) => applicable[c]); // applicable 已升序
            if (reach(ctx, s, o, ids, revoked)) minimal.push(mask);
            return;
          }
          for (let c = start; c < n; c++) {
            combo.push(c);
            visit(c + 1, size);
            combo.pop();
          }
        };
        for (let size = 1; size <= n; size++) visit(0, size);
      }
      minimalCache.set(key, minimal);
      return minimal;
    };
    // 预处理：不撤回时每个对的最小可达集合。
    for (const p of ctx.pairs) minimalSets(p.student_id, p.opportunity_id, []);

    if (requiredImpossible) return { complete: true, best: null, nodes, history };

    const scopeKey = (iv: Intervention, o: string) =>
      iv.capacity_scope === 'per_time_slot' ? slotKeyOf(scenario, o) : 'T';

    /** 在 (T, X) 下做内层搜索。 */
    const inner = (T: number, selected: string[], fixed: number, X: Set<string>) => {
      // 撤回过 (k, s) 的组合不能再分配 k 给 s（第 8 款 c）。
      const forbidden = new Set<string>();
      for (const id of X) {
        const g = ctx.grantById.get(id)!;
        forbidden.add(ivStudentKey(g.intervention_id as string, g.student_id));
      }
      const revokedSorted = [...X].sort(cmpStr);

      interface DecPair { s: string; si: number; o: string; inR0: boolean; options: { ids: string[]; n: number }[] }
      const dec: DecPair[] = [];
      let lossFixed = 0;
      const reachedCnt = scenario.students.map(() => 0);
      const undecCnt = scenario.students.map(() => 0);
      for (const p of ctx.pairs) {
        const s = p.student_id;
        const o = p.opportunity_id;
        const inR0 = ctx.r0.has(pairKey(s, o));
        const minimal = minimalSets(s, o, revokedForPair(ctx, X, s, o));
        const si = studentIndex.get(s)!;
        if (minimal.length === 1 && minimal[0] === 0) {
          reachedCnt[si] += 1; // 无需分配即可达（R0 中未受撤回影响的对）
          continue;
        }
        const options = minimal
          .filter((m) => (m & T) === m)
          .map((m) => maskIds(m))
          .filter((ids) => !ids.some((i) => forbidden.has(ivStudentKey(i, s))))
          .sort((a, b) => a.length - b.length || cmpStrArrays(a, b))
          .map((ids) => ({ ids, n: ids.length }));
        if (options.length === 0) {
          if (inR0) lossFixed += 1;
          continue;
        }
        dec.push({ s, si, o, inR0, options });
        undecCnt[si] += 1;
      }
      if (lossFixed > lossCap + EPS) return;
      const newTotal = dec.filter((d) => !d.inR0).length;
      // 外层 / 中层的界：决策对全部覆盖时 N 最大（= newTotal − lossFixed），L 最小（= lossFixed），成本 ≥ 固定成本。
      if (best) {
        const ub0 = newTotal - lossFixed;
        if (ub0 < best.N) return;
        if (ub0 === best.N) {
          if (lossFixed > best.L) return;
          if (lossFixed === best.L && fixed > best.cost.total_usd + EPS) return;
        }
      }
      if (params.minGain !== undefined && newTotal + EPS < params.minGain) return;

      // E' 下的免成本与容量占用。
      const exempt = new Set<string>();
      for (const g of ctx.existing) {
        if (X.has(g.id)) continue;
        if (g.intervention_id != null && g.status === 'approved') exempt.add(ivStudentKey(g.intervention_id, g.student_id));
      }
      // 容量状态：措施 → 范围键 → 学生 → 引用计数（未撤回的已有 grant 占用记为永久）。
      const occ = new Map<string, Map<string, Map<string, number>>>();
      for (const id of selected) {
        const iv = ctx.ivs.get(id)!;
        if (iv.capacity == null) continue;
        const m = new Map<string, Map<string, number>>();
        for (const [k, set] of existingOccupancy(scenario, iv, X)) {
          m.set(k, new Map([...set].map((s) => [s, Number.POSITIVE_INFINITY])));
        }
        occ.set(id, m);
      }
      const charged = new Map<string, number>();
      let marginal = 0;
      let allocCount = 0;
      let G = 0;
      let L = lossFixed;
      let newLeft = newTotal;
      const chosen: ({ s: string; o: string; ivs: string[] } | null)[] = [];

      /** 尝试把 ids 分给 (s, o)；成功返回撤销函数，失败返回 null（不留副作用）。 */
      const apply = (s: string, o: string, ids: string[]): (() => void) | null => {
        const undo: (() => void)[] = [];
        const rollback = () => {
          for (let k = undo.length - 1; k >= 0; k--) undo[k]();
        };
        for (const id of ids) {
          const iv = ctx.ivs.get(id)!;
          const capMap = occ.get(id);
          if (capMap) {
            const scope = capMap.get(scopeKey(iv, o))!;
            const cur = scope.get(s) ?? 0;
            if (cur === 0 && scope.size + 1 > iv.capacity! + EPS) {
              rollback();
              return null;
            }
            scope.set(s, cur + 1);
            undo.push(() => {
              if (cur === 0) scope.delete(s);
              else scope.set(s, cur);
            });
          }
          const ck = ivStudentKey(id, s);
          const c = charged.get(ck) ?? 0;
          if (c === 0 && !exempt.has(ck)) {
            marginal += iv.unit_cost_usd;
            undo.push(() => {
              marginal -= iv.unit_cost_usd;
            });
          }
          charged.set(ck, c + 1);
          undo.push(() => {
            if (c === 0) charged.delete(ck);
            else charged.set(ck, c);
          });
        }
        if (fixed + marginal > budget + EPS) {
          rollback();
          return null;
        }
        return rollback;
      };

      /** 公平底线：final = false 时用分子上界（已覆盖 + 还有未决定对）。 */
      const floorsOk = (final: boolean) => {
        for (const f of floorMembers) {
          let covered = 0;
          for (const si of f.members) if (reachedCnt[si] > 0 || (!final && undecCnt[si] > 0)) covered += 1;
          if (!ratioOk(covered, f.members.length, f.min)) return false;
        }
        return true;
      };

      const dfs = (k: number) => {
        tick();
        if (L > lossCap + EPS) return;
        if (best) {
          const ub = G + newLeft - L;
          if (ub < best.N) return;
          if (ub === best.N) {
            // 打平只能靠剩余决策对全部覆盖：最终 L = 当前 L，成本与分配条数只增不减。
            if (L > best.L) return;
            if (L === best.L) {
              const cost = fixed + marginal;
              if (cost > best.cost.total_usd + EPS) return;
              if (Math.abs(cost - best.cost.total_usd) <= EPS && allocCount > best.allocations.length) return;
            }
          }
        }
        if (params.minGain !== undefined && G + newLeft + EPS < params.minGain) return;
        if (floorMembers.length > 0 && !floorsOk(k === dec.length)) return;
        if (k === dec.length) {
          const assign = chosen.filter((c): c is { s: string; o: string; ivs: string[] } => c !== null);
          const cand = buildCandidate(ctx, selected, revokedSorted, exempt, assign, G, L);
          if (!best || compareCandidates(cand, best) < 0) {
            best = cand;
            history.push(cand);
            if (history.length > HISTORY_K) history.shift();
          }
          return;
        }
        const p = dec[k];
        undecCnt[p.si] -= 1;
        if (!p.inR0) newLeft -= 1;
        for (const opt of p.options) {
          const undo = apply(p.s, p.o, opt.ids);
          if (!undo) continue;
          if (!p.inR0) G += 1;
          reachedCnt[p.si] += 1;
          allocCount += opt.n;
          chosen.push({ s: p.s, o: p.o, ivs: opt.ids });
          dfs(k + 1);
          chosen.pop();
          allocCount -= opt.n;
          reachedCnt[p.si] -= 1;
          if (!p.inR0) G -= 1;
          undo();
        }
        if (p.inR0) L += 1;
        chosen.push(null);
        dfs(k + 1);
        chosen.pop();
        if (p.inR0) L -= 1;
        if (!p.inR0) newLeft += 1;
        undecCnt[p.si] += 1;
      };
      dfs(0);
    };

    // ── 外层：措施组合；中层：撤回集合 ──
    const total = 1 << U.length;
    for (let T = 0; T < total; T++) {
      tick();
      if (T & blockedMask) continue;
      if ((T & requiredMask) !== requiredMask) continue;
      let ok = true;
      for (let k = 0; k < U.length && ok; k++) {
        if (!(T & (1 << k))) continue;
        if (T & mutex[k]) ok = false;
        else if ((T & reqMask[k]) !== reqMask[k]) ok = false;
      }
      if (!ok) continue;
      const selected = maskIds(T);
      const fixed = selected.reduce((sum, i) => sum + (ctx.ivs.get(i)!.fixed_cost_usd ?? 0), 0);
      if (fixed > budget + EPS) continue;

      const forced = new Set<number>();
      for (let k = 0; k < U.length; k++) if (T & (1 << k)) for (const gi of forcedBy[k]) forced.add(gi);
      // 自愿撤回候选：只在 tradeoff 下；只取所属措施已选中且有容量上限的 grant（理由见文件头）。
      const voluntary: number[] = [];
      if (params.tradeoff) {
        ctx.revocable.forEach((g, gi) => {
          if (forced.has(gi)) return;
          const k = idx.get(g.intervention_id as string);
          if (k === undefined || !(T & (1 << k))) return;
          if (ctx.ivs.get(g.intervention_id as string)!.capacity == null) return;
          voluntary.push(gi);
        });
      }
      if (voluntary.length > MAX_VOLUNTARY) throw new NodeLimit();
      const forcedIds = [...forced].map((gi) => ctx.revocable[gi].id);
      const vTotal = 1 << voluntary.length;
      for (let V = 0; V < vTotal; V++) {
        if (voluntary.length > 0) tick();
        const X = new Set(forcedIds);
        for (let b = 0; b < voluntary.length; b++) if (V & (1 << b)) X.add(ctx.revocable[voluntary[b]].id);
        inner(T, selected, fixed, X);
      }
    }
    return { complete: true, best, nodes, history };
  } catch (e) {
    if (e instanceof NodeLimit) return { complete: false, best, nodes, history };
    throw e;
  }
}

// ───────────────────────────── 结果组装 ─────────────────────────────

type PlanWithCost = JointPlan & { cost: JointCost; revoked_grant_ids: string[] };

function emptyPlan(): PlanWithCost {
  return {
    selected_intervention_ids: [],
    allocations: [],
    revoked_grant_ids: [],
    cost: { fixed_usd: 0, marginal_usd: 0, total_usd: 0 },
  };
}

function r0List(ctx: Ctx): CoveragePair[] {
  return ctx.pairs.filter((p) => ctx.r0.has(pairKey(p.student_id, p.opportunity_id))).map((p) => ({ ...p }));
}

/** 按定义逐对重算 R1、G、L、N、lost_pairs、revocations、fairness（不依赖搜索时的计数）。 */
function toOutcome(ctx: Ctx, plan: PlanWithCost, floors: FairnessFloor[] | undefined): JointOutcome {
  const byPair = new Map<string, string[]>();
  for (const a of plan.allocations) {
    const k = pairKey(a.student_id, a.opportunity_id);
    byPair.set(k, [...(byPair.get(k) ?? []), a.intervention_id]);
  }
  const X = new Set(plan.revoked_grant_ids);
  const R1: CoveragePair[] = [];
  const lost: CoveragePair[] = [];
  let G = 0;
  let L = 0;
  for (const p of ctx.pairs) {
    const k = pairKey(p.student_id, p.opportunity_id);
    const ids = [...new Set(byPair.get(k) ?? [])].sort(cmpStr);
    const ok = reach(ctx, p.student_id, p.opportunity_id, ids, revokedForPair(ctx, X, p.student_id, p.opportunity_id));
    const was = ctx.r0.has(k);
    if (ok) R1.push({ ...p });
    if (ok && !was) G += 1;
    if (!ok && was) {
      L += 1;
      lost.push({ ...p });
    }
  }
  const selected = [...plan.selected_intervention_ids].sort(cmpStr);
  const revoked = [...plan.revoked_grant_ids].sort(cmpStr);
  const revocations: GrantRevocation[] = revoked.map((id) => {
    const g = ctx.grantById.get(id)!;
    const k = g.intervention_id as string;
    const forcers = selected.filter((i) => ctx.ivs.has(i) && excl(ctx, i, k));
    return { grant_id: id, intervention_id: k, student_id: g.student_id, forced_by: forcers.length ? forcers[0] : null };
  });
  const out: JointOutcome = {
    selected_intervention_ids: selected,
    allocations: plan.allocations.map((a) => ({ ...a })).sort(cmpAlloc),
    revoked_grant_ids: revoked,
    R1,
    G,
    L,
    N: G - L,
    cost: { ...plan.cost },
    lost_pairs: lost,
    revocations,
  };
  if (floors !== undefined) out.fairness = fairnessReports(ctx, floors, R1);
  return out;
}

function candidatePlan(c: Candidate): PlanWithCost {
  return { selected_intervention_ids: c.selected, allocations: c.allocations, revoked_grant_ids: c.revoked, cost: c.cost };
}

interface SoftOptions {
  required?: string[];
  minGain?: number;
  floors?: FairnessFloor[];
}

function verifyOptions(options: SolveOptions, soft: SoftOptions, assumed: string[]): VerifyOptions {
  const v: VerifyOptions = {};
  if (options.mode !== undefined) v.mode = options.mode;
  if (options.loss_cap !== undefined) v.loss_cap = options.loss_cap;
  if (soft.required !== undefined) v.required_intervention_ids = [...soft.required];
  if (soft.minGain !== undefined) v.min_gain = soft.minGain;
  if (soft.floors !== undefined) v.fairness_floors = soft.floors.map((f) => ({ ...f, statuses_any_of: [...f.statuses_any_of] }));
  if (assumed.length > 0) v.assume_approved_intervention_ids = [...assumed];
  return v;
}

function verifyOutcome(ctx: Ctx, outcome: JointOutcome, vopts: VerifyOptions): VerifyResult {
  // 复核选项不含底线时（底线已放松或没给），验证器不比较 plan 自带的 fairness（第 8 条 metrics），原样传入即可。
  const plan: JointPlan = { ...outcome, R0: r0List(ctx) } as JointPlan;
  return verifyPlan(ctx.scenario, plan, vopts);
}

interface RunResult {
  /** UNSUPPORTED_INPUT 只在「内部复核未通过」时出现（输入校验在 solveJoint 入口处理）。 */
  status: JointStatus;
  outcome: JointOutcome;
  verification: VerifyResult | null;
  notes: string[];
  alternative: JointAlternative | null;
}

function approvedSet(ctx: Ctx, assumed: string[]): Set<string> {
  const set = new Set<string>();
  for (const iv of ctx.scenario.interventions) if (isApproved(iv) || assumed.includes(iv.id)) set.add(iv.id);
  return set;
}

/** 内部复核未通过时写进 notes 的定论文字（契约第 6 条）。 */
const INTERNAL_VERIFY_FAILED = 'Internal verification failed; treated as unsupported input. Please check the scenario data.';

function failedCheckNames(v: VerifyResult): string {
  return v.checks.filter((c) => !c.passed).map((c) => c.name).join(', ');
}

interface RunSearchResult {
  complete: boolean;
  /** 可交付的方案（已通过复核）；null = 不可行，或没有复核通过的方案。 */
  outcome: JointOutcome | null;
  verification: VerifyResult | null;
  /** 完整搜索找到了最优方案、但它没有通过独立复核时，为那次失败的复核结果（方案不交付）。 */
  rejected: VerifyResult | null;
}

/**
 * 一次搜索的「可交付」结果：
 * - 完整搜索 → 最优方案（须通过复核；不通过则 outcome = null、rejected = 失败的复核）；best 为 null = 不可行。
 * - 达到上限 → 从最近记录的改进候选（至多 HISTORY_K 个）中按目标顺序（最新 = 最优）依次复核，
 *   返回第一个通过的；都不通过则 outcome = null。
 * 结果里的 fairness 按 options 给出的底线报告（即使本次搜索已放松底线）。
 */
function runSearch(
  ctx: Ctx,
  options: SolveOptions,
  soft: SoftOptions,
  assumed: string[],
  maxNodes: number,
): RunSearchResult {
  const tradeoff = options.mode === 'tradeoff';
  const res = search(ctx, {
    approved: approvedSet(ctx, assumed),
    required: soft.required,
    minGain: soft.minGain,
    floors: soft.floors,
    tradeoff,
    lossCap: tradeoff ? (options.loss_cap as number) : 0,
    maxNodes,
  });
  const vopts = verifyOptions(options, soft, assumed);
  const reportFloors = options.fairness_floors;
  if (res.complete) {
    if (!res.best) return { complete: true, outcome: null, verification: null, rejected: null };
    const outcome = toOutcome(ctx, candidatePlan(res.best), reportFloors);
    const verification = verifyOutcome(ctx, outcome, vopts);
    if (!verification.passed) return { complete: true, outcome: null, verification: null, rejected: verification };
    return { complete: true, outcome, verification, rejected: null };
  }
  for (let k = res.history.length - 1; k >= 0; k--) {
    const outcome = toOutcome(ctx, candidatePlan(res.history[k]), reportFloors);
    const verification = verifyOutcome(ctx, outcome, vopts);
    if (verification.passed) return { complete: false, outcome, verification, rejected: null };
  }
  return { complete: false, outcome: null, verification: null, rejected: null };
}

/**
 * 启用 ids（含前置依赖闭包）造成的损失下界（S2）：强制撤回 X_f 后，R0 中即使把「所有仍可用的措施」都分给它也不可达的对数。
 * 仍可用 = 已批准、适用于该机会、不与 ids 的闭包互斥、不是被撤回的 (措施, 该学生)。选更多措施只会撤回更多，
 * 而 analyzeReachability 对 approved grant 单调，所以任何包含 ids 的方案都至少损失这么多。
 */
function forcedLossLowerBound(ctx: Ctx, closure: readonly string[], approved: ReadonlySet<string>, X: ReadonlySet<string>): number {
  const usable = [...approved].filter((i) => ctx.ivs.has(i) && !closure.some((c) => excl(ctx, c, i))).sort(cmpStr);
  let lost = 0;
  for (const p of ctx.pairs) {
    if (!ctx.r0.has(pairKey(p.student_id, p.opportunity_id))) continue;
    const ids = usable.filter((i) => {
      const oids = ctx.ivs.get(i)!.opportunity_ids;
      if (oids != null && !oids.includes(p.opportunity_id)) return false;
      return ![...X].some((gid) => {
        const g = ctx.grantById.get(gid)!;
        return g.intervention_id === i && g.student_id === p.student_id;
      });
    });
    if (!reach(ctx, p.student_id, p.opportunity_id, ids, revokedForPair(ctx, X, p.student_id, p.opportunity_id))) lost += 1;
  }
  return lost;
}

function describeRequiredFailure(ctx: Ctx, required: string[], assumed: string[], options: SolveOptions): string {
  const protect = options.mode !== 'tradeoff';
  const parts: string[] = [];
  const approved = approvedSet(ctx, assumed);
  const pending = required.filter((id) => !approved.has(id));
  if (pending.length) parts.push(`${pending.map((id) => `"${id}"`).join(', ')} pending approval, so cannot appear in the main result (approved measures only)`);
  const closure = new Set<string>();
  const stack = [...required];
  while (stack.length) {
    const id = stack.pop()!;
    if (closure.has(id)) continue;
    closure.add(id);
    for (const r of ctx.ivs.get(id)?.requires ?? []) stack.push(r);
  }
  const fixed = [...closure].reduce((s, id) => s + (ctx.ivs.get(id)?.fixed_cost_usd ?? 0), 0);
  if (fixed > ctx.scenario.budget_usd + EPS) {
    parts.push(`Total fixed cost (including prerequisites) ${money(fixed)} exceeds the budget of ${money(ctx.scenario.budget_usd)}`);
  }
  const ids = [...closure].sort(cmpStr);
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      if (excl(ctx, ids[a], ids[b])) parts.push(`"${ids[a]}" and "${ids[b]}" are mutually exclusive and cannot both be enabled`);
    }
  }
  for (const id of ids) {
    if (!approved.has(id) && !pending.includes(id)) parts.push(`Prerequisite "${id}" is pending approval`);
  }
  for (const id of ids) {
    const ks = outsiderConflicts(ctx, id);
    if (ks.length) {
      parts.push(
        `"${id}" conflicts with existing commitments from ${ks.map((k) => `"${k}"`).join(', ')} to students outside the scenario. Their loss cannot be evaluated, so it cannot be enabled (in either mode)`,
      );
    }
  }
  if (!protect) {
    const cap = options.loss_cap as number;
    for (const id of [...new Set(required)].sort(cmpStr)) {
      const closure = requiresClosure(ctx, [id]);
      const X = forcedRevocations(ctx, closure);
      if (X.length === 0) continue;
      const lb = forcedLossLowerBound(ctx, closure, approved, new Set(X));
      if (lb > cap + EPS) {
        parts.push(
          `Enabling "${id}" requires revoking ${plural(X.length, 'existing resource')} and loses at least ${lb} previously reachable (student, opportunity) ${pluralNoun(lb, 'pair')}, more than the loss cap of ${cap}`,
        );
      }
    }
  }
  if (protect) {
    for (const id of ids) {
      const ks = [...new Set(ctx.revocable.filter((g) => excl(ctx, id, g.intervention_id as string)).map((g) => g.intervention_id as string))].sort(cmpStr);
      if (ks.length) {
        parts.push(
          `"${id}" is mutually exclusive with ${ks.map((k) => `"${k}"`).join(', ')}, which hold existing commitments. Enabling it would revoke those grants, and protected mode never touches existing commitments (revoking is only allowed in trade-off mode with a loss cap)`,
        );
      }
    }
  }
  return parts.length ? parts.join('; ') : 'cannot be satisfied together under the hard constraints (capacity, budget, mutual exclusion, prerequisites, loss)';
}

const SOFT_ZH: Record<SoftRequirementKey, string> = {
  min_gain: 'minimum new coverage min_gain',
  fairness_floors: 'fairness floors fairness_floors',
  required_intervention_ids: 'required support measures required_intervention_ids',
};

/** K 的全部 m 元子集（K 已按固定优先级排列；按下标字典序生成 = 契约要求的并列顺序）。 */
function subsetsOfSize<T>(K: readonly T[], m: number): T[][] {
  const out: T[][] = [];
  const cur: T[] = [];
  const rec = (start: number) => {
    if (cur.length === m) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < K.length; i++) {
      cur.push(K[i]);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

const toCand = (o: JointOutcome): Candidate => ({
  selected: o.selected_intervention_ids,
  allocations: o.allocations,
  revoked: o.revoked_grant_ids ?? [],
  G: o.G,
  L: o.L,
  N: o.N,
  cost: o.cost,
});

function solveOnce(ctx: Ctx, options: SolveOptions, assumed: string[], maxNodes: number): RunResult {
  const soft: SoftOptions = {
    required: options.required_intervention_ids,
    minGain: options.min_gain,
    floors: options.fairness_floors,
  };
  const main = runSearch(ctx, options, soft, assumed, maxNodes);
  const emptyOutcome = (): JointOutcome => toOutcome(ctx, emptyPlan(), options.fairness_floors);

  // 第 6 条：不得返回「OPTIMAL 但复核不通过」——求解器对自己的最优方案复核不通过时，按不支持的输入处理。
  if (main.rejected) {
    return {
      status: 'UNSUPPORTED_INPUT',
      outcome: emptyOutcome(),
      verification: main.rejected,
      notes: [
        'The plan found by the solver failed independent verification, so it is not shown:',
        `${INTERNAL_VERIFY_FAILED} (failed checks: ${failedCheckNames(main.rejected)})`,
      ],
      alternative: null,
    };
  }

  const lossText = (o: JointOutcome) => {
    const rev = o.revocations ?? [];
    if (rev.length === 0) return '';
    const forced = rev.filter((r) => r.forced_by !== null).length;
    return `Revoked ${plural(rev.length, 'existing grant')} (${forced} forced), affecting ${plural(o.L, 'previously reachable pair')}; `;
  };

  if (main.complete && main.outcome) {
    const o = main.outcome;
    const notes = [
      `Exact search completed and proved optimal: ${o.G} (student, opportunity) ${pluralNoun(o.G, 'pair')} newly reachable, ${o.L} lost, net change ${o.N}; ${lossText(o)}total cost ${money(o.cost.total_usd)} (fixed ${money(o.cost.fixed_usd)} + per student ${money(o.cost.marginal_usd)}), budget ${money(ctx.scenario.budget_usd)}.`,
    ];
    if (options.mode === 'tradeoff') {
      notes.push(
        `Trade-off mode: the organizer set loss cap loss_cap = ${options.loss_cap} (counted in (student, opportunity) pairs)` +
          (o.L > 0 ? `. Losses come from revoking existing grants; this is a simulated result, not real-world impact.` : '. This plan has no losses.'),
      );
    }
    return { status: 'OPTIMAL', outcome: o, verification: main.verification, notes, alternative: null };
  }

  if (!main.complete) {
    if (main.outcome) {
      return {
        status: 'SEARCH_LIMIT_REACHED',
        outcome: main.outcome,
        verification: main.verification,
        notes: [
          `Search limit reached (${maxNodes} nodes); optimality is not proven. This is the best plan found within the limit that passed independent verification. It is not necessarily the global optimum, and a better plan may exist.`,
        ],
        alternative: null,
      };
    }
    const outcome = emptyOutcome();
    return {
      status: 'SEARCH_LIMIT_REACHED',
      outcome,
      verification: verifyOutcome(ctx, outcome, verifyOptions(options, soft, assumed)),
      notes: [
        `Search limit reached (${maxNodes} nodes); optimality is not proven. No plan meeting all requirements was found within the limit. This is a placeholder plan with no measures enabled; it does not mean there is no solution.`,
      ],
      alternative: null,
    };
  }

  // ── INFEASIBLE：按第 6 条的统一规则只放松软要求求 alternative ──
  const K = SOFT_REQUIREMENT_RELAX_ORDER.filter((k) =>
    k === 'min_gain'
      ? options.min_gain !== undefined
      : k === 'fairness_floors'
        ? options.fairness_floors !== undefined
        : options.required_intervention_ids !== undefined,
  );
  const softWithout = (T: readonly SoftRequirementKey[]): SoftOptions => ({
    required: T.includes('required_intervention_ids') ? undefined : options.required_intervention_ids,
    minGain: T.includes('min_gain') ? undefined : options.min_gain,
    floors: T.includes('fairness_floors') ? undefined : options.fairness_floors,
  });
  type Found = { relaxed: SoftRequirementKey[]; outcome: JointOutcome; complete: boolean };
  let found: Found | null = null;
  /** 有候选替代方案没有通过内部复核（已舍弃，不给出）。 */
  let altRejected = false;
  for (let m = 1; m <= K.length && !found; m++) {
    for (const T of subsetsOfSize(K, m)) {
      const r = runSearch(ctx, options, softWithout(T), assumed, maxNodes);
      if (r.rejected) altRejected = true;
      if (!r.outcome) continue;
      if (!found || compareCandidates(toCand(r.outcome), toCand(found.outcome)) < 0) {
        found = { relaxed: T, outcome: r.outcome, complete: r.complete };
      }
    }
  }
  if (!found) found = { relaxed: [...K], outcome: emptyOutcome(), complete: false };

  const reasons: string[] = [];
  if (options.required_intervention_ids !== undefined) {
    reasons.push(`must enable ${options.required_intervention_ids.map((id) => `"${id}"`).join(', ') || '(empty list)'}`);
  }
  if (options.min_gain !== undefined) reasons.push(`new coverage at least ${options.min_gain}`);
  if (options.fairness_floors !== undefined) {
    reasons.push(
      `fairness floors ${options.fairness_floors.map((f) => `"${f.label}" coverage ≥ ${pct(f.min_ratio)}`).join(', ') || '(empty list)'}`,
    );
  }
  const why: string[] = [];
  const alt = found.outcome;
  const floorsGiven = options.fairness_floors ?? [];
  const fairnessBound =
    floorsGiven.length > 0 ? boundsText(ctx, floorsGiven, approvedSet(ctx, assumed), options.mode === 'tradeoff') : '';
  const req = options.required_intervention_ids ?? [];
  if (found.relaxed.includes('required_intervention_ids') && req.length > 0) {
    why.push(`Required support measures: ${describeRequiredFailure(ctx, req, assumed, options)}`);
  }
  if (found.relaxed.includes('min_gain')) {
    const exact = found.complete && found.relaxed.length === 1 && options.mode !== 'tradeoff';
    why.push(
      exact
        ? `under the other requirements at most ${plural(alt.G, 'pair')} can become newly reachable, below the required ${options.min_gain}`
        : `the best relaxed plan makes ${plural(alt.G, 'pair')} newly reachable, below the required ${options.min_gain}`,
    );
  }
  if (found.relaxed.includes('fairness_floors') && (options.fairness_floors ?? []).length > 0) {
    const reps = alt.fairness ?? [];
    const detail = (options.fairness_floors ?? [])
      .map((f, k) => {
        const rep = reps[k];
        if (!rep) return `"${f.label}"`;
        return rep.ratio === null
          ? `"${f.label}" not applicable (no eligible members)`
          : `"${f.label}" covers ${rep.covered_members}/${rep.eligible_members} (required ≥ ${pct(f.min_ratio)})`;
      })
      .join(', ');
    why.push(
      `fairness floors cannot be met under the hard constraints and other requirements (in the alternative: ${detail}; for reference, ` +
        `the most members of each group that the enabled measures could cover (upper bound ignoring capacity and budget): ${fairnessBound})`,
    );
  }
  const relaxedZh = found.relaxed.map((k) => SOFT_ZH[k]).join(', ');
  const altNote =
    `The original requirements (${reasons.join('; ')}) cannot all be met under the hard constraints${why.length ? ': ' + why.join('; ') : ''}. ` +
    `The alternative relaxes: ${relaxedZh} (each dropped entirely). Hard constraints (approval, mutual exclusion, prerequisites, capacity, budget, loss, revocation) are not relaxed: ` +
    `${plural(alt.G, 'pair')} newly reachable, ${alt.L} lost, total cost ${money(alt.cost.total_usd)}. ` +
    (found.complete ? '' : 'The search for the alternative hit its limit; optimality is not proven. ') +
    (altRejected
      ? `${INTERNAL_VERIFY_FAILED.replace('treated as unsupported input.', 'a candidate alternative was discarded and not shown.')} ` +
        (alt.selected_intervention_ids.length === 0 ? 'The current alternative is a placeholder plan with no measures enabled. ' : '')
      : '') +
    'This is not the main result. Results are simulated.';
  const alternative: JointAlternative = { ...alt, relaxed: found.relaxed, note: altNote };
  return {
    status: 'INFEASIBLE',
    outcome: emptyOutcome(),
    verification: null,
    notes: [
      `No solution (INFEASIBLE): no plan satisfies all hard constraints and the organizer's requirements (${reasons.join('; ')}). The main result is an empty plan with no measures enabled. Requirements were not silently lowered; see alternative for a relaxed plan.`,
      ...(fairnessBound
        ? [`Fairness floor reference: the most members of each group that the enabled measures could cover (upper bound ignoring capacity and budget): ${fairnessBound}.`]
        : []),
    ],
    alternative,
  };
}

// ───────────────────────────── 入口 ─────────────────────────────

/** UNSUPPORTED_INPUT 的空方案（不做评估，R0 = R1 = []，不带 fairness）。 */
function unsupportedResult(notes: string[], verification: VerifyResult | null): JointResult {
  return {
    status: 'UNSUPPORTED_INPUT',
    selected_intervention_ids: [],
    allocations: [],
    revoked_grant_ids: [],
    cost: { fixed_usd: 0, marginal_usd: 0, total_usd: 0 },
    R0: [],
    R1: [],
    G: 0,
    L: 0,
    N: 0,
    lost_pairs: [],
    revocations: [],
    notes,
    alternative: null,
    conditional: null,
    verification,
  };
}

export function solveJoint(scenario: Scenario, rawOptions: SolveOptions = {}): JointResult {
  const reasons = validateJointInput(scenario, rawOptions);
  if (reasons.length > 0) {
    return unsupportedResult(['Invalid input or outside what the solver supports; not evaluated:', ...reasons], null);
  }

  const options = normalizeOptions(rawOptions);
  const ctx = makeCtx(scenario);
  const maxNodes = options.max_search_nodes ?? DEFAULT_MAX_SEARCH_NODES;
  const main = solveOnce(ctx, options, [], maxNodes);

  if (main.status === 'UNSUPPORTED_INPUT') {
    // 内部复核未通过：返回空方案（与输入不合法时同形），verification 保留那次失败的复核结果。
    return unsupportedResult(main.notes, main.verification);
  }

  const pendingIds = scenario.interventions.filter((iv) => !isApproved(iv)).map((iv) => iv.id).sort(cmpStr);
  let conditional: JointConditional | null = null;
  if (pendingIds.length > 0) {
    const c = solveOnce(ctx, options, pendingIds, maxNodes);
    const names = pendingIds.map((id) => `"${ctx.ivs.get(id)!.title}"`).join(', ');
    let what: string;
    if (c.status === 'UNSUPPORTED_INPUT') what = '';
    else if (c.status === 'INFEASIBLE') what = 'the organizer\'s requirements still cannot be met (the result is an empty plan)';
    else {
      what = `${c.outcome.G} (student, opportunity) ${pluralNoun(c.outcome.G, 'pair')} newly reachable, ${c.outcome.L} lost, total cost ${money(c.outcome.cost.total_usd)}`;
      if (c.outcome.N === main.outcome.N && main.status !== 'INFEASIBLE') what += ' (same net change as the main result, which has approved measures only)';
      if (c.status === 'SEARCH_LIMIT_REACHED') what += ' (search limit reached; optimality not proven)';
    }
    const outcome: JointOutcome =
      c.status === 'UNSUPPORTED_INPUT'
        ? { ...toOutcome(ctx, emptyPlan(), undefined), lost_pairs: [], revocations: [] }
        : c.outcome;
    conditional = {
      ...outcome,
      status: c.status,
      assumed_approved_intervention_ids: pendingIds,
      note:
        c.status === 'UNSUPPORTED_INPUT'
          ? `Assuming these measures are approved (${names}): ${INTERNAL_VERIFY_FAILED} No conditional plan is given (this is a placeholder with no measures enabled). Not in effect yet; results are simulated.`
          : `If these measures are approved (${names}): ${what}. Not in effect yet; results are simulated.`,
    };
  }

  const notes = [...main.notes];
  if (pendingIds.length > 0) notes.push(`${plural(pendingIds.length, 'support measure')} ${pluralNoun(pendingIds.length, 'is', 'are')} pending approval and ${pluralNoun(pendingIds.length, 'is', 'are')} not counted in the main result; see conditional for the outcome if approved (not in effect yet).`);
  notes.push(TIE_NOTE);
  notes.push(SIM_NOTE);

  return {
    status: main.status,
    ...main.outcome,
    R0: r0List(ctx),
    notes,
    alternative: main.alternative,
    conditional,
    verification: main.verification,
  };
}
