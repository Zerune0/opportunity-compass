/**
 * planAcrossOpportunities 完整版新增行为的测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 * 路线选择的「可行优先 / 必需小时少优先 / 并列稳定」用 vi.mock 构造 planRoutes 的返回（id 以 mock- 开头的机会），
 * 因为真实 planRoutes 的各条路线步骤相同，选不出差别；其余机会走真实的 planRoutes。
 */
import { describe, expect, it, vi } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { planAcrossOpportunities } from '.';
import type { Material, Opportunity, PlanResult, PrepItem, Route, RouteStep, RouteType, StudentProfile } from '../types';

const MOCK_PLANS = new Map<string, PlanResult>();

vi.mock('../path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../path')>();
  return {
    ...actual,
    planRoutes: (profile: StudentProfile, o: Opportunity, options?: { today?: string }) =>
      MOCK_PLANS.get(o.id) ?? actual.planRoutes(profile, o, options),
  };
});

const TODAY = '2026-11-18'; // 周三

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 2, estimated_cost_usd: 0, depends_on: [], required_for_application: true, ...p };
}

function opp(id: string, deadline: string | null, preparation: PrepItem[], over: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    title: `Fictional ${id} (sample, not real)`,
    organizer: 'Example Org (fictional)',
    category: 'project',
    fields: ['climate'],
    summary: 'Fictional opportunity for tests.',
    official_url: `https://example.com/${id}`,
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: null, total_weeks: null },
    required_devices: [],
    requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12.' }],
    preparation,
    is_sample: true,
    ...over,
  };
}

const STUDENT: StudentProfile = {
  id: 'planner-full-student',
  is_sample: true,
  display_name: 'Sample student (planner full test)',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  school_name: 'Example High (fictional)',
  hours_per_week_available: 3,
  budget_usd: 50,
  transport: { level: 'reliable' },
  devices: ['laptop'],
  skills: [],
  evidence: [],
  interests: ['climate'],
};

const item = (plan: ReturnType<typeof planAcrossOpportunities>, id: string) => plan.items.find((i) => i.opportunity_id === id)!;

// ───────────────────────────── 路线选择（mock） ─────────────────────────────

function step(id: string, hours: number, prepId: string | null = id, depends_on: string[] = []): RouteStep {
  return { id, title: id, prep_item_id: prepId, depends_on, hours, cost_usd: 0, skipped: false, skip_reason: null, satisfied_by_evidence_ids: [] };
}

function route(oppId: string, type: RouteType, steps: RouteStep[], feasible: boolean | null): Route {
  return {
    id: `${oppId}:${type}`,
    type,
    title: type,
    steps,
    total_hours: steps.reduce((s, x) => s + x.hours, 0),
    total_cost_usd: 0,
    estimated_weeks: null,
    feasible_by_deadline: feasible,
    rationale: 'mock',
    warnings: [],
  };
}

function mockOpp(id: string, routes: Route[]): Opportunity {
  const o = opp(id, '2026-12-14', [
    prep({ id: 'p-req', title: 'Required', estimated_hours: 1 }),
    prep({ id: 'p-req2', title: 'Required 2', estimated_hours: 1 }),
    prep({ id: 'p-opt', title: 'Optional', estimated_hours: 1, required_for_application: false }),
  ]);
  MOCK_PLANS.set(id, { status: 'routes', profile_id: STUDENT.id, opportunity_id: id, routes, warnings: [] });
  return o;
}

