/**
 * 基线 D「充分协调的分离式规划器」（CONTRACT.md「联合求解模型」第 10 条 D 行）。
 *
 * 两个分开的角色，只通过「提议 / 报告」两种消息协调：
 * - 学生端角色（StudentSide）：只做学生那一侧的判断。对机构端的提议（选中措施、分配、撤回）报告
 *   (1) 每个（学生, 机会）对在该提议下是否完整可达——用 ./verify 的 createJointEvaluator（与验证器同一口径的
 *       analyzeReachability 评估，不另写可达性判断）；
 *   (2) 每个对的「极小可达措施集合」清单（能让它可达的所有极小措施子集，同 B 行「每对找最小措施子集」的做法，
 *       但给出全部极小集合而不只是第一个），并按「该对相关的已有 grant 被撤回了哪些」分情况给出（完整信息交换，
 *       按需计算并缓存，内容与一次性全部给出相同）；
 *   (3) 分到了但用不上的名额（拿掉也不影响该对可达，或该对无论如何都不可达）；
 *   (4) 每名学生是否至少对一个机会官方资格为 eligible（公平底线的分母要用）。
 * - 机构端角色（OrganizerSide）：只做机构那一侧的决定。不计算学生是否可达，只读学生端的报告；在预算、容量
 *   （含时段容量）、互斥、前置依赖、审批状态（只用已批准措施）、保护 / 权衡模式与 loss_cap、已有 grant
 *   （占容量、approved 的免成本、不可撤回的封锁互斥措施、撤回后不再给同一 (措施, 学生) 分配）的约束下，
 *   穷举「启用哪些措施」与（权衡模式下）撤回哪些可撤回 grant，并对名额分配做精确的分支定界搜索，
 *   按与联合求解相同的目标顺序取最优：N 最大 → L 最小 → 成本最低 → 分配条数 → 措施数 → 撤回数 → 字典序。
 *   它把场景里给出的软要求（必须启用的措施、最低新增 min_gain、公平底线）当作约束；没有方案能满足时，
 *   与联合求解的主结果一致，提议空方案（软要求如实不满足，不放松）。
 *
 * 协调协议：
 * - 第 0 轮：机构端提出空方案（空方案总满足全部硬约束，所以每一轮的提议都可执行）。
 * - 第 r 轮（r = 1, 2, …）：学生端评估上一轮的提议并报告 → 机构端据此调整，给出新提议。
 *   若学生端报告某个机构端以为可达的对实际不可达，机构端把那个「(对, 撤回情况, 措施集合)」记为无效，以后不再用。
 * - 停止：某一轮机构端的新提议与学生端刚评估的提议相同（不动点）→ converged，rounds = r；
 *   或达到 max_rounds（缺省 MAX_COORDINATION_ROUNDS = 50）→ converged = false，返回机构端最后一次提议
 *   （该提议尚未经学生端确认；仍由验证器复核），notes 写明。
 *   因为学生端在第 1 轮就给出了完整的条件性报告，通常第 1 轮调整后即得到最终提议、第 2 轮确认（rounds = 2）；
 *   空方案本身就是最优时 rounds = 1。上限 50 远大于这个轮数，不会人为卡住协调。
 *
 * 机构端搜索的计算资源：与联合求解相同的节点上限 `options.max_search_nodes`（缺省 200000，与
 * DEFAULT_MAX_SEARCH_NODES 相同的数值；「节点」= 一个（措施组合, 撤回集合）或分支定界的一个状态，计法与联合
 * 求解不同）。达到上限时返回已找到的最好提议并在 notes 写明未证明最优。另有规模保护：已批准措施超过 12 项时只枚举
 * 至多 4 项的措施组合；某对的候选措施超过 12 项时学生端只列出至多 3 项的极小集合；权衡模式下可自愿撤回的候选
 * grant 超过 10 条时只做强制撤回；某对相关的可撤回 grant 超过 6 条时学生端只报告「不撤回」与「全部撤回」两种情况。
 * 触发任何一条都在 notes 写明（此时 D 可能不如联合求解，原因即这条限制）。
 *
 * 独立性：本文件不得 import ./solve（不是联合求解器，有静态守卫测试）；只用 ./verify 的评估器。
 * 纯函数：确定性（并列按 id 升序与第 5 条的字典序）、不读系统时钟、无随机、无 IO、不调 AI；不修改输入。
 * 所有结果都是模拟，可达 ≠ 录取。
 */
