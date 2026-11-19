/**
 * runWhatIf(scenario, input) — 主办方 What-if 页面的视图模型（纯函数，页面只负责渲染）。
 *
 * 流程：
 * 1. 处理勾选：enabledIds = 纳入考虑的措施；requiredIds = 主办方要求必须启用的措施（须是 enabledIds 的子集）。
 *    **前置依赖的处理**：已纳入、但其前置依赖（requires）未纳入的措施会被排除（迭代到不动点，规则与
 *    ./scenarios 的 resolveEnabledInterventions / withEnabledInterventions 相同），并在 `excluded` 与
 *    `assumptions` 里写明原因。不会出现「依赖没开、措施照样生效」。
 *    runWhatIf 不会替用户自动补上依赖（页面可以提供「一键带上」）。
 *    不在纳入范围内的必须启用项会被忽略，并在 `ignored_required` 里说明。
 *    **运行中的措施**（有已有 grant 指向它）不能被移除：未勾选（或依赖不全）时仍留在场景里、互斥与容量照常生效，
 *    只是不接受新分配（规则见 ./scenario-utils 的 withEnabledInterventions）；视图的 `running` 逐项说明。
 * 2. withEnabledInterventions / withBudget 得到场景 → solveJoint。
 * 3. 对主结果**独立再调用一次 verifyPlan**（相同的 mode / loss_cap / 软要求），页面展示的是这次复核。
 *    例外：求解器因「内部复核未通过」返回 UNSUPPORTED_INPUT 时，展示求解器保留的那次失败复核（被舍弃方案的复核），
 *    让页面能看到哪一项没通过。
 * 4. 汇总成 WhatIfView：只含汇总数字，不含任何学生的 id、姓名、学校或逐人明细；
 *    求解器 / 验证器文字里的措施 id 先换成标题，再把学生 id、姓名、学校替换为「某学生」/「某学校」，并注明涉及人数。
 * 5. 第 3 层：模式（保护 / 权衡）与损失上限、公平底线（从调用方传入的可用底线 availableFloors 里按 id 勾选，
 *    可覆盖最低比例）、基线对比（./baselines 的 compareBaselines，同一场景、同一选项）。
 *    视图只含汇总：失去的对数 / 受影响人数（及其中方案后仍有其他可达机会的人数）/ 按「被收回的措施 → 原因」汇总的人数，收回条数，
 *    「仍未覆盖」一律按（学生, 机会）对表述，人数（按学生去重）只作补充，并给出「仍至少有一个可达机会 / 没有任何可达机会」的人数，
 *    每条底线的分子 / 分母 / 比例与「当前启用的措施下最多可覆盖 X / Y」（solve 的 fairnessCoverageBounds），
 *    收回中待审批承诺的条数（不计入损失），基线每行的声称与复核后数字。lost_pairs、revocations、基线方案里的学生 id 不进视图。
 *    损失上限或底线比例不合法（空、负数、非整数、非有限数、tradeoff 未填上限）时**不调用求解器**，
 *    视图的 input_errors 写明原因，状态按 UNSUPPORTED_INPUT 显示，数字为 null。
 * 6. 没有评估出来的数字（UNSUPPORTED_INPUT 时的成本、余额、G / L / N 等）为 null，页面显示「—」。
 *    预算或最低新增目标不是有限数时不会抛错；视图里的文字不出现 NaN / Infinity（换成「未填写或无效」），
 *    非有限的数字字段一律为 null。页面本身应在输入无效时不调用 runWhatIf，这里只是防线。
 * 7. `runWhatIfWithPlan` = 同一次计算，另外返回主结果的方案明细 `WhatIfPlanDetail`（状态、复核是否通过、
 *    主结果与条件性结果的分配、参与求解的措施），只交给 ./bridge 的 decideBridge（「回到学生端的桥」），
 *    避免再求解一次；它含匿名学生编号与逐人分配，页面不得渲染。`runWhatIf` 只返回其中的 `view`。
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入。
 * 所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 */
import { analyzeReachability } from '../reachability';
import { plural, pluralNoun } from '../format';
import { compareBaselines } from './baselines';
import { fairnessCoverageBounds, solveJoint } from './solve';
import type { FloorCoverageBound } from './solve';
import { verifyPlan } from './verify';
import {
  isPlaceholderOpportunity,
  MIN_NAME_TOKEN_LENGTH,
  missingPrerequisites,
  resolveEnabledInterventions,
  runningInterventionIds,
  withBudget,
  withEnabledInterventions,
} from './scenario-utils';

// 页面（客户端组件）从这里拿同一个占位判定，保证 Placeholder 标签与假设说明一致。
export { isPlaceholderOpportunity, missingPrerequisites };
import type {
  Allocation,
  BarrierType,
  BaselineComparison,
  FairnessFloor,
  FairnessReport,
  GrantRevocation,
  Intervention,
  JointCost,
  JointOutcome,
  JointStatus,
  ResourceGrant,
  Scenario,
  SoftRequirementKey,
  SolveOptions,
  VerifyOptions,
} from '../types';

// ───────────────────────────── 类型 ─────────────────────────────

export interface WhatIfInput {
  /** 纳入考虑的措施 id。 */
  enabledIds: string[];
  /** 主办方要求必须启用的措施 id（须是 enabledIds 的子集，否则忽略并说明）。 */
  requiredIds: string[];
  /** 预算（美元）。 */
  budget: number;
  /** 最低新增目标（G ≥ minGain）；null / 缺省 = 不要求。 */
  minGain?: number | null;
  /** 缺省 protect（不允许原有覆盖减少）。 */
  mode?: 'protect' | 'tradeoff';
  /** tradeoff 模式下允许的最大损失（必填，非负整数）；protect 模式下忽略。 */
  lossCap?: number | null;
  /** 勾选的公平底线 id（取自 runWhatIf 第三个参数 availableFloors）；缺省 = 不设底线。 */
  fairnessFloorIds?: string[];
  /** 可选：按底线 id 覆盖最低比例（0–1）。只对勾选的底线生效。 */
  minRatioOverrides?: Record<string, number>;
}

export interface WhatIfLabels {
  /** 「模拟结果，不代表真实影响」 */
  simulation: string;
  /** 「示例学生 / 示例场景」 */
  sample: string;
  /** 「占位机会，待替换为已核实的真实机会」 */
  placeholder_opportunity: string;
  /** 可达 ≠ 录取 */
  reachable_not_admission: string;
}

/** 主结果的成本。null = 没有评估（UNSUPPORTED_INPUT）或输入无效，页面显示「—」。 */
export interface WhatIfCost {
  fixed_usd: number | null;
  /** 按人计的成本合计（各措施 unit_cost × 服务的不同学生数）。 */
  per_student_usd: number | null;
  total_usd: number | null;
  /** 预算；不是有限数时为 null。 */
  budget_usd: number | null;
  /** 预算 − 总成本；没有评估或预算无效时为 null。 */
  remaining_usd: number | null;
}

/** 已评估方案（替代方案 / 条件性方案）的成本，总是有数字。 */
export interface WhatIfPlanCost {
  fixed_usd: number;
  per_student_usd: number;
  total_usd: number;
}

export interface WhatIfSelected {
  id: string;
  title: string;
  /** 本措施服务的不同学生人数。 */
  students_served: number;
  fixed_usd: number;
  per_student_usd: number;
  subtotal_usd: number;
}

export interface WhatIfCapacitySlot {
  /** 范围说明：「全场景」或「时段 xxx」。 */
  scope_label: string;
  used: number;
  capacity: number | null;
  full: boolean;
}

export interface WhatIfCapacity {
  id: string;
  title: string;
  selected: boolean;
  /** 运行中（有已有资源在使用）。 */
  running: boolean;
  /** 运行中但本次不接受新分配（未勾选或前置依赖不全）。 */
  frozen: boolean;
  /** 该措施的已有资源（grant）条数（收回前）。 */
  existing_grants: number;
  /** 本方案收回的已有资源条数。 */
  revoked_existing: number;
  /** 本方案中已停用：运行中的已有资源全部收回、且没有新增分配（页面不再显示名额占用）。 */
  deactivated: boolean;
  /** 名称后的括注（如「（运行中）」「（本方案中已停用，已有资源全部收回）」）；没有则为空字符串。 */
  status_note: string;
  /** 不限容量时为空数组。 */
  slots: WhatIfCapacitySlot[];
  unlimited: boolean;
}

export interface WhatIfCheck {
  name: string;
  /** 中文标签。 */
  label: string;
  passed: boolean;
  /** 说明（已去除学生 id / 姓名 / 学校）。 */
  detail: string;
}

