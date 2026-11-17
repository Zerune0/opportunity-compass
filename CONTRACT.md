# CONTRACT — Opportunity Compass 团队契约

给四位队友看的共享约定。**类型以 `lib/types.ts` 为准**；本文件与代码不一致时，以代码为准并立刻告诉主导。
产品全貌见 `docs/`，四天范围以本文件为准。

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
| `Scenario` | 主办方 what-if 场景（一律示例/模拟） | `students`、`opportunities`、`interventions`、`budget_usd`、`evaluation_date`、`existing_grants`（带 `intervention_id` 的已有 grant 不论 status 都占用该措施的容量，按不同学生计；只有 **approved** 的已有 grant 让同一 (措施, 学生) 的分配免成本）、`opportunity_time_slots?`（机会 id → 非空字符串时段标签；未列出的机会归入同一个默认时段） |
| `Intervention` | 可选支持措施 | `type`、`resolves`（障碍类型，仅展示）、`unit_cost_usd`（每服务一位**不同学生**的边际成本）、`fixed_cost_usd`（只计一次）、`capacity`（最多可服务的**不同学生**人数；null 或缺省 = 不限）、`amount_usd?` / `hours_per_week?`（给出时须非负）、`opportunity_ids?`、`mutually_exclusive_with`、`status?`（approved / pending，缺省 approved）、`requires?`（前置依赖）、`capacity_scope?`（total / per_time_slot，缺省 total）。同一学生凭同一措施参加多个机会，只占 1 个容量、只计一次成本 |
| `SolveOptions` | `solveJoint` 的可选第二参数 | `mode?`（protect / tradeoff）、`loss_cap?`、`max_search_nodes?`、`required_intervention_ids?`、`min_gain?`（后两项是主办方的**软要求**） |
| `Allocation` | 一次资源分配（某措施用于某学生的某机会） | `intervention_id`、`student_id`、`opportunity_id`、`cost_usd`。同一 (`intervention_id`, `student_id`) 可有多条（对应不同机会）；容量与成本按不同的 (`intervention_id`, `student_id`) 计数；其中只有一条的 `cost_usd` 记 `unit_cost_usd`，其余记 0；若该 (`intervention_id`, `student_id`) 已出现在 `existing_grants` 中（grant 带相同 `intervention_id`），容量不再重复占用（已有 grant 已占 1 个，不论 status）；若该 grant 为 **approved**，其所有 `Allocation` 的 `cost_usd` 还都记 0（pending 的不免成本） |
| `JointPlan` | 候选方案（`verifyPlan` 的输入） | `selected_intervention_ids`、`allocations` |
| `JointOutcome` | 一个方案的结果指标（不含状态） | `JointPlan` 字段 + `R1`、`G`、`L`、`N`、`cost` |
| `JointAlternative` | INFEASIBLE 时只放松软要求后的替代方案 | `JointOutcome` 字段 + `relaxed`（放松了 `required_intervention_ids` / `min_gain` 中的哪些）、`note` |
| `JointConditional` | 条件性结果（「如果这些 pending 措施获批，则……」，未生效） | `JointOutcome` 字段 + `status`、`assumed_approved_intervention_ids`、`note` |
| `JointResult` | 联合求解结果（`extends JointOutcome`，原有字段不变） | `status`（OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT）、`selected_intervention_ids`、`allocations`、`R0`、`R1`、`G`、`L`、`N`、`cost`（`marginal_usd` = 各 Allocation 的 `cost_usd` 之和）、`notes`；新增可选 `alternative?`、`conditional?`、`verification?` |
| `EvalOptions` | `checkEligibility` / `analyzeReachability` / `planRoutes` 的可选末位参数 | `today?: ISODate`（评估基准日；不传时不读系统时间，依赖日期的判断按信息不足处理） |
| `VerifyOptions` | `verifyPlan` 的可选第三参数（已确认保留） | `mode`、`loss_cap`（均可选，类型同 `SolveOptions`）；复核损失时用，不传按 protect 处理（损失必须为 0）；`mode: 'tradeoff'` 但没给 `loss_cap` 时判为不通过。新增可选 `assume_approved_intervention_ids?`（复核条件性方案时把这些 pending 措施当作已批准）、`required_intervention_ids?`、`min_gain?`（与 `SolveOptions` 同义，传了才检查） |
| `VerifyResult` | 独立复核 | `passed`、`checks[]`（`name`、`passed`、`detail`）；`capacity` / `cost_accounting` 按 `Allocation` 的口径复核（按不同 (`intervention_id`, `student_id`) 计）；检查项名称见「联合求解模型」 |