import type { Allocation, FairnessFloor, Intervention, JointPlan, ResourceGrant, Scenario, SolveOptions } from '../types';
import type { JointEvaluator } from './verify';

export const MAX_COORDINATION_ROUNDS = 50;
/** 机构端搜索的缺省节点上限（与联合求解的 DEFAULT_MAX_SEARCH_NODES 数值相同；不 import ./solve）。 */
export const D_DEFAULT_MAX_SEARCH_NODES = 200_000;
export const D_LIMITS = {
  approvedInterventions: 12,
  selectionSizeWhenLarge: 4,
  menuCandidates: 12,
  menuSizeWhenLarge: 3,
  voluntaryRevocations: 10,
  relevantGrantsPerPair: 6,
} as const;

const EPS = 1e-6;
const FAIRNESS_EPS = 1e-9;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const pairKey = (s: string, o: string) => JSON.stringify([s, o]);

type Pair = { s: string; o: string };

export interface CoordinationInfo {
  rounds: number;
  converged: boolean;
  max_rounds: number;
}

export interface CoordinatedResult {
  plan: JointPlan;
  /** 机构端按学生端报告认为可达的对数（收敛时 = 学生端在确认轮报告的可达对数）。 */
  claimed_reachable: number;
  coordination: CoordinationInfo;
  /** 只含人数与汇总，不含学生 id。 */
  notes: string[];
}

// ───────────────────────────── 学生端角色 ─────────────────────────────

interface StudentReport {
  /** 在当前提议下完整可达的对（pairKey）。 */
  reachable: Set<string>;
  /** 分到了但用不上的分配条数（拿掉不影响该对可达，或该对无论如何都不可达）。 */
  unused_allocations: number;
}

class StudentSide {
  private menuCache = new Map<string, string[][]>();
  private eligibleCache = new Map<string, boolean>();
  limitedMenus = false;
  limitedPatterns = false;

  constructor(
    private readonly ev: JointEvaluator,
    private readonly oppIds: readonly string[],
    private readonly candidatesFor: (o: string) => string[],
  ) {}

  private reach(p: Pair, ivIds: readonly string[], revoked: ReadonlySet<string>): boolean {
    return this.ev.evaluate(p.s, p.o, ivIds, revoked)?.reachable === true;
  }

  /** 与该对相关的可撤回已有 grant（student_id = s，opportunity_id 为 null 或 = o），id 升序去重。 */
  relevantRevocable(p: Pair): string[] {
    const ids = this.ev.norm.revocable
      .filter((g) => g.student_id === p.s && (g.opportunity_id === null || g.opportunity_id === p.o))
      .map((g) => g.id);
    return [...new Set(ids)].sort(cmpStr);
  }

  /** 学生端报告的撤回情况是否受限（相关 grant 过多时只报告「不撤回」与「全部撤回」）。 */
  patternSupported(p: Pair, pattern: readonly string[]): boolean {
    const rel = this.relevantRevocable(p);
    if (rel.length <= D_LIMITS.relevantGrantsPerPair) return true;
    this.limitedPatterns = true;
    return pattern.length === 0 || pattern.length === rel.length;
  }

  /**
   * 极小可达措施集合（按大小、同大小按排序后 id 数组的字典序）。pattern = 该对相关的、被撤回的已有 grant id（升序）。
   * 不撤回就可达时为 [[]]；没有任何集合能让它可达时为 []。
   */
  menus(p: Pair, pattern: readonly string[]): string[][] {
    const key = JSON.stringify([p.s, p.o, pattern]);
    const hit = this.menuCache.get(key);
    if (hit) return hit;
    const revoked = new Set(pattern);
    const out: string[][] = [];
    if (this.reach(p, [], revoked)) out.push([]);
    else {
      const cands = this.candidatesFor(p.o);
      const maxSize = cands.length > D_LIMITS.menuCandidates ? D_LIMITS.menuSizeWhenLarge : cands.length;
      if (cands.length > D_LIMITS.menuCandidates) this.limitedMenus = true;
      for (const subset of combinationsBySize(cands, maxSize)) {
        if (out.some((m) => m.every((i) => subset.includes(i)))) continue;
        if (this.reach(p, subset, revoked)) out.push(subset);
      }
    }
    this.menuCache.set(key, out);
    return out;
  }

