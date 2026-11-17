/**
 * MOCK — 第 2 层前由 Charles 替换（lib/joint/ 归 Charles 所有，主导只放了这个占位）。
 *
 * solveJoint(scenario, options)：联合求解主办方措施 x、资源分配 y 与路线可达 z。
 *   状态 OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT；
 *   返回选中措施、资源分配、R0、R1、G、L、N、成本（定义见 lib/types.ts 的 JointResult）。
 * verifyPlan(scenario, plan, options?)：独立复核候选方案，不依赖求解器自己的可行性标记。
 *
 * 当前 mock：
 * - solveJoint 返回「不启用任何措施」的空方案（R0 = R1 = []，G = L = N = 0），
 *   状态 SEARCH_LIMIT_REACHED（未搜索，不声称 OPTIMAL），notes 写明「MOCK：未进行搜索」；
 *   预算为负等明显非法输入返回 UNSUPPORTED_INPUT。
 * - verifyPlan 不做任何检查，诚实返回 passed = false（不把未检查说成通过）。
 * 签名与最终版一致。纯函数、确定性、无 IO、不调 AI。所有结果均为模拟，不是真实影响。
 */
import type {
  JointPlan,
  JointResult,
  Scenario,
  SolveOptions,
  VerifyOptions,
  VerifyResult,
} from '../types';

export function solveJoint(scenario: Scenario, options: SolveOptions = {}): JointResult {
  const empty = {
    selected_intervention_ids: [],
    allocations: [],
    R0: [],
    R1: [],
    G: 0,
    L: 0,
    N: 0,
    cost: { fixed_usd: 0, marginal_usd: 0, total_usd: 0 },
  };

  if (scenario.budget_usd < 0 || (options.mode === 'tradeoff' && options.loss_cap == null)) {
    return {
      ...empty,
      status: 'UNSUPPORTED_INPUT',
      notes: ['（MOCK）输入不合法：预算为负，或 tradeoff 模式未给 loss_cap。'],
    };
  }

  return {
    ...empty,
    status: 'SEARCH_LIMIT_REACHED',
    notes: [
      'MOCK：未进行搜索。这是不启用任何措施的占位方案，不是最优解，仅供界面开发。结果为模拟。',
    ],
  };
}

export function verifyPlan(
  scenario: Scenario,
  plan: JointPlan,
  options?: VerifyOptions,
): VerifyResult {
  void [scenario, plan, options]; // mock 不使用参数；Charles 实现时删除此行
  return {
    passed: false,
    checks: [
      {
        name: 'not_implemented',
        passed: false,
        detail: '（MOCK）独立复核尚未实现，未做任何检查，因此不判定为通过。',
      },
    ],
  };
}
