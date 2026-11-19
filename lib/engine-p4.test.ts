/**
 * 第四阶段第 1 层：学生端引擎的三项新功能。
 * - 共用筛选 findEvidenceBuildingCandidates（lib/match/evidence-building.ts）
 * - planRoutes 的新手竞赛路线 competition
 * - findAlternatives 的 stepping_stone / remote_option
 * - RouteStep 的 relation / official / evidence_needed；analyzeGaps 读 team_requirement
 *
 * 机会与学生都是本文件里的虚构数据（example.com、is_sample: true），不是真实机会。
 * 真实目录上只断言不随数据变化的性质（见文末）；截至 2026-11-19 的具体条数记在 README / CONTRACT。
 */
import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from './data';
import { checkEligibility } from './eligibility';
import { analyzeReachability } from './reachability';
import { normalizedTagSet, sharedTags } from './tags';
import { analyzeGaps } from './gap';
import { findAlternatives } from './match';
import { CONFIRM_ONLINE, STEPPING_STONE_NOTE } from './match';
import { CATEGORY_PRODUCES, findEvidenceBuildingCandidates } from './match/evidence-building';
import { diffRoutes, planRoutes } from './path';
import { TEAM_RELATION, UNCLEAR_REQUIRED_RELATION, competitionDisclaimer, prepOfficial } from './path/plan';
import { planAcrossOpportunities } from './planner';
import type { Opportunity, PlanResult, PrepItem, Route, StudentProfile, TeamRequirement } from './types';

const TODAY = '2026-11-19';

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 1, estimated_cost_usd: 0, depends_on: [], required_for_application: false, ...p };
}

const STUDENT: StudentProfile = {
  id: 'p4-student',
  is_sample: true,
  display_name: 'Test Student (fictional)',
  grade: 10,
  age: 15,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  school_name: 'Example High (fictional)',
  hours_per_week_available: 10,
  budget_usd: 100,
  transport: { level: 'reliable' },
  devices: ['laptop', 'home_internet'],
  skills: [{ name: 'python', level: 'beginner' }],
  evidence: [],
  interests: ['software_development'],
};

/** 目标：同领域、有一个未覆盖的实践类准备项（prep-app，project）。 */
const TARGET: Opportunity = {
  id: 'p4-target-studio',
  title: 'Fictional Code Studio (sample, not real)',
  organizer: 'Example Org (fictional)',
  category: 'summer_program',
  fields: ['software_development', 'stem'],
  summary: 'Fictional target opportunity.',
  official_url: 'https://example.com/p4-target-studio',
  verified_on: '2026-11-18',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  recurring_annually: true,
  location: { format: 'in_person', country: 'US', state: 'CA' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 5, total_weeks: 4 },
  required_devices: [],
  requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Open to grades 9-12.' }],
  preparation: [
    prep({ id: 'prep-js', title: 'Learn JavaScript basics', skill: 'javascript', estimated_hours: 10, source_text: 'Team suggestion — not an official requirement' }),
    prep({
      id: 'prep-app',
      title: 'Build a small web app',
      skill: 'web_app',
      evidence_kind: 'project',
      estimated_hours: 20,
      estimated_cost_usd: 5,
      depends_on: ['prep-js'],
      source_text: 'Team suggestion — not an official requirement',
    }),
    prep({
      id: 'prep-essay',
      title: 'Write the goals essay',
      material_kind: 'personal_statement',
      estimated_hours: 4,
      required_for_application: true,
      source_text: 'Submit a short essay about your goals.',
    }),
    prep({ id: 'prep-review', title: 'Write up what you built', estimated_hours: 2, depends_on: ['prep-app'] }),
  ],
  is_sample: true,
};

/** 候选 hackathon：同领域、线上、截止没过、在目标截止前结束、学生资格符合。 */
const HACK: Opportunity = {
  id: 'p4-hack',
  title: 'Fictional Beginner Hack Week (sample, not real)',
  organizer: 'Example Org (fictional)',
  category: 'hackathon',
  fields: ['Software-Development', 'open_source'],
  summary: 'Fictional hackathon.',
  official_url: 'https://example.com/p4-hack',
  verified_on: '2026-11-18',
  verified_by: 'test-fixture',
  deadline: '2026-12-01',
  recurring_annually: true,
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 8, total_weeks: 1, start_date: '2026-12-05', end_date: '2026-12-07' },
  required_devices: [],
  requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'High school students.' }],
  preparation: [],
  is_sample: true,
};

function withPrep(o: Opportunity, overrides: Record<string, Partial<PrepItem>>): Opportunity {
  return { ...o, preparation: o.preparation.map((p) => ({ ...p, ...(overrides[p.id] ?? {}) })) };
}

function routesOf(plan: PlanResult): Route[] {
  return plan.status === 'routes' ? plan.routes : [];
}

function competitionOf(plan: PlanResult): Route | undefined {
  return routesOf(plan).find((r) => r.type === 'competition');
}

// ───────────────────────────── 共用筛选 ─────────────────────────────