`R0 / R1 / G / L / N`（出自 `docs/product-scope.md` Shared constraints）：在同一评估时间和假设下，
`R0` = 原始覆盖（不加新措施时现实可达的学生-机会对集合），`R1` = 全局分配后的覆盖；
`G = |R1 \ R0|`（增益），`L = |R0 \ R1|`（损失），`N = G − L`（净值）。默认 protect 模式要求 `L = 0`；tradeoff 模式必须显式给 `loss_cap`。

常量：`ELIGIBILITY_STATUSES`、`BARRIER_TYPES`、`ROUTE_TYPES`、`JOINT_STATUSES`、`SUPPORT_RESOLVES`（支持类型 → 化解的障碍类型）。

---

## ② 六个共享函数

全部是 `lib/` 下的**纯函数**：确定性、无 IO、不读 localStorage、不调 AI。AI 不参与资格判断和求解。

| 函数 | 位置 | 签名 | 状态 |
|---|---|---|---|
| `checkEligibility` | `lib/eligibility` | `(profile: StudentProfile, opp: Opportunity, options?: EvalOptions) => EligibilityResult` | 已实现 |
| `analyzeReachability` | `lib/reachability` | `(profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[], options?: EvalOptions) => ReachabilityResult` | 已实现 |
| `planRoutes` | `lib/path` | `(profile: StudentProfile, opp: Opportunity, options?: EvalOptions) => PlanResult` | 已实现 |
| `diffRoutes` | `lib/path` | `(before: PlanResult, after: PlanResult) => RouteDiff` | 已实现 |
| `solveJoint` | `lib/joint`（主导，接手 Charles 的任务） | `(scenario: Scenario, options?: SolveOptions) => JointResult` | 已实现（精确搜索，见「联合求解模型」） |
| `verifyPlan` | `lib/joint`（主导，接手 Charles 的任务） | `(scenario: Scenario, plan: JointPlan, options?: VerifyOptions) => VerifyResult` | 已实现（独立复核，不 import 求解器） |

`VerifyOptions = { mode?: 'protect' | 'tradeoff'; loss_cap?: number; assume_approved_intervention_ids?: string[]; required_intervention_ids?: string[]; min_gain?: number }`（字段类型沿用 `SolveOptions`）。**第三参数确定保留，为可选**：复核损失 `L` 时需要知道模式与损失上限。不传（或不给 `mode`）按 protect 处理，即损失 `L` 必须为 0；`mode: 'tradeoff'` 时 `L ≤ loss_cap` 才算通过；`mode: 'tradeoff'` 但没给 `loss_cap` 时 `verifyPlan` 判为不通过（与 `solveJoint` 在同样输入下返回 `UNSUPPORTED_INPUT` 一致）。

导入：`import { checkEligibility } from '@/lib/eligibility'`，类型 `import type { Opportunity } from '@/lib/types'`。
**现有参数不会删改；如需扩展，只在末位新增可选参数（向后兼容，见文末「变更记录」），其余只换实现**。六个共享函数都已是真实实现。

### 联合求解模型（`solveJoint` / `verifyPlan` 的实现者只读这一节）

本节逐条可执行；`lib/types.ts` 中联合求解相关注释是它的摘要，两处必须一致。所有结果都是**模拟**，不是真实影响；可达 ≠ 录取。

