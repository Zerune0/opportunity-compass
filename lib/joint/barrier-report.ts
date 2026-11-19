/**
 * summarizeBarriers(scenario, deps?) —— 主办方端「障碍汇总」视图模型（示例 / 模拟数据，只给汇总人数）。
 *
 * 对场景内每个（学生, 机会）对，用 analyzeReachability(student, opp, 该对已有的 approved grant,
 * { today: scenario.evaluation_date }) 评估一次（记为 r），再按下面的口径汇总。所有计数都按「对」计，不按人计。
 *
 * 措施的「有效状态」：措施本身已批准、且它的前置依赖（requires 传递闭包）全部在场景里且已批准 → approved；
 * 否则 → pending（与求解器一致：依赖未批准或不存在的措施不能进入主结果，只可能随审批出现在条件性结果里）。
 * 「适用」= opportunity_ids 缺省 / null，或包含该机会（[] = 不适用于任何机会）。
 *
 * 每个有未化解障碍的对，最多再跑两次 analyzeReachability（grant 对可达性单调、且只作用于自己的障碍类型，
 * 所以「全部一起加」能化解 ⇔ 存在某个子集能化解）：
 * - A 运行：加上全部「适用 + 有效 approved」措施的合成 grant（字段与求解器一致，见 syntheticMeasureGrant）；
 * - A+P 运行：再加上全部「适用 + 有效 pending」措施的合成 grant（只用于 pending_only 原因）。
 *
 * 口径（每条一句）：
 * - 障碍行固定为 time、cost、transport、device 四行（按此顺序）；引擎若出现这四类以外的障碍类型，
 *   归入追加在最后的 other 行（只在 other 行有受影响的对时出现，不丢弃）。
 * - affected_pairs：r 中仍有该类未化解障碍的对。
 * - removable_by_approved_measure（上界）：受影响的对中，没有落入下面 1–4 号「整对」原因，且 A 运行后
 *   该类障碍不再有未化解的。不看名额、预算、互斥（含需要停掉已发出支持的措施）以及前置依赖的名额与费用。
 * - 其余受影响的对按以下优先级落入**恰好一个**原因桶（合计 = affected_pairs − removable）：
 *   1. not_eligible：r 的总体资格为 not_eligible（措施永远不改变资格）；
 *   2. deadline_passed：r 中有 shortfall 为 null 的未化解 time 障碍（引擎约定的「已过截止日期」），按对计算一次、
 *      作用于该对的每一行；
 *   3. eligibility_unknown：总体资格 unknown（去掉障碍也只能到 null，不会可达）；
 *   4. information_missing：missing_info 非空（同上）；
 *   （可去掉）
 *   5. pending_only：A+P 运行后该类障碍没有未化解的；
 *   6. partial_match：有适用、类型对应该类障碍（SUPPORT_RESOLVES）的措施，但全部适用措施一起也化解不了；
 *   7. other_opportunity_only：类型对应的措施存在，但都不适用于该机会；
 *   8. no_measure：场景里没有任何措施对应该类障碍。
 *   已有的 pending grant 不算「措施」，也不当作已批准（与求解器的条件性结果一致）。
 * - eligibility：每个总体资格一行：对数、有未化解障碍的对数、could_become_reachable、
 *   not_removable（= 有未化解障碍 − could_become_reachable）与该资格的固定原因。
 * - reachable_now：r.reachable === true（可达 ≠ 录取）。
 * - reachability_unknown：r.reachable === null；reachability_unknown_by_category 按固定类别数这些对
 *   （资格 unknown / 学生档案字段 / 机会信息字段 / 评估日期 / 其他），只看引擎结构化字段名的前缀，
 *   不回显任何自由文本。一个对可以落在多个类别。
 * - with_unresolved_barrier：r 中至少一条未化解障碍；with_barrier_resolved_by_existing_support：
 *   至少一条障碍已被已有 approved grant 化解。
 * - could_become_reachable：r 有未化解障碍、没有落入 1–4 号整对原因，且 A 运行的 reachable === true
 *   （上界；等价于「总体资格 eligible、missing_info 为空、每一行都可去掉」）。
 *   What-if 默认方案的覆盖对数 ≤ reachable_now + could_become_reachable（有测试交叉检查）。
 *
 * 新增四部分（只加字段，不改上面任何数字的含义；都按对计，同样只给人数）：
 * - eligibility_detail（资格明细）：总体资格 not_eligible 的对，按 r.eligibility.items 里 hard 且 not_satisfied 的
 *   requirement_type 计数；总体资格 unknown 的对，按 hard 且 unknown 的 requirement_type 计数。
 *   「hard」按真值判断（与 checkEligibility 的 overallFromItems 同一口径），所以数据损坏（如 hard: 1）时，
 *   被判为 not_eligible 的对照样有对应的明细行。
 *   同一对在每种要求类型里最多计一次（同类型两条要求都不满足也只算一次），一对可以落在多行，各行之和可以超过对数。
 *   偏好（非 hard）不影响总体资格，不计。八种已知类型固定列出（0 也列），未知类型归入只在有对时追加的 other 行。
 * - participation（参与形式）：按 opp.location.format 分四行（online / hybrid / in_person / unknown；location 不是对象、
 *   format 缺失或非法一律算 unknown，与引擎 readFormat 一致）。in_person 只表示机会列表写的是线下，不代表一定没有线上
 *   参与途径（场景里的措施就可能提供线上入口），所以标签写「per the listing」。有线下部分的形式（hybrid、in_person）
 *   另数学生档案里 transport.level 为 limited / none 的对，与没填交通或等级读不了（不是三个合法值之一）的对；
 *   有线上部分的形式（online、hybrid）另数档案 devices 是数组但不含 home_internet 的对，与 devices 没填或读不了
 *   （不是数组）的对。只描述档案，不是障碍：transport 障碍行只数仍未化解的障碍
 *   （已有支持化解的不算，需要自费差旅的也算），所以两者不相同、也不互相包含，页面上写明关系，不重复计数。
 * - other_demands.team_requirement（组队要求）：读 opp.team_requirement——required === true → required；
 *   === false → not_required；=== null → unclear（字段写了，但官网没说清）；字段缺失 / null / 不是对象 / required 非法
 *   → not_recorded（数据里没有记录）。另给其中总体资格 eligible 的对数。不是障碍类型，不改变可达性，措施去不掉。
 * - other_demands.materials（材料负担，只数机会要求的）：用同一个 r，按 analyzeGaps 的 materials 组的同一分类
 *   （有 material_kind 的准备项、portfolio 要求），只数「要求的」：r.readiness_gaps 中 required_for_application === true
 *   （与引擎 requiredPrepClosure 同一口径）且准备项（按 id 取 opp.preparation 第一项）有 material_kind 的条数，
 *   加上 r.eligibility.items 中 portfolio、not_satisfied 且 hard（真值）的条数。建议（非必需）的准备项、非硬性的
 *   portfolio 要求不计；必需项依赖的非必需前置项也不计（它们的时间与费用已计入 time / cost 行）。
 *   作品要求与能产出它的准备项算两条（引擎没有给出可靠的对应关系，不去重；页面说明写明）。组队要求不在 r 里，不会混入。
 *   按 0 / 1–2 / 3 及以上分档；另给其中总体资格 eligible 的对数。
 *
 * 隐私（按构造保证）：返回值只含数字、布尔值与本文件里的固定英文字符串；不含任何学生 id、姓名、学校、
 * 年龄、年级、地区，也不含从学生记录或引擎自由文本（障碍说明、summary）派生的字符串。
 * 小数字提醒：示例场景只有几名学生，计数为 1 时就对应一名学生。这里可以接受，因为每名学生都是标注过的
 * 虚构示例（is_sample）；换成真实数据前必须先做最小分组人数等保护。界面同时显示「示例数据」的说明。
 * 参与形式的档案列 = （有该档案值的学生数）×（该形式的机会数），「按对计、不按人计」挡不住识别；资格明细又按公民身份、
 * 年龄、身份标签（如低收入、第一代大学生）等敏感维度分组，家庭网络也是敏感信息——这些表在用于任何真实数据之前都必须
 * 先做小数字抑制（最小分组人数），页面上也写明这一点。
 *
 * 纯函数：不读时钟、无随机、无 IO、不修改输入；同输入同输出。字符串比较不用 localeCompare。
 * 只给服务器端页面（app/organizer/barriers/page.tsx）与测试用；verify.ts 不得 import 本文件。
 */
