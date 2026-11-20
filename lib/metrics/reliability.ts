/**
 * lib/metrics/reliability — 联合求解器与基线 A / B / C / D 在示例场景上的可靠性指标。
 * 依据 docs/validation.md：「Track valid-route discovery, false feasibility, net coverage, fairness compliance,
 * optimality gap, coordination rounds and runtime.」
 *
 * 全部是**示例 / 模拟**场景上的算法正确性证据，不代表真实影响；可达 ≠ 录取。
 * 验证器、求解器与穷举都经由同一个学生端模型（analyzeReachability / checkEligibility）判断可达，
 * 所以这些指标**发现不了**那个共享模型本身的错误；它们检验的是搜索与方案层面的约束。
 *
 * 做法（只复用 lib/joint 的现成函数，不重写求解器或验证器的逻辑）：
 * - buildCases(entry)：每个场景一组确定性的 what-if 用例——预算 ×1（默认）/ ×0 / ×0.5 / ×1.5，
 *   各自「不设底线」与「设场景的 suggestedFairnessFloors」两种；场景有可撤回的已有 grant 时，
 *   另加默认预算下的 tradeoff 用例（loss_cap = 可撤回 grant 条数），同样分有无底线。
 *   第一项（protect、场景预算、不设底线）是「默认用例」（is_default），基线的头条数字只取它，
 *   避免把同一个（学生, 机会）对在多个用例里重复计数。
 *   pending 措施不单独成用例：solveJoint 自己给出 conditional（把全部 pending 当作已批准），这里一并复核。
 * - 每个用例：
 *   · solveJoint 两次（确定性：两次结果的 JSON 完全相同；并与 compareBaselines 里 joint 行的方案相同）；
 *   · 用验证器（./verify 的 verifyAndMeasure，与 verifyPlan 同一实现，多返回重算指标）复核求解器给出的每个
 *     「自称可行」的方案：主结果（OPTIMAL；或 SEARCH_LIMIT_REACHED 且方案非空或自带复核通过——不只看求解器自己的标记）、
 *     conditional（传 assume_approved_intervention_ids）、INFEASIBLE 时的 alternative（复核选项去掉 relaxed 的各项）。
 *     传入的是求解器的完整结果对象，验证器的 metrics 检查会核对求解器自报的 R0 / R1 / G / L / N / 成本 / 底线。
 *     被拒绝的个数 = 求解器的「假可行」（预期 0）。
 *   · 净覆盖与公平底线一律取验证器的重算值，不用求解器自报的数字。
 *   · 最优性差距：场景规模在 exhaustiveLimits 以内时，用 ./exhaustive 的 exhaustiveBest（穷举参考实现，
 *     只凭契约写成、不 import 求解器）对照主结果与 conditional：gap = 穷举最优 N − 验证器重算的 N（预期 0），
 *     并比较前六级数值目标（N、L、总成本、分配条数、措施数、撤回数）；第 7 级字典序不比较。
 *     超出规模的记为「跳过（太大）」，**不记为 gap 0**。
 *   · compareBaselines：每行的 claimed_reachable 与验证器确认的可达对数之差 = 基线的「未被确认的声称」
 *     （方案不可执行时，验证器只确认原本就可达的 R0，新声称一律不算确认）。
 *     注意基线的定义本身就有不对称（CONTRACT 第 10 条）：B、C 从不撤回已有 grant，A / B / C 都不考虑公平底线；
 *     D（充分协调的分离式规划器）与联合求解一样考虑撤回规则、公平底线与其他主办方要求。
 *   · D 与联合求解对照：两边都可执行时比较验证器重算的 N、L、成本（打平是预期中可能的结果）；
 *     按目标顺序 D 比联合求解更好时单独记录（d_exceeds_joint），输出里醒目标出：N 大者胜；N 相同看 L 小者胜；
 *     再相同看成本低者胜（成本差在 EPS 内视为相同）。
 * - 有效路线发现（valid-route discovery）只用基线对比行里验证器确认的数字作代理（按（学生, 机会）对计，
 *   不是学生端的准备路线）；协调轮数（coordination rounds）只对基线 D 测量（compareBaselines 的 D 行 coordination；
 *   联合求解是一次集中搜索，没有轮数），汇总给出分布与未收敛数；D 行缺失的用例（输入不合法、出错）单独计为未测量。
 *   注意 D 的协议里学生端第 1 轮就交出完整的条件性报告，轮数反映的是协议设计，不是协调难度。
 *   运行时间依赖机器，不在这里测（纯函数不读时钟），由 run.metrics.ts 测量并标注。
 *
 * 隐私：输出只含场景 / 用例 id、状态、计数与金额、检查项名称（不含 detail 文字，detail 可能写到学生 id），
 * 不含任何学生的 id、显示名、学校、年龄，也不含 R0 / R1 / 分配 / 撤回的明细。
 *
 * 纯函数：确定性、不读时钟、无随机、无 IO、不修改输入。buildCases、measureCase、measureScenario、measureAll、
 * summarize 都不向外抛异常：用例里的异常记在该用例的 error 里；buildCases 内部出错时返回 []，
 * measureScenario 则输出一条 error = 'exception during buildCases' 的用例，让这个场景不会悄悄消失。
 */
import { JOINT_STATUSES } from '../types';
import type {
  BaselineId,
  BaselineRow,
  FairnessFloor,
  JointPlan,
  JointStatus,
  Scenario,
  SoftRequirementKey,
  SolveOptions,
  VerifyOptions,
  VerifyResult,
} from '../types';
// 求解器与基线经 lib/joint 的公开入口；验证器的带重算指标版本、穷举参考实现与改预算工具直接取自各自文件
// （verify.ts / exhaustive.ts 不 import 求解器，独立性不受影响；本目录不修改 lib/joint 的任何文件）。
import { compareBaselines, solveJoint } from '../joint';
import { exhaustiveBest } from '../joint/exhaustive';
import { withBudget } from '../joint/scenario-utils';
import { createJointEvaluator, verifyAndMeasure } from '../joint/verify';
import type { RecomputedMetrics } from '../joint/verify';

// ───────────────────────────── 输入与选项 ─────────────────────────────

/** 一个待测场景（与 lib/joint/scenarios 的 ScenarioEntry 结构兼容）。 */
export interface MetricsScenarioInput {
  id: string;
  title?: string;
  scenario: Scenario;
  /** 场景预设的公平底线；空或缺省时只跑「不设底线」的用例。 */
  suggestedFairnessFloors?: readonly FairnessFloor[];
  /** 场景的机会是已核实目录里的真实机会时，场景清单给出的说明（原样输出）。 */
  realOpportunityNote?: string;
}

/**
 * 穷举对照的规模上限（超出即跳过，记为 too large）。按（学生 × 机会）对数、措施数、可撤回 grant 数判断。
 * 取值依据：三个示例场景（最大 18 对、4 项措施、3 条可撤回 grant）全部用例的完整测量（含穷举对照、基线对比）
 * 在开发机上合计约 3 秒；exhaustive.ts 文件头写的「秒级」保守规模更小。
 * 注意：这只是静态规模门槛，穷举量还取决于每个对有几个「极小可达措施集合」；场景数据调大后若变慢，
 * 先调小这里的上限（超出的用例照实记为跳过），不要把跳过的用例当作 gap 0。
 */
export interface ExhaustiveLimits {
  pairs: number;
  interventions: number;
  revocableGrants: number;
}

