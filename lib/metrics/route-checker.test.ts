/**
 * 独立路线检查器的测试。夹具全部是测试文件内的虚构机会 / 虚构档案（不依赖 data/）。
 * 正向：真实引擎产出的路线通过检查。反向：逐项篡改一条通过的路线，检查器必须报出对应的 check 名
 * （防止检查器是摆设）。静态守卫：route-checker.ts 不 import lib/path 等规划模块。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { planRoutes } from '../path';
import type { Opportunity, PlanResult, PrepItem, Route, StudentProfile } from '../types';
import { checkPlan, checkRoute } from './route-checker';
import type { CheckOutcome } from './route-checker';

// ───────────────────────── 虚构夹具 ─────────────────────────

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return {
    skill: null,
    evidence_kind: null,
    estimated_hours: 1,
    estimated_cost_usd: 0,
    depends_on: [],
    required_for_application: false,
    ...p,
  };
}

const TODAY = '2026-11-19';

const OPP: Opportunity = {
  id: 'fic-lab',
  title: 'Fictional Data Lab (not real)',
  organizer: 'Example Org (fictional)',
  category: 'summer_program',
  fields: ['data_science'],
  summary: 'Fictional opportunity for unit tests only.',
  official_url: 'https://example.com/fic-lab',
  verified_on: '2026-11-19',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  recurring_annually: true,
  location: { format: 'online' },
  cost: { fee_usd: 15, requires_travel_expense: false },
  time_commitment: { hours_per_week: 3, total_weeks: 4 },
  required_devices: [],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9-12', hard: true, source_text: 'Open to grades 9-12.' },
  ],
  preparation: [
    prep({ id: 'prep-python', title: 'Python basics', skill: 'python', estimated_hours: 5, estimated_cost_usd: 2 }),
    prep({ id: 'prep-data', title: 'Data analysis intro', estimated_hours: 3, depends_on: ['prep-python'] }),
    prep({
      id: 'prep-project',
      title: 'Small data project',
      evidence_kind: 'project',
      estimated_hours: 8,
      estimated_cost_usd: 5,
      depends_on: ['prep-python'],
      required_for_application: true,
      source_text: 'Applicants submit a short project.',
    }),
    prep({ id: 'prep-essay', title: 'Personal statement', estimated_hours: 4, required_for_application: true, source_text: 'Submit a personal statement.' }),
    prep({ id: 'prep-letter', title: 'Teacher letter', estimated_hours: 2, depends_on: ['prep-essay'], required_for_application: true, source_text: 'One letter.' }),
  ],
  is_sample: true,
};

/** 虚构 hackathon：小时数未写（hours_per_week null），用来生成 competition 路线。 */
const HACK: Opportunity = {
  ...OPP,
  id: 'fic-hack',
  title: 'Fictional Data Hackathon (not real)',
  category: 'hackathon',
  official_url: 'https://example.com/fic-hack',
  deadline: '2026-12-01',
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: null, total_weeks: 1, start_date: '2026-12-05', end_date: '2026-12-06' },
  requirements: [],
  preparation: [],
};

const STUDENT: StudentProfile = {
  id: 'fic-student',
  is_sample: true,
  display_name: 'Fictional student',
  grade: 11,
  region: { country: 'US', state: 'CA' },
  hours_per_week_available: 5,
  budget_usd: 100,
  evidence: [
    {
      id: 'ev-python',
      title: 'Python notebook (fictional)',
      kind: 'project',
      skills: ['python'],
      prep_item_ids: ['fic-lab:prep-python'],
      status: 'self_reported',
      added_on: '2026-11-01',
    },
  ],
};

function plan(profile: StudentProfile, opp: Opportunity, options: { today?: string; catalog?: Opportunity[] } = { today: TODAY }): PlanResult {
  return planRoutes(profile, opp, options);
}

function routesOf(p: PlanResult): Route[] {
  if (p.status !== 'routes') throw new Error('expected routes');
  return p.routes;
}

function routeOf(p: PlanResult, type: Route['type']): Route {
  const r = routesOf(p).find((x) => x.type === type);
  if (!r) throw new Error(`no ${type} route`);
  return r;
}

const clone = <T>(x: T): T => structuredClone(x);
const checks = (o: CheckOutcome) => o.problems.map((p) => p.check);

// ───────────────────────── 正向 ─────────────────────────

