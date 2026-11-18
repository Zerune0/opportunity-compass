/**
 * solveJoint(scenario, options?) — 主办方 what-if 联合求解（精确搜索）。
 * 规范：CONTRACT.md「联合求解模型」第 0–7 条（本文件逐条实现）。所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 *
 * 流程：
 * 1. 输入校验（第 6 条 UNSUPPORTED_INPUT 的全部条件）→ 命中则返回空方案，不做评估。
 * 2. R0 = 只带 existing_grants 时可达的（学生, 机会）对。
 * 3. 精确搜索（见下）→ OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED；INFEASIBLE 时再算 alternative
 *    （只放松软要求，并明示）；场景里有 pending 措施时，把全部 pending 当作已批准再求解一次得到 conditional。
 * 4. 对返回的方案调用 ./verify 的 verifyPlan 独立复核（verifyPlan 不依赖本文件，依赖方向只能是 solve → verify）。
 *    完整搜索得到的最优方案复核不通过时，不返回 OPTIMAL：主结果改为 UNSUPPORTED_INPUT + 空方案
 *    （notes 写「内部复核未通过……」，verification 保留失败的复核）；conditional / alternative 同理不给出该方案。
 *
 * 搜索算法：
 * - 可达性只通过 analyzeReachability(student, opp, grants, { today: evaluation_date }).reachable === true 判断，
 *   措施只通过合成 grant 起作用，不修改学生档案或机会数据。结果按（学生, 机会, 分到该对的措施集合）缓存。
 * - 合成 grant 的 student_id / opportunity_id 都是具体的，所以一个对是否可达只取决于 existing_grants 与
 *   「分到这个对的措施集合」，各对之间只通过容量、成本（同一 (措施, 学生) 只计一次）和预算相互影响。
 * - 预处理：对每个不在 R0 中的对，枚举（对该机会适用的）候选措施子集，找出所有「最小可达集合」
 *   （该集合使对可达，且任何真子集都不行）。最优方案中每个新增可达的对一定只分到一个最小可达集合：
 *   多余的分配不增加 N，只会让成本 / 分配条数不减，按目标第 2、3 条不会更优；给 R0 中的对或没变可达的对
 *   分配资源同理无益（也就不做无效分配）。
 * - 外层：按 id 升序枚举已批准措施的全部子集（位掩码 0…2^k−1），过滤互斥、前置依赖、必须启用（软要求）
 *   与固定成本超预算的组合。
 * - 内层：按 (student_id, opportunity_id) 升序对候选对做深度优先搜索，每个对的选项 = 该组合内的最小可达集合
 *   （按大小、再按 id 字典序）或「不分配」；边走边检查容量（按不同学生、按 capacity_scope / 时段）与预算。
 *   剪枝：当前 G + 剩余候选对数 < 已知最好 N，或相等但成本 / 分配条数已更差，则剪掉。
 *   叶子处检查 min_gain，并按目标（N 大 → 成本小 → 分配条数少 → 选中措施数少 → 字典序小）与已知最好方案比较。
 *   「选中措施数少」一步保证：每个选中措施要么有分配，要么在 required_intervention_ids 里，要么是这两类措施的
 *   （传递）前置依赖——否则去掉它得到的方案不劣且措施数更少。
 * - 方案中 R0 里的对不分到任何资源，所以 L = 0；R1、G、L、N 最后仍按定义重新逐对计算。
 *
 * 节点（max_search_nodes 计数单位），每发生一次以下事件计 1 个节点：
 *   (a) 预处理中访问一个（对, 措施子集）；(b) 外层访问一个措施组合（无论是否被过滤）；(c) 内层进入一个搜索状态。
 *   缺省上限 DEFAULT_MAX_SEARCH_NODES = 200000。主搜索、conditional 的搜索、alternative 的每一次放松尝试各自单独计数。
 *   达到上限即停止，返回 SEARCH_LIMIT_REACHED（不声称最优，也不等于无解）：从搜索中最近 HISTORY_K（= 8）次
 *   刷新最好方案时记录的候选里，按目标顺序（最新 = 最优）依次独立复核，返回第一个通过的；都不通过返回空方案。
 *   已批准措施超过 30 项（位掩码上限）时直接按达到上限处理。
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入对象。
 * 公平性：不读取学生的学校名、显示名。
 */
import { analyzeReachability } from '../reachability';
import { parseISODate } from '../eligibility/dates';
import { verifyPlan } from './verify';
import type {
  Allocation,
  CoveragePair,
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
  SolveOptions,
  StudentProfile,
  Opportunity,
  VerifyOptions,
  VerifyResult,
} from '../types';

/** max_search_nodes 的缺省值。 */
export const DEFAULT_MAX_SEARCH_NODES = 200_000;

