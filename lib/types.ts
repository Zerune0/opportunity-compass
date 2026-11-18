/**
 * Opportunity Compass — 共享类型契约（唯一真源）
 *
 * 其他三位队友依赖本文件。发布后任何改动都要先找主导（见 CONTRACT.md「改动契约的流程」）。
 *
 * 通用约定：
 * - 日期一律 ISO 字符串 `YYYY-MM-DD`（类型别名 ISODate）。
 * - 金额一律美元（USD），字段名带 `_usd`。
 * - 时间一律小时，字段名带 `hours`。
 * - 学生「可能没填」的字段都是 optional 或 `| null`：`undefined` / `null` 都表示「没填」，
 *   判断函数遇到没填的信息必须返回 unknown，不能猜。
 * - 技能名（skill）用小写 slug，例如 `python`、`public_speaking`、`data_analysis`。
 * - 本文件只放类型和少量只读常量，不放逻辑。
 *
 * 第二阶段新增（全部是向后兼容的新增：新类型、新的可选字段、只读常量；现有字段不改名、不删除、不改类型）：
 * - 来源等级：`SourceTier` / `SOURCE_TIERS`，`Opportunity.source_tier`、`Opportunity.posted_by`
 *   → 队友 A 填数据与在 Quest Board 显示；Connect 的用户发布机会（本地示例）。
 * - 材料：`MaterialKind` / `MATERIAL_KINDS`，`PrepItem.material_kind`、`PrepItem.reusable_across_opportunities`
 *   → analyzeGaps（材料类差距）、planAcrossOpportunities（材料复用）、Quest Journal 的 `Material`。
 * - 差距分析：`GapCategory` / `GAP_CATEGORIES`、`GapBasis`、`GapItem`、`GapAnalysis`
 *   → `analyzeGaps(profile, opp, grants, options)` 的返回；队友 A 的 Quest Details。
 * - 替代机会：`AlternativeSuggestion` → `findAlternatives(profile, opp, catalog, options)` 的返回；A、B 显示。
 * - 匹配说明：`MatchReasonKind` / `MATCH_REASON_KINDS`、`MatchReason`、`MatchExplanation`、`MatchOptions`
 *   → `explainMatch(profile, opp, options)` 的返回；A（排序说明）、Connect。不含分数或名次。
 * - 联合申请规划：`CrossPlanItem`、`MaterialReuse`、`WeeklyLoad`、`CrossPlan`、`CrossPlanOptions`
 *   → `planAcrossOpportunities(profile, opps, options)` 的返回；队友 B 的 Journal 排期页。
 * - Quest Journal：`JournalApplicationStatus`、`EligibilityConfirmation`、`JournalDecision`、`JournalEvent` / `JOURNAL_EVENTS`、
 *   `JournalHistoryItem`、`JournalTask`、`MaterialStatus` / `MATERIAL_STATUSES`、`Material`、`OutcomeFeedback`、`JournalEntry`
 *   → lib/store.ts 的 Journal / 材料存储函数、lib/journal.ts 的 journalHeadline；队友 B 的 app/journal/。
 * - 规划快照：`PlanTrigger` / `PLAN_TRIGGERS`、`PlanSnapshotInputs`、`PlanSnapshot`
 *   → lib/store.ts 的快照存储；队友 B 的「之前 → 变化 → 之后 → 原因」回放（配合 diffRoutes）。
 * - Connect 本地示例：`SamplePublisher`、`ShareSettings`、`SharedProfileView`、`Invitation`
 *   → 主办方端与 Connect 负责人的 lib/connect/、app/connect/。全部是示例 / 本地数据，没有真实连接。
 */

// ───────────────────────────── 基础别名 ─────────────────────────────

/** ISO 日期字符串 `YYYY-MM-DD`。 */
export type ISODate = string;

/**
 * 学生端判断函数（checkEligibility / analyzeReachability / planRoutes）的可选末位参数。
 *
 * - `today`：评估基准日（`YYYY-MM-DD`），用于算年龄、距截止还有多久、是否来得及。
 * - **不传 `today` 时函数不得读系统时间**（不得读取系统时钟）；
 *   凡是依赖日期的判断一律按「信息不足」处理（资格项 unknown、`feasible_by_deadline` / `reachable` 等为 null）。
 * - 由界面层负责传入今天的日期，这样纯函数保持确定性、可测试。
 */
export interface EvalOptions {
  today?: ISODate;
}

/** 三态：判断不出来时用 unknown，而不是猜 true/false。 */
export type EligibilityStatus = 'satisfied' | 'not_satisfied' | 'unknown';

export const ELIGIBILITY_STATUSES: readonly EligibilityStatus[] = [
  'satisfied',
  'not_satisfied',
  'unknown',
] as const;

/**
 * 年级用数字表示，方便规则做区间比较：
 * 1–12 = 美式 K-12 年级（9–12 为高中）；13–16 = 本科第 1–4 年；17 = 研究生及以上。
 * 非美式学制请换算到最接近的数字，换算不了就不填（→ unknown）。
 */
export type GradeLevel = number;

/** 技能熟练度（自评或有证据）。 */
export type SkillLevel = 'beginner' | 'intermediate' | 'advanced';

/** 设备 / 条件。`home_internet` 指家里有稳定网络。 */
export type DeviceType =
  | 'laptop'
  | 'desktop'
  | 'smartphone'
  | 'tablet'
  | 'webcam'
  | 'home_internet';

// ───────────────────────────── 机会 Opportunity ─────────────────────────────

export type OpportunityCategory =
  | 'research'
  | 'scholarship'
  | 'hackathon'
  | 'competition'
  | 'internship'
  | 'fellowship'
  | 'summer_program'
  | 'public_service'
  | 'project'
  | 'other';

/** 参与形式：线上 / 线下 / 混合。 */
export type OpportunityFormat = 'online' | 'in_person' | 'hybrid';

/** 机会举办地点。线上机会可以只填 format。 */
export interface OpportunityLocation {
  format: OpportunityFormat;
  /** ISO 3166-1 alpha-2 国家代码，如 `US`。线上且不限地区时可为 null。 */
  country?: string | null;
  /** 州 / 省代码或名称，如 `CA`。 */
  state?: string | null;
  city?: string | null;
  /** 地点补充说明（原文或摘要），如「需每周三到校园」。 */
  note?: string | null;
}

/** 参加该机会本身的费用（不含准备阶段的费用，准备费用在 PrepItem 里）。 */
export interface OpportunityCost {
  /** 报名费 / 项目费，0 = 免费，null = 官网没写清。 */
  fee_usd: number | null;
  /** 是否需要自费差旅（线下项目常见）。null = 不清楚。 */
  requires_travel_expense: boolean | null;
  /** 官方是否提供资助 / 减免（只是事实记录，不等于学生已获得）。 */
  financial_aid_available?: boolean | null;
  note?: string | null;
}

/** 时间投入。 */
export interface TimeCommitment {
  /** 参与期间每周需要的小时数，null = 官网没写清。 */
  hours_per_week: number | null;
  /** 持续周数，null = 不清楚或一次性活动。 */
  total_weeks: number | null;
  start_date?: ISODate | null;
  end_date?: ISODate | null;
  note?: string | null;
}

/**
 * 学生身份标签（用于「身份」类官方要求）。只收录判断资格需要的标签。
 * 这些属于敏感信息：只存在学生自己的浏览器 localStorage，不上传。
 */
export type StudentStatus =
  | 'middle_school_student'
  | 'high_school_student'
  | 'undergraduate'
  | 'graduate_student'
  | 'not_enrolled'
  | 'first_generation' // 家中第一代大学生
  | 'low_income'
  | 'underrepresented_in_stem';

/** StudentStatus 的全部合法取值（用于输入校验，如 FairnessFloor.statuses_any_of）。 */
export const STUDENT_STATUSES: readonly StudentStatus[] = [
  'middle_school_student',
  'high_school_student',
  'undergraduate',
  'graduate_student',
  'not_enrolled',
  'first_generation',
  'low_income',
  'underrepresented_in_stem',
] as const;

/** 证据种类（Skill Passport 里的作品 / 经历）。 */
export type EvidenceKind =
  | 'project'
  | 'portfolio'
  | 'certificate'
  | 'competition_result'
  | 'work_experience'
  | 'volunteer_experience'
  | 'course'
  | 'recommendation_letter'
  | 'other';

/**
 * 官方要求的「机器可判定规则」。`type` 是判别字段。
 * 规则参数缺失（例如 grade 只有 min）表示该侧不限。
 * 无法写成机器规则的要求用 `manual`，判断结果永远是 unknown（提示学生向官方确认）。
 */
export type RequirementRule =
  | { type: 'grade'; min?: GradeLevel; max?: GradeLevel }
  /** as_of：按哪一天计算年龄；缺省按机会截止日期。 */
  | { type: 'age'; min?: number; max?: number; as_of?: ISODate }
  /** 地区：countries 为 ISO 国家代码；states 非空时还要求州 / 省匹配。 */
  | { type: 'region'; countries: string[]; states?: string[] }
  /** 公民 / 合法居留身份：学生 citizenships 与 countries 有交集即满足。 */
  | { type: 'citizenship'; countries: string[] }
  /** 身份：满足 any_of 中任意一个即可。 */
  | { type: 'status'; any_of: StudentStatus[] }
  /** 先修技能：学生 skills 中有该技能且等级 ≥ min_level（缺省 beginner）。 */
  | { type: 'prerequisite_skill'; skill: string; min_level?: SkillLevel }
  /** 作品 / 材料：学生 evidence 中有对应种类（可选限定技能）的证据。 */
  | { type: 'portfolio'; evidence_kind?: EvidenceKind; skill?: string }
  /** 无法机器判定（如「需要导师推荐」「面试」），永远返回 unknown。 */
  | { type: 'manual' };

export type RequirementType = RequirementRule['type'];

/**
 * 一条官方要求。由 `RequirementRule` 判别联合 + 公共字段组成，
 * 所以 `req.type` 可直接用来收窄规则参数。
 */
export type Requirement = RequirementRule & {
  /** 机会内唯一，如 `req-grade`。 */
  id: string;
  /** 面向界面的简短标签，如「9–12 年级」。 */
  label: string;
  /**
   * true = 硬性要求（官方明确必须满足，不满足就不能申请，planRoutes 不得「绕过」）；
   * false = 偏好 / 加分项（不影响总体资格，只做提示）。
   */
  hard: boolean;
  /** 官网原文（逐字摘录），界面上展示给学生看依据。必填。 */
  source_text: string;
};

/**
 * 申请材料种类（第二阶段）。
 * resume = 简历；transcript = 成绩单；personal_statement = 个人陈述；
 * recommendation_letter = 推荐信；portfolio = 作品集；essay = 其他文书 / 短文；other = 其他材料。
 * 用于 PrepItem.material_kind（这个准备项产出哪类材料）和 Quest Journal 的 Material.kind。
 */
export type MaterialKind =
  | 'resume'
  | 'transcript'
  | 'personal_statement'
  | 'recommendation_letter'
  | 'portfolio'
  | 'essay'
  | 'other';

export const MATERIAL_KINDS: readonly MaterialKind[] = [
  'resume',
  'transcript',
  'personal_statement',
  'recommendation_letter',
  'portfolio',
  'essay',
  'other',
] as const;

/**
 * 准备项：参加 / 申请该机会前建议或需要完成的准备（供路线规划用）。
 * 例如「学会 Python 基础」「完成一个数据分析小项目」「写个人陈述」。
 */