**0. 记号与通用规则**
- `S` = `scenario.students`，`O` = `scenario.opportunities`，`I` = `scenario.interventions`；所有（学生, 机会）对 = `S × O`。
- `E` = `scenario.existing_grants ?? []`。
- 「措施 i 已批准」= `i.status !== 'pending'`（缺省算 approved）。条件性求解 / 复核时，`assume_approved` 列出的 pending 措施也算已批准。
- 「空方案」= `selected_intervention_ids = []`、`allocations = []`、`cost = { fixed_usd: 0, marginal_usd: 0, total_usd: 0 }`。
- 字符串比较一律按 UTF-16 码元（JS 的 `<` / 默认 `sort()`），不用 `localeCompare`。
- 稳定排序：`selected_intervention_ids` 按 id 升序；`allocations` 按 (`intervention_id`, `student_id`, `opportunity_id`) 升序；`R0` / `R1` 按 (`student_id`, `opportunity_id`) 升序。
- 金额与指标比较允许 `1e-6` 的浮点误差（`a ≤ b` 判为 `a ≤ b + 1e-6`；相等判为 `|a − b| ≤ 1e-6`）。
- **null 视同未给**：`SolveOptions` / `VerifyOptions` 中值为 `null` 的字段（如 `loss_cap`、`min_gain`、`required_intervention_ids`、`mode`），措施的 `capacity`（`undefined` 视同 `null` = 不限）/ `opportunity_ids` / `requires` / `mutually_exclusive_with` / `amount_usd` / `hours_per_week`，以及 `existing_grants`、`opportunity_time_slots` 为 `null` 时，都按「没给」处理。例外：`fixed_cost_usd` 给出（含 `null`）时必须是非负有限数。

**1. 评估**
- `reach(pair, grants)` = `analyzeReachability(student, opp, grants, { today: scenario.evaluation_date }).reachable === true`。`null`（信息不足）一律当作**不可达**，不猜。`grants` 传整个列表即可（`analyzeReachability` 自己按 `student_id` / `opportunity_id` 筛选）。
- **R0** = `{ pair ∈ S × O : reach(pair, E) }`。

**2. 方案生效方式**
- 每条 `Allocation (i, s, o)` 合成一条 grant：
  `{ id: 'alloc:' + i + ':' + s + ':' + o, student_id: s, opportunity_id: o, intervention_id: i, type: I[i].type, amount_usd: I[i].amount_usd ?? null, device: I[i].device ?? null, hours_per_week: I[i].hours_per_week ?? null, status: 'approved', provider: scenario.title, is_sample: true }`。
- **R1** = `{ pair ∈ S × O : reach(pair, E ∪ 全部合成 grant) }`。`G = |R1 \ R0|`，`L = |R0 \ R1|`，`N = G − L`。
- 措施只能通过 grant 化解现实障碍（设备 / 交通 / 费用 / 时间），**不能改变官方资格**。措施的效果完全由合成 grant 的 `type` 与 `amount_usd` / `device` / `hours_per_week` 经 `analyzeReachability` 决定；`Intervention.resolves` 只用于展示，求解与复核都不读它。
- 未选中措施的 existing grant 照样生效（计入 R0 与 R1），方案不能撤销已有 grant。

**3. 硬约束**（任何情况下都不得放松）
1. **措施合法**（检查名 `approval`）：`selected_intervention_ids` 中每个 id 都在 `I` 里、不重复、已批准（见第 0 条）。
2. **互斥**（`mutual_exclusion`）：选中集合内没有互斥的两项。`mutually_exclusive_with` 按对称关系处理：A 列出 B，或 B 列出 A，都算互斥。
3. **前置依赖**（`prerequisite`）：每个选中措施的 `requires` 全部在选中集合里（只要求被选中，不要求有 Allocation）。依赖成环时要么都选、要么都不选。
4. **分配合法**（`allocation_validity`）：每条 Allocation 的 `intervention_id` 是选中的措施，`student_id` ∈ `S`，`opportunity_id` ∈ `O`；该措施给出 `opportunity_ids` 时必须包含该机会；没有重复的 (i, s, o)。选中但没有任何 Allocation 的措施是允许的（仍计固定成本）。
5. **容量**（`capacity`）：对每个选中措施 i（`capacity` 为 null 时不限）：
   - 时段：`slot(o)` = `scenario.opportunity_time_slots?.[o]`；没列出的机会都属于同一个**默认时段**，它与任何显式标签都不同。
   - 已占用：`E_i` = `E` 中 `intervention_id === i` 的 grant（**不看 status，也不看 student_id 是否在场景内**：已有承诺就占位，保守）。
   - `capacity_scope` 缺省或为 `'total'`：`|{ g.student_id : g ∈ E_i } ∪ { s : (i, s, ·) ∈ allocations }| ≤ capacity`。
   - `'per_time_slot'`：对每个时段 t：`|{ g.student_id : g ∈ E_i 且 (g.opportunity_id === null 或 slot(g.opportunity_id) = t) } ∪ { s : (i, s, o) ∈ allocations 且 slot(o) = t }| ≤ capacity`。要检查的时段 = 所有显式标签 + 默认时段。
   - 即：同一学生在同一范围内只计 1 次；已被 existing grant 占用的学生再分配不重复占容量。