export const DEFAULT_EXHAUSTIVE_LIMITS: ExhaustiveLimits = { pairs: 20, interventions: 4, revocableGrants: 3 };

export interface MeasureOptions {
  exhaustiveLimits?: ExhaustiveLimits;
}

/** 预算倍数（第一项是默认预算）。 */
export const BUDGET_FACTORS: readonly number[] = [1, 0, 0.5, 1.5];

export const BASELINE_IDS: readonly BaselineId[] = ['A_eligibility_only', 'B_student_side', 'C_organizer_side', 'D_coordinated', 'joint'];

// ───────────────────────────── 输出类型（全部可 JSON 序列化） ─────────────────────────────

export interface CaseSpec {
  case_id: string;
  label: string;
  mode: 'protect' | 'tradeoff';
  loss_cap: number | null;
  budget_usd: number;
  budget_factor: number;
  /** 本用例给出的底线 id（空 = 不设底线）。 */
  floor_ids: string[];
  /** 默认用例：protect、场景预算、不设底线（每个场景恰好一个；基线的头条数字只取它）。 */
  is_default: boolean;
}

/** 一个用例的输入（含场景对象，不进入输出）。 */
export interface MetricsCase {
  spec: CaseSpec;
  scenario: Scenario;
  options: SolveOptions;
}

/** 验证器重算的覆盖指标（对数，不是人数）。 */
export interface CoverageNumbers {
  R0: number;
  R1: number;
  G: number;
  L: number;
  N: number;
  cost_usd: number;
  revoked_grants: number;
}

export interface FloorResult {
  floor_id: string;
  eligible_members: number;
  covered_members: number;
  ratio: number | null;
  min_ratio: number;
  met: boolean;
}

/** 与穷举比较的前六级数值目标（契约第 5 条第 1–6 步）。 */
export const OBJECTIVE_LEVELS = ['N', 'L', 'total_cost', 'allocation_count', 'measure_count', 'revocation_count'] as const;
export type ObjectiveLevel = (typeof OBJECTIVE_LEVELS)[number];

export type GapCheck =
  | {
      checked: true;
      exhaustive_feasible: boolean;
      /** 穷举最优 N；穷举不可行时为 null。 */
      exhaustive_N: number | null;
      solver_status: JointStatus;
      /** 验证器对求解器方案重算的 N（不用求解器自报的 N）。 */
      verified_N: number;
      /** 穷举最优 N − verified_N；只有穷举可行、且求解器给出了方案（OPTIMAL / SEARCH_LIMIT_REACHED）时才有。 */
      gap_N: number | null;
      /** 穷举可行 ⇔ 求解器 OPTIMAL（或达到搜索上限）；穷举不可行 ⇔ 求解器 INFEASIBLE。 */
      status_agrees: boolean;
      /** 前六级数值目标是否全部与穷举一致（第 7 级字典序不比较）；不可比较时为 null。 */
      objective_levels_1_6_agree: boolean | null;
      /** 不一致的目标级别。 */
      mismatched_levels: ObjectiveLevel[];
    }
  | { checked: false; reason: 'too_large' | 'not_applicable' | 'error' };

export interface MainResultMetrics {
  /** 求解器是否把主方案当作可行方案给出（见 claimedFeasible）。 */
  claimed_feasible: boolean;
  /** 方案是否为空方案（不选措施、不分配、不撤回）。 */
  empty_plan: boolean;
  /** 验证器对主方案（按本用例的复核选项）是否全部通过。 */
  verifier_passed: boolean;
  failed_checks: string[];
  coverage: CoverageNumbers;
  /** 给了底线时：验证器对主方案重算的每条底线；否则 null。 */
  fairness: FloorResult[] | null;
  all_floors_met: boolean | null;
}

export interface ConditionalMetrics {
  status: JointStatus;
  assumed_approved: number;
  /** 求解器当作已批准的措施是否恰好是场景里全部 pending 措施（契约第 7 条）。 */
  pending_ids_match: boolean;
  claimed_feasible: boolean;
  empty_plan: boolean;
  verifier_passed: boolean;
  failed_checks: string[];
  coverage: CoverageNumbers;
}

export interface AlternativeMetrics {
  relaxed: SoftRequirementKey[];
  empty_plan: boolean;
  verifier_passed: boolean;
  failed_checks: string[];
  coverage: CoverageNumbers;
}

export interface BaselineCaseRow {
  id: BaselineId;
  /** 该做法自己声称的可达对数（不经复核）。 */
  claimed_reachable: number;
  /** 验证器的可执行性检查（除软要求外）全部通过。 */
  executable: boolean;
  /** 验证器确认的可达对数：可执行时为重算的 |R1|；不可执行时只有原本可达的 |R0|。 */
  confirmed_reachable: number;
  /** 其中新增的对数：可执行时为重算的 G；不可执行时为 0。 */
  confirmed_new: number;
  /**
   * 声称了但验证器没有确认的对数 = max(0, claimed − confirmed)。
   * 用计数之差表示，依赖「确认的对 ⊆ 声称的对」：A 声称全部资格 eligible 的对（R1 = R0 ⊆ 其中）；
   * B 声称 R0 ∪ 自己规划的对、C 声称 R0 ∪ 有分配的对，二者都不撤回，合成 grant 只影响有分配的对，所以 R1 ⊆ 声称；
   * joint 声称的就是它的 R1。compareBaselines 只返回计数，不返回声称的对集合。
   */
  unconfirmed_claims: number;
  verified: { R1: number; G: number; L: number; N: number; cost_usd: number } | null;
  /** 原方案不可执行时，按该做法自己的顺序先到先得截断后的 |R1|；否则 null。 */
  repaired_reachable: number | null;
  /** 给了底线时：方案可执行且满足全部底线；没给底线时为 null。 */
  floors_met: boolean | null;
  /** 只有 D 行：协调轮数、是否收敛、轮数上限；其他行为 null。 */
  coordination: { rounds: number; converged: boolean; max_rounds: number } | null;
}

/** 一个用例里 D 与联合求解的对照（数字都取验证器的重算）。 */
export interface DVsJoint {
  joint_status: JointStatus;
  d_executable: boolean;
  /** D 可执行时的 N；否则 null。 */
  d_N: number | null;
  joint_N: number | null;
  /** D / 联合求解可执行时的 L、成本；否则 null。 */
  d_L: number | null;
  joint_L: number | null;
  d_cost_usd: number | null;
  joint_cost_usd: number | null;
  /** 两边都可执行，且 N、L、成本都相同。 */
  tie: boolean;
  /**
   * 两边都可执行且按目标顺序 D 更好（N 更大；N 相同时 L 更小；N、L 都相同时成本更低）。
   * 联合求解 OPTIMAL 时即联合求解器的 bug。
   */
  d_exceeds_joint: boolean;
  /** D 的 notes 说它达到节点上限或触发了规模保护（可能因此不如联合求解）。 */
  d_limited: boolean;
}

