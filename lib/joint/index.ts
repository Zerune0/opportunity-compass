/**
 * lib/joint — 主办方 what-if 联合求解（主导接手实现）。规范见 CONTRACT.md「联合求解模型」。
 *
 * - solveJoint(scenario, options?)（./solve）：精确搜索主办方措施 x、撤回的已有 grant 与资源分配 y，
 *   状态 OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT；返回选中措施、资源分配、撤回明细
 *   （revoked_grant_ids / revocations / lost_pairs）、R0、R1、G、L、N、成本、公平底线报告（fairness），
 *   以及 alternative（INFEASIBLE 时只整项放松软要求 min_gain / fairness_floors / required_intervention_ids）、
 *   conditional（pending 措施获批的假设）和 verification（对主方案的独立复核）。
 *   protect 模式（默认）不撤回任何已有 grant；tradeoff 模式须给 loss_cap，允许强制与自愿撤回，L ≤ loss_cap。
 *   max_search_nodes 缺省 200000（DEFAULT_MAX_SEARCH_NODES）。「节点」= 以下任一事件计 1 个：
 *   (a) 计算最小可达集合时访问一个（学生-机会对, 措施子集）（撤回改变了某对的已有 grant 时按新的撤回集合重新计算）；
 *   (b) 外层访问一个措施组合（无论是否被过滤），以及中层访问一个（措施组合, 撤回集合）；
 *   (c) 内层深度优先搜索进入一个状态。
 *   主搜索、conditional、alternative 的每一个放松子集各自单独计数。详见 ./solve.ts 文件头。
 * - verifyPlan(scenario, plan, options?)（./verify）：独立复核候选方案（含 revocation、fairness 检查），
 *   不 import 求解器与基线模块，不依赖求解器自己的可行性标记。
 * - compareBaselines(scenario, options?)（./baselines）：A 基础资格筛选 / B 学生端约束规划器 / C 机构端干预规划器 /
 *   joint 联合求解四行对比，同一场景、同一选项、同一验证器复核；说明书中的基线 D 未实现。
 *
 * 纯函数、确定性、无 IO、不调 AI。所有结果均为模拟，不是真实影响；可达 ≠ 录取。
 */
export { solveJoint, DEFAULT_MAX_SEARCH_NODES } from './solve';
export { verifyPlan } from './verify';
export { compareBaselines } from './baselines';
