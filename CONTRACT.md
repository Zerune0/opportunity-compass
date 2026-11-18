# CONTRACT — Opportunity Compass 团队契约

给四位队友看的共享约定。**类型以 `lib/types.ts` 为准**；本文件与代码不一致时，以代码为准并立刻告诉主导。
产品全貌见 `docs/`；第一阶段（四天）与第二阶段的范围都以本文件为准。

---

## ① 类型一览（`lib/types.ts`）

通用：日期 `YYYY-MM-DD`；金额美元（字段带 `_usd`）；时间小时（字段带 `hours`）；技能名小写 slug（如 `python`）。
学生可能没填的字段都是可选或 `null`，**没填 = 判断返回 unknown，不猜**。

| 类型 | 用途 | 关键字段 |
|---|---|---|
| `Opportunity` | 一个真实机会 | `id`、`title`、`organizer`、`category`、`fields`、**`official_url`、`verified_on`、`verified_by`**、`deadline`（null=滚动/未写清）、`location`（`format`: online/in_person/hybrid）、`cost.fee_usd`、`time_commitment`（每周小时、周数）、`required_devices`、`requirements`、`preparation`、`is_sample` |
| `Requirement` | 一条官方要求 | `id`、`type`（grade/age/region/citizenship/status/prerequisite_skill/portfolio/manual）、该类型的规则参数（如 `min`/`max`）、`hard`（true=硬性）、`label`、**`source_text`（官网原文）**。`manual` = 机器判定不了，永远 unknown |
| `PrepItem` | 准备项（路线规划用） | `id`、`title`、`skill`、`evidence_kind`、`estimated_hours`、`estimated_cost_usd`、`depends_on`、`required_for_application` |
| `StudentProfile` | 学生档案 | `id`、**`is_sample`**、`display_name`、`grade`、`age`、`region`、`citizenships`、`statuses`、`school_name`（只展示，**任何判断不得读取**）、`hours_per_week_available`、`budget_usd`、`transport`、`devices`、`skills`、`evidence`、`interests` |
| `EvidenceItem` | 作品 / 经历证据 | `id`、`title`、`kind`、`skills`、`prep_item_ids`、`status`（self_reported / evidence_attached / reviewed / unverified；附链接 ≠ 专业认证） |
| `EligibilityResult` | 资格结果 | `overall`（eligible / not_eligible / unknown）、`items[]`：`status`（**satisfied / not_satisfied / unknown**）、`source_text`、`explanation`、`confirm_with_official`（unknown 时的「请向官方确认」提示） |
| `ResourceGrant` | 主办方已分配给某学生的资源（针对某机会，或对该学生所有机会有效） | `student_id`、**`opportunity_id`（`string \| null`：字符串 = 只对该机会有效；`null` = 对该学生的所有机会都有效，如借出的笔记本、交通卡；只有 `=== null` 才算，缺该字段的 grant 不生效；`null` 主要用于可重复使用的资源 device / time_support，按金额计的 transport_subsidy / fee_waiver 建议指定具体机会）**、`intervention_id?`（来自哪个措施，若有）、`type`（device / transport_subsidy / fee_waiver / time_support / alternative_access）、`status`（approved / pending）、`amount_usd`、`device`、`hours_per_week`、`is_sample` |
| `ReachabilityResult` | 可达性 | `eligibility`、`readiness_gaps`、`barriers[]`（`type`: time/cost/transport/device，`resolved`、`resolved_by_grant_ids`）、**`reachable`（true / false / null=信息不足）**、`missing_info`、`summary` |
| `Route` / `RouteStep` | 一条成长路线 | `type`（learning_first / practice_first / community）、`steps`（已按依赖排序；`depends_on`、`hours`、`cost_usd`、`skipped`、`skip_reason`）、`total_hours`、`total_cost_usd`、`feasible_by_deadline`（true/false/null）、`rationale`、`warnings` |
| `PlanResult` | `planRoutes` 的返回 | `status: 'routes'` → `routes`（2–3 条）；`status: 'blocked'` → `routes: []` + `blocking_requirements`、`reasons`、`alternatives`（下一届 / 同领域替代） |
| `RouteDiff` | 两次规划的变化 | `status_change`、`route_changes[]`（新增 / 移除 / 新跳过 / 取消跳过的步骤，小时与费用变化）、**`reasons`（为什么变）** |
| `SupportType` | 支持 / 资源类型（grant 与措施共用） | `device`、`transport_subsidy`、`fee_waiver`、`time_support`、**`alternative_access`**（替代参与方式，如线上参与入口、卫星会场，让学生不必前往主会场；与 `transport_subsidy` 同等化解 transport 障碍） |
| `Scenario` | 主办方 what-if 场景（一律示例/模拟） | `students`、`opportunities`、`interventions`、`budget_usd`、`evaluation_date`、`existing_grants`（`id` 必须唯一；带 `intervention_id` 的已有 grant 不论 status 都占用该措施的容量，按不同学生计；只有 **approved** 的已有 grant 让同一 (措施, 学生) 的分配免成本；`intervention_id` 指向场景内措施的 grant **可被方案撤回**，撤回后不计入 R1、不占容量、不免成本）、`opportunity_time_slots?`（机会 id → 非空字符串时段标签；未列出的机会归入同一个默认时段） |
| `Intervention` | 可选支持措施 | `type`、`resolves`（障碍类型，仅展示）、`unit_cost_usd`（每服务一位**不同学生**的边际成本）、`fixed_cost_usd`（只计一次）、`capacity`（最多可服务的**不同学生**人数；null 或缺省 = 不限）、`amount_usd?` / `hours_per_week?`（给出时须非负）、`opportunity_ids?`、`mutually_exclusive_with`、`status?`（approved / pending，缺省 approved）、`requires?`（前置依赖）、`capacity_scope?`（total / per_time_slot，缺省 total）。同一学生凭同一措施参加多个机会，只占 1 个容量、只计一次成本 |
| `SolveOptions` | `solveJoint` 的可选第二参数 | `mode?`（protect = 默认保护模式，L = 0 且不撤回任何已有 grant；tradeoff = 权衡分析模式，允许撤回，L ≤ `loss_cap`）、`loss_cap?`、`max_search_nodes?`、`required_intervention_ids?`、`min_gain?`、`fairness_floors?`（后三项是主办方的**软要求**） |
| `FairnessFloor` | 公平底线（软要求） | `id`、`label`、`basis`（分组依据，必填）、`statuses_any_of`（按学生自己声明的 `statuses` 定义群体）、`min_ratio`（0–1） |
| `FairnessReport` | 一条底线在某方案下的结果 | `floor_id`、`eligible_members`（分母：群体中至少对一个机会资格 eligible 的学生）、`covered_members`（分子：其中至少有一个对在 R1 的学生）、`ratio`（分母为 0 时 null = 不适用）、`min_ratio`、`satisfied` |
| `Allocation` | 一次资源分配（某措施用于某学生的某机会） | `intervention_id`、`student_id`、`opportunity_id`、`cost_usd`。同一 (`intervention_id`, `student_id`) 可有多条（对应不同机会）；容量与成本按不同的 (`intervention_id`, `student_id`) 计数；其中只有一条的 `cost_usd` 记 `unit_cost_usd`，其余记 0；若该 (`intervention_id`, `student_id`) 已出现在 `existing_grants` 中（grant 带相同 `intervention_id`），容量不再重复占用（已有 grant 已占 1 个，不论 status）；若该 grant 为 **approved**，其所有 `Allocation` 的 `cost_usd` 还都记 0（pending 的不免成本） |
| `JointPlan` | 候选方案（`verifyPlan` 的输入） | `selected_intervention_ids`、`allocations`、`revoked_grant_ids?`（撤回的已有 grant，只在 tradeoff 模式下允许非空；选中与措施 k 互斥的措施时，k 的已有 grant 必须全部撤回，因此 protect 模式下不能选中这样的措施） |
| `GrantRevocation` | 一条撤回明细 | `grant_id`、`intervention_id`、`student_id`、`forced_by`（导致强制撤回的选中措施 id；自愿撤回为 null） |
| `JointOutcome` | 一个方案的结果指标（不含状态） | `JointPlan` 字段 + `R1`、`G`、`L`、`N`、`cost`；新增可选 `lost_pairs?`（R0 \ R1）、`revocations?`、`fairness?`（求解器返回时必须给出前两项；给了底线时给出 `fairness`） |
| `SoftRequirementKey` | 可被整项放松的软要求 | `min_gain` / `fairness_floors` / `required_intervention_ids`；常量 `SOFT_REQUIREMENT_RELAX_ORDER` 是固定优先级 |
| `JointAlternative` | INFEASIBLE 时只放松软要求后的替代方案 | `JointOutcome` 字段 + `relaxed`（`SoftRequirementKey[]`：放松了 `min_gain` / `fairness_floors` / `required_intervention_ids` 中的哪些）、`note` |
| `JointConditional` | 条件性结果（「如果这些 pending 措施获批，则……」，未生效） | `JointOutcome` 字段 + `status`、`assumed_approved_intervention_ids`、`note` |
| `JointResult` | 联合求解结果（`extends JointOutcome`，原有字段不变） | `status`（OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT）、`selected_intervention_ids`、`allocations`、`R0`、`R1`、`G`、`L`、`N`、`cost`（`marginal_usd` = 各 Allocation 的 `cost_usd` 之和）、`notes`；新增可选 `alternative?`、`conditional?`、`verification?` |
| `EvalOptions` | `checkEligibility` / `analyzeReachability` / `planRoutes` 的可选末位参数 | `today?: ISODate`（评估基准日；不传时不读系统时间，依赖日期的判断按信息不足处理） |
| `VerifyOptions` | `verifyPlan` 的可选第三参数（已确认保留） | `mode`、`loss_cap`（均可选，类型同 `SolveOptions`）；复核损失时用，不传按 protect 处理（损失必须为 0）；`mode: 'tradeoff'` 但没给 `loss_cap` 时判为不通过。新增可选 `assume_approved_intervention_ids?`（复核条件性方案时把这些 pending 措施当作已批准）、`required_intervention_ids?`、`min_gain?`、`fairness_floors?`（与 `SolveOptions` 同义，传了才检查） |
| `VerifyResult` | 独立复核 | `passed`、`checks[]`（`name`、`passed`、`detail`）；`capacity` / `cost_accounting` 按 `Allocation` 的口径复核（按不同 (`intervention_id`, `student_id`) 计）；检查项名称见「联合求解模型」（新增 `revocation`、`fairness`） |
| `BaselineId` / `BaselineRow` / `BaselineMetrics` / `BaselineComparison` | 基线对比（`compareBaselines` 的返回） | 行 `A_eligibility_only` / `B_student_side` / `C_organizer_side` / `joint`：`label`、`description`、`claimed_reachable`（自称）、`plan`、`verification`（同一验证器复核）、`verified`（可执行时的独立重算指标，否则 null）、`soft_requirements_met`、`repaired`（先到先得截断后的指标）；`notes` |

`R0 / R1 / G / L / N`（出自 `docs/product-scope.md` Shared constraints）：在同一评估时间和假设下，
`R0` = 原始覆盖（不加新措施时现实可达的学生-机会对集合），`R1` = 全局分配后的覆盖；
`G = |R1 \ R0|`（增益），`L = |R0 \ R1|`（损失），`N = G − L`（净值）。默认 protect 模式要求 `L = 0`，并且**不动任何已有承诺**（不允许撤回任何已有 grant）；tradeoff 模式必须显式给 `loss_cap`，允许撤回，且 `L ≤ loss_cap`。不撤回任何已有 grant 时 `L` 恒为 0，`L > 0` 只可能来自撤回。

常量：`ELIGIBILITY_STATUSES`、`BARRIER_TYPES`、`ROUTE_TYPES`、`JOINT_STATUSES`、`SUPPORT_RESOLVES`（支持类型 → 化解的障碍类型）、`STUDENT_STATUSES`（`StudentStatus` 的全部取值）、`SOFT_REQUIREMENT_RELAX_ORDER`。

### 第二阶段新增类型（全部向后兼容：新类型、新的可选字段、只读常量；现有字段不改名、不删除、不改类型）