const EPS = 1e-6;
const TIE_NOTE = '名额并列时按学生编号顺序分配（模拟），不代表谁更需要。';
const SIM_NOTE = '以上为模拟结果，基于示例数据，不代表真实影响；可达只表示资格不冲突、现实条件走得通，不等于录取。';

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const money = (x: number): string => `$${Math.round(x * 100) / 100}`;

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
const isApproved = (iv: Intervention) => iv.status !== 'pending';
const finiteNonNeg = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0;

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
 * existing grants 对措施 iv 的容量占用：范围键 → 学生 id 集合。
 * total：唯一范围键 'T'；per_time_slot：每个时段键（opportunity_id 为 null 的 grant 计入每个时段）。
 */
function existingOccupancy(scenario: Scenario, iv: Intervention): Map<string, Set<string>> {
  const occ = new Map<string, Set<string>>();
  const perSlot = iv.capacity_scope === 'per_time_slot';
  const keys = perSlot ? allSlotKeys(scenario) : ['T'];
  for (const k of keys) occ.set(k, new Set());
  for (const g of scenario.existing_grants ?? []) {
    if (g.intervention_id !== iv.id) continue;
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

/**
 * 返回 UNSUPPORTED_INPUT 的原因（空数组 = 输入合法）。规则见 CONTRACT.md「联合求解模型」第 6 条。
 * 验证器（./verify 的 input_validity）按同一套规则各自实现（不共用代码，保持独立）。
 */
export function validateJointInput(scenario: Scenario, rawOptions: SolveOptions = {}): string[] {
  const reasons: string[] = [];
  if (!isPlainObject(scenario)) return ['scenario 不是对象。'];
  const options = (isPlainObject(rawOptions) ? rawOptions : {}) as SolveOptions;

  // ── 形状（不合法时后续检查无法安全进行，直接返回） ──
  for (const key of ['students', 'opportunities', 'interventions'] as const) {
    if (!Array.isArray(scenario[key])) reasons.push(`${key} 不是数组。`);
  }
  if (scenario.existing_grants != null && !Array.isArray(scenario.existing_grants)) reasons.push('existing_grants 不是数组。');
  if (scenario.opportunity_time_slots != null && !isPlainObject(scenario.opportunity_time_slots)) {
    reasons.push('opportunity_time_slots 不是对象（机会 id → 时段标签）。');
  }
  if (reasons.length) return reasons;
  for (const key of ['students', 'opportunities', 'interventions'] as const) {
    const bad = (scenario[key] as unknown[]).filter((e) => !isPlainObject(e) || typeof e.id !== 'string').length;
    if (bad) reasons.push(`${key} 中有 ${bad} 个条目不是带字符串 id 的对象。`);
  }
  const badGrants = (scenario.existing_grants ?? []).filter((g) => !isPlainObject(g)).length;
  if (badGrants) reasons.push(`existing_grants 中有 ${badGrants} 个条目不是对象。`);
  if (reasons.length) return reasons;

  // ── 预算与选项 ──
  if (!finiteNonNeg(scenario.budget_usd)) reasons.push(`预算 budget_usd 必须是非负有限数（当前为 ${String(scenario.budget_usd)}）。`);
  if (options.mode != null && options.mode !== 'protect' && options.mode !== 'tradeoff') {
    reasons.push(`mode 只能是 protect 或 tradeoff（当前为 ${String(options.mode)}）。`);
  }
  if (options.mode === 'tradeoff' && options.loss_cap == null) reasons.push('tradeoff 模式必须给出 loss_cap。');
  if (!optFiniteNonNeg(options.loss_cap)) reasons.push('loss_cap 必须是非负有限数。');
  if (!optFiniteNonNeg(options.min_gain)) reasons.push('min_gain 必须是非负有限数。');
  if (
    options.max_search_nodes != null &&
    !(Number.isInteger(options.max_search_nodes) && options.max_search_nodes > 0)
  ) {
    reasons.push('max_search_nodes 必须是正整数。');
  }

  const sDup = findDuplicates(scenario.students.map((s) => s.id));
  if (sDup.length) reasons.push(`学生 id 重复：${sDup.join('、')}。`);
  const oDup = findDuplicates(scenario.opportunities.map((o) => o.id));
  if (oDup.length) reasons.push(`机会 id 重复：${oDup.join('、')}。`);
  const iDup = findDuplicates(scenario.interventions.map((i) => i.id));
  if (iDup.length) reasons.push(`措施 id 重复：${iDup.join('、')}。`);

  const ivIds = new Set(scenario.interventions.map((i) => i.id));
  const oppIds = new Set(scenario.opportunities.map((o) => o.id));
  if (options.required_intervention_ids != null) {
    if (!Array.isArray(options.required_intervention_ids)) reasons.push('required_intervention_ids 不是数组。');
    else {
      for (const id of options.required_intervention_ids) {
        if (!ivIds.has(id)) reasons.push(`required_intervention_ids 引用了不存在的措施「${String(id)}」。`);
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
        reasons.push(`措施「${iv.id}」的 ${field} 不是数组。`);
        continue;
      }
      for (const r of refs) {
        if (r === iv.id) reasons.push(`措施「${iv.id}」的 ${field} 引用了自己。`);
        else if (!ivIds.has(r)) reasons.push(`措施「${iv.id}」的 ${field} 引用了不存在的措施「${String(r)}」。`);
      }
    }
    if (iv.opportunity_ids != null) {
      if (!Array.isArray(iv.opportunity_ids)) reasons.push(`措施「${iv.id}」的 opportunity_ids 不是数组。`);
      else {
        for (const o of iv.opportunity_ids) {
          if (!oppIds.has(o)) reasons.push(`措施「${iv.id}」的 opportunity_ids 引用了不存在的机会「${String(o)}」。`);
        }
      }
    }
    if (!optFiniteNonNeg(iv.capacity)) reasons.push(`措施「${iv.id}」的 capacity 必须是非负有限数或 null。`);
    if (!finiteNonNeg(iv.unit_cost_usd)) reasons.push(`措施「${iv.id}」的 unit_cost_usd 必须是非负有限数。`);
    if (iv.fixed_cost_usd !== undefined && !finiteNonNeg(iv.fixed_cost_usd)) {
      reasons.push(`措施「${iv.id}」的 fixed_cost_usd 必须是非负有限数。`);
    }
    if (!optFiniteNonNeg(iv.amount_usd)) reasons.push(`措施「${iv.id}」的 amount_usd 必须是非负有限数或 null。`);
    if (!optFiniteNonNeg(iv.hours_per_week)) reasons.push(`措施「${iv.id}」的 hours_per_week 必须是非负有限数或 null。`);
  }
  for (const g of scenario.existing_grants ?? []) {
    if (!optFiniteNonNeg(g.amount_usd)) reasons.push(`已有 grant「${String(g.id)}」的 amount_usd 必须是非负有限数或 null。`);
    if (!optFiniteNonNeg(g.hours_per_week)) reasons.push(`已有 grant「${String(g.id)}」的 hours_per_week 必须是非负有限数或 null。`);
  }
  for (const [key, label] of Object.entries(scenario.opportunity_time_slots ?? {})) {
    if (!oppIds.has(key)) reasons.push(`opportunity_time_slots 的键引用了不存在的机会「${key}」。`);
    if (typeof label !== 'string' || label === '') {
      reasons.push(`opportunity_time_slots 中机会「${key}」的时段标签必须是非空字符串（当前为 ${JSON.stringify(label)}）。`);
    }
  }
  const ed = scenario.evaluation_date;
  if (typeof ed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ed) || parseISODate(ed) == null) {
    reasons.push(`evaluation_date 不是合法的 YYYY-MM-DD（当前为 ${JSON.stringify(ed)}）。`);
  }
  // 只算 existing grant 就超容量（容量本身不合法时上面已报，这里跳过）。
  for (const iv of scenario.interventions) {
    if (iv.capacity == null || !finiteNonNeg(iv.capacity)) continue;
    for (const [k, set] of existingOccupancy(scenario, iv)) {
      if (set.size > iv.capacity + EPS) {
        const scope = k === 'T' ? '整个场景' : k === DEFAULT_SLOT ? '默认时段' : `时段「${k.slice(2)}」`;
        reasons.push(`措施「${iv.id}」在${scope}内仅已有 grant 就占用 ${set.size} 个名额，超过容量 ${iv.capacity}。`);
      }
    }
  }
  return reasons;
}

/** 输入合法后，把 options 中为 null 的字段去掉（null 视同未给）。 */
function normalizeOptions(raw: SolveOptions | undefined): SolveOptions {
  const o: SolveOptions = {};
  if (!raw) return o;
  if (raw.mode != null) o.mode = raw.mode;
  if (raw.loss_cap != null) o.loss_cap = raw.loss_cap;
  if (raw.max_search_nodes != null) o.max_search_nodes = raw.max_search_nodes;
  if (raw.required_intervention_ids != null) o.required_intervention_ids = [...raw.required_intervention_ids];
  if (raw.min_gain != null) o.min_gain = raw.min_gain;
  return o;
}

// ───────────────────────────── 评估上下文 ─────────────────────────────

interface Ctx {
  scenario: Scenario;
  students: Map<string, StudentProfile>;
  opps: Map<string, Opportunity>;
  ivs: Map<string, Intervention>;
  existing: ResourceGrant[];
  /** (intervention_id, student_id) 已有 approved 的 existing grant → 成本记 0（pending 的只占容量、不免成本）。 */
  exempt: Set<string>;
  cache: Map<string, boolean>;
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

/** reach(pair, E ∪ 分到该对的合成 grant)；ivIds 已升序。只有该对自己的合成 grant 会影响它的可达性。 */
function reach(ctx: Ctx, s: string, o: string, ivIds: readonly string[]): boolean {
  const key = JSON.stringify([s, o, ivIds]);
  const hit = ctx.cache.get(key);
  if (hit !== undefined) return hit;
  const grants = [...ctx.existing, ...ivIds.map((i) => synthGrant(ctx, i, s, o))];
  const r = analyzeReachability(ctx.students.get(s)!, ctx.opps.get(o)!, grants, {
    today: ctx.scenario.evaluation_date,
  });
  const ok = r.reachable === true;
  ctx.cache.set(key, ok);
  return ok;
}

function makeCtx(scenario: Scenario): Ctx {
  const existing = scenario.existing_grants ?? [];
  const exempt = new Set<string>();
  for (const g of existing) {
    if (g.intervention_id != null && g.status === 'approved') exempt.add(JSON.stringify([g.intervention_id, g.student_id]));
  }
  const pairs: CoveragePair[] = [];
  for (const s of scenario.students) for (const o of scenario.opportunities) pairs.push({ student_id: s.id, opportunity_id: o.id });
  pairs.sort(cmpPair);
  const ctx: Ctx = {
    scenario,
    students: new Map(scenario.students.map((s) => [s.id, s])),
    opps: new Map(scenario.opportunities.map((o) => [o.id, o])),
    ivs: new Map(scenario.interventions.map((i) => [i.id, i])),
    existing,
    exempt,
    cache: new Map(),
    pairs,
    r0: new Set(),
  };
  for (const p of pairs) if (reach(ctx, p.student_id, p.opportunity_id, [])) ctx.r0.add(pairKey(p.student_id, p.opportunity_id));
  return ctx;
}

// ───────────────────────────── 方案构造与比较 ─────────────────────────────

interface Candidate {
  selected: string[];
  /** 已排序、已记成本的 Allocation。 */
  allocations: Allocation[];
  G: number;
  N: number;
  cost: JointCost;
}

/** 由选中措施与「对 → 措施集合」构造带成本的方案（成本按第 3 条第 6 款）。 */
function buildCandidate(ctx: Ctx, selected: string[], assign: { s: string; o: string; ivs: readonly string[] }[], G: number): Candidate {
  const allocations: Allocation[] = [];
  for (const a of assign) for (const i of a.ivs) allocations.push({ intervention_id: i, student_id: a.s, opportunity_id: a.o, cost_usd: 0 });
  allocations.sort(cmpAlloc);
  const charged = new Set<string>();
  let marginal = 0;
  for (const al of allocations) {
    const k = JSON.stringify([al.intervention_id, al.student_id]);
    if (ctx.exempt.has(k) || charged.has(k)) continue;
    charged.add(k);
    al.cost_usd = ctx.ivs.get(al.intervention_id)!.unit_cost_usd;
    marginal += al.cost_usd;
  }
  const fixed = selected.reduce((sum, i) => sum + (ctx.ivs.get(i)!.fixed_cost_usd ?? 0), 0);
  return {
    selected: [...selected].sort(cmpStr),
    allocations,
    G,
    N: G,
    cost: { fixed_usd: fixed, marginal_usd: marginal, total_usd: fixed + marginal },
  };
}

/** a 比 b 更优 → 负数（第 5 条：N 大 → 总成本小 → 分配条数少 → 选中措施数少 → 字典序小）。 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (a.N !== b.N) return b.N - a.N;
  if (Math.abs(a.cost.total_usd - b.cost.total_usd) > EPS) return a.cost.total_usd - b.cost.total_usd;
  if (a.allocations.length !== b.allocations.length) return a.allocations.length - b.allocations.length;
  if (a.selected.length !== b.selected.length) return a.selected.length - b.selected.length;
  const c = cmpStrArrays(a.selected, b.selected);
  if (c !== 0) return c;
  const n = Math.min(a.allocations.length, b.allocations.length);
  for (let k = 0; k < n; k++) {
    const d = cmpAlloc(a.allocations[k], b.allocations[k]);
    if (d !== 0) return d;
  }
  return a.allocations.length - b.allocations.length;
}

// ───────────────────────────── 精确搜索 ─────────────────────────────

interface SearchParams {
  /** 视为已批准的措施（不含未假设的 pending）。 */
  approved: Set<string>;
  required?: string[];
  minGain?: number;
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

  const U = scenario.interventions.filter((iv) => params.approved.has(iv.id)).map((iv) => iv.id).sort(cmpStr);
  const idx = new Map(U.map((id, k) => [id, k]));

  // 互斥（对称）与前置依赖的位掩码。
  const mutex: number[] = U.map(() => 0);
  const reqMask: number[] = U.map(() => 0);
  let blockedMask = 0; // requires 了未批准措施的措施永远不能选
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
  });
  let requiredMask = 0;
  let requiredImpossible = false;
  for (const r of params.required ?? []) {
    const j = idx.get(r);
    if (j === undefined) requiredImpossible = true;
    else requiredMask |= 1 << j;
  }

  try {
    // 位掩码最多支持 30 项已批准措施；更多时组合数远超任何合理的节点上限，直接按达到上限处理。
    if (U.length > 30) throw new NodeLimit();
    // ── 预处理：每个候选对的最小可达集合（以 U 的位掩码表示） ──
    interface PairInfo { s: string; o: string; minimal: number[] }
    const infos: PairInfo[] = [];
    for (const p of ctx.pairs) {
      if (ctx.r0.has(pairKey(p.student_id, p.opportunity_id))) continue;
      const applicable = U.filter((id) => {
        const ids = ctx.ivs.get(id)!.opportunity_ids;
        return ids == null || ids.includes(p.opportunity_id);
      });
      const minimal: number[] = [];
      // 按大小递增枚举组合；跳过已知最小集合的超集。
      const n = applicable.length;
      const combo: number[] = [];
      const visit = (start: number, size: number) => {
        if (combo.length === size) {
          tick();
          let mask = 0;
          for (const c of combo) mask |= 1 << idx.get(applicable[c])!;
          if (minimal.some((m) => (m & mask) === m)) return;
          const ids = combo.map((c) => applicable[c]); // applicable 已升序
          if (reach(ctx, p.student_id, p.opportunity_id, ids)) minimal.push(mask);
          return;
        }
        for (let c = start; c < n; c++) {
          combo.push(c);
          visit(c + 1, size);
          combo.pop();
        }
      };
      for (let size = 1; size <= n; size++) visit(0, size);
      if (minimal.length > 0) infos.push({ s: p.student_id, o: p.opportunity_id, minimal });
    }

    const maskIds = (mask: number) => U.filter((_, k) => mask & (1 << k));
    const popcount = (m: number) => {
      let c = 0;
      while (m) {
        m &= m - 1;
        c++;
      }
      return c;
    };

    if (requiredImpossible) return { complete: true, best: null, nodes, history };

    // ── 外层：措施组合 ──
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

      // 该组合下的候选对与选项（最小集合 ⊆ T，按大小再按 id 字典序）。
      const pairs = infos
        .map((info) => ({
          s: info.s,
          o: info.o,
          options: info.minimal
            .filter((m) => (m & T) === m)
            .map((m) => ({ mask: m, ids: maskIds(m) }))
            .sort((a, b) => popcount(a.mask) - popcount(b.mask) || cmpStrArrays(a.ids, b.ids)),
        }))
        .filter((p) => p.options.length > 0);

      const ub0 = pairs.length;
      if (best) {
        if (ub0 < best.N) continue;
        if (ub0 === best.N && fixed > best.cost.total_usd + EPS) continue;
      }
      if (params.minGain !== undefined && ub0 + EPS < params.minGain) continue;

      // 容量状态：措施 → 范围键 → 学生 → 引用计数（existing 占用记为永久）。
      const occ = new Map<string, Map<string, Map<string, number>>>();
      for (const id of selected) {
        const iv = ctx.ivs.get(id)!;
        if (iv.capacity == null) continue;
        const m = new Map<string, Map<string, number>>();
        for (const [k, set] of existingOccupancy(scenario, iv)) {
          m.set(k, new Map([...set].map((s) => [s, Number.POSITIVE_INFINITY])));
        }
        occ.set(id, m);
      }
      const charged = new Map<string, number>();
      let marginal = 0;
      let allocCount = 0;
      let G = 0;
      const chosen: ({ s: string; o: string; ivs: string[] } | null)[] = [];

      const scopeKey = (iv: Intervention, o: string) =>
        iv.capacity_scope === 'per_time_slot' ? slotKeyOf(scenario, o) : 'T';

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
          const ck = JSON.stringify([id, s]);
          const c = charged.get(ck) ?? 0;
          if (c === 0 && !ctx.exempt.has(ck)) {
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

      const dfs = (k: number) => {
        tick();
        if (best) {
          const ub = G + (pairs.length - k);
          if (ub < best.N) return;
          if (ub === best.N) {
            const cost = fixed + marginal;
            if (cost > best.cost.total_usd + EPS) return;
            if (Math.abs(cost - best.cost.total_usd) <= EPS && allocCount > best.allocations.length) return;
          }
        }
        if (params.minGain !== undefined && G + (pairs.length - k) + EPS < params.minGain) return;
        if (k === pairs.length) {
          const assign = chosen.filter((c): c is { s: string; o: string; ivs: string[] } => c !== null);
          const cand = buildCandidate(ctx, selected, assign, G);
          if (!best || compareCandidates(cand, best) < 0) {
            best = cand;
            history.push(cand);
            if (history.length > HISTORY_K) history.shift();
          }
          return;
        }
        const p = pairs[k];
        for (const opt of p.options) {
          const undo = apply(p.s, p.o, opt.ids);
          if (!undo) continue;
          G += 1;
          allocCount += opt.ids.length;
          chosen.push({ s: p.s, o: p.o, ivs: opt.ids });
          dfs(k + 1);
          chosen.pop();
          allocCount -= opt.ids.length;
          G -= 1;
          undo();
        }
        chosen.push(null);
        dfs(k + 1);
        chosen.pop();
      };
      dfs(0);
    }
    return { complete: true, best, nodes, history };
  } catch (e) {
    if (e instanceof NodeLimit) return { complete: false, best, nodes, history };
    throw e;
  }
}

