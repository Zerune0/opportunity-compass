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
}

/**
 * 一个真实机会。
 * 底线：`data/opportunities.json` 中的每条机会必须有官方链接、核实日期和核实人，
 * 由人打开官网确认；AI 给出的机会信息不直接采用。
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
 * time_support = 时间支持（如带薪准备时间、减少打工时长的补贴）。
 */
export type SupportType = 'device' | 'transport_subsidy' | 'fee_waiver' | 'time_support';

/** 障碍类型：时间 / 费用 / 交通 / 设备。 */
export type BarrierType = 'time' | 'cost' | 'transport' | 'device';

export const BARRIER_TYPES: readonly BarrierType[] = ['time', 'cost', 'transport', 'device'] as const;

/** 每种支持默认化解哪类障碍。 */
export const SUPPORT_RESOLVES: Readonly<Record<SupportType, BarrierType>> = {
  device: 'device',
  transport_subsidy: 'transport',
  fee_waiver: 'cost',
  time_support: 'time',
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

// ───────────────────────────── 联合求解（Charles）─────────────────────────────

/**
 * 主办方可选的支持措施（what-if 场景中的决策变量 x）。
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
   * 最多可服务的**不同学生**人数（如 5 台设备 = 5），null = 不限。
   * 同一学生凭同一措施参加多个机会，只占 1 个容量。
   */
  capacity: number | null;
  /** 只对这些机会有效；缺省 = 对场景内所有机会有效。 */
  opportunity_ids?: string[];
  /** 与这些措施互斥（不能同时启用）。 */
  mutually_exclusive_with?: string[];
  /** 时间支持类措施每位学生增加的每周小时数。 */
  hours_per_week?: number | null;
  /** 交通补助 / 费用减免每位学生的额度（美元）。 */
  amount_usd?: number | null;
  /** 借设备类措施提供的设备。 */
  device?: DeviceType | null;
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
  /** 统一评估时间（docs：R0 与 R1 必须在同一评估时间和假设下比较）。 */
  evaluation_date: ISODate;
  students: StudentProfile[];
  opportunities: Opportunity[];
  /** 可选措施。 */
  interventions: Intervention[];
  /** 总预算（美元）。 */
  budget_usd: number;
  /**
   * 场景开始前已存在的 grants（计入 R0）。
   * 带 intervention_id 的已有 grant 占用该措施的容量（按不同学生计），不重复计成本：
   * 若某 (intervention_id, student_id) 已出现在 existing_grants 中（该 grant 带相同的 intervention_id），
   * 则它在本方案中的所有 Allocation 的 cost_usd 都记 0，容量也不再重复占用（已有 grant 已占 1 个）。
   */
  existing_grants?: ResourceGrant[];
}

export interface SolveOptions {
  /**
   * protect（默认）= 不允许任何原有覆盖损失（L 必须为 0）；
   * tradeoff = 允许损失，但必须给出 loss_cap。
   */
  mode?: 'protect' | 'tradeoff';
  /** tradeoff 模式下允许的最大损失 L。 */
  loss_cap?: number;
  /** 搜索上限（节点数），达到即返回 SEARCH_LIMIT_REACHED。 */
  max_search_nodes?: number;
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
 * 计量口径（容量与成本按「不同学生」计）：
 * - 同一 (intervention_id, student_id) 可以有多条 Allocation（对应不同机会）；
 * - 容量与成本按不同的 (intervention_id, student_id) 计数；
 * - 同一 (intervention_id, student_id) 的多条 Allocation 中，cost_usd 只在其中一条记
 *   unit_cost_usd，其余记 0（这样 JointCost.marginal_usd 仍等于各 Allocation 的 cost_usd 之和）；
 * - 若该 (intervention_id, student_id) 已出现在 Scenario.existing_grants 中（该 grant 带相同的
 *   intervention_id），则它在本方案中的所有 Allocation 的 cost_usd 都记 0，容量也不再重复占用
 *   （已有 grant 已占 1 个）。
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
 * 联合求解结果。字母定义出自 docs/product-scope.md「Shared constraints」：
 * 「在同一评估时间和假设下，R0 为原始覆盖，R1 为全局分配后的覆盖；
 *   报告增益 |R1 − R0|、损失 |R0 − R1|、净值 = 增益 − 损失。」
 * 这里的「覆盖」= 现实可达的学生-机会对集合，减号为集合差。
 *
 * 所有结果都是模拟，不是真实影响；界面标「模拟」。
 */
export interface JointResult extends JointPlan {
  /**
   * OPTIMAL = 找到并证明最优；INFEASIBLE = 证明无可行解（不得悄悄放松约束）；
   * SEARCH_LIMIT_REACHED = 达到搜索上限（不等于无解，也不得声称全局最优，只展示经独立复核的候选）；
   * UNSUPPORTED_INPUT = 输入超出求解器支持范围。
   */
  status: JointStatus;
  /** 原始覆盖：不做任何新措施时可达的学生-机会对。 */
  R0: CoveragePair[];
  /** 执行本方案后可达的学生-机会对。 */
  R1: CoveragePair[];
  /** 增益 G = |R1 \ R0|（新变为可达的对数）。 */
  G: number;
  /** 损失 L = |R0 \ R1|（原本可达、方案后不可达的对数；protect 模式必须为 0）。 */
  L: number;
  /** 净值 N = G − L。 */
  N: number;
  cost: JointCost;
  /** 面向界面的说明（含状态解释、mock 标记等）。 */
  notes: string[];
}

export interface VerifyCheck {
  /**
   * 检查项名称，建议取值：
   * budget / capacity / mutual_exclusion / eligibility / barrier_resolution /
   * cost_accounting / coverage_loss / allocation_validity。
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