| 类型 | 用途 | 关键字段 |
|---|---|---|
| `SourceTier`；`Opportunity.source_tier` / `posted_by` | 机会信息的来源等级 | 取值 `official`（由人打开主办方官网核实）/ `trusted_aggregator`（可信的机会汇总站，仍以官网为准）/ `user_posted`（用户发布，本阶段只来自 Connect 的本地示例）。`Opportunity.source_tier?` 缺省按 `'official'` 处理，读取时写 `opp.source_tier ?? 'official'`；`Opportunity.posted_by?: string \| null` = user_posted 时为 `SamplePublisher.id`，其他等级为 null 或缺省。**user_posted 的机会必须同时 `is_sample: true`**，它的 `verified_on` / `verified_by` 只记录发布日期与示例发布者，界面不得显示为「已核实」 |
| `MaterialKind`；`PrepItem.material_kind` / `reusable_across_opportunities` | 申请材料种类 | 取值 `resume` / `transcript` / `personal_statement` / `recommendation_letter` / `portfolio` / `essay` / `other`。`PrepItem.material_kind?: MaterialKind \| null`（null / 缺省 = 这个准备项不是材料）；`PrepItem.reusable_across_opportunities?: boolean \| null`（true = 通用材料，联合规划时只算一次；false = 针对每个机会单独准备；null / 缺省按 false 处理，不确定时不假设省时间） |
| `GapCategory` | 差距五类 | `knowledge_or_experience`（知识或经验）/ `materials`（材料）/ `time_and_cost`（时间和成本）/ `unchangeable_eligibility`（当前不可改变的资格限制）/ `unknown_info`（未知信息）；常量 `GAP_CATEGORIES` 是固定顺序（也是界面展示顺序） |
| `GapBasis` | 一条差距的依据（判别联合，判别字段 `kind`） | `{ kind: 'requirement', requirement_id, source_text }` / `{ kind: 'prep_item', prep_item_id, source_text: string \| null }` / `{ kind: 'barrier', barrier_type }` / `{ kind: 'missing_field', field }`（`field` 的写法与 `missing_info` 一致，如 `profile.devices`） |
| `GapItem` | 一条差距 | `id`（结果内唯一且稳定，形如 `materials:prep-resume`）、`category`、`title`、`detail`、`basis`、`improvable`、**`action`（`string \| null`；`improvable` 为 false 时为 null；`unchangeable_eligibility` 一律为 null）**、`estimated_hours?`、`estimated_cost_usd?`（不适用或不知道为 null） |
| `GapAnalysis` | `analyzeGaps` 的返回 | `profile_id`、`opportunity_id`、`items`（先按 `GAP_CATEGORIES` 分组，组内按机会里的原顺序）、`counts`（`Record<GapCategory, number>`，五个键都有）、`eligibility_overall`、`reachable`（语义同 `ReachabilityResult.reachable`）、`summary` |
| `AlternativeSuggestion` | `findAlternatives` 返回数组中的一条 | `kind`（`next_cycle` = 等下一届 / `same_field` = 同领域的其他机会）、`opportunity_id`（`string \| null`；same_field 为目录中那个机会，next_cycle 指原机会）、`title`、`reason`、`eligibility_overall`（`OverallEligibility \| null`；same_field 不会是 `not_eligible`；next_cycle 通常为 null）、`shared_fields`（与原机会共有的领域标签，按 `normalizeTag` 比较，用建议机会原本的写法；next_cycle 为原机会的全部 `fields`）。给了 `options.today` 时 same_field 不含截止日期已过的机会 |
| `MatchReasonKind` / `MatchReason` | 一条匹配理由 | `kind`：`interest` / `eligibility` / `reachability` / `format` / `time` / `cost`（常量 `MATCH_REASON_KINDS`）；`positive`（true = 有利 / false = 不利 / null = 信息不足，不猜）、`text` |
| `MatchExplanation` | `explainMatch` 的返回 | `profile_id`、`opportunity_id`、`reasons`（按 `MATCH_REASON_KINDS` 顺序）、`eligibility_overall`、`reachable`、`shared_interests`（`profile.interests ∩ opp.fields`，按 `normalizeTag` 比较，用机会原本的写法、按 `opp.fields` 顺序；兴趣没填时为 `[]`）、`summary`。**没有任何分数、百分比或名次字段** |
| `MatchOptions` | `explainMatch` 的可选第三参数（`extends EvalOptions`） | `today?`；`grants?: ResourceGrant[]`（主办方已分配给该学生、对这个机会生效的资源，与 `analyzeGaps` 的 `grants` 同义；缺省 = `[]`）。同一页面同时显示 `analyzeGaps` 时传同一组 grants，两者的 `reachable` 才一致 |
| `CrossPlanItem` | 联合规划中的一个机会 | `opportunity_id`、`title`、`deadline`、`status`（`planned` / `blocked` / `past_deadline` / `insufficient_data`；后三者小时为 0、不计入负荷；`insufficient_data` = 机会数据不完整、规划时出错，仍列在 `items` 里，`note` 说明缺什么，同时写进 `warnings` 与 `missing_info`）、`route_type`（`RouteType \| null`；非 planned 为 null）、`required_hours`（计入材料复用后：可复用材料只算在 `order` 最靠前的机会上，按 `hours_each` 计，所以承担者的 `required_hours` 可能大于它的 `hours_before_reuse`）、`hours_before_reuse`（不考虑复用时自己需要的小时）、`hours_saved_by_reuse`（因材料已由更靠前的机会承担而少算的小时，≥ 0；承担者为 0）、`weeks_left`（`number \| null`）、`feasible_alone`（`boolean \| null`，口径见「第二阶段新函数」中 `planAcrossOpportunities`）、`order`（1 起，按截止日期；只是建议）、`note`。非 planned 时三个小时字段都为 0 |
| `MaterialReuse` | 一类材料在多个机会之间的复用情况 | `material_kind`、`reusable`、`opportunity_ids`、`hours_each`（各机会该材料小时数的最大值）、`hours_saved`（reusable 时 = 各机会之和 − `hours_each`；不可复用时为 0）、`note` |
| `WeeklyLoad` | 某一周的负荷（按天分摊） | `week_start`（该周周一）、`days`（该周落在计划窗口里的天数，1–7：第一周从 today 算起，最后一周算到计入负荷的机会中最晚的截止日）、`hours_needed`（各机会每天分摊小时 × 该机会在本周的天数，求和）、`hours_available`（`number \| null`；= `hours_per_week_available × days / 7`，即按该周落在计划窗口内的天数折算后的小时；没填为 null）、`over`（`boolean \| null`；`hours_available` 为 null 时为 null）、`opportunity_ids` |
| `CrossPlan` | `planAcrossOpportunities` 的返回 | `profile_id`、`evaluated_on`（`ISODate \| null`）、`items`（按 `order` 升序）、`weekly_load`、`reuse`、`total_hours`、`total_hours_without_reuse`（两者只算 planned 的机会，差 = 复用省下的小时）、`conflicts`、`warnings`、`missing_info` |
| `CrossPlanOptions` | `planAcrossOpportunities` 的可选末位参数（`extends EvalOptions`） | `today?`；`priorities?: string[]`（学生自己给的优先顺序，只用于冲突说明里的对照，不改变 `order`，也不代表系统建议放弃其他机会） |
| `JournalApplicationStatus` / `EligibilityConfirmation` / `JournalDecision` | Quest Journal 的三项独立状态（学生自己记录，不是系统判断） | `JournalApplicationStatus`：`preparing` / `submitted` / `withdrawn`（学生的申请进度）；`EligibilityConfirmation`：`unconfirmed` / `confirmed` / `rejected`（官方是否确认了资格）；`JournalDecision`：`pending` / `admitted` / `not_admitted`（官方录取结果）。连同 `JournalEntry.participated`，**四项互相独立：提交 ≠ 官方确认资格 ≠ 被录取 ≠ 已参与**，界面分开显示，不能互相推断 |
| `JournalEvent` / `JournalHistoryItem` | Journal 事件与事件记录 | `JournalEvent`（常量 `JOURNAL_EVENTS`）：`added`（创建条目时记录，不改其他字段）/ `submitted`（`application = 'submitted'`，`submitted_on` = 当天）/ `withdrawn`（`application = 'withdrawn'`，`submitted_on` 保留）/ `reopened`（`application` 回到 `'preparing'`，`submitted_on = null`）/ `eligibility_confirmed` / `eligibility_rejected`（`eligibility_confirmation` = `'confirmed'` / `'rejected'`）/ `admitted` / `not_admitted`（`decision`）/ `participated` / `did_not_participate`（`participated` = true / false）。`JournalHistoryItem` = `{ event, on }` |
| `JournalTask` | Journal 里的一条任务 | `id`、`title`、`prep_item_id?`、`done`、`done_on?` |
| `Material`（`MaterialStatus`） | 一份申请材料（单独存放，Journal 条目用 `material_ids` 引用） | `id`（全局唯一）、`profile_id`（属于哪个档案）、`kind`（`MaterialKind`）、`title`、`reusable`、`opportunity_id`（`string \| null`；通用材料为 null）、`prep_item_id?`、`estimated_hours`（`number \| null`）、`status`（`not_started` / `in_progress` / `ready`，常量 `MATERIAL_STATUSES`）。可复用材料被多个条目引用时是同一条记录：改一次状态，所有引用它的条目都看到 |
| `OutcomeFeedback` | 学生自愿记录的主观反馈 | 全部可缺（缺省 / null = 没记）：`discovered_new_opportunity?`、`understood_eligibility?`、`completed_materials?`、`helpful_note?`、`recorded_on?`。是否提交、是否参与以 `JournalEntry` 的 `application` / `participated` 为准，这里不重复。不是系统判断，也不是真实影响的证据 |
| `JournalEntry` | Quest Journal 的一个条目（一个档案 × 一个机会，存在浏览器 localStorage；唯一键 (`profile_id`, `opportunity_id`)） | `id`（全局唯一）、`profile_id`、`opportunity_id`、`added_on`、`application`（`JournalApplicationStatus`）、`submitted_on`（`ISODate \| null`；最近一次提交的日期）、`eligibility_confirmation`（`EligibilityConfirmation`）、`decision`（`JournalDecision`）、`participated`（`boolean \| null`；null = 还没发生 / 没记录）、`history`（`JournalHistoryItem[]`，按记录先后，通常第一项是 `added`；同一事件同一天只记一次）、`route_type?`、`tasks`、`material_ids`（引用同一档案的 `Material.id`）、`official_url`（不完成任何任务也能直接去官方申请）、`notes?`、`outcome?` |
| `PlanTrigger` | 触发一次重新规划的原因 | `initial` / `evidence_added` / `evidence_removed` / `evidence_edited` / `profile_edited` / `manual`（常量 `PLAN_TRIGGERS`） |
| `PlanSnapshot`（`PlanSnapshotInputs`） | 一次规划的快照（回放用） | `id`、`profile_id`、`opportunity_id`、`taken_on`、`plan`（当时 `planRoutes` 的完整结果）、`inputs`（`evidence_ids`、`hours_per_week_available`、`budget_usd`、`grade`、`today`、`changed_fields?`：触发原因为 `profile_edited` 时改了哪些档案字段，如 `['grade', 'hours_per_week_available']`，其他情况缺省）、`trigger`、`trigger_detail?`。回放取同一档案、同一机会相邻的两个快照，用 `diffRoutes(before.plan, after.plan)` 得到变化与原因 |
| `SamplePublisher`（`PublisherKind`） | Connect 的示例发布者（虚构账户） | `id`、`name`、`kind`（`research_group` / `student_club` / `nonprofit` / `project_team` / `individual`）、`is_sample: true`、`description?` |
| `ShareSettings` | Talent Board 的按字段授权（学生自己设置，存在浏览器本地） | `profile_id`、`share_handle`（对发布者显示的不透明句柄，如 `share-<uuid>`，不含姓名、档案 id 或其片段；由 `defaultShareSettings` 生成，同一档案保存后保持不变、撤回分享也不换；邀请与屏蔽都按它关联）、`evidence_ids`、`skills`、`share_interests`、`collaboration_note`（`string \| null`）、`updated_on`。默认全部不分享，可随时撤回；联系方式、精确位置、学校名、身份标签、私人材料永不分享 |
| `SharedProfileView` | 发布者能看到的内容（只含已授权字段） | `share_handle`（= `ShareSettings.share_handle`；**不含档案 id**）、`alias`（化名，不是 `display_name`）、`evidence`（只含 `id` / `title` / `kind` / `skills` / `status`）、`skills`、`interests`（`share_interests` 为 false 时为 `[]`）、`collaboration_note`、`is_sample` |
| `Invitation`（`InvitationStatus`） | 示例发布者发给学生的邀请（本地示例，不发生真实联系） | `id`、`publisher_id`、`share_handle`（被邀请学生的 `SharedProfileView.share_handle`；发布者只知道句柄，不知道档案 id，学生自己的浏览器里用 `profileIdForShareHandle` 对回档案）、`opportunity_id`（`string \| null`）、`reasons`（可解释的理由，不含分数或名次）、`status`（`pending` / `declined` / `accepted` / `blocked`）、`is_sample: true`、`sent_on`、`responded_on?` |

第二阶段新增常量：`SOURCE_TIERS`、`MATERIAL_KINDS`、`MATERIAL_STATUSES`、`GAP_CATEGORIES`、`MATCH_REASON_KINDS`、`JOURNAL_EVENTS`、`PLAN_TRIGGERS`（都从 `@/lib/types` 导入；`lib/validation.ts` 里有同名的 `SOURCE_TIERS` / `MATERIAL_KINDS` 校验用常量，页面不要从那里导入）。

**领域标签的比较**：`Opportunity.fields` 与档案的 `interests` 比较时一律用 `lib/tags.ts` 的 `normalizeTag`（去首尾空格、转小写，连续的空白 / 下划线 / 连字符合并成一个下划线，所以 `Data-Science`、`data science`、`data_science` 视为同一标签）；页面做领域筛选、兴趣匹配时也必须用它（或 `normalizedTagSet` / `sharedTags`），不要自己写 `===`。归一化只用于比较，给学生看的标签保留数据原本的写法。数据里推荐统一写成小写加下划线。

---

## ② 十个共享函数（第一阶段六个 + 第二阶段四个）

全部是 `lib/` 下的**纯函数**：确定性、无 IO、不读 localStorage、不调 AI。AI 不参与资格判断、路线规划和求解。

| 函数 | 位置 | 签名 | 状态 |
|---|---|---|---|
| `checkEligibility` | `lib/eligibility` | `(profile: StudentProfile, opp: Opportunity, options?: EvalOptions) => EligibilityResult` | 已实现 |
| `analyzeReachability` | `lib/reachability` | `(profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[], options?: EvalOptions) => ReachabilityResult` | 已实现 |
| `planRoutes` | `lib/path` | `(profile: StudentProfile, opp: Opportunity, options?: EvalOptions) => PlanResult` | 已实现 |
| `diffRoutes` | `lib/path` | `(before: PlanResult, after: PlanResult) => RouteDiff` | 已实现 |
| `solveJoint` | `lib/joint`（主办方端与 Connect 负责人） | `(scenario: Scenario, options?: SolveOptions) => JointResult` | 已实现（精确搜索，含撤回 / 权衡模式 / 公平底线，见「联合求解模型」） |
| `verifyPlan` | `lib/joint`（主办方端与 Connect 负责人） | `(scenario: Scenario, plan: JointPlan, options?: VerifyOptions) => VerifyResult` | 已实现（独立复核，不 import 求解器；含第 3 层的 `revocation` / `fairness` 检查） |
| `analyzeGaps` | `lib/gap`（第二阶段） | `(profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[], options?: EvalOptions) => GapAnalysis` | 示例版本（签名为最终版；第 1 层替换为完整实现） |
| `findAlternatives` | `lib/match`（第二阶段） | `(profile: StudentProfile, opp: Opportunity, catalog: Opportunity[], options?: EvalOptions) => AlternativeSuggestion[]` | 示例版本（签名为最终版；第 1 层替换为完整实现） |
| `planAcrossOpportunities` | `lib/planner`（第二阶段） | `(profile: StudentProfile, opps: Opportunity[], options?: CrossPlanOptions) => CrossPlan` | 示例版本（签名为最终版；第 2 层替换为完整实现） |
| `explainMatch` | `lib/match`（第二阶段） | `(profile: StudentProfile, opp: Opportunity, options?: MatchOptions) => MatchExplanation` | 示例版本（签名为最终版；第 2 层替换为完整实现） |

第 3 层新增（不属于上表的共享函数）：`compareBaselines`（`lib/joint/baselines.ts`）`(scenario: Scenario, options?: SolveOptions) => BaselineComparison`，已实现（A / B / C / joint 四行；基线 D 未实现），规则见「联合求解模型」第 10 条。`solveJoint` 的撤回、权衡模式、公平底线与新目标顺序均已实现。

`VerifyOptions = { mode?: 'protect' | 'tradeoff'; loss_cap?: number; assume_approved_intervention_ids?: string[]; required_intervention_ids?: string[]; min_gain?: number; fairness_floors?: FairnessFloor[] }`（字段类型沿用 `SolveOptions`）。**第三参数确定保留，为可选**：复核损失 `L` 时需要知道模式与损失上限。不传（或不给 `mode`）按 protect 处理，即损失 `L` 必须为 0；`mode: 'tradeoff'` 时 `L ≤ loss_cap` 才算通过；`mode: 'tradeoff'` 但没给 `loss_cap` 时 `verifyPlan` 判为不通过（与 `solveJoint` 在同样输入下返回 `UNSUPPORTED_INPUT` 一致）。

导入：`import { checkEligibility } from '@/lib/eligibility'`，类型 `import type { Opportunity } from '@/lib/types'`；第二阶段：`import { analyzeGaps } from '@/lib/gap'`、`import { explainMatch, findAlternatives } from '@/lib/match'`、`import { planAcrossOpportunities } from '@/lib/planner'`。

第二阶段的辅助纯函数（不属于上表的共享函数，页面可以直接用）：
- `lib/tags.ts`：`normalizeTag(s: string): string`（`' Data-Science '` → `'data_science'`）；`normalizedTagSet(tags: readonly unknown[]): Set<string>`（跳过非字符串与归一化后为空的项）；`sharedTags(tags: readonly string[], against: ReadonlySet<string>): string[]`（`tags` 中归一化后在 `against` 里的项，保留原写法与顺序，归一化后重复的只留第一个）。
- `lib/journal.ts`：`isJournalEvent(v: unknown): v is JournalEvent`；`applyJournalEvent(entry: JournalEntry, event: JournalEvent, on: ISODate): JournalEntry`（返回新对象，按 `JournalEvent` 更新对应字段并追加 `history`，同一事件同一天不重复追加；页面一般不直接调用，用 `recordJournalEvent`）；`journalHeadline(entry: JournalEntry): string`（列表用的一句英文摘要，由四项派生，只说学生记录了什么）。
**现有参数不会删改；如需扩展，只在末位新增可选参数（向后兼容，见文末「变更记录」），其余只换实现**。第一阶段的六个共享函数都已是真实实现；第二阶段的四个函数目前是示例版本，换成完整实现时签名与返回类型不变，页面不用改。

### 第二阶段新函数：现在的示例版本做了什么、还没做什么

四个示例版本都是纯函数：只读传入的参数，日期只来自 `options.today`（不读系统时钟），无随机、无 IO、不调 AI，**永不抛异常**（数据不完整时返回「信息不足」形式的结果）；都不读取 `school_name`、`display_name`（只改这两项，结果完全不变，有对照测试 `lib/fairness-p2.test.ts`）。示例版本的内容是简化的，但不编造：只整理已有引擎（`checkEligibility` / `analyzeReachability` / `planRoutes`）的结论。

**`analyzeGaps`**（`lib/gap/index.ts`）
- 内部调用 `analyzeReachability(profile, opp, grants, options)`，按它的结论归类，不发明新规则。
- 资格项（按 `opp.requirements` 顺序），逐条归类：
  - status 为 `not_satisfied` 且类型为 `portfolio` → `materials`（`improvable: true`，行动是准备作品并在 Skill Passport 记录证据；硬性与偏好都列，`detail` 写明是否影响资格）；
  - status 为 `not_satisfied` 且类型为 `prerequisite_skill` → `knowledge_or_experience`（`improvable: true`，行动是补这项技能并更新技能或证据；硬性与偏好都列，`detail` 写明是否影响资格）；
  - status 为 `not_satisfied`、**硬性**、类型是其他（实际只可能是 `grade` / `age` / `region` / `citizenship` / `status`，因为 `manual` 永远是 unknown）→ `unchangeable_eligibility`：`improvable: false`、**`action: null`**，只给原因与官网原文；
  - status 为 `not_satisfied`、非硬性（偏好）、类型是上一款那几类 → 不列（偏好不影响资格）；
  - status 为 `unknown`（硬性与偏好都列，含 `manual`）→ `unknown_info`，行动是该项的「向官方确认」提示。