export interface WhatIfVerification {
  passed: boolean;
  checks: WhatIfCheck[];
  /** 解读复核结果的补充说明（如 INFEASIBLE 时空方案不满足主办方要求是预期的）；没有则为 null。 */
  note: string | null;
}

export interface WhatIfOutcomeSummary {
  R1_count: number;
  G: number;
  L: number;
  N: number;
  cost: WhatIfPlanCost;
  selected: WhatIfSelected[];
  /** 收回已有资源的条数汇总（不含学生）。 */
  revocation_counts: WhatIfRevocationCounts;
  /** 失去可达的说明（L > 0 时非空），只含人数。 */
  loss_text: string | null;
  /** 公平底线结果（未设底线时为空数组）。 */
  fairness: WhatIfFairnessRow[];
}

export interface WhatIfRevocationCounts {
  total: number;
  forced: number;
  voluntary: number;
  /** 其中收回的待审批（pending）承诺条数：pending 本来就不化解障碍，收回它们不计入损失，只腾出名额。 */
  pending: number;
}

/** 按「被收回的措施 → 原因（被哪项新措施替换 / 自愿收回）」汇总的一组损失。 */
export interface WhatIfLossGroup {
  revoked_title: string;
  /** 导致强制收回的新措施标题；自愿收回为 null。 */
  forced_by_title: string | null;
  /** 收回的已有 grant 条数。 */
  revoked_count: number;
  /** 因此失去可达的不同学生人数（按学生去重）。 */
  students: number;
  /** 其中方案后仍至少有一个可达机会的学生人数。 */
  students_still_reachable: number;
  /** 因此失去可达的（学生, 机会）对数。 */
  pairs: number;
  text: string;
}

export interface WhatIfLoss {
  /** 失去可达的（学生, 机会）对数（= L）。 */
  lost_pairs: number;
  /** 受影响的不同学生人数（按学生去重）。 */
  affected_students: number;
  /** 受影响的学生中，方案后仍至少有一个可达机会的人数（多机会场景下失去一个对不等于失去全部机会）。 */
  affected_students_still_reachable: number;
  /** 汇总句：「失去 X 个（学生, 机会）对，涉及 Y 名学生，其中 Z 名在方案后仍有其他可达的机会」；L = 0 时为 null。 */
  summary: string | null;
  groups: WhatIfLossGroup[];
  /** tradeoff 且 L > 0 时的醒目说明；否则 null。 */
  headline: string | null;
  /** protect 模式的说明（「保护模式不会收回任何已有资源」）；tradeoff 时为 null。 */
  protect_note: string | null;
}

export interface WhatIfRevocationItem {
  title: string;
  /** 收回的条数。 */
  count: number;
  reason: string;
}

export interface WhatIfRevocations extends WhatIfRevocationCounts {
  items: WhatIfRevocationItem[];
}

export interface WhatIfFairnessRow {
  floor_id: string;
  label: string;
  basis: string;
  /** 分母：该群体中至少对一个机会符合官方资格的学生数。 */
  eligible_members: number;
  /** 分子：其中方案后至少有一个可达对的学生数。 */
  covered_members: number;
  /** 比例（百分比，保留 1 位小数）；分母为 0 时为 null。 */
  ratio_percent: number | null;
  /** 要求的最低比例（百分比）。 */
  min_ratio_percent: number;
  satisfied: boolean;
  /** 分母为 0：不适用（自动满足）。 */
  not_applicable: boolean;
  /**
   * 当前启用的措施下该群体最多可覆盖的人数（上界：本来就可达，或至少一个机会存在可行的措施组合；不考虑名额与预算）。
   * 没有计算（如条件性结果）时为 null。分母仍是全部符合资格的成员，即使其中有人无论如何都不可达。
   */
  max_coverable: number | null;
  /** 上界的说明（只含人数）；max_coverable 为 null 时为 null。 */
  bound_text: string | null;
  text: string;
}

export interface WhatIfBaselineMetrics {
  R1_count: number;
  G: number;
  L: number;
  N: number;
  total_usd: number;
}

export interface WhatIfBaselineRow {
  id: string;
  label: string;
  description: string;
  /** 该做法自己声称的可达对数（不经复核）。 */
  claimed_reachable: number;
  /** 可执行性检查是否全部通过。 */
  executable: boolean;
  /** 不通过的可执行性检查（中文标签）。 */
  failed_checks: string[];
  /** 可执行时的复核后数字；否则 null（页面标「不可执行」，不显示原方案的数字）。 */
  verified: WhatIfBaselineMetrics | null;
  /** 先到先得截断后的数字与说明；没有截断时为 null。 */
  repaired: (WhatIfBaselineMetrics & { note: string }) | null;
  /** 是否满足主办方要求（必须启用 / 最低新增 / 公平底线）；没设要求时为 null。 */
  soft_requirements_met: boolean | null;
  /** 「是 / 否 / 未设要求」等中文说明。 */
  soft_label: string;
}

export interface WhatIfBaselines {
  rows: WhatIfBaselineRow[];
  notes: string[];
}

export interface WhatIfAlternative extends WhatIfOutcomeSummary {
  /** 放松了哪些要求（中文）。 */
  relaxed: string[];
  note: string;
}

export interface WhatIfConditional extends WhatIfOutcomeSummary {
  status: JointStatus;
  status_label: string;
  /** 假设获批的措施标题。 */
  assumed_approved: string[];
  /** 与当前结果相比的差异。 */
  delta: { G: number; L: number; N: number; total_usd: number };
  /** 对条件性方案的独立复核是否通过（带 assume_approved）。 */
  verification_passed: boolean;
  note: string;
}

export interface WhatIfUncoveredReason {
  /** 障碍类型或 'eligibility' / 'unknown' / 'revoked'（原本可达、因收回已有资源而不再可达）。 */
  kind: BarrierType | 'eligibility' | 'unknown' | 'revoked';
  /** 涉及的（学生, 机会）对数。 */
  pairs: number;
  /** 涉及的不同学生人数（按学生去重）。 */
  students: number;
  /** 可能原因（中文）。 */
  cause: string;
  /** 完整一句话，按（学生, 机会）对表述，人数作补充，如「5 个（学生, 机会）对仍缺设备（涉及 5 名学生）：名额已满」。 */
  text: string;
}

export interface WhatIfUncovered {
  /** 方案后仍不可达的（学生, 机会）对数。 */
  pairs: number;
  /** 至少有一个机会仍不可达的不同学生人数（按学生去重）。 */
  students: number;
  /** 上述学生中，方案后仍至少有一个可达机会的人数。 */
  students_with_some_reachable: number;
  /** 方案后没有任何可达机会的学生人数（全部学生中；= students − students_with_some_reachable）。 */
  students_with_none_reachable: number;
  /** 汇总句（按对表述，人数作补充）。 */
  summary: string;
  reasons: WhatIfUncoveredReason[];
}

/** 运行中的措施（有已有资源在使用，不能从方案中移除）。 */
export interface WhatIfRunning {
  id: string;
  title: string;
  /** 已有资源（grant）条数。 */
  existing_grants: number;
  /** 本次是否接受新分配（勾选且前置依赖满足）。 */
  accepts_new: boolean;
  note: string;
}

export interface WhatIfExcluded {
  id: string;
  title: string;
  /** 缺少的前置依赖（标题）。 */
  missing_requires: string[];
  reason: string;
}