export interface PrepItem {
  /** 机会内唯一，如 `prep-python`。 */
  id: string;
  title: string;
  /** 对应的技能 slug（若有）。学生 evidence.skills 含该技能可视为已覆盖。 */
  skill?: string | null;
  /** 什么种类的证据能证明该准备项已完成（若有）。 */
  evidence_kind?: EvidenceKind | null;
  /** 预估小时数（从零开始做）。 */
  estimated_hours: number;
  /** 预估费用（美元），0 = 免费资源可完成。 */
  estimated_cost_usd: number;
  /** 依赖的其他准备项 id（同一机会内），用于拓扑排序。 */
  depends_on: string[];
  /** true = 申请必需（如申请材料）；false = 建议准备、提高竞争力。 */
  required_for_application: boolean;
  /** 依据（官网原文或「团队建议」），说明为什么有这一项。 */
  source_text?: string | null;
  /**
   * （第二阶段）这个准备项产出哪类申请材料。null / 缺省 = 不是材料（如「学会 Python 基础」）。
   * analyzeGaps 用它把未覆盖的准备项归入「材料」类（否则归入「知识或经验」类）；
   * planAcrossOpportunities 用它识别跨机会可复用的材料。
   */
  material_kind?: MaterialKind | null;
  /**
   * （第二阶段）材料是否可在多个机会间复用，只在 material_kind 非空时有意义：
   * - true = 通用材料（如简历、成绩单），多个机会共用一份，联合规划时小时数只算一次；
   * - false = 针对该机会单独准备（如针对性的个人陈述），即使同类也每个机会各算一次；
   * - null / 缺省 = 按 false 处理（不确定能否复用时不假设省时间）。
   */
  reusable_across_opportunities?: boolean | null;
}

/**
 * 机会信息的来源等级（第二阶段）：
 * - official = 由人打开主办方官网核实过（data/opportunities.json 的真实机会都是这一级）；
 * - trusted_aggregator = 来自可信的机会汇总站，仍需以主办方官网为准；
 * - user_posted = 用户（发布者）自己发布的机会。本阶段只来自 Connect 的本地示例（发布者是标「示例」的虚构账户），
 *   没有真实发布者。
 * 用户发布的机会必须与官网核实的机会用不同标记显示，不能混为一谈。
 */
export type SourceTier = 'official' | 'trusted_aggregator' | 'user_posted';

export const SOURCE_TIERS: readonly SourceTier[] = ['official', 'trusted_aggregator', 'user_posted'] as const;

/**
 * 一个真实机会。
 * 底线：`data/opportunities.json` 中的每条机会必须有官方链接、核实日期和核实人，
 * 由人打开官网确认；AI 给出的机会信息不直接采用。
 * 例外（第二阶段）：source_tier = 'user_posted' 的机会是 Connect 的本地示例，不是官网核实的机会，
 * 必须同时 is_sample = true；它的 verified_on / verified_by 只记录发布日期与示例发布者，界面不得显示为「已核实」。
 */
export interface Opportunity {
  /** 全局唯一，kebab-case，如 `nasa-sees-2027`。 */
  id: string;
  title: string;
  /** 主办方名称。 */
  organizer: string;
  category: OpportunityCategory;
  /** 领域标签，如 `['computer_science', 'climate']`，供「同领域替代」提示用。 */
  fields: string[];
  /** 一两句话的简介。 */
  summary: string;
  /** 官方链接（必须是主办方官网页面）。 */
  official_url: string;
  /** 最后一次由人打开官网核实的日期。 */
  verified_on: ISODate;
  /** 核实人（队员名或 GitHub 用户名）。 */
  verified_by: string;
  /** 申请截止日期；null = 滚动录取或官网未写清。 */
  deadline: ISODate | null;
  /** 截止时间的补充说明（时区、几点截止等），原文摘录更好。 */
  deadline_note?: string | null;
  /** 是否每年举办（用于「下一届」提示）。null = 不清楚。 */
  recurring_annually?: boolean | null;
  location: OpportunityLocation;
  cost: OpportunityCost;
  time_commitment: TimeCommitment;
  /** 参加所需设备，空数组 = 无特别要求。 */
  required_devices: DeviceType[];
  /** 官方要求列表（资格）。 */
  requirements: Requirement[];
  /** 准备项（路线规划用）。 */
  preparation: PrepItem[];
  /**
   * true = 示例 / 虚构数据（测试 fixture 或演示），界面必须标「示例」。
   * 真实核实过的机会填 false 或省略。
   */
  is_sample?: boolean;
  /**
   * （第二阶段）来源等级，缺省按 'official' 处理（第一阶段的数据都是官网核实）。
   * 读取时请写 `opp.source_tier ?? 'official'`。用户发布的机会必须与官网核实的机会用不同标记。
   */
  source_tier?: SourceTier;
  /**
   * （第二阶段）发布者 id：source_tier = 'user_posted' 时为示例发布者 SamplePublisher.id；
   * 其他等级为 null 或缺省。本阶段没有真实发布者。
   */
  posted_by?: string | null;
}

// ───────────────────────────── 学生档案 StudentProfile ─────────────────────────────

/** 学生所在地区。 */
export interface StudentRegion {
  /** ISO 3166-1 alpha-2 国家代码。 */
  country: string;
  state?: string | null;
  city?: string | null;
  /** 城市 / 郊区 / 乡镇，用于交通障碍判断。 */
  locality?: 'urban' | 'suburban' | 'rural' | null;
}

/** 交通条件。 */
export interface TransportAccess {
  /**
   * reliable = 能稳定自行到达同城 / 附近地点；
   * limited = 偶尔可以、或单程很久；
   * none = 基本无法自行前往线下地点。
   */
  level: 'reliable' | 'limited' | 'none';
  /** 能接受的单程最长通勤分钟数，null = 没填。 */
  max_one_way_minutes?: number | null;
  note?: string | null;
}

export interface StudentSkill {
  /** 技能 slug，如 `python`。 */
  name: string;
  level: SkillLevel;
}

/**
 * 证据状态（见 docs/privacy-and-evidence.md）：
 * self_reported = 学生自述；evidence_attached = 附了链接 / 文件；
 * reviewed = 有人审阅过；unverified = 无法核实。
 * 注意：附链接 ≠ 专业认证。
 */
export type EvidenceStatus = 'self_reported' | 'evidence_attached' | 'reviewed' | 'unverified';

/** 一条作品 / 经历证据（Skill Passport 条目）。 */
export interface EvidenceItem {
  id: string;
  title: string;
  kind: EvidenceKind;
  /** 这条证据能体现的技能 slug。 */
  skills: string[];
  /** 明确对应的准备项 id（可跨机会，形如 `<opportunity_id>:<prep_id>` 或仅 `<prep_id>`）。 */
  prep_item_ids?: string[];
  status: EvidenceStatus;
  /** 作品链接（可选）。 */
  url?: string | null;
  description?: string | null;
  added_on: ISODate;
}

/**
 * 学生档案。除 id / is_sample / display_name / evidence 外都可能没填。
 * 没填 → 相关判断返回 unknown。
 */
export interface StudentProfile {
  id: string;
  /** true = 示例学生（界面必须标「示例」）。学生自己填写的档案为 false。 */
  is_sample: boolean;
  /** 显示名（示例档案用明显的示例名）。 */
  display_name: string;
  grade?: GradeLevel | null;
  age?: number | null;
  region?: StudentRegion | null;
  /** 国籍 / 合法居留国家（ISO 代码），null = 没填。 */
  citizenships?: string[] | null;
  /** 身份标签；null = 没填（→ unknown）；数组 = 学生声明的全部相关身份。 */
  statuses?: StudentStatus[] | null;
  /**
   * 学校名。只用于展示。
   * 公平性约定：任何判断函数都不得读取它（第 3 层有对照测试：仅学校名不同的两份档案结果必须一致）。
   */
  school_name?: string | null;
  /** 每周可用于准备 / 参与的小时数。 */
  hours_per_week_available?: number | null;
  /** 能为该机会自掏的预算（美元）。 */
  budget_usd?: number | null;
  transport?: TransportAccess | null;
  /** 可稳定使用的设备；null = 没填；[] = 明确表示都没有。 */
  devices?: DeviceType[] | null;
  /** 技能（自评）；null = 没填。 */
  skills?: StudentSkill[] | null;
  /** 证据列表（作品 / 经历），没有就是 []。 */
  evidence: EvidenceItem[];
  /** 兴趣领域，与 Opportunity.fields 用同一套标签。 */
  interests?: string[] | null;
}

// ───────────────────────────── 资格 EligibilityResult ─────────────────────────────

/** 单条官方要求的判断结果。 */
export interface EligibilityItem {
  requirement_id: string;
  requirement_type: RequirementType;
  label: string;
  hard: boolean;
  status: EligibilityStatus;
  /** 官网原文（从 Requirement.source_text 原样带出）。 */
  source_text: string;
  /** 面向学生的说明：用了哪些信息、为什么是这个结果。 */
  explanation: string;
  /** 判断用到的档案字段名，如 `['grade']`。缺信息时列出缺的字段。 */
  used_profile_fields: string[];
  /** status 为 unknown 时非空：提示学生「请向官方确认」的具体文字；否则为 null。 */
  confirm_with_official: string | null;
}

/**
 * 总体资格：
 * - eligible：所有硬性要求 satisfied；
 * - not_eligible：至少一条硬性要求 not_satisfied；
 * - unknown：没有硬性 not_satisfied，但至少一条硬性要求 unknown。
 * 非硬性要求（偏好）不影响总体资格。
 */
export type OverallEligibility = 'eligible' | 'not_eligible' | 'unknown';

export interface EligibilityResult {
  profile_id: string;
  opportunity_id: string;
  overall: OverallEligibility;
  /** 每条官方要求一项，顺序与 Opportunity.requirements 一致。 */
  items: EligibilityItem[];
}

// ───────────────────────────── 资源 ResourceGrant ─────────────────────────────

/**
 * 支持 / 资源类型（主办方分配的资源与联合求解的措施共用）：
 * device = 借设备；transport_subsidy = 交通补助；fee_waiver = 费用减免 / 资助；
 * time_support = 时间支持（如带薪准备时间、减少打工时长的补贴）；
 * alternative_access = 替代参与方式（如线上参与入口、卫星会场），让学生不必前往主会场。
 *
 * analyzeReachability 中：approved 的 transport_subsidy 与 alternative_access 同等对待，
 * 任一即可化解 transport 障碍。
 * 注意：若代码对 SupportType 做穷尽式 switch，需要为 'alternative_access' 补一个分支。
 */
export type SupportType =
  | 'device'
  | 'transport_subsidy'
  | 'fee_waiver'
  | 'time_support'
  | 'alternative_access';

/** 障碍类型：时间 / 费用 / 交通 / 设备。 */
export type BarrierType = 'time' | 'cost' | 'transport' | 'device';

export const BARRIER_TYPES: readonly BarrierType[] = ['time', 'cost', 'transport', 'device'] as const;

/** 每种支持默认化解哪类障碍。 */
export const SUPPORT_RESOLVES: Readonly<Record<SupportType, BarrierType>> = {
  device: 'device',
  transport_subsidy: 'transport',
  fee_waiver: 'cost',
  time_support: 'time',
  alternative_access: 'transport',
};

/**
 * 主办方已分配给某位学生的资源（可针对某个机会，也可对该学生的所有机会有效）。
 * 只有 status = 'approved' 的资源才能在 analyzeReachability 中化解障碍；
 * 'pending' 只产生「若获批则可达」的条件性提示（docs：待定资助 ≠ 已获资助）。
 */