  /** 至少对一个机会官方资格为 eligible（公平底线分母）。 */
  eligibleSomewhere(s: string): boolean {
    const hit = this.eligibleCache.get(s);
    if (hit !== undefined) return hit;
    const v = this.oppIds.some((o) => this.ev.eligibility(s, o) === 'eligible');
    this.eligibleCache.set(s, v);
    return v;
  }

  /** 评估机构端的提议。 */
  report(pairs: readonly Pair[], plan: JointPlan): StudentReport {
    const revoked = new Set(plan.revoked_grant_ids ?? []);
    const byPair = new Map<string, string[]>();
    for (const a of plan.allocations) {
      const k = pairKey(a.student_id, a.opportunity_id);
      const list = byPair.get(k) ?? [];
      list.push(a.intervention_id);
      byPair.set(k, list);
    }
    const reachable = new Set<string>();
    let unused = 0;
    for (const p of pairs) {
      const k = pairKey(p.s, p.o);
      const ivs = byPair.get(k) ?? [];
      if (this.reach(p, ivs, revoked)) {
        reachable.add(k);
        for (const i of ivs) if (this.reach(p, ivs.filter((x) => x !== i), revoked)) unused++;
      } else unused += ivs.length;
    }
    return { reachable, unused_allocations: unused };
  }
}

/** 大小 0…maxSize 中 1…maxSize 的组合，同一大小内按（已排序 id 数组的）字典序。items 必须已升序。 */
function* combinationsBySize(items: readonly string[], maxSize: number): Generator<string[]> {
  const n = items.length;
  for (let k = 1; k <= Math.min(n, maxSize); k++) {
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

// ───────────────────────────── 机构端角色 ─────────────────────────────

interface Candidate {
  /** 数值目标：[-|R1|, L, cost, allocCount, selCount, revCount] */
  nums: number[];
  sel: string[];
  allocs: Allocation[];
  revoked: string[];
  r1: number;
}

function cmpStrArrays(a: readonly string[], b: readonly string[]): number {
  for (let k = 0; k < Math.min(a.length, b.length); k++) {
    const c = cmpStr(a[k], b[k]);
    if (c !== 0) return c;
  }
  return a.length - b.length;
}

const cmpAlloc = (a: Allocation, b: Allocation) =>
  cmpStr(a.intervention_id, b.intervention_id) || cmpStr(a.student_id, b.student_id) || cmpStr(a.opportunity_id, b.opportunity_id);

function cmpCandidate(a: Candidate, b: Candidate): number {
  for (let k = 0; k < a.nums.length; k++) {
    const d = a.nums[k] - b.nums[k];
    if (Math.abs(d) > EPS) return d < 0 ? -1 : 1;
  }
  const s = cmpStrArrays(a.sel, b.sel);
  if (s !== 0) return s;
  for (let k = 0; k < Math.min(a.allocs.length, b.allocs.length); k++) {
    const c = cmpAlloc(a.allocs[k], b.allocs[k]);
    if (c !== 0) return c;
  }
  if (a.allocs.length !== b.allocs.length) return a.allocs.length - b.allocs.length;
  return cmpStrArrays(a.revoked, b.revoked);
}

function excl(a: Intervention | undefined, b: Intervention | undefined): boolean {
  if (!a || !b) return false;
  return (a.mutually_exclusive_with ?? []).includes(b.id) || (b.mutually_exclusive_with ?? []).includes(a.id);
}

function subsetsOf<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 0; mask < 1 << items.length; mask++) out.push(items.filter((_, k) => mask & (1 << k)));
  return out;
}

interface OrganizerInputs {
  scenario: Scenario;
  ev: JointEvaluator;
  opts: SolveOptions;
  pairs: readonly Pair[];
  r0: ReadonlySet<string>;
  AP: readonly Intervention[];
  student: StudentSide;
}

interface OrganizerOutcome {
  /** null = 没有满足全部约束（含软要求）的方案。 */
  best: Candidate | null;
  hitNodeLimit: boolean;
  limitedSelections: boolean;
  limitedRevocations: boolean;
}

class OrganizerSide {
  /** 学生端否定过的（对, 撤回情况, 措施集合）。 */
  private disproved = new Set<string>();
  private readonly ivById: Map<string, Intervention>;
  private readonly existing: ResourceGrant[];
  private readonly revocable: ResourceGrant[];
  private readonly lockedIvs: Set<string>;
  private readonly protect: boolean;