export interface WhatIfView {
  scenario_title: string;
  evaluation_date: string;
  is_sample: true;
  student_count: number;
  opportunities: { title: string; is_placeholder: boolean }[];
  /** 实际参与求解的设置。 */
  effective: {
    enabled_ids: string[];
    required_ids: string[];
    /** 不是有限数时为 null。 */
    budget_usd: number | null;
    /** 不设目标或不是有限数时为 null。 */
    min_gain: number | null;
    mode: 'protect' | 'tradeoff';
    loss_cap: number | null;
    /** 参与求解的公平底线（已应用比例覆盖）。 */
    fairness_floor_ids: string[];
    /** 运行中但本次不接受新分配的措施（仍在场景里，互斥与容量照常生效）。 */
    frozen_ids: string[];
  };
  /** 输入级问题（损失上限、底线比例等不合法）；非空时没有调用求解器。 */
  input_errors: string[];
  mode: 'protect' | 'tradeoff';
  /** tradeoff 时的损失上限；protect 或未填时为 null。 */
  loss_cap: number | null;
  mode_label: string;
  mode_explanation: string;
  /** 因前置依赖未纳入而被排除的措施（不含运行中的措施）。 */
  excluded: WhatIfExcluded[];
  /** 运行中的措施（按场景顺序）。 */
  running: WhatIfRunning[];
  /** 被忽略的「必须启用」项。 */
  ignored_required: { id: string; title: string; reason: string }[];
  status: JointStatus;
  status_label: string;
  status_explanation: string;
  /** 以下五个数在 UNSUPPORTED_INPUT（没有评估）时为 null。 */
  R0_count: number | null;
  R1_count: number | null;
  G: number | null;
  L: number | null;
  N: number | null;
  cost: WhatIfCost;
  selected: WhatIfSelected[];
  capacity_usage: WhatIfCapacity[];
  verification: WhatIfVerification;
  alternative: WhatIfAlternative | null;
  conditional: WhatIfConditional | null;
  /** UNSUPPORTED_INPUT 时为 null（没有评估）。 */
  uncovered: WhatIfUncovered | null;
  /** 失去可达的汇总；没有评估时为 null。 */
  loss: WhatIfLoss | null;
  /** 收回已有资源的汇总；没有评估时为 null。 */
  revocations: WhatIfRevocations | null;
  /** 公平底线结果；不设底线或没有评估时为空数组。 */
  fairness: WhatIfFairnessRow[];
  /** 基线对比；没有调用求解器（input_errors 非空）时为 null。 */
  baselines: WhatIfBaselines | null;
  /** 求解器说明（已脱敏）。 */
  solver_notes: string[];
  assumptions: string[];
  labels: WhatIfLabels;
}

// ───────────────────────────── 常量 ─────────────────────────────

export const WHATIF_LABELS: WhatIfLabels = {
  simulation: 'Simulated results. They do not represent real-world impact.',
  sample: 'Sample students / sample scenario',
  placeholder_opportunity: 'Placeholder opportunity, to be replaced with a verified real one',
  reachable_not_admission: 'Reachable does not mean admitted: reachable only means no eligibility conflict and workable real-world conditions',
};

export const STATUS_LABELS: Record<JointStatus, string> = {
  OPTIMAL: 'Optimal plan found',
  INFEASIBLE: 'Not achievable',
  SEARCH_LIMIT_REACHED: 'Search limit reached',
  UNSUPPORTED_INPUT: 'Unsupported input',
};

const STATUS_EXPLANATIONS: Record<JointStatus, string> = {
  OPTIMAL:
    'Full search completed: under the current selection, budget and requirements, no plan is better than this one (compared by net change, then number lost, then cost).',
  INFEASIBLE:
    'Not achievable: without breaking hard constraints (capacity, budget, mutual exclusion, prerequisites, loss cap), your requirements (required support measures / minimum new coverage / fairness floors) cannot all be met. The current result enables no support measures. A relaxed alternative is shown below; the solver did not silently lower your requirements.',
  SEARCH_LIMIT_REACHED:
    'Stopped at the search limit: this is the best plan found within the limit that passed independent verification. It is not guaranteed optimal, and a better plan may exist.',
  UNSUPPORTED_INPUT:
    'Invalid input or outside what the solver supports (or the solver\'s internal verification failed and it was treated as unsupported input), so no plan is given. See the solver notes for the reason.',
};

export const CHECK_LABELS: Record<string, string> = {
  input_validity: 'Input is valid',
  approval: 'All support measures approved',
  mutual_exclusion: 'No mutually exclusive measures enabled together',
  prerequisite: 'Prerequisites enabled',
  allocation_validity: 'Allocations are valid',
  capacity: 'Within capacity',
  cost_accounting: 'Cost accounting is correct',
  budget: 'Within budget',
  eligibility: 'Eligibility cross-check (support measures do not change official eligibility)',
  deadline: 'Deadline cross-check',
  barrier_resolution: 'Barriers actually removed',
  coverage_loss: 'Lost reachable pairs within the allowed limit',
  revocation: 'Rules for revoking existing resources',
  organizer_requirements: 'Organizer requirements',
  fairness: 'Fairness floors',
  metrics: 'Metrics match recomputation',
};

const BARRIER_ZH: Record<BarrierType, string> = {
  device: 'a device',
  transport: 'transport',
  cost: 'funding for costs',
  time: 'time',
};

const RELAXED_ZH: Record<SoftRequirementKey, string> = {
  required_intervention_ids: 'Required support measures no longer required',
  min_gain: 'Minimum new coverage target no longer required',
  fairness_floors: 'Fairness floors no longer required',
};

export const MODE_LABELS: Record<'protect' | 'tradeoff', string> = {
  protect: 'Protected mode',
  tradeoff: 'Trade-off mode',
};

export const MODE_EXPLANATIONS: Record<'protect' | 'tradeoff', string> = {
  protect: 'Protected mode: existing commitments are never touched. No resource already given out is revoked, so previously reachable (student, opportunity) pairs never drop.',
  tradeoff:
    'Trade-off mode: existing resources (including ones that must stop because they conflict with a new measure) may be revoked only when the organizer sets a loss cap. Lost reachable pairs stay within the cap, and the plan states how many were lost and why.',
};

export const PROTECT_LOSS_NOTE = 'Protected mode never revokes existing resources, so previously reachable (student, opportunity) pairs never drop.';

/** INFEASIBLE 时「仍未覆盖」的障碍原因。 */
export const INFEASIBLE_UNCOVERED_CAUSE = 'The current requirements cannot be met, so the main result enables no support measures; see the alternative above';

const EPS = 1e-6;
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (x: number): number => Math.round(x * 100) / 100;
const isApproved = (iv: Intervention) => iv.status !== 'pending';
const pairKey = (s: string, o: string) => JSON.stringify([s, o]);

// ───────────────────────────── 辅助 ─────────────────────────────

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 把文字中的学生 id / 显示名 / 学校名替换为「某学生」/「某学校」，并在末尾注明涉及人数。
 * - 按长度降序替换（先长后短），避免 dl-s1 误伤 dl-s10。
 * - 学生 id（任意长度）只在边界处替换：前后都不是 ASCII 字母数字、连字符或下划线。
 * - 姓名 / 学校名短于 3 个字符时不做子串替换（避免把 "X" 当学校名改坏 "Xavier"）；
 *   这类短标识要靠场景校验（措施 id / 标题不得含学生信息）兜底。
 */
export function scrubStudentInfo(text: string, scenario: Scenario): string {
  type Tok = { token: string; sid: string; repl: string; isId: boolean };
  const toks: Tok[] = [];
  for (const s of scenario.students) {
    if (typeof s.id === 'string' && s.id) toks.push({ token: s.id, sid: s.id, repl: 'a student', isId: true });
    if (typeof s.display_name === 'string' && s.display_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.display_name, sid: s.id, repl: 'a student', isId: false });
    }
    if (typeof s.school_name === 'string' && s.school_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.school_name, sid: s.id, repl: 'a school', isId: false });
    }
  }
  toks.sort((a, b) => b.token.length - a.token.length || cmpStr(a.token, b.token));
  const hit = new Set<string>();
  let out = text;
  for (const t of toks) {
    if (t.isId) {
      const re = new RegExp(`(?<![A-Za-z0-9_-])${escapeRe(t.token)}(?![A-Za-z0-9_-])`, 'g');
      if (re.test(out)) {
        hit.add(t.sid);
        re.lastIndex = 0;
        out = out.replace(re, t.repl);
      }
    } else if (out.includes(t.token)) {
      hit.add(t.sid);
      out = out.split(t.token).join(t.repl);
    }
  }
  if (hit.size > 0) out += ` (involves ${plural(hit.size, 'student')}; identities hidden)`;
  return out;
}

/** 把文字中用「」括起来的措施 id 换成措施标题（求解器 / 验证器的说明里用的是 id）。 */
function humanizeInterventionIds(text: string, scenario: Scenario): string {
  let out = text;
  const ivs = [...scenario.interventions].sort((a, b) => b.id.length - a.id.length || cmpStr(a.id, b.id));
  for (const iv of ivs) out = out.split(`"${iv.id}"`).join(`"${iv.title}"`);
  return out;
}

/** 先把措施 id 换成标题，再脱敏（换进去的标题也会被检查）。 */
function cleanText(text: string, scenario: Scenario): string {
  return scrubStudentInfo(humanizeInterventionIds(text, scenario), scenario);
}

const INVALID_NUMBER_TEXT = 'missing or invalid';

