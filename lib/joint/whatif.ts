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
 *
 * 纯函数：确定性、不读系统时钟、无随机、无 IO、不调 AI；不修改输入。
 * 所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 */
import { analyzeReachability } from '../reachability';
import { compareBaselines } from './baselines';
import { fairnessCoverageBounds, solveJoint } from './solve';
import type { FloorCoverageBound } from './solve';
import { verifyPlan } from './verify';
import {
  MIN_NAME_TOKEN_LENGTH,
  missingPrerequisites,
  resolveEnabledInterventions,
  runningInterventionIds,
  withBudget,
  withEnabledInterventions,
} from './scenario-utils';

export { missingPrerequisites };
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
  simulation: '模拟结果，不代表真实影响',
  sample: '示例学生 / 示例场景',
  placeholder_opportunity: '占位机会，待替换为已核实的真实机会',
  reachable_not_admission: '可达 ≠ 录取：可达只表示资格不冲突、现实条件走得通',
};

export const STATUS_LABELS: Record<JointStatus, string> = {
  OPTIMAL: '已找到最优方案',
  INFEASIBLE: '做不到',
  SEARCH_LIMIT_REACHED: '达到搜索上限',
  UNSUPPORTED_INPUT: '输入不支持',
};

const STATUS_EXPLANATIONS: Record<JointStatus, string> = {
  OPTIMAL:
    '已完成全部搜索：在当前勾选、预算与要求下，没有比这更好的方案（先比净变化，再比失去的数量，再比成本）。',
  INFEASIBLE:
    '做不到：在不突破容量、预算、互斥、前置依赖、损失上限等硬约束的前提下，无法同时满足你提的要求（必须启用的措施 / 最低新增目标 / 公平底线）。当前结果是「不启用任何措施」；放松要求后的替代方案见下方，求解器没有悄悄降低要求。',
  SEARCH_LIMIT_REACHED:
    '达到搜索上限后停止：显示的是上限内找到的、经独立复核通过的最好方案，不保证最优，也不代表没有更好的方案。',
  UNSUPPORTED_INPUT:
    '输入不合法或超出求解器支持范围（或求解器的内部复核未通过，按不支持的输入处理），没有给出方案。原因见求解器说明。',
};

export const CHECK_LABELS: Record<string, string> = {
  input_validity: '输入合法',
  approval: '措施均已批准',
  mutual_exclusion: '没有同时启用互斥措施',
  prerequisite: '前置依赖已启用',
  allocation_validity: '分配合法',
  capacity: '未超出名额',
  cost_accounting: '成本记账正确',
  budget: '未超出预算',
  eligibility: '资格交叉检查（措施不改变官方资格）',
  deadline: '截止日期交叉检查',
  barrier_resolution: '障碍确实被化解',
  coverage_loss: '失去的可达对数在允许范围内',
  revocation: '收回已有资源的规则',
  organizer_requirements: '主办方要求',
  fairness: '公平底线',
  metrics: '指标重算一致',
};

const BARRIER_ZH: Record<BarrierType, string> = {
  device: '设备',
  transport: '交通条件',
  cost: '费用',
  time: '时间',
};

const RELAXED_ZH: Record<SoftRequirementKey, string> = {
  required_intervention_ids: '不再要求「必须启用」的措施',
  min_gain: '不再要求最低新增目标',
  fairness_floors: '不再要求公平底线',
};

export const MODE_LABELS: Record<'protect' | 'tradeoff', string> = {
  protect: '保护模式',
  tradeoff: '权衡模式',
};

export const MODE_EXPLANATIONS: Record<'protect' | 'tradeoff', string> = {
  protect: '保护模式：不动任何已有承诺——不收回任何已经发出的资源，原本可达的（学生, 机会）对不会减少。',
  tradeoff:
    '权衡模式：主办方设了损失上限才允许收回已有资源（包括与新措施互斥、必须停掉的资源）；失去的可达对数不超过上限，并写明失去多少、因为什么。',
};

