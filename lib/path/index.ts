/**
 * 路线规划（第 2 层实现，主导）。
 *
 * - planRoutes(profile, opp, options?)：2–3 条路线（学习优先 / 实践优先 / 社区协作），
 *   硬性资格不满足时 status = 'blocked'，不生成任何绕过路线，只给原因和替代提示。规则见 ./plan.ts。
 * - diffRoutes(before, after)：两次规划之间的变化和原因。规则见 ./diff.ts。
 *
 * 纯函数、确定性、无 IO；日期只来自 options.today 与机会数据；不读取学校名、显示名。
 */
export { planRoutes } from './plan';
export { diffRoutes } from './diff';