describe('route checker accepts real engine output', () => {
  const cases: [string, StudentProfile, Opportunity, { today?: string; catalog?: Opportunity[] }][] = [
    ['with evidence and today', STUDENT, OPP, { today: TODAY }],
    ['without evidence', { ...STUDENT, evidence: [] }, OPP, { today: TODAY }],
    ['without today', STUDENT, OPP, {}],
    ['few weekly hours', { ...STUDENT, hours_per_week_available: 1 }, OPP, { today: TODAY }],
    ['no weekly hours', { ...STUDENT, hours_per_week_available: null }, OPP, { today: TODAY }],
    ['deadline passed', STUDENT, OPP, { today: '2027-04-01' }],
    ['with catalog (competition route)', { ...STUDENT, evidence: [] }, OPP, { today: TODAY, catalog: [OPP, HACK] }],
  ];
  for (const [name, profile, opp, options] of cases) {
    it(name, () => {
      const p = plan(profile, opp, options);
      expect(checkPlan(profile, opp, p, options)).toEqual({ ok: true, problems: [] });
      for (const r of routesOf(p)) expect(checkRoute(profile, opp, r, options)).toEqual({ ok: true, problems: [] });
    });
  }

  it('the fixtures exercise skips, feasible true / false / null and a competition route', () => {
    const base = plan(STUDENT, OPP);
    expect(routeOf(base, 'learning_first').steps.find((s) => s.id === 'prep-python')?.skipped).toBe(true);
    expect(routeOf(base, 'learning_first').feasible_by_deadline).toBe(true);
    expect(routeOf(plan({ ...STUDENT, hours_per_week_available: 1 }, OPP), 'learning_first').feasible_by_deadline).toBe(false);
    expect(routeOf(plan(STUDENT, OPP, { today: '2027-04-01' }), 'learning_first').feasible_by_deadline).toBe(false);
    expect(routeOf(plan({ ...STUDENT, hours_per_week_available: null }, OPP), 'learning_first').feasible_by_deadline).toBeNull();
    const comp = routeOf(plan({ ...STUDENT, evidence: [] }, OPP, { today: TODAY, catalog: [OPP, HACK] }), 'competition');
    expect(comp.feasible_by_deadline).toBeNull();
    expect(comp.steps.some((s) => s.prep_item_id === 'prep-project')).toBe(false);
  });

  it('deadline is today: the engine reports null and the checker agrees (no deadline_claim)', () => {
    // 只剩一个 0.5 小时的步骤：旧引擎按 max(天数, 1) 会报 true，而检查器按 0 天会否决；现在两者一致。
    const tiny: Opportunity = { ...OPP, preparation: [{ ...OPP.preparation[0], id: 'prep-tiny', estimated_hours: 0.5, depends_on: [] }] };
    const options = { today: OPP.deadline as string };
    const p = plan(STUDENT, tiny, options);
    for (const r of routesOf(p)) {
      expect(r.feasible_by_deadline).toBeNull();
      expect(checkRoute(STUDENT, tiny, r, options)).toEqual({ ok: true, problems: [] });
    }
    expect(checkPlan(STUDENT, tiny, p, options)).toEqual({ ok: true, problems: [] });
  });

  it('a blocked plan passes', () => {
    const young = { ...STUDENT, grade: 7 };
    const p = plan(young, OPP);
    expect(p.status).toBe('blocked');
    expect(checkPlan(young, OPP, p, { today: TODAY }).ok).toBe(true);
  });
});

// ───────────────────────── 反向：逐项篡改 ─────────────────────────