import { analyzeReachability } from '../reachability';
import { BARRIER_TYPES, SUPPORT_RESOLVES } from '../types';
import type {
  BarrierType,
  EvalOptions,
  Intervention,
  Opportunity,
  OpportunityFormat,
  OverallEligibility,
  PrepItem,
  ReachabilityResult,
  RequirementType,
  ResourceGrant,
  Scenario,
  StudentProfile,
} from '../types';

// ───────────────────────────── 固定文字 ─────────────────────────────

/** 障碍行：四种已知类型 + 兜底的 other。 */
export type BarrierRowKey = BarrierType | 'other';

/** 四个固定行的顺序（other 只在有受影响的对时追加在最后）。 */
export const BARRIER_ROW_ORDER: readonly BarrierType[] = ['time', 'cost', 'transport', 'device'];

export const BARRIER_ROW_TEXT = {
  time: {
    label: 'Time',
    description: 'Not enough hours each week, not enough time before the deadline, or the deadline has passed.',
  },
  cost: { label: 'Cost', description: 'Fees and required preparation costs are more than the student can pay.' },
  transport: {
    label: 'Transport',
    description:
      'No workable way to get to an in-person or hybrid opportunity, or participants must pay for their own travel.',
  },
  device: { label: 'Device', description: 'A required device the student does not have.' },
  other: { label: 'Other', description: 'Barrier kinds that do not fit the four rows above.' },
} as const satisfies Record<BarrierRowKey, { label: string; description: string }>;

export type BarrierRowLabel = (typeof BARRIER_ROW_TEXT)[BarrierRowKey]['label'];
export type BarrierRowDescription = (typeof BARRIER_ROW_TEXT)[BarrierRowKey]['description'];

/** 不可去掉的原因（按优先级排列，也是页面上的显示顺序）。 */
export type NotRemovableReason =
  | 'not_eligible'
  | 'deadline_passed'
  | 'eligibility_unknown'
  | 'information_missing'
  | 'pending_only'
  | 'partial_match'
  | 'other_opportunity_only'
  | 'no_measure';

export const NOT_REMOVABLE_REASONS: readonly NotRemovableReason[] = [
  'not_eligible',
  'deadline_passed',
  'eligibility_unknown',
  'information_missing',
  'pending_only',
  'partial_match',
  'other_opportunity_only',
  'no_measure',
];

export const NOT_REMOVABLE_REASON_TEXT = {
  not_eligible: "The pair does not meet the opportunity's own requirements. Support measures never change eligibility.",
  deadline_passed: 'The deadline has passed, so support for any barrier would not help.',
  eligibility_unknown: 'Eligibility is not confirmed, so removing this barrier would not make the pair reachable yet.',
  information_missing: 'Information is missing, so reachability cannot be determined even with support.',
  pending_only: 'Only measures still pending approval (or approved measures that depend on them) would remove it.',
  partial_match:
    'A measure addresses this kind of barrier, but even all measures that apply here together would not fully remove it (for example the amount, hours or device does not match).',
  other_opportunity_only: 'A measure addresses this kind of barrier, but it does not apply to this opportunity.',
  no_measure: 'No support measure in this scenario addresses this kind of barrier.',
} as const satisfies Record<NotRemovableReason, string>;

