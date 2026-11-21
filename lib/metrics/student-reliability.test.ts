/**
 * 学生端可靠性指标的性质测试。不写死随数据变化的数字（data/opportunities.json 由队友维护，还会改）。
 * 真实数据上要求：错误可行 0、检查器问题 0、blocked 违规 0；不是 0 时说明引擎有 bug，应报告，而不是放松检查。
 */
import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from '../data';
import { planRoutes } from '../path';
import type { Opportunity, PlanResult, PrepItem, StudentProfile } from '../types';
import { ROUTE_TYPES } from '../types';
import { STUDENT_METRICS_REFERENCE_DATE, measureStudentSide, verifiedOnly } from './student-reliability';

const profiles = sampleProfiles();
const catalog = verifiedOnly(catalogOpportunities());
const real = measureStudentSide({ profiles, catalog, today: STUDENT_METRICS_REFERENCE_DATE });

describe('student-side metrics on the sample profiles × verified catalog', () => {
  it('covers every pair, and the counts add up', () => {
    expect(profiles.length).toBeGreaterThan(0);
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog.some((o) => o.is_sample === true)).toBe(false);
    expect(real.pairs).toBe(profiles.length * catalog.length);
    expect(real.engine_errors.count).toBe(0);
    const e = real.eligibility;
    expect(e.eligible + e.not_eligible + e.unknown).toBe(real.pairs);
    const d = real.route_discovery;
    expect(d.denominator).toBe(e.eligible + e.unknown);
    expect(d.with_feasible_route + d.best_is_unknown + d.all_infeasible).toBe(d.denominator);
    expect(real.plans.routes + real.plans.blocked).toBe(real.pairs);
    expect(real.plans.blocked).toBe(e.not_eligible);
    const byType = ROUTE_TYPES.reduce((s, t) => s + real.routes_by_type[t], 0);
    expect(byType).toBe(real.routes_total);
    expect(real.checker.routes_checked).toBe(real.routes_total);
    expect(real.checker.plans_checked).toBe(real.pairs);
  });

  it('no false feasibility, no checker problems, no blocked-plan violations', () => {
    expect(real.false_feasibility.rejected_by_deadline_check).toBe(0);
    expect(real.checker.routes_with_problems).toBe(0);
    expect(Object.values(real.checker.problems_by_check).every((n) => n === 0)).toBe(true);
    expect(real.checker.blocked_plan_violations).toBe(0);
    expect(Object.values(real.checker.plan_problems_by_check).every((n) => n === 0)).toBe(true);
    expect(real.checker.problem_routes).toEqual([]);
    expect(real.checker.problem_plans).toEqual([]);
  });

  it('rates are within [0, 1] or null', () => {
    const rates = [
      real.route_discovery.rate,
      real.unknown_rates.eligibility_item_unknown_rate,
      real.unknown_rates.reachability_null_rate,
      real.unknown_rates.routes_feasibility_null_rate,
    ];
    for (const r of rates) if (r !== null) expect(r >= 0 && r <= 1).toBe(true);
  });

  it('the output carries no profile id, display name, school name or age', () => {
    const text = JSON.stringify(real);
    for (const p of profiles) {
      expect(text).not.toContain(p.id);
      expect(text).not.toContain(p.display_name);
      if (typeof p.school_name === 'string' && p.school_name !== '') expect(text).not.toContain(p.school_name);
    }
    expect(text).not.toMatch(/"age"|birth_date|display_name|school_name/);
  });
});

// ───────────────────────── 注入出错的引擎 ─────────────────────────

const OPP: Opportunity = {
  id: 'fic-metrics-opp',
  title: 'Fictional metrics opportunity (not real)',
  organizer: 'Example Org (fictional)',
  category: 'summer_program',
  fields: ['data_science'],
  summary: 'Fictional opportunity for unit tests only.',
  official_url: 'https://example.com/fic-metrics-opp',
  verified_on: '2026-11-19',
  verified_by: 'test-fixture',
  deadline: '2026-12-01',
  recurring_annually: true,
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 2, total_weeks: 2 },
  required_devices: [],
  requirements: [],
  preparation: [
    {
      id: 'prep-big',
      title: 'Long project',
      skill: null,
      evidence_kind: 'project',
      estimated_hours: 100,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: false,
    } satisfies PrepItem,
  ],
  is_sample: true,
};

const STUDENT: StudentProfile = {
  id: 'fic-metrics-student',
  is_sample: true,
  display_name: 'Fictional student',
  grade: 10,
  hours_per_week_available: 2,
  budget_usd: 50,
  evidence: [],
};

describe('a lying planner is caught', () => {
  const today = '2026-11-19';

  it('honest engine: every route is false, nothing flagged', () => {
    const m = measureStudentSide({ profiles: [STUDENT], catalog: [OPP], today });
    expect(m.route_discovery).toMatchObject({ denominator: 1, with_feasible_route: 0, all_infeasible: 1 });
    expect(m.false_feasibility).toEqual({ claimed_feasible: 0, rejected_by_deadline_check: 0 });
    expect(m.checker.routes_with_problems).toBe(0);
  });

  it('engine that flips false to true is counted as false feasibility', () => {
    const lying: typeof planRoutes = (p, o, opts) => {
      const r = planRoutes(p, o, opts);
      if (r.status !== 'routes') return r;
      return { ...r, routes: r.routes.map((x) => ({ ...x, feasible_by_deadline: true })) };
    };
    const m = measureStudentSide({ profiles: [STUDENT], catalog: [OPP], today, engines: { planRoutes: lying } });
    expect(m.routes_total).toBeGreaterThan(0);
    expect(m.false_feasibility.claimed_feasible).toBe(m.routes_total);
    expect(m.false_feasibility.rejected_by_deadline_check).toBe(m.routes_total);
    expect(m.checker.problems_by_check.deadline_claim).toBe(m.routes_total);
    expect(m.checker.problem_routes.every((r) => r.opportunity_id === OPP.id && r.checks.includes('deadline_claim'))).toBe(true);
    // 引擎自称可行也会让「有效路线发现率」的分子变大——指标照实计数，错误由 false_feasibility 单独报出。
    expect(m.route_discovery.with_feasible_route).toBe(1);
    expect(JSON.stringify(m)).not.toContain(STUDENT.id);
  });

  it('engine that returns routes for a blocked student is a blocked-plan violation', () => {
    const young = { ...STUDENT, grade: 7 };
    const gated = { ...OPP, requirements: [{ id: 'req-grade', type: 'grade' as const, min: 9, max: 12, label: 'Grades 9-12', hard: true, source_text: 'Grades 9-12.' }] };
    const leaky: typeof planRoutes = (p, o, opts) => planRoutes({ ...p, grade: 10 }, o, opts) as PlanResult;
    const m = measureStudentSide({ profiles: [young], catalog: [gated], today, engines: { planRoutes: leaky } });
    expect(m.checker.blocked_plan_violations).toBe(1);
    expect(m.checker.problem_plans).toEqual([{ opportunity_id: gated.id, checks: ['blocked_has_no_routes'] }]);
  });
});