- 准备差距（`readiness_gaps`，按 `opp.preparation` 顺序）：准备项有 `material_kind` → `materials`，否则 → `knowledge_or_experience`；行动是「完成该准备项并在 Skill Passport 记录证据」；`estimated_hours` / `estimated_cost_usd` 来自准备项。
- 未化解的障碍（`resolved: false`）→ `time_and_cost`，按 `BARRIER_TYPES` 顺序；「已过截止日期」不可改善（`improvable: false`、`action: null`），其余给一条通用但真实的行动（向主办方询问时间支持 / 费用减免 / 线上参与或交通支持 / 借用设备）；有 pending grant 时在 `detail` 里注明「若获批可能有帮助（pending ≠ approved）」。
- `missing_info` 中的**每个字段各一条** `unknown_info`（`basis.kind = 'missing_field'`；`profile.*` → 去 Skill Passport 补填；`options.today` → 页面会补上日期；其余 `opportunity.*` → 看官网或问主办方），不合并成一句笼统的话。
- `id` 形如 `<category>:<依据 id>`；万一重复，依次加 `#2`、`#3`，保证结果内唯一且稳定。
- 还没做：不区分「会随时间改善」的阻断（如年级低于下限，明年可能满足），一律归入 `unchangeable_eligibility`（「本届」不可改变是真的）；行动建议是通用句子，没结合具体缺口数值与路线步骤；非准备项差距的小时 / 费用为 null；机会数据缺关键字段导致引擎出错时，只返回一条笼统的 `unknown_info`（`basis.field = 'opportunity'`），最终版会逐字段列出。

**`findAlternatives`**（`lib/match/index.ts`）
- 只从传入的 `catalog` 里找，不编造机会。
- `next_cycle`：仅当 `opp.recurring_annually === true` 时给一条（`opportunity_id` = 原机会 id，`eligibility_overall: null`，`shared_fields` = 原机会全部 `fields`）；理由文字不承诺下一届能申请。
- `same_field`：`catalog` 中与 `opp.fields` 有交集（按 `normalizeTag` 比较，`shared_fields` 用候选机会原本的写法）、id 不是原机会、`checkEligibility(...).overall !== 'not_eligible'`、并且（**给了 `options.today` 时**）截止日期没过的机会（截止日期为 null = 滚动招生，保留；截止日期无法解析的也保留；没给 `today` 时不按截止日期过滤）；目录内重复 id 只取第一条，没有 id、数据不完整、判断出错的跳过；按 id 排序，最多 3 条。`user_posted` 的机会在 `reason` 里注明是示例发布、未经官网核实。
- 还没做：`next_cycle` 不判断阻断原因「是否会随时间改善」（最终版收紧为只在会改善时给出）；`same_field` 不看现实可达性、不按兴趣进一步筛选。

**`planAcrossOpportunities`**（`lib/planner/index.ts`）
- 机会去重（同 id 只取第一条；非对象 / 无 id 的跳过并写进 `warnings`）；每个机会调用 `planRoutes`：
  - `blocked` → `status: 'blocked'`、小时为 0、`route_type: null`，`note` 用 `planRoutes` 的第一条原因；
  - 否则按 `today` 截止已过 → `past_deadline`、小时为 0、`route_type: null`、`feasible_alone: false`；
  - 否则 `planned`：取第一条路线（learning_first），`hours_before_reuse` = 该路线未跳过步骤的小时合计（= `route.total_hours`）；
  - `planRoutes` 因数据不完整出错 → `status: 'insufficient_data'`（小时为 0、`route_type: null`、`feasible_alone: null`，`note` 说明缺什么），**仍列在 `items` 里**，同时写进 `warnings` 与 `missing_info`（`opportunity.<id>`）。
- `order`：按截止日期升序，无截止日期（或无法解析）的排最后，同日期按输入顺序；`items` 按 `order` 排列。
- 材料复用：只看 planned 机会第一条路线里未跳过、且对应准备项 `material_kind` 非空的步骤。`reusable_across_opportunities === true` 的同类材料被 ≥ 2 个机会用到 → 一条 `reusable: true`，`hours_each` = 各机会该材料小时的最大值，`hours_saved` = 各机会之和 − `hours_each`；这份材料只算在 `order` 最靠前的机会上（按 `hours_each` 计，所以它的 `required_hours` 可能大于 `hours_before_reuse`），其他机会的 `required_hours` 减去自己那份，并把这份计入 `hours_saved_by_reuse`。其余（不可复用 / 未标明）的同类材料被 ≥ 2 个机会用到 → 一条 `reusable: false`、`hours_saved: 0` 的说明。
- `weekly_load`（**按天分摊**，需要 `options.today`）：设 H = `profile.hours_per_week_available`。
  - 每个 planned 且 `required_hours > 0` 的机会：D = today（含）到截止日（含）的天数，每天分摊 = `required_hours / D`；它在某周的小时 = 每天分摊 × 它落在该周的天数；各机会按周一对齐求和得到 `hours_needed`。
  - 计划窗口 = today（含）到计入负荷的机会中最晚的截止日（含）；`days` = 该周落在窗口里的天数（1–7）；`hours_available = H × days / 7`；`over = hours_needed > hours_available`（H 没填时两者为 null，并写进 `missing_info` 的 `profile.hours_per_week_available`）。没有任何机会投入的周不列出。
  - 没有截止日期（或无法解析）的 planned 机会不进 `weekly_load`，写进 `missing_info`（`opportunity.<id>.deadline`）。
  - `over: true` 的周生成一条 `conflicts`；给了 `options.priorities` 时再说明「这一周只保留前几个优先项时需要多少小时」，只做对照，不替学生取舍。
- `feasible_alone`（planned 时）= `hours_before_reuse ≤ H × D / 7`（不考虑复用；D 同上）；today、截止日期或 H 缺失时为 null。只有一个机会时，某周 `over` 为 true ⇔ 该机会 `feasible_alone` 为 false，两者一致。**注意**：第一阶段 `planRoutes` 的 `Route.feasible_by_deadline` 按「today 到截止日的天数差」（不含 today 当天）计，两者在临界日可能不同；**联合规划页以 `feasible_alone` 为准**。
- `total_hours` / `total_hours_without_reuse` 只算 planned 的机会。
- 还没做：只按 learning_first 路线（含建议项）计小时，不在多条路线间挑选，也不算「只做必需项」的最低负荷；每周负荷是按天平均摊开的粗略估计，不考虑步骤依赖顺序与参与期本身的每周投入（`time_commitment`）；材料复用只按 `material_kind` 粗分（同类即视为同一份）；优先项对照只按周计算。

**`explainMatch`**（`lib/match/index.ts`）
- 理由只来自三件事，按 `MATCH_REASON_KINDS` 顺序输出 `interest`、`eligibility`、`reachability` 三条。
- `interest`：`profile.interests ∩ opp.fields`（按 `normalizeTag` 比较：去首尾空格、不区分大小写、空格 / 下划线 / 连字符视为同一写法；`shared_interests` 保留机会里的原顺序与原写法）。兴趣没填或机会没有领域标签 → `positive: null`；有交集 → true；都填了但没交集 → false。
- `eligibility`：`checkEligibility` 的 `overall`：eligible → true，not_eligible → false（列出不满足的硬性要求），unknown → null（列出待确认的硬性要求）。
- `reachability`：`analyzeReachability(profile, opp, options.grants ?? [], { today })` 的 `reachable` 与 `summary`。**页面上同时显示 `analyzeGaps` 时请给两者传同一组 grants**，两者的 `reachable` 才一致。
- 机会数据不完整导致引擎出错时：`eligibility_overall: 'unknown'`、`reachable: null`，两条理由都是 `positive: null`。
- 还没做：`format` / `time` / `cost` 三类理由（最终版从障碍里拆出单独理由）。

**页面必须遵守的约定**
- **`explainMatch` 不输出分数、百分比或名次，不得用它（或拼出的任何数字）给学生排名**；页面也不要从理由条数推算分数。
- **`unchangeable_eligibility` 的条目没有 action（恒为 null）**，页面不得自行补「绕过」建议；只显示原因与官网原文（可以并列显示 `findAlternatives` 的结果）。
- **`findAlternatives` 的 `same_field` 不会返回该学生硬性资格不满足（`not_eligible`）的机会**；`eligibility_overall` 为 `'unknown'` 的建议要显示为 `Unknown` 并提示向官方确认，不能显示成符合资格。
- **`planAcrossOpportunities` 不替学生取舍**：只摆出截止日期、每周负荷、冲突、复用与省下的小时；`order` 只是按截止日期的建议，页面不得写成「建议放弃某个机会」。`insufficient_data` 的条目要照常列出并显示它的 `note`，不能从页面上消失；判断「来得及吗」用 `feasible_alone`，不要另用 `planRoutes` 的 `feasible_by_deadline`。
- **领域标签一律用 `normalizeTag` 比较**（见「① 类型一览」第二阶段一节末尾），页面的领域筛选也一样。
- **Quest Journal**：
  - 申请（`application`）、官方资格确认（`eligibility_confirmation`）、录取决定（`decision`）、是否参与（`participated`）**四项互相独立，必须分开显示**，不能合并成一个状态，也不能由其中一项推断另一项：**提交 ≠ 官方确认资格 ≠ 被录取 ≠ 已参与**。
  - 状态变化一律通过 `lib/store.ts` 的 `recordJournalEvent` 记录（它用 `lib/journal.ts` 的 `applyJournalEvent` 更新对应字段并追加 `history`），不要直接改这几个字段。
  - 列表里需要一句话摘要时用 `lib/journal.ts` 的 `journalHeadline(entry)`（由四项派生、不存储）；它不能代替四项的分开显示。
  - 不阻止「不合常理」的顺序（如没提交就记 `admitted`）——学生记录的是现实。页面引导而不拦截：未提交时把录取结果 / 资格确认放在次要位置并提示「通常在提交后才会有」；记这些事件时若仍是 `preparing`，询问是否同时记一次 `submitted`；已 `withdrawn` 时把 `reopened` 放在显眼处。
  - 读写 Journal 与材料时都带上当前档案的 `profile_id`（按档案隔离，见「浏览器存储」）。
- **四个函数都要传 `{ today: 'YYYY-MM-DD' }`**（由页面传入今天）。不传时：
  - `analyzeGaps`：依赖日期的判断按信息不足处理——有截止日期的机会 `reachable` 不会是 true（没有其他确定的阻碍时为 null），`unknown_info` 里会多一条 `options.today`；有参考日期（`as_of` 或截止日期）的年龄要求为 unknown。
  - `findAlternatives`：候选机会中依赖日期的资格判断为 unknown，`same_field` 的 `eligibility_overall` 可能是 `'unknown'`（因此本应按年龄排除的机会可能以 unknown 出现）；也不按截止日期过滤，截止已过的机会可能出现。
  - `explainMatch`：`eligibility` 理由可能是 `positive: null`（unknown），有截止日期的机会 `reachable` 不会是 true。
  - `planAcrossOpportunities`：`evaluated_on` 为 null，`weekly_load` 为 `[]`，`conflicts` 为空，每项的 `weeks_left` 与 `feasible_alone` 为 null，不会出现 `past_deadline`，`missing_info` 含 `options.today`。

### 联合求解模型（`solveJoint` / `verifyPlan` / `compareBaselines` 的实现者只读这一节）

本节逐条可执行；`lib/types.ts` 中联合求解相关注释是它的摘要，两处必须一致。所有结果都是**模拟**，不是真实影响；可达 ≠ 录取。

**0. 记号与通用规则**
- `S` = `scenario.students`，`O` = `scenario.opportunities`，`I` = `scenario.interventions`；所有（学生, 机会）对 = `S × O`。
- `E` = `scenario.existing_grants ?? []`。
- `X` = 方案撤回的 grant id 集合 = `plan.revoked_grant_ids ?? []`；`E'` = `{ g ∈ E : g.id ∉ X }`（未被撤回的已有 grant）。
- 「可撤回的 grant」= `E` 中 `intervention_id` 是字符串、等于 `I` 中某项措施 id、**且 `student_id` 是 `S` 中某个学生的 id** 的 grant（不看 status）。其余已有 grant（无 / null `intervention_id`、指向场景外的 id，或**学生不在场景内**）**不可撤回**。理由：场景外学生的损失无法评估，缺信息不猜，所以不能动。不可撤回的 grant 照样生效、照样占容量（第 3 条第 5 款），approved 的照样让 (措施, 学生) 免成本（第 3 条第 6 款）。
- 「运行中的措施」= `I` 中被 `E` 里任何一条 grant 的 `intervention_id` 指向的措施（不论学生是否在场景内、不论 approved / pending）。What-if 勾选不能把它移出场景（第 9 条）。
- 「措施 i 已批准」= `i.status !== 'pending'`（缺省算 approved）。条件性求解 / 复核时，`assume_approved` 列出的 pending 措施也算已批准。
- 「互斥」`excl(a, b)`：措施 a 的 `mutually_exclusive_with` 含 b，或 b 的含 a（对称）。
- 「空方案」= `selected_intervention_ids = []`、`allocations = []`、`revoked_grant_ids = []`、`cost = { fixed_usd: 0, marginal_usd: 0, total_usd: 0 }`。
- 字符串比较一律按 UTF-16 码元（JS 的 `<` / 默认 `sort()`），不用 `localeCompare`。
- 稳定排序：`selected_intervention_ids`、`revoked_grant_ids` 按 id 升序；`allocations` 按 (`intervention_id`, `student_id`, `opportunity_id`) 升序；`R0` / `R1` / `lost_pairs` 按 (`student_id`, `opportunity_id`) 升序；`revocations` 按 `grant_id` 升序；`fairness` 按 `options.fairness_floors` 的输入顺序。
- 金额与指标比较允许 `1e-6` 的浮点误差（`a ≤ b` 判为 `a ≤ b + 1e-6`；相等判为 `|a − b| ≤ 1e-6`）。唯一例外：公平底线的 `ratio ≥ min_ratio` 判为 `ratio ≥ min_ratio − 1e-9`（第 4 条）。
- **null 视同未给**：`SolveOptions` / `VerifyOptions` 中值为 `null` 的字段（如 `loss_cap`、`min_gain`、`required_intervention_ids`、`fairness_floors`、`mode`），措施的 `capacity`（`undefined` 视同 `null` = 不限）/ `opportunity_ids` / `requires` / `mutually_exclusive_with` / `amount_usd` / `hours_per_week`，`existing_grants`、`opportunity_time_slots`，以及方案的 `revoked_grant_ids` 为 `null` 时，都按「没给」处理。例外：`fixed_cost_usd` 给出（含 `null`）时必须是非负有限数。
- 「复核选项」= `{ mode, loss_cap, required_intervention_ids, min_gain, fairness_floors }`，取值与本次求解的 options 相同（求解器每次调用 `verifyPlan` 都传它；`alternative` 的候选去掉已放松的项；条件性方案另传 `assume_approved_intervention_ids`）。

**1. 评估**
- `reach(pair, grants)` = `analyzeReachability(student, opp, grants, { today: scenario.evaluation_date }).reachable === true`。`null`（信息不足）一律当作**不可达**，不猜。`grants` 传整个列表即可（`analyzeReachability` 自己按 `student_id` / `opportunity_id` 筛选）。
- **R0** = `{ pair ∈ S × O : reach(pair, E) }`——按**全部**已有 grant 计算，与方案是否撤回无关。

**2. 方案生效方式**
- 每条 `Allocation (i, s, o)` 合成一条 grant：
  `{ id: 'alloc:' + i + ':' + s + ':' + o, student_id: s, opportunity_id: o, intervention_id: i, type: I[i].type, amount_usd: I[i].amount_usd ?? null, device: I[i].device ?? null, hours_per_week: I[i].hours_per_week ?? null, status: 'approved', provider: scenario.title, is_sample: true }`。