6. **成本**（`cost_accounting` 与 `budget`）：
   - `fixed_usd` = 选中措施的 `fixed_cost_usd ?? 0` 之和（每项一次）。
   - `marginal_usd` = 各 Allocation 的 `cost_usd` 之和。
   - 对每个出现在 allocations 中的 (i, s)：若 `E` 中有 `intervention_id === i`、`student_id === s` 且 **`status === 'approved'`** 的 grant，则这组 Allocation 的 `cost_usd` 全为 0（pending 的已有 grant 只占容量、**不免成本**）；否则这组中**恰好一条**记 `unit_cost_usd`、其余为 0（`unit_cost_usd` 为 0 时全为 0）。求解器把全额记在这组按稳定排序的第一条上；复核只检查「恰好一条为全额、其余为 0」。
   - `total_usd = fixed_usd + marginal_usd ≤ scenario.budget_usd`（`budget` 检查）。
7. **损失**（`coverage_loss`）：`L = |R0 \ R1|`；`mode` 缺省或 `'protect'` 要求 `L = 0`（此时忽略 `loss_cap`）；`'tradeoff'` 要求给出 `loss_cap` 且 `L ≤ loss_cap`。
   - **合法输入下 `L` 恒为 0**：措施与已有 grant 的 `amount_usd` / `hours_per_week` 必须非负（第 6 条），`analyzeReachability` 对 grant 单调（多一条 approved grant 只会多化解障碍，不会让原本可达的对变为不可达）。`mode: 'tradeoff'` / `loss_cap` 仅为向前兼容保留（例如将来引入会占用学生时间的措施）。
- 原有口径（保留）：`Intervention.capacity` = 最多可服务的**不同学生**人数；`unit_cost_usd` = 每服务一位不同学生的边际成本；同一学生凭同一措施参加多个机会只占 1 个容量、只计一次成本；同一 (`intervention_id`, `student_id`) 可有多条 Allocation（对应不同机会），`JointCost.marginal_usd` 仍等于各 Allocation 的 `cost_usd` 之和；existing grant 已覆盖的 (`intervention_id`, `student_id`) 不重复占容量，其中 approved 的还让成本记 0。

**4. 软要求**（主办方自己提的，检查名 `organizer_requirements`；只有 INFEASIBLE 时才可放松，并且必须明示）
- `required_intervention_ids` 全部在选中集合里。
- `G ≥ min_gain`。

**5. 目标与确定性**
在满足全部硬约束和软要求的方案中：
1. 最大化 `N = G − L`；
2. 并列取 `cost.total_usd` 更小的；
3. 再并列取 Allocation 条数更少的；
4. 再并列取选中措施数（`selected_intervention_ids.length`）更少的；
5. 再并列取字典序最小：先逐元素比较排序后的 `selected_intervention_ids`（前缀更短者更小），再逐元素比较排序后的 allocations（按 (`intervention_id`, `student_id`, `opportunity_id`) 元组比较）。
同输入必须同输出；返回的数组都按第 0 条的稳定顺序排序。
- **规范化（由第 4 步保证）**：求解器返回的任何方案（主结果、`alternative`、`conditional`）中，每个选中措施要么至少有一条 Allocation，要么在（该方案仍要求的）`required_intervention_ids` 里，要么是前两类措施的（传递）前置依赖；其余措施不会被选中（去掉它们得到的方案同样可行、N / 成本 / 分配条数不变或更好、措施数更少）。
- 名额或预算不够、多名学生条件相同时，按学生编号顺序（字典序）决定——这是模拟中的确定性规则，**不代表谁更需要**；`notes` 中写明这一点。

