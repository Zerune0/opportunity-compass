/**
 * 联合求解的示例 / 模拟场景（全部 is_sample: true，不是真实学生、真实机会或真实影响）。
 *
 * - `deviceLoanScenario`：data/scenarios/device-loan.json —— 一场需要笔记本电脑的线下活动（占位机会，
 *   真实机会待队友 A 提供），10 名示例学生都缺笔记本，其中 3 人（dl-s03 / dl-s06 / dl-s09）还缺交通条件。
 * - `withEnabledInterventions(scenario, ids)`：只保留指定措施（What-if 页面「勾选措施」用）；
 *   前置依赖没有全部启用的措施一并移除（不放松依赖），并清理指向已移除措施的互斥引用。
 * - `resolveEnabledInterventions(scenario, ids)`：同一套规则，返回保留与被移除的措施（及缺少的依赖）。
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

/** 因前置依赖没有全部启用而被移除的措施。 */
export interface RemovedIntervention {
  id: string;
  /** 移除时尚未启用（未勾选或已被移除）的前置依赖 id。 */
  missing_requires: string[];
}

/**
 * 计算 What-if 勾选后真正参与求解的措施：先取 `ids` 中存在于场景的措施，
 * 再把「前置依赖（requires）没有全部启用」的措施移除，反复判断直到不再变化（闭包）。
 * 不会替用户自动补上依赖，也不会删掉 requires 让措施单独生效。
 * 返回 enabled（按场景原顺序）与 removed（按移除顺序）。纯函数。
 */
export function resolveEnabledInterventions(
  scenario: Scenario,
  ids: readonly string[],
): { enabled: string[]; removed: RemovedIntervention[] } {
  const exists = new Set(scenario.interventions.map((iv) => iv.id));
  const enabled = new Set(ids.filter((id) => exists.has(id)));
  const removed: RemovedIntervention[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const iv of scenario.interventions) {
      if (!enabled.has(iv.id)) continue;
      const missing = (iv.requires ?? []).filter((r) => !enabled.has(r));
      if (missing.length > 0) {
        enabled.delete(iv.id);
        removed.push({ id: iv.id, missing_requires: missing });
        changed = true;
      }
    }
  }
  return { enabled: scenario.interventions.filter((iv) => enabled.has(iv.id)).map((iv) => iv.id), removed };
}

/**
 * 只保留 `ids` 中列出的措施（保持原顺序；不存在的 id 忽略），
 * **前置依赖没有全部启用的措施一并移除**（按闭包反复判断，见 resolveEnabledInterventions），
 * 不会删掉 requires 让措施单独生效。保留措施的 mutually_exclusive_with 中指向已移除措施的引用会被清理
 * （互斥对象不在场景里，不构成约束）。保留措施的 requires 必然都已启用，原样保留。
 * 想知道移除了哪些，请调用 resolveEnabledInterventions。
 */
export function withEnabledInterventions(scenario: Scenario, ids: readonly string[]): Scenario {
  const keep = new Set(resolveEnabledInterventions(scenario, ids).enabled);
  const interventions: Intervention[] = scenario.interventions
    .filter((iv) => keep.has(iv.id))
    .map((iv) => {
      const next: Intervention = { ...iv, resolves: [...iv.resolves] };
      if (iv.opportunity_ids) next.opportunity_ids = [...iv.opportunity_ids];
      if (iv.requires) next.requires = [...iv.requires];
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