- **R1** = `{ pair ∈ S × O : reach(pair, E' ∪ 全部合成 grant) }`。`G = |R1 \ R0|`，`L = |R0 \ R1|`，`N = G − L`。
- 措施只能通过 grant 化解现实障碍（设备 / 交通 / 费用 / 时间），**不能改变官方资格**。措施的效果完全由合成 grant 的 `type` 与 `amount_usd` / `device` / `hours_per_week` 经 `analyzeReachability` 决定；`Intervention.resolves` 只用于展示，求解与复核都不读它。
- **撤回已有 grant**（**仅 tradeoff 模式**；protect 模式下 `revoked_grant_ids` 必须为空）：方案可以在 `revoked_grant_ids` 中列出可撤回的已有 grant（规则见第 3 条第 8 款）。被撤回的 grant：
  - 不计入 R1 的 grant 集合（上面的 `E'`）；
  - 不占该措施的容量（第 3 条第 5 款只数 `E'`）；
  - 不再让 (措施, 学生) 免成本（第 3 条第 6 款只认 `E'` 中 approved 的 grant）；
  - **不退款**：已有 grant 的花费本来就不计入方案成本，撤回不会增加预算，也不会减少方案成本。
- 未被撤回的已有 grant（包括未选中措施的）照样生效，计入 R1。
- 由于措施与已有 grant 的额度必须非负、`analyzeReachability` 对 grant 单调（多一条 approved grant 只会多化解障碍）：**不撤回任何已有 grant 时 `L` 恒为 0；`L > 0` 只可能来自撤回。**
- 实现提示：撤回后，R0 中的对可能要分到新措施才能保持可达（例如撤回措施 k 的设备、改由措施 i 补上），求解器不能再假定 R0 中的对无需分配。

**3. 硬约束**（任何情况下都不得放松，protect 与 tradeoff 两种模式都一样）
1. **措施合法**（检查名 `approval`）：`selected_intervention_ids` 中每个 id 都在 `I` 里、不重复、已批准（见第 0 条）。
2. **互斥**（`mutual_exclusion`）：选中集合内没有 `excl` 的两项；并且（两种模式都适用）若措施 k ∈ `I` 有**不可撤回**的已有 grant（`E` 中 `intervention_id === k`、`student_id` 不在 `S` 中），则任何与 k `excl` 的措施都不能被选中——选中它就必须停掉 k，而 k 发给场景外学生的承诺既不能撤回、损失也无法评估。`detail` 写明是哪项措施与哪项「有场景外学生已有承诺」的措施冲突。
3. **前置依赖**（`prerequisite`）：每个选中措施的 `requires` 全部在选中集合里（只要求被选中，不要求有 Allocation）。依赖成环时要么都选、要么都不选。
4. **分配合法**（`allocation_validity`）：每条 Allocation 的 `intervention_id` 是选中的措施，`student_id` ∈ `S`，`opportunity_id` ∈ `O`；该措施给出 `opportunity_ids` 时必须包含该机会；没有重复的 (i, s, o)。选中但没有任何 Allocation 的措施是允许的（仍计固定成本）。
5. **容量**（`capacity`）：对每个选中措施 i（`capacity` 为 null 时不限）：
   - 时段：`slot(o)` = `scenario.opportunity_time_slots?.[o]`；没列出的机会都属于同一个**默认时段**，它与任何显式标签都不同。
   - 已占用：`E_i` = `E'` 中 `intervention_id === i` 的 grant（**不看 status，也不看 student_id 是否在场景内**：已有承诺就占位，保守；**被撤回的不占**）。
   - `capacity_scope` 缺省或为 `'total'`：`|{ g.student_id : g ∈ E_i } ∪ { s : (i, s, ·) ∈ allocations }| ≤ capacity`。
   - `'per_time_slot'`：对每个时段 t：`|{ g.student_id : g ∈ E_i 且 (g.opportunity_id === null 或 slot(g.opportunity_id) = t) } ∪ { s : (i, s, o) ∈ allocations 且 slot(o) = t }| ≤ capacity`。要检查的时段 = 所有显式标签 + 默认时段。
   - 即：同一学生在同一范围内只计 1 次；已被（未撤回的）existing grant 占用的学生再分配不重复占容量。
6. **成本**（`cost_accounting` 与 `budget`）：
   - `fixed_usd` = 选中措施的 `fixed_cost_usd ?? 0` 之和（每项一次）。
   - `marginal_usd` = 各 Allocation 的 `cost_usd` 之和。
   - 对每个出现在 allocations 中的 (i, s)：若 `E'` 中有 `intervention_id === i`、`student_id === s` 且 **`status === 'approved'`** 的 grant，则这组 Allocation 的 `cost_usd` 全为 0（pending 的已有 grant 只占容量、**不免成本**）；否则这组中**恰好一条**记 `unit_cost_usd`、其余为 0（`unit_cost_usd` 为 0 时全为 0）。求解器把全额记在这组按稳定排序的第一条上；复核只检查「恰好一条为全额、其余为 0」。
   - `total_usd = fixed_usd + marginal_usd ≤ scenario.budget_usd`（`budget` 检查）。
7. **损失**（`coverage_loss`）：`L = |R0 \ R1|`（R1 按 `E'` 计算，见第 2 条）。
   - `mode` 缺省或 `'protect'`（默认保护模式）：要求 `L = 0`（此时忽略 `loss_cap`）——不能无提示地让原本可达的学生失去机会；并且不允许任何撤回（第 8 款 d），所以 protect 下 `L` 必然为 0。
   - `'tradeoff'`（权衡分析模式）：只有组织者主动给出 `loss_cap` 才允许损失，要求 `L ≤ loss_cap`；没给 `loss_cap` → `UNSUPPORTED_INPUT`（求解器）/ `coverage_loss` 不通过（验证器）。
   - 受影响的对与原因通过 `lost_pairs` 与 `revocations` 说明（第 5 条）。
8. **撤回**（`revocation`）：
   a. 撤回列表合法：`revoked_grant_ids` 缺省 / null 视为 `[]`；给出时必须是数组，每个元素是字符串、不重复，且是 `E` 中某条**可撤回** grant 的 id。
   b. **强制撤回**：对每条可撤回的 `g ∈ E`，若存在选中的措施 i（i ∈ `selected_intervention_ids` 且 i ∈ `I`）满足 `excl(i, g.intervention_id)`，则 `g.id ∈ X`——措施 `g.intervention_id` 不能与 i 同时运行，选中 i 就必须承担撤回它全部可撤回 grant 的后果（包括 pending 的 grant）。强制撤回只针对可撤回的 grant；该措施若还有场景外学生的（不可撤回的）grant，i 本身就不能选中（第 2 款）。
   c. 撤回后不再补发同一措施：若 `X` 中有一条 grant 的 (`intervention_id`, `student_id`) = (k, s)，则 allocations 中不得有 `intervention_id === k` 且 `student_id === s` 的条目。
   d. **保护模式不动任何已有承诺**：`mode` 缺省或 `'protect'` 时，`revoked_grant_ids` 必须为空（缺省 / null / `[]`）——不允许任何撤回，无论是 b 要求的强制撤回还是自愿撤回，也无论被撤回的 grant 是 approved 还是 pending。因此 protect 模式下，与某项「有可撤回已有 grant」的措施互斥的措施**不能被选中**（选中就违反 b，而撤回又违反 d）。
   - 只有 tradeoff 模式（必须给出 `loss_cap`）允许撤回：强制撤回与自愿撤回都可以，约束是 `L ≤ loss_cap`（第 7 款）。`loss_cap` 按（学生, 机会）对计（与 `L` 同单位）。**tradeoff 且 `loss_cap = 0` 不等同 protect**：它仍允许撤回 pending 的 grant 和不造成损失的撤回（例如撤回本来就不可达的学生的 grant 来腾出名额），只要求 `L = 0`。
   - 不是 b 要求的撤回称为**自愿撤回**（例如为腾出名额给别人），仅 tradeoff 模式允许；它造成的不可达同样计入 `L`。
   - tradeoff 模式下撤回 pending 的已有 grant 不影响可达性（pending 本来就不化解障碍），因此不产生损失，但会腾出容量，并照样出现在 `revocations` 里。protect 模式下 pending 的已有 grant 同样不能撤回（照常占容量）。
- 原有口径（保留）：`Intervention.capacity` = 最多可服务的**不同学生**人数；`unit_cost_usd` = 每服务一位不同学生的边际成本；同一学生凭同一措施参加多个机会只占 1 个容量、只计一次成本；同一 (`intervention_id`, `student_id`) 可有多条 Allocation（对应不同机会），`JointCost.marginal_usd` 仍等于各 Allocation 的 `cost_usd` 之和；未撤回的 existing grant 已覆盖的 (`intervention_id`, `student_id`) 不重复占容量，其中 approved 的还让成本记 0。

**4. 软要求**（主办方自己提的；只有 INFEASIBLE 时才可放松，并且必须明示。`required_intervention_ids` 与 `min_gain` 的检查名为 `organizer_requirements`，公平底线的检查名为 `fairness`）
- `required_intervention_ids` 全部在选中集合里。
- `G ≥ min_gain`。
- **公平底线** `fairness_floors`：每条底线 f 的 `FairnessReport.satisfied === true`。对每条 f（按输入顺序）：
  - 群体成员 `M_f` = `{ s ∈ S : Array.isArray(s.statuses) 且 s.statuses 中至少有一个值 ∈ f.statuses_any_of }`。`statuses` 没填（null / undefined / 非数组）的学生不属于任何群体。
  - 分母 `eligible_members` = `|{ s ∈ M_f : 存在 o ∈ O 使 checkEligibility(s, o, { today: evaluation_date }).overall === 'eligible' }|`（「符合该项支持条件的档案」：至少对场景内一个机会官方资格为 eligible）。**分母保持这个定义**，即使其中有人在当前启用的措施下无论如何都不可达（例如缺少的条件没有措施能化解）；这类情况由说明文字里的上界提示，不从分母中去掉。
  - **覆盖上界（只用于说明，不是约束）**：分母中「至少一个 (s, o) 本来就可达（∈ R0），或存在一组可用措施能让它可达（不考虑名额、预算与其他学生）」的人数。可用措施 = 已批准、前置依赖都可用、不与有场景外学生已有承诺的措施互斥、protect 下不会引起强制撤回；一组措施连同其前置依赖闭包两两不互斥，按它们的强制撤回去掉相应 grant 后、且不给被撤回的 (措施, 学生) 再分配时可达。求解器在公平底线不可行的说明与放松底线的 `alternative.note` 中写「当前启用的措施下该群体最多可覆盖 X / Y 名」，What-if 页面在底线结果中显示同一数字，避免把替代方案的覆盖率误当作上限。
  - 分子 `covered_members` = 上述分母中的学生里，存在 o 使 (s, o) ∈ R1 的学生数（**按学生计**，至少一个可达对即算覆盖，不按对计）。
  - `ratio` = `covered_members / eligible_members`；**分母为 0 时 `ratio = null`**（不计算比例，该底线视为不适用、自动满足）。
  - `min_ratio` 抄自 f；`satisfied` = `ratio === null || ratio ≥ f.min_ratio − 1e-9`。
  - **重复归属（事先声明的方法）**：一个学生属于多个群体时，每条底线各自独立计算，同一学生在每个所属群体里各计一次。
  - 只读学生自己声明的 `statuses`，**不得读取 `school_name`、`display_name`**。
  - 注意：R0 本身就可能达不到底线，此时空方案也不满足软要求（INFEASIBLE 可能由此造成）。
- `fairness` 报告：options 给出 `fairness_floors`（非 null，含空数组）时，求解器返回的每个**已评估**方案（主结果、`alternative`、`conditional`，包括 INFEASIBLE 的空主方案和已放松底线的 `alternative`）都带 `fairness`，按上面的定义对该方案的 R1 计算，顺序同输入；没给时省略该字段。

**5. 目标与确定性**
在满足全部硬约束和软要求的方案中，依次比较：
1. `N = G − L` 最大；
2. `L` 最小（protect 模式不允许撤回，`L` 与撤回数恒为 0，此步与第 6 步都不起作用）；
3. `cost.total_usd` 最小；
4. Allocation 条数最少；
5. 选中措施数（`selected_intervention_ids.length`）最少；
6. 撤回的 grant 数（`revoked_grant_ids.length`）最少（protect 模式下恒为 0）；
7. 字典序最小：先逐元素比较排序后的 `selected_intervention_ids`（前缀更短者更小），再逐元素比较排序后的 allocations（按 (`intervention_id`, `student_id`, `opportunity_id`) 元组比较，前缀更短者更小），再逐元素比较排序后的 `revoked_grant_ids`（前缀更短者更小）。
同输入必须同输出；返回的数组都按第 0 条的稳定顺序排序。
- **规范化（由第 5 步保证）**：求解器返回的任何方案（主结果、`alternative`、`conditional`）中，每个选中措施要么至少有一条 Allocation，要么在（该方案仍要求的）`required_intervention_ids` 里，要么是前两类措施的（传递）前置依赖；其余措施不会被选中（去掉它们得到的方案同样可行——强制撤回只会变少；tradeoff 模式下原来的撤回可以作为自愿撤回原样保留，protect 模式下本来就没有撤回——R1 不变或更大、成本不变或更低、分配条数不变、措施数更少）。
- 名额或预算不够、多名学生条件相同时，按学生编号顺序（字典序）决定——这是模拟中的确定性规则，**不代表谁更需要**；`notes` 中写明这一点。
- **结果中的撤回与损失明细**（求解器返回的每个方案都必须给出，可为空数组；`UNSUPPORTED_INPUT` 的空方案及占位方案为 `revoked_grant_ids = []`、`lost_pairs = []`、`revocations = []`，省略 `fairness`）：
  - `revoked_grant_ids`：按 id 升序。
  - `lost_pairs` = `R0 \ R1`，稳定排序。
  - `revocations`：`X` 中每条 grant g 一条 `{ grant_id: g.id, intervention_id: g.intervention_id, student_id: g.student_id, forced_by }`；`forced_by` = 满足 `excl(i, g.intervention_id)` 的选中措施 i（i ∈ `I`）中 id 最小者，没有则为 `null`（自愿撤回）。按 `grant_id` 升序。
  - 界面只显示人数与汇总（受影响的对数、撤回条数、其中强制撤回条数），不显示单个学生。

**6. 状态**（按以下顺序判定）
- **`UNSUPPORTED_INPUT`**（不做评估；返回空方案，`R0 = R1 = []`，`notes` 写明原因；`alternative` / `conditional` / `verification` 为 null）。求解器（`validateJointInput`）与验证器（`input_validity`）**各自实现、规则相同**（第 0 条「null 视同未给」同样适用）：
  - 形状：`students` / `opportunities` / `interventions` 不是数组，或其中有不是「带字符串 `id` 的对象」的条目；`existing_grants` 给出但不是数组，或含非对象条目；`opportunity_time_slots` 给出但不是（非数组的）对象；
  - existing grant 的 `id` 不是字符串，或在 `existing_grants` 内重复（方案按 id 撤回，id 必须唯一）；
  - `budget_usd` 为负或非有限数；
  - `mode` 给出但不是 `'protect'` / `'tradeoff'`；`mode: 'tradeoff'` 但没给 `loss_cap`；`loss_cap` 或 `min_gain` 为负或非有限数；`max_search_nodes` 给出但不是正整数（只有求解器检查）；
  - 学生 / 机会 / 措施 id 有重复；
  - `required_intervention_ids`、`requires`、`mutually_exclusive_with` 给出但不是数组、引用了不存在的措施 id，或 `requires` / `mutually_exclusive_with` 引用了措施自己；`opportunity_ids` 给出但不是数组或引用了不存在的机会 id；`opportunity_time_slots` 的键引用了不存在的机会 id；
  - `opportunity_time_slots` 的**标签不是非空字符串**（如数字、`null`、`''`）；
  - `capacity`（非 null 时）、`unit_cost_usd`、`fixed_cost_usd` 为负或非有限数；
  - 措施的 `amount_usd` / `hours_per_week`，或 existing grant 的 `amount_usd` / `hours_per_week`（非 null 时）为负或非有限数；
  - `evaluation_date` 不是**严格**的 `YYYY-MM-DD` 合法日期（前后有空格、不补零、不存在的日期都不合法）；
  - 只算**全部** existing grant（不考虑任何撤回）就已经超过某措施的容量（任一范围 / 时段）；
  - `fairness_floors` 给出但不是数组；或其中有：不是对象的条目；`id` 不是非空字符串，或 id 重复；`label` 或 `basis` 不是字符串，或 `trim()` 后为空；`statuses_any_of` 不是非空数组，或含 `STUDENT_STATUSES` 以外的值；`min_ratio` 不是 0–1（含两端）的有限数。
  - 方案的 `revoked_grant_ids` 是方案的一部分，不是输入：它不合法只让 `revocation` 检查不通过，不触发 `UNSUPPORTED_INPUT`。