export interface ResourceGrant {
  id: string;
  student_id: string;
  /**
   * 适用的机会：
   * - 字符串 = 只对该机会有效；
   * - null = 对该学生的所有机会都有效（如借出的笔记本、交通卡）。
   * 只有 === null 表示「所有机会」；缺少该字段（undefined）的 grant 一律不生效（信息不足不猜）。
   * null 范围主要用于可重复使用的资源（device、time_support）；按金额计的资助
   * （transport_subsidy、fee_waiver 的 amount_usd）建议指定具体机会——analyzeReachability
   * 对每个机会各按全额计算，同一笔钱不会在机会之间分摊。
   * 调用方不要把它当必填字符串使用，需要做空值判断。
   */
  opportunity_id: string | null;
  /** 这份资源来自哪个措施（Intervention.id），若有；缺省 / null = 不来自场景内的措施。 */
  intervention_id?: string | null;
  type: SupportType;
  status: 'approved' | 'pending';
  /** 金额（交通补助 / 费用减免），美元。 */
  amount_usd?: number | null;
  /** 借出的设备（type = device 时）。 */
  device?: DeviceType | null;
  /** 每周增加的可用小时（type = time_support 时）。 */
  hours_per_week?: number | null;
  /** 提供方（主办方名）。 */
  provider: string;
  note?: string | null;
  /** true = 示例 / 模拟资源，界面标「示例 / 模拟」。 */
  is_sample?: boolean;
}

// ───────────────────────────── 可达性 ReachabilityResult ─────────────────────────────

/** 准备差距：尚未被证据覆盖的准备项。 */
export interface ReadinessGap {
  prep_item_id: string;
  title: string;
  skill: string | null;
  estimated_hours: number;
  estimated_cost_usd: number;
  required_for_application: boolean;
  /** 为什么认为这是差距（如「档案中没有 python 相关证据」）。 */
  reason: string;
}

/** 一个现实参与障碍。 */
export interface Barrier {
  type: BarrierType;
  /** 面向学生的说明，如「需要笔记本电脑，档案中没有」。 */
  description: string;
  /** 缺口数值（若可量化）：time = 每周缺几小时；cost = 缺多少美元；其他为 null。 */
  shortfall?: number | null;
  /** 是否已被 approved 的 grants 化解。 */
  resolved: boolean;
  /** 化解它的 grant id（resolved 为 true 时非空）。 */
  resolved_by_grant_ids: string[];
  /** 若有 pending grant 可能化解它，列出 id（只做条件性提示，不算化解）。 */
  pending_grant_ids?: string[];
}

/**
 * 可达性分析结果。
 * 重要：可达（reachable）≠ 录取。可达只表示「资格不冲突、准备与现实条件上走得通」，
 * 不代表录取概率，界面上不得暗示会被录取。
 */
export interface ReachabilityResult {
  profile_id: string;
  opportunity_id: string;
  /** 资格判断（内部调用 checkEligibility 的结果）。 */
  eligibility: EligibilityResult;
  /** 准备差距（未被证据覆盖的准备项）。 */
  readiness_gaps: ReadinessGap[];
  /** 障碍列表（含已被 grants 化解的，resolved 标为 true）。 */
  barriers: Barrier[];
  /**
   * 是否现实可达（按以下顺序判定，语义固定）：
   * - false：存在硬性要求 not_satisfied，**或**存在未被 approved grant 化解的障碍
   *   （无论资格是否 unknown，结论都确定为 false）；
   * - null：没有上述情况，但资格总体为 unknown，或缺少判断障碍所需的关键信息（见 missing_info），不猜；
   * - true：硬性要求全部 satisfied，且所有障碍不存在或已被化解。
   * 准备差距（readiness_gaps）不直接决定 reachable，只通过「补齐所需小时数 vs 可用时间」
   * 体现为 time 障碍。可达 ≠ 录取。
   */
  reachable: boolean | null;
  /** 判断所缺的档案 / 机会字段（如 `profile.devices`、`opportunity.cost.fee_usd`）。 */
  missing_info: string[];
  /** 本次计入的 grant id（approved）。 */
  applied_grant_ids: string[];
  /** 面向学生的一句话总结。 */
  summary: string;
}

// ───────────────────────────── 路线 Route / PlanResult ─────────────────────────────

/** 路线类型：学习优先 / 实践优先 / 社区协作。 */
export type RouteType = 'learning_first' | 'practice_first' | 'community';

export const ROUTE_TYPES: readonly RouteType[] = ['learning_first', 'practice_first', 'community'] as const;

export interface RouteStep {
  /** 路线内唯一。来自准备项时建议与 PrepItem.id 相同，便于 diff。 */
  id: string;
  title: string;
  description?: string | null;
  /** 对应的准备项 id（若有）。 */
  prep_item_id?: string | null;
  /** 依赖的步骤 id（同一路线内）。steps 数组已按依赖排好序。 */
  depends_on: string[];
  /** 预计小时数（被跳过时仍记录原值，但不计入总数）。 */
  hours: number;
  cost_usd: number;
  /** 是否因学生已有证据而跳过。 */
  skipped: boolean;
  /** 跳过原因（skipped 为 true 时非空），如「已有作品《XX》证明 python」。 */
  skip_reason: string | null;
  /** 让该步骤被跳过的证据 id。 */
  satisfied_by_evidence_ids: string[];
}

export interface Route {
  /** 如 `${opportunity_id}:learning_first`。 */
  id: string;
  type: RouteType;
  title: string;
  /** 已按依赖拓扑排序。 */
  steps: RouteStep[];
  /** 未跳过步骤的小时合计。 */
  total_hours: number;
  /** 未跳过步骤的费用合计（美元）。 */
  total_cost_usd: number;
  /** 按学生每周可用小时，完成需要的周数；信息不足为 null。 */
  estimated_weeks: number | null;
  /**
   * 按学生每周可用小时，能否在截止日期前完成：
   * true / false；null = 截止日期或可用小时未知，无法判断。
   */
  feasible_by_deadline: boolean | null;
  /** 推荐理由 / 适合什么样的学生。 */
  rationale: string;
  /** 风险或注意事项（如「超出预算 $40」）。 */
  warnings: string[];
}

/** 不给路线时的替代提示。 */
export interface AlternativeHint {
  /** next_cycle = 等下一届；same_field = 同领域的其他机会。 */
  kind: 'next_cycle' | 'same_field';
  text: string;
  /** same_field 时可给出的机会 id（来自已核实的数据）。 */
  opportunity_ids?: string[];
}

/**
 * planRoutes 的返回：
 * - status = 'routes'：给出 2–3 条路线（资格为 unknown 时也给，但 warnings 中提醒先向官方确认）；
 * - status = 'blocked'：硬性资格不满足 → 不生成任何「绕过」路线，只给原因和替代提示。
 */
export type PlanResult =
  | {
      status: 'routes';
      profile_id: string;
      opportunity_id: string;
      routes: Route[];
      /** 整体提醒，如「年级信息未填，资格待确认」。 */
      warnings: string[];
    }
  | {
      status: 'blocked';
      profile_id: string;
      opportunity_id: string;
      routes: [];
      /** 导致不满足的硬性要求（来自 EligibilityResult，带原文）。 */
      blocking_requirements: EligibilityItem[];
      /** 面向学生的原因说明。 */
      reasons: string[];
      alternatives: AlternativeHint[];
    };

// ───────────────────────────── 路线差异 RouteDiff ─────────────────────────────

export interface StepChange {
  step_id: string;
  title: string;
  /** 变化原因，如「新增证据《天气数据分析》覆盖了 python」。 */
  reason: string;
}

/** 单条路线（按 RouteType 对齐）的变化。 */
export interface RouteChange {
  route_type: RouteType;
  /** added = 新出现的路线；removed = 消失；changed = 有变化；unchanged = 无变化。 */
  change: 'added' | 'removed' | 'changed' | 'unchanged';
  added_steps: StepChange[];
  removed_steps: StepChange[];
  /** 本次新被跳过的步骤（通常因为新增了证据）。 */
  newly_skipped_steps: StepChange[];
  /** 之前跳过、现在不再跳过的步骤。 */
  unskipped_steps: StepChange[];
  hours_before: number | null;
  hours_after: number | null;
  /** after − before；任一侧不存在时为 null。 */
  hours_delta: number | null;
  cost_delta_usd: number | null;
  feasible_before: boolean | null;
  feasible_after: boolean | null;
}

/** 两次规划之间的变化及原因。 */
export interface RouteDiff {
  /** 规划状态是否变化（如 blocked → routes）；未变化为 null。 */
  status_change: { from: PlanResult['status']; to: PlanResult['status'] } | null;
  route_changes: RouteChange[];
  /** 面向学生的原因说明（每条一句），必须说得出「为什么变了」。无变化时说明无变化。 */
  reasons: string[];
}

// ───────────────────────────── 联合求解（主导，接手 Charles 的任务）─────────────────────────────

/*
 * 联合求解模型（摘要；逐条可执行的完整版见 CONTRACT.md「联合求解模型」一节，两处必须一致）。
 *
 * - 评估：对场景内每个（学生, 机会）对，reach(pair, grants) =
 *   analyzeReachability(student, opp, grants, { today: scenario.evaluation_date }).reachable === true；
 *   null（信息不足）一律当作不可达，不猜。
 * - R0 = 带**全部** existing_grants 时可达的对；
 *   R1 = 带（existing_grants 去掉本方案撤回的 grant）+ 方案合成的 grant 时可达的对。
 * - 方案生效方式：每条 Allocation (i, s, o) 合成一条 approved ResourceGrant
 *   （id = 'alloc:' + i + ':' + s + ':' + o，字段取自措施 i，见 Allocation 注释）。
 *   措施只能通过 grant 化解现实障碍，不能改变官方资格。
 *   tradeoff 模式下方案还可以撤回「可撤回」的已有 grant（JointPlan.revoked_grant_ids；可撤回 = intervention_id 指向场景内措施
 *   且 student_id 是场景内学生——场景外学生的损失无法评估，不能动）；
 *   protect 模式（默认）不动任何已有承诺：revoked_grant_ids 必须为空。
 * - 硬约束（任何情况下不放松）：措施存在 / 不重复 / approved；互斥；前置依赖；分配合法；
 *   容量（按 capacity_scope 与不同学生计）；成本与预算；损失（protect: L = 0；tradeoff: L ≤ loss_cap）；
 *   撤回（选中与措施 k 互斥的措施时，k 的全部可撤回 grant 必须撤回；撤回列表合法；protect 模式下不允许任何撤回，
 *   因此 protect 下与「有可撤回已有 grant 的措施」互斥的措施不能被选中）；两种模式下都不能选中与
 *   「有场景外学生已有 grant（不可撤回）的措施」互斥的措施（归入 mutual_exclusion）。
 * - What-if 勾选（withEnabledInterventions）：有已有 grant 的「运行中」措施不能被移除，未勾选时只是不接受新分配。
 * - 软要求（主办方自己提的，INFEASIBLE 时可整项放松并明示）：required_intervention_ids、min_gain、fairness_floors。
 * - 目标：最大化 N = G − L；再 L 小；再 total_usd 小；再 Allocation 条数少；再选中措施数少；再撤回数少；
 *   再字典序最小。因此选中的每项措施要么有分配，要么必须启用，要么是这两类措施的（传递）前置依赖。
 * - 额度非负时 grant 只会帮忙：不撤回任何已有 grant 时 L 恒为 0；L > 0 只可能来自撤回。
 * - 求解器不会返回「OPTIMAL 但复核不通过」：内部复核不通过时按 UNSUPPORTED_INPUT 处理（见 CONTRACT 第 6 条）。
 * - 基线对比（BaselineComparison）：A 只看资格 / B 学生端 / C 机构端 / joint，同一场景、同一选项、同一验证器。
 * - 所有结果都是模拟，不是真实影响；可达 ≠ 录取。
 */