  constructor(private readonly x: OrganizerInputs) {
    this.ivById = new Map(x.scenario.interventions.map((iv) => [iv.id, iv]));
    this.existing = x.ev.norm.existing;
    this.revocable = x.ev.norm.revocable;
    this.lockedIvs = new Set(x.ev.norm.locked.map((g) => String(g.intervention_id)));
    this.protect = x.opts.mode == null || x.opts.mode === 'protect';
  }

  disprove(p: Pair, pattern: readonly string[], menu: readonly string[]): void {
    this.disproved.add(JSON.stringify([p.s, p.o, pattern, menu]));
  }

  private slotOf(o: string | null | undefined): string {
    const slots = this.x.ev.norm.timeSlots;
    if (o != null && Object.prototype.hasOwnProperty.call(slots, o) && typeof slots[o] === 'string') return 'L:' + slots[o];
    return 'D';
  }

  /** 选中集合本身是否满足互斥、依赖、审批、不可撤回承诺与 required；返回强制撤回的 grant id，或 null（不合法）。 */
  private selectionForced(sel: ReadonlySet<string>): string[] | null {
    const ids = [...sel];
    for (const id of ids) {
      const iv = this.ivById.get(id)!;
      for (const r of iv.requires ?? []) if (!sel.has(r)) return null;
      for (const other of ids) if (other !== id && excl(iv, this.ivById.get(other))) return null;
      for (const k of this.lockedIvs) if (excl(iv, this.ivById.get(k))) return null;
    }
    for (const r of this.x.opts.required_intervention_ids ?? []) if (!sel.has(r)) return null;
    const forced = this.revocable
      .filter((g) => ids.some((i) => excl(this.ivById.get(i), this.ivById.get(String(g.intervention_id)))))
      .map((g) => g.id);
    return [...new Set(forced)].sort(cmpStr);
  }

  search(): OrganizerOutcome {
    const { opts, pairs, AP, student, scenario } = this.x;
    const limit = opts.max_search_nodes ?? D_DEFAULT_MAX_SEARCH_NODES;
    let nodes = 0;
    let hit = false;
    const tick = () => {
      nodes++;
      if (nodes > limit) hit = true;
      return hit;
    };
    let best: Candidate | null = null;
    const lossCap = this.protect ? 0 : (opts.loss_cap ?? 0);
    const floors: FairnessFloor[] = Array.isArray(opts.fairness_floors) ? opts.fairness_floors : [];
    const statusesOf = new Map(scenario.students.map((s) => [s.id, Array.isArray(s.statuses) ? s.statuses : null]));
    const floorMembers = floors.map((f) =>
      [...new Set(pairs.map((p) => p.s))].filter((s) => {
        const st = statusesOf.get(s);
        return st != null && st.some((x) => f.statuses_any_of.includes(x)) && student.eligibleSomewhere(s);
      }),
    );

    const apIds = AP.map((iv) => iv.id);
    const limitedSelections = apIds.length > D_LIMITS.approvedInterventions;
    let limitedRevocations = false;
    const masks: string[][] = [];
    if (!limitedSelections) {
      for (let mask = (1 << apIds.length) - 1; mask >= 0; mask--) masks.push(apIds.filter((_, k) => mask & (1 << k)));
    } else {
      masks.push([]);
      for (const c of combinationsBySize(apIds, D_LIMITS.selectionSizeWhenLarge)) masks.push(c);
    }

    for (const selList of masks) {
      if (tick()) break;
      const sel = new Set(selList);
      const forced = this.selectionForced(sel);
      if (forced === null) continue;
      if (this.protect && forced.length > 0) continue;
      const fixed = selList.reduce((acc, id) => acc + (this.ivById.get(id)!.fixed_cost_usd ?? 0), 0);
      if (fixed > scenario.budget_usd + EPS) continue;
      let voluntary: string[] = [];
      if (!this.protect) {
        voluntary = [
          ...new Set(
            this.revocable
              .filter((g) => !forced.includes(g.id) && sel.has(String(g.intervention_id)) && this.ivById.get(String(g.intervention_id))!.capacity != null)
              .map((g) => g.id),
          ),
        ].sort(cmpStr);
        if (voluntary.length > D_LIMITS.voluntaryRevocations) {
          limitedRevocations = true;
          voluntary = [];
        }
      }
      for (const vol of subsetsOf(voluntary)) {
        if (hit || tick()) break;
        const X = [...forced, ...vol].sort(cmpStr);
        best = this.searchAllocations(sel, selList, fixed, X, best, lossCap, floors, floorMembers, tick, () => hit);
      }
      if (hit) break;
    }
    return { best, hitNodeLimit: hit, limitedSelections, limitedRevocations };
  }