- **不得返回「OPTIMAL 但复核不通过」**（兜底）：求解器对自己将返回的方案调用 `verifyPlan` 复核（传入「复核选项」，条件性方案另传 `assume_approved_intervention_ids`）。完整搜索得到的最优方案复核不通过时：
  - 主结果返回 `UNSUPPORTED_INPUT` + 空方案（`R0 = R1 = []`，`alternative` / `conditional` 为 null），`notes` 写「内部复核未通过，按不支持的输入处理，请检查场景数据」（并列出未通过的检查项），**`verification` 保留那次失败的复核结果**（这是 `UNSUPPORTED_INPUT` 时 `verification` 非 null 的唯一情况）；
  - `conditional`：不给出该方案，`conditional.status = 'UNSUPPORTED_INPUT'`、方案为空方案占位，`note` 写明内部复核未通过；
  - `alternative`：舍弃复核不通过的候选，从其余放松方式中选；都不可用时给出空方案占位，`note` 写明内部复核未通过。
  - 合法输入下求解器与验证器应当一致，这条兜底不应被触发；触发即说明场景数据或实现有问题。
- **`INFEASIBLE`**：搜索完成，证明没有方案同时满足硬约束和软要求。由于空方案总满足全部硬约束（预算 ≥ 0；不选措施就没有强制撤回；不撤回则 R1 = R0、L = 0），INFEASIBLE 只可能由软要求造成（例如：必须启用的措施的固定成本超出预算、必须启用的措施是 pending、两个必须启用的措施互斥、protect 模式下必须启用的措施与某项有可撤回已有 grant 的措施互斥、必须启用的措施与有场景外学生已有承诺的措施互斥（两种模式）、tradeoff 下必须启用的措施的强制撤回造成的损失超过 `loss_cap`、`min_gain` 达不到、公平底线在预算 / 名额 / 资格下达不到）。**不得为了得到可行结果而暗中降低任何阈值**。
  - 主结果为空方案（`R1 = R0`，`G = L = N = 0`，成本 0；给了底线时带 `fairness`），`verification = null`。
  - `alternative`（必须非空）= 只放松软要求后的最优方案，`relaxed` 写明放松了哪些、`note` 写明原要求为何达不到。放松 = 整项不再要求（不做部分放松、不降低阈值）。规则：
    - `K` = options 中给出（非 null，含空数组）的软要求项，取自 `min_gain`、`fairness_floors`、`required_intervention_ids`。
    - 按放松的项数 m = 1, 2, …, |K| 依次进行：对 `K` 的每个 m 元子集 T，在「硬约束不变、软要求只剩 `K \ T`」下求解（每个子集的搜索单独计数 `max_search_nodes`），只保留以「复核选项去掉 T 中各项」通过内部复核的方案。只要某个 m 有子集得到方案，就在这些子集的方案中按第 5 条取最优者；完全并列时，把各子集按固定优先级 `min_gain` < `fairness_floors` < `required_intervention_ids` 排成序列后取字典序最小者（即靠前者优先被放松，例如 {`min_gain`, `fairness_floors`} 优先于 {`min_gain`, `required_intervention_ids`}）。找到即停止，不再尝试更大的 m。
    - `T = K` 时空方案必可行，所以一定能停下。
    - 某个子集的搜索达到上限但已找到复核通过的方案，视为该子集可行（`note` 写明未证明最优）；达到上限且没找到方案，视为该子集不可行。
    - `relaxed` = T，按上述固定优先级排列。
    - 与之前的两项规则一致：|K| ≤ 2 时，此规则与原规则（先分别只放松一项，取更优者，完全并列取只放松 `min_gain`；都不可行时两项都放松）结果完全相同。
  - **不得悄悄降低要求**：主结果的 `status` 仍是 INFEASIBLE。
- **`SEARCH_LIMIT_REACHED`**：达到 `max_search_nodes` 时停止。只返回已找到的、经 `verifyPlan`（传入「复核选项」）复核通过的最好方案，`verification` 为该复核结果；`notes` 写明「未证明最优」。做法：搜索中每次刷新最好方案时记录该候选（只保留最近 K = 8 个，后记录的严格更优）；达到上限时按目标顺序（最新 = 最优）依次复核，返回第一个通过的。没有复核通过的方案时返回空方案，`verification` 为空方案的复核结果（有软要求时可能不通过），`notes` 写明「搜索上限内未找到满足全部要求的方案，这是不启用任何措施的占位方案」。不得声称最优，也不等于无解。
- **`OPTIMAL`**：搜索完成并证明最优；`verification` 必须非空且通过（不通过时按上面的兜底返回 `UNSUPPORTED_INPUT`）。
- `max_search_nodes` 的含义不变；撤回决策（自愿撤回哪些可撤回的 grant）纳入搜索空间，「节点」如何计数由求解器文件头说明。`alternative` 的搜索也受同一个 `max_search_nodes`（每个子集单独计数）；达到上限时给出已找到的、复核通过的最好替代方案，并在 `note` 中写明未证明最优。

**7. 条件性结果**
- 场景里存在 pending 措施、且主状态不是 UNSUPPORTED_INPUT 时：`conditional` = 把**全部** pending 措施当作已批准、其他条件（含 options 中的软要求、`fairness_floors`、`mode` / `loss_cap` 与 `max_search_nodes`）相同再求解一次的结果；`status` 为这次求解的状态（规则同第 6 条，含「内部复核未通过 → UNSUPPORTED_INPUT」），`assumed_approved_intervention_ids` 列出这些措施（升序），`note` 写明「如果这些措施获批，则……，目前尚未生效」；与主结果比较时称「主结果（仅含已批准措施）」，不说「已生效」。否则 `conditional` 为 null。
- `existing_grants` 不变：pending 的 existing grant 仍按 pending 处理，R0 与主结果相同；撤回规则（第 3 条第 8 款）照常适用。
- **主结果永远不含 pending 措施。**

**8. `verifyPlan(scenario, plan, options?)` —— 独立复核**
- 不得 import 求解器或基线模块的任何代码（求解器、验证器、基线放在 `lib/joint/` 下不同文件，验证器文件不 import 求解器与基线文件；求解器与基线可以调用验证器）。可以调用学生端的 `analyzeReachability` / `checkEligibility`（它们不是求解器）。
- 自己重算 R0、R1、G、L、N、成本、`lost_pairs`、`revocations`、`fairness`，不信任 plan 里自带的任何指标或可行性标记。
- 重算时 `X` 只取 `revoked_grant_ids` 中合法的部分（是字符串、是可撤回 grant 的 id，去重）；不合法的部分只让 `revocation` 不通过。
- 输出的每项检查一条 `VerifyCheck`，`passed` = 全部检查都通过。检查项（名称固定）：
  - `input_validity`：scenario / options 是否命中第 6 条 UNSUPPORTED_INPUT 的任一条件（`max_search_nodes` 除外），或 `assume_approved_intervention_ids` 引用了不存在的措施。命中则不通过（其余检查仍尽量给出）。规则与求解器相同，但在验证器文件里**独立实现**（不共用校验函数）；对任一输入，「求解器返回 UNSUPPORTED_INPUT（输入校验）」⇔「`input_validity` 不通过」（有对照测试）。
  - `approval`、`mutual_exclusion`、`prerequisite`、`allocation_validity`、`capacity`、`cost_accounting`、`budget`、`coverage_loss`、`revocation`：对应第 3 条的硬约束 1–8（`approval` 中 `assume_approved_intervention_ids` 列出的 pending 措施算已批准；`capacity` 只数 `E'`；`cost_accounting` 的免成本只认 `E'` 中 approved 的 grant；`coverage_loss` 的 R1 按 `E'` 计算，按 `options.mode` / `loss_cap` 判定，不传按 protect，tradeoff 缺 `loss_cap` 判不通过；`revocation` 始终输出，按第 3 条第 8 款 a、b、c、d 检查：`options.mode` 缺省或 `'protect'` 时，任何非空的 `revoked_grant_ids`（不论其中 id 是否合法、是否强制、grant 是 approved 还是 pending）都判不通过；`detail` 写明非法 id、该撤回而没撤回的 grant、撤回后又分配的 (措施, 学生)、protect 模式下出现的撤回）。
  - `eligibility`（交叉检查）：`R1 \ R0` 中每个对的 `checkEligibility(student, opp, { today: evaluation_date }).overall === 'eligible'`。
  - `deadline`（交叉检查）：`R1 \ R0` 中每个对的机会 `deadline` 为 null 或不早于 `evaluation_date`。
  - `barrier_resolution`（交叉检查）：`R1 \ R0` 中每个对，在带 `E'` ∪ 全部合成 grant 的 `analyzeReachability` 结果里所有障碍 `resolved === true`，且至少一条障碍的 `resolved_by_grant_ids` 含 `'alloc:'` 开头的合成 grant。
  - `organizer_requirements`：只有 options 传了 `required_intervention_ids` 或 `min_gain` 时才输出；按第 4 条前两项检查（不含公平底线）。
  - `fairness`：只有 options 给出 `fairness_floors`（非 null，含空数组）时才输出；按第 4 条对重算的 R1 计算每条底线，全部 `satisfied` 才通过（空数组直接通过），`detail` 写明每条底线的分子 / 分母 / 比例。
  - `metrics`：始终输出。plan 若带有 `R0` / `R1` / `G` / `L` / `N` / `cost` / `lost_pairs` / `revocations` / `fairness` 中的任一字段（如传入的是 `JointResult`），逐项与重算值比较，任一不一致则不通过；plan 不带这些字段时通过，`detail` 写明「plan 未携带指标，仅重算」。比较方式：
    - `R0` / `R1` / `lost_pairs`：按集合比较，且不得有重复对；数值按第 0 条的误差。
    - `revocations`：按 `grant_id` 作为键的集合比较，不得有重复 `grant_id`；每条的 `intervention_id`、`student_id`、`forced_by` 必须与重算值全等。
    - `fairness`：options 给出底线时，长度相同且按顺序逐条比较：`floor_id`、`eligible_members`、`covered_members`、`satisfied` 全等，`ratio` 同为 null 或差 ≤ 1e-6，`min_ratio` 差 ≤ 1e-6；**options 没给底线时不比较** plan 自带的 `fairness`（它可能是按原底线报告的，例如已放松底线的 `alternative`），有无、内容都不影响 `metrics`。
    - `revoked_grant_ids` 是方案本身（由 `revocation` 检查），不属于指标。
- 复核条件性方案时，调用方传 `assume_approved_intervention_ids: conditional.assumed_approved_intervention_ids`。

**9. 实现位置与测试**
- `lib/joint/solve.ts`（`solveJoint`，精确搜索；节点计数与缺省上限见 `lib/joint/index.ts` 文件头）、`lib/joint/verify.ts`（`verifyPlan`）、`lib/joint/baselines.ts`（`compareBaselines`，第 10 条）、`lib/joint/exhaustive.ts`（只用于测试的穷举 / 朴素枚举参考实现；需要同时枚举可撤回 grant 的子集）、`lib/joint/whatif.ts`（What-if 页面视图模型 `runWhatIf`）、`lib/joint/scenarios.ts`（演示场景与 `withEnabledInterventions` / `resolveEnabledInterventions` / `withBudget`）。
- 独立性：`verify.ts` / `exhaustive.ts` 不 import `./solve`、`./index`、`./scenarios`、`./baselines`（有静态守卫测试）。`baselines.ts` 可以 import `./solve`（为了 joint 行）和 `./verify`。
- `withEnabledInterventions(scenario, ids)`：只保留勾选的措施；**前置依赖没有全部启用的措施一并移除**（按闭包反复判断；前置依赖只认「勾选且自身依赖满足」的措施），不会删掉 `requires` 让措施单独生效；指向已移除措施的互斥引用会被清理（互斥对象不在场景里不构成约束）。
- **运行中的措施（第 0 条）不能通过取消勾选而消失**：它一律保留在场景里，不受勾选影响，互斥、容量、已有 grant 的效果照常生效（例如只勾选与它互斥的新措施时，选中新措施仍须按第 3 条第 8 款撤回它的可撤回 grant，protect 下新措施因此不能选）。它是否继续接受**新分配**由勾选决定：没有勾选（或勾选了但前置依赖没有全部启用）的运行中措施，在返回的场景副本里 `opportunity_ids` 设为 `[]`（不适用于任何机会，因此不可能出现它的新 Allocation；`[]` 是合法输入，不触发 `UNSUPPORTED_INPUT`；容量只数已有 grant 与 Allocation、不看 `opportunity_ids`，所以已有 grant 的占用不变），其余字段不变；只有这类措施的 `requires` 可能指向已移除的措施，这些引用被清理（它不会有新分配，清理不放松实际约束）。
- `resolveEnabledInterventions` 返回 `enabled`（勾选且依赖满足）、`removed`（真正移出场景的，不含运行中的措施）、`running`（全部运行中的措施）、`frozen`（运行中但不接受新分配的措施及原因 `unchecked` / `missing_requires`）。`runningInterventionIds(scenario)` 返回运行中的措施。What-if 页面给运行中的措施显示英文徽标 `Running` 与一句英文说明（大意：已有 N 份资源在使用，不能从方案中移除；取消勾选只表示不再新增分配）。

**10. 基线对比 `compareBaselines(scenario, options?)`**（`lib/joint/baselines.ts`；类型 `BaselineComparison` / `BaselineRow` / `BaselineMetrics` / `BaselineId`）
- 签名：`(scenario: Scenario, options?: SolveOptions) => BaselineComparison`。纯函数、确定性。所有基线使用**同一份** scenario、同一份 options（`mode`、`loss_cap`、软要求、`fairness_floors`）、同一个 `analyzeReachability`、同一个验证器；不得故意削弱任何基线。下面的「按 id 升序」「先到先得」都是确定性的简化，不代表任何真实系统。
- 公共定义：
  - `opts` = `options ?? {}`；`VO` = 由 `opts` 得到的「复核选项」（第 0 条；不传 `assume_approved_intervention_ids`）。
  - `J` = `solveJoint(scenario, opts)`。若 `J.status === 'UNSUPPORTED_INPUT'`：返回 `rows = []`，`notes` = `['输入不合法或内部复核未通过，未做基线对比。', ...J.notes]`，结束。
  - `AP` = `I` 中已批准（`status !== 'pending'`）的措施，按 id 升序。B、C 只用 `AP`（基线只对比主结果，不做条件性对比）。
  - `R0`、`reach` 同第 1 条（用全部 `E`）。`applicable(i, o)` = `i.opportunity_ids` 缺省 / null 或包含 o。
  - `fill_costs(allocations)`：按第 3 条第 6 款给 `cost_usd`——对每个 (i, s) 组：若 `E` 中有 `intervention_id === i`、`student_id === s`、`status === 'approved'` 的 grant，全组为 0；否则按稳定排序的第一条记 `unit_cost_usd`，其余为 0。（B、C 都不撤回，`E' = E`。）
  - 对每行的 `plan`（只含 `selected_intervention_ids`、`allocations`、`revoked_grant_ids` 三个字段，均按稳定顺序）：
    - `verification` = `verifyPlan(scenario, plan, VO)`（每行都重新调用，joint 行也不复用 `J.verification`）；
    - 「可执行」= `verification.checks` 中名称不是 `organizer_requirements`、`fairness` 的检查全部通过；
    - `verified` = 可执行时取验证器对该 plan 独立重算的指标 `{ R1_count: |R1|, G, L, N, total_usd: cost.total_usd }`（例如 `verify.ts` 的 `verifyAndMeasure` 返回的重算值；不得用方案自带或基线自己算的数字），否则 `null`；
    - `soft_requirements_met` = `VO` 中 `required_intervention_ids`、`min_gain`、`fairness_floors` 都没给时为 `null`；否则 = `verification` 中输出了的 `organizer_requirements`、`fairness` 检查全部通过；
    - `repaired` 见各行；A 与 joint 恒为 `null`。