**6. 状态**（按以下顺序判定）
- **`UNSUPPORTED_INPUT`**（不做评估；返回空方案，`R0 = R1 = []`，`notes` 写明原因；`alternative` / `conditional` / `verification` 为 null）。求解器（`validateJointInput`）与验证器（`input_validity`）**各自实现、规则相同**（第 0 条「null 视同未给」同样适用）：
  - 形状：`students` / `opportunities` / `interventions` 不是数组，或其中有不是「带字符串 `id` 的对象」的条目；`existing_grants` 给出但不是数组，或含非对象条目；`opportunity_time_slots` 给出但不是（非数组的）对象；
  - `budget_usd` 为负或非有限数；
  - `mode` 给出但不是 `'protect'` / `'tradeoff'`；`mode: 'tradeoff'` 但没给 `loss_cap`；`loss_cap` 或 `min_gain` 为负或非有限数；`max_search_nodes` 给出但不是正整数（只有求解器检查）；
  - 学生 / 机会 / 措施 id 有重复；
  - `required_intervention_ids`、`requires`、`mutually_exclusive_with` 给出但不是数组、引用了不存在的措施 id，或 `requires` / `mutually_exclusive_with` 引用了措施自己；`opportunity_ids` 给出但不是数组或引用了不存在的机会 id；`opportunity_time_slots` 的键引用了不存在的机会 id；
  - `opportunity_time_slots` 的**标签不是非空字符串**（如数字、`null`、`''`）；
  - `capacity`（非 null 时）、`unit_cost_usd`、`fixed_cost_usd` 为负或非有限数；
  - 措施的 `amount_usd` / `hours_per_week`，或 existing grant 的 `amount_usd` / `hours_per_week`（非 null 时）为负或非有限数；
  - `evaluation_date` 不是**严格**的 `YYYY-MM-DD` 合法日期（前后有空格、不补零、不存在的日期都不合法）；
  - 只算 existing grant 就已经超过某措施的容量（任一范围 / 时段）。
- **不得返回「OPTIMAL 但复核不通过」**（兜底）：求解器对自己将返回的方案调用 `verifyPlan` 复核（传入相同的 `mode` / `loss_cap` / `required_intervention_ids` / `min_gain`，条件性方案另传 `assume_approved_intervention_ids`）。完整搜索得到的最优方案复核不通过时：
  - 主结果返回 `UNSUPPORTED_INPUT` + 空方案（`R0 = R1 = []`，`alternative` / `conditional` 为 null），`notes` 写「内部复核未通过，按不支持的输入处理，请检查场景数据」（并列出未通过的检查项），**`verification` 保留那次失败的复核结果**（这是 `UNSUPPORTED_INPUT` 时 `verification` 非 null 的唯一情况）；
  - `conditional`：不给出该方案，`conditional.status = 'UNSUPPORTED_INPUT'`、方案为空方案占位，`note` 写明内部复核未通过；
  - `alternative`：舍弃复核不通过的候选，从其余放松方式中选；都不可用时给出空方案占位，`note` 写明内部复核未通过。
  - 合法输入下求解器与验证器应当一致，这条兜底不应被触发；触发即说明场景数据或实现有问题。
- **`INFEASIBLE`**：搜索完成，证明没有方案同时满足硬约束和软要求。由于空方案总满足全部硬约束（预算 ≥ 0、R1 = R0、L = 0），INFEASIBLE 只可能由软要求造成（例如：必须启用的措施的固定成本超出预算、必须启用的措施是 pending、两个必须启用的措施互斥、`min_gain` 达不到）。
  - 主结果为空方案（`R1 = R0`，`G = L = N = 0`，成本 0），`verification = null`。
  - `alternative`（必须非空）= 只放松软要求后的最优方案（按第 5 条），`relaxed` 写明放松了哪些、`note` 写明原要求为何达不到。放松 = 整项不再要求（不做部分放松）。依次尝试：只放松 `min_gain`、只放松 `required_intervention_ids`（只尝试 options 里确实给出的那一项）；两种都可行时取按第 5 条更优者，完全并列取只放松 `min_gain`；都不可行时两项都放松（此时空方案必可行）。**不得悄悄降低要求**：主结果的 `status` 仍是 INFEASIBLE。
