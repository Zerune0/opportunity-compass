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
| `ResourceGrant` | 主办方已分配给某学生、针对某机会的资源 | `student_id`、`opportunity_id`、`type`（device / transport_subsidy / fee_waiver / time_support）、`status`（approved / pending）、`amount_usd`、`device`、`hours_per_week`、`is_sample` |
| `ReachabilityResult` | 可达性 | `eligibility`、`readiness_gaps`、`barriers[]`（`type`: time/cost/transport/device，`resolved`、`resolved_by_grant_ids`）、**`reachable`（true / false / null=信息不足）**、`missing_info`、`summary` |
| `Route` / `RouteStep` | 一条成长路线 | `type`（learning_first / practice_first / community）、`steps`（已按依赖排序；`depends_on`、`hours`、`cost_usd`、`skipped`、`skip_reason`）、`total_hours`、`total_cost_usd`、`feasible_by_deadline`（true/false/null）、`rationale`、`warnings` |
| `PlanResult` | `planRoutes` 的返回 | `status: 'routes'` → `routes`（2–3 条）；`status: 'blocked'` → `routes: []` + `blocking_requirements`、`reasons`、`alternatives`（下一届 / 同领域替代） |
| `RouteDiff` | 两次规划的变化 | `status_change`、`route_changes[]`（新增 / 移除 / 新跳过 / 取消跳过的步骤，小时与费用变化）、**`reasons`（为什么变）** |
| `Scenario` | 主办方 what-if 场景（一律示例/模拟） | `students`、`opportunities`、`interventions`、`budget_usd`、`evaluation_date`、`existing_grants` |
| `Intervention` | 可选支持措施 | `type`、`resolves`（障碍类型）、`unit_cost_usd`、`fixed_cost_usd`（只计一次）、`capacity`、`mutually_exclusive_with` |
| `JointResult` | 联合求解结果 | `status`（OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT）、`selected_intervention_ids`、`allocations`、`R0`、`R1`、`G`、`L`、`N`、`cost`、`notes` |
| `VerifyOptions` | `verifyPlan` 的可选第三参数 | `mode`、`loss_cap`（均可选，类型同 `SolveOptions`） |
| `VerifyResult` | 独立复核 | `passed`、`checks[]`（`name`、`passed`、`detail`） |

`R0 / R1 / G / L / N`（出自 `docs/product-scope.md` Shared constraints）：在同一评估时间和假设下，
`R0` = 原始覆盖（不加新措施时现实可达的学生-机会对集合），`R1` = 全局分配后的覆盖；
`G = |R1 \ R0|`（增益），`L = |R0 \ R1|`（损失），`N = G − L`（净值）。默认 protect 模式要求 `L = 0`；tradeoff 模式必须显式给 `loss_cap`。

常量：`ELIGIBILITY_STATUSES`、`BARRIER_TYPES`、`ROUTE_TYPES`、`JOINT_STATUSES`、`SUPPORT_RESOLVES`（支持类型 → 化解的障碍类型）。

---

## ② 六个共享函数

全部是 `lib/` 下的**纯函数**：确定性、无 IO、不读 localStorage、不调 AI。AI 不参与资格判断和求解。

| 函数 | 位置 | 签名 | 状态 |
|---|---|---|---|
| `checkEligibility` | `lib/eligibility` | `(profile: StudentProfile, opp: Opportunity) => EligibilityResult` | MOCK，第 1 层（周三 23:00）替换 |
| `analyzeReachability` | `lib/reachability` | `(profile: StudentProfile, opp: Opportunity, grants: ResourceGrant[]) => ReachabilityResult` | MOCK，第 1 层（周三 23:00）替换 |
| `planRoutes` | `lib/path` | `(profile: StudentProfile, opp: Opportunity) => PlanResult` | MOCK，第 2 层（周四 20:00）替换 |
| `diffRoutes` | `lib/path` | `(before: PlanResult, after: PlanResult) => RouteDiff` | MOCK，第 2 层（周四 20:00）替换 |
| `solveJoint` | `lib/joint`（Charles） | `(scenario: Scenario, options?: SolveOptions) => JointResult` | MOCK，Charles 替换 |
| `verifyPlan` | `lib/joint`（Charles） | `(scenario: Scenario, plan: JointPlan, options?: VerifyOptions) => VerifyResult` | MOCK，Charles 替换 |

`VerifyOptions = { mode?: 'protect' | 'tradeoff'; loss_cap?: number }`（字段类型沿用 `SolveOptions`）。**第三参数为可选，待主导与 Charles 确认是否保留。**

导入：`import { checkEligibility } from '@/lib/eligibility'`，类型 `import type { Opportunity } from '@/lib/types'`。
**签名不会变，只换实现**；界面现在就可以接 mock。mock 的说明文字都带「MOCK」字样。