/**
 * 主办方可选的支持措施（what-if 场景中的决策变量 x）。
 *
 * 措施对可达性的作用只通过它合成的 ResourceGrant 体现（由 `type` 及 amount_usd / device /
 * hours_per_week 决定，见 analyzeReachability），`resolves` 只用于展示，求解与复核都不读它。
 */
export interface Intervention {
  id: string;
  title: string;
  type: SupportType;
  /** 能化解的障碍类型（通常是 SUPPORT_RESOLVES[type]，可多于一种）。 */
  resolves: BarrierType[];
  /**
   * 每服务一位**不同学生**的边际成本（美元）。
   * 同一学生凭同一措施参加多个机会，只计一次。
   */
  unit_cost_usd: number;
  /** 启用该措施的固定成本（只计一次），默认 0。 */
  fixed_cost_usd?: number;
  /**
   * 最多可服务的**不同学生**人数（如 5 台设备 = 5），null = 不限（缺省 / undefined 视同 null）。
   * 同一学生凭同一措施参加多个机会，只占 1 个容量。给出时必须是非负有限数，否则 UNSUPPORTED_INPUT。
   */
  capacity: number | null;
  /** 只对这些机会有效；缺省（或 null）= 对场景内所有机会有效。引用不存在的机会 id → UNSUPPORTED_INPUT。 */
  opportunity_ids?: string[];
  /**
   * 与这些措施互斥（不能同时启用）。按对称关系处理：A 列出 B 或 B 列出 A，A 与 B 都不能同时选中。
   * 引用不存在的 id 或引用自己 → UNSUPPORTED_INPUT。
   */
  mutually_exclusive_with?: string[];
  /** 时间支持类措施每位学生增加的每周小时数。给出（非 null）时必须是非负有限数，否则 UNSUPPORTED_INPUT。 */
  hours_per_week?: number | null;
  /** 交通补助 / 费用减免每位学生的额度（美元）。给出（非 null）时必须是非负有限数，否则 UNSUPPORTED_INPUT。 */
  amount_usd?: number | null;
  /** 借设备类措施提供的设备。 */
  device?: DeviceType | null;
  /**
   * 审批状态，缺省视为 'approved'。
   * 'pending' 的措施**不能**出现在 solveJoint 的主结果（生效方案）里，
   * 只能出现在 JointResult.conditional（「如果获批，则……」）里；
   * verifyPlan 只有在 VerifyOptions.assume_approved_intervention_ids 列出它时才把它当作已批准。
   */
  status?: 'approved' | 'pending';
  /**
   * 前置依赖：启用本措施必须同时启用这些措施（Intervention.id）。
   * 只要求被依赖的措施在选中集合里，不要求它们有 Allocation。依赖可以成环（成环 = 要么都选、要么都不选）。
   * 引用不存在的 id 或引用自己 → UNSUPPORTED_INPUT。
   */
  requires?: string[];
  /**
   * 容量的计量范围，缺省 'total'：
   * - 'total'：整个场景内（所有时段合并）服务的不同学生数 ≤ capacity；
   * - 'per_time_slot'：每个时段内服务的不同学生数 ≤ capacity（同一份资源可在不同时段复用，如借用设备）。
   *   某条 Allocation 所在的时段 = 其机会的时段（见 Scenario.opportunity_time_slots）。
   * 两种范围下，带相同 intervention_id 的 existing grant 都占容量（规则见 Scenario.existing_grants）。
   */
  capacity_scope?: 'total' | 'per_time_slot';
}

/** 一个学生-机会对，用于覆盖集合 R0 / R1。 */
export interface CoveragePair {
  student_id: string;
  opportunity_id: string;
}

/** 主办方的 what-if 场景（全部是示例 / 模拟数据）。 */
export interface Scenario {
  id: string;
  title: string;
  /** 场景一律是示例 / 模拟，界面标「示例 / 模拟」。 */
  is_sample: true;
  /**
   * 统一评估时间（docs：R0 与 R1 必须在同一评估时间和假设下比较）。
   * 必须严格是合法的 `YYYY-MM-DD`（前后不得有空格），否则 UNSUPPORTED_INPUT。
   */
  evaluation_date: ISODate;
  students: StudentProfile[];
  opportunities: Opportunity[];
  /** 可选措施。 */
  interventions: Intervention[];
  /** 总预算（美元）。 */
  budget_usd: number;
  /**
   * 场景开始前已存在的 grants（全部计入 R0；未被方案撤回的照样计入 R1）。
   * 每条的 id 必须是字符串且在 existing_grants 内唯一（方案按 id 撤回），否则 UNSUPPORTED_INPUT。
   * 「可撤回」= intervention_id 是场景内某项措施的 id，且 student_id 是场景内学生的 id；其余（无 intervention_id、
   * 指向场景外，或学生不在场景内）不可撤回——不可撤回的照样生效、占容量，approved 的照样免成本。
   * 某措施 k 有「学生不在场景内」的 grant 时，与 k 互斥的措施在两种模式下都不能选中。
   * 被方案撤回（JointPlan.revoked_grant_ids）的 grant：不计入 R1、不占容量、不再免成本；撤回不退款。
   * 以下「占容量 / 免成本」规则只对**未被撤回**的已有 grant 适用（UNSUPPORTED_INPUT 的容量预检按全部已有 grant）。
   * 带 intervention_id 的已有 grant 占用该措施的容量（按不同学生计）：
   * - 占容量**不看** status 和 student_id 是否在场景内（已有承诺就占位，保守）；该 (intervention_id, student_id)
   *   在本方案中再分配时不重复占容量（已有 grant 已占 1 个）。
   * - 免成本**只认 approved**：若 existing_grants 中有带相同 intervention_id、相同 student_id 且
   *   status = 'approved' 的 grant，则该 (intervention_id, student_id) 在本方案中的所有 Allocation 的
   *   cost_usd 都记 0；pending 的已有 grant 不免成本（照常按 unit_cost_usd 计一次）。
   * 每条 grant 的 amount_usd / hours_per_week 给出（非 null）时必须是非负有限数，否则 UNSUPPORTED_INPUT。
   * 为 null 视同未给（空列表）。
   * per_time_slot 时：opportunity_id 为具体机会的 grant 计入该机会所在时段；
   * opportunity_id 为 null 的 grant 计入每一个时段。
   * intervention_id 指向场景里不存在的措施时，它只参与可达性计算，不占任何容量。
   */
  existing_grants?: ResourceGrant[];
  /**
   * 机会 id → 时段标签（如 `'2027-03-06-AM'`），用于 capacity_scope = 'per_time_slot' 的措施。
   * 没有列出的机会都归入同一个「默认时段」；默认时段与任何显式给出的标签都不相同。
   * 标签相同即同一时段（区分大小写，按字符串全等比较）。
   * 键引用场景里不存在的机会 id、或标签不是非空字符串 → UNSUPPORTED_INPUT。为 null 视同未给。
   */
  opportunity_time_slots?: Record<string, string>;
}

/** 下列字段值为 null 时一律视同未给（求解器与验证器同一口径）。 */
export interface SolveOptions {
  /**
   * protect（默认保护模式）= 不允许任何原有覆盖损失（L 必须为 0），并且不动任何已有承诺：
   *   revoked_grant_ids 必须为空（强制、自愿撤回都不允许，approved / pending 都一样）；
   * tradeoff（权衡分析模式）= 组织者主动给出明确的损失上限 loss_cap 后，允许撤回（强制与自愿），0 ≤ L ≤ loss_cap。
   * 其他取值 → UNSUPPORTED_INPUT。两种模式都不能突破任何硬约束。
   * 不撤回任何已有 grant 时 L 恒为 0；L > 0 只可能来自撤回（JointPlan.revoked_grant_ids），
   * 受影响的对与撤回明细见 JointOutcome.lost_pairs / revocations。
   */
  mode?: 'protect' | 'tradeoff';
  /**
   * tradeoff 模式下允许的最大损失 L（非负有限数，按（学生, 机会）对计）；protect 模式下忽略。
   * tradeoff 且 loss_cap = 0 不等同 protect：仍允许撤回 pending 的 grant 和不造成损失的撤回，只要求 L = 0。
   */
  loss_cap?: number;
  /**
   * 搜索上限（节点数），达到即返回 SEARCH_LIMIT_REACHED。
   * 缺省值与「节点」的具体含义由 lib/joint 的求解器决定，并写在 lib/joint/index.ts 文件头注释里。
   * 给出时必须是正整数，否则 UNSUPPORTED_INPUT。
   */
  max_search_nodes?: number;
  /**
   * 软要求：主办方要求必须启用（选中）的措施 id。
   * 无法满足时状态为 INFEASIBLE，并在 JointResult.alternative 中给出放松后的方案（不得悄悄放松）。
   * 引用不存在的 id → UNSUPPORTED_INPUT；引用 pending 措施 → 主结果 INFEASIBLE（主结果不能含 pending）。
   */
  required_intervention_ids?: string[];
  /**
   * 软要求：新增覆盖 G 至少为该值（G ≥ min_gain）。必须是非负有限数，否则 UNSUPPORTED_INPUT。
   * 达不到时状态为 INFEASIBLE，并在 JointResult.alternative 中给出放松后的方案。
   */
  min_gain?: number;
  /**
   * 软要求：公平底线（见 FairnessFloor）。每条底线的 FairnessReport.satisfied 必须为 true；
   * 达不到时状态为 INFEASIBLE，alternative 可整项放松（relaxed 含 'fairness_floors'），不做部分放松、不降低阈值。
   * 给出（非 null，含空数组）时，求解器返回的每个已评估方案都带 JointOutcome.fairness。
   * 格式不合法 → UNSUPPORTED_INPUT（条件见 CONTRACT 第 6 条）。
   */
  fairness_floors?: FairnessFloor[];
}

/**
 * 公平底线：对有明确、合法、可说明分组依据的支持群体，预先设定最低有效支持覆盖比例。
 * 只看学生自己声明的 statuses，不得读取学校名、显示名。
 * 一个学生属于多个群体时，每条底线各自独立计算，同一学生在每个所属群体里各计一次（事先声明的方法）。
 */
export interface FairnessFloor {
  /** 场景内唯一的非空字符串。 */
  id: string;
  /** 面向界面的群体名称，如「低收入学生」。非空字符串（trim 后非空）。 */
  label: string;
  /** 分组依据的说明（必填，trim 后非空）：为什么对这个群体设底线、依据是什么。 */
  basis: string;
  /**
   * 群体定义：档案 statuses 是数组、且与 any_of 至少有一个相同取值的学生。
   * statuses 没填（null / undefined / 非数组）的学生不计入该群体。
   * 必须是非空数组，每个元素是 STUDENT_STATUSES 中的取值（重复取值允许，无影响）。
   */
  statuses_any_of: StudentStatus[];
  /** 最低覆盖比例，0–1（含两端）的有限数。 */
  min_ratio: number;
}

