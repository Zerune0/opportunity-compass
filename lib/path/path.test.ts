import { describe, expect, it } from 'vitest';
import { diffRoutes, planRoutes } from './index';
import { ROUTE_TYPES, type Opportunity, type StudentProfile } from '../types';

// 虚构测试数据（不是真实机会），链接用 example.com。
const FICTIONAL_OPP: Opportunity = {
  id: 'fictional-test-program',
  title: '虚构测试项目（非真实机会）',
  organizer: 'Example Org（虚构）',
  category: 'summer_program',
  fields: ['computer_science'],
  summary: '仅用于单元测试的虚构机会。',
  official_url: 'https://example.com/fictional-program',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 5, total_weeks: 6 },
  required_devices: [],
  requirements: [],
  preparation: [
    { id: 'prep-python', title: '学 Python 基础', skill: 'python', estimated_hours: 10, estimated_cost_usd: 0, depends_on: [], required_for_application: false },
    { id: 'prep-project', title: '做一个数据小项目', skill: 'data_analysis', estimated_hours: 15, estimated_cost_usd: 0, depends_on: ['prep-python'], required_for_application: true },
  ],
  is_sample: true,
};

const BEFORE: StudentProfile = { id: 'p1', is_sample: true, display_name: '测试学生', evidence: [] };
const AFTER: StudentProfile = {
  ...BEFORE,
  evidence: [
    { id: 'ev1', title: '天气数据分析（虚构）', kind: 'project', skills: ['data_analysis'], status: 'evidence_attached', added_on: '2026-11-17' },
  ],
};

describe('planRoutes (mock)', () => {
  it('返回 2–3 条合法类型的路线', () => {
    const r = planRoutes(BEFORE, FICTIONAL_OPP);
    expect(r.status).toBe('routes');
    expect(r.routes.length).toBeGreaterThanOrEqual(2);
    expect(r.routes.length).toBeLessThanOrEqual(3);
    for (const route of r.routes) {
      expect(ROUTE_TYPES).toContain(route.type);
      expect(route.total_hours).toBe(25);
      expect([true, false, null]).toContain(route.feasible_by_deadline);
    }
  });

  it('同输入同输出', () => {
    expect(planRoutes(BEFORE, FICTIONAL_OPP)).toEqual(planRoutes(BEFORE, FICTIONAL_OPP));
  });
});

describe('diffRoutes (mock)', () => {
  it('加证据后能说出跳过的步骤和原因', () => {
    const d = diffRoutes(planRoutes(BEFORE, FICTIONAL_OPP), planRoutes(AFTER, FICTIONAL_OPP));
    expect(d.status_change).toBeNull();
    const learning = d.route_changes.find((c) => c.route_type === 'learning_first');
    expect(learning?.change).toBe('changed');
    expect(learning?.newly_skipped_steps.map((s) => s.step_id)).toEqual(['prep-project']);
    expect(learning?.hours_delta).toBe(-15);
    expect(d.reasons.length).toBeGreaterThan(0);
  });

  it('无变化时也给出说明', () => {
    const p = planRoutes(BEFORE, FICTIONAL_OPP);
    const d = diffRoutes(p, p);
    expect(d.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
    expect(d.reasons.length).toBe(1);
  });
});