  private searchAllocations(
    sel: ReadonlySet<string>,
    selList: readonly string[],
    fixed: number,
    X: readonly string[],
    bestIn: Candidate | null,
    lossCap: number,
    floors: readonly FairnessFloor[],
    floorMembers: readonly string[][],
    tick: () => boolean,
    isHit: () => boolean,
  ): Candidate | null {
    const { pairs, r0, student, scenario, opts } = this.x;
    let best = bestIn;
    const Xset = new Set(X);
    const revokedGrants = this.existing.filter((g) => typeof g.id === 'string' && Xset.has(g.id));
    const blocked = new Set(revokedGrants.map((g) => JSON.stringify([g.intervention_id, g.student_id])));
    const Eprime = this.existing.filter((g) => !(typeof g.id === 'string' && Xset.has(g.id)));
    const waived = new Set(
      Eprime.filter((g) => g.status === 'approved').map((g) => JSON.stringify([g.intervention_id, g.student_id])),
    );

    // 每对的选项（按学生端报告）
    type PairOpt = { p: Pair; key: string; inR0: boolean; pattern: string[]; options: string[][] };
    let freeCount = 0;
    let fixedLoss = 0;
    const free: Pair[] = [];
    const work: PairOpt[] = [];
    for (const p of pairs) {
      const key = pairKey(p.s, p.o);
      const inR0 = r0.has(key);
      const pattern = student.relevantRevocable(p).filter((id) => Xset.has(id));
      if (!student.patternSupported(p, pattern)) {
        if (inR0) fixedLoss++;
        continue;
      }
      const menus = student.menus(p, pattern).filter((m) => !this.disproved.has(JSON.stringify([p.s, p.o, pattern, m])));
      if (menus.some((m) => m.length === 0)) {
        freeCount++;
        free.push(p);
        continue;
      }
      const options = menus.filter((m) => m.every((i) => sel.has(i) && !blocked.has(JSON.stringify([i, p.s]))));
      if (options.length === 0) {
        if (inR0) fixedLoss++;
        continue;
      }
      work.push({ p, key, inR0, pattern, options });
    }
    if (fixedLoss > lossCap + EPS) return best;
    const suffixAvail: number[] = new Array(work.length + 1).fill(0);
    for (let k = work.length - 1; k >= 0; k--) suffixAvail[k] = suffixAvail[k + 1] + 1;

    // 容量与成本的增量状态
    const baseOcc = new Map<string, Set<string>>();
    const occKey = (iv: Intervention, o: string) => iv.id + '\u0000' + (iv.capacity_scope === 'per_time_slot' ? this.slotOf(o) : 'total');
    const baseFor = (iv: Intervention, o: string): Set<string> => {
      const k = occKey(iv, o);
      let set = baseOcc.get(k);
      if (!set) {
        set = new Set<string>();
        const perSlot = iv.capacity_scope === 'per_time_slot';
        const slot = this.slotOf(o);
        for (const g of Eprime) {
          if (g.intervention_id !== iv.id) continue;
          if (!perSlot || g.opportunity_id === null || this.slotOf(g.opportunity_id) === slot) set.add(String(g.student_id));
        }
        baseOcc.set(k, set);
      }
      return set;
    };
    const added = new Map<string, Map<string, number>>();
    const charged = new Map<string, number>();
    let cost = fixed;
    let allocCount = 0;
    const chosen: { p: Pair; menu: string[] }[] = [];
    const budget = scenario.budget_usd;

    const tryAdd = (p: Pair, menu: readonly string[]): (() => void) | null => {
      const undo: (() => void)[] = [];
      const rollback = () => {
        for (let k = undo.length - 1; k >= 0; k--) undo[k]();
      };
      for (const id of menu) {
        const iv = this.ivById.get(id)!;
        if (iv.capacity != null) {
          const k = occKey(iv, p.o);
          const base = baseFor(iv, p.o);
          let m = added.get(k);
          if (!m) {
            m = new Map();
            added.set(k, m);
          }
          const inBase = base.has(p.s);
          const cur = m.get(p.s) ?? 0;
          if (!inBase && cur === 0) {
            let distinct = base.size;
            for (const s of m.keys()) if (!base.has(s)) distinct++;
            if (distinct + 1 > iv.capacity + EPS) {
              rollback();
              return null;
            }
          }
          const mm = m;
          mm.set(p.s, cur + 1);
          undo.push(() => {
            const c = mm.get(p.s)! - 1;
            if (c === 0) mm.delete(p.s);
            else mm.set(p.s, c);
          });
        }
        const ck = JSON.stringify([id, p.s]);
        const c0 = charged.get(ck) ?? 0;
        if (c0 === 0 && !waived.has(ck)) {
          const unit = iv.unit_cost_usd;
          if (cost + unit > budget + EPS) {
            rollback();
            return null;
          }
          cost += unit;
          undo.push(() => {
            cost -= unit;
          });
        }
        charged.set(ck, c0 + 1);
        undo.push(() => {
          const c = charged.get(ck)! - 1;
          if (c === 0) charged.delete(ck);
          else charged.set(ck, c);
        });
      }
      allocCount += menu.length;
      undo.push(() => {
        allocCount -= menu.length;
      });
      return rollback;
    };

    const r0Size = r0.size;
    const leaf = (r1Count: number, loss: number) => {
      const G = r1Count - (r0Size - loss);
      if (opts.min_gain != null && G < opts.min_gain - EPS) return;
      if (floors.length > 0) {
        const coveredStudents = new Set<string>([...free.map((p) => p.s), ...chosen.map((c) => c.p.s)]);
        for (let f = 0; f < floors.length; f++) {
          const members = floorMembers[f];
          if (members.length === 0) continue;
          const covered = members.filter((s) => coveredStudents.has(s)).length;
          if (covered / members.length < floors[f].min_ratio - FAIRNESS_EPS) return;
        }
      }
      const nums = [-r1Count, loss, cost, allocCount, selList.length, X.length];
      if (best) {
        for (let k = 0; k < nums.length; k++) {
          const d = nums[k] - best.nums[k];
          if (Math.abs(d) > EPS) {
            if (d > 0) return;
            break;
          }
        }
      }
      const raw: Allocation[] = [];
      for (const c of chosen) for (const i of c.menu) raw.push({ intervention_id: i, student_id: c.p.s, opportunity_id: c.p.o, cost_usd: 0 });
      const cand: Candidate = {
        nums,
        sel: [...selList].sort(cmpStr),
        allocs: costAllocations(raw, this.ivById, waived),
        revoked: [...X],
        r1: r1Count,
      };
      if (!best || cmpCandidate(cand, best) < 0) best = cand;
    };

    const dfs = (k: number, r1Count: number, loss: number) => {
      if (isHit() || tick()) return;
      if (best) {
        const ub = r1Count + suffixAvail[k];
        if (-ub > best.nums[0] + EPS) return;
        if (Math.abs(-ub - best.nums[0]) <= EPS) {
          if (loss > best.nums[1] + EPS) return;
          if (Math.abs(loss - best.nums[1]) <= EPS && cost > best.nums[2] + EPS) return;
        }
      }
      if (k === work.length) {
        leaf(r1Count, loss);
        return;
      }
      const w = work[k];
      for (const menu of w.options) {
        const rollback = tryAdd(w.p, menu);
        if (!rollback) continue;
        chosen.push({ p: w.p, menu });
        dfs(k + 1, r1Count + 1, loss);
        chosen.pop();
        rollback();
        if (isHit()) return;
      }
      const nextLoss = loss + (w.inR0 ? 1 : 0);
      if (nextLoss <= lossCap + EPS) dfs(k + 1, r1Count, nextLoss);
    };
    // 初始损失 = 无论如何都保不住的 R0 对；R0 中「不分配也可达」的不算损失，其余 R0 对在 DFS 中选「不分配」时才计损失。
    dfs(0, freeCount, fixedLoss);
    return best;
  }