export type NotRemovableReasonText = (typeof NOT_REMOVABLE_REASON_TEXT)[NotRemovableReason];

/** 总体资格的显示顺序（与 OverallEligibility 的定义顺序一致）。 */
export const OVERALL_ELIGIBILITY_ORDER: readonly OverallEligibility[] = ['eligible', 'not_eligible', 'unknown'];

export const OVERALL_ELIGIBILITY_LABELS = {
  eligible: 'Eligible',
  not_eligible: 'Not eligible',
  unknown: 'Unknown (confirm with the official source)',
} as const satisfies Record<OverallEligibility, string>;

/** 每个资格状态下「有障碍但不可能因措施变为可达」的固定原因。 */
export const ELIGIBILITY_NOT_REMOVABLE_REASON = {
  eligible:
    'Some barrier has no approved measure in this scenario that could remove it, the deadline has passed, or information is missing. See the barrier tables.',
  not_eligible: 'Not eligible: support measures do not change eligibility.',
  unknown: 'Eligibility must be confirmed first; support alone cannot make these pairs reachable.',
} as const satisfies Record<OverallEligibility, string>;

export type EligibilityLabel = (typeof OVERALL_ELIGIBILITY_LABELS)[OverallEligibility];
export type EligibilityNotRemovableReason = (typeof ELIGIBILITY_NOT_REMOVABLE_REASON)[OverallEligibility];

export const ELIGIBILITY_NOTE =
  "Support measures never change eligibility. Requirements are set by each opportunity's own organizer.";

/** 直接显示在障碍表下方的上界说明（原文由协调方指定，不要改动）。 */
export const UPPER_BOUND_NOTE =
  'Upper bound: ignores capacity, budget, prerequisites and mutual exclusions, including measures that would mean stopping support already given. See Organizer What-if for what can actually be covered.';

/** reachable === null 的对缺的是哪类信息（固定类别）。 */
export type MissingInfoCategory = 'eligibility_unknown' | 'student_profile' | 'opportunity_listing' | 'evaluation_date' | 'other';

export const MISSING_INFO_CATEGORIES: readonly MissingInfoCategory[] = [
  'eligibility_unknown',
  'student_profile',
  'opportunity_listing',
  'evaluation_date',
  'other',
];

export const MISSING_INFO_LABELS = {
  eligibility_unknown: 'Eligibility could not be confirmed (a hard requirement is unknown)',
  student_profile: 'Student profile details (devices, budget, transportation or weekly hours)',
  opportunity_listing: 'Opportunity listing details (fee, travel costs, weekly hours or deadline)',
  evaluation_date: 'Evaluation date',
  other: 'Other information',
} as const satisfies Record<MissingInfoCategory, string>;

export type MissingInfoLabel = (typeof MISSING_INFO_LABELS)[MissingInfoCategory];

export const MISSING_INFO_NOTE =
  'One pair can be missing several kinds of information, so these counts can add up to more than the total.';

/** 资格明细的行：引擎的八种要求类型 + 兜底的 other（只在有对时追加）。 */
export type EligibilityDetailKey = RequirementType | 'other';

/** 八种已知要求类型的固定顺序（与 RequirementRule 的定义顺序一致）。 */
export const ELIGIBILITY_DETAIL_ORDER: readonly RequirementType[] = [
  'grade',
  'age',
  'region',
  'citizenship',
  'status',
  'prerequisite_skill',
  'portfolio',
  'manual',
];

export const ELIGIBILITY_DETAIL_LABELS = {
  grade: 'Grade',
  age: 'Age',
  region: 'Region (country or state)',
  citizenship: 'Citizenship or residency',
  status: 'Student status (for example, high school student)',
  prerequisite_skill: 'Prerequisite skill',
  portfolio: 'Work sample or portfolio',
  manual: 'Needs a manual check (confirm with the official source)',
  other: 'Other requirement types',
} as const satisfies Record<EligibilityDetailKey, string>;

export type EligibilityDetailLabel = (typeof ELIGIBILITY_DETAIL_LABELS)[EligibilityDetailKey];

export const ELIGIBILITY_DETAIL_NOTE =
  'Only hard requirements count. A pair is counted once for each requirement type it fails (or cannot confirm), so one pair can appear in several rows and the rows can add up to more than the totals above.';

/** 参与形式四行的固定顺序（OpportunityFormat 的全部取值）。 */
export const PARTICIPATION_FORMAT_ORDER: readonly OpportunityFormat[] = ['online', 'hybrid', 'in_person', 'unknown'];

export const PARTICIPATION_FORMAT_LABELS = {
  online: 'Online',
  hybrid: 'Hybrid (partly online, partly in person)',
  in_person: 'In person (per the listing)',
  unknown: 'Format not clear in the listing',
} as const satisfies Record<OpportunityFormat, string>;

export type ParticipationFormatLabel = (typeof PARTICIPATION_FORMAT_LABELS)[OpportunityFormat];

export const PARTICIPATION_NOTE =
  'Format comes from each opportunity listing. Hybrid does not confirm that a student could take part fully online.';

/** 交通两列与障碍表 Transport 行的关系（不重复计数，只说明）。 */
export const PARTICIPATION_TRANSPORT_NOTE =
  'Transport columns show what the student profile says, for formats with an in-person part. The Transport row in the barrier table is related but not the same: it counts only transport barriers that are still unresolved (support already given is left out), and it also counts opportunities where participants pay for their own travel.';

/** home_internet 两列与障碍表 Device 行的关系。 */
export const PARTICIPATION_INTERNET_NOTE =
  'Home internet columns show whether the student profile lists reliable home internet, for formats with an online part. This is not a barrier here unless the opportunity lists home internet as a required device; the Device row already counts that case.';

/** 组队要求的四种状态（固定顺序）。 */
export type TeamRequirementStatus = 'required' | 'not_required' | 'unclear' | 'not_recorded';