describe('route checker catches tampering', () => {
  const opts = { today: TODAY };
  const good = () => clone(routeOf(plan(STUDENT, OPP), 'learning_first'));

  it('baseline route is clean', () => {
    expect(checkRoute(STUDENT, OPP, good(), opts).ok).toBe(true);
  });

  it('dependency order shuffled → dependency_order', () => {
    const r = good();
    const i = r.steps.findIndex((s) => s.id === 'prep-letter');
    const j = r.steps.findIndex((s) => s.id === 'prep-essay');
    [r.steps[i], r.steps[j]] = [r.steps[j], r.steps[i]];
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('dependency_order');
  });

  it('steps reversed → dependency_order', () => {
    const r = good();
    r.steps.reverse();
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('dependency_order');
  });

  it('dependency on a missing step → dependencies_exist', () => {
    const r = good();
    r.steps[1].depends_on.push('no-such-step');
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('dependencies_exist');
  });

  it('self dependency → dependencies_exist', () => {
    const r = good();
    r.steps[1].depends_on.push(r.steps[1].id);
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('dependencies_exist');
  });

  it('duplicate step id → step_ids_unique', () => {
    const r = good();
    r.steps.splice(1, 0, { ...clone(r.steps[0]) });
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('step_ids_unique');
  });

  it('prep_item_id not in the opportunity → prep_items_exist', () => {
    const r = good();
    r.steps[1].prep_item_id = 'prep-ghost';
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('prep_items_exist');
  });

  it('required prep step removed → required_prep_covered', () => {
    const r = good();
    r.steps = r.steps.filter((s) => s.prep_item_id !== 'prep-essay');
    for (const s of r.steps) s.depends_on = s.depends_on.filter((d) => d !== 'prep-essay');
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('required_prep_covered');
  });

  it('a non-competition route may not drop a practice prep item either', () => {
    const r = good();
    r.steps = r.steps.filter((s) => s.prep_item_id !== 'prep-project');
    for (const s of r.steps) s.depends_on = s.depends_on.filter((d) => d !== 'prep-project');
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('required_prep_covered');
  });

  it('total_hours + 1 → total_hours', () => {
    const r = good();
    r.total_hours += 1;
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('total_hours');
  });

  it('total_cost_usd + 1 → total_cost', () => {
    const r = good();
    r.total_cost_usd += 1;
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('total_cost');
  });

  it('step marked skipped without evidence → skips_justified', () => {
    const r = good();
    const s = r.steps.find((x) => x.id === 'prep-essay');
    if (!s) throw new Error('missing step');
    s.skipped = true;
    s.skip_reason = 'Already done';
    // 合计也同步改掉，确保报出的是跳过本身的问题。
    r.total_hours -= s.hours;
    r.total_cost_usd -= s.cost_usd;
    const o = checkRoute(STUDENT, OPP, r, opts);
    expect(checks(o)).toContain('skips_justified');
  });

  it('skip by evidence the profile does not have → skips_justified', () => {
    const r = good();
    const s = r.steps.find((x) => x.id === 'prep-python');
    if (!s) throw new Error('missing step');
    s.satisfied_by_evidence_ids = ['ev-ghost'];
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('skips_justified');
  });

  it('skipped step without skip_reason → skips_justified', () => {
    const r = good();
    const s = r.steps.find((x) => x.id === 'prep-python');
    if (!s) throw new Error('missing step');
    s.skip_reason = null;
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('skips_justified');
  });

  it('unskipped step listing evidence → skips_justified', () => {
    const r = good();
    const s = r.steps.find((x) => x.id === 'prep-data');
    if (!s) throw new Error('missing step');
    s.satisfied_by_evidence_ids = ['ev-python'];
    expect(checks(checkRoute(STUDENT, OPP, r, opts))).toContain('skips_justified');
  });

  it('false → true after the deadline passed → deadline_claim', () => {
    const late = { today: '2027-04-01' };
    const r = clone(routeOf(plan(STUDENT, OPP, late), 'learning_first'));
    expect(r.feasible_by_deadline).toBe(false);
    r.feasible_by_deadline = true;
    expect(checks(checkRoute(STUDENT, OPP, r, late))).toContain('deadline_claim');
  });

  it('false → true with too few weekly hours → deadline_claim', () => {
    const slow = { ...STUDENT, hours_per_week_available: 1 };
    const r = clone(routeOf(plan(slow, OPP), 'learning_first'));
    expect(r.feasible_by_deadline).toBe(false);
    r.feasible_by_deadline = true;
    expect(checks(checkRoute(slow, OPP, r, opts))).toContain('deadline_claim');
  });

  it('true kept but hours inflated past capacity → deadline_claim (uses its own sum)', () => {
    const r = good();
    const s = r.steps.find((x) => x.id === 'prep-essay');
    if (!s) throw new Error('missing step');
    s.hours += 500;
    const o = checkRoute(STUDENT, OPP, r, opts);
    expect(checks(o)).toContain('deadline_claim');
    expect(checks(o)).toContain('total_hours');
  });

  it('null → true when weekly hours are missing → deadline_claim', () => {
    const noHours = { ...STUDENT, hours_per_week_available: null };
    const r = clone(routeOf(plan(noHours, OPP), 'learning_first'));
    expect(r.feasible_by_deadline).toBeNull();
    r.feasible_by_deadline = true;
    expect(checks(checkRoute(noHours, OPP, r, opts))).toContain('deadline_claim');
  });

  it('null → true when no today was given → deadline_claim', () => {
    const r = clone(routeOf(plan(STUDENT, OPP, {}), 'learning_first'));
    expect(r.feasible_by_deadline).toBeNull();
    r.feasible_by_deadline = true;
    expect(checks(checkRoute(STUDENT, OPP, r, {}))).toContain('deadline_claim');
  });

  it('null → true with no deadline → deadline_claim', () => {
    const rolling = { ...OPP, deadline: null };
    const r = clone(routeOf(plan(STUDENT, rolling), 'learning_first'));
    expect(r.feasible_by_deadline).toBeNull();
    r.feasible_by_deadline = true;
    expect(checks(checkRoute(STUDENT, rolling, r, opts))).toContain('deadline_claim');
  });

  it('competition null → true while the competition hours are unknown → deadline_claim', () => {
    const fresh = { ...STUDENT, evidence: [] };
    const o = { today: TODAY, catalog: [OPP, HACK] };
    const r = clone(routeOf(plan(fresh, OPP, o), 'competition'));
    expect(r.feasible_by_deadline).toBeNull();
    r.feasible_by_deadline = true;
    const out = checkRoute(fresh, OPP, r, o);
    expect(out.problems).toEqual([expect.objectContaining({ check: 'deadline_claim' })]);
  });

  it('competition route that drops a second required prep → required_prep_covered', () => {
    const fresh = { ...STUDENT, evidence: [] };
    const o = { today: TODAY, catalog: [OPP, HACK] };
    const r = clone(routeOf(plan(fresh, OPP, o), 'competition'));
    r.steps = r.steps.filter((s) => s.prep_item_id !== 'prep-essay');
    for (const s of r.steps) s.depends_on = s.depends_on.filter((d) => d !== 'prep-essay');
    expect(checks(checkRoute(fresh, OPP, r, o))).toContain('required_prep_covered');
  });
});