- **A `A_eligibility_only`，label「基础资格筛选」**：只调用 `checkEligibility`。`claimed_reachable` = `S × O` 中 `checkEligibility(s, o, { today: evaluation_date }).overall === 'eligible'` 的对数。`plan` = 空方案。`verified` 即 R0 的情况（`R1_count = |R0|`，G = L = N = 0，成本 0）。description 要点：只判断条件是否满足，不安排行动与共享资源，会把「符合资格」误当作「能参加」。
- **B `B_student_side`，label「学生端约束规划器」**：每个对单独规划，不直接优化机构干预。
  1. 对每个不在 R0 中的对 p = (s, o)，按 (`student_id`, `opportunity_id`) 升序：候选措施 `C_p` = `{ i ∈ AP : applicable(i, o) }`。按集合大小 1, 2, …, |C_p| 枚举 `C_p` 的子集，同一大小内按「排序后的 id 数组」字典序；取第一个满足 `reach(p, E ∪ { 子集中每个 i 的合成 grant (i, s, o) })` 的子集 `T_p`。没有则该对不计入。B 不考虑互斥、前置依赖、名额、预算、撤回，也不考虑名额与预算是否被别人占用。
  2. `P_B` = 找到了 `T_p` 的对的列表（升序）。`build_B(Q)`（Q ⊆ `P_B`）：`allocations` = `fill_costs({ (i, s, o) : (s, o) ∈ Q, i ∈ T_(s,o) })`；`selected_intervention_ids` = 这些 Allocation 用到的措施再按 `requires` 取传递闭包（只取 `I` 中存在的 id）；`revoked_grant_ids = []`。若因此选中了互斥的两项或 pending 的前置依赖，按现状保留，由复核判定。
  3. `plan` = `build_B(P_B)`；`claimed_reachable` = |R0| + |P_B|。
  4. `repaired`：plan 可执行时为 `null`。否则：`acc = []`；按 `P_B` 的顺序逐个对 p：若 `build_B(acc ∪ {p})` 经 `verifyPlan(…, VO)` 可执行，则把 p 加入 `acc`，否则跳过 p（先到先得）。`repaired` = 验证器对 `build_B(acc)` 重算的指标（`acc` 为空时即空方案），`note` = 「按（学生编号, 机会编号）升序先到先得截断：保留 a 个对，跳过 b 个对；这是模拟中的确定性规则，不代表谁更需要。」（a、b 为实际数字）。
  - description 要点：能为每个学生规划路线，但各自假设资源都归自己，不协调名额、预算与互斥。
- **C `C_organizer_side`，label「机构端干预规划器」**：只看措施与障碍类型的对应，不计算学生是否因此完整可达。
  1. 预计算：对每个对 p，`rr_p` = `analyzeReachability(s, o, E, { today: evaluation_date })`；`U_p` = `rr_p.barriers` 中 `resolved === false` 的障碍类型集合（R0 中的对 `U_p` 为空）。`believed_p` = 空集（C 认为已化解的障碍类型）。
  2. `remaining = budget_usd`，`sel = []`，`alloc = []`。按 id 升序处理每个 i ∈ `AP`：
     - 跳过 i，若：`requires` 中有不在 `sel` 里的措施（按 id 顺序处理，依赖于 id 更大的措施的 i 因此总被跳过）；或与 `sel` 中某项 `excl`；或与任何在 `E` 中有已有 grant 的措施 k（`E` 中存在 `intervention_id === k` 的 grant）`excl`（C 不撤回已有 grant）；或 `(i.fixed_cost_usd ?? 0) > remaining + 1e-6`。
     - 试分配：`r = remaining − (i.fixed_cost_usd ?? 0)`；`t = SUPPORT_RESOLVES[i.type]`；按 (`student_id`, `opportunity_id`) 升序遍历对 p = (s, o)，选出满足 `applicable(i, o)`、`t ∈ U_p`、`t ∉ believed_p` 的对。对每个这样的对：
       - 容量：范围（`total` = 全场景；`per_time_slot` = `slot(o)` 所在时段）内已占用的学生集合 = `E` 中 `intervention_id === i` 且在该范围内的 grant 的 `student_id`（时段规则同第 3 条第 5 款）∪ 本次已试分配给 i、且在该范围内的学生。s 已在其中则不占新容量；否则需 `capacity` 为 null 或 `集合大小 + 1 ≤ capacity`，不满足则跳过该对。
       - 成本：若本次已给 (i, s) 分配过，或 `E` 中有 (i, s) 的 approved grant，则为 0；否则为 `unit_cost_usd`，需 `≤ r + 1e-6`，不满足则跳过该对。
       - 通过则记一条 Allocation (i, s, o)，`r` 减去成本，并在本次试分配中记下 t 属于 `believed_p`。
       - 遍历完：若 i 至少有一条 Allocation，则选中 i（加入 `sel`），`remaining = r`，提交这些 Allocation 与 `believed` 更新；否则不选 i（不花固定成本），撤销本次试分配。
     - C 不检查资格、不检查其他类型的障碍。
  3. `plan` = `{ selected_intervention_ids: sel, allocations: fill_costs(alloc), revoked_grant_ids: [] }`；`claimed_reachable` = |R0| + 至少有一条 Allocation 的不同对数（它以为化解了障碍就可达）。
  4. `repaired`：plan 可执行时为 `null`（通常如此：C 遵守名额与预算；`verified` 会少于 `claimed_reachable`，因为有些学生还缺别的条件或资格不符）。否则按 B 第 4 步的方法截断：以「有 Allocation 的对」为单位按升序逐个加入（加入一个对 = 加入 C 给该对的全部 Allocation），`selected_intervention_ids` 保持为 `sel`，`cost_usd` 每次用 `fill_costs` 重算，不可执行则跳过该对；`note` 同 B 的格式。
  - description 要点：能按障碍类型分配名额与预算，但不联合计算学生的准备路线与其他条件，化解一种障碍不等于能参加。
- **joint `joint`，label「联合求解」**：`plan` = `J` 的 `selected_intervention_ids`、`allocations`、`revoked_grant_ids ?? []`（INFEASIBLE 时即空主方案，不用 `alternative`）；`claimed_reachable` = `J.R1.length`。description 要点：同时考虑学生的资格、障碍与主办方的名额、预算、互斥、依赖和损失底线。
- `rows` 固定顺序：A、B、C、joint。
- `notes` 必须包含（措辞可调整，含义不变）：
  - 「所有行使用相同的场景、预算、名额、规则与复核器。」
  - 「说明书中的基线 D（充分协调的分离式规划器）未实现。」
  - 「全部为模拟结果，基于示例数据，不代表真实影响；可达不等于录取。」
  - 「基线的顺序规则（按编号升序、先到先得）是确定性的简化，不代表任何真实系统，也不代表谁更需要。」
  - `J.status` 为 `SEARCH_LIMIT_REACHED` 时加一条「联合求解达到搜索上限，未证明最优」；为 `INFEASIBLE` 时加一条「联合求解在当前要求下无解，表中为空方案，放松后的替代方案见求解结果」。
- 界面展示基线时同样只显示人数与汇总，不显示单个学生。

### 接入学生端函数的提示

- **传入今天的日期**：有截止日期的机会，调用 `checkEligibility` / `analyzeReachability` / `planRoutes`（以及第二阶段的四个函数，见「第二阶段新函数」一节）时要传 `{ today: 'YYYY-MM-DD' }`。不传时依赖日期的结果按设计为 unknown / null：例如 `reachable` 为 `null`、`missing_info` 含 `options.today`，路线的 `feasible_by_deadline` 为 `null`。
- **`missing_info` 目前可能出现的字段名**：`profile.devices`、`profile.budget_usd`、`profile.transport`、`profile.hours_per_week_available`、`opportunity.cost.fee_usd`、`opportunity.cost.requires_travel_expense`、`opportunity.time_commitment.hours_per_week`、`opportunity.deadline`（格式无法识别）、`options.today`。
- **grant 是否化解障碍**：`applied_grant_ids` 是所有匹配的 approved grant，**不等于「已化解」**；是否化解看每条障碍的 `resolved` / `resolved_by_grant_ids`。
- **已过截止日期**：表现为一条 `type: 'time'`、`shortfall: null`、任何 grant 都不能化解的障碍。
- **`planRoutes`**：`status: 'routes'` 时路线 2–3 条；固定步骤 id 为 `submit-application`（提交申请）和 `find-partner`（找到同伴或导师），准备项不要用这两个 id；被证据覆盖的步骤 `skipped: true`，不计入合计；`status: 'blocked'` 时 `routes` 为空。
- **地区规则**：州 / 省请统一用代码（如 `CA`），国家与州 / 省代码都大小写不敏感。
- **证据关联准备项**：证据的 `prep_item_ids` 建议写成 `<opportunity_id>:<prep_id>`，避免跨机会误匹配（裸 `prep_id` 也能匹配，但不同机会的同名准备项会被一起覆盖）。
- 导入 `data/*.json` 时，TypeScript 会把字面量（如 `'online'`、`'approved'`）拓宽成 `string`，与联合类型不兼容；目前需要断言，例如
  `import profilesJson from '@/data/profiles.json'; const profiles = profilesJson as unknown as StudentProfile[];`。带校验的加载函数待定。
- **主办方 What-if（`solveJoint` / `verifyPlan`）**：
  - 页面用 `runWhatIf(scenario, input, availableFloors?)`（`lib/joint/whatif.ts`）拿汇总视图（`/organizer` 页面支持切换演示场景、保护 / 权衡模式与损失上限、勾选公平底线并调整比例，并显示 A / B / C / 联合求解的基线对比表）：它处理勾选与前置依赖、调用 `solveJoint`、**再独立调用一次 `verifyPlan`**，并把结果整理成只含人数和汇总数字的 `WhatIfView`。
  - 直接用 `solveJoint` 时，展示前**自己再调一次 `verifyPlan`**（相同的 `mode` / `loss_cap` / 软要求；复核 `conditional` 时传 `assume_approved_intervention_ids`），不要只信结果里自带的 `verification`。
  - 所有结果都是**模拟**（示例学生、示例场景），界面标 `Sample` / `Simulated`；可达 ≠ 录取；`SEARCH_LIMIT_REACHED` 不等于最优也不等于无解；`INFEASIBLE` 的主结果是空方案，替代方案要写明放松了什么。
  - 权衡分析模式（tradeoff）只在组织者主动设置 `loss_cap` 时使用；界面要说明受影响的对数（`lost_pairs` 的数量）和撤回条数（其中强制撤回多少条），不列出具体学生。公平底线、基线对比同样只显示人数与比例。
  - **不要在界面显示单个学生的信息**（id、姓名、学校、逐人分配）；只显示人数与汇总。`runWhatIf` 已把说明文字里的学生 id / 姓名 / 学校替换为「某学生」。

语义约定：
- **unknown**：信息不全（学生没填、或官方要求机器判定不了）时返回 unknown，并给出「请向官方确认」提示。界面要把 unknown 显示成 `Unknown`（并提示向官方确认），不能显示成通过或不通过。
- **总体资格**：任一硬性要求 not_satisfied → not_eligible；否则任一硬性 unknown → unknown；否则 eligible。非硬性（偏好）不影响总体。
- **`reachable` 的语义（固定，按顺序判定）**：
  - `false`：存在硬性要求 `not_satisfied`，**或**存在未被 approved grant 化解的障碍（无论资格是否 unknown，结论都确定）。
  - `null`：没有上述情况，但资格总体为 unknown，或缺少判断障碍所需的关键信息（见 `missing_info`）。
  - `true`：硬性要求全部 satisfied，且所有障碍不存在或已被化解。
  - 准备差距（`readiness_gaps`）**不直接**决定 `reachable`，只通过「补齐所需小时数 vs 可用时间」体现为 time 障碍。
- **可达 ≠ 录取**：`reachable = true` 只表示资格不冲突、现实条件走得通，不代表录取概率。界面不得暗示「会被录取」。
- **grants 的作用**：`analyzeReachability` 只用 `status = 'approved'` 且 student_id / opportunity_id 匹配的 grants 去化解对应障碍（设备→device、交通补助或替代参与方式（`alternative_access`）→transport（任一即可）、费用减免→cost、时间支持→time）；`pending` 只产生「若获批」的条件提示。「匹配」= `student_id` 等于该学生，且 `opportunity_id === null`（对该学生的所有机会都有效）或等于该机会 id；缺少 `opportunity_id` 字段的 grant 一律不生效（信息不足不猜）。`lib/store.ts` 的 `grantsFor` 按同一规则筛选，`loadGrants` 读取时逐条丢掉非法条目（含缺 `opportunity_id` 的）、保留合法的。按金额计的资助对每个机会各按全额计算，不在机会之间分摊，因此 `opportunity_id: null` 建议只用于可重复使用的资源（device、time_support）。
- **硬性不满足不给绕过路线**：`planRoutes` 遇到硬性 not_satisfied 返回 `status: 'blocked'`，只给原因和「下一届 / 同领域替代」提示，`routes` 为空。资格 unknown 时仍给路线，但带提醒。
- **证据跳过步骤**：学生已有证据覆盖的步骤标 `skipped: true` 并写 `skip_reason`，不计入总小时 / 费用；`diffRoutes` 要说得出变化原因。
- **评估基准日 `options.today`**：`today`（`YYYY-MM-DD`）用于算年龄、距截止还有多久、是否来得及。**不传时函数不得读系统时间**（不用 `Date.now()` / `new Date()`），凡是依赖日期的判断一律按「信息不足」处理（unknown / null）；由界面层负责传入今天。
- **公平性**：任何判断函数都不得读取 `school_name`。
- **联合求解**：SEARCH_LIMIT_REACHED 不等于无解，也不得声称全局最优；INFEASIBLE 不得悄悄放松约束；`verifyPlan` 独立复核，不依赖求解器自己的可行性标记。所有结果都是模拟。

### 浏览器存储 `lib/store.ts`

`lib/store.ts`（主导）封装 localStorage，键名 `oc:v1:*`，SSR 安全（服务器端读返回默认值，写 / 清除为空操作）；JSON 损坏或形状不对时回退默认值，列表逐条丢弃非法条目，不抛异常。
- **页面不直接读写 localStorage**，一律用下面的函数（`readJSON` / `writeJSON` / `removeKey` / `storageKey` / `STORE_KEYS` 是底层工具，页面不要用）；需要新的键找主导。
- **读取放在挂载后的 effect 里**（React 的 `useEffect`），不要在渲染时读，否则首屏会不一致（hydration mismatch）。
- **日期一律由调用方传入**（`on` / `taken_on` / `updated_on` 等）：存储层不读系统时钟；唯一例外是生成 id 与分享句柄（`createEmptyProfile`、`createJournalEntry`、`defaultShareSettings` 用 `crypto.randomUUID`，不可用时回退为时间戳 + 计数）。

第一阶段（不变）：`loadProfile / saveProfile / clearProfile`、`loadEvidence / addEvidence / removeEvidence`（证据存在档案里）、`loadSavedOpportunityIds / saveSavedOpportunityIds / toggleSavedOpportunity / clearSavedOpportunityIds`、`loadGrants / saveGrants / grantsFor / clearGrants`、`clearAll`（现在也会清除第二阶段新增的键）。

第二阶段新增（新键：`journal`、`materials`、`plan_snapshots`、`user_posted_opportunities`、`share_settings`、`invitations`）。**Journal 与材料都按 `profile_id` 隔离**：同一浏览器里可能切换示例档案，各档案的 Journal、材料互不影响；读写时都带上当前档案的 `profile_id`。