  /** 机构端认为该方案下可达的对（按学生端报告的极小集合判断）。 */
  believedReachable(plan: JointPlan): { reachable: Set<string>; usedMenus: Map<string, { pattern: string[]; menu: string[] }> } {
    const { pairs, student } = this.x;
    const Xset = new Set(plan.revoked_grant_ids ?? []);
    const byPair = new Map<string, Set<string>>();
    for (const a of plan.allocations) {
      const k = pairKey(a.student_id, a.opportunity_id);
      const set = byPair.get(k) ?? new Set<string>();
      set.add(a.intervention_id);
      byPair.set(k, set);
    }
    const reachable = new Set<string>();
    const usedMenus = new Map<string, { pattern: string[]; menu: string[] }>();
    for (const p of pairs) {
      const k = pairKey(p.s, p.o);
      const pattern = student.relevantRevocable(p).filter((id) => Xset.has(id));
      if (!student.patternSupported(p, pattern)) continue;
      const have = byPair.get(k) ?? new Set<string>();
      const menu = student
        .menus(p, pattern)
        .filter((m) => !this.disproved.has(JSON.stringify([p.s, p.o, pattern, m])))
        .find((m) => m.every((i) => have.has(i)));
      if (menu) {
        reachable.add(k);
        usedMenus.set(k, { pattern, menu });
      }
    }
    return { reachable, usedMenus };
  }
}