/** 一条公平底线在某个方案下的计算结果。 */
export interface FairnessReport {
  floor_id: string;
  /**
   * 分母：属于该群体、且至少对场景内一个机会官方资格为 eligible
   * （checkEligibility(student, opp, { today: evaluation_date }).overall === 'eligible'）的学生数
   * （「符合该项支持条件的档案」）。
   */
  eligible_members: number;
  /** 分子：分母中的学生里，方案后至少有一个对在 R1 中的学生数（按学生计，不按对计）。 */
  covered_members: number;
  /** covered_members / eligible_members；分母为 0 时为 null（不计算比例）。 */
  ratio: number | null;
  /** 抄自 FairnessFloor.min_ratio。 */
  min_ratio: number;
  /** ratio === null（不适用，自动满足）或 ratio ≥ min_ratio − 1e-9。 */
  satisfied: boolean;
}

/**
 * verifyPlan 的可选第三参数（已确认保留）。
 * 用途：复核损失 L（coverage_loss）时需要知道模式与损失上限。
 * 不传，或 mode 缺省，按 protect 处理：损失 L 必须为 0；
 * mode = 'tradeoff' 时 L ≤ loss_cap 才算通过；mode = 'tradeoff' 但没给 loss_cap 时判为不通过
 * （与 solveJoint 在同样输入下返回 UNSUPPORTED_INPUT 一致）。
 */
export interface VerifyOptions {
  mode?: SolveOptions['mode'];
  loss_cap?: SolveOptions['loss_cap'];
  /**
   * 复核条件性方案（JointResult.conditional）时，把这些 pending 措施当作已批准（approval 检查放行）。
   * 引用不存在的措施 id → input_validity 不通过。
   */
  assume_approved_intervention_ids?: string[];
  /** 与 SolveOptions.required_intervention_ids 同义；传了才检查（organizer_requirements）。 */
  required_intervention_ids?: SolveOptions['required_intervention_ids'];
  /** 与 SolveOptions.min_gain 同义；传了才检查（organizer_requirements）。 */
  min_gain?: SolveOptions['min_gain'];
  /**
   * 与 SolveOptions.fairness_floors 同义；给出（非 null，含空数组）时才输出 fairness 检查。
   * 没给时，metrics 不比较 plan 自带的 fairness（例如已放松底线的 alternative 仍按原底线报告）。
   */
  fairness_floors?: SolveOptions['fairness_floors'];
}

export type JointStatus = 'OPTIMAL' | 'INFEASIBLE' | 'SEARCH_LIMIT_REACHED' | 'UNSUPPORTED_INPUT';

export const JOINT_STATUSES: readonly JointStatus[] = [
  'OPTIMAL',
  'INFEASIBLE',
  'SEARCH_LIMIT_REACHED',
  'UNSUPPORTED_INPUT',
] as const;

/**
 * 一次资源分配（决策变量 y）：某措施用于某学生的某机会。
 *
 * 生效方式：每条 Allocation (i, s, o) 合成一条 ResourceGrant 参与 R1 的可达性计算：
 *   { id: 'alloc:' + i + ':' + s + ':' + o, student_id: s, opportunity_id: o, intervention_id: i,
 *     type: 措施.type, amount_usd: 措施.amount_usd ?? null, device: 措施.device ?? null,
 *     hours_per_week: 措施.hours_per_week ?? null, status: 'approved', provider: scenario.title,
 *     is_sample: true }
 * 合法性：i 是选中的措施；s、o 是场景内的学生和机会；若措施给出 opportunity_ids 则必须包含 o；
 * 同一 (i, s, o) 不得重复。
 *
 * 计量口径（容量与成本按「不同学生」计）：
 * - 同一 (intervention_id, student_id) 可以有多条 Allocation（对应不同机会）；
 * - 容量与成本按不同的 (intervention_id, student_id) 计数；
 * - 同一 (intervention_id, student_id) 的多条 Allocation 中，cost_usd 只在其中一条记
 *   unit_cost_usd，其余记 0（这样 JointCost.marginal_usd 仍等于各 Allocation 的 cost_usd 之和）；
 * - 若该 (intervention_id, student_id) 已出现在 Scenario.existing_grants 中（该 grant 带相同的
 *   intervention_id，且**未被本方案撤回**），容量不再重复占用（已有 grant 已占 1 个，不论 status）；若该 grant 的
 *   status = 'approved'，它在本方案中的所有 Allocation 的 cost_usd 还都记 0（pending 的不免成本）。
 * - 本方案撤回了某条 (intervention_id, student_id) 的已有 grant 时，不得再有该 (intervention_id, student_id)
 *   的 Allocation（检查项 revocation）。
 */
export interface Allocation {
  intervention_id: string;
  student_id: string;
  opportunity_id: string;
  cost_usd: number;
}

/** 一个候选方案（verifyPlan 的输入；JointResult 兼容此结构）。 */
export interface JointPlan {
  selected_intervention_ids: string[];
  allocations: Allocation[];
  /**
   * 本方案撤回的已有 grant（Scenario.existing_grants 中的 id），按 id 升序。缺省 / null = 不撤回。
   * **只有 tradeoff 模式允许非空**；protect 模式（默认）下必须为空（验证器 revocation 检查判不通过），
   * 所以 protect 下不能选中与「有可撤回已有 grant 的措施」互斥的措施。
   * 只能是可撤回的 grant（intervention_id 指向场景内措施、student_id 是场景内学生），不得重复。
   * 强制撤回：选中的措施 i 与措施 k 互斥（对称）时，所有 intervention_id === k 的可撤回 grant 都必须在这里
   * （k 若有场景外学生的 grant，i 本身就不能选中）。
   * tradeoff 模式下自愿撤回（如为别人腾名额）也允许。撤回的效果与损失见 CONTRACT「联合求解模型」第 2、3 条。
   * 求解器返回的方案（主结果、alternative、conditional）一律给出该字段（可为空数组）。
   */
  revoked_grant_ids?: string[];
}

/** 一条被撤回的已有 grant 的明细。 */
export interface GrantRevocation {
  grant_id: string;
  /** 该 grant 的 intervention_id。 */
  intervention_id: string;
  /** 该 grant 的 student_id。 */
  student_id: string;
  /**
   * 导致强制撤回的被选中措施 id（与 intervention_id 互斥的选中措施；有多个时取 id 最小者）；
   * 自愿撤回为 null。
   */
  forced_by: string | null;
}

export interface JointCost {
  /** 已启用措施的固定成本合计（每项只计一次）。 */
  fixed_usd: number;
  /**
   * 各 Allocation 的 cost_usd 之和；按 Allocation 的口径，
   * 等于每个不同 (intervention_id, student_id) 计一次 unit_cost_usd。
   */
  marginal_usd: number;
  total_usd: number;
}

/**
 * 一个方案的结果指标（不含状态）。字段含义见 JointResult。
 * 排序：selected_intervention_ids 按 id 升序；allocations 按 (intervention_id, student_id, opportunity_id)
 * 升序；R1 按 (student_id, opportunity_id) 升序。字符串一律按 UTF-16 码元比较（JS 的 `<`，不用 localeCompare）。
 */
export interface JointOutcome extends JointPlan {
  /** 执行本方案后可达的学生-机会对（existing_grants + 方案合成的 grant）。 */
  R1: CoveragePair[];
  /** 增益 G = |R1 \ R0|（新变为可达的对数）。 */
  G: number;
  /**
   * 损失 L = |R0 \ R1|（原本可达、方案后不可达的对数；protect 模式必须为 0，tradeoff 模式 ≤ loss_cap）。
   * 不撤回任何已有 grant 时恒为 0。
   */
  L: number;
  /** 净值 N = G − L。 */
  N: number;
  cost: JointCost;
  /** R0 \ R1（受损失影响的对），按 (student_id, opportunity_id) 升序。求解器返回时必须给出（可为空数组）。 */
  lost_pairs?: CoveragePair[];
  /** 每条被撤回 grant 的明细，按 grant_id 升序，与 revoked_grant_ids 一一对应。求解器返回时必须给出（可为空数组）。 */
  revocations?: GrantRevocation[];
  /** 公平底线结果：options 给出 fairness_floors（非 null）时给出，顺序同输入；否则缺省。UNSUPPORTED_INPUT 时缺省。 */
  fairness?: FairnessReport[];
}

/** 可被 INFEASIBLE 的 alternative 整项放松的软要求。 */
export type SoftRequirementKey = 'min_gain' | 'fairness_floors' | 'required_intervention_ids';

/**
 * 放松的固定优先级（完全并列时靠前者优先被放松），也是 JointAlternative.relaxed 的排列顺序。
 */
export const SOFT_REQUIREMENT_RELAX_ORDER: readonly SoftRequirementKey[] = [
  'min_gain',
  'fairness_floors',
  'required_intervention_ids',
] as const;

/**
 * INFEASIBLE 时给出的受约束替代方案：只放松主办方自己的软要求
 * （required_intervention_ids / min_gain / fairness_floors），绝不放松硬约束。
 * 放松 = 整项不再要求（不做部分放松、不降低阈值）。它不是主结果，界面必须写明放松了什么。
 */
export interface JointAlternative extends JointOutcome {
  /** 放松了哪些软要求（非空，按 SOFT_REQUIREMENT_RELAX_ORDER 排列）。 */
  relaxed: SoftRequirementKey[];
  /** 面向界面的说明：放松了什么、为什么原要求达不到。 */
  note: string;
}

/**
 * 条件性结果：「如果这些 pending 措施获批，则……」。不是已生效的结果。
 * = 把场景里全部 pending 措施当作已批准、其他条件（含 options 里的软要求）相同再求解一次的结果。
 * R0 与主结果相同（existing_grants 不变，pending 的 existing grant 仍按 pending 处理）。
 */
export interface JointConditional extends JointOutcome {
  /**
   * 这次条件性求解的状态（规则同 JointResult.status）。只有一种情况会是 UNSUPPORTED_INPUT：
   * 条件性最优方案没有通过内部复核——此时不给出该方案（空方案占位），note 写明原因。
   * 主结果 UNSUPPORTED_INPUT 时 conditional 为 null。
   */
  status: JointStatus;
  /** 被当作已批准的 pending 措施 id（升序）。 */
  assumed_approved_intervention_ids: string[];
  /** 面向界面的说明，写明「如果这些措施获批，则……，目前尚未生效」。 */
  note: string;
}

/**
 * 联合求解结果。字母定义出自 docs/product-scope.md「Shared constraints」：
 * 「在同一评估时间和假设下，R0 为原始覆盖，R1 为全局分配后的覆盖；
 *   报告增益 |R1 − R0|、损失 |R0 − R1|、净值 = 增益 − 损失。」
 * 这里的「覆盖」= 现实可达的学生-机会对集合，减号为集合差。
 *
 * 主结果（本对象的方案字段）永远不含 pending 措施。
 * 「空方案」= selected_intervention_ids = []、allocations = []、cost 全 0；此时 R1 = R0，G = L = N = 0
 * （UNSUPPORTED_INPUT 不做评估，R0 = R1 = []）。
 *
 * 所有结果都是模拟，不是真实影响；界面标「模拟」。
 */