describe('路线选择：可行优先、必需小时少优先、并列按原顺序', () => {
  it('可行的路线优先，即使另一条必需小时更少', () => {
    const id = 'mock-feasible-first';
    const o = mockOpp(id, [
      route(id, 'learning_first', [step('p-req', 2)], false),
      route(id, 'practice_first', [step('p-req', 5)], true),
    ]);
    const it0 = item(planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 20 }, [o], { today: TODAY }), id);
    expect(it0).toMatchObject({ route_type: 'practice_first', hours_before_reuse: 5 });
  });

  it('可行的路线里取必需小时最少的（建议项不算）', () => {
    const id = 'mock-fewest-required';
    const o = mockOpp(id, [
      route(id, 'learning_first', [step('p-req', 3), step('p-req2', 3)], true),
      route(id, 'practice_first', [step('p-req', 3), step('p-opt', 10)], true),
      route(id, 'community', [step('find-partner', 2, null), step('p-req', 3)], true),
    ]);
    const it0 = item(planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 20 }, [o], { today: TODAY }), id);
    expect(it0).toMatchObject({ route_type: 'practice_first', hours_before_reuse: 3 });
    expect(it0.note).toContain('Plus 10 optional hours of suggested prep, not counted here.');
  });

  it('没有可行路线时在全部路线里取必需小时最少的', () => {
    const id = 'mock-none-feasible';
    const o = mockOpp(id, [
      route(id, 'learning_first', [step('p-req', 9)], false),
      route(id, 'community', [step('find-partner', 2, null), step('p-req', 4)], null),
    ]);
    expect(item(planAcrossOpportunities(STUDENT, [o], { today: TODAY }), id)).toMatchObject({ route_type: 'community', hours_before_reuse: 6 });
  });

  it('并列时按 planRoutes 原顺序（稳定）', () => {
    const id = 'mock-tie';
    const o = mockOpp(id, [
      route(id, 'practice_first', [step('p-req', 4)], true),
      route(id, 'learning_first', [step('p-req2', 4)], true),
    ]);
    expect(item(planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 20 }, [o], { today: TODAY }), id).route_type).toBe('practice_first');
  });

  it('真实 planRoutes：learning_first 与 practice_first 步骤相同、社区路线多 2h → 选 learning_first', () => {
    const o = opp('fictional-real-routes', '2026-12-14', [
      prep({ id: 'prep-learn', title: 'Learn basics', estimated_hours: 3 }),
      prep({ id: 'prep-build', title: 'Build a project', estimated_hours: 4, evidence_kind: 'project' }),
    ]);
    expect(item(planAcrossOpportunities(STUDENT, [o], { today: TODAY }), o.id)).toMatchObject({ route_type: 'learning_first', hours_before_reuse: 7 });
  });
});

// ───────────────────────────── 必需 / 建议 ─────────────────────────────