/** 防线：把视图里所有文字中的 NaN / Infinity 换成「未填写或无效」，非有限数字换成 null。 */
function scrubNonFinite<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/[-+]?Infinity|NaN/g, INVALID_NUMBER_TEXT);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** 已纳入、但前置依赖未纳入的措施会被排除（迭代到不动点；规则见 resolveEnabledInterventions）。 */
function resolvePrerequisites(
  scenario: Scenario,
  enabledIds: readonly string[],
): { enabled: string[]; excluded: WhatIfExcluded[]; running: WhatIfRunning[]; frozen: string[] } {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const title = (id: string) => byId.get(id)?.title ?? id;
  const { enabled, removed, running: runningIds, frozen } = resolveEnabledInterventions(scenario, enabledIds);
  const frozenById = new Map(frozen.map((f) => [f.id, f]));
  const running: WhatIfRunning[] = runningIds.map((id) => {
    const n = (scenario.existing_grants ?? []).filter((g) => g.intervention_id === id).length;
    const f = frozenById.get(id);
    const base = `"${title(id)}" already has ${plural(n, 'resource')} in use and cannot be removed from the plan; unchecking it only stops new allocations. `;
    const extra = !f
      ? 'It accepts new allocations this time.'
      : f.reason === 'unchecked'
        ? 'Unchecked this time: existing resources stay in effect and keep their capacity, measures that conflict with it are still restricted, but no new allocations are made.'
        : `Missing prerequisite ${f.missing_requires.map((r) => `"${title(r)}"`).join(', ')} this time: existing resources stay in effect and keep their capacity, but no new allocations are made.`;
    return { id, title: title(id), existing_grants: n, accepts_new: !f, note: base + extra };
  });
  const excluded: WhatIfExcluded[] = removed.map((r) => {
    const names = r.missing_requires.map(title);
    return {
      id: r.id,
      title: title(r.id),
      missing_requires: names,
      reason: `"${title(r.id)}" requires ${names.map((n) => `"${n}"`).join(', ')}, which is not included, so this support measure was left out of the solve.`,
    };
  });
  return { enabled, excluded, running, frozen: frozen.map((f) => f.id) };
}

function synthGrant(scenario: Scenario, iv: Intervention, a: Allocation): ResourceGrant {
  return {
    id: 'alloc:' + a.intervention_id + ':' + a.student_id + ':' + a.opportunity_id,
    student_id: a.student_id,
    opportunity_id: a.opportunity_id,
    intervention_id: a.intervention_id,
    type: iv.type,
    amount_usd: iv.amount_usd ?? null,
    device: iv.device ?? null,
    hours_per_week: iv.hours_per_week ?? null,
    status: 'approved',
    provider: scenario.title,
    is_sample: true,
  };
}

function summarizeSelected(scenario: Scenario, outcome: JointPlan2): WhatIfSelected[] {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  return outcome.selected_intervention_ids.map((id) => {
    const iv = byId.get(id);
    const allocs = outcome.allocations.filter((a) => a.intervention_id === id);
    const served = new Set(allocs.map((a) => a.student_id)).size;
    const fixed = iv?.fixed_cost_usd ?? 0;
    const per = allocs.reduce((s, a) => s + a.cost_usd, 0);
    return {
      id,
      title: iv?.title ?? id,
      students_served: served,
      fixed_usd: round2(fixed),
      per_student_usd: round2(per),
      subtotal_usd: round2(fixed + per),
    };
  });
}

type JointPlan2 = Pick<JointOutcome, 'selected_intervention_ids' | 'allocations'>;

function costOf(c: JointCost): WhatIfPlanCost {
  return { fixed_usd: round2(c.fixed_usd), per_student_usd: round2(c.marginal_usd), total_usd: round2(c.total_usd) };
}

function revocationCounts(scenario: Scenario, revs: readonly GrantRevocation[] | undefined): WhatIfRevocationCounts {
  const list = revs ?? [];
  const status = new Map((scenario.existing_grants ?? []).map((g) => [g.id, g.status]));
  const forced = list.filter((r) => r.forced_by !== null).length;
  const pending = list.filter((r) => status.get(r.grant_id) === 'pending').length;
  return { total: list.length, forced, voluntary: list.length - forced, pending };
}

function lossText(L: number, counts: WhatIfRevocationCounts): string | null {
  if (L <= 0) return null;
  return (
    `Lost ${L} previously reachable (student, opportunity) ${pluralNoun(L, 'pair')}: revoked ${plural(counts.total, 'existing resource')} (${counts.forced} forced by mutual exclusion, ${counts.voluntary} voluntary)` +
    (counts.pending > 0 ? `; ${counts.pending} of them ${pluralNoun(counts.pending, 'is a pending-approval commitment and does', 'are pending-approval commitments and do')} not count as losses.` : '.')
  );
}

const pct = (x: number) => Math.round(x * 1000) / 10;

function fairnessRows(
  reports: readonly FairnessReport[] | undefined,
  floors: readonly FairnessFloor[],
  bounds: readonly FloorCoverageBound[] | null = null,
): WhatIfFairnessRow[] {
  const byId = new Map(floors.map((f) => [f.id, f]));
  const boundById = new Map((bounds ?? []).map((b) => [b.floor_id, b]));
  return (reports ?? []).map((r) => {
    const b = boundById.get(r.floor_id);
    const maxCov = b && r.ratio !== null ? b.max_coverable : null;
    const f = byId.get(r.floor_id);
    const label = f?.label ?? r.floor_id;
    const ratio = r.ratio === null ? null : pct(r.ratio);
    const min = pct(r.min_ratio);
    const text =
      r.ratio === null
        ? `${label}: no eligible students from this group in the scenario (denominator is 0), so this floor does not apply (treated as met).`
        : `${label}: ${r.covered_members} of ${plural(r.eligible_members, 'eligible student')} ${pluralNoun(r.covered_members, 'has', 'have')} at least one reachable opportunity after the plan (${ratio}%), required at least ${min}%, ${r.satisfied ? 'met' : 'not met'}.`;
    return {
      floor_id: r.floor_id,
      label,
      basis: f?.basis ?? '',
      eligible_members: r.eligible_members,
      covered_members: r.covered_members,
      ratio_percent: ratio,
      min_ratio_percent: min,
      satisfied: r.satisfied,
      not_applicable: r.ratio === null,
      max_coverable: maxCov,
      bound_text:
        maxCov === null
          ? null
          : `With the enabled support measures, at most ${maxCov} / ${r.eligible_members} can be covered` +
            (maxCov < r.eligible_members
              ? `. For the other ${r.eligible_members - maxCov}, no combination of the enabled measures in this mode gives them a reachable opportunity, whatever the capacity and budget (for example, no measure removes what they lack), but they still count in the denominator.`
              : ' (an upper bound ignoring capacity and budget; it may not be reachable all at once).'),
      text,
    };
  });
}

function outcomeSummary(
  scenario: Scenario,
  o: JointOutcome,
  floors: readonly FairnessFloor[],
  bounds: readonly FloorCoverageBound[] | null = null,
): WhatIfOutcomeSummary {
  const counts = revocationCounts(scenario, o.revocations);
  return {
    R1_count: o.R1.length,
    G: o.G,
    L: o.L,
    N: o.N,
    cost: costOf(o.cost),
    selected: summarizeSelected(scenario, o),
    revocation_counts: counts,
    loss_text: lossText(o.L, counts),
    fairness: fairnessRows(o.fairness, floors, bounds),
  };
}

const DEFAULT_SLOT = '\u0000default';