export interface CaseMetrics extends CaseSpec {
  scenario_id: string;
  /** 测量过程中的异常（只记阶段，不记异常文字，避免带出学生信息）；正常为 null。 */
  error: string | null;
  status: JointStatus | null;
  /** UNSUPPORTED_INPUT 或出错时为 null。 */
  main: MainResultMetrics | null;
  conditional: ConditionalMetrics | null;
  alternative: AlternativeMetrics | null;
  /** 求解器自称可行、交给验证器复核的方案数（主结果 / conditional / alternative）。 */
  solver_plans_checked: number;
  /** 其中被验证器拒绝的个数（求解器的假可行，预期 0）。 */
  solver_false_feasible: number;
  optimality: { main: GapCheck; conditional: GapCheck | null };
  /** 两次求解结果完全相同，且与 compareBaselines 的 joint 行方案相同；出错时为 null。 */
  deterministic: boolean | null;
  baselines: BaselineCaseRow[];
  /** D 与联合求解的对照；没有 D 行或 joint 行（输入不合法、出错）时为 null。 */
  d_vs_joint: DVsJoint | null;
}

export interface NotMeasured {
  status: 'not_measured';
  reason: string;
}

/** 基线 D 的协调轮数汇总。 */
export interface CoordinationSummary {
  status: 'measured';
  definition: string;
  note: string;
  /** 有 D 行（有轮数）的用例数。 */
  cases_measured: number;
  /** 没有 D 行的用例数（输入不合法、出错），单独计为未测量。 */
  cases_not_measured: number;
  min: number | null;
  max: number | null;
  /** 各轮数取值的用例数（按轮数升序）。 */
  distribution: { rounds: number; cases: number }[];
  not_converged: number;
}

export interface DExceedsReproducer {
  scenario_id: string;
  case_id: string;
  joint_status: JointStatus;
  d_N: number;
  joint_N: number;
  d_L: number;
  joint_L: number;
  d_cost_usd: number;
  joint_cost_usd: number;
}

/** 基线 D 与联合求解的对照汇总。 */
export interface DVsJointSummary {
  /** 两边都有行的用例数。 */
  compared: number;
  /** 两边都可执行的用例数。 */
  both_executable: number;
  /** N、L、成本都打平的用例数。 */
  ties: number;
  /** D 方案不可执行的用例数（预期 0）。 */
  d_not_executable: number;
  /** D 触发节点上限或规模保护的用例数。 */
  d_limited: number;
  /** 按目标顺序（N → L → 成本）D 的验证结果优于联合求解的用例数（预期 0；> 0 时联合求解器有问题）。 */
  d_exceeds_joint: number;
  reproducers: DExceedsReproducer[];
  note: string;
}

export interface FalseFeasibilityReproducer {
  scenario_id: string;
  case_id: string;
  kind: 'main' | 'conditional' | 'alternative';
  failed_checks: string[];
}

export interface GapReproducer {
  scenario_id: string;
  case_id: string;
  which: 'main' | 'conditional';
  problem: 'nonzero_gap' | 'status_mismatch' | 'objective_level_mismatch';
  exhaustive_N: number | null;
  solver_status: JointStatus;
  verified_N: number;
  mismatched_levels: ObjectiveLevel[];
}

export interface BaselineAggregate {
  cases: number;
  claimed_reachable: number;
  confirmed_reachable: number;
  confirmed_new: number;
  unconfirmed_claims: number;
  not_executable_cases: number;
  /** 不可执行的用例里，截断后 |R1| 之和。 */
  repaired_reachable: number;
  /** 每个用例取「可执行时的确认数；不可执行时截断后的 |R1|」之和（与 confirmed_reachable 并列，避免只看完整方案的数字）。 */
  reachable_after_truncation: number;
  /** 给了底线的用例里，方案可执行且满足全部底线的个数。 */
  floors_met_cases: number;
}

export interface ReliabilitySummary {
  cases: number;
  /** 默认用例数（每个场景一个）；baselines_default 只汇总这些用例，每个（学生, 机会）对只计一次。 */
  default_cases: number;
  /** protect 模式用例数（没有任何做法撤回已有 grant）；baselines_protect 只汇总这些用例。 */
  protect_cases: number;
  errors: number;
  status_counts: Record<JointStatus, number>;
  solver_false_feasibility: {
    plans_checked: number;
    /** 其中非空方案（改变了什么）的个数。 */
    non_empty_plans_checked: number;
    /** 其中空方案的个数（例如预算为 0 时）。 */
    empty_plans_checked: number;
    rejected: number;
    by_kind: Record<'main' | 'conditional' | 'alternative', { checked: number; rejected: number }>;
    reproducers: FalseFeasibilityReproducer[];
  };
  /** 头条：只汇总默认用例（每个对只计一次）。 */
  baselines_default: Record<BaselineId, BaselineAggregate>;
  /** 只汇总 protect 模式用例（「对 × 用例」实例数）。 */
  baselines_protect: Record<BaselineId, BaselineAggregate>;
  /** 汇总全部用例：「对 × 用例」实例数，同一个对在每个用例里各计一次。 */
  baselines: Record<BaselineId, BaselineAggregate>;
  valid_route_discovery: {
    status: 'measured_proxy';
    definition: string;
    /** 头条：默认用例中验证器确认的可达对 / 新增对。 */
    default_cases: Record<BaselineId, { confirmed_reachable: number; confirmed_new: number }>;
    /** 全部用例之和（「对 × 用例」实例数）。 */
    all_cases_pair_case_instances: Record<BaselineId, { confirmed_reachable: number; confirmed_new: number }>;
  };
  fairness_compliance: {
    cases_with_floors: number;
    /** 验证器重算：主方案满足全部底线的用例数。 */
    main_plan_meets_all: number;
    /** 其中求解器判 INFEASIBLE（底线在预算 / 名额 / 资格下达不到，没有悄悄放松）的用例数。 */
    infeasible: number;
    /** 上述 INFEASIBLE 中，穷举也判不可行的个数。 */
    infeasible_confirmed_by_exhaustive: number;
    /** 上述 INFEASIBLE 中，没有做穷举对照（太大或出错）的个数。 */
    infeasible_not_cross_checked: number;
    by_approach: Record<BaselineId, number>;
    /** 基线定义上的不对称说明（A / B / C 不考虑底线），说明 by_approach 中基线的数字不是测出来的公平优势。 */
    baseline_note: string;
  };
  optimality_gap: {
    /** 与穷举对照过的求解次数（主结果与 conditional 各算一次）。 */
    cross_checked: number;
    /** 规模超出上限、没有对照的求解次数（不是 gap 0）。 */
    skipped_too_large: number;
    /** 穷举可行、求解器 OPTIMAL、N 相同、前六级目标一致的次数。 */
    zero_gap: number;
    /** 其中最优 N > 0（方案确实改变了覆盖）的次数。 */
    zero_gap_positive_N: number;
    /** 穷举与求解器都判不可行的次数（没有 gap 可算）。 */
    both_infeasible: number;
    /** 其中预算为 0 的用例数。 */
    both_infeasible_zero_budget: number;
    /** 求解器达到搜索上限的次数（不声称最优，gap 可以 > 0，不算错误）。 */
    search_limited: number;
    nonzero_gap: number;
    status_mismatches: number;
    /** N 相同但第 2–6 级目标与穷举不一致的次数。 */
    objective_level_mismatches: number;
    /** 对照过且有 gap 的求解中最大的 gap；没有时为 null。 */
    max_gap: number | null;
    reproducers: GapReproducer[];
  };
  determinism: { cases: number; identical: number };
  coordination_rounds: CoordinationSummary;
  d_vs_joint: DVsJointSummary;
}