describe('必需 / 建议', () => {
  it('建议项小时不计入 hours_before_reuse，但在 note 里如实说出', () => {
    const o = opp('fictional-optional', '2026-12-14', [
      prep({ id: 'prep-resume', title: 'Write a resume', estimated_hours: 3, material_kind: 'resume', reusable_across_opportunities: true }),
      prep({ id: 'prep-extra', title: 'Extra reading', estimated_hours: 4, required_for_application: false }),
    ]);
    const plan = planAcrossOpportunities(STUDENT, [o], { today: TODAY });
    expect(item(plan, o.id)).toMatchObject({ hours_before_reuse: 3, required_hours: 3 });
    expect(item(plan, o.id).note).toContain('Plus 4 optional hours of suggested prep, not counted here.');
    expect(plan.total_hours).toBe(3);
  });

  it('必需项依赖的（非必需）前置步骤计入必需；已被证据跳过的前置不计、也不再往前追', () => {
    const preps = [
      prep({ id: 'prep-basics', title: 'Basics', estimated_hours: 2, required_for_application: false }),
      prep({ id: 'prep-python', title: 'Learn Python', skill: 'python', estimated_hours: 5, required_for_application: false, depends_on: ['prep-basics'] }),
      prep({ id: 'prep-essay', title: 'Essay', estimated_hours: 3, depends_on: ['prep-python'] }),
      prep({ id: 'prep-fun', title: 'Fun extra', estimated_hours: 1, required_for_application: false }),
    ];
    const o = opp('fictional-closure', '2026-12-14', preps);
    expect(item(planAcrossOpportunities(STUDENT, [o], { today: TODAY }), o.id).hours_before_reuse).toBe(10);
    const withEv: StudentProfile = {
      ...STUDENT,
      evidence: [{ id: 'ev-py', title: 'Python project (sample)', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2026-11-10' }],
    };
    const it1 = item(planAcrossOpportunities(withEv, [o], { today: TODAY }), o.id);
    expect(it1.hours_before_reuse).toBe(3);
    expect(it1.note).toContain('Plus 3 optional hours of suggested prep'); // basics 2 + fun 1
  });

  it('没有建议项时 note 不提 optional', () => {
    const o = opp('fictional-all-required', '2026-12-14', [prep({ id: 'prep-a', title: 'A', estimated_hours: 2 })]);
    expect(item(planAcrossOpportunities(STUDENT, [o], { today: TODAY }), o.id).note).not.toContain('optional');
  });
});

// ───────────────────────────── 依赖链 ─────────────────────────────

describe('依赖链', () => {
  // today 11-18、截止 12-01 → D = 14 天；H = 3 → 可用 6h。
  it('必需步骤的依赖链小时超过截止前可用小时 → note 与 warnings 都说明', () => {
    const o = opp('fictional-chain', '2026-12-01', [
      prep({ id: 'prep-a', title: 'Step A', estimated_hours: 4 }),
      prep({ id: 'prep-b', title: 'Step B', estimated_hours: 4, depends_on: ['prep-a'] }),
    ]);
    const plan = planAcrossOpportunities(STUDENT, [o], { today: TODAY });
    const it0 = item(plan, o.id);
    expect(it0.feasible_alone).toBe(false);
    expect(it0.note).toContain('"Step A" → "Step B"');
    expect(it0.note).toContain('about 8 hours');
    expect(plan.warnings.some((w) => w.includes('"Step A" → "Step B"'))).toBe(true);
  });

  it('同样的总小时但步骤互不依赖 → 没有依赖链提醒（feasible_alone 仍为 false）', () => {
    const o = opp('fictional-parallel', '2026-12-01', [
      prep({ id: 'prep-a', title: 'Step A', estimated_hours: 4 }),
      prep({ id: 'prep-b', title: 'Step B', estimated_hours: 4 }),
    ]);
    const plan = planAcrossOpportunities(STUDENT, [o], { today: TODAY });
    expect(item(plan, o.id).feasible_alone).toBe(false);
    expect(plan.warnings.some((w) => w.includes('→'))).toBe(false);
  });

  it('链放得下时不提醒；没有每周可用小时时不判断', () => {
    const o = opp('fictional-chain-ok', '2026-12-01', [
      prep({ id: 'prep-a', title: 'Step A', estimated_hours: 2 }),
      prep({ id: 'prep-b', title: 'Step B', estimated_hours: 2, depends_on: ['prep-a'] }),
    ]);
    expect(planAcrossOpportunities(STUDENT, [o], { today: TODAY }).warnings.some((w) => w.includes('→'))).toBe(false);
    const big = opp('fictional-chain-big', '2026-12-01', [
      prep({ id: 'prep-a', title: 'Step A', estimated_hours: 20 }),
      prep({ id: 'prep-b', title: 'Step B', estimated_hours: 20, depends_on: ['prep-a'] }),
    ]);
    expect(planAcrossOpportunities({ ...STUDENT, hours_per_week_available: null }, [big], { today: TODAY }).warnings.some((w) => w.includes('→'))).toBe(false);
  });

  it('依赖成环不抛错', () => {
    const o = opp('fictional-cycle', '2026-12-01', [
      prep({ id: 'prep-a', title: 'Step A', estimated_hours: 5, depends_on: ['prep-b'] }),
      prep({ id: 'prep-b', title: 'Step B', estimated_hours: 5, depends_on: ['prep-a'] }),
    ]);
    expect(() => planAcrossOpportunities(STUDENT, [o], { today: TODAY })).not.toThrow();
  });
});

// ───────────────────────────── 已有材料 ─────────────────────────────

describe('已有材料（options.materials）', () => {
  const RESUME = (h: number) => prep({ id: 'prep-resume', title: 'Write a resume', estimated_hours: h, material_kind: 'resume', reusable_across_opportunities: true });
  const STATEMENT = (h: number) => prep({ id: 'prep-statement', title: 'Write a personal statement', estimated_hours: h, material_kind: 'personal_statement', reusable_across_opportunities: false });
  const X = opp('fictional-mx', '2026-12-01', [RESUME(4), STATEMENT(3)]);
  const Y = opp('fictional-my', '2026-12-14', [RESUME(5), STATEMENT(2)]);
  const mat = (m: Partial<Material>): Material => ({
    id: 'm1',
    profile_id: STUDENT.id,
    kind: 'resume',
    title: 'My resume (sample)',
    reusable: true,
    opportunity_id: null,
    estimated_hours: 4,
    status: 'ready',
    ...m,
  });

  it('就绪的通用简历 → 两个机会的简历步骤都计 0，复用条目消失，note 说明 already prepared', () => {
    const plan = planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY, materials: [mat({})] });
    expect(item(plan, X.id).hours_before_reuse).toBe(3);
    expect(item(plan, Y.id).hours_before_reuse).toBe(2);
    expect(plan.reuse.some((r) => r.material_kind === 'resume')).toBe(false);
    expect(item(plan, X.id).note).toContain('already prepared');
    expect(item(plan, Y.id).note).toContain('already prepared');
  });

  it('未就绪（in_progress / not_started）不减小时，与不传一致', () => {
    const base = planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY });
    for (const status of ['in_progress', 'not_started'] as const) {
      expect(planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY, materials: [mat({ status })] })).toEqual(base);
    }
  });

  it('不传 / 传 [] 与原行为一致', () => {
    const base = planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY });
    expect(planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY, materials: [] })).toEqual(base);
    expect(planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY, materials: undefined })).toEqual(base);
  });

  it('针对某个机会的个人陈述只对那个机会生效', () => {
    const m = mat({ kind: 'personal_statement', reusable: false, opportunity_id: X.id, prep_item_id: 'prep-statement' });
    const plan = planAcrossOpportunities(STUDENT, [X, Y], { today: TODAY, materials: [m] });
    expect(item(plan, X.id).hours_before_reuse).toBe(4);
    expect(item(plan, Y.id).hours_before_reuse).toBe(7);
    expect(item(plan, X.id).note).toContain('already prepared');
    expect(item(plan, Y.id).note).not.toContain('already prepared');
  });

  it('通用材料不抵消要求针对性准备的同类准备项；prep_item_id 不同的针对性材料不生效', () => {
    const generic = mat({ kind: 'personal_statement', reusable: true });
    const plan = planAcrossOpportunities(STUDENT, [X], { today: TODAY, materials: [generic] });
    expect(item(plan, X.id).hours_before_reuse).toBe(7);
    const wrongPrep = mat({ kind: 'personal_statement', reusable: false, opportunity_id: X.id, prep_item_id: 'prep-other' });
    expect(item(planAcrossOpportunities(STUDENT, [X], { today: TODAY, materials: [wrongPrep] }), X.id).hours_before_reuse).toBe(7);
  });

  it('其他档案的材料忽略；坏材料不抛错', () => {
    const plan = planAcrossOpportunities(STUDENT, [X], { today: TODAY, materials: [mat({ profile_id: 'someone-else' })] });
    expect(item(plan, X.id).hours_before_reuse).toBe(7);
    expect(() =>
      planAcrossOpportunities(STUDENT, [X], { today: TODAY, materials: [null, 3, { kind: 'resume' }, { status: 'ready', kind: 'nope' }] as unknown as Material[] }),
    ).not.toThrow();
    expect(() => planAcrossOpportunities(STUDENT, [X], { today: TODAY, materials: 'bad' as unknown as Material[] })).not.toThrow();
  });
});