// ───────────────────────────── 结果组装 ─────────────────────────────

function emptyPlan(): JointPlan & { cost: JointCost } {
  return { selected_intervention_ids: [], allocations: [], cost: { fixed_usd: 0, marginal_usd: 0, total_usd: 0 } };
}

function r0List(ctx: Ctx): CoveragePair[] {
  return ctx.pairs.filter((p) => ctx.r0.has(pairKey(p.student_id, p.opportunity_id))).map((p) => ({ ...p }));
}

/** 按定义逐对重算 R1、G、L、N（不依赖搜索时的计数）。 */
function toOutcome(ctx: Ctx, plan: JointPlan & { cost: JointCost }): JointOutcome {
  const byPair = new Map<string, string[]>();
  for (const a of plan.allocations) {
    const k = pairKey(a.student_id, a.opportunity_id);
    byPair.set(k, [...(byPair.get(k) ?? []), a.intervention_id]);
  }
  const R1: CoveragePair[] = [];
  let G = 0;
  let L = 0;
  for (const p of ctx.pairs) {
    const k = pairKey(p.student_id, p.opportunity_id);
    const ids = [...new Set(byPair.get(k) ?? [])].sort(cmpStr);
    const ok = reach(ctx, p.student_id, p.opportunity_id, ids);
    const was = ctx.r0.has(k);
    if (ok) R1.push({ ...p });
    if (ok && !was) G += 1;
    if (!ok && was) L += 1;
  }
  return {
    selected_intervention_ids: [...plan.selected_intervention_ids].sort(cmpStr),
    allocations: plan.allocations.map((a) => ({ ...a })).sort(cmpAlloc),
    R1,
    G,
    L,
    N: G - L,
    cost: { ...plan.cost },
  };
}