export const TEAM_REQUIREMENT_ORDER: readonly TeamRequirementStatus[] = ['required', 'not_required', 'unclear', 'not_recorded'];

export const TEAM_REQUIREMENT_LABELS = {
  required: 'Team required',
  not_required: 'Not required (students can take part alone)',
  unclear: 'Unclear: the official information does not say',
  not_recorded: 'Not recorded in the listing',
} as const satisfies Record<TeamRequirementStatus, string>;

export type TeamRequirementLabel = (typeof TEAM_REQUIREMENT_LABELS)[TeamRequirementStatus];

export const TEAM_REQUIREMENT_NOTE =
  'Read from each opportunity listing. A team requirement is not a barrier type here: it does not change reachability, and no support measure removes it.';

/** 材料负担的分档（按要求的材料条数）。 */
export type MaterialsBurdenBand = 'none' | 'one_or_two' | 'three_or_more';

export const MATERIALS_BURDEN_ORDER: readonly MaterialsBurdenBand[] = ['none', 'one_or_two', 'three_or_more'];

export const MATERIALS_BURDEN_LABELS = {
  none: 'None',
  one_or_two: '1–2 items',
  three_or_more: '3 or more items',
} as const satisfies Record<MaterialsBurdenBand, string>;

export type MaterialsBurdenLabel = (typeof MATERIALS_BURDEN_LABELS)[MaterialsBurdenBand];

export const MATERIALS_BURDEN_NOTE =
  "Counts only what the opportunity requires and the student's evidence does not cover yet: prep items marked required that produce an application material, plus unmet hard work-sample requirements. Recommended preparation is not counted. A work-sample requirement and the prep item that would produce it count as separate items. The team requirement is in its own table. Time and cost of required prep already feed the Time and Cost rows.";

export const OTHER_DEMANDS_NOTE =
  'What each opportunity asks of students beyond the four barriers. The simulated support measures in this scenario do not remove these.';

/** 每个场景表格上方的简短说明。 */
export const SHORT_CAVEATS = [
  'Sample data. Not a measure of real need. Counts are (student, opportunity) pairs, not people.',
  'Removal counts are upper bounds that ignore capacity and budget. See Organizer What-if for what can actually be covered.',
] as const;

export type ShortCaveat = (typeof SHORT_CAVEATS)[number];

/** 每个场景下方的完整说明。 */
export const BARRIER_REPORT_CAVEATS = [
  'Sample data. Not a measure of real need. Every student here is a fictional sample, and the scenarios and support measures are simulated.',
  'Counts are (student, opportunity) pairs, not people: one student counts once for each opportunity in the scenario.',
  'One pair can appear in several barrier rows, so the rows do not add up to the number of pairs.',
  '"An approved measure could remove it" adds every approved measure in this scenario that applies to the opportunity at once and checks whether the barrier would be gone. It is an upper bound: it ignores capacity, budget and mutual exclusions (including measures that would mean stopping support already given), and the capacity and cost of prerequisites. The Organizer What-if page shows what a given budget can actually cover.',
  'An approved measure that depends on a measure still pending approval (or on one that is not in this scenario) counts as pending here. Measures still pending approval never count as removing a barrier.',
  'Pairs that are not eligible, whose deadline has passed, whose eligibility is not confirmed or whose information is missing never count as removable: removing a barrier would not make them reachable.',
  'Reachable does not mean admitted. It only means no eligibility conflict and workable real-world conditions.',
  'Simulated results. They do not represent real-world impact.',
] as const;

export type BarrierReportCaveat = (typeof BARRIER_REPORT_CAVEATS)[number];

// ───────────────────────────── 输出类型 ─────────────────────────────

export interface NotRemovableReasonCount {
  reason: NotRemovableReason;
  text: NotRemovableReasonText;
  pairs: number;
}

export interface BarrierRow {
  key: BarrierRowKey;
  label: BarrierRowLabel;
  description: BarrierRowDescription;
  affected_pairs: number;
  /** 上界：适用的有效 approved 措施一起能去掉该类障碍，且该对不属于整对原因（1–4）。 */
  removable_by_approved_measure: number;
  /** = not_removable_by_reason 之和 = affected_pairs − removable_by_approved_measure。 */
  not_removable: number;
  /** 全部原因，按 NOT_REMOVABLE_REASONS 的顺序，0 也列出。 */
  not_removable_by_reason: NotRemovableReasonCount[];
}

export interface EligibilityRow {
  status: OverallEligibility;
  label: EligibilityLabel;
  pairs: number;
  with_unresolved_barrier: number;
  /** 上界：每条未化解障碍都能被适用的有效 approved 措施去掉，且之后可达。 */
  could_become_reachable: number;
  /** = with_unresolved_barrier − could_become_reachable。 */
  not_removable: number;
  not_removable_reason: EligibilityNotRemovableReason;
}

export interface MissingInfoCount {
  category: MissingInfoCategory;
  label: MissingInfoLabel;
  pairs: number;
}

export interface BarrierSummaryCounts {
  reachable_now: number;
  not_eligible: number;
  reachability_unknown: number;
  /** 全部类别，按 MISSING_INFO_CATEGORIES 的顺序，0 也列出。 */
  reachability_unknown_by_category: MissingInfoCount[];
  reachability_unknown_note: typeof MISSING_INFO_NOTE;
  with_unresolved_barrier: number;
  with_barrier_resolved_by_existing_support: number;
  /** 上界（见文件头）。 */
  could_become_reachable: number;
}

export interface EligibilityDetailRow {
  requirement_type: EligibilityDetailKey;
  label: EligibilityDetailLabel;
  /** 总体资格 not_eligible 的对中，至少一条该类型的硬性要求 not_satisfied 的对数（每对每类型最多一次）。 */
  not_eligible_pairs: number;
  /** 总体资格 unknown 的对中，至少一条该类型的硬性要求 unknown 的对数（每对每类型最多一次）。 */
  unknown_pairs: number;
}