// ───────────────────────────── 参与期 ─────────────────────────────

describe('参与期的每周投入', () => {
  const tc = (start: string | null, end: string | null, hours: number | null) => ({ time_commitment: { hours_per_week: hours, total_weeks: null, start_date: start, end_date: end } });
  const H10 = { ...STUDENT, hours_per_week_available: 10 };

  it('两个机会参与期重叠、合计每周小时超过可用 → 一条 warning（机会、区间、合计、可用）', () => {
    const A = opp('fictional-pa', '2026-12-01', [], tc('2027-01-04', '2027-01-31', 6));
    const B = opp('fictional-pb', '2026-12-05', [], tc('2027-01-18', '2027-02-14', 6));
    const plan = planAcrossOpportunities(H10, [A, B], { today: TODAY });
    const w = plan.warnings.filter((x) => x.includes('program periods'));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('From 2027-01-18 to 2027-01-31');
    expect(w[0]).toContain('about 12 hours per week in total');
    expect(w[0]).toContain('about 10 hours per week');
    expect(w[0]).toContain(A.title);
    expect(w[0]).toContain(B.title);
    expect(plan.conflicts.join(' ')).not.toContain('program periods');
  });

  it('合计不超过可用 → 不提醒', () => {
    const A = opp('fictional-pa', '2026-12-01', [], tc('2027-01-04', '2027-01-31', 4));
    const B = opp('fictional-pb', '2026-12-05', [], tc('2027-01-18', '2027-02-14', 4));
    expect(planAcrossOpportunities(H10, [A, B], { today: TODAY }).warnings.some((x) => x.includes('program periods'))).toBe(false);
  });

  it('数据缺失（没有每周小时 / 没有日期）→ 不判断', () => {
    const A = opp('fictional-pa', '2026-12-01', [], tc('2027-01-04', '2027-01-31', null));
    const B = opp('fictional-pb', '2026-12-05', [], tc('2027-01-18', '2027-02-14', 20));
    const C = opp('fictional-pc', '2026-12-06', [], tc(null, '2027-02-14', 20));
    const plan = planAcrossOpportunities(H10, [A, B, C], { today: TODAY });
    expect(plan.warnings.some((x) => x.includes('program periods'))).toBe(false);
    expect(plan.conflicts).toEqual([]);
  });

  it('三个机会：重叠区间按参与集合分段', () => {
    const A = opp('fictional-pa', '2026-12-01', [], tc('2027-01-01', '2027-01-20', 6));
    const B = opp('fictional-pb', '2026-12-02', [], tc('2027-01-10', '2027-01-31', 6));
    const C = opp('fictional-pc', '2026-12-03', [], tc('2027-01-15', '2027-01-25', 6));
    const w = planAcrossOpportunities(H10, [A, B, C], { today: TODAY }).warnings.filter((x) => x.includes('program periods'));
    expect(w.map((x) => x.slice(0, 33))).toEqual([
      'From 2027-01-10 to 2027-01-14, th',
      'From 2027-01-15 to 2027-01-20, th',
      'From 2027-01-21 to 2027-01-25, th',
    ]);
    expect(w[1]).toContain('about 18 hours per week in total');
  });

  it('准备期与另一个机会的参与期重叠 → 说明那段时间还剩几小时可用于准备', () => {
    const A = opp('fictional-pa', '2026-12-14', [prep({ id: 'prep-a', title: 'A', estimated_hours: 4 })]);
    const B = opp('fictional-pb', '2026-11-25', [], tc('2026-12-01', '2026-12-20', 6));
    const plan = planAcrossOpportunities(H10, [A, B], { today: TODAY });
    const w = plan.warnings.find((x) => x.includes('overlaps the time before the deadline'))!;
    expect(w).toContain('From 2026-12-01 to 2026-12-14');
    expect(w).toContain('about 4 hours per week left for preparing');
  });
});