describe('共用筛选 findEvidenceBuildingCandidates', () => {
  it('正向：同领域 + 能产出目标还缺的 project 证据 → 是候选，带对应关系', () => {
    const c = findEvidenceBuildingCandidates(STUDENT, TARGET, [HACK], { today: TODAY });
    expect(c).toHaveLength(1);
    expect(c[0].opportunity.id).toBe('p4-hack');
    expect(c[0].shared_fields).toEqual(['Software-Development']);
    expect(c[0].eligibility_overall).toBe('eligible');
    expect(c[0].links.map((l) => (l.kind === 'prep_item' ? l.prep.id : l.requirement_id))).toEqual(['prep-app']);
  });

  it('类别产出表是确定的', () => {
    expect(CATEGORY_PRODUCES).toEqual({ hackathon: ['project', 'portfolio'], competition: ['competition_result'], project: ['project', 'portfolio'] });
  });

  it.each<[string, Opportunity[], Opportunity, StudentProfile]>([
    ['目标自身', [{ ...HACK, id: TARGET.id }], TARGET, STUDENT],
    ['user_posted', [{ ...HACK, source_tier: 'user_posted', is_sample: true, posted_by: 'pub-1' }], TARGET, STUDENT],
    ['没有共同领域', [{ ...HACK, fields: ['music'] }], TARGET, STUDENT],
    ['类别不在产出表里（research）', [{ ...HACK, category: 'research' }], TARGET, STUDENT],
    ['截止已过', [{ ...HACK, deadline: '2026-11-01' }], TARGET, STUDENT],
    ['学生对候选 not_eligible', [{ ...HACK, requirements: [{ ...HACK.requirements[0], type: 'grade', min: 11, max: 12 } as Opportunity['requirements'][number]] }], TARGET, STUDENT],
    ['目标的实践项已被证据覆盖', [HACK], TARGET, { ...STUDENT, evidence: [{ id: 'ev-1', title: 'My app', kind: 'project', skills: [], prep_item_ids: ['p4-target-studio:prep-app'], status: 'self_reported', added_on: '2026-10-01' }] }],
    ['目标没有需要实践证据的准备项', [HACK], withPrep(TARGET, { 'prep-app': { evidence_kind: 'course' } }), STUDENT],
    ['目标没有领域标签', [HACK], { ...TARGET, fields: [] }, STUDENT],
  ])('反向：%s → 不是候选', (_label, catalog, target, student) => {
    expect(findEvidenceBuildingCandidates(student, target, catalog, { today: TODAY })).toEqual([]);
  });

  it('未满足、没限定技能的作品要求也算目标「还缺的证据」；限定了技能的不算', () => {
    const target: Opportunity = {
      ...TARGET,
      preparation: [],
      requirements: [
        ...TARGET.requirements,
        { id: 'req-pf', type: 'portfolio', label: 'A project sample', hard: false, source_text: 'Share a project if you have one.' },
        { id: 'req-pf-skill', type: 'portfolio', evidence_kind: 'project', skill: 'rust', label: 'A Rust project', hard: false, source_text: 'Rust project.' },
      ],
    };
    const c = findEvidenceBuildingCandidates(STUDENT, target, [HACK], { today: TODAY });
    expect(c).toHaveLength(1);
    expect(c[0].links).toEqual([
      { kind: 'requirement', requirement_id: 'req-pf', label: 'A project sample', source_text: 'Share a project if you have one.', evidence_kind: 'project' },
    ]);
  });

  it('排序与目录顺序无关：截止日期早的在前，null 最后，同日按 id', () => {
    const a = { ...HACK, id: 'p4-hack-b', deadline: '2026-12-01' };
    const b = { ...HACK, id: 'p4-hack-a', deadline: '2026-12-01' };
    const c = { ...HACK, id: 'p4-hack-0', deadline: null };
    const d = { ...HACK, id: 'p4-hack-z', deadline: '2026-11-25' };
    const ids1 = findEvidenceBuildingCandidates(STUDENT, TARGET, [a, b, c, d], { today: TODAY }).map((x) => x.opportunity.id);
    const ids2 = findEvidenceBuildingCandidates(STUDENT, TARGET, [d, c, b, a], { today: TODAY }).map((x) => x.opportunity.id);
    expect(ids1).toEqual(['p4-hack-z', 'p4-hack-a', 'p4-hack-b', 'p4-hack-0']);
    expect(ids2).toEqual(ids1);
  });

  it('坏输入不抛异常', () => {
    expect(findEvidenceBuildingCandidates(STUDENT, TARGET, [null, 3, { id: '' }, HACK] as unknown as Opportunity[], { today: TODAY })).toHaveLength(1);
    expect(findEvidenceBuildingCandidates(STUDENT, TARGET, undefined as unknown as Opportunity[])).toEqual([]);
  });
});

// ───────────────────────────── competition 路线 ─────────────────────────────