export interface ParticipationFormatRow {
  format: OpportunityFormat;
  label: ParticipationFormatLabel;
  pairs: number;
  /** 只在 hybrid / in_person 行给出：学生档案 transport.level 为 limited 或 none 的对数。 */
  transport_limited_or_none?: number;
  /** 只在 hybrid / in_person 行给出：学生档案没填交通、或等级读不了（不是三个合法值之一）的对数。 */
  transport_not_recorded?: number;
  /** 只在 online / hybrid 行给出：学生档案 devices 是数组但不含 home_internet 的对数。 */
  home_internet_not_listed?: number;
  /** 只在 online / hybrid 行给出：学生档案没填设备或读不了（devices 不是数组）的对数。 */
  devices_not_recorded?: number;
}

export interface ParticipationSummary {
  /** 固定四行，按 PARTICIPATION_FORMAT_ORDER 的顺序，0 也列出；pairs 之和 = pair_count。 */
  rows: ParticipationFormatRow[];
  note: typeof PARTICIPATION_NOTE;
  transport_note: typeof PARTICIPATION_TRANSPORT_NOTE;
  internet_note: typeof PARTICIPATION_INTERNET_NOTE;
}

export interface TeamRequirementRow {
  status: TeamRequirementStatus;
  label: TeamRequirementLabel;
  pairs: number;
  /** 其中总体资格 eligible 的对数。 */
  eligible_pairs: number;
}

export interface MaterialsBurdenRow {
  band: MaterialsBurdenBand;
  label: MaterialsBurdenLabel;
  pairs: number;
  /** 其中总体资格 eligible 的对数。 */
  eligible_pairs: number;
}

/** 障碍以外、措施去不掉的要求（组队、材料）。 */
export interface OtherDemandsSummary {
  note: typeof OTHER_DEMANDS_NOTE;
  /** 固定四行，按 TEAM_REQUIREMENT_ORDER 的顺序，0 也列出；pairs 之和 = pair_count。 */
  team_requirement: TeamRequirementRow[];
  team_requirement_note: typeof TEAM_REQUIREMENT_NOTE;
  /** 固定三档，按 MATERIALS_BURDEN_ORDER 的顺序，0 也列出；pairs 之和 = pair_count。 */
  materials: MaterialsBurdenRow[];
  materials_note: typeof MATERIALS_BURDEN_NOTE;
}

/** 只含数字、布尔值与固定英文字符串（可直接序列化）。 */
export interface BarrierSummary {
  is_sample: true;
  pair_count: number;
  student_count: number;
  opportunity_count: number;
  short_caveats: ShortCaveat[];
  /** 按 OVERALL_ELIGIBILITY_ORDER 的顺序，0 也列出。 */
  eligibility: EligibilityRow[];
  eligibility_note: typeof ELIGIBILITY_NOTE;
  /** 资格明细：八种已知要求类型固定列出（0 也列）；other 行只在有对时追加。 */
  eligibility_detail: EligibilityDetailRow[];
  eligibility_detail_note: typeof ELIGIBILITY_DETAIL_NOTE;
  /** 固定四行 time、cost、transport、device；other 行只在有受影响的对时追加。 */
  barrier_rows: BarrierRow[];
  upper_bound_note: typeof UPPER_BOUND_NOTE;
  participation: ParticipationSummary;
  other_demands: OtherDemandsSummary;
  summary: BarrierSummaryCounts;
  caveats: BarrierReportCaveat[];
}

export interface SummarizeBarriersDeps {
  /**
   * 仅供测试注入（例如模拟引擎将来新增的障碍类型）；缺省 = analyzeReachability。
   * 页面不要传它。
   */
  analyze?: (profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[], options?: EvalOptions) => ReachabilityResult;
}

// ───────────────────────────── 实现 ─────────────────────────────

const KNOWN_BARRIER_TYPES: ReadonlySet<string> = new Set<string>(BARRIER_TYPES);

/** 引擎的障碍类型 → 行；四类以外一律归 other。 */
function rowKeyOf(type: string): BarrierRowKey {
  return KNOWN_BARRIER_TYPES.has(type) ? (type as BarrierType) : 'other';
}

/** 措施类型默认化解的障碍类型（引擎的 SUPPORT_RESOLVES）；未知类型为 null。 */
function supportRowKey(type: string): BarrierRowKey | null {
  return Object.prototype.hasOwnProperty.call(SUPPORT_RESOLVES, type)
    ? SUPPORT_RESOLVES[type as keyof typeof SUPPORT_RESOLVES]
    : null;
}

/** 结果中仍有未化解障碍的行。 */
function unresolvedRows(r: ReachabilityResult): Set<BarrierRowKey> {
  const out = new Set<BarrierRowKey>();
  for (const b of r.barriers) if (!b.resolved) out.add(rowKeyOf(String(b.type)));
  return out;
}

/** 措施是否适用于该机会（opportunity_ids 缺省 / null = 全部机会；[] = 不适用于任何机会）。 */
const appliesTo = (iv: Intervention, oppId: string): boolean =>
  iv.opportunity_ids == null || (Array.isArray(iv.opportunity_ids) && iv.opportunity_ids.includes(oppId));

/**
 * 每项措施的有效状态（与 interventions 下标对齐）：本身已批准、且 requires 传递闭包里的措施全部在场景里且已批准
 * → 'approved'；否则 'pending'。依赖成环时按闭包整体判断。
 */