function costAllocations(raw: Allocation[], ivById: Map<string, Intervention>, waived: ReadonlySet<string>): Allocation[] {
  const sorted = raw.map((a) => ({ ...a, cost_usd: 0 })).sort(cmpAlloc);
  const seen = new Set<string>();
  for (const a of sorted) {
    const key = JSON.stringify([a.intervention_id, a.student_id]);
    if (seen.has(key)) continue;
    seen.add(key);
    a.cost_usd = waived.has(key) ? 0 : ivById.get(a.intervention_id)?.unit_cost_usd ?? 0;
  }
  return sorted;
}

const emptyPlan = (): JointPlan => ({ selected_intervention_ids: [], allocations: [], revoked_grant_ids: [] });

function samePlan(a: JointPlan, b: JointPlan): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function planOf(c: Candidate | null): JointPlan {
  if (!c) return emptyPlan();
  return { selected_intervention_ids: [...c.sel], allocations: c.allocs.map((a) => ({ ...a })), revoked_grant_ids: [...c.revoked] };
}

/**
 * D 触发节点上限或任何规模保护时，它的说明（notes）里都带这句（句末另加句号）。
 * What-if 视图据此在 D 行的协调标签后追加 "; optimality not proven"（BaselineRow 的结构不变）。
 */
export const D_OPTIMALITY_NOT_PROVEN_MARKER = 'D may be worse than the joint solver for this reason';

/** 一组基线说明里是否有 D 的「未证明最优」说明（节点上限或规模保护）。 */
export function dOptimalityNotProven(notes: readonly string[]): boolean {
  return notes.some((n) => typeof n === 'string' && n.startsWith('Baseline D') && n.includes(D_OPTIMALITY_NOT_PROVEN_MARKER));
}

/**
 * 运行基线 D。调用方（./baselines 的 compareBaselines）负责校验输入（不合法时不调用）、用验证器复核返回的方案。
 * maxRounds 只为测试注入较小的上限；正常调用用缺省值 MAX_COORDINATION_ROUNDS。
 */