function capacityUsage(
  scenario: Scenario,
  plan: JointPlan2 & { revoked_grant_ids?: string[] },
  frozen: readonly string[],
): WhatIfCapacity[] {
  const revoked = new Set(plan.revoked_grant_ids ?? []);
  const slotOf = (oid: string | null | undefined): string => {
    const slots = scenario.opportunity_time_slots;
    if (slots && oid != null && Object.prototype.hasOwnProperty.call(slots, oid)) return slots[oid];
    return DEFAULT_SLOT;
  };
  const allSlots = [...new Set([DEFAULT_SLOT, ...Object.values(scenario.opportunity_time_slots ?? {})])].sort(cmpStr);
  const usedSlots = new Set(scenario.opportunities.map((o) => slotOf(o.id)));
  const selected = new Set(plan.selected_intervention_ids);
  const running = new Set(runningInterventionIds(scenario));
  const frozenSet = new Set(frozen);
  return scenario.interventions
    .filter(isApproved)
    .map((iv) => {
      const allocs = plan.allocations.filter((a) => a.intervention_id === iv.id);
      const allExisting = (scenario.existing_grants ?? []).filter((g) => g.intervention_id === iv.id);
      // 被本方案收回的已有 grant 不占名额（契约第 3 条第 5 款只数 E'）。
      const existing = allExisting.filter((g) => !revoked.has(g.id));
      const revokedN = allExisting.length - existing.length;
      const isRunning = running.has(iv.id);
      const isFrozen = frozenSet.has(iv.id);
      const isSelected = selected.has(iv.id);
      const deactivated = isRunning && allExisting.length > 0 && revokedN === allExisting.length && allocs.length === 0;
      const status_note = deactivated
        ? '(stopped in this plan; all existing resources revoked)'
        : isRunning && revokedN > 0
          ? `(running; this plan revokes ${revokedN} / ${allExisting.length} existing resources${isFrozen ? ', no new allocations' : allocs.length > 0 ? '' : ', no new allocations made'}; remaining usage below)`
          : isFrozen
            ? '(running, no new allocations)'
            : isRunning
              ? isSelected
                ? '(running)'
                : '(running, no new allocations in this plan)'
              : isSelected
                ? ''
                : '(not enabled)';
      const flags = {
        running: isRunning,
        frozen: isFrozen,
        existing_grants: allExisting.length,
        revoked_existing: revokedN,
        deactivated,
        status_note,
      };
      if (iv.capacity == null) {
        return { id: iv.id, title: iv.title, selected: selected.has(iv.id), ...flags, slots: [], unlimited: true };
      }
      const cap = iv.capacity;
      let slots: WhatIfCapacitySlot[];
      if (iv.capacity_scope === 'per_time_slot') {
        slots = allSlots
          .filter((t) => usedSlots.has(t))
          .map((t) => {
            const set = new Set<string>();
            for (const g of existing) if (g.opportunity_id === null || slotOf(g.opportunity_id) === t) set.add(String(g.student_id));
            for (const a of allocs) if (slotOf(a.opportunity_id) === t) set.add(a.student_id);
            return {
              scope_label: t === DEFAULT_SLOT ? 'Default time slot' : `Time slot ${t}`,
              used: set.size,
              capacity: cap,
              full: set.size >= cap - EPS,
            };
          });
      } else {
        const set = new Set<string>();
        for (const g of existing) set.add(String(g.student_id));
        for (const a of allocs) set.add(a.student_id);
        slots = [{ scope_label: 'Whole scenario', used: set.size, capacity: cap, full: set.size >= cap - EPS }];
      }
      return { id: iv.id, title: iv.title, selected: selected.has(iv.id), ...flags, slots, unlimited: false };
    });
}

function uncoveredSummary(
  scenario: Scenario,
  fullScenario: Scenario,
  outcome: JointOutcome,
  capacity: WhatIfCapacity[],
  remainingBudget: number,
  infeasible: boolean,
  frozen: ReadonlySet<string>,
): WhatIfUncovered {
  const ivById = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const r1 = new Set(outcome.R1.map((p) => pairKey(p.student_id, p.opportunity_id)));
  const lost = new Set((outcome.lost_pairs ?? []).map((p) => pairKey(p.student_id, p.opportunity_id)));
  const revoked = new Set(outcome.revoked_grant_ids ?? []);
  // 按 E'（未被收回的已有 grant）分析仍未覆盖的原因。
  const existing = (scenario.existing_grants ?? []).filter((g) => !revoked.has(g.id));
  const byKind = new Map<WhatIfUncoveredReason['kind'], Set<string>>();
  const pairsByKind = new Map<WhatIfUncoveredReason['kind'], number>();
  const kindsOf = new Map<string, Set<WhatIfUncoveredReason['kind']>>();
  const add = (k: WhatIfUncoveredReason['kind'], sid: string) => {
    const set = byKind.get(k) ?? new Set<string>();
    set.add(sid);
    byKind.set(k, set);
    pairsByKind.set(k, (pairsByKind.get(k) ?? 0) + 1);
    const ks = kindsOf.get(sid) ?? new Set<WhatIfUncoveredReason['kind']>();
    ks.add(k);
    kindsOf.set(sid, ks);
  };
  let pairs = 0;
  const students = new Set<string>();
  for (const s of scenario.students) {
    for (const o of scenario.opportunities) {
      if (r1.has(pairKey(s.id, o.id))) continue;
      pairs++;
      students.add(s.id);
      if (lost.has(pairKey(s.id, o.id))) {
        add('revoked', s.id);
        continue;
      }
      const grants: ResourceGrant[] = [...existing];
      for (const a of outcome.allocations) {
        if (a.student_id !== s.id || a.opportunity_id !== o.id) continue;
        const iv = ivById.get(a.intervention_id);
        if (iv) grants.push(synthGrant(scenario, iv, a));
      }
      const res = analyzeReachability(s, o, grants, { today: scenario.evaluation_date });
      const hardFail = res.eligibility.items.some((r) => r.hard && r.status === 'not_satisfied');
      if (hardFail) add('eligibility', s.id);
      const unresolved = res.barriers.filter((b) => !b.resolved).map((b) => b.type);
      for (const t of unresolved) add(t, s.id);
      if (!hardFail && unresolved.length === 0) add('unknown', s.id);
    }
  }

  const selected = new Set(outcome.selected_intervention_ids);
  const causeFor = (t: BarrierType, who: Set<string>): string => {
    // INFEASIBLE：主结果是空方案，是因为主办方提的要求做不到，不是名额、预算或其他约束挡住了这些学生。
    if (infeasible) return INFEASIBLE_UNCOVERED_CAUSE;
    // 只用于解释（展示用），求解与复核都不读 resolves。
    // 运行中但不接受新分配的措施不能再化解新的障碍，不算「能化解它的措施」。
    const enabled = scenario.interventions.filter((iv) => iv.resolves.includes(t) && !frozen.has(iv.id));
    const enabledApproved = enabled.filter(isApproved);
    if (enabledApproved.length === 0) {
      if (enabled.length > 0) return 'the measure that removes it is pending approval and not counted in the current result';
      if (fullScenario.interventions.some((iv) => iv.resolves.includes(t))) return 'the measure that removes it is not included in the plan';
      return 'no support measure in the scenario removes it';
    }
    const full = enabledApproved.some(
      (iv) => selected.has(iv.id) && capacity.find((c) => c.id === iv.id)?.slots.some((sl) => sl.full),
    );
    if (full) return 'capacity is full';
    const minExtra = Math.min(
      ...enabledApproved.map((iv) => iv.unit_cost_usd + (selected.has(iv.id) ? 0 : iv.fixed_cost_usd ?? 0)),
    );
    if (minExtra > remainingBudget + EPS) return 'not enough budget';
    const allBlockedElsewhere = [...who].every((sid) => (kindsOf.get(sid)?.size ?? 0) > 1);
    if (allBlockedElsewhere) return 'these students also lack other conditions, so removing only this barrier would not make them reachable; the plan does not allocate for it';
    return 'other constraints such as mutual exclusion or prerequisites keep the plan from covering them';
  };

  const order: WhatIfUncoveredReason['kind'][] = ['revoked', 'eligibility', 'device', 'transport', 'cost', 'time', 'unknown'];
  const reasons: WhatIfUncoveredReason[] = [];
  for (const k of order) {
    const set = byKind.get(k);
    if (!set || set.size === 0) continue;
    const n = set.size;
    const pc = pairsByKind.get(k) ?? 0;
    const one = pc === 1;
    const who = `${pc} (student, opportunity) ${pluralNoun(pc, 'pair')}`;
    const tail = ` (${plural(n, 'student')})`;
    if (k === 'revoked') {
      const cause = `${one ? 'was' : 'were'} reachable before, but not under this plan because existing resources were revoked (see "Lost")`;
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who}${tail} ${cause}` });
    } else if (k === 'eligibility') {
      const cause = 'support measures cannot change official eligibility';
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who} ${one ? 'does' : 'do'} not meet official eligibility${tail}: ${cause}` });
    } else if (k === 'unknown') {
      const cause = 'not enough information; confirm with the organizer or the student';
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who} cannot be judged reachable or not${tail}: ${cause}` });
    } else {
      const cause = causeFor(k, set);
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who} still ${one ? 'lacks' : 'lack'} ${BARRIER_ZH[k]}${tail}: ${cause}` });
    }
  }
  // 按学生去重：方案后至少有一个可达机会的学生（只用于汇总人数，不进视图）。
  const reachableStudents = new Set(outcome.R1.map((p) => p.student_id));
  const some = [...students].filter((sid) => reachableStudents.has(sid)).length;
  const none = scenario.students.filter((s) => !reachableStudents.has(s.id)).length;
  const summary =
    pairs === 0
      ? 'All (student, opportunity) pairs are reachable after the plan.'
      : `${pairs} (student, opportunity) ${pluralNoun(pairs, 'pair is', 'pairs are')} still not reachable after the plan, involving ${plural(students.size, 'sample student')}; ${some} of them still ${pluralNoun(some, 'has', 'have')} at least one reachable opportunity after the plan, and ${plural(none, 'student')} ${pluralNoun(none, 'has', 'have')} no reachable opportunity after the plan.`;
  return {
    pairs,
    students: students.size,
    students_with_some_reachable: some,
    students_with_none_reachable: none,
    summary,
    reasons,
  };
}