**档案与证据**
- `createEmptyProfile(displayName?: string): StudentProfile` —— 纯构造、不写存储：非示例档案（`is_sample: false`），`display_name` 缺省 `'My profile'`，`evidence: []`，其余字段都不填（= 没填）。
- `updateProfile(patch: Partial<Omit<StudentProfile, 'id' | 'evidence'>>): StudentProfile | null` —— 把 patch 合并到当前档案并保存，返回保存后的档案；没有档案时先用 `createEmptyProfile()` 建一个再合并。**patch 中 `undefined` = 不改该字段；`null` = 清空该字段（保存为 null，判断时等于「没填」）**。`id`、`evidence` 不能通过 patch 修改（运行时也忽略）；`display_name` / `is_sample` 不接受 null（忽略）；示例档案编辑后 `is_sample` 仍为 true，除非 patch 明确给出 `is_sample`。写入失败（含 SSR）返回 null。
- `updateEvidence(evidenceId: string, patch: Partial<Omit<EvidenceItem, 'id'>>): StudentProfile | null` —— 修改一条证据（状态、标题、技能、链接、`prep_item_ids` 等），返回更新后的档案。**找不到档案或该证据时返回 null，且不写存储**。`undefined` = 不改；`null` = 清空，只对可空字段 `url` / `description` 生效，必填字段（`title` / `kind` / `skills` / `status` / `added_on`）忽略 null；要清空 `prep_item_ids` 传 `[]`（它不接受 null）；`id` 不能改。
- `prepLinkKey(opportunityId: string, prepItemId: string): string` —— 返回 `<opportunity_id>:<prep_item_id>`（证据关联准备项的推荐写法）。
- `linkEvidenceToPrep(evidenceId: string, opportunityId: string, prepItemId: string): StudentProfile | null` —— 把该键写入证据的 `prep_item_ids`（去重），返回更新后的档案；档案 / 证据不存在返回 null。
- `unlinkEvidenceFromPrep(evidenceId: string, opportunityId: string, prepItemId: string): StudentProfile | null` —— 解除关联（同时对剩余项去重；原本没关联也返回档案）；档案 / 证据不存在返回 null。

**Quest Journal**（按 (`profile_id`, `opportunity_id`) 唯一；条目只存 `material_ids`，材料见下一组）
- `loadJournal(profileId?: string): JournalEntry[]` —— 传 `profileId` = 只返回该档案的条目；不传 = 所有档案。损坏回退 `[]`，非法条目逐条丢弃，同 (`profile_id`, `opportunity_id`) 重复时保留第一条；条目内的 `history` / `tasks` 逐条过滤，`material_ids` 只留字符串并去重。
- `saveJournal(entries: JournalEntry[]): boolean` —— 整体保存（**覆盖所有档案的条目**；同 (`profile_id`, `opportunity_id`) 只留最后一条）；SSR / 写入失败返回 false。
- `getJournalEntry(profileId: string, opportunityId: string): JournalEntry | null`。
- `createJournalEntry(profileId: string, opportunity: Pick<Opportunity, 'id' | 'official_url'>, on: ISODate): JournalEntry` —— 纯构造、不写存储：`application: 'preparing'`、`submitted_on: null`、`eligibility_confirmation: 'unconfirmed'`、`decision: 'pending'`、`participated: null`、`history: [{ event: 'added', on }]`、无任务、无材料、`official_url` 抄自机会。
- `upsertJournalEntry(entry: JournalEntry): JournalEntry[]` —— 新增或替换（替换时保持原位置），返回**该档案**（`entry.profile_id`）更新后的条目列表；形状不对时不写，返回该档案现有列表（连 `profile_id` 都没有时返回 `[]`）。
- `removeJournalEntry(profileId: string, opportunityId: string): JournalEntry[]` —— 删除该档案在该机会上的条目，返回该档案剩下的条目。**删除条目不删材料**（可复用材料可能还被别的条目用；不再需要的材料用 `removeMaterial` 删）。
- `recordJournalEvent(profileId: string, opportunityId: string, event: JournalEvent, on: ISODate): JournalEntry | null` —— 记录一个事件：用 `lib/journal.ts` 的 `applyJournalEvent` 更新对应字段（见 `JournalEvent`）并在 `history` 追加 `{ event, on }`；同一事件同一天不重复追加。条目不存在或事件非法返回 null。不阻止不合常理的顺序（页面引导，见「页面必须遵守的约定」）。
- `toggleJournalTask(profileId: string, opportunityId: string, taskId: string, done: boolean, on?: ISODate): JournalEntry | null` —— `done: true` 时 `done_on = on`（没传为 null），`done: false` 时 `done_on = null`；条目或任务不存在返回 null。
- `clearJournal(profileId?: string): void` —— 不传 = 清空全部条目（所有档案）；传 = 只清该档案的条目。

**申请材料**（单独存，按 `id` 唯一；**可复用材料只有一条记录**，被多个条目的 `material_ids` 引用，改一次状态所有引用它的条目都看到）
- `loadMaterials(profileId?: string): Material[]` —— 传 `profileId` = 只返回该档案的；不传 = 全部。损坏回退 `[]`，非法条目逐条丢弃，同 id 重复时保留第一条。
- `upsertMaterial(material: Material): Material[]` —— 新增或替换（按 id，替换时保持原位置），返回该档案（`material.profile_id`）更新后的材料列表；形状不对时不写，返回该档案现有列表（连 `profile_id` 都没有时返回 `[]`）。
- `removeMaterial(id: string): boolean` —— 删除一份材料，并从所有 Journal 条目的 `material_ids` 里移除它；返回是否找到并删除（SSR / 不存在为 false）。
- `setMaterialStatus(id: string, status: MaterialStatus): Material | null` —— 设置材料状态；材料不存在或状态非法返回 null。
- `clearMaterials(profileId?: string): void` —— 不传 = 清空全部材料（并清空所有条目的 `material_ids`）；传 = 只清该档案的材料（并清空该档案条目的 `material_ids`）。

**规划快照**
- `loadPlanSnapshots(opportunityId?: string, profileId?: string): PlanSnapshot[]` —— 旧 → 新（按 `taken_on`，同一天按插入顺序）；可按机会、档案过滤（不传 = 不过滤）。
- `pushPlanSnapshot(snapshot: PlanSnapshot, keep = 5): PlanSnapshot[]` —— 追加一个快照（同 id 先移除旧的，新的算作最新插入）；**每个 (`profile_id`, `opportunity_id`) 按插入顺序只保留最近插入的 `keep` 条（缺省 5，至少 1）**，刚推入的一定保留（即使它的 `taken_on` 比已有的都早）；**返回该 (`profile_id`, `opportunity_id`) 保留下来的快照（按 `taken_on` 旧 → 新）**，不是全部快照。
- `latestPlanSnapshot(opportunityId: string, profileId: string): PlanSnapshot | null`。
- `clearPlanSnapshots(opportunityId?: string): void` —— 不传 = 清空全部；传 = 只清该机会的快照（所有档案）。

**用户发布的机会**（Connect 本地示例）
- `loadUserPostedOpportunities(): Opportunity[]` —— 不是 `source_tier: 'user_posted'` 且 `is_sample: true` 的条目一律丢弃。
- `addUserPostedOpportunity(opp: Opportunity): Opportunity[]` —— 添加（同 id 替换），**传入的 `source_tier` / `is_sample` 一律被覆盖为 `'user_posted'` / `true`**（用户发布的机会永远不能伪装成官网核实的机会）；返回更新后的列表。
- `removeUserPostedOpportunity(id: string): Opportunity[]` —— 删除并返回剩下的列表。
- `clearUserPostedOpportunities(): void`。

**分享设置**（Connect 本地示例；按 `profile_id` 唯一）
- `defaultShareSettings(profileId: string, on: ISODate, shareHandle?: string): ShareSettings` —— 纯构造：什么都不分享；`shareHandle` 不传时新生成一个不透明句柄（每次调用都不同——要让句柄稳定，请保存，或用 `getOrCreateShareSettings`）。
- `loadShareSettings(profileId: string): ShareSettings | null` —— 没有（或损坏）返回 null。
- `getOrCreateShareSettings(profileId: string, on: ISODate): ShareSettings` —— 有就返回；没有就用 `defaultShareSettings` 新建并保存（从此 `share_handle` 稳定）。SSR / 写入失败时仍返回新建的默认设置（未保存，句柄下次会不同）。
- `saveShareSettings(settings: ShareSettings): boolean` —— 按 `profile_id` 替换；形状不对、`share_handle` 已被别的档案使用、SSR 或写入失败返回 false。
- `profileIdForShareHandle(handle: string): string | null` —— 学生自己的浏览器里由句柄对回档案 id（邀请只带句柄）；找不到返回 null。
- `clearShareSettings(profileId?: string, on?: ISODate): void` —— 不传 = 清空全部分享设置（含句柄）；传 = 撤回该档案的分享：**恢复默认（什么都不分享）但保留原 `share_handle`**，这样已有的邀请与屏蔽仍然对得上（`updated_on` 用 `on`，没传沿用原日期）；该档案没有设置时什么都不做。
- `buildSharedProfileView(profile: StudentProfile, settings: ShareSettings | null): SharedProfileView | null` —— 纯函数，**只输出学生已授权的字段**：`share_handle` 抄自 settings（不含档案 id）；证据只含被勾选且档案里确实存在的，只取 `id` / `title` / `kind` / `skills` / `status`；技能只含被勾选且档案里确实有的；`interests` 仅在 `share_interests` 为 true 时给出；空白的 `collaboration_note` 视为 null；`alias` 为 `'Sample student'`（示例档案）或 `'Student'`。永不包含档案 id、显示名、学校名、地区、联系方式、身份标签、年级、预算。**settings 为 null、属于别的档案、没有 `share_handle`、或最终什么都没分享时返回 null**；档案损坏时不抛异常。

**邀请**（Connect 本地示例；**按 `share_handle` 关联**，发布者不知道档案 id）
- `loadInvitations(shareHandle?: string): Invitation[]` —— 可按被邀请学生的 `share_handle` 过滤（学生页面：先 `loadShareSettings(profileId)?.share_handle`，再用它读取）；非法条目（含 `is_sample` 不为 true 的）逐条丢弃。
- `saveInvitations(list: Invitation[]): boolean` —— 整体保存，`is_sample` 强制为 true；SSR / 写入失败返回 false。
- `addInvitation(inv: Invitation): Invitation[]` —— 添加（同 id 替换，`is_sample` 强制为 true），返回更新后的全部邀请。它不检查发布者是否已被屏蔽，显示前请用 `blockedPublisherIds` 过滤。
- `setInvitationStatus(id: string, status: InvitationStatus, on: ISODate): Invitation | null` —— 改为 `pending` 时 `responded_on = null`，否则 `= on`；邀请不存在或状态非法返回 null。
- `blockedPublisherIds(shareHandle: string): string[]` —— 该句柄（学生）屏蔽了的发布者 id（来自状态为 `blocked` 的邀请，去重）。
- `clearInvitations(): void`。

**全部清除**
- `clearAll(): void` —— 清除本应用（当前版本）写入的所有键，含第二阶段新增的六个键。

---

## ③ 目录归属（只改自己的）

| 负责人 | 目录 / 文件 |
|---|---|
| 主导 | `lib/types.ts`、`lib/store.ts`、`CONTRACT.md`、`lib/eligibility/`、`lib/reachability/`、`lib/path/`、`lib/gap/`（第二阶段新增）、`lib/planner/`（新增）、`lib/match/`（新增）、`lib/validation.ts`、`lib/tags.ts`（新增）、`lib/journal.ts`（新增）、`lib/format.ts`、`lib/` 根目录的共享测试（`lib/*.test.ts`，如 `lib/fairness.test.ts`、`lib/fairness-p2.test.ts`、`lib/store.test.ts`、`lib/demo-mainline.test.ts`）、`data/profiles.json`、`package.json`、`package-lock.json`、配置文件（`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.mts`）、`app/layout.tsx`、`app/page.tsx` |
| 主办方端与 Connect 负责人（目前由主导代管，之后可能交接） | `lib/joint/`、`app/organizer/`、`data/scenarios/`（不变）；`lib/connect/`（新增）、`app/connect/`（新增）、`data/connect/`（新增） |
| 队友 A | `data/opportunities.json`、`app/quests/` |
| 队友 B | `app/map/`、`app/passport/`、`app/journal/`（新增）、`components/rpg/`、`app/globals.css`、`app/tokens.css`、`app/base.css` |

需要改别人目录里的东西：找对方，或在群里说明后由对方改。

- **首页 `app/page.tsx`**：归主导；本阶段的首页改版交给队友 B 做，改之前在群里说一声即可。

- **新增依赖**：先在群里说一声，由主导统一加到 `package.json` / `package-lock.json`，避免 lockfile 冲突。
- **`app/layout.tsx`**：队友 B 做全站样式需要改时可以直接改，改之前在群里说一声。

---

## ④ 分支规则

- 第二阶段每人只在自己的分支提交（从最新的 `main` 切出）：主导 `feat/core-p2`、主办方端与 Connect 负责人 `feat/joint-p2`、队友 A `feat/quests-p2`、队友 B `feat/map-p2`。
- **不直接推 `main`**。合并一律走 Pull Request，由主导检查后合并，合并方式选 **Create a merge commit**。
- 开 PR 之前：先把最新的 `main` 合进自己的分支；本地跑通 `npm run build`、`npm test`、`npx tsc --noEmit`、`npm run lint` **四条**。
- 提交信息里不加任何 AI 署名（`Co-Authored-By`、`Generated with …` 等）。
- **一个工作目录只给一个 AI 会话用**：两个会话同时在同一个文件夹里切分支、开服务，会互相覆盖。要并行就各自克隆一份。

---

## ⑤ 数据约定

- `data/opportunities.json`：每条机会必须**真实**，有 `official_url`（主办方官网）、`verified_on`（核实日期）、`verified_by`，**由人打开官网确认**。AI 给的机会信息不直接采用。
- 每条官方要求都要有 `source_text`（官网原文）。看不清的要求用 `type: 'manual'`（结果为 unknown，提示向官方确认），不要猜。
- 示例学生、示例发布者、示例主办方、模拟结果：数据里标 `is_sample: true`。**界面文字统一用英文**：示例数据标 `Sample`，模拟结果标 `Simulated`，占位标 `Placeholder`。
- 不把模拟结果说成真实影响；可达 ≠ 录取；本地示例 ≠ 真实连接。
- **来源等级 `source_tier`**：`official`（由人打开主办方官网核实；`data/opportunities.json` 的真实机会都是这一级，缺省即按它处理）/ `trusted_aggregator`（来自可信的机会汇总站，仍需以主办方官网为准）/ `user_posted`（用户发布；本阶段只来自 Connect 的本地示例，发布者是标 `Sample` 的虚构账户）。界面上**用户发布的机会必须与官网核实的机会用不同标记**，不得显示为「已核实」，并且它**一定同时是示例**（`is_sample: true`，界面同时标 `Sample`）。
- **示例档案**（`data/profiles.json`，现在 4 个，全部 `is_sample: true`，显示名带 `Sample`）：
  - `sample-maya`：11 年级，加州城市；每周 4 小时、预算 20 美元；只有手机；有一条自报的 Python 证据；声明了低收入、第一代大学生等身份。
  - `sample-leo`：10 年级，蒙大拿州乡村；没有交通工具（最近的城市单程两小时）；有笔记本与家庭网络；每周 10 小时、预算 40 美元（第二阶段补上）；年龄、国籍、身份标签没填（相关判断为 unknown）。
  - `sample-ana`：12 年级，纽约州郊区；交通可靠、设备齐全；每周 12 小时、预算 200 美元；会 python 与 data_analysis，没有证据。
  - `sample-noor`（第二阶段新增）：`grade: 13` = 本科第 1 年（大一），俄亥俄州郊区；交通有限（公交只在工作日运行）；有笔记本与手机；每周 5 小时、预算 30 美元；有一条自报的 Python 项目证据；身份为本科生、第一代大学生。用于查看面向本科生的机会。
- **领域标签**：`Opportunity.fields` 与档案的 `interests` 用同一套标签，数据里推荐统一写成小写加下划线（如 `computer_science`）。目前 `data/opportunities.json` 的 `fields` 里还有连字符写法（如 `biomedical-research`）；比较时一律用 `lib/tags.ts` 的 `normalizeTag`（连字符、下划线、空格、大小写视为相同），所以写法不同不影响 `explainMatch` / `findAlternatives` 的结果。页面做领域筛选时也必须用 `normalizeTag`。
- 测试用的虚构机会写在测试文件里，链接用 `example.com`，不要混进 `data/opportunities.json`。
- 学生填写的内容只存浏览器 localStorage，无后端、无数据库。API key 只放 `.env`。
- 不做排行榜、抽卡、签到；不用游戏进度锁住真实机会。

---

## ⑥ 改动契约的流程

- 修改 `CONTRACT.md` 或 `lib/types.ts`：**先找主导**，说明要改什么、为什么、影响谁；主导确认（并经用户批准）后由主导修改并通知全员。
- 不要在自己的分支里私自改这两个文件；需要临时类型就在自己的目录里定义，之后再提议合并进契约。
- 发现代码与本文不一致：告诉主导，不要自己改约定。

---

## ⑦ 本地运行