当前 mock 行为（只为让界面能跑，不是真实判断）：
- `checkEligibility`：每条要求都返回 `unknown`；有硬性要求时总体 `unknown`，否则 `eligible`。
- `analyzeReachability`：只检查「所需设备不在档案里」，approved 的 device grant 可化解；有未化解障碍 → `reachable = false`，否则 `null`。
- `planRoutes` / `diffRoutes`：三条路线直接用准备项，已有证据的步骤跳过；`feasible_by_deadline` 固定 `null`。
- `solveJoint`：正常输入返回 `SEARCH_LIMIT_REACHED` + 空方案（不启用任何措施），`notes` 写明「MOCK：未进行搜索」，**不声称 OPTIMAL**；预算为负或 tradeoff 缺 `loss_cap` 返回 `UNSUPPORTED_INPUT`。
- `verifyPlan`：不做检查，返回 `passed = false`。

### 用 mock 调界面

- mock **永远不会**返回：`PlanResult.status === 'blocked'`、`reachable === true`、资格项 `satisfied` / `not_satisfied`。`reachable === false` 只在出现未化解的设备障碍时出现。
- 要调这些界面状态，请在**自己的页面 / 测试里手写符合类型的 fixture**（标 `is_sample: true`），**不要改 mock**。
- 导入 `data/*.json` 时，TypeScript 会把字面量（如 `'online'`、`'approved'`）拓宽成 `string`，与联合类型不兼容；目前需要断言，例如
  `import profilesJson from '@/data/profiles.json'; const profiles = profilesJson as unknown as StudentProfile[];`。带校验的加载函数待定。

语义约定：
- **unknown**：信息不全（学生没填、或官方要求机器判定不了）时返回 unknown，并给出「请向官方确认」提示。界面要把 unknown 显示成「待确认」，不能显示成通过或不通过。
- **总体资格**：任一硬性要求 not_satisfied → not_eligible；否则任一硬性 unknown → unknown；否则 eligible。非硬性（偏好）不影响总体。
- **`reachable` 的语义（固定，按顺序判定）**：
  - `false`：存在硬性要求 `not_satisfied`，**或**存在未被 approved grant 化解的障碍（无论资格是否 unknown，结论都确定）。
  - `null`：没有上述情况，但资格总体为 unknown，或缺少判断障碍所需的关键信息（见 `missing_info`）。
  - `true`：硬性要求全部 satisfied，且所有障碍不存在或已被化解。
  - 准备差距（`readiness_gaps`）**不直接**决定 `reachable`，只通过「补齐所需小时数 vs 可用时间」体现为 time 障碍。
- **可达 ≠ 录取**：`reachable = true` 只表示资格不冲突、现实条件走得通，不代表录取概率。界面不得暗示「会被录取」。
- **grants 的作用**：`analyzeReachability` 只用 `status = 'approved'` 且 student_id / opportunity_id 匹配的 grants 去化解对应障碍（设备→device、交通补助→transport、费用减免→cost、时间支持→time）；`pending` 只产生「若获批」的条件提示。
- **硬性不满足不给绕过路线**：`planRoutes` 遇到硬性 not_satisfied 返回 `status: 'blocked'`，只给原因和「下一届 / 同领域替代」提示，`routes` 为空。资格 unknown 时仍给路线，但带提醒。
- **证据跳过步骤**：学生已有证据覆盖的步骤标 `skipped: true` 并写 `skip_reason`，不计入总小时 / 费用；`diffRoutes` 要说得出变化原因。
- **公平性**：任何判断函数都不得读取 `school_name`。
- **联合求解**：SEARCH_LIMIT_REACHED 不等于无解，也不得声称全局最优；INFEASIBLE 不得悄悄放松约束；`verifyPlan` 独立复核，不依赖求解器自己的可行性标记。所有结果都是模拟。

浏览器存储：`lib/store.ts`（主导）封装 localStorage，键名 `oc:v1:*`，SSR 安全（服务器端返回默认值）。
提供 `loadProfile / saveProfile / clearProfile`、`loadEvidence / addEvidence / removeEvidence`（证据存在档案里）、
`loadSavedOpportunityIds / toggleSavedOpportunity`、`loadGrants / saveGrants / grantsFor`、`clearAll`。在 React 中请于 `useEffect` 里调用。

---

## ③ 目录归属（只改自己的）

| 负责人 | 目录 / 文件 |
|---|---|
| 主导 | `lib/types.ts`、`lib/store.ts`、`CONTRACT.md`、`lib/eligibility/`、`lib/reachability/`、`lib/path/`、`data/profiles.json` |
| Charles | `lib/joint/`、`app/organizer/`、`data/scenarios/` |
| 队友 A | `data/opportunities.json`、`app/quests/` |
| 队友 B | `app/map/`、`app/passport/`、`components/rpg/`、`app/globals.css` |

需要改别人目录里的东西：找对方，或在群里说明后由对方改。

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