describe('planRoutes：新手竞赛路线', () => {
  const plan = planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [HACK] });
  const comp = competitionOf(plan) as Route;

  it('正向：生成一条 competition 路线，排在其他路线之后', () => {
    expect(plan.status).toBe('routes');
    expect(routesOf(plan).map((r) => r.type)).toEqual(['learning_first', 'practice_first', 'community', 'competition']);
    expect(comp.id).toBe('p4-target-studio:competition');
    expect(comp.title).toBe('Beginner competition');
  });

  it('「参加 <候选>」替代实践类准备项 prep-app，依赖与排序正确，带链接信息与固定说明', () => {
    expect(comp.steps.map((s) => s.id)).toEqual(['prep-js', 'competition-p4-hack', 'prep-essay', 'prep-review', 'submit-application']);
    const step = comp.steps[1];
    expect(step.title).toBe('Take part in Fictional Beginner Hack Week (sample, not real)');
    expect(step.related_opportunity_id).toBe('p4-hack');
    expect(step.prep_item_id).toBeNull();
    expect(step.depends_on).toEqual(['prep-js']);
    expect(step.hours).toBe(8);
    expect(step.cost_usd).toBe(0);
    expect(step.description).toContain('This is one way to build evidence. It is not an official requirement of Fictional Code Studio (sample, not real).');
    expect(step.description).toContain(competitionDisclaimer(TARGET.title));
    expect(step.description).toContain('https://example.com/p4-hack');
    expect(step.official).toBe('team_suggestion');
    expect(step.relation).toBe(`Builds project evidence in place of the prep item "Build a small web app". ${TEAM_RELATION}`);
    expect(step.evidence_needed).toBe('project');
    // 原本依赖 prep-app 的步骤改为依赖竞赛这一步。
    expect(comp.steps.find((s) => s.id === 'prep-review')?.depends_on).toEqual(['competition-p4-hack']);
    expect(comp.steps.some((s) => s.id === 'prep-app')).toBe(false);
  });

  it('合计、来得及与提醒走现有逻辑', () => {
    expect(comp.total_hours).toBe(10 + 8 + 4 + 2);
    expect(comp.total_cost_usd).toBe(0);
    expect(comp.feasible_by_deadline).toBe(true);
    expect(comp.warnings).toEqual([]);
    expect(comp.rationale).toContain('It is not an official prerequisite.');
  });

  it('其他三条路线与不传 catalog 时完全相同', () => {
    const without = planRoutes(STUDENT, TARGET, { today: TODAY });
    expect(routesOf(plan).slice(0, 3)).toStrictEqual(routesOf(without));
    expect(plan.status === 'routes' && without.status === 'routes' && plan.warnings).toEqual(without.status === 'routes' ? without.warnings : null);
  });

  it('小时 / 费用记录为 null 时按 0 计入并写 warning（合计是下限）', () => {
    const hack = { ...HACK, time_commitment: { ...HACK.time_commitment, hours_per_week: null }, cost: { fee_usd: null, requires_travel_expense: false } };
    const r = competitionOf(planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [hack] })) as Route;
    expect(r.steps[1].hours).toBe(0);
    expect(r.steps[1].cost_usd).toBe(0);
    expect(r.warnings).toContain(`The time needed for ${HACK.title} is not stated by its organizer, so this route's total is a minimum.`);
    expect(r.warnings).toContain(`The cost of ${HACK.title} is not stated by its organizer, so this route's total cost is a minimum.`);
    // 小时未知：下限放得下也不报 true，报 null（无法判断）。
    expect(r.feasible_by_deadline).toBeNull();
    expect(r.warnings).toContain(`We can't tell yet if you can finish before the deadline: the time needed for ${HACK.title} is not stated by its organizer.`);
  });

  it('小时未知、但下限都已放不下 → feasible_by_deadline 仍为 false', () => {
    const hack = { ...HACK, time_commitment: { ...HACK.time_commitment, hours_per_week: null } };
    const busy = { ...STUDENT, hours_per_week_available: 0.1 };
    const r = competitionOf(planRoutes(busy, TARGET, { today: TODAY, catalog: [hack] })) as Route;
    expect(r.feasible_by_deadline).toBe(false);
  });

  it('只有费用未知时照常生成，feasible_by_deadline 按现有逻辑（不受影响）', () => {
    const hack = { ...HACK, cost: { fee_usd: null, requires_travel_expense: false } };
    const r = competitionOf(planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [hack] })) as Route;
    expect(r.feasible_by_deadline).toBe(true);
    expect(r.warnings).toEqual([`The cost of ${HACK.title} is not stated by its organizer, so this route's total cost is a minimum.`]);
  });

  it('有费用时计入合计与预算提醒', () => {
    const hack = { ...HACK, cost: { fee_usd: 150, requires_travel_expense: false } };
    const r = competitionOf(planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [hack] })) as Route;
    expect(r.total_cost_usd).toBe(150);
    expect(r.warnings.some((w) => w.startsWith('Over budget by $50'))).toBe(true);
  });

  it('competition 类别的候选也能生成（需要 competition_result 证据的实践项）', () => {
    const target = withPrep(TARGET, { 'prep-app': { evidence_kind: 'competition_result' } });
    const contest = { ...HACK, id: 'p4-contest', category: 'competition' as const };
    expect(competitionOf(planRoutes(STUDENT, target, { today: TODAY, catalog: [contest] }))?.steps[1].id).toBe('competition-p4-contest');
    // hackathon 产出 project / portfolio，对不上 competition_result → 不生成。
    expect(competitionOf(planRoutes(STUDENT, target, { today: TODAY, catalog: [HACK] }))).toBeUndefined();
  });

  it.each<[string, Opportunity[], Opportunity, StudentProfile, string | undefined]>([
    ['不传 today', [HACK], TARGET, STUDENT, undefined],
    ['候选是 project 类别（只做 stepping_stone，不算竞赛）', [{ ...HACK, category: 'project' }], TARGET, STUDENT, TODAY],
    ['候选没有 end_date', [{ ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1 } }], TARGET, STUDENT, TODAY],
    ['候选在目标截止当天或之后结束', [{ ...HACK, time_commitment: { ...HACK.time_commitment, end_date: '2027-03-01' } }], TARGET, STUDENT, TODAY],
    ['候选已经结束', [{ ...HACK, deadline: null, time_commitment: { ...HACK.time_commitment, start_date: '2026-11-01', end_date: '2026-11-10' } }], TARGET, STUDENT, TODAY],
    ['目标没有截止日期', [HACK], { ...TARGET, deadline: null }, STUDENT, TODAY],
    ['候选与目标没有共同领域', [{ ...HACK, fields: ['music'] }], TARGET, STUDENT, TODAY],
    ['目标的实践项已被证据覆盖', [HACK], TARGET, { ...STUDENT, evidence: [{ id: 'ev-1', title: 'My app', kind: 'project', skills: ['web_app'], status: 'self_reported', added_on: '2026-10-01' }] }, TODAY],
    ['候选是 user_posted', [{ ...HACK, source_tier: 'user_posted', posted_by: 'pub-1' }], TARGET, STUDENT, TODAY],
    ['学生对候选 not_eligible', [{ ...HACK, requirements: [{ id: 'g', type: 'grade', min: 11, label: '11+', hard: true, source_text: 'Grade 11+' }] }], TARGET, STUDENT, TODAY],
    ['目录为空', [], TARGET, STUDENT, TODAY],
  ])('反向：%s → 没有 competition 路线', (_label, catalog, target, student, today) => {
    const p = planRoutes(student, target, { today, catalog });
    expect(competitionOf(p)).toBeUndefined();
    expect(p).toStrictEqual(planRoutes(student, target, { today }));
  });

  it('blocked 时不生成任何路线（包括 competition）', () => {
    const p = planRoutes({ ...STUDENT, grade: 13 }, TARGET, { today: TODAY, catalog: [HACK] });
    expect(p.status).toBe('blocked');
    expect(p.routes).toEqual([]);
  });

  it('联合规划（planAcrossOpportunities）不读 catalog，不会选中 competition', () => {
    const cross = planAcrossOpportunities(STUDENT, [TARGET], { today: TODAY, catalog: [HACK] });
    expect(cross.items).toHaveLength(1);
    expect(cross.items[0].route_type).not.toBe('competition');
    expect(cross).toStrictEqual(planAcrossOpportunities(STUDENT, [TARGET], { today: TODAY }));
  });

  it('diffRoutes：从无 catalog 到有 catalog，只报告新增的 competition 路线', () => {
    const d = diffRoutes(planRoutes(STUDENT, TARGET, { today: TODAY }), plan);
    expect(d.route_changes.filter((c) => c.change !== 'unchanged').map((c) => [c.route_type, c.change])).toEqual([['competition', 'added']]);
  });
});

// ───────────────────────────── 步骤说明字段 ─────────────────────────────

describe('planRoutes：RouteStep 的 relation / official / evidence_needed', () => {
  const plan = planRoutes(STUDENT, TARGET, { today: TODAY });

  it('每一步都填了三个字段', () => {
    for (const r of routesOf(plan)) {
      for (const s of r.steps) {
        expect(typeof s.relation).toBe('string');
        expect(s.official).toBeDefined();
        expect(s).toHaveProperty('evidence_needed');
      }
    }
  });

  it('准备项、提交申请、找同伴三类步骤的取值', () => {
    const community = routesOf(plan).find((r) => r.type === 'community') as Route;
    const byId = new Map(community.steps.map((s) => [s.id, s]));
    expect(byId.get('prep-essay')).toMatchObject({
      official: 'official_requirement',
      relation: 'Prepares "Write the goals essay", which the organizer lists as needed to apply.',
      evidence_needed: 'personal_statement',
    });
    expect(byId.get('prep-app')).toMatchObject({ official: 'team_suggestion', relation: TEAM_RELATION, evidence_needed: 'project' });
    expect(byId.get('prep-js')).toMatchObject({ official: 'team_suggestion', relation: TEAM_RELATION, evidence_needed: null });
    expect(byId.get('submit-application')).toMatchObject({
      official: 'application_step',
      relation: 'The application itself for Fictional Code Studio (sample, not real).',
      evidence_needed: null,
    });
    expect(byId.get('find-partner')).toMatchObject({ official: 'team_suggestion', relation: TEAM_RELATION, evidence_needed: null });
  });

  it('能对上官方要求时 relation 写那条要求（技能要求 / 作品要求）', () => {
    const target: Opportunity = {
      ...TARGET,
      requirements: [
        ...TARGET.requirements,
        { id: 'req-js', type: 'prerequisite_skill', skill: 'JavaScript', label: 'Knows JavaScript', hard: false, source_text: 'JavaScript experience is a plus.' },
        { id: 'req-pf', type: 'portfolio', evidence_kind: 'project', label: 'Project sample', hard: true, source_text: 'Submit a project.' },
      ],
    };
    const s = new Map(routesOf(planRoutes({ ...STUDENT, evidence: [{ id: 'e', title: 'Old project', kind: 'project', skills: [], status: 'self_reported', added_on: '2026-01-01' }] }, target, { today: TODAY }))[0].steps.map((x) => [x.id, x]));
    expect(s.get('prep-js')?.relation).toBe('Works toward "Knows JavaScript", which the organizer lists as a plus (not required).');
    expect(s.get('prep-app')?.relation).toBe('Works toward "Project sample", which the organizer lists as a requirement.');
    // relation 对上官方要求，不改变 official 的判别（准备项本身仍是团队建议）。
    expect(s.get('prep-app')?.official).toBe('team_suggestion');
  });

  it.each<[string, Partial<PrepItem>, string]>([
    ['必需 + 官网原文', { required_for_application: true, source_text: 'Submit a resume.' }, 'official_requirement'],
    ['必需但原文写团队建议', { required_for_application: true, source_text: 'Team suggestion — not an official requirement' }, 'team_suggestion'],
    ['必需但原文写 not an official', { required_for_application: true, source_text: 'This is not an official application requirement.' }, 'team_suggestion'],
    ['必需但没有原文', { required_for_application: true, source_text: null }, 'team_suggestion'],
    ['必需但原文为空', { required_for_application: true, source_text: '  ' }, 'team_suggestion'],
    ['不是必需（即使有原文）', { required_for_application: false, source_text: 'Submit a resume.' }, 'team_suggestion'],
  ])('official 判别：%s → %s', (_label, over, expected) => {
    expect(prepOfficial(prep({ id: 'x', title: 'X', ...over }))).toBe(expected);
  });

  it('evidence_needed：material_kind 优先，其次 evidence_kind', () => {
    const target = withPrep(TARGET, { 'prep-app': { material_kind: 'portfolio' } });
    const step = routesOf(planRoutes(STUDENT, target, { today: TODAY }))[0].steps.find((s) => s.id === 'prep-app');
    expect(step?.evidence_needed).toBe('portfolio');
  });

  it('diffRoutes 不比较这三个字段', () => {
    const changed: PlanResult = {
      ...plan,
      routes: routesOf(plan).map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s, relation: 'x', official: 'official_requirement' as const, evidence_needed: 'other' as const })) })),
    } as PlanResult;
    expect(diffRoutes(plan, changed).route_changes.every((c) => c.change === 'unchanged')).toBe(true);
  });
});