// ───────────────────────────── 优先顺序的整体对照 ─────────────────────────────

describe('priorities 的跨周整体对照', () => {
  // 三个机会同一截止日 12-14（D = 27 天），H = 3 → 每周不超 ⇔ 合计 ≤ 3 × 27 / 7 ≈ 11.57h。
  const one = (id: string, h: number) => opp(id, '2026-12-14', [prep({ id: 'prep-w', title: 'Work', estimated_hours: h })]);
  const overall = (plan: ReturnType<typeof planAcrossOpportunities>) => plan.conflicts.filter((c) => c.startsWith('Across all weeks'));

  it('只保留前 2 个时不超 → 说明 top 2 与总小时，措辞是对照', () => {
    const plan = planAcrossOpportunities(STUDENT, [one('fa', 5), one('fb', 5), one('fc', 5)], { today: TODAY, priorities: ['fc', 'fa', 'fb'] });
    const o = overall(plan);
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('if you kept only your top 2 priorities');
    expect(o[0]).toContain('no week would exceed');
    expect(o[0]).toContain('about 10 hours in total, compared with about 15 hours');
    expect(o[0]).toContain('not advice to drop anything; you decide');
    expect(o[0]).not.toMatch(/you should|we recommend|drop "/i);
    expect(o[0].indexOf('fc')).toBeLessThan(o[0].indexOf('fa'));
  });

  it('只有保留第 1 个时才不超 → top priority', () => {
    const plan = planAcrossOpportunities(STUDENT, [one('fa', 8), one('fb', 8), one('fc', 8)], { today: TODAY, priorities: ['fb'] });
    const o = overall(plan);
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('if you kept only your top priority (');
    expect(o[0]).toContain('about 8 hours in total, compared with about 24 hours');
  });

  it('即使只保留第 1 个也超 → 说明超出的周数', () => {
    const plan = planAcrossOpportunities(STUDENT, [one('fa', 13), one('fb', 2)], { today: TODAY, priorities: ['fa', 'fb'] });
    const o = overall(plan);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatch(/even if you kept only your top priority \(.*\), \d+ weeks? would still exceed/);
  });

  it('复用在子集里重新计算（承担者被去掉时由下一个机会承担）', () => {
    const R = (h: number) => prep({ id: 'prep-resume', title: 'Resume', estimated_hours: h, material_kind: 'resume', reusable_across_opportunities: true });
    const A = opp('fra', '2026-12-01', [R(6), prep({ id: 'prep-x', title: 'X', estimated_hours: 6 })]);
    const B = opp('frb', '2026-12-14', [R(6)]);
    const plan = planAcrossOpportunities(STUDENT, [A, B], { today: TODAY, priorities: ['frb', 'fra'] });
    // 全部：12 + 0 = 12；只保留 B：B 自己要做简历 6h。
    const o = overall(plan);
    expect(o).toHaveLength(1);
    expect(o[0]).toContain('about 6 hours in total, compared with about 12 hours');
  });

  it('没有超出的周 / 没给 priorities → 没有整体对照；priorities 不改变 items', () => {
    const light = planAcrossOpportunities(STUDENT, [one('fa', 1), one('fb', 1)], { today: TODAY, priorities: ['fa'] });
    expect(overall(light)).toEqual([]);
    const heavy = [one('fa', 5), one('fb', 5), one('fc', 5)];
    const noP = planAcrossOpportunities(STUDENT, heavy, { today: TODAY });
    expect(overall(noP)).toEqual([]);
    expect(noP.conflicts.length).toBe(noP.weekly_load.filter((w) => w.over).length);
    expect(planAcrossOpportunities(STUDENT, heavy, { today: TODAY, priorities: ['fb'] }).items).toEqual(noP.items);
  });

  it('不认识的 id 忽略并写 warning；非字符串也忽略', () => {
    const plan = planAcrossOpportunities(STUDENT, [one('fa', 5), one('fb', 5), one('fc', 5)], {
      today: TODAY,
      priorities: ['nope', 'fa', 7 as unknown as string],
    });
    expect(plan.warnings).toContain('Priority "nope" doesn\'t match any opportunity in this plan, so it was ignored.');
    expect(plan.warnings.some((w) => w.includes('not a valid opportunity id'))).toBe(true);
    expect(overall(plan)[0]).toContain('if you kept only your top priority (');
  });
});

// ───────────────────────────── 评审回归：单周优先对照、复用说明 ─────────────────────────────

describe('评审回归：单周优先对照与复用说明', () => {
  const R = (h: number) => prep({ id: 'prep-resume', title: 'Resume', estimated_hours: h, material_kind: 'resume', reusable_across_opportunities: true });
  // A 承担简历（12h），B 复用简历、自己还要 2h。
  const A = opp('fra', '2026-12-01', [R(6), prep({ id: 'prep-x', title: 'X', estimated_hours: 6 })]);
  const B = opp('frb', '2026-12-14', [R(6), prep({ id: 'prep-y', title: 'Y', estimated_hours: 2 })]);
  const weekNote = (plan: ReturnType<typeof planAcrossOpportunities>, week: string) => plan.conflicts.find((c) => c.startsWith(`Week of ${week}`));

  it('单周对照点出机会标题；只有靠后的优先项出现在那一周时不说 "top priority"', () => {
    const early = opp('fwa', '2026-11-22', [prep({ id: 'prep-a', title: 'A', estimated_hours: 1 })]);
    const late = opp('fwb', '2026-12-14', [prep({ id: 'prep-b', title: 'B', estimated_hours: 20 })]);
    const plan = planAcrossOpportunities(STUDENT, [early, late], { today: TODAY, priorities: ['fwa', 'fwb'] });
    const c = weekNote(plan, '2026-11-23')!;
    expect(c).toBeDefined();
    expect(c).toContain(`Even "${late.title}" alone needs about`);
    expect(c).not.toContain('top priority');
    expect(c).toContain('only for comparison; you decide');
  });

  it('单周对照在保留的子集里重算复用：只留 B 时 B 自己承担简历', () => {
    const plan = planAcrossOpportunities(STUDENT, [A, B], { today: TODAY, priorities: ['frb'] });
    const c = weekNote(plan, '2026-11-23')!;
    expect(c).toBeDefined();
    // 只留 B：6 + 2 = 8h，分摊到 27 天，这一周 7 天 ≈ 2.07h，显示为 2.1（全量计划里 B 只计 2h，会被低估成约 0.5h）。
    expect(c).toContain(`If you kept only "${B.title}" this week, it would need about 2.1 hours.`);
  });

  it('非承担者的 note 说明材料小时计在哪个机会上；承担者不写', () => {
    const plan = planAcrossOpportunities(STUDENT, [A, B], { today: TODAY });
    expect(item(plan, B.id).note).toContain(`Resume hours are counted under "${A.title}" (prepared once, reused here).`);
    expect(item(plan, A.id).note).not.toContain('counted under');
  });
});

// ───────────────────────────── 健壮性、纯函数、公平性 ─────────────────────────────

describe('健壮性、纯函数、公平性', () => {
  const A = opp('fictional-ra', '2026-12-01', [prep({ id: 'prep-resume', title: 'Resume', estimated_hours: 3, material_kind: 'resume', reusable_across_opportunities: true })]);
  const B = opp('fictional-rb', '2026-12-14', [prep({ id: 'prep-resume', title: 'Resume', estimated_hours: 4, material_kind: 'resume', reusable_across_opportunities: true })], {
    time_commitment: { hours_per_week: 5, total_weeks: 2, start_date: '2026-11-25', end_date: '2026-12-10' },
  });
  const MATS: Material[] = [{ id: 'm', profile_id: STUDENT.id, kind: 'essay', title: 'Essay (sample)', reusable: true, opportunity_id: null, estimated_hours: 2, status: 'ready' }];

  it('坏输入不抛异常', () => {
    const cases: unknown[][] = [
      [STUDENT, [A, B], null],
      [STUDENT, [A, B], { today: TODAY, priorities: 'x', materials: {} }],
      [STUDENT, 'not a list', { today: TODAY }],
      [undefined, [A, { id: 'x', preparation: 'bad' }, 5], { today: '2026-02-30' }],
      [{ ...STUDENT, hours_per_week_available: -1 }, [A, B], { today: TODAY, priorities: ['fictional-ra'] }],
      [{ ...STUDENT, hours_per_week_available: Number.NaN }, [B], { today: TODAY }],
    ];
    for (const args of cases) {
      expect(() => (planAcrossOpportunities as (...a: unknown[]) => unknown)(...args)).not.toThrow();
    }
  });

  it('同输入两次调用结果深度相等，且不修改输入', () => {
    const opts = { today: TODAY, priorities: ['fictional-rb', 'fictional-ra'], materials: structuredClone(MATS) };
    const list = structuredClone([A, B]);
    const first = planAcrossOpportunities(STUDENT, list, opts);
    expect(planAcrossOpportunities(STUDENT, list, opts)).toStrictEqual(first);
    expect(list).toEqual([A, B]);
    expect(opts.materials).toEqual(MATS);
  });

  it('只改 school_name / display_name 结果深度相等', () => {
    const opts = { today: TODAY, priorities: ['fictional-rb'], materials: MATS };
    const base = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 1 }, [A, B], opts);
    const other = planAcrossOpportunities(
      { ...STUDENT, hours_per_week_available: 1, school_name: 'Another Example School (fictional)', display_name: 'Another name (sample)' },
      [A, B],
      opts,
    );
    expect(other).toStrictEqual(base);
  });
});

