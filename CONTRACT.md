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
| `ResourceGrant` | 主办方已分配给某学生的资源（针对某机会，或对该学生所有机会有效） | `student_id`、**`opportunity_id`（`string \| null`：字符串 = 只对该机会有效；`null` = 对该学生的所有机会都有效，如借出的笔记本、交通卡；只有 `=== null` 才算，缺该字段的 grant 不生效；`null` 主要用于可重复使用的资源 device / time_support，按金额计的 transport_subsidy / fee_waiver 建议指定具体机会）**、`intervention_id?`（来自哪个措施，若有）、`type`（device / transport_subsidy / fee_waiver / time_support）、`status`（approved / pending）、`amount_usd`、`device`、`hours_per_week`、`is_sample` |
| `ReachabilityResult` | 可达性 | `eligibility`、`readiness_gaps`、`barriers[]`（`type`: time/cost/transport/device，`resolved`、`resolved_by_grant_ids`）、**`reachable`（true / false / null=信息不足）**、`missing_info`、`summary` |
| `Route` / `RouteStep` | 一条成长路线 | `type`（learning_first / practice_first / community）、`steps`（已按依赖排序；`depends_on`、`hours`、`cost_usd`、`skipped`、`skip_reason`）、`total_hours`、`total_cost_usd`、`feasible_by_deadline`（true/false/null）、`rationale`、`warnings` |
| `PlanResult` | `planRoutes` 的返回 | `status: 'routes'` → `routes`（2–3 条）；`status: 'blocked'` → `routes: []` + `blocking_requirements`、`reasons`、`alternatives`（下一届 / 同领域替代） |
| `RouteDiff` | 两次规划的变化 | `status_change`、`route_changes[]`（新增 / 移除 / 新跳过 / 取消跳过的步骤，小时与费用变化）、**`reasons`（为什么变）** |
| `Scenario` | 主办方 what-if 场景（一律示例/模拟） | `students`、`opportunities`、`interventions`、`budget_usd`、`evaluation_date`、`existing_grants`（带 `intervention_id` 的已有 grant 占用该措施的容量，按不同学生计，不重复计成本） |
| `Intervention` | 可选支持措施 | `type`、`resolves`（障碍类型）、`unit_cost_usd`（每服务一位**不同学生**的边际成本）、`fixed_cost_usd`（只计一次）、`capacity`（最多可服务的**不同学生**人数）、`mutually_exclusive_with`。同一学生凭同一措施参加多个机会，只占 1 个容量、只计一次成本 |
| `Allocation` | 一次资源分配（某措施用于某学生的某机会） | `intervention_id`、`student_id`、`opportunity_id`、`cost_usd`。同一 (`intervention_id`, `student_id`) 可有多条（对应不同机会）；容量与成本按不同的 (`intervention_id`, `student_id`) 计数；其中只有一条的 `cost_usd` 记 `unit_cost_usd`，其余记 0；若该 (`intervention_id`, `student_id`) 已出现在 `existing_grants` 中（grant 带相同 `intervention_id`），则其所有 `Allocation` 的 `cost_usd` 都记 0，容量也不再重复占用（已有 grant 已占 1 个） |
| `JointResult` | 联合求解结果 | `status`（OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT）、`selected_intervention_ids`、`allocations`、`R0`、`R1`、`G`、`L`、`N`、`cost`（`marginal_usd` = 各 Allocation 的 `cost_usd` 之和）、`notes` |
| `EvalOptions` | `checkEligibility` / `analyzeReachability` / `planRoutes` 的可选末位参数 | `today?: ISODate`（评估基准日；不传时不读系统时间，依赖日期的判断按信息不足处理） |
| `VerifyOptions` | `verifyPlan` 的可选第三参数（已确认保留） | `mode`、`loss_cap`（均可选，类型同 `SolveOptions`）；复核损失时用，不传按 protect 处理（损失必须为 0）；`mode: 'tradeoff'` 但没给 `loss_cap` 时判为不通过 |
| `VerifyResult` | 独立复核 | `passed`、`checks[]`（`name`、`passed`、`detail`）；`capacity` / `cost_accounting` 按 `Allocation` 的口径复核（按不同 (`intervention_id`, `student_id`) 计） |

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
| `solveJoint` | `lib/joint`（Charles） | `(scenario: Scenario, options?: SolveOptions) => JointResult` | MOCK，Charles 替换 |
| `verifyPlan` | `lib/joint`（Charles） | `(scenario: Scenario, plan: JointPlan, options?: VerifyOptions) => VerifyResult` | MOCK，Charles 替换 |

`VerifyOptions = { mode?: 'protect' | 'tradeoff'; loss_cap?: number }`（字段类型沿用 `SolveOptions`）。**第三参数确定保留，为可选**：复核损失 `L` 时需要知道模式与损失上限。不传（或不给 `mode`）按 protect 处理，即损失 `L` 必须为 0；`mode: 'tradeoff'` 时 `L ≤ loss_cap` 才算通过；`mode: 'tradeoff'` 但没给 `loss_cap` 时 `verifyPlan` 判为不通过（与 `solveJoint` 在同样输入下返回 `UNSUPPORTED_INPUT` 一致）。