export const PROTECT_LOSS_NOTE = '保护模式不会收回任何已有资源，原本可达的（学生, 机会）对不会减少。';

/** INFEASIBLE 时「仍未覆盖」的障碍原因。 */
export const INFEASIBLE_UNCOVERED_CAUSE = '当前要求无法满足，主结果为不启用任何措施；可参考上方的替代方案';

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
    if (typeof s.id === 'string' && s.id) toks.push({ token: s.id, sid: s.id, repl: '某学生', isId: true });
    if (typeof s.display_name === 'string' && s.display_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.display_name, sid: s.id, repl: '某学生', isId: false });
    }
    if (typeof s.school_name === 'string' && s.school_name.length >= MIN_NAME_TOKEN_LENGTH) {
      toks.push({ token: s.school_name, sid: s.id, repl: '某学校', isId: false });
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
  if (hit.size > 0) out += `（涉及 ${hit.size} 名学生，已隐去身份）`;
  return out;
}

/** 把文字中用「」括起来的措施 id 换成措施标题（求解器 / 验证器的说明里用的是 id）。 */
function humanizeInterventionIds(text: string, scenario: Scenario): string {
  let out = text;
  const ivs = [...scenario.interventions].sort((a, b) => b.id.length - a.id.length || cmpStr(a.id, b.id));
  for (const iv of ivs) out = out.split(`「${iv.id}」`).join(`「${iv.title}」`);
  return out;
}

/** 先把措施 id 换成标题，再脱敏（换进去的标题也会被检查）。 */
function cleanText(text: string, scenario: Scenario): string {
  return scrubStudentInfo(humanizeInterventionIds(text, scenario), scenario);
}