export interface ScenarioMetrics {
  id: string;
  title: string;
  /** 场景清单给出的「真实机会」说明；没有时为 null（机会是示例 / 占位）。 */
  real_opportunity_note: string | null;
  size: { students: number; opportunities: number; measures: number; pending_measures: number; existing_grants: number; revocable_grants: number };
  /** 本场景是否在穷举规模上限以内。 */
  within_exhaustive_limits: boolean;
  cases: CaseMetrics[];
  summary: ReliabilitySummary;
}

export interface ReliabilityReport {
  kind: 'sample_simulated';
  disclaimer: string;
  exhaustive_limits: ExhaustiveLimits;
  scenarios: ScenarioMetrics[];
  totals: ReliabilitySummary;
  not_measured: { metric: string; reason: string }[];
  definitions: Record<string, string>;
}

// ───────────────────────────── 固定文字（英文，输出用） ─────────────────────────────

export const DISCLAIMER =
  'Sample / simulated scenarios: sample students, simulated support measures and budgets. This is evidence about algorithm correctness on these inputs only, not about real-world impact. Reachable does not mean admitted.';

export const COORDINATION_DEFINITION =
  'Coordination rounds are counted for baseline D only (coordinated separate planners): one round = the student-side planner evaluates the organizer-side proposal and reports, then the organizer side re-plans. D converges when a round leaves the proposal unchanged. The joint solver is one centralized search and has no rounds.';

export const COORDINATION_NOTE =
  'In D\'s protocol the student-side planner hands over its complete conditional report in round 1, so D usually settles in round 2 (the confirmation round). The round count reflects this protocol design, not how hard coordination is.';

export const D_TIE_NOTE =
  'A tie between baseline D and the joint solver is an expected possible outcome. It is neither an advantage nor a disadvantage of the joint solver; it is only what happens on these sample scenarios.';

export const RUNTIME_NOT_MEASURED_HERE =
  'Wall-clock runtime is machine-dependent and is not computed by these pure functions; the metrics runner measures and labels it separately.';

export const VALID_ROUTE_DEFINITION =
  'Proxy: (student, opportunity) pairs that each approach\'s plan makes reachable, as confirmed by the independent verifier (non-executable plans confirm only the pairs already reachable before any plan). These are coverage pairs in the organizer scenarios, not student-side preparation routes.';

export const BASELINE_DEFINITION_NOTE =
  'By definition (CONTRACT section 10, lib/joint/baselines.ts), B and C never revoke existing grants, and A, B and C do not take fairness floors into account. D (coordinated separate planners) follows the same revocation rules as the joint solver and does take fairness floors and the other organizer requirements into account.';

export const FAIRNESS_BASELINE_NOTE =
  'A, B and C do not take fairness floors into account by definition, so their floor results follow from how the baselines are defined; they are not a measured fairness win for the joint solver. D does take fairness floors into account, so its floor results are on the same terms as the joint solver\'s.';

export const SHARED_MODEL_NOTE =
  'The verifier, the solver and the exhaustive search all use the same student-side model (analyzeReachability, checkEligibility). These metrics therefore cannot detect an error in that shared model; they test the search and the plan-level constraints (capacity, budget, mutual exclusions, prerequisites, revocations, losses and fairness floors).';

export const DEFINITIONS: Record<string, string> = {
  pairs: 'R0, R1, G, L and N count (student, opportunity) pairs, not students. G = |R1 \\ R0|, L = |R0 \\ R1|, N = G - L.',
  recomputation: 'Coverage, cost and fairness numbers are the verifier\'s own recomputation, not the solver\'s reported values.',
  shared_model: SHARED_MODEL_NOTE,
  default_case: 'The default case of a scenario is protect mode, the scenario budget and no fairness floors. Headline baseline numbers use only this case, so each (student, opportunity) pair is counted once.',
  pair_case_instances: 'Sums over several cases count pair-case instances: the same (student, opportunity) pair counts once per case.',
  solver_false_feasibility:
    'Plans the solver returned as feasible (main result, conditional result, relaxed alternative) that the independent verifier rejects. A SEARCH_LIMIT_REACHED result counts as returned feasible when its plan is non-empty or the solver says it passed its own check. Expected 0.',
  baseline_unconfirmed: 'Pairs a baseline claims reachable that the verifier does not confirm. A non-executable plan confirms only the pairs reachable before any plan.',
  baseline_asymmetry: BASELINE_DEFINITION_NOTE,
  optimality_gap:
    'Exhaustive best N minus the verifier\'s recomputed N of the solver\'s plan, on cases small enough for the exhaustive reference search. Objective levels 1-6 (N, L, total cost, allocation count, measure count, revocation count) are compared; the final lexicographic tie-break is not compared. Skipped cases are reported as skipped, never as gap 0.',
  fairness_compliance: 'Of the cases run with the scenario\'s suggested fairness floors, how many plans meet every floor (verifier recomputation).',
  determinism: 'Solving the same case twice gives identical results, and the baseline comparison\'s joint row has the same plan.',
  coordination_rounds: COORDINATION_DEFINITION,
  d_vs_joint:
    'For each case, baseline D\'s plan and the joint solver\'s plan are both recomputed by the verifier. A tie means both are executable and N, L and total cost are equal. D doing better than the joint solver on N, L or cost (objective order: larger N, then smaller L, then lower cost) would point to a problem in the joint solver and is listed separately.',
};

// ───────────────────────────── 工具 ─────────────────────────────

const EPS = 1e-6;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function roundCents(x: number): number {
  return Math.round(x * 100) / 100;
}

function failedNames(r: VerifyResult): string[] {
  return r.checks.filter((c) => !c.passed).map((c) => c.name);
}

/** 复核选项（契约第 0 条）：与求解相同的 mode / loss_cap / 软要求。 */
function verifyOptionsOf(o: SolveOptions): VerifyOptions {
  const v: VerifyOptions = {};
  if (o.mode !== undefined) v.mode = o.mode;
  if (o.loss_cap !== undefined) v.loss_cap = o.loss_cap;
  if (o.required_intervention_ids !== undefined) v.required_intervention_ids = o.required_intervention_ids;
  if (o.min_gain !== undefined) v.min_gain = o.min_gain;
  if (o.fairness_floors !== undefined) v.fairness_floors = o.fairness_floors;
  return v;
}

function withoutRelaxed(v: VerifyOptions, relaxed: readonly SoftRequirementKey[]): VerifyOptions {
  const out: VerifyOptions = { ...v };
  for (const k of relaxed) delete out[k];
  return out;
}

function coverageOf(m: RecomputedMetrics): CoverageNumbers {
  return { R0: m.R0.length, R1: m.R1.length, G: m.G, L: m.L, N: m.N, cost_usd: m.total_usd, revoked_grants: m.revoked_grant_ids.length };
}

/** 只取方案三个字段（按原顺序），用于确定性比较。 */
function planKey(p: JointPlan): string {
  return JSON.stringify([p.selected_intervention_ids, p.allocations, p.revoked_grant_ids ?? []]);
}

function isEmptyPlan(p: JointPlan): boolean {
  return p.selected_intervention_ids.length === 0 && p.allocations.length === 0 && (p.revoked_grant_ids ?? []).length === 0;
}