// ───────────────────────────── findAlternatives：stepping_stone ─────────────────────────────

describe('findAlternatives：stepping_stone', () => {
  /** 硬性作品要求不满足（fixable）→ 受阻。 */
  const PF_TARGET: Opportunity = {
    ...TARGET,
    id: 'p4-target-pf',
    requirements: [...TARGET.requirements, { id: 'req-pf', type: 'portfolio', evidence_kind: 'project', label: 'A project you built', hard: true, source_text: 'Submit one project you built.' }],
  };
  const SAME_FIELD_ONLY: Opportunity = { ...HACK, id: 'p4-camp', title: 'Fictional Camp (sample, not real)', category: 'summer_program' };

  it('正向：缺作品（硬性 portfolio）受阻 → 给 stepping_stone，文字写明证据种类、对应项与固定句子', () => {
    const alts = findAlternatives(STUDENT, PF_TARGET, [HACK, SAME_FIELD_ONLY], { today: TODAY });
    expect(alts.map((a) => [a.kind, a.opportunity_id])).toEqual([
      ['same_field', 'p4-camp'],
      ['stepping_stone', 'p4-hack'],
    ]);
    const s = alts[1];
    expect(s.title).toBe(HACK.title);
    expect(s.eligibility_overall).toBe('eligible');
    expect(s.shared_fields).toEqual(['Software-Development']);
    expect(s.reason).toBe(
      `Taking part in ${HACK.title} can give you project evidence for the requirement "A project you built", the prep item "Build a small web app" of ${PF_TARGET.title}. ` +
        `It is also in Software-Development. You meet its hard requirements that we can check. Its listed fee is $0. It takes place online. ${STEPPING_STONE_NOTE}`,
    );
    expect(STEPPING_STONE_NOTE).toBe('This builds evidence; it is not a prerequisite.');
  });

  it('同一机会不同时出现在 same_field 和 stepping_stone（归 stepping_stone）；没有新类的输入上 same_field 不变', () => {
    const alts = findAlternatives(STUDENT, PF_TARGET, [HACK], { today: TODAY });
    expect(alts.map((a) => [a.kind, a.opportunity_id])).toEqual([['stepping_stone', 'p4-hack']]);
    // 对照：hackathon 换成说不清证据关系的类别 → 回到 same_field。
    const plain = findAlternatives(STUDENT, PF_TARGET, [{ ...HACK, category: 'research' }], { today: TODAY });
    expect(plain.map((a) => [a.kind, a.opportunity_id])).toEqual([['same_field', 'p4-hack']]);
  });

  it('截止已过 → 给（next_cycle 在前）', () => {
    const past = { ...TARGET, deadline: '2026-11-01' };
    expect(findAlternatives(STUDENT, past, [HACK], { today: TODAY }).map((a) => a.kind)).toEqual(['next_cycle', 'stepping_stone']);
  });

  it('费用放不下（cost 障碍）→ 给', () => {
    const pricey = { ...TARGET, cost: { fee_usd: 500, requires_travel_expense: false } };
    expect(findAlternatives(STUDENT, pricey, [HACK], { today: TODAY }).map((a) => a.kind)).toEqual(['stepping_stone']);
  });

  it('反向：学生没有受阻 → []', () => {
    expect(findAlternatives(STUDENT, TARGET, [HACK], { today: TODAY })).toEqual([]);
  });

  it('反向：只因交通受阻（不是可改善的那几类）→ 不给 stepping_stone', () => {
    const alts = findAlternatives({ ...STUDENT, transport: { level: 'none' } }, TARGET, [HACK], { today: TODAY });
    expect(alts.some((a) => a.kind === 'stepping_stone')).toBe(false);
  });

  it('反向：只因年级低于下限受阻 → 不给 stepping_stone', () => {
    const alts = findAlternatives({ ...STUDENT, grade: 8 }, { ...TARGET, requirements: [{ id: 'g', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12' }] }, [{ ...HACK, requirements: [] }], { today: TODAY });
    expect(alts.some((a) => a.kind === 'stepping_stone')).toBe(false);
  });

  it('blocked 且有不会改变的阻断（地区 / 年级高于上限）→ 不给，即使同时缺作品', () => {
    const region = { ...PF_TARGET, requirements: [...PF_TARGET.requirements, { id: 'tx', type: 'region' as const, countries: ['US'], states: ['TX'], label: 'Texas resident', hard: true, source_text: 'Texas residents.' }] };
    expect(findAlternatives(STUDENT, region, [HACK], { today: TODAY }).some((a) => a.kind === 'stepping_stone')).toBe(false);
    expect(findAlternatives({ ...STUDENT, grade: 13 }, PF_TARGET, [{ ...HACK, requirements: [] }], { today: TODAY }).some((a) => a.kind === 'stepping_stone')).toBe(false);
  });

  it('反向：候选说不清证据关系（没有共同领域 / 类别不对 / user_posted）→ 不给', () => {
    for (const cand of [{ ...HACK, fields: ['music'] }, { ...HACK, category: 'scholarship' as const }, { ...HACK, source_tier: 'user_posted' as const, posted_by: 'pub' }]) {
      expect(findAlternatives(STUDENT, PF_TARGET, [cand], { today: TODAY }).some((a) => a.kind === 'stepping_stone')).toBe(false);
    }
  });

  it('最多 3 条，顺序按截止日期 → id', () => {
    const many = ['d', 'c', 'b', 'a'].map((x, i) => ({ ...HACK, id: `p4-hack-${x}`, deadline: `2026-12-0${4 - i}` }));
    const ids = findAlternatives(STUDENT, PF_TARGET, many, { today: TODAY }).filter((a) => a.kind === 'stepping_stone').map((a) => a.opportunity_id);
    expect(ids).toEqual(['p4-hack-a', 'p4-hack-b', 'p4-hack-c']);
  });
});

// ───────────────────────────── findAlternatives：remote_option ─────────────────────────────

describe('findAlternatives：remote_option', () => {
  const NO_CAR: StudentProfile = { ...STUDENT, transport: { level: 'none' } };
  const HYBRID: Opportunity = { ...TARGET, id: 'p4-hybrid', title: 'Fictional Hybrid Lab (sample, not real)', location: { format: 'hybrid', country: 'US', state: 'CA' } };
  const ONLINE_SAME: Opportunity = { ...HACK, id: 'p4-online-club', title: 'Fictional Online Club (sample, not real)', category: 'other', time_commitment: { hours_per_week: 2, total_weeks: 8 } };

  it('正向 (a)：目标为 hybrid、交通受阻 → 一条指向目标自身的「向官方确认」建议，不断言可以', () => {
    const alts = findAlternatives(NO_CAR, HYBRID, [], { today: TODAY });
    expect(alts).toEqual([
      {
        kind: 'remote_option',
        opportunity_id: 'p4-hybrid',
        title: HYBRID.title,
        reason: `${CONFIRM_ONLINE} The official listing marks ${HYBRID.title} as hybrid (partly online, partly in person); it does not tell us whether you could take part fully online.`,
        eligibility_overall: 'eligible',
        shared_fields: ['software_development', 'stem'],
      },
    ]);
    expect(CONFIRM_ONLINE).toBe('Confirm with the organizer whether you can take part online.');
  });

  it('正向 (b)：目录里同领域的线上机会；它不再出现在 same_field', () => {
    const alts = findAlternatives(NO_CAR, TARGET, [ONLINE_SAME], { today: TODAY });
    expect(alts.map((a) => [a.kind, a.opportunity_id])).toEqual([['remote_option', 'p4-online-club']]);
    expect(alts[0].reason).toBe('A separate opportunity in Software-Development that takes place online, so getting there is not an issue. You meet its hard requirements that we can check.');
    // 对照：交通没问题、但因费用受阻时，同一机会仍是 same_field（与以前相同）。
    const pricey = { ...TARGET, cost: { fee_usd: 500, requires_travel_expense: false } };
    expect(findAlternatives(STUDENT, pricey, [ONLINE_SAME], { today: TODAY }).map((a) => a.kind)).toEqual(['same_field']);
  });

  it('自费差旅（引擎记在 transport 障碍里）也触发', () => {
    const travel = { ...HYBRID, cost: { fee_usd: 0, requires_travel_expense: true } };
    expect(findAlternatives(STUDENT, travel, [], { today: TODAY }).map((a) => a.kind)).toEqual(['remote_option']);
  });

  it('(a) 在 (b) 前；remote 在 stepping_stone 之后；同一机会只出现一次（stepping_stone 优先）', () => {
    const pfHybrid: Opportunity = {
      ...HYBRID,
      requirements: [...HYBRID.requirements, { id: 'req-pf', type: 'portfolio', label: 'A project', hard: false, source_text: 'A project is a plus.' }],
      cost: { fee_usd: 500, requires_travel_expense: false },
    };
    const alts = findAlternatives(NO_CAR, pfHybrid, [HACK, ONLINE_SAME], { today: TODAY });
    expect(alts.map((a) => [a.kind, a.opportunity_id])).toEqual([
      ['stepping_stone', 'p4-hack'],
      ['remote_option', 'p4-hybrid'],
      ['remote_option', 'p4-online-club'],
    ]);
  });

  it('反向：目标是 in_person、目录里没有线上同领域机会 → 不提示远程', () => {
    const alts = findAlternatives(NO_CAR, TARGET, [{ ...ONLINE_SAME, location: { format: 'in_person' } }], { today: TODAY });
    expect(alts.some((a) => a.kind === 'remote_option')).toBe(false);
    expect(alts.map((a) => a.kind)).toEqual(['same_field']);
    expect(alts.map((a) => a.reason).join(' ')).not.toMatch(/online|remote/i);
  });

  it('反向：交通没问题 → 不给；线上机会不同领域 / user_posted / not_eligible → 不给 (b)', () => {
    expect(findAlternatives(STUDENT, HYBRID, [ONLINE_SAME], { today: TODAY })).toEqual([]);
    for (const cand of [
      { ...ONLINE_SAME, fields: ['music'] },
      { ...ONLINE_SAME, source_tier: 'user_posted' as const, posted_by: 'pub' },
      { ...ONLINE_SAME, requirements: [{ id: 'g', type: 'grade' as const, min: 12, label: '12', hard: true, source_text: 'Seniors' }] },
      { ...ONLINE_SAME, deadline: '2026-11-01' },
    ]) {
      expect(findAlternatives(NO_CAR, TARGET, [cand], { today: TODAY }).some((a) => a.kind === 'remote_option')).toBe(false);
    }
  });

  it('反向：目标截止已过 → 不给 (a)', () => {
    const alts = findAlternatives(NO_CAR, { ...HYBRID, deadline: '2026-11-01' }, [], { today: TODAY });
    expect(alts.some((a) => a.kind === 'remote_option')).toBe(false);
  });

  it('blocked（not_eligible）时不给 remote_option', () => {
    const alts = findAlternatives({ ...NO_CAR, grade: 13 }, HYBRID, [ONLINE_SAME], { today: TODAY });
    expect(alts.some((a) => a.kind === 'remote_option')).toBe(false);
  });
});

// ───────────────────────────── analyzeGaps：team_requirement ─────────────────────────────

describe('analyzeGaps：team_requirement', () => {
  const base = analyzeGaps(STUDENT, TARGET, [], { today: TODAY });
  const withTeam = (t: TeamRequirement | null | undefined) => analyzeGaps(STUDENT, { ...TARGET, team_requirement: t }, [], { today: TODAY });

  it('required === true → materials 一条，带人数范围与官网原文', () => {
    const g = withTeam({ required: true, min_size: 2, max_size: 4, source_text: 'Teams of 2-4 students.' });
    const item = g.items.find((i) => i.id === 'materials:team_requirement');
    expect(item).toEqual({
      id: 'materials:team_requirement',
      category: 'materials',
      title: 'Team needed (2–4 people)',
      detail: 'The organizer requires you to take part as a team of 2–4 people. Official text: "Teams of 2-4 students.".',
      basis: { kind: 'requirement', requirement_id: 'team_requirement', source_text: 'Teams of 2-4 students.' },
      improvable: true,
      action: 'Find teammates (2–4 people) before you apply, and check the team rules on the official page.',
      estimated_hours: null,
      estimated_cost_usd: null,
    });
    expect(g.counts.materials).toBe(base.counts.materials + 1);
    expect(g.items.filter((i) => i.id !== 'materials:team_requirement')).toEqual(base.items);
    expect(g.eligibility_overall).toBe(base.eligibility_overall);
    expect(g.reachable).toBe(base.reachable);
  });

  it('人数只写一侧 / 都没写', () => {
    expect(withTeam({ required: true, min_size: 3, max_size: 3, source_text: null }).items.find((i) => i.category === 'materials' && i.id.includes('team'))?.title).toBe('Team needed (exactly 3 people)');
    expect(withTeam({ required: true, min_size: 2, source_text: null }).items.find((i) => i.id === 'materials:team_requirement')?.title).toBe('Team needed (at least 2 people)');
    const none = withTeam({ required: true, source_text: null }).items.find((i) => i.id === 'materials:team_requirement');
    expect(none?.title).toBe('Team needed');
    expect(none?.detail).toBe('The organizer requires you to take part as a team; the team size is not recorded.');
    // 没有官网原文：basis 不用空字符串冒充原文。
    expect(none?.basis).toEqual({ kind: 'missing_field', field: 'opportunity.team_requirement' });
    expect(JSON.stringify(none)).not.toContain('""');
  });

  it('required === null → unknown_info 一条（向官方确认）', () => {
    const g = withTeam({ required: null, source_text: null });
    const item = g.items.find((i) => i.id === 'unknown_info:team_requirement');
    expect(item?.category).toBe('unknown_info');
    expect(item?.basis).toEqual({ kind: 'missing_field', field: 'opportunity.team_requirement' });
    expect(item?.action).toBe('Confirm with the organizer whether you need a team, and if so how many people.');
    expect(g.counts.unknown_info).toBe(base.counts.unknown_info + 1);
  });

  it.each<[string, TeamRequirement | null | undefined]>([
    ['required === false', { required: false, source_text: 'Individuals may enter.' }],
    ['字段缺失', undefined],
    ['team_requirement 为 null', null],
  ])('%s → 不加，结果与没有这个字段时逐字相同', (_label, t) => {
    expect(withTeam(t)).toStrictEqual(base);
  });
});

// ───────────────────────────── 评审修补（2026-11-19）的回归测试 ─────────────────────────────

describe('修补 1：stepping_stone 看时间', () => {
  const PF: Opportunity = {
    ...TARGET,
    id: 'p4-fix-pf',
    requirements: [...TARGET.requirements, { id: 'req-pf', type: 'portfolio', evidence_kind: 'project', label: 'A project you built', hard: true, source_text: 'Submit one project you built.' }],
  };
  const stones = (target: Opportunity, cand: Opportunity, today: string | undefined = TODAY) =>
    findAlternatives(STUDENT, target, [cand], today ? { today } : undefined).filter((a) => a.kind === 'stepping_stone');

  it('回归：目标截止已过且 recurring_annually === false → 不给', () => {
    expect(stones({ ...PF, deadline: '2026-11-01', recurring_annually: false }, HACK)).toEqual([]);
  });

  it('回归：目标截止已过、recurring 为 true → 给，reason 写明这一轮已关闭、是为以后的轮次', () => {
    const [s] = stones({ ...PF, deadline: '2026-11-01', recurring_annually: true }, HACK);
    expect(s.reason).toContain(`This round of ${PF.title} has closed, so this would be for a future round, not this one.`);
    expect(s.reason).not.toContain('Whether it runs every year is not confirmed');
  });

  it('回归：目标截止已过、recurring 为 null / 缺省 → 再加「是否每年举办未确认」', () => {
    for (const recurring of [null, undefined]) {
      const [s] = stones({ ...PF, deadline: '2026-11-01', recurring_annually: recurring }, HACK);
      expect(s.reason).toContain('has closed, so this would be for a future round, not this one.');
      expect(s.reason).toContain('Whether it runs every year is not confirmed — check with the organizer.');
    }
  });

  it('回归：目标截止未过时，候选结束日期晚于 / 等于目标截止、或未知 → 不给；早于 → 给', () => {
    const tc = HACK.time_commitment;
    expect(stones(PF, { ...HACK, time_commitment: { ...tc, end_date: '2027-03-02' } })).toEqual([]);
    expect(stones(PF, { ...HACK, time_commitment: { ...tc, end_date: '2027-03-01' } })).toEqual([]);
    expect(stones(PF, { ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1 } })).toEqual([]);
    expect(stones(PF, { ...HACK, time_commitment: { ...tc, end_date: '2027-02-28' } })).toHaveLength(1);
    // 没传 today 时也比较结束日期。
    expect(stones(PF, { ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1 } }, undefined)).toEqual([]);
  });

  it('目标没有截止日期时不比较结束日期', () => {
    const noDeadline = { ...PF, deadline: null };
    expect(stones(noDeadline, { ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1 } })).toHaveLength(1);
  });

  it('回归：候选已经开始（start_date < today）→ 不给；start_date 未知且报名没截止 → 给', () => {
    expect(stones(PF, { ...HACK, time_commitment: { ...HACK.time_commitment, start_date: '2026-11-10', end_date: '2026-12-07' } })).toEqual([]);
    expect(stones(PF, { ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1, end_date: '2026-12-07' } })).toHaveLength(1);
  });

  it('reason 如实写出候选的费用与形式（线下 / 地点 / 不含差旅），未知时写 not stated', () => {
    const paid = { ...HACK, cost: { fee_usd: 40, requires_travel_expense: null }, location: { format: 'in_person' as const, city: 'Example City', state: 'CA', country: 'US' } };
    const [s] = stones(PF, paid);
    expect(s.reason).toContain('Its listed fee is $40. It is in person in Example City, CA, US; travel time and cost are not included.');
    const unknown = { ...HACK, cost: { fee_usd: null, requires_travel_expense: null }, location: {} as Opportunity['location'] };
    expect(stones(PF, unknown)[0].reason).toContain('Its fee is not stated. Its format is not stated.');
  });
});