// ───────────────────────────── 第 3 层：输入检查与汇总 ─────────────────────────────

/** 损失上限：tradeoff 模式下必填、非负整数；protect 模式下忽略。 */
function checkLossCap(mode: 'protect' | 'tradeoff', raw: unknown): { value: number | null; error: string | null } {
  if (mode !== 'tradeoff') return { value: null, error: null };
  if (raw === null || raw === undefined) {
    return {
      value: null,
      error: 'Trade-off mode needs a loss cap (a whole number, 0 or more): the most previously reachable (student, opportunity) pairs allowed to become unreachable under the new plan. Nothing is computed until it is filled in.',
    };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
    return { value: null, error: 'The loss cap must be a whole number, 0 or more.' };
  }
  return { value: raw, error: null };
}

/** 从可用底线里按 id 勾选（按可用列表的顺序），并应用最低比例覆盖。 */
function selectFloors(
  available: readonly FairnessFloor[],
  ids: readonly string[] | undefined,
  overrides: Record<string, number> | undefined,
): { floors: FairnessFloor[]; errors: string[] } {
  const want = new Set(ids ?? []);
  const errors: string[] = [];
  const knownIds = new Set(available.map((f) => f.id));
  for (const id of want) if (!knownIds.has(id)) errors.push(`The selected fairness floor (${id}) was not found. Please choose again.`);
  const floors: FairnessFloor[] = [];
  for (const f of available) {
    if (!want.has(f.id)) continue;
    let min = f.min_ratio;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, f.id)) {
      const x = overrides[f.id];
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
        errors.push(`The minimum ratio for "${f.label}" must be a number from 0% to 100%.`);
        continue;
      }
      min = x;
    }
    floors.push({ ...f, statuses_any_of: [...f.statuses_any_of], min_ratio: min });
  }
  return { floors, errors };
}

function lossAndRevocations(
  scenario: Scenario,
  outcome: JointOutcome,
  mode: 'protect' | 'tradeoff',
): { loss: WhatIfLoss; revocations: WhatIfRevocations } {
  const ivTitle = (id: string) => scenario.interventions.find((iv) => iv.id === id)?.title ?? id;
  const grantById = new Map((scenario.existing_grants ?? []).map((g) => [g.id, g]));
  const revs = outcome.revocations ?? [];
  const lost = outcome.lost_pairs ?? [];
  const reachableStudents = new Set(outcome.R1.map((p) => p.student_id));
  type Group = { iv: string; by: string | null; revs: GrantRevocation[] };
  const groups: Group[] = [];
  for (const r of revs) {
    let g = groups.find((x) => x.iv === r.intervention_id && x.by === r.forced_by);
    if (!g) {
      g = { iv: r.intervention_id, by: r.forced_by, revs: [] };
      groups.push(g);
    }
    g.revs.push(r);
  }
  const lossGroups: WhatIfLossGroup[] = groups.map((g) => {
    const hit = lost.filter((p) =>
      g.revs.some((r) => {
        const grant = grantById.get(r.grant_id);
        return r.student_id === p.student_id && (grant?.opportunity_id === null || grant?.opportunity_id === p.opportunity_id);
      }),
    );
    const hitStudents = new Set(hit.map((p) => p.student_id));
    const students = hitStudents.size;
    const stillReachable = [...hitStudents].filter((sid) => reachableStudents.has(sid)).length;
    const revTitle = ivTitle(g.iv);
    const head =
      g.by !== null
        ? `Enabling "${ivTitle(g.by)}" (mutually exclusive with "${revTitle}"; they cannot run together) requires revoking ${plural(g.revs.length, 'existing resource')} of "${revTitle}"`
        : `Voluntarily revoked ${plural(g.revs.length, 'existing resource')} of "${revTitle}" (to free capacity)`;
    const tail =
      hit.length > 0
        ? `: lost ${hit.length} (student, opportunity) ${pluralNoun(hit.length, 'pair')}, involving ${plural(students, 'student')}; ${stillReachable} of them still ${pluralNoun(stillReachable, 'has', 'have')} another reachable opportunity after the plan.`
        : ': no reachable pairs lost because of this (for example, the revoked resources were pending approval, or another measure filled the gap).';
    return {
      revoked_title: revTitle,
      forced_by_title: g.by !== null ? ivTitle(g.by) : null,
      revoked_count: g.revs.length,
      students,
      students_still_reachable: stillReachable,
      pairs: hit.length,
      text: head + tail,
    };
  });
  const counts = revocationCounts(scenario, revs);
  const affected = new Set(lost.map((p) => p.student_id));
  const affectedStill = [...affected].filter((sid) => reachableStudents.has(sid)).length;
  const loss: WhatIfLoss = {
    lost_pairs: outcome.L,
    affected_students: affected.size,
    affected_students_still_reachable: affectedStill,
    summary:
      outcome.L > 0
        ? `Lost ${outcome.L} (student, opportunity) ${pluralNoun(outcome.L, 'pair')}, involving ${plural(affected.size, 'student')}; ${affectedStill} of them still ${pluralNoun(affectedStill, 'has', 'have')} another reachable opportunity after the plan.`
        : null,
    groups: lossGroups,
    headline:
      mode === 'tradeoff' && outcome.L > 0
        ? `To add ${plural(outcome.G, 'newly reachable pair')}, ${outcome.L} previously reachable (student, opportunity) ${pluralNoun(outcome.L, 'pair is', 'pairs are')} no longer reachable under this plan.`
        : null,
    protect_note: mode === 'protect' ? PROTECT_LOSS_NOTE : null,
  };
  const revocations: WhatIfRevocations = {
    ...counts,
    items: groups.map((g) => ({
      title: ivTitle(g.iv),
      count: g.revs.length,
      reason:
        g.by !== null
          ? `Mutually exclusive with the newly enabled "${ivTitle(g.by)}"; the two cannot run together, so this must stop`
          : 'Voluntarily revoked (in trade-off mode, to free capacity for other students)',
    })),
  };
  return { loss, revocations };
}

const SOFT_CHECK_NAMES = new Set(['organizer_requirements', 'fairness']);

function baselinesView(cmp: BaselineComparison, scenario: Scenario): WhatIfBaselines {
  const m = (x: { R1_count: number; G: number; L: number; N: number; total_usd: number }): WhatIfBaselineMetrics => ({
    R1_count: x.R1_count,
    G: x.G,
    L: x.L,
    N: x.N,
    total_usd: round2(x.total_usd),
  });
  return {
    rows: cmp.rows.map((r) => {
      const failed = r.verification.checks.filter((c) => !SOFT_CHECK_NAMES.has(c.name) && !c.passed);
      const executable = r.verified !== null;
      return {
        id: r.id,
        label: r.label,
        description: r.description,
        claimed_reachable: r.claimed_reachable,
        executable,
        failed_checks: failed.map((c) => CHECK_LABELS[c.name] ?? c.name),
        verified: r.verified ? m(r.verified) : null,
        repaired: r.repaired ? { ...m(r.repaired), note: cleanText(r.repaired.note, scenario) } : null,
        soft_requirements_met: r.soft_requirements_met,
        soft_label:
          r.soft_requirements_met === null
            ? 'No requirement set'
            : !executable
              ? 'Plan not executable; not evaluated'
              : r.soft_requirements_met
                ? 'Met'
                : 'Not met',
      };
    }),
    notes: cmp.notes.map((n) => cleanText(n, scenario)),
  };
}

// ───────────────────────────── 主函数 ─────────────────────────────

/** 主结果的方案明细，只给「回到学生端的桥」用；含匿名学生编号，页面不得渲染其中任何内容。 */
export interface WhatIfPlanDetail {
  scenario_id: string;
  /** 主结果状态；输入无效（没有调用求解器）时为 UNSUPPORTED_INPUT。 */
  status: JointStatus;
  /** 与 view.verification.passed 相同。 */
  verification_passed: boolean;
  /** 主结果的分配（只含已批准措施）；没有评估时为 []。 */
  allocations: Allocation[];
  /** 条件性结果（把 pending 措施当作已批准）的分配；没有条件性结果时为 null。只用于说明原因，永不写入。 */
  conditional_allocations: Allocation[] | null;
  /** 参与求解的措施（勾选与预算处理后的场景里的措施）。 */
  interventions: Intervention[];
}

/** 复制分配（不把求解器自己的数组 / 对象交出去）。 */
const copyAllocations = (list: readonly Allocation[]): Allocation[] => list.map((a) => ({ ...a }));