/** 场景规模（取验证器的归一化结果，「可撤回」等规则不在这里重新实现）。出错时全为 0。 */
function scenarioSize(scenario: Scenario): ScenarioMetrics['size'] {
  try {
    const n = createJointEvaluator(scenario).norm;
    return {
      students: n.studentById.size,
      opportunities: n.oppById.size,
      measures: n.intById.size,
      pending_measures: [...n.intById.values()].filter((iv) => iv.status === 'pending').length,
      existing_grants: n.existing.length,
      revocable_grants: n.revocable.length,
    };
  } catch {
    return { students: 0, opportunities: 0, measures: 0, pending_measures: 0, existing_grants: 0, revocable_grants: 0 };
  }
}

function withinLimits(size: ScenarioMetrics['size'], limits: ExhaustiveLimits): boolean {
  return (
    size.students * size.opportunities <= limits.pairs &&
    size.measures <= limits.interventions &&
    size.revocable_grants <= limits.revocableGrants
  );
}

// ───────────────────────────── 用例 ─────────────────────────────

function budgetLabel(factor: number, budget: number): string {
  const amount = isFiniteNumber(budget) ? `$${budget}` : 'invalid budget';
  return factor === 1 ? `${amount} (x1, default)` : `${amount} (x${factor})`;
}

/** 复制底线（不合法的字段原样保留，交给求解器判 UNSUPPORTED_INPUT；只防止复制本身抛错）。 */
function copyFloor(f: FairnessFloor): FairnessFloor {
  if (f == null || typeof f !== 'object') return f;
  const statuses: FairnessFloor['statuses_any_of'] = Array.isArray(f.statuses_any_of) ? [...f.statuses_any_of] : f.statuses_any_of;
  return { ...f, statuses_any_of: statuses };
}

function floorId(f: FairnessFloor): string {
  return f != null && typeof f === 'object' && typeof f.id === 'string' ? f.id : '(invalid floor)';
}

function makeCase(
  scenario: Scenario,
  mode: 'protect' | 'tradeoff',
  lossCap: number | null,
  budget: number,
  factor: number,
  floors: readonly FairnessFloor[],
): MetricsCase {
  const options: SolveOptions = { mode };
  if (mode === 'tradeoff' && lossCap !== null) options.loss_cap = lossCap;
  if (floors.length > 0) options.fairness_floors = floors.map(copyFloor);
  const modeId = mode === 'tradeoff' ? `tradeoff-cap${lossCap}` : 'protect';
  const spec: CaseSpec = {
    case_id: `${modeId}/budget-x${factor}${floors.length > 0 ? '/floors' : ''}`,
    label: `${mode === 'tradeoff' ? `trade-off (loss cap ${lossCap})` : 'protect'}, budget ${budgetLabel(factor, budget)}${floors.length > 0 ? ', suggested floors' : ', no floors'}`,
    mode,
    loss_cap: mode === 'tradeoff' ? lossCap : null,
    budget_usd: budget,
    budget_factor: factor,
    floor_ids: floors.map(floorId),
    is_default: mode === 'protect' && factor === 1 && floors.length === 0,
  };
  // 默认预算直接用原场景对象（不复制）；其余经 withBudget 得到新对象，不修改输入。
  const caseScenario = factor === 1 ? scenario : withBudget(scenario, budget);
  return { spec, scenario: caseScenario, options };
}

/** 同 buildCases，但把内部异常交给调用方（measureScenario 据此输出一条出错的用例）。 */
function buildCasesOrError(entry: MetricsScenarioInput): { cases: MetricsCase[]; error: string | null } {
  try {
    const scenario = entry?.scenario;
    const base = isFiniteNumber(scenario?.budget_usd) ? scenario.budget_usd : NaN;
    const rawFloors = entry?.suggestedFairnessFloors;
    const floors: FairnessFloor[] = Array.isArray(rawFloors) ? [...(rawFloors as readonly FairnessFloor[])] : [];
    const floorSets: FairnessFloor[][] = floors.length > 0 ? [[], floors] : [[]];
    const factors = Number.isFinite(base) ? BUDGET_FACTORS : [1];
    const cases: MetricsCase[] = [];
    for (const factor of factors) {
      const budget = Number.isFinite(base) ? roundCents(base * factor) : base;
      for (const fl of floorSets) cases.push(makeCase(scenario, 'protect', null, budget, factor, fl));
    }
    const revocable = scenarioSize(scenario).revocable_grants;
    if (revocable > 0) {
      for (const fl of floorSets) cases.push(makeCase(scenario, 'tradeoff', revocable, base, 1, fl));
    }
    return { cases, error: null };
  } catch {
    return { cases: [], error: 'exception during buildCases' };
  }
}

/**
 * 一个场景的确定性用例列表（顺序固定）：预算倍数 × {不设底线, 预设底线}（protect），
 * 有可撤回已有 grant 时再加默认预算的 tradeoff 用例（loss_cap = 可撤回 grant 条数）。第一项是默认用例。
 * 不抛异常：内部出错时返回 []（measureScenario 会把它记成一条出错的用例）。
 */
export function buildCases(entry: MetricsScenarioInput): MetricsCase[] {
  return buildCasesOrError(entry).cases;
}

// ───────────────────────────── 单个用例 ─────────────────────────────

/**
 * 求解器是否把方案当作可行方案给出：OPTIMAL；或 SEARCH_LIMIT_REACHED 且（方案非空，或求解器说它自己的复核通过）。
 * 不只依赖求解器自己的标记：达到上限时返回的非空方案无论标记如何都算「自称可行」，交给验证器判。
 */
function claimedFeasible(status: JointStatus, plan: JointPlan, selfCheckPassed: boolean | null): boolean {
  if (status === 'OPTIMAL') return true;
  if (status === 'SEARCH_LIMIT_REACHED') return !isEmptyPlan(plan) || selfCheckPassed === true;
  return false;
}

/** 与穷举对照。N / L / 成本 / 撤回数取验证器的重算值，分配条数与措施数取方案本身。 */
function gapCheck(scenario: Scenario, vo: VerifyOptions, status: JointStatus, verified: RecomputedMetrics, plan: JointPlan): GapCheck {
  const ex = exhaustiveBest(scenario, vo);
  const solverHasPlan = status === 'OPTIMAL' || status === 'SEARCH_LIMIT_REACHED';
  const statusAgrees = ex.feasible ? solverHasPlan : status === 'INFEASIBLE';
  const comparable = ex.feasible && solverHasPlan;
  const mismatched: ObjectiveLevel[] = [];
  if (comparable) {
    if (ex.N !== verified.N) mismatched.push('N');
    if (ex.L !== verified.L) mismatched.push('L');
    if (Math.abs(ex.total_usd - verified.total_usd) > EPS) mismatched.push('total_cost');
    if (ex.allocationCount !== plan.allocations.length) mismatched.push('allocation_count');
    if (ex.selectedCount !== plan.selected_intervention_ids.length) mismatched.push('measure_count');
    if (ex.revokedCount !== verified.revoked_grant_ids.length) mismatched.push('revocation_count');
  }
  return {
    checked: true,
    exhaustive_feasible: ex.feasible,
    exhaustive_N: ex.feasible ? ex.N : null,
    solver_status: status,
    verified_N: verified.N,
    gap_N: comparable ? ex.N - verified.N : null,
    status_agrees: statusAgrees,
    objective_levels_1_6_agree: comparable ? mismatched.length === 0 : null,
    mismatched_levels: mismatched,
  };
}