export interface JointResult extends JointOutcome {
  /**
   * OPTIMAL = 搜索完成并证明最优；
   * INFEASIBLE = 搜索完成，证明没有方案同时满足硬约束和软要求（主结果为空方案，见 alternative；不得悄悄放松）；
   * SEARCH_LIMIT_REACHED = 达到搜索上限（不等于无解，也不得声称最优，只返回经 verifyPlan 复核通过的方案）；
   * UNSUPPORTED_INPUT = 输入不合法或超出求解器支持范围，或求解器对自己的最优方案做独立复核未通过
   * （返回空方案，notes 说明原因；不会出现「OPTIMAL 但复核不通过」）。
   */
  status: JointStatus;
  /** 原始覆盖：只带 existing_grants 时可达的学生-机会对，按 (student_id, opportunity_id) 升序。 */
  R0: CoveragePair[];
  /** 面向界面的说明（状态解释、待审批说明、并列规则、模拟标注等）。 */
  notes: string[];
  /**
   * 仅 status = 'INFEASIBLE' 时非空：只放松软要求后的最优方案；其他状态为 null 或缺省。
   */
  alternative?: JointAlternative | null;
  /**
   * 场景里有 pending 措施（且 status ≠ UNSUPPORTED_INPUT）时给出；否则为 null 或缺省。
   */
  conditional?: JointConditional | null;
  /**
   * 求解器对自己返回的主方案调用 verifyPlan 的独立复核结果（传入与求解相同的 mode / loss_cap /
   * required_intervention_ids / min_gain / fairness_floors）。
   * OPTIMAL 时必须非空且通过。SEARCH_LIMIT_REACHED 时必须非空：只有复核通过的方案才能作为主方案返回
   * （从搜索中记录的若干改进候选里按目标顺序依次复核，取第一个通过的），都不通过则返回空方案
   * （此时 verification 为空方案的复核结果）。INFEASIBLE 时为 null。UNSUPPORTED_INPUT 时：输入不合法为 null；
   * 内部复核未通过为那次失败的复核结果（对应的方案没有返回）。
   */
  verification?: VerifyResult | null;
}

export interface VerifyCheck {
  /**
   * 检查项名称，建议取值（含义见 CONTRACT.md「联合求解模型」的 verifyPlan 一节）：
   * input_validity / approval / mutual_exclusion / prerequisite / revocation / allocation_validity / capacity /
   * cost_accounting / budget / eligibility / deadline / barrier_resolution / coverage_loss /
   * organizer_requirements / fairness / metrics。
   * 其中 organizer_requirements 与 fairness 是软要求检查，其余为「可执行性检查」（见 BaselineRow）。
   * capacity 与 cost_accounting 按 Allocation 注释里的口径复核（按不同 (intervention_id, student_id) 计）。
   */
  name: string;
  passed: boolean;
  /** 说明（失败时写清哪里不对）。 */
  detail: string;
}

/** 独立复核结果：不依赖求解器自己的可行性标记。 */
export interface VerifyResult {
  /** 所有检查都通过才为 true。 */
  passed: boolean;
  checks: VerifyCheck[];
}

// ───────────────────────────── 基线对比（lib/joint/baselines.ts）─────────────────────────────

/**
 * 基线：A 只看资格；B 学生端约束规划器；C 机构端干预规划器；joint 联合求解。
 * 说明书中的基线 D（充分协调的分离式规划器）未实现。
 */
export type BaselineId = 'A_eligibility_only' | 'B_student_side' | 'C_organizer_side' | 'joint';

/** 独立重算的方案指标（来自验证器的重算，不信任方案自带的数字）。 */
export interface BaselineMetrics {
  R1_count: number;
  G: number;
  L: number;
  N: number;
  total_usd: number;
}

/**
 * 基线对比的一行。算法与字段口径见 CONTRACT.md「联合求解模型」第 10 条。
 * 「可执行性检查」= VerifyResult.checks 中除 organizer_requirements、fairness 以外的全部检查项。
 */
export interface BaselineRow {
  id: BaselineId;
  /** 中文名（固定文本，见 CONTRACT 第 10 条）。 */
  label: string;
  /** 这个做法是什么、缺什么（一两句）。 */
  description: string;
  /** 该做法自己声称的可达对数（不经复核）。 */
  claimed_reachable: number;
  /** 该做法产生的方案（只含 JointPlan 字段；A 为空方案）。 */
  plan: JointPlan;
  /** 用同一个独立验证器、按相同选项复核 plan 的结果（含软要求检查）。 */
  verification: VerifyResult;
  /** 可执行性检查全部通过时：独立重算的 R1 数量、G、L、N、成本；否则 null（方案不可执行，不能把它的数字当真）。 */
  verified: BaselineMetrics | null;
  /**
   * 软要求是否满足：options 给出了 required_intervention_ids / min_gain / fairness_floors 中任一项时，
   * = verification 中 organizer_requirements 与 fairness 检查（输出了的）全部通过；都没给时为 null。
   * 与 verified 相互独立（可执行但没达到主办方目标的方案，verified 非 null、此项为 false）。
   */
  soft_requirements_met: boolean | null;
  /**
   * 原方案可执行性检查不通过时：按该做法自身的顺序截断到可执行版本后的指标与说明；
   * 原方案可执行、或该做法没有截断规则（A、joint）时为 null。
   */
  repaired: (BaselineMetrics & { note: string }) | null;
}

/**
 * compareBaselines(scenario, options?) 的返回：`(scenario: Scenario, options?: SolveOptions) => BaselineComparison`。
 * rows 固定顺序 A、B、C、joint；输入不合法时 rows 为空、notes 写明原因。全部为模拟结果。
 */
export interface BaselineComparison {
  rows: BaselineRow[];
  notes: string[];
}

// ═════════════════════════════ 第二阶段新增 ═════════════════════════════

// ───────────────────────────── 差距分析 GapAnalysis（analyzeGaps）─────────────────────────────

/**
 * 差距五类（analyzeGaps 只整理已有判断结果，不重新发明规则）：
 * - knowledge_or_experience = 知识或经验：未被证据覆盖、且不是材料（material_kind 为空）的准备项；
 * - materials = 材料：未被证据覆盖的材料类准备项（material_kind 非空），以及未满足的 portfolio 类要求；
 * - time_and_cost = 时间和成本：analyzeReachability 的时间 / 费用 / 交通 / 设备四类障碍中
 *   尚未被 approved grant 化解的（resolved 为 false）；已化解的不列；
 * - unchangeable_eligibility = 当前不可改变的资格限制：not_satisfied 的硬性要求里，学生在本届无法通过努力改变的
 *   （如年级、年龄、地区、公民身份、身份标签）。不给任何行动建议（action 必须为 null），只给原因；
 * - unknown_info = 未知信息：status 为 unknown 的资格项，以及 missing_info 中每一个缺失的字段，逐条列出，
 *   不合并成一句笼统的话。
 */
export type GapCategory =
  | 'knowledge_or_experience'
  | 'materials'
  | 'time_and_cost'
  | 'unchangeable_eligibility'
  | 'unknown_info';

/** 五类的固定顺序（也是 GapAnalysis.items 的分组顺序与界面展示顺序）。 */
export const GAP_CATEGORIES: readonly GapCategory[] = [
  'knowledge_or_experience',
  'materials',
  'time_and_cost',
  'unchangeable_eligibility',
  'unknown_info',
] as const;

/**
 * 一条差距的依据（判别联合，`kind` 是判别字段）：
 * - requirement：来自某条官方要求（Requirement.id），附官网原文；
 * - prep_item：来自某个准备项（PrepItem.id），附依据原文（准备项没有依据时为 null）；
 * - barrier：来自 analyzeReachability 的某类现实障碍；
 * - missing_field：来自缺失的档案 / 机会字段（与 ReachabilityResult.missing_info 的写法一致，如 `profile.devices`）。
 */
export type GapBasis =
  | { kind: 'requirement'; requirement_id: string; source_text: string }
  | { kind: 'prep_item'; prep_item_id: string; source_text: string | null }
  | { kind: 'barrier'; barrier_type: BarrierType }
  | { kind: 'missing_field'; field: string };

/** 一条差距。 */
export interface GapItem {
  /**
   * 结果内唯一、稳定（同样的输入总得到同样的 id，便于界面做 key 和前后对比）。
   * 建议形如 `${category}:${依据 id}`，如 `materials:prep-resume`、`unknown_info:profile.devices`。
   */
  id: string;
  category: GapCategory;
  /** 简短标题（面向学生），如「Resume not ready yet」。 */
  title: string;
  /** 面向学生的说明：缺什么、为什么算差距。 */
  detail: string;
  /** 依据：来自哪条资格、哪个准备项、哪类障碍或哪个缺失字段。 */
  basis: GapBasis;
  /**
   * 学生能否通过自己的行动改善。unchangeable_eligibility 一律为 false；
   * unknown_info 通常为 true（补填档案或向官方确认）。
   */
  improvable: boolean;
  /**
   * 可改善时的一条真实行动（如「完成准备项《写简历》」「向主办方确认是否接受十年级学生」）。
   * improvable 为 false 时为 null；unchangeable_eligibility 必须为 null——不给任何绕过办法。
   */
  action: string | null;
  /** 补上这条差距预计要的小时数（来自准备项）；不适用或不知道为 null / 缺省。 */
  estimated_hours?: number | null;
  /** 补上这条差距预计要的费用（美元）；不适用或不知道为 null / 缺省。 */
  estimated_cost_usd?: number | null;
}

/** analyzeGaps(profile, opp, grants, options) 的返回。 */
export interface GapAnalysis {
  profile_id: string;
  opportunity_id: string;
  /**
   * 全部差距，稳定顺序：先按 GAP_CATEGORIES 的类别顺序分组，组内按机会里的原顺序
   * （requirements / preparation 顺序、BARRIER_TYPES 顺序、missing_info 顺序）。
   */
  items: GapItem[];
  /** 每类的条数（五个键都必须有，没有的为 0），等于 items 中该类的条数。 */
  counts: Record<GapCategory, number>;
  /**
   * 资格总结论（抄自内部调用的 checkEligibility / analyzeReachability），供界面一并显示。
   * 补充字段：便于界面不再单独调用一次。
   */
  eligibility_overall: OverallEligibility;
  /** 现实可达性（抄自 analyzeReachability 的 reachable，语义相同；可达 ≠ 录取）。 */
  reachable: boolean | null;
  /** 面向学生的一句话总结。 */
  summary: string;
}

// ───────────────────────────── 替代机会 AlternativeSuggestion（findAlternatives）─────────────────────────────

/**
 * findAlternatives(profile, opp, catalog, options) 返回 `AlternativeSuggestion[]` 中的一条。
 * 只从传入的机会目录（catalog）里找，不编造机会；不把无关的小活动说成目标机会的官方前置。
 */
export interface AlternativeSuggestion {
  /**
   * next_cycle = 等下一届（只在机会每年举办、且阻断原因会随时间改善时给出，如年级不够）；
   * same_field = 同领域的其他机会（必须是该学生硬性资格不冲突的机会；给了 options.today 时不含截止日期已过的机会）。
   */
  kind: 'next_cycle' | 'same_field';
  /**
   * 建议的机会 id：same_field 为目录中的那个机会；next_cycle 指原机会自身（可为原机会的 id），
   * 目录里没有可指的机会时为 null。
   */
  opportunity_id: string | null;
  /** 机会标题（next_cycle 时为原机会标题）。 */
  title: string;
  /** 为什么建议它（面向学生），如「同属 climate 领域，你的年级符合要求」。 */
  reason: string;
  /**
   * 该学生对这个建议机会的资格结论（checkEligibility 的 overall）；无法评估时为 null。
   * same_field 的建议不得是 'not_eligible'。next_cycle 时是对「下一届」无法预先判断，通常为 null。
   */
  eligibility_overall: OverallEligibility | null;
  /**
   * 与原机会共有的领域标签（Opportunity.fields 的交集，按 lib/tags.ts 的 normalizeTag 比较），
   * 用建议机会原本的写法；next_cycle 时为原机会的全部 fields。
   */
  shared_fields: string[];
}