const INVALID_NUMBER_TEXT = '未填写或无效';

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
    const base = `「${title(id)}」已有 ${n} 份资源在使用，不能从方案中移除；取消勾选只表示不再新增分配。`;
    const extra = !f
      ? '本次接受新分配。'
      : f.reason === 'unchecked'
        ? '本次未勾选：已有资源照常生效、占用名额，与它互斥的措施仍受限制，但不会再新增分配。'
        : `本次缺少前置依赖${f.missing_requires.map((r) => `「${title(r)}」`).join('、')}：已有资源照常生效、占用名额，但不会再新增分配。`;
    return { id, title: title(id), existing_grants: n, accepts_new: !f, note: base + extra };
  });
  const excluded: WhatIfExcluded[] = removed.map((r) => {
    const names = r.missing_requires.map(title);
    return {
      id: r.id,
      title: title(r.id),
      missing_requires: names,
      reason: `「${title(r.id)}」需要同时纳入${names.map((n) => `「${n}」`).join('、')}，后者未纳入，所以本措施没有参与求解。`,
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
    `失去 ${L} 个原本可达的（学生, 机会）对：收回了 ${counts.total} 条已有资源（其中因互斥必须收回 ${counts.forced} 条、自愿收回 ${counts.voluntary} 条）` +
    (counts.pending > 0 ? `；其中 ${counts.pending} 条是待审批承诺，不计入损失。` : '。')
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
        ? `${label}：场景里没有符合资格的该群体学生（分母为 0），这条底线不适用（视为满足）。`
        : `${label}：符合资格的 ${r.eligible_members} 人中有 ${r.covered_members} 人方案后至少有一个可达的机会（${ratio}%），要求至少 ${min}%，${r.satisfied ? '满足' : '不满足'}。`;
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
          : `当前启用的措施下最多可覆盖 ${maxCov} / ${r.eligible_members}` +
            (maxCov < r.eligible_members
              ? `：其余 ${r.eligible_members - maxCov} 人在当前启用的措施与模式下，不论名额和预算多少，都没有措施组合能让他们至少有一个可达的机会（例如缺少的条件没有措施能化解），但仍计入分母。`
              : '（这是不考虑名额与预算的上界，不一定能同时达到）。'),
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
        ? '（本方案中已停用，已有资源全部收回）'
        : isRunning && revokedN > 0
          ? `（运行中，本方案收回 ${revokedN} / ${allExisting.length} 份已有资源${isFrozen ? '，不再新增分配' : allocs.length > 0 ? '' : '，没有新增分配'}；以下为剩余占用）`
          : isFrozen
            ? '（运行中，不再新增分配）'
            : isRunning
              ? isSelected
                ? '（运行中）'
                : '（运行中，本方案没有新增分配）'
              : isSelected
                ? ''
                : '（未启用）';
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
              scope_label: t === DEFAULT_SLOT ? '默认时段' : `时段 ${t}`,
              used: set.size,
              capacity: cap,
              full: set.size >= cap - EPS,
            };
          });
      } else {
        const set = new Set<string>();
        for (const g of existing) set.add(String(g.student_id));
        for (const a of allocs) set.add(a.student_id);
        slots = [{ scope_label: '全场景', used: set.size, capacity: cap, full: set.size >= cap - EPS }];
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
      if (enabled.length > 0) return '能化解它的措施待审批，未计入当前结果';
      if (fullScenario.interventions.some((iv) => iv.resolves.includes(t))) return '能化解它的措施没有纳入方案';
      return '场景中没有能化解它的措施';
    }
    const full = enabledApproved.some(
      (iv) => selected.has(iv.id) && capacity.find((c) => c.id === iv.id)?.slots.some((sl) => sl.full),
    );
    if (full) return '名额已满';
    const minExtra = Math.min(
      ...enabledApproved.map((iv) => iv.unit_cost_usd + (selected.has(iv.id) ? 0 : iv.fixed_cost_usd ?? 0)),
    );
    if (minExtra > remainingBudget + EPS) return '预算不足';
    const allBlockedElsewhere = [...who].every((sid) => (kindsOf.get(sid)?.size ?? 0) > 1);
    if (allBlockedElsewhere) return '这些学生同时还缺其他条件，只化解这一项不会让他们变为可达，所以方案没有为此分配';
    return '受互斥、前置依赖等其他约束限制，方案没有覆盖';
  };

  const order: WhatIfUncoveredReason['kind'][] = ['revoked', 'eligibility', 'device', 'transport', 'cost', 'time', 'unknown'];
  const reasons: WhatIfUncoveredReason[] = [];
  for (const k of order) {
    const set = byKind.get(k);
    if (!set || set.size === 0) continue;
    const n = set.size;
    const pc = pairsByKind.get(k) ?? 0;
    const who = `${pc} 个（学生, 机会）对`;
    const tail = `（涉及 ${n} 名学生）`;
    if (k === 'revoked') {
      const cause = '原本可达，因收回已有资源而在此方案下不再可达（见「失去」说明）';
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who}${tail}${cause}` });
    } else if (k === 'eligibility') {
      const cause = '措施不能改变官方资格';
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who}不符合官方资格${tail}：${cause}` });
    } else if (k === 'unknown') {
      const cause = '信息不足，需向官方或学生确认';
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who}无法判定是否可达${tail}：${cause}` });
    } else {
      const cause = causeFor(k, set);
      reasons.push({ kind: k, pairs: pc, students: n, cause, text: `${who}仍缺${BARRIER_ZH[k]}${tail}：${cause}` });
    }
  }
  // 按学生去重：方案后至少有一个可达机会的学生（只用于汇总人数，不进视图）。
  const reachableStudents = new Set(outcome.R1.map((p) => p.student_id));
  const some = [...students].filter((sid) => reachableStudents.has(sid)).length;
  const none = scenario.students.filter((s) => !reachableStudents.has(s.id)).length;
  const summary =
    pairs === 0
      ? '方案后所有（学生, 机会）对都可达。'
      : `${pairs} 个（学生, 机会）对在方案后仍不可达，涉及 ${students.size} 名示例学生；其中 ${some} 名学生在方案后仍至少有一个可达的机会，${none} 名学生在方案后没有任何可达的机会。`;
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
      error: '权衡模式需要填写损失上限（0 或以上的整数）：最多允许多少个原本可达的（学生, 机会）对在新方案下不再可达。未填写时不计算。',
    };
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || !Number.isInteger(raw)) {
    return { value: null, error: '损失上限需要是 0 或以上的整数。' };
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
  for (const id of want) if (!knownIds.has(id)) errors.push(`没有找到所选的公平底线（${id}），请重新选择。`);
  const floors: FairnessFloor[] = [];
  for (const f of available) {
    if (!want.has(f.id)) continue;
    let min = f.min_ratio;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, f.id)) {
      const x = overrides[f.id];
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) {
        errors.push(`「${f.label}」的最低比例需要是 0% 到 100% 之间的数字。`);
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
        ? `因启用「${ivTitle(g.by)}」（与「${revTitle}」互斥，不能同时运行）必须收回「${revTitle}」的 ${g.revs.length} 条已有资源`
        : `自愿收回「${revTitle}」的 ${g.revs.length} 条已有资源（为腾出名额）`;
    const tail =
      hit.length > 0
        ? `：失去 ${hit.length} 个（学生, 机会）对，涉及 ${students} 名学生，其中 ${stillReachable} 名在方案后仍有其他可达的机会。`
        : '：没有因此失去可达的对（例如收回的是待审批的资源，或已由其他措施补上）。';
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
        ? `失去 ${outcome.L} 个（学生, 机会）对，涉及 ${affected.size} 名学生，其中 ${affectedStill} 名在方案后仍有其他可达的机会。`
        : null,
    groups: lossGroups,
    headline:
      mode === 'tradeoff' && outcome.L > 0
        ? `为了新增 ${outcome.G} 个，有 ${outcome.L} 个原本可达的（学生, 机会）对在此方案下不再可达。`
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
          ? `与新启用的「${ivTitle(g.by)}」互斥，两者不能同时运行，必须停掉`
          : '自愿收回（权衡模式下为腾出名额给其他学生）',
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
            ? '未设要求'
            : !executable
              ? '方案不可执行，不评估'
              : r.soft_requirements_met
                ? '满足'
                : '不满足',
      };
    }),
    notes: cmp.notes.map((n) => cleanText(n, scenario)),
  };
}

// ───────────────────────────── 主函数 ─────────────────────────────

/**
 * @param availableFloors 该场景可选的公平底线（如 ./scenarios 的 SCENARIOS[i].suggestedFairnessFloors）；
 *   input.fairnessFloorIds 只能从这里选。缺省 = 没有可选底线。
 */
export function runWhatIf(
  scenario: Scenario,
  input: WhatIfInput,
  availableFloors: readonly FairnessFloor[] = [],
): WhatIfView {
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
          ? `「${title(id)}」因前置依赖未纳入而被排除，「必须启用」这一要求被忽略。`
          : `「${title(id)}」没有纳入方案，「必须启用」这一要求被忽略。`,
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
  const enabledPending = eff.interventions.filter((iv) => !isApproved(iv)).map((iv) => `「${iv.title}」`);

  // 假设与不确定性（与是否求解无关的部分）
  const assumptions: string[] = [
    '所有学生和场景数据都是示例 / 模拟，不是真实学生，结果不代表真实影响。',
    '机会目前是占位，之后替换为人工核实过的真实机会（官方链接 + 核实日期）。',
    '「可达」只表示资格不冲突、现实条件（时间 / 费用 / 交通 / 设备）走得通，不等于录取，也不代表录取概率。',
    '模型假设学生会接受分配到的资源；实际是否接受、能否到场未纳入计算。',
    '各项成本、名额、预算都是示例数字。',
    `评估日期为 ${scenario.evaluation_date}：资格、年龄与截止日期都按这一天计算。`,
    enabledPending.length > 0
      ? `待审批的措施（${enabledPending.join('、')}）未计入当前结果，只出现在「如果获批」的条件性结果里。`
      : '待审批的措施不计入当前结果；本次没有纳入待审批的措施。',
    '每项措施的作用只通过它提供的资源（设备 / 补助 / 替代参与方式 / 时间）是否化解学生的现实障碍来判断，措施不能改变官方资格。',
    '若勾选的措施有前置依赖而依赖项没有纳入，该措施会被排除、不参与求解（不会出现「依赖没开、措施照样生效」）。',
    '名额或预算不够、多名学生条件相同时，按学生编号顺序决定分给谁（模拟中的确定性规则），不代表谁更需要。',
    MODE_EXPLANATIONS[mode],
    mode === 'tradeoff'
      ? `权衡模式的含义：允许为新增覆盖而收回已有资源（与新措施互斥的资源必须收回），由此失去的可达对计入「失去可达 L」，且不超过损失上限${lossCap !== null ? ` ${lossCap}` : ''}（按（学生, 机会）组合计）；收回不退款，不会增加预算。损失上限为 0 也不等同保护模式：仍允许收回待审批承诺（不计入损失）和不造成损失的收回。`
      : '保护模式下不会收回任何已有资源；与已有资源互斥的新措施因此不能启用。',
    '发给场景外学生的已有资源不能收回（无法评估他们的损失，不猜）：与这类资源所属措施互斥的新措施在两种模式下都不能启用。',
    '公平底线只依据学生自己声明的身份标签（如低收入、第一代大学生），不读学校名或姓名；分母只算至少对一个机会符合官方资格的该群体学生，按学生计（至少有一个可达机会即算覆盖）；一个学生属于多个群体时，在每个群体里各算一次。',
    '基线对比中的 A / B / C 是确定性的简化做法（按编号升序、先到先得），不代表任何真实系统，也不代表谁更需要；说明书中的基线 D（充分协调的分离式规划器）未实现。',
  ];
  if (floors.length > 0) assumptions.push('本次设置的公平底线及其依据都是示例（虚构依据），仅用于演示。');
  if (running.length > 0) {
    assumptions.push('已在运行的措施（已有资源在使用）不能从方案中移除：取消勾选只表示不再新增分配，已有资源照常生效、占用名额，互斥关系照常生效。');
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
      is_placeholder: o.is_sample === true || o.title.includes('占位'),
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
      status_explanation: `设置不完整或不合法，没有计算：${input_errors.join(' ')}`,
      R0_count: null,
      R1_count: null,
      G: null,
      L: null,
      N: null,
      cost: { fixed_usd: null, per_student_usd: null, total_usd: null, budget_usd: budgetUsd, remaining_usd: null },
      selected: [],
      capacity_usage: capacityUsage(eff, { selected_intervention_ids: [], allocations: [] }, frozen),
      verification: { passed: false, checks: [], note: '设置不完整或不合法，没有调用求解器，也没有复核。' },
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
    return scrubNonFinite(view);
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
        ? '主结果是「不启用任何措施」的空方案，它本来就不满足你提的要求，所以「主办方要求」或「公平底线」一项不通过是预期的；其余硬约束检查用来确认空方案本身合法。'
        : internalFailure
          ? '求解器找到的方案没有通过独立复核，已舍弃、未给出（当前结果为空方案）；下面是被舍弃方案的复核结果。请检查场景数据。'
          : result.status === 'UNSUPPORTED_INPUT'
            ? '输入不合法，未做评估；复核里「输入合法」一项会说明原因。'
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
    assumptions.push('本次求解达到搜索上限：结果不保证最优，也不代表没有更好的方案。');
  }
  if (result.conditional?.status === 'SEARCH_LIMIT_REACHED') {
    assumptions.push('条件性结果的求解达到搜索上限：不保证最优。');
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
  return scrubNonFinite(view);
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