联合求解的计量口径（`solveJoint` 求解与 `verifyPlan` 的 `capacity` / `cost_accounting` 复核都按此执行）：
- `Intervention.capacity` = 最多可服务的**不同学生**人数；`Intervention.unit_cost_usd` = 每服务一位不同学生的边际成本。同一学生凭同一措施参加多个机会，只占 1 个容量、只计一次成本。
- 同一 (`intervention_id`, `student_id`) 可以有多条 `Allocation`（对应不同机会）；容量与成本按不同的 (`intervention_id`, `student_id`) 计数；这几条中只有一条的 `cost_usd` 记 `unit_cost_usd`，其余记 0，因此 `JointCost.marginal_usd` 仍等于各 `Allocation` 的 `cost_usd` 之和。
- `Scenario.existing_grants` 中带 `intervention_id` 的 grant 占用该措施的容量（按不同学生计），不重复计成本：若某 (`intervention_id`, `student_id`) 已出现在 `existing_grants` 中（该 grant 带相同的 `intervention_id`），则它在本方案中的所有 `Allocation` 的 `cost_usd` 都记 0，容量也不再重复占用（已有 grant 已占 1 个）。

导入：`import { checkEligibility } from '@/lib/eligibility'`，类型 `import type { Opportunity } from '@/lib/types'`。
**现有参数不会删改；如需扩展，只在末位新增可选参数（向后兼容，见文末「变更记录」），其余只换实现**。四个学生端函数（`checkEligibility` / `analyzeReachability` / `planRoutes` / `diffRoutes`）已是真实实现；仍为 mock 的两个函数（`solveJoint` / `verifyPlan`）的说明文字带「MOCK」字样。

`solveJoint` / `verifyPlan` 当前 mock 行为（只为让界面能跑，不是真实求解）：
- `solveJoint`：正常输入返回 `SEARCH_LIMIT_REACHED` + 空方案（不启用任何措施），`notes` 写明「MOCK：未进行搜索」，**不声称 OPTIMAL**；预算为负或 tradeoff 缺 `loss_cap` 返回 `UNSUPPORTED_INPUT`。
- `verifyPlan`：不做检查，返回 `passed = false`。

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
- **仍为 mock 的 `solveJoint` / `verifyPlan`**：mock 永远不会返回 `OPTIMAL` / `INFEASIBLE` 或 `passed = true`。要调这些界面状态，请在**自己的页面 / 测试里手写符合类型的 fixture**（标 `is_sample: true`），**不要改 mock**。

语义约定：
- **unknown**：信息不全（学生没填、或官方要求机器判定不了）时返回 unknown，并给出「请向官方确认」提示。界面要把 unknown 显示成「待确认」，不能显示成通过或不通过。
- **总体资格**：任一硬性要求 not_satisfied → not_eligible；否则任一硬性 unknown → unknown；否则 eligible。非硬性（偏好）不影响总体。
- **`reachable` 的语义（固定，按顺序判定）**：
  - `false`：存在硬性要求 `not_satisfied`，**或**存在未被 approved grant 化解的障碍（无论资格是否 unknown，结论都确定）。
  - `null`：没有上述情况，但资格总体为 unknown，或缺少判断障碍所需的关键信息（见 `missing_info`）。
  - `true`：硬性要求全部 satisfied，且所有障碍不存在或已被化解。
  - 准备差距（`readiness_gaps`）**不直接**决定 `reachable`，只通过「补齐所需小时数 vs 可用时间」体现为 time 障碍。
- **可达 ≠ 录取**：`reachable = true` 只表示资格不冲突、现实条件走得通，不代表录取概率。界面不得暗示「会被录取」。
- **grants 的作用**：`analyzeReachability` 只用 `status = 'approved'` 且 student_id / opportunity_id 匹配的 grants 去化解对应障碍（设备→device、交通补助→transport、费用减免→cost、时间支持→time）；`pending` 只产生「若获批」的条件提示。「匹配」= `student_id` 等于该学生，且 `opportunity_id === null`（对该学生的所有机会都有效）或等于该机会 id；缺少 `opportunity_id` 字段的 grant 一律不生效（信息不足不猜）。`lib/store.ts` 的 `grantsFor` 按同一规则筛选，`loadGrants` 读取时逐条丢掉非法条目（含缺 `opportunity_id` 的）、保留合法的。按金额计的资助对每个机会各按全额计算，不在机会之间分摊，因此 `opportunity_id: null` 建议只用于可重复使用的资源（device、time_support）。
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
| Charles | `lib/joint/`、`app/organizer/`、`data/scenarios/` |
| 队友 A | `data/opportunities.json`、`app/quests/` |
| 队友 B | `app/map/`、`app/passport/`、`components/rpg/`、`app/globals.css` |

需要改别人目录里的东西：找对方，或在群里说明后由对方改。

- **新增依赖**：先在群里说一声，由主导统一加到 `package.json` / `package-lock.json`，避免 lockfile 冲突。
- **`app/layout.tsx`**：队友 B 做全站样式需要改时可以直接改，改之前在群里说一声。

---

## ④ 分支规则

- 每人只在自己的分支提交：主导 `feat/core`、队友 A `feat/quests`、队友 B `feat/map`、Charles `feat/joint`。
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
