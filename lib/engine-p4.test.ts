/**
 * 第四阶段第 1 层：学生端引擎的三项新功能。
 * - 共用筛选 findEvidenceBuildingCandidates（lib/match/evidence-building.ts）
 * - planRoutes 的新手竞赛路线 competition
 * - findAlternatives 的 stepping_stone / remote_option
 * - RouteStep 的 relation / official / evidence_needed；analyzeGaps 读 team_requirement
 *
 * 机会与学生都是本文件里的虚构数据（example.com、is_sample: true），不是真实机会。
 * 真实目录上的结果（数量很少，如实钉住）见文末「真实目录」一节。
 */
import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from './data';
import { analyzeGaps } from './gap';
import { findAlternatives } from './match';
import { CONFIRM_ONLINE, STEPPING_STONE_NOTE } from './match';
import { CATEGORY_PRODUCES, findEvidenceBuildingCandidates } from './match/evidence-building';
import { diffRoutes, planRoutes } from './path';
import { TEAM_RELATION, competitionDisclaimer, prepOfficial } from './path/plan';
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
        `It is also in Software-Development. You meet its hard requirements that we can check. ${STEPPING_STONE_NOTE}`,
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

// ───────────────────────────── 真实目录（如实钉住） ─────────────────────────────

describe('真实目录：4 个示例档案 × 12 条机会', () => {
  const profiles = sampleProfiles();
  const catalog = catalogOpportunities();

  function tally(today: string) {
    const out: string[] = [];
    for (const p of profiles) {
      for (const o of catalog) {
        for (const r of routesOf(planRoutes(p, o, { today, catalog }))) if (r.type === 'competition') out.push(`competition ${p.id} × ${o.id}`);
        for (const a of findAlternatives(p, o, catalog, { today })) {
          if (a.kind === 'stepping_stone' || a.kind === 'remote_option') out.push(`${a.kind} ${p.id} × ${o.id} → ${a.opportunity_id}`);
        }
      }
    }
    return out;
  }

  it('数据规模', () => {
    expect(profiles.map((p) => p.id)).toEqual(['sample-maya', 'sample-leo', 'sample-ana', 'sample-noor']);
    expect(catalog).toHaveLength(12);
    // 唯一的竞赛类机会是 mlh-open-source-week-2026，领域 software_development / open_source，与其他 11 条都没有交集。
    expect(catalog.filter((o) => o.category === 'hackathon' || o.category === 'competition').map((o) => o.id)).toEqual(['mlh-open-source-week-2026']);
  });

  it('today = 2026-11-19：competition 0 条、stepping_stone 0 条、remote_option 2 条（都是 hybrid 目标自身的「向官方确认」）', () => {
    expect(tally('2026-11-19')).toEqual([
      'remote_option sample-leo × dan-herbatschek-fellowship-2027 → dan-herbatschek-fellowship-2027',
      'remote_option sample-noor × dan-herbatschek-fellowship-2027 → dan-herbatschek-fellowship-2027',
    ]);
  });

  it('today = 2027-02-01（多数截止已过）：三类都是 0 条——Dan Herbatschek 截止已过，不再给 (a)；目录里没有可积累证据的候选', () => {
    expect(tally('2027-02-01')).toEqual([]);
  });

  it('没有任何团队建议的准备项被标成 official_requirement（真实目录全部准备项都是团队建议）', () => {
    for (const o of catalog) for (const pr of o.preparation) expect(prepOfficial(pr)).toBe('team_suggestion');
    let steps = 0;
    for (const p of profiles) {
      for (const o of catalog) {
        for (const r of routesOf(planRoutes(p, o, { today: TODAY, catalog }))) {
          for (const s of r.steps) {
            steps++;
            const pr = o.preparation.find((x) => x.id === s.prep_item_id);
            if (pr && /team suggestion/i.test(pr.source_text ?? '')) expect(s.official).toBe('team_suggestion');
            expect(s.official).not.toBe('official_requirement');
          }
        }
      }
    }
    expect(steps).toBeGreaterThan(0);
  });

  it('真实目录没有 team_requirement 字段，analyzeGaps 不出现组队条目', () => {
    expect(catalog.some((o) => o.team_requirement !== undefined)).toBe(false);
    for (const p of profiles) for (const o of catalog) expect(analyzeGaps(p, o, [], { today: TODAY }).items.some((i) => i.id.includes('team_requirement'))).toBe(false);
  });
});