describe('修补 2：competition 路线不接受已开始的候选', () => {
  const comp = (tc: Partial<Opportunity['time_commitment']>) =>
    competitionOf(planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [{ ...HACK, time_commitment: { hours_per_week: 8, total_weeks: 1, ...tc } }] }));

  it('回归：start_date < today（已开始）→ 不生成', () => {
    expect(comp({ start_date: '2026-11-10', end_date: '2026-12-07' })).toBeUndefined();
  });
  it('回归：start_date 未知 → 不生成', () => {
    expect(comp({ end_date: '2026-12-07' })).toBeUndefined();
  });
  it('边界：start = today 可以生成；end = today 且 start < today 不生成', () => {
    expect(comp({ start_date: TODAY, end_date: '2026-12-07' })).toBeDefined();
    expect(comp({ start_date: '2026-11-15', end_date: TODAY })).toBeUndefined();
  });
  it('end_date 必须早于目标截止', () => {
    expect(comp({ start_date: '2026-12-05', end_date: '2027-03-01' })).toBeUndefined();
    expect(comp({ start_date: '2026-12-05', end_date: '2027-02-28' })).toBeDefined();
  });
  it('竞赛那一步写明日期、费用与形式', () => {
    const r = comp({ start_date: '2026-12-05', end_date: '2026-12-07' }) as Route;
    expect(r.steps[1].description).toContain('It runs 2026-12-05 to 2026-12-07, before the');
    expect(r.steps[1].description).toContain('Its listed fee is $0. It takes place online.');
  });
});