function baselineRow(row: BaselineRow, r0: number, floorsGiven: boolean): BaselineCaseRow {
  const v = row.verified;
  const confirmed = v ? v.R1_count : r0;
  return {
    id: row.id,
    claimed_reachable: row.claimed_reachable,
    executable: v !== null,
    confirmed_reachable: confirmed,
    confirmed_new: v ? v.G : 0,
    unconfirmed_claims: Math.max(0, row.claimed_reachable - confirmed),
    verified: v ? { R1: v.R1_count, G: v.G, L: v.L, N: v.N, cost_usd: v.total_usd } : null,
    repaired_reachable: row.repaired ? row.repaired.R1_count : null,
    floors_met: floorsGiven ? v !== null && row.soft_requirements_met === true : null,
    coordination: row.coordination ? { ...row.coordination } : null,
  };
}

/**
 * 按联合求解的目标顺序比较两个验证器重算的结果：N 大者胜；N 相同看 L 小者胜；再相同看成本低者胜
 * （成本差在 EPS 内视为相同）。a 严格更好时返回 true。
 */
export function betterByObjective(
  a: { N: number; L: number; total_usd: number },
  b: { N: number; L: number; total_usd: number },
): boolean {
  if (a.N !== b.N) return a.N > b.N;
  if (a.L !== b.L) return a.L < b.L;
  return a.total_usd < b.total_usd - EPS;
}

function dVsJointOf(status: JointStatus, rows: readonly BaselineRow[], notes: readonly string[]): DVsJoint | null {
  const d = rows.find((r) => r.id === 'D_coordinated');
  const j = rows.find((r) => r.id === 'joint');
  if (!d || !j) return null;
  const dv = d.verified;
  const jv = j.verified;
  const both = dv !== null && jv !== null;
  return {
    joint_status: status,
    d_executable: dv !== null,
    d_N: dv ? dv.N : null,
    joint_N: jv ? jv.N : null,
    d_L: dv ? dv.L : null,
    joint_L: jv ? jv.L : null,
    d_cost_usd: dv ? dv.total_usd : null,
    joint_cost_usd: jv ? jv.total_usd : null,
    tie: both && dv.N === jv.N && dv.L === jv.L && Math.abs(dv.total_usd - jv.total_usd) <= EPS,
    d_exceeds_joint: both && betterByObjective(dv, jv),
    d_limited: notes.some((n) => n.startsWith('Baseline D') && /node limit|may be worse/.test(n)),
  };
}

function emptyCase(scenarioId: string, spec: CaseSpec, error: string | null, status: JointStatus | null): CaseMetrics {
  return {
    ...spec,
    floor_ids: [...spec.floor_ids],
    scenario_id: scenarioId,
    error,
    status,
    main: null,
    conditional: null,
    alternative: null,
    solver_plans_checked: 0,
    solver_false_feasible: 0,
    optimality: { main: { checked: false, reason: error ? 'error' : 'not_applicable' }, conditional: null },
    deterministic: null,
    baselines: [],
    d_vs_joint: null,
  };
}

/** 测量一个用例。crossCheck = 是否做穷举对照（调用方按规模决定）。不抛异常。 */
export function measureCase(scenarioId: string, c: MetricsCase, crossCheck: boolean): CaseMetrics {
  let stage = 'solveJoint';
  try {
    const J = solveJoint(c.scenario, c.options);
    stage = 'solveJoint (repeat)';
    const J2 = solveJoint(c.scenario, c.options);
    const sameOnRepeat = JSON.stringify(J) === JSON.stringify(J2);

    stage = 'compareBaselines';
    const comparison = compareBaselines(c.scenario, c.options);
    const jointRow = comparison.rows.find((r) => r.id === 'joint');

    if (J.status === 'UNSUPPORTED_INPUT') {
      const out = emptyCase(scenarioId, c.spec, null, J.status);
      out.deterministic = sameOnRepeat && comparison.rows.length === 0;
      return out;
    }

    stage = 'verifyPlan';
    const vo = verifyOptionsOf(c.options);
    const ev = createJointEvaluator(c.scenario);
    const floorsGiven = Array.isArray(c.options.fairness_floors);
    let checked = 0;
    let rejected = 0;

    // 主结果：传入完整的 JointResult，metrics 检查会核对求解器自报的指标。
    const mainV = verifyAndMeasure(ev, J, vo);
    const mainClaimed = claimedFeasible(J.status, J, J.verification ? J.verification.passed : null);
    if (mainClaimed) {
      checked++;
      if (!mainV.result.passed) rejected++;
    }
    const fairness = mainV.metrics.fairness
      ? mainV.metrics.fairness.map((f) => ({
          floor_id: f.floor_id,
          eligible_members: f.eligible_members,
          covered_members: f.covered_members,
          ratio: f.ratio,
          min_ratio: f.min_ratio,
          met: f.satisfied,
        }))
      : null;
    const main: MainResultMetrics = {
      claimed_feasible: mainClaimed,
      empty_plan: isEmptyPlan(J),
      verifier_passed: mainV.result.passed,
      failed_checks: failedNames(mainV.result),
      coverage: coverageOf(mainV.metrics),
      fairness: floorsGiven ? fairness : null,
      all_floors_met: floorsGiven && fairness ? fairness.every((f) => f.met) : null,
    };

    // conditional：把 pending 措施当作已批准复核（conditional 不带自己的复核结果，按方案是否非空判断）。
    let conditional: ConditionalMetrics | null = null;
    let condVerified: RecomputedMetrics | null = null;
    let cvo: VerifyOptions | null = null;
    if (J.conditional) {
      const cond = J.conditional;
      cvo = { ...vo, assume_approved_intervention_ids: [...cond.assumed_approved_intervention_ids] };
      const cv = verifyAndMeasure(ev, cond, cvo);
      condVerified = cv.metrics;
      const claimed = claimedFeasible(cond.status, cond, null);
      if (claimed) {
        checked++;
        if (!cv.result.passed) rejected++;
      }
      const pendingIds = [...ev.norm.intById.values()].filter((iv) => iv.status === 'pending').map((iv) => iv.id).sort();
      const assumed = [...cond.assumed_approved_intervention_ids].sort();
      conditional = {
        status: cond.status,
        assumed_approved: cond.assumed_approved_intervention_ids.length,
        pending_ids_match: JSON.stringify(assumed) === JSON.stringify(pendingIds),
        claimed_feasible: claimed,
        empty_plan: isEmptyPlan(cond),
        verifier_passed: cv.result.passed,
        failed_checks: failedNames(cv.result),
        coverage: coverageOf(cv.metrics),
      };
    }

    // alternative：INFEASIBLE 时只放松软要求后的方案，复核选项去掉放松的各项。
    let alternative: AlternativeMetrics | null = null;
    if (J.status === 'INFEASIBLE' && J.alternative) {
      const alt = J.alternative;
      const av = verifyAndMeasure(ev, alt, withoutRelaxed(vo, alt.relaxed));
      checked++;
      if (!av.result.passed) rejected++;
      alternative = {
        relaxed: [...alt.relaxed],
        empty_plan: isEmptyPlan(alt),
        verifier_passed: av.result.passed,
        failed_checks: failedNames(av.result),
        coverage: coverageOf(av.metrics),
      };
    }

    stage = 'exhaustiveBest';
    const optimality: CaseMetrics['optimality'] = {
      main: crossCheck ? gapCheck(c.scenario, vo, J.status, mainV.metrics, J) : { checked: false, reason: 'too_large' },
      conditional: null,
    };
    if (J.conditional && cvo && condVerified) {
      optimality.conditional = crossCheck
        ? gapCheck(c.scenario, cvo, J.conditional.status, condVerified, J.conditional)
        : { checked: false, reason: 'too_large' };
    }

    const baselines = comparison.rows.map((r) => baselineRow(r, main.coverage.R0, floorsGiven));
    const sameAsBaselineJoint = jointRow !== undefined && planKey(jointRow.plan) === planKey(J);

    return {
      ...c.spec,
      floor_ids: [...c.spec.floor_ids],
      scenario_id: scenarioId,
      error: null,
      status: J.status,
      main,
      conditional,
      alternative,
      solver_plans_checked: checked,
      solver_false_feasible: rejected,
      optimality,
      deterministic: sameOnRepeat && sameAsBaselineJoint,
      baselines,
      d_vs_joint: dVsJointOf(J.status, comparison.rows, comparison.notes),
    };
  } catch {
    return emptyCase(scenarioId, c.spec, `exception during ${stage}`, null);
  }
}