describe('plan checker catches tampering', () => {
  const opts = { today: TODAY };

  it('blocked plan with a route → blocked_has_no_routes', () => {
    const young = { ...STUDENT, grade: 7 };
    const p = plan(young, OPP);
    const route = routeOf(plan(STUDENT, OPP), 'learning_first');
    const tampered = { ...p, routes: [route] } as unknown as PlanResult;
    expect(checks(checkPlan(young, OPP, tampered, opts))).toContain('blocked_has_no_routes');
  });

  it('routes for a not_eligible student → blocked_has_no_routes', () => {
    const young = { ...STUDENT, grade: 7 };
    expect(checks(checkPlan(young, OPP, plan(STUDENT, OPP), opts))).toContain('blocked_has_no_routes');
  });

  it('blocked although eligible → blocked_has_no_routes', () => {
    const blocked = plan({ ...STUDENT, grade: 7 }, OPP);
    expect(checks(checkPlan(STUDENT, OPP, blocked, opts))).toContain('blocked_has_no_routes');
  });

  it('only one route → route_count', () => {
    const p = plan(STUDENT, OPP);
    const one = { ...p, routes: routesOf(p).slice(0, 1) } as PlanResult;
    expect(checks(checkPlan(STUDENT, OPP, one, opts))).toContain('route_count');
  });
});

// ───────────────────────── 静态守卫 ─────────────────────────

describe('independence', () => {
  it('route-checker.ts does not import the route planner (or other planning modules)', () => {
    const src = readFileSync(fileURLToPath(new URL('./route-checker.ts', import.meta.url)), 'utf8');
    const specifiers = [...src.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    const forbidden = /(^|\/)(path|match|gap|planner|reachability)(\/|$)/;
    for (const s of specifiers) {
      expect(s.startsWith('.') || s.startsWith('@/')).toBe(true);
      expect(forbidden.test(s.replace(/^@\/lib\//, '../')), `forbidden import ${s}`).toBe(false);
    }
    expect(src).not.toMatch(/from\s+['"](\.\.\/path|@\/lib\/path)/);
  });
});