describe('修补 3：标为必需、原文含 "team" 时不说成团队建议', () => {
  const target = withPrep(TARGET, {
    'prep-essay': { source_text: 'Every team member must submit an essay.' },
    'prep-js': { required_for_application: true, source_text: null },
  });
  const steps = new Map(routesOf(planRoutes(STUDENT, target, { today: TODAY }))[0].steps.map((s) => [s.id, s]));

  it('回归：必需 + 原文含 "team" → official 仍保守为 team_suggestion，relation 用中性句子', () => {
    const s = steps.get('prep-essay');
    expect(s?.official).toBe('team_suggestion');
    expect(s?.relation).toBe(UNCLEAR_REQUIRED_RELATION);
    expect(UNCLEAR_REQUIRED_RELATION).toBe('We could not tell whether the organizer requires this. Read the source text and confirm with the organizer.');
    expect(s?.relation).not.toContain('Suggested by our team');
    expect(s?.description?.startsWith('Marked as needed to apply in our records')).toBe(true);
  });

  it('必需但没有原文 → TEAM_RELATION，description 不写 "Required to apply."', () => {
    const s = steps.get('prep-js');
    expect(s?.relation).toBe(TEAM_RELATION);
    expect(s?.description).toBe('Marked as needed to apply in our records; no source text is recorded, so confirm with the organizer.');
  });

  it('同一步的 description 与 relation / official 不互相矛盾（多种准备项写法）', () => {
    const variants = [target, TARGET, withPrep(TARGET, { 'prep-app': { required_for_application: true, source_text: 'Build an app (team suggestion).' } })];
    for (const t of variants) {
      for (const r of routesOf(planRoutes(STUDENT, t, { today: TODAY }))) {
        for (const s of r.steps) {
          if (s.prep_item_id == null) continue;
          const d = s.description ?? '';
          if (s.official === 'official_requirement') expect(d.startsWith('Required to apply.')).toBe(true);
          else expect(d.startsWith('Required to apply.')).toBe(false);
          if (s.relation === TEAM_RELATION) expect(d).not.toMatch(/^Required to apply\.|source text does not read/);
          if (s.relation === UNCLEAR_REQUIRED_RELATION) expect(d.startsWith('Marked as needed to apply in our records, but the source text')).toBe(true);
        }
      }
    }
  });
});