// ───────────────────────────── 汇总 ─────────────────────────────

function zeroBaselineAggregate(): BaselineAggregate {
  return {
    cases: 0,
    claimed_reachable: 0,
    confirmed_reachable: 0,
    confirmed_new: 0,
    unconfirmed_claims: 0,
    not_executable_cases: 0,
    repaired_reachable: 0,
    reachable_after_truncation: 0,
    floors_met_cases: 0,
  };
}

function byBaseline<T>(make: () => T): Record<BaselineId, T> {
  return {
    A_eligibility_only: make(),
    B_student_side: make(),
    C_organizer_side: make(),
    D_coordinated: make(),
    joint: make(),
  };
}

function addBaselineRow(agg: BaselineAggregate, row: BaselineCaseRow): void {
  agg.cases++;
  agg.claimed_reachable += row.claimed_reachable;
  agg.confirmed_reachable += row.confirmed_reachable;
  agg.confirmed_new += row.confirmed_new;
  agg.unconfirmed_claims += row.unconfirmed_claims;
  if (!row.executable) agg.not_executable_cases++;
  if (row.repaired_reachable !== null) agg.repaired_reachable += row.repaired_reachable;
  agg.reachable_after_truncation += row.executable ? row.confirmed_reachable : (row.repaired_reachable ?? row.confirmed_reachable);
  if (row.floors_met === true) agg.floors_met_cases++;
}

function discoveryOf(aggs: Record<BaselineId, BaselineAggregate>): Record<BaselineId, { confirmed_reachable: number; confirmed_new: number }> {
  return Object.fromEntries(
    BASELINE_IDS.map((id) => [id, { confirmed_reachable: aggs[id].confirmed_reachable, confirmed_new: aggs[id].confirmed_new }]),
  ) as Record<BaselineId, { confirmed_reachable: number; confirmed_new: number }>;
}

/** 把一组用例汇总成各项指标（纯函数，不抛异常）。 */
export function summarize(cases: readonly CaseMetrics[]): ReliabilitySummary {
  const list: readonly CaseMetrics[] = Array.isArray(cases) ? cases : [];
  const status_counts = Object.fromEntries(JOINT_STATUSES.map((s) => [s, 0])) as Record<JointStatus, number>;
  const ff: ReliabilitySummary['solver_false_feasibility'] = {
    plans_checked: 0,
    non_empty_plans_checked: 0,
    empty_plans_checked: 0,
    rejected: 0,
    by_kind: { main: { checked: 0, rejected: 0 }, conditional: { checked: 0, rejected: 0 }, alternative: { checked: 0, rejected: 0 } },
    reproducers: [],
  };
  const baselines = byBaseline(zeroBaselineAggregate);
  const baselinesDefault = byBaseline(zeroBaselineAggregate);
  const baselinesProtect = byBaseline(zeroBaselineAggregate);
  const fairness: ReliabilitySummary['fairness_compliance'] = {
    cases_with_floors: 0,
    main_plan_meets_all: 0,
    infeasible: 0,
    infeasible_confirmed_by_exhaustive: 0,
    infeasible_not_cross_checked: 0,
    by_approach: byBaseline(() => 0),
    baseline_note: FAIRNESS_BASELINE_NOTE,
  };
  const gap: ReliabilitySummary['optimality_gap'] = {
    cross_checked: 0,
    skipped_too_large: 0,
    zero_gap: 0,
    zero_gap_positive_N: 0,
    both_infeasible: 0,
    both_infeasible_zero_budget: 0,
    search_limited: 0,
    nonzero_gap: 0,
    status_mismatches: 0,
    objective_level_mismatches: 0,
    max_gap: null,
    reproducers: [],
  };
  const rounds = new Map<number, number>();
  let roundsMeasured = 0;
  let roundsNotMeasured = 0;
  let notConverged = 0;
  const dj: DVsJointSummary = {
    compared: 0,
    both_executable: 0,
    ties: 0,
    d_not_executable: 0,
    d_limited: 0,
    d_exceeds_joint: 0,
    reproducers: [],
    note: D_TIE_NOTE,
  };
  let errors = 0;
  let defaultCases = 0;
  let protectCases = 0;
  let detCases = 0;
  let detSame = 0;

  const addPlan = (c: CaseMetrics, kind: 'main' | 'conditional' | 'alternative', claimed: boolean, empty: boolean, passed: boolean, failed: string[]) => {
    if (!claimed) return;
    ff.plans_checked++;
    if (empty) ff.empty_plans_checked++;
    else ff.non_empty_plans_checked++;
    ff.by_kind[kind].checked++;
    if (!passed) {
      ff.rejected++;
      ff.by_kind[kind].rejected++;
      ff.reproducers.push({ scenario_id: c.scenario_id, case_id: c.case_id, kind, failed_checks: [...failed] });
    }
  };

  const addGap = (c: CaseMetrics, which: 'main' | 'conditional', g: GapCheck | null) => {
    if (g === null) return;
    if (!g.checked) {
      if (g.reason === 'too_large') gap.skipped_too_large++;
      return;
    }
    gap.cross_checked++;
    const repro = (problem: GapReproducer['problem']) =>
      gap.reproducers.push({
        scenario_id: c.scenario_id,
        case_id: c.case_id,
        which,
        problem,
        exhaustive_N: g.exhaustive_N,
        solver_status: g.solver_status,
        verified_N: g.verified_N,
        mismatched_levels: [...g.mismatched_levels],
      });
    if (!g.status_agrees) {
      gap.status_mismatches++;
      repro('status_mismatch');
      return;
    }
    if (!g.exhaustive_feasible) {
      gap.both_infeasible++;
      if (c.budget_usd === 0) gap.both_infeasible_zero_budget++;
      return;
    }
    if (g.gap_N !== null) gap.max_gap = gap.max_gap === null ? g.gap_N : Math.max(gap.max_gap, g.gap_N);
    if (g.solver_status === 'SEARCH_LIMIT_REACHED') {
      gap.search_limited++;
      return;
    }
    if (g.gap_N !== 0) {
      gap.nonzero_gap++;
      repro('nonzero_gap');
    } else if (g.objective_levels_1_6_agree === false) {
      gap.objective_level_mismatches++;
      repro('objective_level_mismatch');
    } else {
      gap.zero_gap++;
      if ((g.exhaustive_N ?? 0) > 0) gap.zero_gap_positive_N++;
    }
  };

  for (const c of list) {
    if (c.error) errors++;
    if (c.status) status_counts[c.status]++;
    if (c.is_default) defaultCases++;
    if (c.mode === 'protect') protectCases++;
    if (c.main) addPlan(c, 'main', c.main.claimed_feasible, c.main.empty_plan, c.main.verifier_passed, c.main.failed_checks);
    if (c.conditional) {
      addPlan(c, 'conditional', c.conditional.claimed_feasible, c.conditional.empty_plan, c.conditional.verifier_passed, c.conditional.failed_checks);
    }
    if (c.alternative) addPlan(c, 'alternative', true, c.alternative.empty_plan, c.alternative.verifier_passed, c.alternative.failed_checks);

    const floorsGiven = c.floor_ids.length > 0;
    if (floorsGiven && c.main) {
      fairness.cases_with_floors++;
      if (c.main.all_floors_met === true) fairness.main_plan_meets_all++;
      if (c.status === 'INFEASIBLE') {
        fairness.infeasible++;
        const g = c.optimality.main;
        if (!g.checked) fairness.infeasible_not_cross_checked++;
        else if (!g.exhaustive_feasible) fairness.infeasible_confirmed_by_exhaustive++;
      }
    }

    for (const row of c.baselines) {
      if (!baselines[row.id]) continue;
      addBaselineRow(baselines[row.id], row);
      if (c.is_default) addBaselineRow(baselinesDefault[row.id], row);
      if (c.mode === 'protect') addBaselineRow(baselinesProtect[row.id], row);
      if (row.floors_met === true) fairness.by_approach[row.id]++;
    }

    addGap(c, 'main', c.optimality.main);
    addGap(c, 'conditional', c.optimality.conditional);

    const dRow = c.baselines.find((r) => r.id === 'D_coordinated');
    if (dRow && dRow.coordination) {
      roundsMeasured++;
      rounds.set(dRow.coordination.rounds, (rounds.get(dRow.coordination.rounds) ?? 0) + 1);
      if (!dRow.coordination.converged) notConverged++;
    } else {
      roundsNotMeasured++;
    }
    const v = c.d_vs_joint ?? null;
    if (v) {
      dj.compared++;
      if (v.d_executable && v.joint_N !== null) dj.both_executable++;
      if (v.tie) dj.ties++;
      if (!v.d_executable) dj.d_not_executable++;
      if (v.d_limited) dj.d_limited++;
      if (v.d_exceeds_joint) {
        dj.d_exceeds_joint++;
        dj.reproducers.push({
          scenario_id: c.scenario_id,
          case_id: c.case_id,
          joint_status: v.joint_status,
          d_N: v.d_N ?? 0,
          joint_N: v.joint_N ?? 0,
          d_L: v.d_L ?? 0,
          joint_L: v.joint_L ?? 0,
          d_cost_usd: v.d_cost_usd ?? 0,
          joint_cost_usd: v.joint_cost_usd ?? 0,
        });
      }
    }

    if (c.deterministic !== null) {
      detCases++;
      if (c.deterministic) detSame++;
    }
  }

  return {
    cases: list.length,
    default_cases: defaultCases,
    protect_cases: protectCases,
    errors,
    status_counts,
    solver_false_feasibility: ff,
    baselines_default: baselinesDefault,
    baselines_protect: baselinesProtect,
    baselines,
    valid_route_discovery: {
      status: 'measured_proxy',
      definition: VALID_ROUTE_DEFINITION,
      default_cases: discoveryOf(baselinesDefault),
      all_cases_pair_case_instances: discoveryOf(baselines),
    },
    fairness_compliance: fairness,
    optimality_gap: gap,
    determinism: { cases: detCases, identical: detSame },
    coordination_rounds: {
      status: 'measured',
      definition: COORDINATION_DEFINITION,
      note: COORDINATION_NOTE,
      cases_measured: roundsMeasured,
      cases_not_measured: roundsNotMeasured,
      min: rounds.size > 0 ? Math.min(...rounds.keys()) : null,
      max: rounds.size > 0 ? Math.max(...rounds.keys()) : null,
      distribution: [...rounds.entries()].sort((a, b) => a[0] - b[0]).map(([r, n]) => ({ rounds: r, cases: n })),
      not_converged: notConverged,
    },
    d_vs_joint: dj,
  };
}

