/**
 * 联合求解的示例 / 模拟场景（全部 is_sample: true，不是真实学生、真实机会或真实影响）。
 *
 * - `deviceLoanScenario`：data/scenarios/device-loan.json —— 一场需要笔记本电脑的线下活动（占位机会，
 *   真实机会待队友 A 提供），10 名示例学生都缺笔记本，其中 3 人（dl-s03 / dl-s06 / dl-s09）还缺交通条件。
 * - `withEnabledInterventions(scenario, ids)`：只保留指定措施（What-if 页面「勾选措施」用）；
 *   前置依赖没有全部启用的措施一并移除（不放松依赖），并清理指向已移除措施的互斥引用。
 * - `resolveEnabledInterventions(scenario, ids)`：同一套规则，返回保留与被移除的措施（及缺少的依赖）。
 * - `withBudget(scenario, budget)`：改预算。
 * 以上纯函数实现在 ./scenario-utils（不含数据），这里只是转导出。
 * **客户端组件不要 import 本文件**：顶层导入了场景 JSON（含示例学生姓名、学校），会被打包进浏览器。
 * 页面应在 server component 里调用 anonymizeScenarioForClient 后把结果作为 prop 传下去。
 *
 * 纯函数：不修改输入，返回新对象；无 IO（JSON 在构建时导入）。
 */
import type { Scenario } from '../types';
import deviceLoanJson from '@/data/scenarios/device-loan.json';
import { findStudentInfoInInterventions } from './scenario-utils';

/**
 * 最小的运行时形状校验：只查顶层字段与数组，详细校验由 solveJoint 的 UNSUPPORTED_INPUT 负责。
 * 另外检查措施 id / 标题不含任何学生的 id、显示名、学校名（姓名 / 学校名短于 3 个字符时不查）。
 */
export function assertScenarioShape(value: unknown, label = 'scenario'): Scenario {
  const v = value as Partial<Scenario> | null;
  const problems: string[] = [];
  if (v == null || typeof v !== 'object') problems.push('不是对象');
  else {
    if (typeof v.id !== 'string') problems.push('id 不是字符串');
    if (typeof v.title !== 'string') problems.push('title 不是字符串');
    if (v.is_sample !== true) problems.push('is_sample 必须为 true');
    if (typeof v.evaluation_date !== 'string') problems.push('evaluation_date 不是字符串');
    if (typeof v.budget_usd !== 'number') problems.push('budget_usd 不是数字');
    for (const key of ['students', 'opportunities', 'interventions'] as const) {
      if (!Array.isArray(v[key])) problems.push(`${key} 不是数组`);
    }
    if (v.existing_grants !== undefined && !Array.isArray(v.existing_grants)) problems.push('existing_grants 不是数组');
    // 措施 id / 标题里不得写进学生的 id、显示名、学校名（否则页面脱敏挡不住，示例数据写错时尽早暴露）。
    if (Array.isArray(v.students) && Array.isArray(v.interventions)) {
      problems.push(...findStudentInfoInInterventions(v as Scenario));
    }
  }
  if (problems.length > 0) throw new Error(`${label} 形状不对：${problems.join('；')}`);
  return value as Scenario;
}

export const deviceLoanScenario: Scenario = assertScenarioShape(deviceLoanJson as unknown, 'device-loan');

/** 演示场景里各措施的 id（方便页面与测试引用）。 */
export const DEVICE_LOAN_IDS = {
  laptopLoan: 'iv-laptop-loan',
  transportSubsidy: 'iv-transport-subsidy',
  onlineEntry: 'iv-online-entry',
  satelliteVenue: 'iv-satellite-venue',
  opportunity: 'placeholder-inperson-event',
  /** 还缺交通条件的 3 名示例学生。 */
  transportLackingStudents: ['dl-s03', 'dl-s06', 'dl-s09'],
} as const;

export {
  anonymizeScenarioForClient,
  findStudentInfoInInterventions,
  missingPrerequisites,
  resolveEnabledInterventions,
  withBudget,
  withEnabledInterventions,
} from './scenario-utils';
export type { RemovedIntervention } from './scenario-utils';