function candidatePlan(c: Candidate): JointPlan & { cost: JointCost } {
  return { selected_intervention_ids: c.selected, allocations: c.allocations, cost: c.cost };
}

interface SoftOptions {
  required?: string[];
  minGain?: number;
}

function verifyOptions(options: SolveOptions, soft: SoftOptions, assumed: string[]): VerifyOptions {
  const v: VerifyOptions = {};
  if (options.mode !== undefined) v.mode = options.mode;
  if (options.loss_cap !== undefined) v.loss_cap = options.loss_cap;
  if (soft.required !== undefined) v.required_intervention_ids = [...soft.required];
  if (soft.minGain !== undefined) v.min_gain = soft.minGain;
  if (assumed.length > 0) v.assume_approved_intervention_ids = [...assumed];
  return v;
}

function verifyOutcome(ctx: Ctx, outcome: JointOutcome, vopts: VerifyOptions): VerifyResult {
  return verifyPlan(ctx.scenario, { ...outcome, R0: r0List(ctx) } as JointPlan, vopts);
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
const INTERNAL_VERIFY_FAILED = '内部复核未通过，按不支持的输入处理，请检查场景数据。';

function failedCheckNames(v: VerifyResult): string {
  return v.checks.filter((c) => !c.passed).map((c) => c.name).join('、');
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
 */
function runSearch(
  ctx: Ctx,
  options: SolveOptions,
  soft: SoftOptions,
  assumed: string[],
  maxNodes: number,
): RunSearchResult {
  const res = search(ctx, { approved: approvedSet(ctx, assumed), required: soft.required, minGain: soft.minGain, maxNodes });
  const vopts = verifyOptions(options, soft, assumed);
  if (res.complete) {
    if (!res.best) return { complete: true, outcome: null, verification: null, rejected: null };
    const outcome = toOutcome(ctx, candidatePlan(res.best));
    const verification = verifyOutcome(ctx, outcome, vopts);
    if (!verification.passed) return { complete: true, outcome: null, verification: null, rejected: verification };
    return { complete: true, outcome, verification, rejected: null };
  }
  for (let k = res.history.length - 1; k >= 0; k--) {
    const outcome = toOutcome(ctx, candidatePlan(res.history[k]));
    const verification = verifyOutcome(ctx, outcome, vopts);
    if (verification.passed) return { complete: false, outcome, verification, rejected: null };
  }
  return { complete: false, outcome: null, verification: null, rejected: null };
}

function describeRequiredFailure(ctx: Ctx, required: string[], assumed: string[]): string {
  const parts: string[] = [];
  const approved = approvedSet(ctx, assumed);
  const pending = required.filter((id) => !approved.has(id));
  if (pending.length) parts.push(`${pending.map((id) => `「${id}」`).join('、')}尚待审批，不能出现在主结果（仅含已批准措施）里`);
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
    parts.push(`固定成本合计（含前置依赖） ${money(fixed)}，超过预算 ${money(ctx.scenario.budget_usd)}`);
  }
  const ids = [...closure].sort(cmpStr);
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      const A = ctx.ivs.get(ids[a]);
      const B = ctx.ivs.get(ids[b]);
      if (A?.mutually_exclusive_with?.includes(ids[b]) || B?.mutually_exclusive_with?.includes(ids[a])) {
        parts.push(`「${ids[a]}」与「${ids[b]}」互斥，不能同时启用`);
      }
    }
  }
  for (const id of ids) {
    if (!approved.has(id) && !pending.includes(id)) parts.push(`前置依赖「${id}」尚待审批`);
  }
  return parts.length ? parts.join('；') : '在硬约束（容量、预算、互斥、前置依赖）下无法同时满足';
}