// ───────────────────────────── 冒烟：真实机会 × 示例档案 ─────────────────────────────

describe('冒烟：data/opportunities.json × data/profiles.json', () => {
  const opps = opportunitiesJson as unknown as Opportunity[];
  const profiles = profilesJson as unknown as StudentProfile[];

  it('数据规模符合预期', () => {
    expect(opps.length).toBeGreaterThanOrEqual(3);
    expect(profiles.length).toBeGreaterThanOrEqual(4);
  });

  for (const p of profiles) {
    for (const opts of [{ today: '2026-11-18' }, { today: '2027-02-01', priorities: opps.map((o) => o.id).reverse() }, undefined]) {
      it(`${p.id} / ${opts?.today ?? 'no today'}：不抛错、字段关系成立`, () => {
        const plan = planAcrossOpportunities(p, opps, opts);
        expect(plan.items).toHaveLength(opps.length);
        const planned = plan.items.filter((i) => i.status === 'planned');
        const r2 = (n: number) => Math.round(n * 100) / 100;
        expect(plan.total_hours).toBe(r2(planned.reduce((s, i) => s + i.required_hours, 0)));
        expect(plan.total_hours_without_reuse).toBe(r2(planned.reduce((s, i) => s + i.hours_before_reuse, 0)));
        const savedByReuse = plan.reuse.filter((r) => r.reusable).reduce((s, r) => s + r.hours_saved, 0);
        expect(r2(plan.total_hours_without_reuse - plan.total_hours)).toBe(r2(savedByReuse));
        for (const it of plan.items) {
          expect(it.hours_saved_by_reuse).toBeGreaterThanOrEqual(0);
          if (it.status !== 'planned') expect(it).toMatchObject({ required_hours: 0, hours_before_reuse: 0, hours_saved_by_reuse: 0, route_type: null });
          else expect(it.route_type).not.toBeNull();
          expect(typeof it.note).toBe('string');
        }
        expect(plan.items.map((i) => i.order)).toEqual(plan.items.map((_, i) => i + 1));
        if (!opts) expect(plan.weekly_load).toEqual([]);
        for (const w of plan.weekly_load) if (w.over != null && w.hours_available != null) expect(w.over).toBe(w.hours_needed > w.hours_available);
      });
    }
  }
});