export function planCoordinated(
  scenario: Scenario,
  opts: SolveOptions,
  ev: JointEvaluator,
  maxRounds: number = MAX_COORDINATION_ROUNDS,
): CoordinatedResult {
  const students = [...scenario.students].sort((a, b) => cmpStr(a.id, b.id));
  const opps = [...scenario.opportunities].sort((a, b) => cmpStr(a.id, b.id));
  const pairs: Pair[] = [];
  for (const s of students) for (const o of opps) pairs.push({ s: s.id, o: o.id });
  const AP = scenario.interventions.filter((iv) => iv.status !== 'pending').sort((a, b) => cmpStr(a.id, b.id));
  const applicable = (iv: Intervention, o: string) => iv.opportunity_ids == null || iv.opportunity_ids.includes(o);
  const candidatesFor = (o: string) => AP.filter((iv) => applicable(iv, o)).map((iv) => iv.id);

  const student = new StudentSide(ev, opps.map((o) => o.id), candidatesFor);
  const r0 = new Set(pairs.filter((p) => student.menus(p, []).some((m) => m.length === 0)).map((p) => pairKey(p.s, p.o)));
  const organizer = new OrganizerSide({ scenario, ev, opts, pairs, r0, AP, student });

  const notes: string[] = [];
  const limits = { node: false, selections: false, revocations: false, infeasible: false };
  const rounds = Math.max(1, Math.floor(maxRounds));
  let proposal = emptyPlan();
  let converged = false;
  let usedRounds = 0;
  let mismatches = 0;
  let lastConfirmed: StudentReport | null = null;
  for (let r = 1; r <= rounds; r++) {
    usedRounds = r;
    // 学生端评估上一轮的提议
    const report = student.report(pairs, proposal);
    lastConfirmed = report;
    // 机构端核对：自己以为可达、学生端说不可达的，记为无效
    const believed = organizer.believedReachable(proposal);
    for (const [k, used] of believed.usedMenus) {
      if (!report.reachable.has(k)) {
        const [s, o] = JSON.parse(k) as [string, string];
        organizer.disprove({ s, o }, used.pattern, used.menu);
        mismatches++;
      }
    }
    if (r === 1 || report.unused_allocations > 0) {
      notes.push(
        `Baseline D round ${r}: the student-side planner confirmed ${report.reachable.size} reachable pairs under the organizer's proposal and reported ${report.unused_allocations} allocated slots that could not be used.`,
      );
    }
    // 机构端调整
    const out = organizer.search();
    limits.node ||= out.hitNodeLimit;
    limits.selections ||= out.limitedSelections;
    limits.revocations ||= out.limitedRevocations;
    limits.infeasible = out.best === null && !out.hitNodeLimit;
    const next = out.best === null && out.hitNodeLimit ? proposal : planOf(out.best);
    if (samePlan(next, proposal)) {
      converged = true;
      break;
    }
    proposal = next;
  }

  const finalBelieved = organizer.believedReachable(proposal).reachable;
  const claimed = converged && lastConfirmed ? lastConfirmed.reachable.size : finalBelieved.size;
  if (converged) {
    notes.push(
      `Baseline D converged after ${usedRounds} coordination ${usedRounds === 1 ? 'round' : 'rounds'} (round limit ${rounds}): the organizer-side planner's proposal did not change after the student side's latest report.`,
    );
  } else {
    notes.push(
      `Baseline D did not converge: it stopped at the round limit of ${rounds} before the student side confirmed the organizer's latest proposal. The table shows that latest proposal, checked by the same verifier.`,
    );
  }
  if (mismatches > 0) {
    notes.push(`Baseline D: the student side rejected ${mismatches} support combinations the organizer side expected to work; the organizer stopped using them.`);
  }
  if (limits.infeasible) {
    notes.push(
      "Baseline D found no plan that meets the organizer's requirements (required measures, minimum new pairs, fairness floors) together with the hard constraints, so, like the joint solver's main result, it proposes the empty plan. Requirements were not relaxed.",
    );
  }
  if (limits.node) notes.push(`Baseline D: the organizer-side search hit the node limit; optimality is not proven, so ${D_OPTIMALITY_NOT_PROVEN_MARKER}.`);
  if (limits.selections) {
    notes.push(`Baseline D: more than ${D_LIMITS.approvedInterventions} approved measures, so the organizer side only tried combinations of at most ${D_LIMITS.selectionSizeWhenLarge} measures; ${D_OPTIMALITY_NOT_PROVEN_MARKER}.`);
  }
  if (limits.revocations) {
    notes.push(`Baseline D: more than ${D_LIMITS.voluntaryRevocations} existing resources could be revoked voluntarily, so the organizer side only made forced revocations; ${D_OPTIMALITY_NOT_PROVEN_MARKER}.`);
  }
  if (student.limitedMenus) {
    notes.push(`Baseline D: some pairs had more than ${D_LIMITS.menuCandidates} candidate measures, so the student side only listed combinations of at most ${D_LIMITS.menuSizeWhenLarge} measures; ${D_OPTIMALITY_NOT_PROVEN_MARKER}.`);
  }
  if (student.limitedPatterns) {
    notes.push(`Baseline D: some pairs had more than ${D_LIMITS.relevantGrantsPerPair} revocable existing resources, so the student side only reported "none revoked" and "all revoked"; ${D_OPTIMALITY_NOT_PROVEN_MARKER}.`);
  }
  return { plan: proposal, claimed_reachable: claimed, coordination: { rounds: usedRounds, converged, max_rounds: rounds }, notes };
}