function solveOnce(ctx: Ctx, options: SolveOptions, assumed: string[], maxNodes: number): RunResult {
  const soft: SoftOptions = { required: options.required_intervention_ids, minGain: options.min_gain };
  const main = runSearch(ctx, options, soft, assumed, maxNodes);
  const emptyOutcome = (): JointOutcome => toOutcome(ctx, emptyPlan());

  // 第 6 条：不得返回「OPTIMAL 但复核不通过」——求解器对自己的最优方案复核不通过时，按不支持的输入处理。
  if (main.rejected) {
    return {
      status: 'UNSUPPORTED_INPUT',
      outcome: emptyOutcome(),
      verification: main.rejected,
      notes: [
        '求解器找到的方案没有通过独立复核，未给出该方案：',
        `${INTERNAL_VERIFY_FAILED}（未通过的检查：${failedCheckNames(main.rejected)}）`,
      ],
      alternative: null,
    };
  }

  if (main.complete && main.outcome) {
    const notes = [
      `已完成精确搜索并证明最优：新增可达 ${main.outcome.G} 个（学生, 机会）对，损失 ${main.outcome.L} 个，净值 ${main.outcome.N}；总成本 ${money(main.outcome.cost.total_usd)}（固定 ${money(main.outcome.cost.fixed_usd)} + 按人 ${money(main.outcome.cost.marginal_usd)}），预算 ${money(ctx.scenario.budget_usd)}。`,
    ];
    return { status: 'OPTIMAL', outcome: main.outcome, verification: main.verification, notes, alternative: null };
  }

  if (!main.complete) {
    if (main.outcome) {
      return {
        status: 'SEARCH_LIMIT_REACHED',
        outcome: main.outcome,
        verification: main.verification,
        notes: [
          `达到搜索上限（${maxNodes} 个节点），未证明最优：这是搜索上限内找到的、经独立复核通过的最好方案，不等于全局最优，也不代表无更好方案。`,
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
        `达到搜索上限（${maxNodes} 个节点），未证明最优：搜索上限内未找到满足全部要求的方案，这是不启用任何措施的占位方案，不等于无解。`,
      ],
      alternative: null,
    };
  }

  // ── INFEASIBLE：只放松软要求求 alternative ──
  const reasons: string[] = [];
  const attempts: { relaxed: ('required_intervention_ids' | 'min_gain')[]; soft: SoftOptions }[] = [];
  if (options.min_gain !== undefined) attempts.push({ relaxed: ['min_gain'], soft: { required: options.required_intervention_ids } });
  if (options.required_intervention_ids !== undefined) {
    attempts.push({ relaxed: ['required_intervention_ids'], soft: { minGain: options.min_gain } });
  }
  type Found = { relaxed: ('required_intervention_ids' | 'min_gain')[]; outcome: JointOutcome; complete: boolean };
  let found: Found | null = null;
  const toCand = (o: JointOutcome): Candidate => ({
    selected: o.selected_intervention_ids,
    allocations: o.allocations,
    G: o.G,
    N: o.N,
    cost: o.cost,
  });
  let maxGainUnderRequired: number | null = null;
  /** 有候选替代方案没有通过内部复核（已舍弃，不给出）。 */
  let altRejected = false;
  for (const att of attempts) {
    const r = runSearch(ctx, options, att.soft, assumed, maxNodes);
    if (r.rejected) altRejected = true;
    if (att.relaxed[0] === 'min_gain' && r.complete && r.outcome) maxGainUnderRequired = r.outcome.G;
    if (!r.outcome) continue;
    if (!found || compareCandidates(toCand(r.outcome), toCand(found.outcome)) < 0) {
      found = { relaxed: att.relaxed, outcome: r.outcome, complete: r.complete };
    }
  }
  if (!found) {
    const r = runSearch(ctx, options, {}, assumed, maxNodes);
    if (r.rejected) altRejected = true;
    found = {
      relaxed: (['min_gain', 'required_intervention_ids'] as const).filter((k) =>
        k === 'min_gain' ? options.min_gain !== undefined : options.required_intervention_ids !== undefined,
      ),
      outcome: r.outcome ?? emptyOutcome(),
      complete: r.complete,
    };
  }

  if (options.required_intervention_ids !== undefined) {
    reasons.push(`必须启用 ${options.required_intervention_ids.map((id) => `「${id}」`).join('、') || '（空列表）'}`);
  }
  if (options.min_gain !== undefined) reasons.push(`新增覆盖至少 ${options.min_gain}`);
  const why: string[] = [];
  const req = options.required_intervention_ids ?? [];
  if (req.length > 0) {
    // 只看「必须启用」能否单独满足：放松 min_gain 那次搜索是否可行。
    const reqAlone = options.min_gain === undefined || maxGainUnderRequired === null;
    if (reqAlone) why.push(`必须启用的措施：${describeRequiredFailure(ctx, req, assumed)}`);
  }
  if (options.min_gain !== undefined) {
    if (maxGainUnderRequired !== null) why.push(`在其他要求下最多只能新增 ${maxGainUnderRequired} 个可达对，低于要求的 ${options.min_gain}`);
    else if (req.length === 0) why.push(`在硬约束下达不到新增 ${options.min_gain} 个可达对`);
  }
  const relaxedZh = found.relaxed.map((k) => (k === 'min_gain' ? '最低新增覆盖 min_gain' : '必须启用的措施 required_intervention_ids')).join('、');
  const altNote =
    `原要求（${reasons.join('；')}）在硬约束下无法同时满足${why.length ? '：' + why.join('；') : ''}。` +
    `替代方案放松了：${relaxedZh}（整项不再要求），硬约束（批准、互斥、前置依赖、容量、预算、损失）没有放松：` +
    `新增可达 ${found.outcome.G} 个对，总成本 ${money(found.outcome.cost.total_usd)}。` +
    (found.complete ? '' : '替代方案的搜索达到上限，未证明最优。') +
    (altRejected
      ? `有候选替代方案${INTERNAL_VERIFY_FAILED.replace('按不支持的输入处理，', '已舍弃、未给出；')}` +
        (found.outcome.selected_intervention_ids.length === 0 ? '当前替代方案是不启用任何措施的占位方案。' : '')
      : '') +
    '这不是主结果，结果为模拟。';
  const alternative: JointAlternative = { ...found.outcome, relaxed: found.relaxed, note: altNote };
  return {
    status: 'INFEASIBLE',
    outcome: emptyOutcome(),
    verification: null,
    notes: [
      `无解（INFEASIBLE）：没有方案能在满足全部硬约束的同时满足主办方要求（${reasons.join('；')}）。主结果是不启用任何措施的空方案；没有悄悄降低要求，放松后的替代方案见 alternative。`,
    ],
    alternative,
  };
}

// ───────────────────────────── 入口 ─────────────────────────────

export function solveJoint(scenario: Scenario, rawOptions: SolveOptions = {}): JointResult {
  const reasons = validateJointInput(scenario, rawOptions);
  if (reasons.length > 0) {
    return {
      status: 'UNSUPPORTED_INPUT',
      ...emptyPlan(),
      R0: [],
      R1: [],
      G: 0,
      L: 0,
      N: 0,
      notes: ['输入不合法或超出求解器支持范围，未做评估：', ...reasons],
      alternative: null,
      conditional: null,
      verification: null,
    };
  }

  const options = normalizeOptions(rawOptions);
  const ctx = makeCtx(scenario);
  const maxNodes = options.max_search_nodes ?? DEFAULT_MAX_SEARCH_NODES;
  const main = solveOnce(ctx, options, [], maxNodes);

  if (main.status === 'UNSUPPORTED_INPUT') {
    // 内部复核未通过：返回空方案（与输入不合法时同形），verification 保留那次失败的复核结果。
    return {
      status: 'UNSUPPORTED_INPUT',
      ...emptyPlan(),
      R0: [],
      R1: [],
      G: 0,
      L: 0,
      N: 0,
      notes: main.notes,
      alternative: null,
      conditional: null,
      verification: main.verification,
    };
  }

  const pendingIds = scenario.interventions.filter((iv) => !isApproved(iv)).map((iv) => iv.id).sort(cmpStr);
  let conditional: JointConditional | null = null;
  if (pendingIds.length > 0) {
    const c = solveOnce(ctx, options, pendingIds, maxNodes);
    const names = pendingIds.map((id) => `「${ctx.ivs.get(id)!.title}」`).join('、');
    let what: string;
    if (c.status === 'UNSUPPORTED_INPUT') what = '';
    else if (c.status === 'INFEASIBLE') what = '仍然无法满足主办方要求（结果为空方案）';
    else {
      what = `新增可达 ${c.outcome.G} 个（学生, 机会）对，损失 ${c.outcome.L} 个，总成本 ${money(c.outcome.cost.total_usd)}`;
      if (c.outcome.N === main.outcome.N && main.status !== 'INFEASIBLE') what += '（净值与主结果（仅含已批准措施）相同）';
      if (c.status === 'SEARCH_LIMIT_REACHED') what += '（达到搜索上限，未证明最优）';
    }
    conditional = {
      ...c.outcome,
      status: c.status,
      assumed_approved_intervention_ids: pendingIds,
      note:
        c.status === 'UNSUPPORTED_INPUT'
          ? `假设这些措施获批（${names}）时，${INTERNAL_VERIFY_FAILED}因此未给出条件性方案（这里是不启用任何措施的占位）；目前尚未生效，结果为模拟。`
          : `如果这些措施获批（${names}），则${what}；目前尚未生效，结果为模拟。`,
    };
  }

  const notes = [...main.notes];
  if (pendingIds.length > 0) notes.push(`有 ${pendingIds.length} 项措施尚待审批，主结果不含它们；获批后的情况见 conditional（尚未生效）。`);
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