- **`SEARCH_LIMIT_REACHED`**：达到 `max_search_nodes` 时停止。只返回已找到的、经 `verifyPlan`（传入相同的 `mode` / `loss_cap` / `required_intervention_ids` / `min_gain`）复核通过的最好方案，`verification` 为该复核结果；`notes` 写明「未证明最优」。做法：搜索中每次刷新最好方案时记录该候选（只保留最近 K = 8 个，后记录的严格更优）；达到上限时按目标顺序（最新 = 最优）依次复核，返回第一个通过的。没有复核通过的方案时返回空方案，`verification` 为空方案的复核结果（有软要求时可能不通过），`notes` 写明「搜索上限内未找到满足全部要求的方案，这是不启用任何措施的占位方案」。不得声称最优，也不等于无解。
- **`OPTIMAL`**：搜索完成并证明最优；`verification` 必须非空且通过（不通过时按上面的兜底返回 `UNSUPPORTED_INPUT`）。
- `alternative` 的搜索也受同一个 `max_search_nodes`（单独计数）；达到上限时给出已找到的、复核通过的最好替代方案，并在 `note` 中写明未证明最优。

**7. 条件性结果**
- 场景里存在 pending 措施、且主状态不是 UNSUPPORTED_INPUT 时：`conditional` = 把**全部** pending 措施当作已批准、其他条件（含 options 中的软要求与 `max_search_nodes`）相同再求解一次的结果；`status` 为这次求解的状态（规则同第 6 条，含「内部复核未通过 → UNSUPPORTED_INPUT」），`assumed_approved_intervention_ids` 列出这些措施（升序），`note` 写明「如果这些措施获批，则……，目前尚未生效」；与主结果比较时称「主结果（仅含已批准措施）」，不说「已生效」。否则 `conditional` 为 null。
- `existing_grants` 不变：pending 的 existing grant 仍按 pending 处理，R0 与主结果相同。
- **主结果永远不含 pending 措施。**

**8. `verifyPlan(scenario, plan, options?)` —— 独立复核**
- 不得 import 求解器的任何代码（建议求解器与验证器放在 `lib/joint/` 下不同文件，验证器文件不 import 求解器文件；求解器可以调用验证器）。可以调用学生端的 `analyzeReachability` / `checkEligibility`（它们不是求解器）。
- 自己重算 R0、R1、G、L、N 与成本，不信任 plan 里自带的任何指标或可行性标记。
- 输出的每项检查一条 `VerifyCheck`，`passed` = 全部检查都通过。检查项（名称固定）：
  - `input_validity`：scenario / options 是否命中第 6 条 UNSUPPORTED_INPUT 的任一条件（`max_search_nodes` 除外），或 `assume_approved_intervention_ids` 引用了不存在的措施。命中则不通过（其余检查仍尽量给出）。规则与求解器相同，但在验证器文件里**独立实现**（不共用校验函数）；对任一输入，「求解器返回 UNSUPPORTED_INPUT（输入校验）」⇔「`input_validity` 不通过」（有对照测试）。
  - `approval`、`mutual_exclusion`、`prerequisite`、`allocation_validity`、`capacity`、`cost_accounting`、`budget`、`coverage_loss`：对应第 3 条的硬约束 1–7（`approval` 中 `assume_approved_intervention_ids` 列出的 pending 措施算已批准；`coverage_loss` 按 `options.mode` / `loss_cap`，不传按 protect，tradeoff 缺 `loss_cap` 判不通过）。
  - `eligibility`（交叉检查）：`R1 \ R0` 中每个对的 `checkEligibility(student, opp, { today: evaluation_date }).overall === 'eligible'`。
  - `deadline`（交叉检查）：`R1 \ R0` 中每个对的机会 `deadline` 为 null 或不早于 `evaluation_date`。
  - `barrier_resolution`（交叉检查）：`R1 \ R0` 中每个对，在带全部 grant 的 `analyzeReachability` 结果里所有障碍 `resolved === true`，且至少一条障碍的 `resolved_by_grant_ids` 含 `'alloc:'` 开头的合成 grant。
  - `organizer_requirements`：只有 options 传了 `required_intervention_ids` 或 `min_gain` 时才输出；按第 4 条检查。
  - `metrics`：始终输出。plan 若带有 `R0` / `R1` / `G` / `L` / `N` / `cost` 中的任一字段（如传入的是 `JointResult`），逐项与重算值比较（`R0` / `R1` 按集合比较且不得有重复对；数值按第 0 条的误差），任一不一致则不通过；plan 不带这些字段时通过，`detail` 写明「plan 未携带指标，仅重算」。