describe('建议 5 / 6：diffRoutes 的竞赛原因、rationale 的周数', () => {
  const withComp = planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [HACK] });

  it('竞赛路线出现：说明是哪场竞赛、替代了哪一项、不是官方要求', () => {
    const d = diffRoutes(planRoutes(STUDENT, TARGET, { today: TODAY }), withComp);
    expect(d.reasons).toContain(`New Beginner competition route: "${HACK.title}" in the verified catalog fits this plan and takes the place of "Build a small web app". It is one way to build evidence, not an official requirement.`);
  });

  it('竞赛路线消失、因为新证据覆盖了被替代的那一步 → 说出这个原因', () => {
    const covered = { ...STUDENT, evidence: [{ id: 'ev-app', title: 'My web app', kind: 'project' as const, skills: [], prep_item_ids: ['p4-target-studio:prep-app'], status: 'self_reported' as const, added_on: '2026-11-18' }] };
    const after = planRoutes(covered, TARGET, { today: TODAY, catalog: [HACK] });
    expect(competitionOf(after)).toBeUndefined();
    const d = diffRoutes(withComp, after);
    expect(d.reasons).toContain('The Beginner competition route is gone: the step it replaced, "Build a small web app", is now covered by your evidence (Already covered by "My web app").');
  });

  it('竞赛路线消失、原因看不出来（目录里竞赛不再适用）→ 如实的通用句子', () => {
    const after = planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [] });
    const d = diffRoutes(withComp, after);
    expect(d.reasons).toContain(
      'The Beginner competition route is gone: no competition in the verified catalog fits this plan any more (the step it replaced may now be covered, or the competition may have started or closed).',
    );
    expect(d.reasons.join(' ')).not.toMatch(/is gone\.$/);
  });

  it('竞赛换了一场：不说成「机会的准备项更新了」', () => {
    const other = { ...HACK, id: 'p4-hack-2', title: 'Another Fictional Hack (sample, not real)' };
    const d = diffRoutes(withComp, planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [other] }));
    expect(d.reasons.some((r) => r.includes('a different competition in the verified catalog now fits this plan'))).toBe(true);
    expect(d.reasons.some((r) => r.includes(HACK.title) && r.includes('that competition no longer fits this plan'))).toBe(true);
    expect(d.reasons.join(' ')).not.toContain("prep items were updated");
  });

  it('小时未知时 rationale 不说「约 N 周」，而是 at least', () => {
    const hack = { ...HACK, time_commitment: { ...HACK.time_commitment, hours_per_week: null } };
    const r = competitionOf(planRoutes(STUDENT, TARGET, { today: TODAY, catalog: [hack] })) as Route;
    expect(r.feasible_by_deadline).toBeNull();
    expect(r.rationale).toContain('it takes at least 2 weeks; we can\'t say how long in total.');
    expect(r.rationale).not.toContain('takes about');
  });
});

// ───────────────────────────── 真实目录：只断言不随数据变化的性质 ─────────────────────────────
// data/opportunities.json 由队友 A 维护、会继续变化，这里不写死条数或具体组合（截至 2026-11-19 的条数记在 README / CONTRACT）。
// 同一组性质也在「真实目录 + 本文件的虚构机会」上跑一遍，并要求三类新结果都确实出现，证明这些检查不是空转。

