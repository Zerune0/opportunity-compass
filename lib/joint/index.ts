/**
 * lib/joint — 主办方 what-if 联合求解（主导接手实现）。规范见 CONTRACT.md「联合求解模型」。
 *
 * - solveJoint(scenario, options?)（./solve）：精确搜索主办方措施 x 与资源分配 y，
 *   状态 OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT；返回选中措施、资源分配、
 *   R0、R1、G、L、N、成本，以及 alternative（INFEASIBLE 时只放松软要求）、conditional（pending 措施获批的假设）
 *   和 verification（对主方案的独立复核）。
 *   max_search_nodes 缺省 200000（DEFAULT_MAX_SEARCH_NODES）。「节点」= 以下任一事件计 1 个：
 *   预处理中访问一个（学生-机会对, 措施子集）；访问一个措施组合；内层深度优先搜索进入一个状态。
 *   主搜索、conditional、alternative 的每次放松尝试各自单独计数。详见 ./solve.ts 文件头。
 * - verifyPlan(scenario, plan, options?)（./verify）：独立复核候选方案，不 import 求解器，
 *   不依赖求解器自己的可行性标记。
 *
 * 纯函数、确定性、无 IO、不调 AI。所有结果均为模拟，不是真实影响；可达 ≠ 录取。
 */
export { solveJoint, DEFAULT_MAX_SEARCH_NODES } from './solve';
export { verifyPlan } from './verify';