- 复核条件性方案时，调用方传 `assume_approved_intervention_ids: conditional.assumed_approved_intervention_ids`。

**9. 实现位置与测试**
- `lib/joint/solve.ts`（`solveJoint`，精确搜索；节点计数与缺省上限见 `lib/joint/index.ts` 文件头）、`lib/joint/verify.ts`（`verifyPlan`）、`lib/joint/exhaustive.ts`（只用于测试的穷举 / 朴素枚举参考实现）、`lib/joint/whatif.ts`（What-if 页面视图模型 `runWhatIf`）、`lib/joint/scenarios.ts`（演示场景与 `withEnabledInterventions` / `resolveEnabledInterventions` / `withBudget`）。
- 独立性：`verify.ts` / `exhaustive.ts` 不 import `./solve`、`./index`、`./scenarios`（有静态守卫测试）。
- `withEnabledInterventions(scenario, ids)`：只保留勾选的措施；**前置依赖没有全部启用的措施一并移除**（按闭包反复判断），不会删掉 `requires` 让措施单独生效；指向已移除措施的互斥引用会被清理（互斥对象不在场景里不构成约束）。`resolveEnabledInterventions` 返回同一规则下保留与被移除的措施。

### 接入学生端函数的提示

- **传入今天的日期**：有截止日期的机会，调用 `checkEligibility` / `analyzeReachability` / `planRoutes` 时要传 `{ today: 'YYYY-MM-DD' }`。不传时依赖日期的结果按设计为 unknown / null：例如 `reachable` 为 `null`、`missing_info` 含 `options.today`，路线的 `feasible_by_deadline` 为 `null`。
- **`missing_info` 目前可能出现的字段名**：`profile.devices`、`profile.budget_usd`、`profile.transport`、`profile.hours_per_week_available`、`opportunity.cost.fee_usd`、`opportunity.cost.requires_travel_expense`、`opportunity.time_commitment.hours_per_week`、`opportunity.deadline`（格式无法识别）、`options.today`。
- **grant 是否化解障碍**：`applied_grant_ids` 是所有匹配的 approved grant，**不等于「已化解」**；是否化解看每条障碍的 `resolved` / `resolved_by_grant_ids`。
- **已过截止日期**：表现为一条 `type: 'time'`、`shortfall: null`、任何 grant 都不能化解的障碍。
- **`planRoutes`**：`status: 'routes'` 时路线 2–3 条；固定步骤 id 为 `submit-application`（提交申请）和 `find-partner`（找到同伴或导师），准备项不要用这两个 id；被证据覆盖的步骤 `skipped: true`，不计入合计；`status: 'blocked'` 时 `routes` 为空。
- **地区规则**：州 / 省请统一用代码（如 `CA`），国家与州 / 省代码都大小写不敏感。
- **证据关联准备项**：证据的 `prep_item_ids` 建议写成 `<opportunity_id>:<prep_id>`，避免跨机会误匹配（裸 `prep_id` 也能匹配，但不同机会的同名准备项会被一起覆盖）。
- 导入 `data/*.json` 时，TypeScript 会把字面量（如 `'online'`、`'approved'`）拓宽成 `string`，与联合类型不兼容；目前需要断言，例如
  `import profilesJson from '@/data/profiles.json'; const profiles = profilesJson as unknown as StudentProfile[];`。带校验的加载函数待定。