// ───────────────────────────── 场景与全部 ─────────────────────────────

/** buildCases 出错时代替全部用例的一条「出错用例」，让这个场景照样出现在结果里。 */
function buildErrorCase(scenarioId: string, error: string): CaseMetrics {
  const spec: CaseSpec = {
    case_id: 'build-cases',
    label: 'case list could not be built',
    mode: 'protect',
    loss_cap: null,
    budget_usd: NaN,
    budget_factor: 1,
    floor_ids: [],
    is_default: false,
  };
  return emptyCase(scenarioId, spec, error, null);
}

/** 测量一个场景的全部用例（cases 缺省 = buildCases(entry)）。不抛异常。 */
export function measureScenario(entry: MetricsScenarioInput, cases?: readonly MetricsCase[], options: MeasureOptions = {}): ScenarioMetrics {
  const id = typeof entry?.id === 'string' ? entry.id : 'unknown-scenario';
  const title = typeof entry?.title === 'string' ? entry.title : typeof entry?.scenario?.title === 'string' ? entry.scenario.title : id;
  const note = typeof entry?.realOpportunityNote === 'string' && entry.realOpportunityNote.trim() !== '' ? entry.realOpportunityNote : null;
  const size = scenarioSize(entry?.scenario);
  const limits = options.exhaustiveLimits ?? DEFAULT_EXHAUSTIVE_LIMITS;
  const crossCheck = withinLimits(size, limits);
  let measured: CaseMetrics[];
  if (cases) {
    measured = cases.map((c) => measureCase(id, c, crossCheck));
  } else {
    const built = buildCasesOrError(entry);
    measured = built.error ? [buildErrorCase(id, built.error)] : built.cases.map((c) => measureCase(id, c, crossCheck));
  }
  return {
    id,
    title,
    real_opportunity_note: note,
    size,
    within_exhaustive_limits: crossCheck,
    cases: measured,
    summary: summarize(measured),
  };
}

/** 测量全部场景，并给出总汇总。不抛异常。 */
export function measureAll(entries: readonly MetricsScenarioInput[], options: MeasureOptions = {}): ReliabilityReport {
  const list: readonly MetricsScenarioInput[] = Array.isArray(entries) ? entries : [];
  return buildReport(
    list.map((e) => measureScenario(e, undefined, options)),
    options,
  );
}

/** 把逐场景的结果拼成完整报告（总汇总 + 未测指标 + 定义）。runner 逐场景计时后用它拼装。 */
export function buildReport(scenarios: readonly ScenarioMetrics[], options: MeasureOptions = {}): ReliabilityReport {
  return {
    kind: 'sample_simulated',
    disclaimer: DISCLAIMER,
    exhaustive_limits: { ...(options.exhaustiveLimits ?? DEFAULT_EXHAUSTIVE_LIMITS) },
    scenarios: [...scenarios],
    totals: summarize(scenarios.flatMap((s) => s.cases)),
    not_measured: [{ metric: 'runtime', reason: RUNTIME_NOT_MEASURED_HERE }],
    definitions: { ...DEFINITIONS, valid_route_discovery: VALID_ROUTE_DEFINITION },
  };
}
