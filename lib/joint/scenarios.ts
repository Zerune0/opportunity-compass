/**
 * 联合求解的示例 / 模拟场景（全部 is_sample: true，不是真实学生、真实机会或真实影响）。
 *
 * - `deviceLoanScenario`：data/scenarios/device-loan.json —— 一场需要笔记本电脑的线下活动（占位机会，
 *   真实机会待队友 A 提供），10 名示例学生都缺笔记本，其中 3 人（dl-s03 / dl-s06 / dl-s09）还缺交通条件。
 * - `withEnabledInterventions(scenario, ids)`：只保留指定措施（What-if 页面「勾选措施」用），
 *   并清理对被移除措施的 requires / mutually_exclusive_with 引用。
 * - `withBudget(scenario, budget)`：改预算。
 *
 * 纯函数：不修改输入，返回新对象；无 IO（JSON 在构建时导入）。
 */
import type { Intervention, Scenario } from '../types';
import deviceLoanJson from '@/data/scenarios/device-loan.json';

/** 最小的运行时形状校验：只查顶层字段与数组，详细校验由 solveJoint 的 UNSUPPORTED_INPUT 负责。 */
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

/**
 * 只保留 `ids` 中列出的措施（保持原顺序；不存在的 id 忽略），
 * 并把保留措施的 requires / mutually_exclusive_with 里指向被移除措施的引用删掉。
 * 注意：删掉 requires 引用会让原本「必须连同 X 一起启用」的措施可以单独启用——
 * 这是 What-if 勾选的语义（主办方明确只考虑这些措施）；若想保留依赖，请把依赖项一起勾上。
 */
export function withEnabledInterventions(scenario: Scenario, ids: readonly string[]): Scenario {
  const keep = new Set(ids);
  const interventions: Intervention[] = scenario.interventions
    .filter((iv) => keep.has(iv.id))
    .map((iv) => {
      const next: Intervention = { ...iv, resolves: [...iv.resolves] };
      if (iv.opportunity_ids) next.opportunity_ids = [...iv.opportunity_ids];
      if (iv.requires) next.requires = iv.requires.filter((r) => keep.has(r));
      if (iv.mutually_exclusive_with) {
        next.mutually_exclusive_with = iv.mutually_exclusive_with.filter((r) => keep.has(r));
      }
      return next;
    });
  return { ...scenario, interventions };
}

/** 返回只改了预算的新场景。 */
export function withBudget(scenario: Scenario, budget: number): Scenario {
  return { ...scenario, budget_usd: budget };
}