- **主办方 What-if（`solveJoint` / `verifyPlan`）**：
  - 页面用 `runWhatIf(scenario, input)`（`lib/joint/whatif.ts`）拿汇总视图：它处理勾选与前置依赖、调用 `solveJoint`、**再独立调用一次 `verifyPlan`**，并把结果整理成只含人数和汇总数字的 `WhatIfView`。
  - 直接用 `solveJoint` 时，展示前**自己再调一次 `verifyPlan`**（相同的 `mode` / `loss_cap` / 软要求；复核 `conditional` 时传 `assume_approved_intervention_ids`），不要只信结果里自带的 `verification`。
  - 所有结果都是**模拟**（示例学生、示例场景），界面标「示例 / 模拟」；可达 ≠ 录取；`SEARCH_LIMIT_REACHED` 不等于最优也不等于无解；`INFEASIBLE` 的主结果是空方案，替代方案要写明放松了什么。
  - **不要在界面显示单个学生的信息**（id、姓名、学校、逐人分配）；只显示人数与汇总。`runWhatIf` 已把说明文字里的学生 id / 姓名 / 学校替换为「某学生」。

语义约定：
- **unknown**：信息不全（学生没填、或官方要求机器判定不了）时返回 unknown，并给出「请向官方确认」提示。界面要把 unknown 显示成「待确认」，不能显示成通过或不通过。
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

浏览器存储：`lib/store.ts`（主导）封装 localStorage，键名 `oc:v1:*`，SSR 安全（服务器端返回默认值）。
提供 `loadProfile / saveProfile / clearProfile`、`loadEvidence / addEvidence / removeEvidence`（证据存在档案里）、
`loadSavedOpportunityIds / toggleSavedOpportunity`、`loadGrants / saveGrants / grantsFor`、`clearAll`。在 React 中请于 `useEffect` 里调用。

---

## ③ 目录归属（只改自己的）

| 负责人 | 目录 / 文件 |
|---|---|
| 主导 | `lib/types.ts`、`lib/store.ts`、`CONTRACT.md`、`lib/eligibility/`、`lib/reachability/`、`lib/path/`、`data/profiles.json`、`package.json`、`package-lock.json`、配置文件（`tsconfig.json`、`next.config.ts`、`eslint.config.mjs`、`vitest.config.mts`）、`app/layout.tsx`、`app/page.tsx` |
| 主导（接手 Charles 的任务） | `lib/joint/`、`app/organizer/`、`data/scenarios/` |
| 队友 A | `data/opportunities.json`、`app/quests/` |
| 队友 B | `app/map/`、`app/passport/`、`components/rpg/`、`app/globals.css` |

需要改别人目录里的东西：找对方，或在群里说明后由对方改。

- **新增依赖**：先在群里说一声，由主导统一加到 `package.json` / `package-lock.json`，避免 lockfile 冲突。
- **`app/layout.tsx`**：队友 B 做全站样式需要改时可以直接改，改之前在群里说一声。

---

## ④ 分支规则

- 每人只在自己的分支提交：主导 `feat/core`、队友 A `feat/quests`、队友 B `feat/map`；`feat/joint` 原为 Charles 的分支，现由主导接手（用于 `lib/joint/`、`app/organizer/`、`data/scenarios/` 以及为此做的契约扩展）。
- **不直接推 `main`**。合并顺序：`feat/core` → `feat/quests` → `feat/map` → `feat/joint`，由主导负责合并。
- 提交前本地跑通 `npm run build` 和 `npm test`。

---

## ⑤ 数据约定

- `data/opportunities.json`：每条机会必须**真实**，有 `official_url`（主办方官网）、`verified_on`（核实日期）、`verified_by`，**由人打开官网确认**。AI 给的机会信息不直接采用。
- 每条官方要求都要有 `source_text`（官网原文）。看不清的要求用 `type: 'manual'`（结果为 unknown，提示向官方确认），不要猜。
- 示例学生、示例主办方、模拟结果：数据里标 `is_sample: true`，界面上标「示例 / 模拟」。
- 不把模拟结果说成真实影响；可达 ≠ 录取。
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