// ───────────────────────────── 匹配说明 MatchExplanation（explainMatch）─────────────────────────────

/**
 * 匹配理由的类别：interest = 兴趣与领域重合；eligibility = 资格结论；reachability = 现实可达性；
 * format = 参与形式（线上 / 线下）与交通；time = 时间投入与可用时间；cost = 费用与预算。
 */
export type MatchReasonKind = 'interest' | 'eligibility' | 'reachability' | 'format' | 'time' | 'cost';

export const MATCH_REASON_KINDS: readonly MatchReasonKind[] = [
  'interest',
  'eligibility',
  'reachability',
  'format',
  'time',
  'cost',
] as const;

/** 一条匹配理由。 */
export interface MatchReason {
  kind: MatchReasonKind;
  /** true = 有利；false = 不利；null = 信息不足，判断不出来（不猜）。 */
  positive: boolean | null;
  /** 面向学生的一句话。 */
  text: string;
}

/**
 * explainMatch(profile, opp, options) 的返回：这个机会为什么适合 / 不适合这名学生。
 * 约定：
 * - 不输出任何分数、百分比或名次，不用于给学生排名；
 * - 不读取学校名（school_name）与显示名（display_name）——只改这两项，结果必须完全不变（有对照测试）；
 * - 只看兴趣与领域的重合、资格结论、现实条件。
 */
export interface MatchExplanation {
  profile_id: string;
  opportunity_id: string;
  /** 理由列表，稳定顺序（按 MATCH_REASON_KINDS 顺序）。 */
  reasons: MatchReason[];
  eligibility_overall: OverallEligibility;
  /** 现实可达性（语义同 ReachabilityResult.reachable；可达 ≠ 录取）。 */
  reachable: boolean | null;
  /**
   * 学生兴趣与机会领域的交集（profile.interests ∩ opp.fields，按 lib/tags.ts 的 normalizeTag 比较：
   * 大小写、空格 / 下划线 / 连字符写法不同也算同一标签），用机会原本的写法、按 opp.fields 顺序；兴趣没填时为 []。
   */
  shared_interests: string[];
  /** 面向学生的一句话总结（不含分数）。 */
  summary: string;
}

/**
 * explainMatch 的选项。grants = 主办方已分配给该学生、对这个机会生效的资源（与 analyzeGaps 的 grants 同义）；
 * 缺省 = []。同一页面同时显示 analyzeGaps 时请传同一组 grants，两者的 reachable 才一致。
 */
export interface MatchOptions extends EvalOptions {
  grants?: ResourceGrant[];
}

// ───────────────────────────── 联合申请规划 CrossPlan（planAcrossOpportunities）─────────────────────────────

/** 联合规划中的一个机会。 */
export interface CrossPlanItem {
  opportunity_id: string;
  title: string;
  deadline: ISODate | null;
  /**
   * planned = 已排入计划；blocked = 硬性资格不满足（planRoutes 返回 blocked），不计入负荷；
   * past_deadline = 按 options.today 截止日期已过，不计入负荷；
   * insufficient_data = 机会数据不完整、规划时出错，算不出小时（小时为 0、不计入负荷，note 说明缺什么，
   * 同时写进 CrossPlan.warnings 与 missing_info）——仍列在 items 里，不让它从页面上悄悄消失。
   */
  status: 'planned' | 'blocked' | 'past_deadline' | 'insufficient_data';
  /**
   * 取必需步骤时用的路线类型（补充字段，便于界面说明「按哪条路线算的」）；非 planned 时为 null。
   */
  route_type: RouteType | null;
  /**
   * 计入材料复用之后这个机会要算的小时数：可复用的通用材料只算在 order 最靠前、用到它的那个机会上，
   * 按各机会中该材料的最大小时（MaterialReuse.hours_each）计，其他机会不再计。
   * 所以承担可复用材料的那个机会的 required_hours 可能大于它自己的 hours_before_reuse
   * （它替别的机会准备了一份更完整的材料）。非 planned 时为 0。
   * 关系：required_hours = hours_before_reuse − hours_saved_by_reuse + （作为承担者时 Σ(hours_each − 自己那份)）。
   */
  required_hours: number;
  /** 不考虑复用时这个机会自己需要的小时数。非 planned 时为 0。 */
  hours_before_reuse: number;
  /**
   * 这个机会因复用（材料已由 order 更靠前的机会承担）而少算的小时，≥ 0：
   * 该机会里不由它承担的每份可复用材料的自己那份小时之和。承担者为 0。非 planned 时为 0。
   */
  hours_saved_by_reuse: number;
  /** 距截止日期还有几周（按 options.today）；today 或 deadline 缺失时为 null。 */
  weeks_left: number | null;
  /**
   * 只做这一个机会时能否在截止前完成（不考虑复用：按 hours_before_reuse）。公式与 weekly_load 的 over 一致：
   * 可用小时 = hours_per_week_available × 天数 / 7，天数 = today 到截止日（都含）的天数；
   * hours_before_reuse ≤ 可用小时 → true。past_deadline 为 false；today / 截止日期 / 每周可用小时缺失，
   * 或非 planned（blocked、insufficient_data）时为 null。
   * 注意：planRoutes 的 Route.feasible_by_deadline 按「today 到截止日的天数差」（不含 today 当天）计，
   * 两者在临界情况下可能差一天的量；联合规划页以本字段为准。
   */
  feasible_alone: boolean | null;
  /** 按截止日期的建议先后（1 起）；截止日期为 null 的排在最后。只是建议，不替学生做取舍。 */
  order: number;
  /** 面向学生的说明（为什么排在这里、为什么 blocked 等）。 */
  note: string;
}

/** 一类材料在多个机会之间的复用情况。 */
export interface MaterialReuse {
  material_kind: MaterialKind;
  /** true = 通用材料，只准备一次；false = 需针对每个机会单独准备。 */
  reusable: boolean;
  /** 需要这类材料的机会 id。 */
  opportunity_ids: string[];
  /** 每份所需小时数：各机会对应准备项 estimated_hours 的最大值（保守，不低估）。 */
  hours_each: number;
  /**
   * 复用省下的小时数：reusable 时 = 各机会该材料小时数之和 − hours_each
   * （各机会数值相同时即 hours_each × (机会数 − 1)）；不可复用时为 0。
   */
  hours_saved: number;
  /** 面向学生的说明，如「简历可复用，只算一次」/「个人陈述需针对每个机会单独写」。 */
  note: string;
}

/**
 * 某一周的负荷（按天分摊）：
 * - 每个计入负荷的机会，把 required_hours 在 today（含）到它的截止日（含）之间按天平均分摊，再按周一对齐汇总；
 *   所以第一周只算 today 到周日，该机会的最后一周只算周一到截止日。
 * - 计划窗口 = today（含）到计入负荷的机会中最晚的截止日（含）。
 */
export interface WeeklyLoad {
  /** 该周的周一（从 options.today 所在周的周一起，每 7 天一周）。 */
  week_start: ISODate;
  /** 该周落在计划窗口里的天数（1–7）：第一周从 today 算起，最后一周算到最晚截止日。 */
  days: number;
  /** 本周需要投入的小时数（各机会每天分摊小时 × 该机会在本周的天数，求和）。 */
  hours_needed: number;
  /**
   * 本周可用小时 = profile.hours_per_week_available × days / 7（按本周实际天数折算）；没填为 null。
   * 只有一个机会时，某周 over 为 true ⇔ 该机会每天分摊 > 每周可用 / 7 ⇔ 该机会 feasible_alone 为 false，两者一致。
   */
  hours_available: number | null;
  /** 是否超出本周可用小时；hours_available 为 null 时为 null（不猜）。 */
  over: boolean | null;
  /** 本周有投入的机会 id。 */
  opportunity_ids: string[];
}

/**
 * planAcrossOpportunities(profile, opps, options) 的返回：多个机会一起排期。
 * 只把数字摆出来（截止日期、每周负荷、冲突、可复用材料与省下的小时、建议先后），
 * 不替学生决定放弃哪个机会；冲突说明里可以写「如果只保留优先级高的几个会怎样」，但不做取舍。
 */
export interface CrossPlan {
  profile_id: string;
  /** 评估基准日（options.today）；没传为 null，此时与日期相关的字段一律为 null。 */
  evaluated_on: ISODate | null;
  /** 每个机会一项，按 order 升序。 */
  items: CrossPlanItem[];
  /** 按周的负荷，按 week_start 升序；没有 today 时为 []。 */
  weekly_load: WeeklyLoad[];
  /** 材料复用情况（含不可复用的同类材料，说明为什么不省时间）。 */
  reuse: MaterialReuse[];
  /** 计入复用后的总小时数（只算 planned 的机会）= Σ required_hours。 */
  total_hours: number;
  /** 不考虑复用的总小时数（只算 planned 的机会）；与 total_hours 之差 = 复用省下的小时。 */
  total_hours_without_reuse: number;
  /** 面向学生的冲突说明（如「12 月第 2 周需要 14 小时，你每周可用 6 小时」）。 */
  conflicts: string[];
  /** 其他提醒（如资格待确认、截止已过）。 */
  warnings: string[];
  /** 判断所缺的信息（如 `profile.hours_per_week_available`、`opportunity.<id>.deadline`）。 */
  missing_info: string[];
}

/** planAcrossOpportunities 的选项。 */
export interface CrossPlanOptions extends EvalOptions {
  /**
   * 学生自己给的优先顺序（机会 id，靠前优先）。只用于冲突说明「若只保留前几个会怎样」，
   * 不改变 order（order 只按截止日期），也不代表系统建议放弃其他机会。缺省 = 学生没给。
   */
  priorities?: string[];
}

// ───────────────────────────── Quest Journal ─────────────────────────────
//
// 一个 Journal 条目记录四件互相独立的事，页面必须分开显示，不能互相推断：
//   1. application              学生自己的申请进度（准备中 / 已提交 / 已退出）
//   2. eligibility_confirmation 官方是否确认了资格
//   3. decision                 官方的录取结果
//   4. participated             学生是否实际参与
// 提交申请 ≠ 官方确认资格 ≠ 被录取 ≠ 已参与。这些都由学生自己记录，不是系统判断。
// 需要一句话摘要时用 lib/journal.ts 的 journalHeadline(entry)（派生，不存字段）。

/** 学生的申请进度：preparing = 准备中；submitted = 已提交；withdrawn = 学生主动退出。 */
export type JournalApplicationStatus = 'preparing' | 'submitted' | 'withdrawn';

/** 官方是否确认了资格：unconfirmed = 还没确认 / 没记；confirmed = 官方确认符合；rejected = 官方认定不符合。 */
export type EligibilityConfirmation = 'unconfirmed' | 'confirmed' | 'rejected';

/** 官方的录取结果：pending = 还没结果 / 没记；admitted = 被录取；not_admitted = 未录取。 */
export type JournalDecision = 'pending' | 'admitted' | 'not_admitted';

