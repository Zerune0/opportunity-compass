/**
 * 证明指标不依赖求解器自报的数字：用 vi.mock 包住 lib/joint 的 solveJoint，篡改它的结果，
 * 检查 measureCase 把篡改后的方案记为「假可行」（验证器拒绝），并且报告的覆盖、gap 用的是验证器的重算值。
 * （compareBaselines 内部直接用 ./solve，不受这里的 mock 影响。）vi.mock 作用于整个文件，所以与其他测试分开放。
 * 全部是示例 / 模拟数据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JointResult, Scenario, SolveOptions } from '../types';
import { SCENARIOS } from '../joint/scenarios';
import { withBudget } from '../joint/scenario-utils';
import { buildCases, measureCase } from './reliability';
import type { CaseMetrics, MetricsCase } from './reliability';

type Solve = (scenario: Scenario, options?: SolveOptions) => JointResult;

const h = vi.hoisted(() => ({
  /** 未篡改的 solveJoint（mock 工厂里记下）。 */
  actual: null as null | Solve,
  /** 不为 null 时，mock 的 solveJoint 用它改写真实结果。 */
  corrupt: null as null | ((result: JointResult, options: SolveOptions | undefined) => JointResult),
}));

vi.mock('../joint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../joint')>();
  h.actual = actual.solveJoint;
  return {
    ...actual,
    solveJoint: (scenario: Scenario, options?: SolveOptions) => {
      const result = actual.solveJoint(scenario, options);
      return h.corrupt ? h.corrupt(result, options) : result;
    },
  };
});

afterEach(() => {
  h.corrupt = null;
});

/** 第一个默认用例会给出 N > 0、成本 > 0 的 OPTIMAL 方案的场景（不钉死是哪一个）。 */
function positiveDefault(): { id: string; c: MetricsCase; honest: CaseMetrics } {
  for (const entry of SCENARIOS) {
    const c = buildCases(entry)[0];
    const honest = measureCase(entry.id, c, true);
    if (honest.status === 'OPTIMAL' && honest.main && honest.main.coverage.N > 0 && honest.main.coverage.cost_usd > 0) {
      return { id: entry.id, c, honest };
    }
  }
  throw new Error('no sample scenario has a default case with a positive plan');
}

describe('metrics use the verifier, not the solver\'s own numbers', () => {
  it('a solver result that over-reports N is rejected; coverage and gap use the verifier\'s numbers', () => {
    const { id, c, honest } = positiveDefault();
    expect(honest.solver_false_feasible).toBe(0);

    h.corrupt = (r) => (r.status === 'OPTIMAL' ? { ...r, G: r.G + 1, N: r.N + 1 } : r);
    const m = measureCase(id, c, true);

    expect(m.status).toBe('OPTIMAL');
    expect(m.solver_false_feasible).toBe(1);
    expect(m.main!.verifier_passed).toBe(false);
    expect(m.main!.failed_checks).toContain('metrics');
    // 报告的覆盖是验证器的重算值，与诚实结果相同，而不是篡改后的 N + 1。
    expect(m.main!.coverage).toEqual(honest.main!.coverage);
    // gap 用验证器重算的 N：方案本身没变，所以 gap 仍为 0（若用篡改的 N 会得到 -1）。
    const g = m.optimality.main;
    expect(g.checked).toBe(true);
    if (g.checked) {
      expect(g.verified_N).toBe(honest.main!.coverage.N);
      expect(g.gap_N).toBe(0);
    }
  });

  it('a solver plan over the budget is rejected by the budget check', () => {
    const { id, c, honest } = positiveDefault();
    const cost = honest.main!.coverage.cost_usd;
    // 用例场景的预算比诚实方案的成本少 1 美元；mock 照样返回按原预算求得的方案（超预算）。
    const tight: MetricsCase = {
      spec: { ...c.spec, case_id: 'protect/over-budget', budget_usd: cost - 1, is_default: false },
      scenario: withBudget(c.scenario, cost - 1),
      options: c.options,
    };
    h.corrupt = (r, options) => (r.status === 'UNSUPPORTED_INPUT' ? r : h.actual!(c.scenario, options));
    const m = measureCase(id, tight, false);

    expect(m.main!.claimed_feasible).toBe(true);
    expect(m.solver_false_feasible).toBeGreaterThanOrEqual(1);
    expect(m.main!.failed_checks).toContain('budget');
    // 报告的是验证器对这份（超预算）方案的重算成本。
    expect(m.main!.coverage.cost_usd).toBe(cost);
    expect(m.main!.coverage.cost_usd).toBeGreaterThan(tight.spec.budget_usd);
  });
});
