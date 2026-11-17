import { describe, expect, it } from 'vitest';
import { solveJoint, verifyPlan } from './index';
import { JOINT_STATUSES, type Scenario } from '../types';

// 虚构的模拟场景（不含真实学生或机会）。
const SCENARIO: Scenario = {
  id: 'fictional-scenario',
  title: '虚构测试场景',
  is_sample: true,
  evaluation_date: '2026-11-17',
  students: [],
  opportunities: [],
  interventions: [
    { id: 'iv-laptop', title: '借笔记本', type: 'device', resolves: ['device'], unit_cost_usd: 0, fixed_cost_usd: 100, capacity: 5, device: 'laptop' },
  ],
  budget_usd: 500,
};

describe('solveJoint (mock)', () => {
  it('返回合法状态和自洽的 G/L/N', () => {
    const r = solveJoint(SCENARIO, {});
    expect(JOINT_STATUSES).toContain(r.status);
    expect(r.N).toBe(r.G - r.L);
    expect(r.cost.total_usd).toBe(r.cost.fixed_usd + r.cost.marginal_usd);
    expect(r.notes.join('')).toContain('MOCK');
  });

  it('正常输入返回 SEARCH_LIMIT_REACHED，不声称 OPTIMAL', () => {
    const r = solveJoint(SCENARIO, {});
    expect(r.status).toBe('SEARCH_LIMIT_REACHED');
    expect(r.notes.join('')).toContain('MOCK：未进行搜索');
  });

  it('tradeoff 模式缺 loss_cap 返回 UNSUPPORTED_INPUT', () => {
    expect(solveJoint(SCENARIO, { mode: 'tradeoff' }).status).toBe('UNSUPPORTED_INPUT');
  });

  it('同输入同输出', () => {
    expect(solveJoint(SCENARIO, {})).toEqual(solveJoint(SCENARIO, {}));
  });
});

describe('verifyPlan (mock)', () => {
  it('未实现时不声称通过', () => {
    const v = verifyPlan(SCENARIO, solveJoint(SCENARIO, {}));
    expect(v.passed).toBe(false);
    expect(v.checks.length).toBeGreaterThan(0);
    expect(v.passed).toBe(v.checks.every((c) => c.passed));
  });
});