```bash
npm install        # 安装依赖
npm run dev        # 本地开发，打开 http://localhost:3000
npm test           # Vitest，运行 lib/**/*.test.ts
npm run build      # 生产构建（提交前必须通过）
npx tsc --noEmit   # 类型检查（开 PR 前必须通过）
npm run lint       # ESLint（开 PR 前必须通过）
```

---

## 变更记录

- 2026-11-17：三个学生端函数（`checkEligibility` / `analyzeReachability` / `planRoutes`）新增可选 `options.today`（类型 `EvalOptions`），向后兼容。调用方无需修改；界面层若需要日期相关判断，应传入 `{ today }`。
- 2026-11-17：四个学生端函数由 mock 换为真实实现（签名不变）；更新状态说明与接入提示。
- 2026-11-17：三项约定确认：
  - **`verifyPlan` 第三参数确定保留**（可选 `VerifyOptions`，不传按 protect 处理）。注释澄清，调用方无需修改。
  - **共享资源计量单位**：`Intervention.capacity` / `unit_cost_usd` 按不同学生计，同一 (`intervention_id`, `student_id`) 的多条 `Allocation` 只计一次成本（注释澄清，字段不变）；`ResourceGrant` 新增可选字段 `intervention_id`（向后兼容）。**`ResourceGrant.opportunity_id` 改为 `string | null`**（`null` = 对该学生所有机会有效）——**可能需要调用方改代码**：把它当必填字符串使用的代码需要加空值判断。`analyzeReachability` 与 `lib/store.ts`（`grantsFor`、读取校验）已同步支持 `null`；只有 `=== null` 表示所有机会，缺该字段的 grant 不生效。已在 `existing_grants` 中的 (`intervention_id`, `student_id`) 在方案里成本记 0、不重复占容量；`verifyPlan` 在 tradeoff 缺 `loss_cap` 时判不通过。
  - **目录归属补充**：`package.json`、`package-lock.json`、配置文件、`app/layout.tsx`、`app/page.tsx` 归主导；新增依赖先在群里说，由主导统一加；队友 B 改 `app/layout.tsx` 前说一声即可直接改。
- 2026-11-17：**联合求解契约扩展（全部向后兼容）**，原 Charles 负责的 `lib/joint/`、`app/organizer/`、`data/scenarios/` 与 `feat/joint` 分支由主导接手（分支名与合并顺序不变）：
  - **新资源类型 `alternative_access`**（`SupportType` 并集新增一个取值）：替代参与方式（如线上参与入口、卫星会场），让学生不必前往主会场。`SUPPORT_RESOLVES.alternative_access = 'transport'`；`analyzeReachability` 中 approved 的 `alternative_access` 与 `transport_subsidy` 同等化解 transport 障碍，pending 的列入 `pending_grant_ids`。**如果你的代码对 `SupportType` 做了穷尽式 `switch`（或 `Record<SupportType, …>` 映射），需要补一个 `alternative_access` 分支 / 键**，否则 TypeScript 会报错。`lib/store.ts` 不校验 grant 的 `type`，无需改动。
  - 新可选字段：`Intervention.status?`、`requires?`、`capacity_scope?`；`Scenario.opportunity_time_slots?`；`SolveOptions.required_intervention_ids?`、`min_gain?`；`VerifyOptions.assume_approved_intervention_ids?`、`required_intervention_ids?`、`min_gain?`；`JointResult.alternative?`、`conditional?`、`verification?`。
  - 新类型：`JointOutcome`、`JointAlternative`、`JointConditional`；`JointResult` 改为 `extends JointOutcome`，字段集合与类型不变。
  - `VerifyCheck.name` 建议取值补充 `input_validity`、`approval`、`prerequisite`、`deadline`、`organizer_requirements`、`metrics`。
  - 原「联合求解的计量口径」并入新的「联合求解模型」一节（原有口径保留）；当时 `solveJoint` / `verifyPlan` 尚未实现（占位）。
- 2026-11-17：**`solveJoint` / `verifyPlan` 已实现**（签名不变），按第 1 层评审修订「联合求解模型」（只影响联合求解，学生端函数不变）：
  - 第 6 条：不得返回「OPTIMAL 但复核不通过」——内部复核不通过时返回 `UNSUPPORTED_INPUT` + 空方案并保留失败的复核；`conditional` / `alternative` 同理不给出该方案。`JointConditional.status` 因此可能是 `UNSUPPORTED_INPUT`（仅此一种情况）。
  - 第 6 条：`UNSUPPORTED_INPUT` 补充——时段标签必须是非空字符串；`evaluation_date` 必须严格 `YYYY-MM-DD`；措施与已有 grant 的 `amount_usd` / `hours_per_week` 不得为负或非有限；`mode` 只能是 protect / tradeoff；形状不对（非数组、非对象条目）。求解器与验证器各自实现、规则相同。第 0 条：`null` 视同未给，`capacity` 为 `undefined` 视同不限。
  - 第 7 条（损失）：合法输入下 `L` 恒为 0；`tradeoff` / `loss_cap` 仅为向前兼容保留。
  - 第 5 条：并列规则在「分配条数更少」之后加「选中措施数更少」，并写明规范化（不选无分配、非必须、非依赖的措施）与「名额并列按学生编号，不代表谁更需要」。
  - 第 3 条第 6 款：**pending 的已有 grant 只占容量、不再免成本**（免成本只认 approved）。**可能影响调用方**：带 pending 已有 grant 的场景，成本会比之前高。
  - 第 6 条 `SEARCH_LIMIT_REACHED`：保留最近 8 个改进候选，达到上限时按目标顺序依次复核、返回第一个通过的。
  - `withEnabledInterventions`：前置依赖未全部启用的措施改为一并移除（之前是删掉 `requires` 引用，会悄悄放松依赖）；新增 `resolveEnabledInterventions`。
  - 「接入提示」改为 What-if 的用法（`runWhatIf`、直接调用时自行复核、模拟标注、不显示单个学生信息）。字段与签名都没有变化。
- 2026-11-17：**联合求解第 3 层契约**（权衡分析、公平底线、基线对比）。全部为向后兼容的新增，现有字段不改名、不删、不改类型：
  - 新可选字段：`JointPlan.revoked_grant_ids?`；`JointOutcome.lost_pairs?`、`revocations?`、`fairness?`；`SolveOptions.fairness_floors?`、`VerifyOptions.fairness_floors?`。
  - 新类型：`GrantRevocation`、`FairnessFloor`、`FairnessReport`、`SoftRequirementKey`、`BaselineId`、`BaselineMetrics`、`BaselineRow`、`BaselineComparison`；新常量 `STUDENT_STATUSES`、`SOFT_REQUIREMENT_RELAX_ORDER`。
  - `JointAlternative.relaxed` 的取值并集新增 `'fairness_floors'`（类型改写为 `SoftRequirementKey[]`）。**如果你的代码对它做了穷尽式映射（如 `Record<…, string>`），需要补一个 `fairness_floors` 键**（`lib/joint/whatif.ts` 已补）。
  - 模型变化（「联合求解模型」）：第 2、3 条新增撤回已有 grant 与硬约束第 8 条 `revocation`；第 4 条新增公平底线；第 5 条目标顺序改为 N → L → 成本 → 分配条数 → 措施数 → 撤回数 → 字典序；第 6 条新增 UNSUPPORTED_INPUT 条件（existing grant 的 `id` 必须是唯一字符串；`fairness_floors` 格式）与三项软要求统一的放松规则（两项时与原规则一致）；第 8 条新增检查项 `revocation`、`fairness`，`capacity` / `cost_accounting` / `coverage_loss` / `metrics` 按撤回更新；新增第 10 条基线对比。删去「合法输入下 L 恒为 0」「tradeoff 仅为向前兼容」的说法。
  - **行为变化**：选中与「已有 grant 所属措施」互斥的措施时，现在必须撤回那些 grant（此前不要求，那些 grant 照样生效）。由此可能产生 `L > 0`，protect 模式下这样的方案不可行。existing grant 的 `id` 不唯一的场景现在是 `UNSUPPORTED_INPUT`。
  - **补充（用户决定）**：**保护模式不动任何已有承诺**——`mode` 为 protect（默认）时 `revoked_grant_ids` 必须为空，强制与自愿撤回都不允许（approved 与 pending 一样）；因此 protect 下与「有可撤回已有 grant 的措施」互斥的措施不能被选中。只有 tradeoff 模式（给出 `loss_cap`）允许撤回，约束 `L ≤ loss_cap`。验证器的 `revocation` 检查在 protect 下对任何非空 `revoked_grant_ids` 判不通过（第 3 条第 8 款 d、第 5 条、第 8 条已同步）。
  - 当时 `solveJoint` / `verifyPlan` 尚未实现这些规则，`compareBaselines` 尚未编写（均已实现，见下一条）。
- 2026-11-17：**第 3 层评审修订（只影响联合求解；字段与签名不变）**：
  - **行为变化：场景外学生的已有 grant 不可撤回**（第 0 条「可撤回」增加「`student_id` 在场景内」）。它们照样占容量、approved 的照样免成本；与「有这类 grant 的措施」互斥的措施在 protect 与 tradeoff 下都不能选中（第 3 条第 2 款，归入 `mutual_exclusion`）；强制撤回只针对可撤回的 grant。此前这类 grant 会被强制或自愿撤回。
  - **行为变化：运行中的措施不能被移除**（第 9 条）：`withEnabledInterventions` / `resolveEnabledInterventions` 不再把有已有 grant 的措施移出场景，未勾选时保留但 `opportunity_ids = []`（不接受新分配）；删去「被移除措施的已有 grant 变为指向场景外」的说法。例如只勾选周末卫星会场时，保护模式下它不能启用（G = 0，此前误为 G = 6、L = 0）；权衡模式损失上限 3 时启用它并强制撤回 3 条接驳车 grant（L = 3）。`resolveEnabledInterventions` 的返回值新增 `running`、`frozen`（只增字段）。
  - 第 8 条 `metrics`：options 没给 `fairness_floors` 时不比较 plan 自带的 `fairness`。
  - 第 3 条第 8 款：写明 `loss_cap` 按（学生, 机会）对计，tradeoff 且 `loss_cap = 0` 不等同 protect。
  - 第 4 条：公平底线的分母保持原定义；新增「覆盖上界」说明（只用于说明文字与页面显示）。
- 2026-11-17：**第 3 层已实现（状态更新，规则条文不变）**：`solveJoint` / `verifyPlan` 支持撤回已有 grant、权衡模式（`loss_cap`）与公平底线（`revocation`、`fairness` 检查）；新增 `compareBaselines`（`lib/joint/baselines.ts`，从 `lib/joint` 导出），A / B / C / joint 四行，说明书中的基线 D 未实现。`runWhatIf` 新增可选第三参数 `availableFloors`，`WhatIfInput` 新增 `fairnessFloorIds?`、`minRatioOverrides?`，视图新增模式说明、失去 / 收回汇总、公平底线结果与基线对比（只含人数与汇总）；`/organizer` 页面可切换两个演示场景。全部为模拟结果。
- 2026-11-18：**第二阶段契约**。全部向后兼容（新类型、新的可选字段、新常量、新函数、新存储函数；现有字段与函数签名不改名、不删除、不改类型）：
  - 新类型（「① 类型一览」第二阶段一节）：`SourceTier`、`MaterialKind`、`GapCategory` / `GapBasis` / `GapItem` / `GapAnalysis`、`AlternativeSuggestion`、`MatchReasonKind` / `MatchReason` / `MatchExplanation` / `MatchOptions`、`CrossPlanItem` / `MaterialReuse` / `WeeklyLoad` / `CrossPlan` / `CrossPlanOptions`、`JournalApplicationStatus` / `EligibilityConfirmation` / `JournalDecision` / `JournalEvent` / `JournalHistoryItem` / `JournalTask` / `MaterialStatus` / `Material` / `OutcomeFeedback` / `JournalEntry`、`PlanTrigger` / `PlanSnapshotInputs` / `PlanSnapshot`、`PublisherKind` / `SamplePublisher` / `ShareSettings` / `SharedProfileView` / `InvitationStatus` / `Invitation`；新常量 `SOURCE_TIERS`、`MATERIAL_KINDS`、`MATERIAL_STATUSES`、`GAP_CATEGORIES`、`MATCH_REASON_KINDS`、`JOURNAL_EVENTS`、`PLAN_TRIGGERS`。
  - 新的可选字段：`Opportunity.source_tier?`、`Opportunity.posted_by?`；`PrepItem.material_kind?`、`PrepItem.reusable_across_opportunities?`。
  - 四个新共享函数（示例版本，签名为最终版）：`analyzeGaps`（`lib/gap`）、`findAlternatives` 与 `explainMatch`（`lib/match`，`explainMatch` 的第三参数为 `MatchOptions`，可传 `grants`）、`planAcrossOpportunities`（`lib/planner`）；新增「第二阶段新函数：现在的示例版本做了什么、还没做什么」一节与页面必须遵守的约定。要点：`findAlternatives` 给了 `today` 时不返回截止已过的机会；`planAcrossOpportunities` 的 `weekly_load` 按天分摊（`WeeklyLoad.days`，`hours_available` 按该周落在计划窗口内的天数折算），`feasible_alone` 用同一口径（与 `Route.feasible_by_deadline` 在临界日可能不同，联合规划页以 `feasible_alone` 为准），出错的机会以 `insufficient_data` 留在 `items` 里，`CrossPlanItem.hours_saved_by_reuse` 写明复用少算的小时。
  - Quest Journal：一个条目 = 一个档案 × 一个机会；申请、官方资格确认、录取决定、是否参与四项独立（`application` / `eligibility_confirmation` / `decision` / `participated`），变化用事件记录（`history`）；材料单独存放、条目用 `material_ids` 引用。纯函数 `applyJournalEvent` / `journalHeadline` / `isJournalEvent` 在新文件 `lib/journal.ts`。
  - 领域标签：新文件 `lib/tags.ts`（`normalizeTag` / `normalizedTagSet` / `sharedTags`），标签比较一律用它；`sample-noor` 的 `interests` 改为下划线写法。
  - `lib/store.ts` 新增档案编辑、证据编辑与准备项关联、Quest Journal（按档案隔离）、申请材料（单独存）、规划快照、用户发布的机会、分享设置（`share_handle`）、邀请（按 `share_handle`）的存储函数与 6 个新键；`clearAll` 也清除新键。`lib/validation.ts` 校验 `source_tier`、`posted_by`、`material_kind`、`reusable_across_opportunities`，并要求 `user_posted` 的机会 `is_sample: true`。
  - 分享不暴露档案 id：`ShareSettings` 新增 `share_handle`；`SharedProfileView` 与 `Invitation` 用 `share_handle`（没有 `profile_id` 字段）。
  - 公平性：`lib/fairness-p2.test.ts` 对照测试第二阶段四个函数；`lib/fairness.test.ts` 的静态守卫也检查 `lib/gap/`、`lib/match/`、`lib/planner/`、`lib/tags.ts`、`lib/journal.ts`。
  - 目录归属：主导新增 `lib/gap/`、`lib/planner/`、`lib/match/`、`lib/validation.ts`、`lib/tags.ts`、`lib/journal.ts`、`lib/format.ts`、`lib/` 根目录的共享测试；「主导（接手 Charles 的任务）」改称「主办方端与 Connect 负责人」（目前由主导代管），新增 `lib/connect/`、`app/connect/`、`data/connect/`；队友 B 新增 `app/journal/`、`app/tokens.css`、`app/base.css`；首页改版交给队友 B。
  - 分支规则：第二阶段分支 `feat/core-p2` / `feat/joint-p2` / `feat/quests-p2` / `feat/map-p2`；合并一律走 PR、以 merge commit 合并；开 PR 前合入最新 main 并跑通四条检查命令。
  - 数据约定：`source_tier` 的取值与界面标记；领域标签推荐小写加下划线，比较用 `normalizeTag`；界面标记改为英文 `Sample` / `Simulated` / `Placeholder`。
  - 「联合求解模型」第 9 条：运行中措施的徽标按界面实际文字写为 `Running`（规则不变）。
  - **行为变化（只有这一处需要提醒）**：示例档案 `sample-leo` 补了 `budget_usd: 40`（此前没填，与预算相关的判断为 unknown / null），并新增第 4 个示例档案 `sample-noor`（大一学生）。**依赖「恰好 3 个示例档案」的代码（如写死数量、下标或遍历结果的断言）需要更新**。