function effectiveStatuses(interventions: readonly Intervention[]): ('approved' | 'pending')[] {
  const byId = new Map<string, Intervention>();
  for (const iv of interventions) if (!byId.has(iv.id)) byId.set(iv.id, iv);
  const requiresOf = (iv: Intervention): string[] => (Array.isArray(iv.requires) ? iv.requires : []);
  return interventions.map((iv) => {
    if (iv.status === 'pending') return 'pending';
    const seen = new Set<string>([iv.id]);
    const stack = [...requiresOf(iv)];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const dep = byId.get(id);
      if (dep === undefined || dep.status === 'pending') return 'pending';
      stack.push(...requiresOf(dep));
    }
    return 'approved';
  });
}

/**
 * 与求解器（solve.ts / verify.ts 的 Allocation 合成 grant）字段相同的合成 approved grant；
 * 只有 id 前缀不同（不影响可达性判断）。只在内部与测试中使用，不进入输出。
 */
export function syntheticMeasureGrant(scenario: Scenario, iv: Intervention, studentId: string, oppId: string): ResourceGrant {
  return {
    id: `barrier-report:${iv.id}:${studentId}:${oppId}`,
    student_id: studentId,
    opportunity_id: oppId,
    intervention_id: iv.id,
    type: iv.type,
    amount_usd: iv.amount_usd ?? null,
    device: iv.device ?? null,
    hours_per_week: iv.hours_per_week ?? null,
    status: 'approved',
    provider: scenario.title,
    is_sample: true,
  };
}

/** 缺失字段名 → 固定类别（只看引擎结构化字段名的前缀）。 */
function missingCategoryOf(field: string): MissingInfoCategory {
  if (field.startsWith('profile.')) return 'student_profile';
  if (field.startsWith('opportunity.')) return 'opportunity_listing';
  if (field === 'options.today') return 'evaluation_date';
  return 'other';
}

const KNOWN_REQUIREMENT_TYPES: ReadonlySet<string> = new Set<string>(ELIGIBILITY_DETAIL_ORDER);