/**
 * Journal 事件（由学生记录，lib/store.ts 的 recordJournalEvent 据此更新对应字段并追加 history）：
 * - added：加入 Journal（创建条目时记录，不改其他字段）；
 * - submitted：application = 'submitted'，submitted_on = 当天；
 * - withdrawn：application = 'withdrawn'（submitted_on 保留）；
 * - reopened：撤销退出 / 撤销提交，application 回到 'preparing'，submitted_on = null；
 * - eligibility_confirmed / eligibility_rejected：eligibility_confirmation = 'confirmed' / 'rejected'；
 * - admitted / not_admitted：decision = 'admitted' / 'not_admitted'；
 * - participated / did_not_participate：participated = true / false。
 */
export type JournalEvent =
  | 'added'
  | 'submitted'
  | 'withdrawn'
  | 'reopened'
  | 'eligibility_confirmed'
  | 'eligibility_rejected'
  | 'admitted'
  | 'not_admitted'
  | 'participated'
  | 'did_not_participate';

export const JOURNAL_EVENTS: readonly JournalEvent[] = [
  'added',
  'submitted',
  'withdrawn',
  'reopened',
  'eligibility_confirmed',
  'eligibility_rejected',
  'admitted',
  'not_admitted',
  'participated',
  'did_not_participate',
] as const;

/** history 中的一项。 */
export interface JournalHistoryItem {
  event: JournalEvent;
  on: ISODate;
}

/** Journal 里的一条任务。 */
export interface JournalTask {
  /** 条目内唯一。 */
  id: string;
  title: string;
  /** 来自哪个准备项（PrepItem.id），若有；学生自己加的任务为 null / 缺省。 */
  prep_item_id?: string | null;
  done: boolean;
  /** 完成日期；未完成或没记为 null / 缺省。 */
  done_on?: ISODate | null;
}

/** 材料准备状态：未开始 / 进行中 / 已就绪。 */
export type MaterialStatus = 'not_started' | 'in_progress' | 'ready';

export const MATERIAL_STATUSES: readonly MaterialStatus[] = ['not_started', 'in_progress', 'ready'] as const;

/**
 * 一份申请材料。单独存放（lib/store.ts 的 materials 键），Journal 条目用 material_ids 引用。
 * 可复用材料（reusable: true）被多个条目引用时是同一条记录：改一次状态，所有引用它的条目都看到。
 */
export interface Material {
  /** 全局唯一。 */
  id: string;
  /** 属于哪个档案（同一浏览器里可能切换示例档案）。 */
  profile_id: string;
  kind: MaterialKind;
  title: string;
  /** true = 通用材料，可在多个机会间复用；false = 针对某个机会单独准备。 */
  reusable: boolean;
  /** 针对的机会 id；通用材料为 null。 */
  opportunity_id: string | null;
  /** 来自哪个准备项（PrepItem.id），若有（补充字段，便于和联合规划对应）。 */
  prep_item_id?: string | null;
  /** 预计小时数；不知道为 null。 */
  estimated_hours: number | null;
  status: MaterialStatus;
}

/**
 * 学生自愿记录的主观反馈，全部可缺（缺省 / null = 没记）。
 * 是否提交、是否参与以 JournalEntry 的 application / participated 为准，这里不重复。
 * 这是学生自己的记录，不是系统判断，也不是真实影响的证据，界面与报告不得据此声称产品带来了什么结果。
 */
export interface OutcomeFeedback {
  /** 是否通过本工具发现了之前不知道的机会。 */
  discovered_new_opportunity?: boolean | null;
  /** 是否看懂了资格要求。 */
  understood_eligibility?: boolean | null;
  /** 是否完成了申请材料。 */
  completed_materials?: boolean | null;
  /** 学生自己写的一句话（哪些地方有帮助 / 没帮助）。 */
  helpful_note?: string | null;
  recorded_on?: ISODate | null;
}

/**
 * Quest Journal 的一个条目（一个档案 × 一个机会）。存在学生自己的浏览器 localStorage。
 * 唯一键：(profile_id, opportunity_id)。
 *
 * application、eligibility_confirmation、decision、participated 四项互相独立，页面必须分开显示：
 * 提交 ≠ 官方确认资格 ≠ 被录取 ≠ 已参与，不能由其中一项推断另一项。
 */
export interface JournalEntry {
  /** 全局唯一。 */
  id: string;
  /** 属于哪个档案。 */
  profile_id: string;
  opportunity_id: string;
  added_on: ISODate;
  /** 学生的申请进度。 */
  application: JournalApplicationStatus;
  /** 最近一次提交的日期；没提交为 null。 */
  submitted_on: ISODate | null;
  /** 官方是否确认了资格。 */
  eligibility_confirmation: EligibilityConfirmation;
  /** 官方录取结果。 */
  decision: JournalDecision;
  /** 是否实际参与；null = 还没发生 / 没记录。 */
  participated: boolean | null;
  /** 事件记录，按记录先后；通常第一项是 added。同一事件同一天只记一次。 */
  history: JournalHistoryItem[];
  /** 学生选的路线类型；没选为 null / 缺省。 */
  route_type?: RouteType | null;
  tasks: JournalTask[];
  /** 引用的材料 id（Material.id，同一档案的材料）。可复用材料可被多个条目引用。 */
  material_ids: string[];
  /** 官方链接（抄自 Opportunity.official_url），不完成任何任务也能直接去官方申请。 */
  official_url: string;
  /** 学生自己的备注。 */
  notes?: string | null;
  outcome?: OutcomeFeedback | null;
}

// ───────────────────────────── 规划快照 PlanSnapshot（回放）─────────────────────────────

/**
 * 触发一次重新规划的原因：
 * initial = 第一次规划；evidence_added / evidence_removed / evidence_edited = 证据新增 / 删除 / 修改（状态、关联准备项）；
 * profile_edited = 档案其他字段被修改（年级、可用时间、预算等）；manual = 学生手动重新规划。
 */
export type PlanTrigger =
  | 'initial'
  | 'evidence_added'
  | 'evidence_removed'
  | 'evidence_edited'
  | 'profile_edited'
  | 'manual';

export const PLAN_TRIGGERS: readonly PlanTrigger[] = [
  'initial',
  'evidence_added',
  'evidence_removed',
  'evidence_edited',
  'profile_edited',
  'manual',
] as const;

/** 生成快照时用到的条件（供回放解释「当时是按什么条件算的」）。 */
export interface PlanSnapshotInputs {
  /** 当时档案里的证据 id。 */
  evidence_ids: string[];
  hours_per_week_available: number | null;
  budget_usd: number | null;
  grade: GradeLevel | null;
  /** 当时传给 planRoutes 的 options.today；没传为 null。 */
  today: ISODate | null;
  /** 触发原因为 profile_edited 时，改了哪些档案字段（如 `['grade', 'hours_per_week_available']`）；其他情况缺省。 */
  changed_fields?: string[];
}

/**
 * 一次规划的快照，供回放「之前 → 变化 → 之后 → 原因」：
 * 取同一机会相邻的两个快照，用 diffRoutes(before.plan, after.plan) 得到变化与原因。
 */
export interface PlanSnapshot {
  /** 全局唯一。 */
  id: string;
  /** 档案 id（补充字段：同一浏览器里可能切换示例档案，回放只比较同一档案的快照）。 */
  profile_id: string;
  opportunity_id: string;
  taken_on: ISODate;
  /** 当时 planRoutes 的完整结果。 */
  plan: PlanResult;
  inputs: PlanSnapshotInputs;
  trigger: PlanTrigger;
  /** 触发原因的补充说明（如新增证据的标题）；没有为 null / 缺省。 */
  trigger_detail?: string | null;
}

// ───────────────────────────── Connect 本地示例 ─────────────────────────────
//
// Quest Creator / Talent Board / 邀请的本地示例（主办方端与 Connect 负责人实现功能，这里只定类型）。
// 全部是示例 / 本地数据：没有真实发布者，也没有真实的联系发生。界面必须写明这是本地演示。

/** 示例发布者的种类：研究组 / 学生社团 / 非营利组织 / 项目团队 / 个人。 */
export type PublisherKind = 'research_group' | 'student_club' | 'nonprofit' | 'project_team' | 'individual';

/** 示例发布者（虚构账户）。Opportunity.posted_by 指向它的 id。 */
export interface SamplePublisher {
  id: string;
  /** 名称（明显的示例名，界面标 Sample）。 */
  name: string;
  kind: PublisherKind;
  /** 一律是示例。 */
  is_sample: true;
  description?: string | null;
}

/**
 * Talent Board 的按字段授权（学生自己设置，存在浏览器本地）。
 * 默认全部不分享：数组为空、开关为 false、collaboration_note 为 null。学生可以随时撤回（改回默认）。
 * 永不包含、也永不分享：联系方式、精确位置、学校名、身份标签（StudentStatus）、私人材料（Journal 的材料与备注）。
 */
export interface ShareSettings {
  profile_id: string;
  /**
   * 对发布者显示的不透明句柄（如 `share-<uuid>`）：不含姓名、档案 id 或其片段。
   * 由 lib/store.ts 的 defaultShareSettings 生成；同一档案的句柄保存后保持不变（撤回分享也不换），
   * 邀请与屏蔽都按它关联。学生自己的浏览器里用 profileIdForShareHandle 对回档案 id。
   */
  share_handle: string;
  /** 学生选择展示的证据 id（只能是自己档案里的证据）；[] = 不展示任何证据。 */
  evidence_ids: string[];
  /** 学生选择展示的技能名（skill slug）；[] = 不展示。 */
  skills: string[];
  /** 是否展示兴趣领域。 */
  share_interests: boolean;
  /** 学生写给发布者的合作说明（如「周末有空，想做气候数据项目」）；null = 不写。 */
  collaboration_note: string | null;
  updated_on: ISODate;
}

/**
 * 发布者能看到的内容：只含学生已授权的字段，由 ShareSettings 过滤档案得到。
 * 不含显示名、学校名、联系方式、精确位置、身份标签。
 */
export interface SharedProfileView {
  /** 不透明句柄（= ShareSettings.share_handle），邀请按它指向这个学生。不含档案 id。 */
  share_handle: string;
  /** 化名，如 "Sample student"——不是真实姓名，也不是 display_name。 */
  alias: string;
  evidence: Pick<EvidenceItem, 'id' | 'title' | 'kind' | 'skills' | 'status'>[];
  skills: StudentSkill[];
  /** share_interests 为 false 时为 []。 */
  interests: string[];
  collaboration_note: string | null;
  /** 档案是否示例（示例档案界面标 Sample）。 */
  is_sample: boolean;
}

/**
 * 邀请状态：pending = 待回应；declined = 学生拒绝；accepted = 学生接受（本地示例，不发生真实联系）；
 * blocked = 学生屏蔽了该发布者，之后不再显示其邀请。
 */
export type InvitationStatus = 'pending' | 'declined' | 'accepted' | 'blocked';

/** 示例发布者发给学生的邀请（本地示例）。 */
export interface Invitation {
  id: string;
  publisher_id: string;
  /**
   * 被邀请的学生（SharedProfileView.share_handle）。发布者只知道这个句柄，不知道档案 id；
   * 学生自己的浏览器里用 profileIdForShareHandle 对回档案。
   */
  share_handle: string;
  /** 邀请参加的机会 id（通常是该发布者的 user_posted 机会）；只是交流邀请时为 null。 */
  opportunity_id: string | null;
  /** 可解释的理由（如「你展示的证据《天气数据分析》用到了 python」），不含分数或名次。 */
  reasons: string[];
  status: InvitationStatus;
  /** 一律是示例。 */
  is_sample: true;
  sent_on: ISODate;
  /** 学生回应（拒绝 / 接受 / 屏蔽）的日期；未回应为 null / 缺省。 */
  responded_on?: ISODate | null;
}