/** 复制措施（数组字段也复制）。 */
function copyIntervention(iv: Intervention): Intervention {
  const out: Intervention = { ...iv, resolves: [...iv.resolves] };
  if (Array.isArray(iv.opportunity_ids)) out.opportunity_ids = [...iv.opportunity_ids];
  if (Array.isArray(iv.mutually_exclusive_with)) out.mutually_exclusive_with = [...iv.mutually_exclusive_with];
  if (Array.isArray(iv.requires)) out.requires = [...iv.requires];
  return out;
}

/**
 * 与 runWhatIf 相同（同一次求解、同一次独立复核），另外返回主结果的方案明细 `plan`，
 * 供「回到学生端的桥」使用，避免为了拿分配再求解一次。`view` 与 runWhatIf 的返回值完全相同。
 * `plan` 含匿名学生编号与逐人分配：页面只能把它交给 ./bridge 的 decideBridge，不得渲染其中任何内容。
 *
 * @param availableFloors 该场景可选的公平底线（如 ./scenarios 的 SCENARIOS[i].suggestedFairnessFloors）；
 *   input.fairnessFloorIds 只能从这里选。缺省 = 没有可选底线。
 */
export function runWhatIfWithPlan(
  scenario: Scenario,
  input: WhatIfInput,
  availableFloors: readonly FairnessFloor[] = [],
): { view: WhatIfView; plan: WhatIfPlanDetail } {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const title = (id: string) => byId.get(id)?.title ?? id;

  // 1. 勾选与前置依赖
  const { enabled, excluded, running, frozen } = resolvePrerequisites(scenario, input.enabledIds);
  const frozenSet = new Set(frozen);
  const enabledSet = new Set(enabled);
  const ignored_required: WhatIfView['ignored_required'] = [];
  const required: string[] = [];
  for (const id of [...new Set(input.requiredIds)]) {
    if (enabledSet.has(id)) required.push(id);
    else {
      const wasExcluded = excluded.some((e) => e.id === id);
      ignored_required.push({
        id,
        title: title(id),
        reason: wasExcluded
          ? `"${title(id)}" was excluded because its prerequisite is not included, so the "required" setting is ignored.`
          : `"${title(id)}" is not included in the plan, so the "required" setting is ignored.`,
      });
    }
  }
  required.sort(cmpStr);

  const mode: 'protect' | 'tradeoff' = input.mode === 'tradeoff' ? 'tradeoff' : 'protect';
  const minGain = input.minGain ?? null;
  const budgetValid = Number.isFinite(input.budget);
  const budgetUsd = budgetValid ? input.budget : null;
  const lossCapCheck = checkLossCap(mode, input.lossCap);
  const lossCap = lossCapCheck.value;
  const floorSel = selectFloors(availableFloors, input.fairnessFloorIds, input.minRatioOverrides);
  const floors = floorSel.floors;
  const input_errors = [...(lossCapCheck.error ? [lossCapCheck.error] : []), ...floorSel.errors];

  const eff = withBudget(withEnabledInterventions(scenario, enabled), input.budget);
  const enabledPending = eff.interventions.filter((iv) => !isApproved(iv)).map((iv) => `"${iv.title}"`);
  // 机会是占位还是真实目录机会（判定与页面的 Placeholder 标签共用 isPlaceholderOpportunity）：两种说法不能混用——
  // 用真实机会时不得说「全部数据 / 机会都是示例或占位」，也不得暗示真实主办方提供这些支持。全是占位时两句与原来逐字相同。
  const realCount = scenario.opportunities.filter((o) => !isPlaceholderOpportunity(o)).length;
  const placeholderCount = scenario.opportunities.length - realCount;
  const dataAssumption =
    realCount === 0
      ? 'All students and scenario data are sample / simulated, not real students. Results do not represent real-world impact.'
      : 'All students, support measures, costs and budgets are sample / simulated, not real students or real programs. Results do not represent real-world impact.';
  const realListings =
    realCount === 1
      ? 'is a real listing, used here with sample students and a simulated support provider. Its real organizer is not involved and offers none of these support measures.'
      : 'are real listings, used here with sample students and a simulated support provider. Their real organizers are not involved and offer none of these support measures.';
  const opportunityAssumption =
    realCount === 0
      ? 'Opportunities are placeholders for now, to be replaced with real opportunities verified by a person (official link + verification date).'
      : placeholderCount === 0
        ? `${realCount === 1 ? 'The opportunity' : realCount === 2 ? 'Both opportunities' : `All ${realCount} opportunities`} ${realListings}`
        : `${placeholderCount === 1 ? 'One opportunity is a placeholder' : `${placeholderCount} opportunities are placeholders`}; ${realCount === 1 ? 'the other' : `the other ${realCount}`} ${realListings}`;

  // 假设与不确定性（与是否求解无关的部分）
  const assumptions: string[] = [
    dataAssumption,
    opportunityAssumption,
    '"Reachable" only means no eligibility conflict and workable real-world conditions (time / cost / transport / device). Reachable does not mean admitted, and it is not an admission probability.',
    'The model assumes students accept the resources they are given; whether they actually accept or can attend is not modeled.',
    'All costs, capacities and budgets are sample numbers.',
    `Evaluation date is ${scenario.evaluation_date}: eligibility, age and deadlines are all computed for this day.`,
    enabledPending.length > 0
      ? `Support measures pending approval (${enabledPending.join(', ')}) are not counted in the current result; they only appear in the "if approved" conditional result.`
      : 'Support measures pending approval are not counted in the current result; none are included this time.',
    'Each support measure is judged only by whether the resource it provides (device / funding / alternative way to take part / time) removes a student\'s real-world barrier. Support measures cannot change official eligibility.',
    'If a checked support measure has a prerequisite that is not included, the measure is excluded from the solve (a measure never takes effect without its prerequisite).',
    'When capacity or budget runs short and several students are in the same situation, student id order decides who gets it (a deterministic rule in the simulation). This does not represent who needs help more.',
    MODE_EXPLANATIONS[mode],
    mode === 'tradeoff'
      ? `What trade-off mode means: existing resources may be revoked to add new coverage (resources that conflict with a new measure must be revoked). Pairs lost this way count toward "Lost L" and stay within the loss cap${lossCap !== null ? ` of ${lossCap}` : ''} (counted in (student, opportunity) pairs). Revoking gives no refund and does not add budget. A loss cap of 0 is still not the same as protected mode: it still allows revoking pending-approval commitments (not counted as losses) and revocations that cause no loss.`
      : 'Protected mode never revokes existing resources, so new measures that conflict with existing resources cannot be enabled.',
    'Existing resources given to students outside the scenario cannot be revoked (their loss cannot be evaluated, and we do not guess). New measures that conflict with those resources\' measures cannot be enabled in either mode.',
    'Fairness floors use only status labels that students report themselves (such as low-income or first-generation), never school names or personal names. The denominator counts only group members who are officially eligible for at least one opportunity, counted per student (covered = at least one reachable opportunity). A student in several groups counts once in each group.',
    'Baselines A / B / C are deterministic simplifications (ascending id, first come first served). They do not represent any real system or who needs help more. Baseline D from the spec (a fully coordinated separate planner) is not implemented.',
  ];
  if (floors.length > 0) assumptions.push('The fairness floors set here and their basis are samples (fictional basis), for demo only.');
  if (running.length > 0) {
    assumptions.push('Support measures already running (with resources in use) cannot be removed from the plan: unchecking only stops new allocations. Existing resources stay in effect and keep their capacity, and mutual exclusions still apply.');
  }
  for (const r of running) if (!r.accepts_new) assumptions.push(r.note);
  for (const e of excluded) assumptions.push(e.reason);
  for (const r of ignored_required) assumptions.push(r.reason);

  const base = {
    scenario_title: scenario.title,
    evaluation_date: scenario.evaluation_date,
    is_sample: true as const,
    student_count: scenario.students.length,
    opportunities: scenario.opportunities.map((o) => ({
      title: o.title,
      is_placeholder: isPlaceholderOpportunity(o),
    })),
    effective: {
      enabled_ids: enabled,
      required_ids: required,
      budget_usd: budgetUsd,
      min_gain: minGain !== null && Number.isFinite(minGain) ? minGain : null,
      mode,
      loss_cap: lossCap,
      fairness_floor_ids: floors.map((f) => f.id),
      frozen_ids: frozen,
    },
    input_errors,
    mode,
    loss_cap: lossCap,
    mode_label: MODE_LABELS[mode],
    mode_explanation: MODE_EXPLANATIONS[mode],
    excluded,
    running,
    ignored_required,
    labels: WHATIF_LABELS,
  };

  // 输入级问题：不调用求解器，不把异常值传下去。
  if (input_errors.length > 0) {
    const view: WhatIfView = {
      ...base,
      status: 'UNSUPPORTED_INPUT',
      status_label: STATUS_LABELS.UNSUPPORTED_INPUT,
      status_explanation: `Settings are incomplete or invalid, so nothing was computed: ${input_errors.join(' ')}`,
      R0_count: null,
      R1_count: null,
      G: null,
      L: null,
      N: null,
      cost: { fixed_usd: null, per_student_usd: null, total_usd: null, budget_usd: budgetUsd, remaining_usd: null },
      selected: [],
      capacity_usage: capacityUsage(eff, { selected_intervention_ids: [], allocations: [] }, frozen),
      verification: { passed: false, checks: [], note: 'Settings are incomplete or invalid; the solver and verification were not run.' },
      alternative: null,
      conditional: null,
      uncovered: null,
      loss: null,
      revocations: null,
      fairness: [],
      baselines: null,
      solver_notes: [],
      assumptions,
    };
    return {
      view: scrubNonFinite(view),
      plan: {
        scenario_id: scenario.id,
        status: 'UNSUPPORTED_INPUT',
        verification_passed: false,
        allocations: [],
        conditional_allocations: null,
        interventions: eff.interventions.map(copyIntervention),
      },
    };
  }

  // 2. 求解
  const opts: SolveOptions = { mode };
  if (mode === 'tradeoff' && lossCap !== null) opts.loss_cap = lossCap;
  if (required.length > 0) opts.required_intervention_ids = required;
  if (minGain !== null) opts.min_gain = minGain;
  if (floors.length > 0) opts.fairness_floors = floors;
  const result = solveJoint(eff, opts);

  // 3. 独立复核（主结果）
  const vOpts: VerifyOptions = { mode };
  if (opts.loss_cap !== undefined) vOpts.loss_cap = opts.loss_cap;
  if (opts.required_intervention_ids) vOpts.required_intervention_ids = opts.required_intervention_ids;
  if (opts.min_gain !== undefined) vOpts.min_gain = opts.min_gain;
  if (opts.fairness_floors) vOpts.fairness_floors = opts.fairness_floors;
  const plainPlan = {
    selected_intervention_ids: result.selected_intervention_ids,
    allocations: result.allocations,
    revoked_grant_ids: result.revoked_grant_ids ?? [],
  };
  // 内部复核未通过（UNSUPPORTED_INPUT 且求解器保留了失败的复核）：展示那次失败的复核。
  const internalFailure = result.status === 'UNSUPPORTED_INPUT' && result.verification != null;
  const vr =
    internalFailure && result.verification
      ? result.verification
      : verifyPlan(eff, result.status === 'UNSUPPORTED_INPUT' ? plainPlan : result, vOpts);
  const verification: WhatIfVerification = {
    passed: vr.passed && result.status !== 'UNSUPPORTED_INPUT',
    checks: vr.checks.map((c) => ({
      name: c.name,
      label: CHECK_LABELS[c.name] ?? c.name,
      passed: c.passed,
      detail: cleanText(c.detail, scenario),
    })),
    note:
      result.status === 'INFEASIBLE'
        ? 'The main result is an empty plan with no support measures enabled. It does not meet your requirements by design, so a failed "Organizer requirements" or "Fairness floors" check is expected; the other hard-constraint checks confirm the empty plan itself is valid.'
        : internalFailure
          ? 'The plan found by the solver failed independent verification, so it was discarded and not shown (the current result is an empty plan). Below is the verification of the discarded plan. Please check the scenario data.'
          : result.status === 'UNSUPPORTED_INPUT'
            ? 'Invalid input; not evaluated. The "Input is valid" check explains why.'
            : null,
  };

  // 4. 汇总
  const evaluated = result.status !== 'UNSUPPORTED_INPUT';
  const planCost = costOf(result.cost);
  const cost: WhatIfCost = evaluated
    ? {
        ...planCost,
        budget_usd: budgetUsd,
        remaining_usd: budgetUsd !== null ? round2(budgetUsd - result.cost.total_usd) : null,
      }
    : { fixed_usd: null, per_student_usd: null, total_usd: null, budget_usd: budgetUsd, remaining_usd: null };
  const capacity_usage = capacityUsage(eff, result, frozen);
  // 公平底线的覆盖上界（主结果与替代方案都只含已批准措施，上界相同；条件性结果不给）。
  const bounds = evaluated && floors.length > 0 ? fairnessCoverageBounds(eff, floors, opts) : null;

  let alternative: WhatIfAlternative | null = null;
  if (result.alternative) {
    alternative = {
      ...outcomeSummary(eff, result.alternative, floors, bounds),
      relaxed: result.alternative.relaxed.map((k) => RELAXED_ZH[k]),
      note: cleanText(result.alternative.note, scenario),
    };
  }

  let conditional: WhatIfConditional | null = null;
  if (result.conditional) {
    const c = result.conditional;
    const cv = verifyPlan(eff, c, { ...vOpts, assume_approved_intervention_ids: c.assumed_approved_intervention_ids });
    conditional = {
      ...outcomeSummary(eff, c, floors),
      status: c.status,
      status_label: STATUS_LABELS[c.status],
      assumed_approved: c.assumed_approved_intervention_ids.map(title),
      delta: {
        G: c.G - result.G,
        L: c.L - result.L,
        N: c.N - result.N,
        total_usd: round2(c.cost.total_usd - result.cost.total_usd),
      },
      verification_passed: c.status === 'INFEASIBLE' || c.status === 'UNSUPPORTED_INPUT' ? false : cv.passed,
      note: cleanText(c.note, scenario),
    };
  }

  const uncovered = evaluated
    ? uncoveredSummary(eff, scenario, result, capacity_usage, cost.remaining_usd ?? 0, result.status === 'INFEASIBLE', frozenSet)
    : null;
  const lr = evaluated ? lossAndRevocations(eff, result, mode) : null;
  const baselines = baselinesView(compareBaselines(eff, opts), scenario);

  if (result.status === 'SEARCH_LIMIT_REACHED') {
    assumptions.push('This solve hit the search limit: the result is not guaranteed optimal, and a better plan may exist.');
  }
  if (result.conditional?.status === 'SEARCH_LIMIT_REACHED') {
    assumptions.push('The conditional solve hit the search limit: not guaranteed optimal.');
  }

  const view: WhatIfView = {
    ...base,
    status: result.status,
    status_label: STATUS_LABELS[result.status],
    status_explanation: STATUS_EXPLANATIONS[result.status],
    R0_count: evaluated ? result.R0.length : null,
    R1_count: evaluated ? result.R1.length : null,
    G: evaluated ? result.G : null,
    L: evaluated ? result.L : null,
    N: evaluated ? result.N : null,
    cost,
    selected: summarizeSelected(eff, result),
    capacity_usage,
    verification,
    alternative,
    conditional,
    uncovered,
    loss: lr ? lr.loss : null,
    revocations: lr ? lr.revocations : null,
    fairness: evaluated ? fairnessRows(result.fairness, floors, bounds) : [],
    baselines,
    solver_notes: result.notes.map((n) => cleanText(n, scenario)),
    assumptions,
  };
  return {
    view: scrubNonFinite(view),
    plan: {
      scenario_id: scenario.id,
      status: result.status,
      verification_passed: verification.passed,
      // UNSUPPORTED_INPUT 不做评估：一律为空（求解器本来就返回空方案，这里再保证一次）。
      allocations: evaluated ? copyAllocations(result.allocations) : [],
      conditional_allocations: result.conditional ? copyAllocations(result.conditional.allocations) : null,
      interventions: eff.interventions.map(copyIntervention),
    },
  };
}

/**
 * @param availableFloors 该场景可选的公平底线（如 ./scenarios 的 SCENARIOS[i].suggestedFairnessFloors）；
 *   input.fairnessFloorIds 只能从这里选。缺省 = 没有可选底线。
 */
export function runWhatIf(
  scenario: Scenario,
  input: WhatIfInput,
  availableFloors: readonly FairnessFloor[] = [],
): WhatIfView {
  return runWhatIfWithPlan(scenario, input, availableFloors).view;
}

/** 页面「恢复默认」用的默认输入：纳入全部措施、不设必须启用、场景预算、无最低新增目标、保护模式、不设底线。 */
export function defaultWhatIfInput(scenario: Scenario): WhatIfInput {
  return {
    enabledIds: scenario.interventions.map((iv) => iv.id),
    requiredIds: [],
    budget: scenario.budget_usd,
    minGain: null,
    mode: 'protect',
    lossCap: null,
    fairnessFloorIds: [],
  };
}