/** 引擎的要求类型 → 资格明细行；八种以外一律归 other。 */
function detailKeyOf(type: string): EligibilityDetailKey {
  return KNOWN_REQUIREMENT_TYPES.has(type) ? (type as RequirementType) : 'other';
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 参与形式（与引擎 readFormat 一致）：只认 online / in_person / hybrid，其余（含坏数据）一律 unknown。 */
function formatOf(opp: Opportunity): OpportunityFormat {
  const location: unknown = opp.location;
  const f = isRecord(location) ? location.format : undefined;
  return f === 'online' || f === 'in_person' || f === 'hybrid' ? f : 'unknown';
}

/** 学生档案的交通等级；没填、不是对象或等级不是三个合法值之一 → null（没有可用记录，不猜）。 */
function transportLevelOf(student: StudentProfile): 'reliable' | 'limited' | 'none' | null {
  const t: unknown = student.transport;
  const level = isRecord(t) ? t.level : undefined;
  return level === 'reliable' || level === 'limited' || level === 'none' ? level : null;
}

/** 组队要求（规则见文件头）：与 analyzeGaps 一样只认对象，required 只认 true / false / null。 */
function teamStatusOf(opp: Opportunity): TeamRequirementStatus {
  const raw: unknown = (opp as unknown as Record<string, unknown>).team_requirement;
  if (!isRecord(raw)) return 'not_recorded';
  if (raw.required === true) return 'required';
  if (raw.required === false) return 'not_required';
  if (raw.required === null) return 'unclear';
  return 'not_recorded';
}

/**
 * 该对还要准备的「机会要求的」材料条数（规则见文件头）：与 analyzeGaps 的 materials 组同一分类，只数要求的。
 * 准备项按 id 取 opp.preparation 的第一项（与 analyzeGaps 相同）；取不到或没有 material_kind 的不算材料。
 */
function requiredMaterialCount(r: ReachabilityResult, opp: Opportunity): number {
  const preparation = Array.isArray(opp.preparation) ? opp.preparation : [];
  const prepById = new Map<string, PrepItem>();
  for (const p of preparation) if (p != null && !prepById.has(p.id)) prepById.set(p.id, p);
  let count = 0;
  for (const gap of Array.isArray(r.readiness_gaps) ? r.readiness_gaps : []) {
    if (gap.required_for_application === true && prepById.get(gap.prep_item_id)?.material_kind != null) count += 1;
  }
  for (const item of Array.isArray(r.eligibility.items) ? r.eligibility.items : []) {
    if (item.requirement_type === 'portfolio' && item.status === 'not_satisfied' && item.hard) count += 1;
  }
  return count;
}

function materialsBandOf(count: number): MaterialsBurdenBand {
  if (count <= 0) return 'none';
  return count <= 2 ? 'one_or_two' : 'three_or_more';
}

/** 整对原因（作用于该对的每一行，排在「可去掉」之前）。 */
type PairReason = 'not_eligible' | 'deadline_passed' | 'eligibility_unknown' | 'information_missing';

type RowTally = { affected: number; removable: number; reasons: Record<NotRemovableReason, number> };
type EligibilityTally = { pairs: number; withUnresolved: number; couldBecome: number };
type DetailTally = { notEligible: number; unknown: number };
type FormatTally = { pairs: number; transportLimited: number; transportNotRecorded: number; internetNotListed: number; devicesNotRecorded: number };
type DemandTally = { pairs: number; eligible: number };

const zeroCounts = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

export function summarizeBarriers(scenario: Scenario, deps: SummarizeBarriersDeps = {}): BarrierSummary {
  const analyze = deps.analyze ?? analyzeReachability;
  const options: EvalOptions = { today: scenario.evaluation_date };
  const students = scenario.students;
  const opportunities = scenario.opportunities;
  const interventions = scenario.interventions;
  const existing = Array.isArray(scenario.existing_grants) ? scenario.existing_grants : [];
  const effective = effectiveStatuses(interventions);

  const tallies = new Map<BarrierRowKey, RowTally>();
  for (const key of [...BARRIER_ROW_ORDER, 'other' as const]) {
    tallies.set(key, { affected: 0, removable: 0, reasons: zeroCounts(NOT_REMOVABLE_REASONS) });
  }
  const byEligibility = new Map<OverallEligibility, EligibilityTally>(
    OVERALL_ELIGIBILITY_ORDER.map((s) => [s, { pairs: 0, withUnresolved: 0, couldBecome: 0 }]),
  );
  const missingByCategory = zeroCounts(MISSING_INFO_CATEGORIES);
  const detail = new Map<EligibilityDetailKey, DetailTally>(
    [...ELIGIBILITY_DETAIL_ORDER, 'other' as const].map((k) => [k, { notEligible: 0, unknown: 0 }]),
  );
  const formats = new Map<OpportunityFormat, FormatTally>(
    PARTICIPATION_FORMAT_ORDER.map((f) => [
      f,
      { pairs: 0, transportLimited: 0, transportNotRecorded: 0, internetNotListed: 0, devicesNotRecorded: 0 },
    ]),
  );
  const teams = new Map<TeamRequirementStatus, DemandTally>(TEAM_REQUIREMENT_ORDER.map((s) => [s, { pairs: 0, eligible: 0 }]));
  const materials = new Map<MaterialsBurdenBand, DemandTally>(MATERIALS_BURDEN_ORDER.map((b) => [b, { pairs: 0, eligible: 0 }]));
  let reachableNow = 0;
  let reachabilityUnknown = 0;
  let withUnresolved = 0;
  let withResolved = 0;
  let couldBecome = 0;

  for (const student of students) {
    for (const opp of opportunities) {
      // 该对已有的 approved grant（与 analyzeReachability 的匹配规则相同：只有 === null 表示所有机会）。
      const base = existing.filter(
        (g) => g.status === 'approved' && g.student_id === student.id && (g.opportunity_id === null || g.opportunity_id === opp.id),
      );
      const r = analyze(student, opp, base, options);
      const overall: OverallEligibility = OVERALL_ELIGIBILITY_ORDER.includes(r.eligibility.overall)
        ? r.eligibility.overall
        : 'unknown';
      const elig = byEligibility.get(overall)!;
      elig.pairs += 1;

      // 新增四部分（都在下面的 continue 之前，每个对都计入）。
      // 资格明细：not_eligible 数 hard 且 not_satisfied 的类型，unknown 数 hard 且 unknown 的类型；每对每类型一次。
      // hard 按真值判断，与 checkEligibility 判总体资格的口径相同。
      if (overall !== 'eligible') {
        const wanted = overall === 'not_eligible' ? 'not_satisfied' : 'unknown';
        const items = Array.isArray(r.eligibility.items) ? r.eligibility.items : [];
        const types = new Set<EligibilityDetailKey>();
        for (const item of items) {
          if (item.hard && item.status === wanted) types.add(detailKeyOf(String(item.requirement_type)));
        }
        for (const t of types) detail.get(t)![overall === 'not_eligible' ? 'notEligible' : 'unknown'] += 1;
      }

      // 参与形式：有线下部分的形式数交通，有线上部分的形式数家庭网络（只读档案，不是障碍）。
      const format = formatOf(opp);
      const ft = formats.get(format)!;
      ft.pairs += 1;
      if (format === 'in_person' || format === 'hybrid') {
        const level = transportLevelOf(student);
        if (level === null) ft.transportNotRecorded += 1;
        else if (level === 'limited' || level === 'none') ft.transportLimited += 1;
      }
      if (format === 'online' || format === 'hybrid') {
        const devices: unknown = student.devices;
        if (!Array.isArray(devices)) ft.devicesNotRecorded += 1;
        else if (!devices.includes('home_internet')) ft.internetNotListed += 1;
      }

      // 组队要求与材料负担（材料只数机会要求的，来自同一个 r）。
      const team = teamStatusOf(opp);
      const band = materialsBandOf(requiredMaterialCount(r, opp));
      for (const tally of [teams.get(team)!, materials.get(band)!]) {
        tally.pairs += 1;
        if (overall === 'eligible') tally.eligible += 1;
      }

      if (r.reachable === true) reachableNow += 1;
      if (r.reachable === null) {
        reachabilityUnknown += 1;
        const categories = new Set<MissingInfoCategory>();
        if (overall === 'unknown') categories.add('eligibility_unknown');
        for (const field of r.missing_info) categories.add(missingCategoryOf(String(field)));
        for (const c of categories) missingByCategory[c] += 1;
      }
      if (r.barriers.some((b) => b.resolved)) withResolved += 1;

      const affected = unresolvedRows(r);
      if (affected.size === 0) continue;
      withUnresolved += 1;
      elig.withUnresolved += 1;

      // 整对原因：按对算一次，作用于该对受影响的每一行。
      let pairReason: PairReason | null = null;
      if (overall === 'not_eligible') pairReason = 'not_eligible';
      else if (r.barriers.some((b) => !b.resolved && b.type === 'time' && b.shortfall == null)) pairReason = 'deadline_passed';
      else if (overall === 'unknown') pairReason = 'eligibility_unknown';
      else if (r.missing_info.length > 0) pairReason = 'information_missing';

      if (pairReason !== null) {
        for (const key of affected) {
          const tally = tallies.get(key)!;
          tally.affected += 1;
          tally.reasons[pairReason] += 1;
        }
        continue;
      }

      // A 运行：全部适用的有效 approved 措施一起；A+P 运行：再加上适用的有效 pending 措施。
      const applicable = interventions.map((iv, k) => ({ iv, k })).filter(({ iv }) => appliesTo(iv, opp.id));
      const grantsOf = (status: 'approved' | 'pending') =>
        applicable.filter(({ k }) => effective[k] === status).map(({ iv }) => syntheticMeasureGrant(scenario, iv, student.id, opp.id));
      const approvedGrants = grantsOf('approved');
      const pendingGrants = grantsOf('pending');
      const withApproved = approvedGrants.length > 0 ? analyze(student, opp, [...base, ...approvedGrants], options) : r;
      const leftApproved = unresolvedRows(withApproved);
      const leftAll =
        pendingGrants.length > 0
          ? unresolvedRows(analyze(student, opp, [...base, ...approvedGrants, ...pendingGrants], options))
          : leftApproved;

      for (const key of affected) {
        const tally = tallies.get(key)!;
        tally.affected += 1;
        if (!leftApproved.has(key)) {
          tally.removable += 1;
          continue;
        }
        let reason: NotRemovableReason;
        if (!leftAll.has(key)) reason = 'pending_only';
        else if (applicable.some(({ iv }) => supportRowKey(iv.type) === key)) reason = 'partial_match';
        else if (interventions.some((iv) => supportRowKey(iv.type) === key)) reason = 'other_opportunity_only';
        else reason = 'no_measure';
        tally.reasons[reason] += 1;
      }
      if (withApproved.reachable === true) {
        couldBecome += 1;
        elig.couldBecome += 1;
      }
    }
  }

  const rowOf = (key: BarrierRowKey): BarrierRow => {
    const t = tallies.get(key)!;
    const reasons = NOT_REMOVABLE_REASONS.map((reason) => ({
      reason,
      text: NOT_REMOVABLE_REASON_TEXT[reason],
      pairs: t.reasons[reason],
    }));
    return {
      key,
      label: BARRIER_ROW_TEXT[key].label,
      description: BARRIER_ROW_TEXT[key].description,
      affected_pairs: t.affected,
      removable_by_approved_measure: t.removable,
      not_removable: reasons.reduce((n, x) => n + x.pairs, 0),
      not_removable_by_reason: reasons,
    };
  };
  const barrierRows = BARRIER_ROW_ORDER.map(rowOf);
  if (tallies.get('other')!.affected > 0) barrierRows.push(rowOf('other'));

  const detailRowOf = (key: EligibilityDetailKey): EligibilityDetailRow => {
    const d = detail.get(key)!;
    return { requirement_type: key, label: ELIGIBILITY_DETAIL_LABELS[key], not_eligible_pairs: d.notEligible, unknown_pairs: d.unknown };
  };
  const detailRows: EligibilityDetailRow[] = ELIGIBILITY_DETAIL_ORDER.map(detailRowOf);
  const otherDetail = detail.get('other')!;
  if (otherDetail.notEligible + otherDetail.unknown > 0) detailRows.push(detailRowOf('other'));

  const formatRows = PARTICIPATION_FORMAT_ORDER.map((format): ParticipationFormatRow => {
    const t = formats.get(format)!;
    const out: ParticipationFormatRow = { format, label: PARTICIPATION_FORMAT_LABELS[format], pairs: t.pairs };
    if (format === 'in_person' || format === 'hybrid') {
      out.transport_limited_or_none = t.transportLimited;
      out.transport_not_recorded = t.transportNotRecorded;
    }
    if (format === 'online' || format === 'hybrid') {
      out.home_internet_not_listed = t.internetNotListed;
      out.devices_not_recorded = t.devicesNotRecorded;
    }
    return out;
  });

  const materialRowOf = (band: MaterialsBurdenBand): MaterialsBurdenRow => {
    const t = materials.get(band)!;
    return { band, label: MATERIALS_BURDEN_LABELS[band], pairs: t.pairs, eligible_pairs: t.eligible };
  };
  const materialRows = MATERIALS_BURDEN_ORDER.map(materialRowOf);

  return {
    is_sample: true,
    pair_count: students.length * opportunities.length,
    student_count: students.length,
    opportunity_count: opportunities.length,
    short_caveats: [...SHORT_CAVEATS],
    eligibility: OVERALL_ELIGIBILITY_ORDER.map((status) => {
      const e = byEligibility.get(status)!;
      return {
        status,
        label: OVERALL_ELIGIBILITY_LABELS[status],
        pairs: e.pairs,
        with_unresolved_barrier: e.withUnresolved,
        could_become_reachable: e.couldBecome,
        not_removable: e.withUnresolved - e.couldBecome,
        not_removable_reason: ELIGIBILITY_NOT_REMOVABLE_REASON[status],
      };
    }),
    eligibility_note: ELIGIBILITY_NOTE,
    eligibility_detail: detailRows,
    eligibility_detail_note: ELIGIBILITY_DETAIL_NOTE,
    barrier_rows: barrierRows,
    upper_bound_note: UPPER_BOUND_NOTE,
    participation: {
      rows: formatRows,
      note: PARTICIPATION_NOTE,
      transport_note: PARTICIPATION_TRANSPORT_NOTE,
      internet_note: PARTICIPATION_INTERNET_NOTE,
    },
    other_demands: {
      note: OTHER_DEMANDS_NOTE,
      team_requirement: TEAM_REQUIREMENT_ORDER.map((status) => {
        const t = teams.get(status)!;
        return { status, label: TEAM_REQUIREMENT_LABELS[status], pairs: t.pairs, eligible_pairs: t.eligible };
      }),
      team_requirement_note: TEAM_REQUIREMENT_NOTE,
      materials: materialRows,
      materials_note: MATERIALS_BURDEN_NOTE,
    },
    summary: {
      reachable_now: reachableNow,
      not_eligible: byEligibility.get('not_eligible')!.pairs,
      reachability_unknown: reachabilityUnknown,
      reachability_unknown_by_category: MISSING_INFO_CATEGORIES.map((category) => ({
        category,
        label: MISSING_INFO_LABELS[category],
        pairs: missingByCategory[category],
      })),
      reachability_unknown_note: MISSING_INFO_NOTE,
      with_unresolved_barrier: withUnresolved,
      with_barrier_resolved_by_existing_support: withResolved,
      could_become_reachable: couldBecome,
    },
    caveats: [...BARRIER_REPORT_CAVEATS],
  };
}