const FIELD_TARGET_HYBRID: Opportunity = { ...TARGET, id: 'p4-inv-hybrid', title: 'Fictional Invariant Hybrid (sample, not real)', location: { format: 'hybrid', country: 'US', state: 'CA' } };
const FIELD_TARGET_PF: Opportunity = {
  ...TARGET,
  id: 'p4-inv-pf',
  requirements: [...TARGET.requirements, { id: 'req-pf', type: 'portfolio', evidence_kind: 'project', label: 'A project you built', hard: true, source_text: 'Submit one project you built.' }],
};
const FIELD_ONLINE: Opportunity = { ...HACK, id: 'p4-inv-online', title: 'Fictional Invariant Online Club (sample, not real)', category: 'other' };
const FICTIONAL_EXTRA = [TARGET, FIELD_TARGET_HYBRID, FIELD_TARGET_PF, HACK, FIELD_ONLINE];
const FICTIONAL_STUDENTS: StudentProfile[] = [STUDENT, { ...STUDENT, id: 'p4-inv-no-car', transport: { level: 'none' } }];

const KIND_ORDER = ['next_cycle', 'same_field', 'stepping_stone', 'remote_option'];
const STRIP = (r: Route): Route => ({
  ...r,
  steps: r.steps.map((s) => {
    const { relation: _r, official: _o, evidence_needed: _e, ...rest } = s;
    void _r;
    void _o;
    void _e;
    return rest;
  }),
});

interface Seen {
  competition: number;
  stepping_stone: number;
  remote_option: number;
}

function checkInvariants(profiles: StudentProfile[], catalog: Opportunity[], today: string): Seen {
  const seen: Seen = { competition: 0, stepping_stone: 0, remote_option: 0 };
  const byId = new Map(catalog.map((o) => [o.id, o]));
  const dayOf = (d: string | null | undefined) => (typeof d === 'string' ? d : null);
  for (const p of profiles) {
    for (const o of catalog) {
      const without = planRoutes(p, o, { today });
      const withCat = planRoutes(p, o, { today, catalog });
      // 不传 catalog 时没有 competition；非 competition 路线两边完全相同，去掉三个说明字段后也相同。
      expect(routesOf(without).some((r) => r.type === 'competition')).toBe(false);
      expect(withCat.status).toBe(without.status);
      expect(routesOf(withCat).filter((r) => r.type !== 'competition')).toStrictEqual(routesOf(without));
      expect(routesOf(withCat).filter((r) => r.type !== 'competition').map(STRIP)).toStrictEqual(routesOf(without).map(STRIP));
      if (withCat.status === 'blocked') expect(withCat.routes).toEqual([]);

      for (const r of routesOf(withCat)) {
        for (const st of r.steps) {
          // official_requirement 只可能来自满足三条判别条件的准备项。
          if (st.official === 'official_requirement') {
            const pr = o.preparation.find((x) => x.id === st.prep_item_id);
            expect(pr).toBeDefined();
            expect(pr?.required_for_application).toBe(true);
            expect(typeof pr?.source_text === 'string' && pr.source_text.trim() !== '').toBe(true);
            expect(pr?.source_text ?? '').not.toMatch(/\bteam\b|not an official/i);
          }
        }
        if (r.type !== 'competition') continue;
        seen.competition++;
        expect(r).toBe(routesOf(withCat)[routesOf(withCat).length - 1]);
        const step = r.steps.find((st) => st.related_opportunity_id != null);
        expect(step).toBeDefined();
        if (!step) continue;
        const cand = byId.get(step.related_opportunity_id as string);
        expect(cand).toBeDefined();
        if (!cand) continue;
        expect(cand.id).not.toBe(o.id);
        expect(['hackathon', 'competition']).toContain(cand.category);
        expect(cand.source_tier ?? 'official').not.toBe('user_posted');
        expect(sharedTags(cand.fields, normalizedTagSet(o.fields)).length).toBeGreaterThan(0);
        const end = dayOf(cand.time_commitment.end_date);
        expect(end).not.toBeNull();
        expect((end as string) < (o.deadline as string)).toBe(true);
        expect((end as string) >= today).toBe(true);
        expect(checkEligibility(p, cand, { today }).overall).not.toBe('not_eligible');
        expect(step.description).toContain(competitionDisclaimer(o.title));
        expect(step.official).toBe('team_suggestion');
        expect(step.id).toBe(`competition-${cand.id}`);
      }

      const alts = findAlternatives(p, o, catalog, { today });
      const idx = alts.map((a) => KIND_ORDER.indexOf(a.kind));
      expect(idx).toEqual([...idx].sort((x, y) => x - y));
      const others = new Map<string, string[]>();
      for (const a of alts) if (a.opportunity_id != null) others.set(a.opportunity_id, [...(others.get(a.opportunity_id) ?? []), a.kind]);
      for (const a of alts) {
        if (a.kind === 'stepping_stone') {
          seen.stepping_stone++;
          expect(byId.has(a.opportunity_id as string)).toBe(true);
          expect(a.opportunity_id).not.toBe(o.id);
          expect(a.eligibility_overall).not.toBe('not_eligible');
          expect(a.reason).toContain(STEPPING_STONE_NOTE);
          expect(a.shared_fields.length).toBeGreaterThan(0);
          expect(others.get(a.opportunity_id as string)).toEqual(['stepping_stone']);
        }
        if (a.kind === 'remote_option') {
          seen.remote_option++;
          const r = analyzeReachability(p, o, [], { today });
          expect(r.barriers.some((b) => b.type === 'transport' && !b.resolved)).toBe(true);
          if (a.opportunity_id === o.id) {
            expect(o.location.format).toBe('hybrid');
            expect(a.reason.startsWith(CONFIRM_ONLINE)).toBe(true);
          } else {
            const c = byId.get(a.opportunity_id as string);
            expect(c?.location.format).toBe('online');
            expect(a.eligibility_overall).not.toBe('not_eligible');
            expect(others.get(a.opportunity_id as string)).toEqual(['remote_option']);
          }
        }
      }

      // 组队要求：有且只有 required 为 true / null 时出现对应条目。
      const team = o.team_requirement;
      const gapIds = analyzeGaps(p, o, [], { today }).items.map((i) => i.id);
      expect(gapIds.includes('materials:team_requirement')).toBe(team != null && team.required === true);
      expect(gapIds.includes('unknown_info:team_requirement')).toBe(team != null && team.required === null);
    }
  }
  return seen;
}

describe('真实目录：不随数据变化的性质', () => {
  const profiles = sampleProfiles();
  const catalog = catalogOpportunities();

  it.each(['2026-11-19', '2027-02-01'])('示例档案 × 真实目录（today = %s）', (today) => {
    expect(profiles.length).toBeGreaterThan(0);
    expect(catalog.length).toBeGreaterThan(0);
    checkInvariants(profiles, catalog, today);
  });

  it('同一组性质在「真实目录 + 虚构机会」上也成立，且三类新结果都确实出现（检查不是空转）', () => {
    const seen = checkInvariants([...profiles, ...FICTIONAL_STUDENTS], [...catalog, ...FICTIONAL_EXTRA], TODAY);
    expect(seen.competition).toBeGreaterThan(0);
    expect(seen.stepping_stone).toBeGreaterThan(0);
    expect(seen.remote_option).toBeGreaterThan(0);
  });
});
