/**
 * analyzeGaps（第二阶段第 1 层完整实现）测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { analyzeGaps as analyzeGapsRaw } from '.';
import { planRoutes } from '../path';
import { analyzeReachability } from '../reachability';
import {
  GAP_CATEGORIES,
  type EvalOptions,
  type EvidenceItem,
  type GapAnalysis,
  type GapItem,
  type Opportunity,
  type PrepItem,
  type Requirement,
  type ResourceGrant,
  type StudentProfile,
} from '../types';

const TODAY = { today: '2026-11-17' };

/** 所有用例的结果都收集起来，最后做一次全文扫描（不出现「绕过」类字样、不出现内部字段名）。 */
const SEEN: GapAnalysis[] = [];
function analyzeGaps(p: StudentProfile, o: Opportunity, g: ResourceGrant[], opts?: EvalOptions): GapAnalysis {
  const r = analyzeGapsRaw(p, o, g, opts);
  SEEN.push(r);
  return r;
}

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 2, estimated_cost_usd: 0, depends_on: [], required_for_application: false, ...p };
}

function ev(e: Partial<EvidenceItem> & Pick<EvidenceItem, 'id'>): EvidenceItem {
  return { title: `Evidence ${e.id} (fictional)`, kind: 'project', skills: [], status: 'self_reported', added_on: '2026-11-01', ...e };
}

const OPP: Opportunity = {
  id: 'fictional-gap-lab',
  title: 'Fictional Gap Lab (sample, not real)',
  organizer: 'Example Org (fictional)',
  category: 'research',
  fields: ['biology', 'data_science'],
  summary: 'Fictional opportunity for tests.',
  official_url: 'https://example.com/fictional-gap-lab',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  deadline: '2027-02-01',
  recurring_annually: true,
  location: { format: 'in_person', country: 'US', state: 'NY' },
  cost: { fee_usd: 50, requires_travel_expense: false },
  time_commitment: { hours_per_week: 4, total_weeks: 6 },
  required_devices: ['laptop'],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 11, max: 12, label: 'Grades 11–12', hard: true, source_text: 'Open to grades 11-12.' },
    { id: 'req-cit', type: 'citizenship', countries: ['US'], label: 'U.S. citizen', hard: true, source_text: 'Must be a U.S. citizen.' },
    { id: 'req-py', type: 'prerequisite_skill', skill: 'python', min_level: 'intermediate', label: 'Intermediate Python', hard: true, source_text: 'Intermediate Python required.' },
    { id: 'req-pf', type: 'portfolio', evidence_kind: 'portfolio', label: 'Portfolio', hard: false, source_text: 'A portfolio is a plus.' },
    { id: 'req-interview', type: 'manual', label: 'Interview', hard: true, source_text: 'Finalists are interviewed.' },
  ],
  preparation: [
    prep({ id: 'prep-python', title: 'Learn Python basics', skill: 'python', estimated_hours: 10 }),
    prep({ id: 'prep-resume', title: 'Write a resume', estimated_hours: 3, required_for_application: true, material_kind: 'resume', reusable_across_opportunities: true, source_text: 'Submit a resume.' }),
  ],
  is_sample: true,
};

const STUDENT: StudentProfile = {
  id: 'gap-student',
  is_sample: true,
  display_name: 'Sample student (gap test)',
  grade: 10,
  age: 15,
  region: { country: 'US', state: 'NY' },
  statuses: ['high_school_student'],
  school_name: 'Example High (fictional)',
  hours_per_week_available: 2,
  budget_usd: 10,
  transport: { level: 'reliable' },
  devices: [],
  skills: [{ name: 'python', level: 'beginner' }],
  evidence: [],
  interests: ['biology'],
};

/** 资格全部满足（除 manual 外）的学生，用于看准备差距与障碍。 */
const OK_STUDENT: StudentProfile = {
  ...STUDENT,
  id: 'gap-ok-student',
  grade: 11,
  citizenships: ['US'],
  skills: [{ name: 'python', level: 'intermediate' }],
  hours_per_week_available: 10,
  budget_usd: 500,
  devices: ['laptop'],
};

/** 只有一条要求的机会（其他条件都宽松），便于单独看某条资格的归类。 */
function oneReq(req: Requirement, extra: Partial<Opportunity> = {}): Opportunity {
  return {
    ...OPP,
    id: `fictional-one-${req.id}`,
    cost: { fee_usd: 0, requires_travel_expense: false },
    location: { format: 'online' },
    required_devices: [],
    preparation: [],
    requirements: [req],
    ...extra,
  };
}

const ids = (g: GapAnalysis, c: string) => g.items.filter((i) => i.category === c).map((i) => i.id);
const byId = (g: GapAnalysis, id: string) => g.items.find((i) => i.id === id) as GapItem;
const texts = (i: GapItem) => [i.title, i.detail, i.action ?? ''];

describe('analyzeGaps — 形状与口径', () => {
  const g = analyzeGaps(STUDENT, OPP, [], TODAY);

  it('基本字段与 counts 五个键齐全、与 items 一致、id 唯一', () => {
    expect(g.profile_id).toBe(STUDENT.id);
    expect(g.opportunity_id).toBe(OPP.id);
    expect(Object.keys(g.counts).sort()).toEqual([...GAP_CATEGORIES].sort());
    for (const c of GAP_CATEGORIES) expect(g.counts[c]).toBe(g.items.filter((i) => i.category === c).length);
    expect(g.summary.length).toBeGreaterThan(0);
    expect(new Set(g.items.map((i) => i.id)).size).toBe(g.items.length);
  });

  it('items 按 GAP_CATEGORIES 顺序分组', () => {
    const idx = g.items.map((i) => GAP_CATEGORIES.indexOf(i.category));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it('五类归类正确，组内顺序稳定', () => {
    expect(ids(g, 'knowledge_or_experience')).toEqual(['knowledge_or_experience:req-py', 'knowledge_or_experience:prep-python']);
    expect(ids(g, 'materials')).toEqual(['materials:req-pf', 'materials:prep-resume']);
    expect(ids(g, 'time_and_cost')).toEqual(['time_and_cost:time', 'time_and_cost:cost', 'time_and_cost:device:laptop']);
    expect(ids(g, 'unchangeable_eligibility')).toEqual(['unchangeable_eligibility:req-grade']);
    // citizenships 没填 → unknown；manual → unknown
    expect(ids(g, 'unknown_info')).toEqual(['unknown_info:req-cit', 'unknown_info:req-interview']);
    expect(g.eligibility_overall).toBe('not_eligible');
    expect(g.reachable).toBe(false);
  });

  it('eligibility_overall 与 reachable 与 analyzeReachability 一致', () => {
    const r = analyzeReachability(STUDENT, OPP, [], TODAY);
    expect(g.eligibility_overall).toBe(r.eligibility.overall);
    expect(g.reachable).toBe(r.reachable);
  });

  it('不可改变的资格限制 improvable 为 false、action 为 null，并附官网原文', () => {
    for (const i of g.items.filter((x) => x.category === 'unchangeable_eligibility')) {
      expect(i.improvable).toBe(false);
      expect(i.action).toBeNull();
      expect(i.basis).toMatchObject({ kind: 'requirement', source_text: 'Open to grades 11-12.' });
      expect(i.detail).toContain('Open to grades 11-12.');
    }
  });

  it('其余可改善的差距都有 action；材料类准备项带依据原文与小时', () => {
    for (const i of g.items.filter((x) => x.category !== 'unchangeable_eligibility')) {
      expect(i.improvable).toBe(true);
      expect(typeof i.action).toBe('string');
    }
    const resume = byId(g, 'materials:prep-resume');
    expect(resume.basis).toEqual({ kind: 'prep_item', prep_item_id: 'prep-resume', source_text: 'Submit a resume.' });
    expect(resume.estimated_hours).toBe(3);
    expect(resume.estimated_cost_usd).toBe(0);
  });

  it('summary：各类条数、当前不可改变的限制、未知信息条数；不出现分数或录取暗示', () => {
    expect(g.summary).toContain('10 gaps found');
    expect(g.summary).toContain('2 in knowledge or experience');
    expect(g.summary).toContain('1 in current eligibility limits');
    expect(g.summary).toContain('"Grades 11–12"');
    expect(g.summary).toContain('2 items still need info');
    expect(g.summary).not.toMatch(/\d+\s*%|score|likely to be admitted|chance/i);
  });
});

describe('analyzeGaps — knowledge_or_experience', () => {
  it('不满足的 prerequisite_skill 指向覆盖该技能的准备项，并写明等级', () => {
    const g = analyzeGaps(STUDENT, OPP, [], TODAY);
    const py = byId(g, 'knowledge_or_experience:req-py');
    expect(py.action).toContain('"Learn Python basics"');
    expect(py.action).toContain('about 10 hours');
    expect(py.action).toContain('intermediate');
    expect(py.action).toContain('Skill Passport');
    expect(py.detail).toContain("you can't apply until it is met");
    expect(py.estimated_hours).toBeNull();
  });

  it('机会里没有对应准备项时如实说明，并提示在 Skill Passport 补充已有的', () => {
    const o = oneReq({ id: 'req-r', type: 'prerequisite_skill', skill: 'r_lang', min_level: 'beginner', label: 'Some R', hard: false, source_text: 'R is a plus.' });
    const g = analyzeGaps({ ...STUDENT, skills: [] }, o, [], TODAY);
    const item = byId(g, 'knowledge_or_experience:req-r');
    expect(item.action).toContain('no item for "r_lang"');
    expect(item.action).toContain('if you already have it');
    expect(item.action).toContain('add evidence');
    expect(item.detail).toContain('does not affect eligibility');
  });

  it('非材料准备项：行动写出要做什么、小时与费用、证据种类并关联准备项', () => {
    const o: Opportunity = {
      ...OPP,
      preparation: [prep({ id: 'prep-proj', title: 'Build a small data project', skill: 'data_analysis', evidence_kind: 'project', estimated_hours: 8, estimated_cost_usd: 15 })],
    };
    const g = analyzeGaps(OK_STUDENT, o, [], TODAY);
    const item = byId(g, 'knowledge_or_experience:prep-proj');
    expect(item.action).toContain('Do "Build a small data project" (about 8 hours, about $15)');
    expect(item.action).toContain('"project" evidence entry');
    expect(item.action).toContain('link it to "Build a small data project"');
    expect(item.estimated_hours).toBe(8);
    expect(item.estimated_cost_usd).toBe(15);
  });

  it('前置依赖也未覆盖时点明先做哪一个；前置已覆盖时不再提示', () => {
    const o: Opportunity = {
      ...OPP,
      preparation: [
        prep({ id: 'prep-python', title: 'Learn Python basics', skill: 'python', estimated_hours: 10 }),
        prep({ id: 'prep-analysis', title: 'Analyze a public dataset', estimated_hours: 6, depends_on: ['prep-python'] }),
      ],
    };
    const before = analyzeGaps(OK_STUDENT, o, [], TODAY);
    expect(byId(before, 'knowledge_or_experience:prep-analysis').action).toMatch(/^Do "Learn Python basics" first/);
    expect(byId(before, 'knowledge_or_experience:prep-python').action).not.toContain('first');

    const covered = { ...OK_STUDENT, evidence: [ev({ id: 'ev-py', skills: ['python'] })] };
    const after = analyzeGaps(covered, o, [], TODAY);
    expect(after.items.some((i) => i.id === 'knowledge_or_experience:prep-python')).toBe(false);
    expect(byId(after, 'knowledge_or_experience:prep-analysis').action).not.toContain('first');
  });
});

describe('analyzeGaps — materials', () => {
  it('不满足的 portfolio 要求：有能产出作品的准备项时指向它', () => {
    const o: Opportunity = {
      ...OPP,
      preparation: [...OPP.preparation, prep({ id: 'prep-pf', title: 'Put together a small portfolio', evidence_kind: 'portfolio', estimated_hours: 5, material_kind: 'portfolio' })],
    };
    const g = analyzeGaps(OK_STUDENT, o, [], TODAY);
    const pf = byId(g, 'materials:req-pf');
    expect(pf.action).toContain('"Put together a small portfolio"');
    expect(pf.action).toContain('"portfolio" evidence entry');
    expect(byId(g, 'materials:prep-pf').action).toContain('This produces your portfolio.');
  });

  it('没有对应准备项时如实说需要相应作品，并提示补充已有的', () => {
    const g = analyzeGaps(OK_STUDENT, OPP, [], TODAY);
    const pf = byId(g, 'materials:req-pf');
    expect(pf.action).toContain('no item that produces this');
    expect(pf.action).toContain('If you already have such work');
    expect(pf.detail).toContain('does not affect eligibility');
  });

  it('材料类准备项（material_kind）归入 materials，行动写明产出哪种材料', () => {
    const g = analyzeGaps(OK_STUDENT, OPP, [], TODAY);
    const resume = byId(g, 'materials:prep-resume');
    expect(resume.action).toContain('This produces your resume.');
    expect(resume.action).toContain('about 3 hours, no cost');
  });
});

describe('analyzeGaps — time_and_cost', () => {
  it('缺口数值进入文字与 estimated_*', () => {
    const g = analyzeGaps(STUDENT, OPP, [], TODAY);
    const time = byId(g, 'time_and_cost:time');
    expect(time.title).toBe('Time: short 2 hours per week');
    expect(time.estimated_hours).toBe(2);
    expect(time.estimated_cost_usd).toBeNull();
    expect(time.action).toContain('about 2 more hours per week');
    const cost = byId(g, 'time_and_cost:cost');
    expect(cost.title).toBe('Cost: short $40');
    expect(cost.estimated_cost_usd).toBe(40);
    expect(cost.estimated_hours).toBeNull();
    expect(cost.action).toContain('$40');
    expect(cost.action).toContain('may not offer');
    const device = byId(g, 'time_and_cost:device:laptop');
    expect(device.action).toContain('borrow a laptop');
    expect(device.estimated_hours).toBeNull();
  });

  it('交通障碍：没有 pending 时建议询问线上 / 交通支持，不承诺', () => {
    const g = analyzeGaps({ ...OK_STUDENT, transport: { level: 'limited' } }, OPP, [], TODAY);
    const t = byId(g, 'time_and_cost:transport');
    expect(t.action).toContain('online option');
    expect(t.action).toContain('may not offer');
  });

  it('pending grant：写明获批后会化解、目前尚未生效；不足额时说只化解一部分', () => {
    const pend = (id: string, amount: number): ResourceGrant => ({ id, student_id: STUDENT.id, opportunity_id: OPP.id, type: 'fee_waiver', status: 'pending', amount_usd: amount, provider: 'Example Org (fictional)', is_sample: true });
    const full = byId(analyzeGaps(STUDENT, OPP, [pend('p1', 100)], TODAY), 'time_and_cost:cost');
    expect(full.action).toContain('pending support request');
    expect(full.action).toContain('this barrier would be resolved');
    expect(full.action).toContain('not in effect yet');
    const part = byId(analyzeGaps(STUDENT, OPP, [pend('p2', 5)], TODAY), 'time_and_cost:cost');
    expect(part.action).toContain('only part of the gap');
    expect(part.action).toContain('not in effect yet');
  });

  it('approved grant 化解后不再列出；summary 提到支持已生效；reachable 与 analyzeReachability 一致', () => {
    const grants: ResourceGrant[] = [
      { id: 'g1', student_id: OK_STUDENT.id, opportunity_id: OPP.id, type: 'transport_subsidy', status: 'approved', amount_usd: 30, provider: 'Example Org (fictional)', is_sample: true },
    ];
    const s = { ...OK_STUDENT, transport: { level: 'none' as const } };
    const before = analyzeGaps(s, OPP, [], TODAY);
    expect(before.items.some((i) => i.id === 'time_and_cost:transport')).toBe(true);
    const after = analyzeGaps(s, OPP, grants, TODAY);
    expect(after.items.some((i) => i.id === 'time_and_cost:transport')).toBe(false);
    expect(after.summary).toContain('1 barrier is already resolved by approved support');
    const r = analyzeReachability(s, OPP, grants, TODAY);
    expect(after.reachable).toBe(r.reachable);
    expect(after.eligibility_overall).toBe(r.eligibility.overall);
  });

  it('已过截止日期：不可改善、action 为 null，detail 提示替代机会', () => {
    const r = analyzeGaps({ ...STUDENT, grade: 11 }, OPP, [], { today: '2027-03-01' });
    const passed = r.items.find((i) => i.title === 'Deadline has passed') as GapItem;
    expect(passed).toBeDefined();
    expect(passed.improvable).toBe(false);
    expect(passed.action).toBeNull();
    expect(passed.estimated_hours).toBeNull();
    expect(passed.detail).toContain('alternatives');
  });
});

describe('analyzeGaps — unchangeable_eligibility', () => {
  const grade = (g: number) =>
    analyzeGaps({ ...OK_STUDENT, grade: g }, oneReq({ id: 'req-g', type: 'grade', min: 11, max: 12, label: 'Grades 11–12', hard: true, source_text: 'Grades 11-12 only.' }), [], TODAY);

  it('grade 低于下限 vs 高于上限：detail 不同，两者都没有 action', () => {
    const below = byId(grade(9), 'unchangeable_eligibility:req-g');
    const above = byId(grade(13), 'unchangeable_eligibility:req-g');
    for (const i of [below, above]) {
      expect(i.action).toBeNull();
      expect(i.improvable).toBe(false);
      expect(i.detail).toContain('Official text: "Grades 11-12 only."');
    }
    expect(below.detail).toContain('as you move up a grade');
    expect(below.detail).toContain('check the official requirements again');
    expect(above.detail).not.toContain('may be met later');
    expect(below.detail).not.toBe(above.detail);
  });

  it('age 低于下限（按参考日当天的年龄）vs 高于上限', () => {
    const o = oneReq({ id: 'req-age', type: 'age', min: 16, max: 18, as_of: '2026-11-17', label: 'Ages 16–18', hard: true, source_text: 'Ages 16 to 18.' });
    const young = byId(analyzeGaps({ ...OK_STUDENT, age: 14 }, o, [], TODAY), 'unchangeable_eligibility:req-age');
    const old = byId(analyzeGaps({ ...OK_STUDENT, age: 20 }, o, [], TODAY), 'unchangeable_eligibility:req-age');
    expect(young.detail).toContain('as you get older');
    expect(old.detail).not.toContain('may be met later');
    expect(young.action).toBeNull();
    expect(old.action).toBeNull();
  });

  it('citizenship / region / status：只给原因与官网原文，不提「以后可能满足」', () => {
    const cases: [Requirement, Partial<StudentProfile>][] = [
      [{ id: 'req-c', type: 'citizenship', countries: ['US'], label: 'U.S. citizen', hard: true, source_text: 'U.S. citizens only.' }, { citizenships: ['CA'] }],
      [{ id: 'req-r', type: 'region', countries: ['US'], states: ['CA'], label: 'California residents', hard: true, source_text: 'California residents only.' }, {}],
      [{ id: 'req-s', type: 'status', any_of: ['undergraduate'], label: 'Undergraduates', hard: true, source_text: 'Undergraduates only.' }, {}],
    ];
    for (const [req, patch] of cases) {
      const g = analyzeGaps({ ...OK_STUDENT, ...patch }, oneReq(req), [], TODAY);
      const i = byId(g, `unchangeable_eligibility:${req.id}`);
      expect(i.action).toBeNull();
      expect(i.improvable).toBe(false);
      expect(i.detail).toContain(`Official text: "${req.source_text}"`);
      expect(i.detail).not.toContain('may be met later');
      expect(g.eligibility_overall).toBe('not_eligible');
      expect(g.summary).toContain("can't apply this round");
    }
  });

  it('偏好（非硬性）的 grade 不满足：不列为差距', () => {
    const g = analyzeGaps({ ...OK_STUDENT, grade: 9 }, oneReq({ id: 'req-pref', type: 'grade', min: 11, label: 'Grade 11+ preferred', hard: false, source_text: 'Grade 11+ preferred.' }), [], TODAY);
    expect(g.items.some((i) => i.basis.kind === 'requirement' && i.basis.requirement_id === 'req-pref')).toBe(false);
  });
});

describe('analyzeGaps — unknown_info', () => {
  it('unknown 的资格项各一条，带官网原文与 confirm_with_official', () => {
    const g = analyzeGaps(STUDENT, OPP, [], TODAY);
    const cit = byId(g, 'unknown_info:req-cit');
    expect(cit.detail).toContain('Must be a U.S. citizen.');
    expect(cit.action).toContain('Confirm with the organizer');
    const interview = byId(g, 'unknown_info:req-interview');
    expect(interview.action).toContain('Finalists are interviewed.');
    expect(interview.detail).toContain('hard requirement');
  });

  it('档案缺字段：每个字段一条，行动是在 Skill Passport 填写可读名称', () => {
    const sparse: StudentProfile = { id: 'sparse', is_sample: true, display_name: 'x', evidence: [] };
    const r = analyzeGaps(sparse, OPP, [], TODAY);
    const missing = r.items.filter((i) => i.basis.kind === 'missing_field');
    expect(missing.map((i) => (i.basis as { field: string }).field)).toEqual([
      'profile.devices',
      'profile.budget_usd',
      'profile.transport',
      'profile.hours_per_week_available',
    ]);
    for (const i of missing) {
      expect(i.category).toBe('unknown_info');
      expect(i.action).toMatch(/^Fill in .+ in your Skill Passport\.$/);
    }
    expect(byId(r, 'unknown_info:profile.devices').action).toBe('Fill in which devices you have in your Skill Passport.');
  });

  it('截止当天：一条 unknown_info，行动是确认截止的具体时刻和时区；reachable null，不露内部路径', () => {
    const o: Opportunity = {
      ...OPP,
      id: 'fictional-gap-today',
      deadline: '2026-11-17',
      requirements: [],
      location: { format: 'online' },
      cost: { fee_usd: 0, requires_travel_expense: false },
      required_devices: [],
      preparation: [],
    };
    const r = analyzeGaps(OK_STUDENT, o, [], TODAY);
    expect(r.reachable).toBeNull();
    const it0 = byId(r, 'unknown_info:opportunity.deadline.closing_time');
    expect(it0.category).toBe('unknown_info');
    expect(it0.basis).toEqual({ kind: 'missing_field', field: 'opportunity.deadline.closing_time' });
    expect(it0.title).toBe('The deadline is today: closing time not known');
    expect(it0.action).toContain('exact closing time and time zone');
    for (const text of [it0.title, it0.detail, it0.action ?? '', r.summary]) expect(text).not.toContain('opportunity.deadline.closing_time');
  });

  it('机会缺字段：行动是向主办方确认，并说明影响哪一项判断', () => {
    const o: Opportunity = { ...OPP, cost: { fee_usd: null, requires_travel_expense: null }, time_commitment: { hours_per_week: null, total_weeks: 6 } };
    const r = analyzeGaps(OK_STUDENT, o, [], TODAY);
    const fee = byId(r, 'unknown_info:opportunity.cost.fee_usd');
    expect(fee.action).toContain('Confirm the official fee with the organizer');
    expect(fee.action).toContain('the cost check');
    const weekly = byId(r, 'unknown_info:opportunity.time_commitment.hours_per_week');
    expect(weekly.action).toContain('the weekly time check');
    expect(fee.basis).toEqual({ kind: 'missing_field', field: 'opportunity.cost.fee_usd' });
  });

  it('options.today 缺失：说明是页面没有传日期，三种来源的行动互不相同', () => {
    const r = analyzeGaps({ ...STUDENT, hours_per_week_available: null }, OPP, [], undefined);
    const today = byId(r, 'unknown_info:options.today');
    expect(today.detail).toContain("The page did not pass today's date");
    expect(today.basis).toEqual({ kind: 'missing_field', field: 'options.today' });
    const prof = byId(r, 'unknown_info:profile.hours_per_week_available');
    const opp = byId(analyzeGaps(OK_STUDENT, { ...OPP, cost: { fee_usd: null, requires_travel_expense: false } }, [], TODAY), 'unknown_info:opportunity.cost.fee_usd');
    expect(new Set([today.action, prof.action, opp.action]).size).toBe(3);
  });
});

describe('analyzeGaps — 证据与 planRoutes 的跳过一致', () => {
  it('加一条证据后对应差距消失，planRoutes 里同一准备项被跳过', () => {
    const o: Opportunity = { ...OPP, requirements: OPP.requirements.filter((r) => r.type !== 'manual') };
    const before = analyzeGaps(OK_STUDENT, o, [], TODAY);
    expect(before.items.some((i) => i.id === 'materials:prep-resume')).toBe(true);
    const withEv = { ...OK_STUDENT, evidence: [ev({ id: 'ev-resume', kind: 'other', prep_item_ids: [`${o.id}:prep-resume`] })] };
    const after = analyzeGaps(withEv, o, [], TODAY);
    expect(after.items.some((i) => i.basis.kind === 'prep_item' && i.basis.prep_item_id === 'prep-resume')).toBe(false);
    const plan = planRoutes(withEv, o, TODAY);
    expect(plan.status).toBe('routes');
    for (const route of plan.routes) {
      const step = route.steps.find((s) => s.prep_item_id === 'prep-resume');
      if (step) expect(step.skipped).toBe(true);
    }
    // 其余未覆盖的准备项在 analyzeGaps 与 planRoutes 里一致：analyzeGaps 列出的 = 第一条路线里未跳过的
    const listed = after.items.filter((i) => i.basis.kind === 'prep_item').map((i) => (i.basis as { prep_item_id: string }).prep_item_id);
    const notSkipped = plan.routes[0].steps.filter((s) => s.prep_item_id && !s.skipped).map((s) => s.prep_item_id);
    for (const id of listed) expect(notSkipped).toContain(id);
  });
});

describe('analyzeGaps — 确定性、不修改输入、健壮性', () => {
  it('同输入两次结果相同', () => {
    expect(analyzeGaps(STUDENT, OPP, [], TODAY)).toEqual(analyzeGaps(STUDENT, OPP, [], TODAY));
  });

  it('不修改输入', () => {
    const p = structuredClone(STUDENT);
    const o = structuredClone(OPP);
    const grants: ResourceGrant[] = [{ id: 'g', student_id: STUDENT.id, opportunity_id: null, type: 'device', device: 'laptop', status: 'pending', provider: 'x' }];
    const g0 = structuredClone(grants);
    analyzeGaps(p, o, grants, TODAY);
    expect(p).toEqual(STUDENT);
    expect(o).toEqual(OPP);
    expect(grants).toEqual(g0);
  });

  it('空 preparation、空 requirements、缺字段档案、坏输入都不抛错', () => {
    const empty = { ...OPP, preparation: [], requirements: [] };
    expect(() => analyzeGaps(STUDENT, empty, [], TODAY)).not.toThrow();
    expect(() => analyzeGaps({ id: 'x', is_sample: true, display_name: '', evidence: [] }, OPP, [], undefined)).not.toThrow();
    expect(() => analyzeGapsRaw(null as unknown as StudentProfile, null as unknown as Opportunity, null as unknown as ResourceGrant[])).not.toThrow();
    expect(() => analyzeGaps({ id: 'y' } as unknown as StudentProfile, OPP, [], TODAY)).not.toThrow();
    expect(() => analyzeGaps(STUDENT, OPP, [null, 5, 'x'] as unknown as ResourceGrant[], TODAY)).not.toThrow();
    expect(() => analyzeGaps(STUDENT, OPP, [], 'bad' as unknown as EvalOptions)).not.toThrow();
  });

  it('机会数据不完整：逐字段列出缺什么', () => {
    const broken = { id: 'broken', title: 'Broken' } as unknown as Opportunity;
    const r = analyzeGaps(STUDENT, broken, [], TODAY);
    expect(r.eligibility_overall).toBe('unknown');
    expect(r.reachable).toBeNull();
    expect(r.items.map((i) => i.id)).toEqual([
      'unknown_info:opportunity.requirements',
      'unknown_info:opportunity.cost',
      'unknown_info:opportunity.location',
      'unknown_info:opportunity.time_commitment',
    ]);
    expect(r.counts.unknown_info).toBe(4);
    for (const i of r.items) expect(i.action).toContain('organizer');
  });

  it('某条官方要求读不了：单独列出那一条', () => {
    const bad = { ...OPP, requirements: [...OPP.requirements, { id: 'req-bad', type: 'region', label: 'Broken region', hard: true, source_text: 'Region rule.' }] } as unknown as Opportunity;
    const r = analyzeGaps(STUDENT, bad, [], TODAY);
    expect(r.items.map((i) => i.id)).toEqual(['unknown_info:opportunity.requirements.req-bad']);
    expect(r.items[0].title).toContain('"Broken region"');
    expect(r.items[0].detail).toContain('Region rule.');
  });

  it('档案字段类型不对：列出那个字段，而不是笼统一句', () => {
    const r = analyzeGaps({ ...STUDENT, skills: 'python' } as unknown as StudentProfile, OPP, [], TODAY);
    expect(r.items.map((i) => i.id)).toEqual(['unknown_info:profile.skills']);
    expect(r.items[0].action).toContain('Skill Passport');
  });
});

/**
 * Snapshots of real opportunities as of 2026-11-19, kept in the test so data edits do not change it.
 * 真实机会在 2026-11-19 的副本（逐字复制自 data/opportunities.json），固定在测试里：队友改数据不会让这里的精确断言失败；
 * 这些测试守的是引擎在这些记录上的行为，不是数据本身（数据合法性由 lib/data.test.ts / lib/validation.test.ts 检查）。
 */
const SNAPSHOT_OPPS: Record<string, Opportunity> = {
  'rutgers-newark-summer-research-2027': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-17",
    "required_devices": [],
    "preparation": [
      {
        "id": "review-research-interests",
        "title": "Draft a short summary of biomedical research interests",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion. This is optional preparation, not an official application requirement. Time and cost are team estimates for this task only; they do not describe program fees or weekly participation hours.",
        "material_kind": "personal_statement",
        "reusable_across_opportunities": false,
        "skill": null,
        "evidence_kind": null
      },
      {
        "id": "practice-lab-data-cleanup",
        "title": "Practice cleaning a small public biomedical dataset",
        "skill": "python",
        "evidence_kind": "project",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": null,
        "reusable_across_opportunities": null
      },
      {
        "id": "write-research-project-note",
        "title": "Write a short project note explaining methods and limitations",
        "skill": "scientific_writing",
        "evidence_kind": "project",
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [
          "practice-lab-data-cleanup"
        ],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": "portfolio",
        "reusable_across_opportunities": true
      },
      {
        "id": "review-lab-safety-basics",
        "title": "Review introductory laboratory safety guidance",
        "skill": "laboratory_safety",
        "evidence_kind": null,
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": null,
        "reusable_across_opportunities": null
      }
    ],
    "id": "rutgers-newark-summer-research-2027",
    "title": "Rutgers Newark Undergraduate Summer Research Program",
    "organizer": "Rutgers School of Graduate Studies",
    "category": "research",
    "fields": [
      "biomedical_research",
      "life_sciences"
    ],
    "summary": "A 10-week supervised undergraduate biomedical research program in Newark, New Jersey.",
    "official_url": "https://njms.rutgers.edu/sgs/prospective_students/info/summer_undergrad_research.php",
    "deadline": "2027-03-05",
    "location": {
      "format": "in_person",
      "country": "US",
      "state": "NJ",
      "city": "Newark"
    },
    "cost": {
      "fee_usd": null,
      "requires_travel_expense": null,
      "note": "The organizer lists stipends based on housing arrangements."
    },
    "time_commitment": {
      "hours_per_week": null,
      "total_weeks": 10,
      "note": "See the organizer for the weekly schedule.",
      "start_date": "2027-06-07",
      "end_date": "2027-08-13"
    },
    "requirements": [
      {
        "id": "undergraduate",
        "type": "grade",
        "min": 13,
        "max": 16,
        "hard": true,
        "label": "Undergraduate student",
        "source_text": "This program provides the opportunity for undergraduates"
      },
      {
        "id": "us-citizen-or-permanent-resident",
        "type": "citizenship",
        "countries": [
          "US"
        ],
        "hard": true,
        "label": "U.S. citizen or lawful permanent resident",
        "source_text": "you must be a U.S. citizen or Permanent resident."
      }
    ],
    "source_tier": "official",
    "recurring_annually": null,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
  'doe-suli-summer-2027': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-19",
    "required_devices": [],
    "preparation": [
      {
        "id": "draft-research-resume",
        "title": "Draft a resume highlighting coursework and research interests",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion. This is optional preparation, not an official application requirement. Time and cost are team estimates for this task only; they do not describe program fees or weekly participation hours.",
        "material_kind": "resume",
        "reusable_across_opportunities": true,
        "skill": null,
        "evidence_kind": null
      }
    ],
    "id": "doe-suli-summer-2027",
    "title": "DOE Science Undergraduate Laboratory Internships · Summer 2027",
    "organizer": "U.S. Department of Energy Office of Science",
    "category": "internship",
    "fields": [
      "stem",
      "laboratory_research"
    ],
    "summary": "A paid summer internship at a participating DOE laboratory. Review the eligibility page for full requirements and exceptions for recent graduates. Eligibility source: https://science.osti.gov/wdts/suli/Eligibility",
    "official_url": "https://science.osti.gov/wdts/suli/How-to-Apply",
    "deadline": "2027-01-06",
    "deadline_note": "5:00 PM Eastern Time",
    "location": {
      "format": "in_person",
      "country": "US",
      "note": "Location and dates vary by host laboratory.",
      "state": null,
      "city": null
    },
    "cost": {
      "fee_usd": null,
      "requires_travel_expense": null,
      "note": "Compensation and travel support depend on program terms."
    },
    "time_commitment": {
      "hours_per_week": 40,
      "total_weeks": 10,
      "note": "Approximately 40 hours per week on site. Source: https://science.osti.gov/wdts/suli/Participant-Obligations Recurrence: offered three times annually in Fall, Spring, and Summer. Source: https://www.energy.gov/science/articles/discover-science-applications-open-summer-2027-undergraduate-internships. Recurrence verified by Jiale Li on 2026-11-19; future cycle dates and requirements must be checked separately."
    },
    "requirements": [
      {
        "id": "postsecondary-level",
        "min": 13,
        "type": "grade",
        "hard": true,
        "label": "Postsecondary applicant (recent graduate exceptions require official confirmation)",
        "source_text": "Currently enrolled as a full-time student at an accredited community college, two-year college, or four-year institution. Recently graduated with an undergraduate degree."
      },
      {
        "id": "us-citizen-or-permanent-resident",
        "type": "citizenship",
        "countries": [
          "US"
        ],
        "hard": true,
        "label": "U.S. citizen or lawful permanent resident",
        "source_text": "United States Citizen or Lawful Permanent Resident"
      },
      {
        "id": "minimum-age",
        "label": "At least 18 when the internship begins",
        "source_text": "18 years or older at the time the internship begins",
        "type": "manual",
        "hard": true
      },
      {
        "id": "enrollment",
        "label": "Full-time undergraduate or qualifying recent graduate",
        "source_text": "Currently enrolled as a full-time student at an accredited community college, two-year college, or four-year institution. Recently graduated with an undergraduate degree.",
        "type": "manual",
        "hard": true
      },
      {
        "id": "transcript-credits",
        "label": "At least 6 STEM and 12 total undergraduate credits by the deadline",
        "source_text": "By the application deadline, applicants must have completed at least 6 credit hours in STEM fields and a minimum of 12 total undergraduate credit hours.",
        "type": "manual",
        "hard": true
      },
      {
        "id": "minimum-gpa",
        "label": "At least a 3.0 cumulative GPA on a 4.0 scale",
        "source_text": "cumulative GPA of at least 3.0",
        "type": "manual",
        "hard": true
      }
    ],
    "source_tier": "official",
    "recurring_annually": true,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
  'mlh-open-source-week-2026': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-17",
    "required_devices": [],
    "preparation": [
      {
        "id": "practice-open-source-pr",
        "title": "Practice opening a pull request",
        "skill": "git",
        "evidence_kind": "project",
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion — not an official requirement",
        "material_kind": null,
        "reusable_across_opportunities": null
      }
    ],
    "id": "mlh-open-source-week-2026",
    "title": "Global Hack Week: Open Source Week",
    "organizer": "Major League Hacking",
    "category": "hackathon",
    "fields": [
      "software_development",
      "open_source"
    ],
    "summary": "A free online week of open-source projects, challenges, and live workshops.",
    "official_url": "https://events.mlh.com/events/15199-global-hack-week-open-source-week",
    "deadline": null,
    "deadline_note": "See the organizer for registration availability.",
    "location": {
      "format": "online",
      "country": null,
      "state": null,
      "city": null
    },
    "cost": {
      "fee_usd": 0,
      "requires_travel_expense": false,
      "note": "Free participation confirmed at https://ghw.mlh.com/ (Global Hack Week umbrella page)."
    },
    "time_commitment": {
      "hours_per_week": null,
      "total_weeks": 1,
      "note": "Check the event schedule for individual sessions.",
      "start_date": "2026-12-04",
      "end_date": "2026-12-10"
    },
    "requirements": [],
    "source_tier": "official",
    "recurring_annually": null,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
};

describe('analyzeGaps — 示例档案 × 真实机会', () => {
  const profiles = profilesJson as unknown as StudentProfile[];
  const opps = opportunitiesJson as unknown as Opportunity[];
  const P = (id: string) => profiles.find((p) => p.id === id) as StudentProfile;
  // 下面几条精确断言用测试内固定的副本（SNAPSHOT_OPPS），不读 data/；「全部组合」那条仍跑在真实数据上（只断言性质）。
  const O = (id: string) => SNAPSHOT_OPPS[id];
  const counts = (g: GapAnalysis) => GAP_CATEGORIES.map((c) => g.counts[c]);

  it('全部组合不抛错，counts 与 items 一致，reachable 与 analyzeReachability 一致', () => {
    for (const p of profiles) {
      for (const o of opps) {
        for (const opts of [TODAY, undefined]) {
          const r = analyzeGaps(p, o, [], opts);
          expect(r.items.length).toBe(Object.values(r.counts).reduce((a, b) => a + b, 0));
          expect(r.reachable).toBe(analyzeReachability(p, o, [], opts).reachable);
        }
      }
    }
  });

  it('Noor × Rutgers：资格满足；python 项目证据覆盖数据清洗准备项，其余三条团队建议准备项（实验室安全 → 知识，研究兴趣摘要 / 项目说明 → 材料）；交通受限一条；官方费用与每周小时未知各一条', () => {
    const g = analyzeGaps(P('sample-noor'), O('rutgers-newark-summer-research-2027'), [], TODAY);
    expect(g.eligibility_overall).toBe('eligible');
    expect(g.reachable).toBe(false);
    expect(counts(g)).toEqual([1, 2, 1, 0, 2]);
    expect(g.items.map((i) => i.id)).toEqual([
      'knowledge_or_experience:review-lab-safety-basics',
      'materials:review-research-interests',
      'materials:write-research-project-note',
      'time_and_cost:transport',
      'unknown_info:opportunity.cost.fee_usd',
      'unknown_info:opportunity.time_commitment.hours_per_week',
    ]);
    expect(byId(g, 'time_and_cost:transport').action).toContain('online option');
  });

  it('Maya × Rutgers：年级低于下限 → 当前不可改变、无行动，说明以后可能满足；四条团队建议准备项都未覆盖（python 只有课程证据，不算项目）', () => {
    const g = analyzeGaps(P('sample-maya'), O('rutgers-newark-summer-research-2027'), [], TODAY);
    expect(g.eligibility_overall).toBe('not_eligible');
    expect(counts(g)).toEqual([2, 2, 0, 1, 3]);
    const u = byId(g, 'unchangeable_eligibility:undergraduate');
    expect(u.action).toBeNull();
    expect(u.detail).toContain('as you move up a grade');
  });

  it('Leo × DOE SULI：简历草稿一条材料差距；每周缺 30 小时、交通障碍、公民身份未知；10 年级不满足「13 年级及以上」', () => {
    const g = analyzeGaps(P('sample-leo'), O('doe-suli-summer-2027'), [], TODAY);
    expect(counts(g)).toEqual([0, 1, 2, 1, 6]);
    expect(byId(g, 'unchangeable_eligibility:postsecondary-level').action).toBeNull();
    expect(byId(g, 'time_and_cost:time').estimated_hours).toBe(30);
    expect(byId(g, 'time_and_cost:transport')).toBeDefined();
    expect(byId(g, 'unknown_info:us-citizen-or-permanent-resident').action).toContain('citizenship');
  });

  it('Ana × MLH：一条建议准备项（git），每周小时未知', () => {
    const g = analyzeGaps(P('sample-ana'), O('mlh-open-source-week-2026'), [], TODAY);
    expect(counts(g)).toEqual([1, 0, 0, 0, 1]);
    expect(byId(g, 'knowledge_or_experience:practice-open-source-pr').action).toContain('"project" evidence entry');
  });
});

// ───────────────────────────── 第 1 层评审后的修订 ─────────────────────────────

function grant(id: string, type: ResourceGrant['type'], status: ResourceGrant['status'], extra: Partial<ResourceGrant> = {}): ResourceGrant {
  return { id, student_id: OK_STUDENT.id, opportunity_id: null, type, status, provider: 'Example Org (fictional)', is_sample: true, ...extra };
}

/** 只有费用问题的机会：报名费 $100 + 必需准备费 $30（0 小时，不产生时间障碍）。 */
const COST_OPP: Opportunity = {
  ...OPP,
  id: 'fictional-cost-only',
  location: { format: 'online' },
  required_devices: [],
  requirements: [],
  cost: { fee_usd: 100, requires_travel_expense: false },
  time_commitment: { hours_per_week: 1, total_weeks: 4 },
  preparation: [prep({ id: 'prep-kit', title: 'Buy a starter kit', estimated_hours: 0, estimated_cost_usd: 30, required_for_application: true })],
};
const BROKE: StudentProfile = { ...OK_STUDENT, budget_usd: 0 };

/** 只有每周时间问题的机会：每周需要 10 小时，学生有 4 小时 → 缺 6 小时。 */
const TIME_OPP: Opportunity = { ...COST_OPP, id: 'fictional-time-only', cost: { fee_usd: 0, requires_travel_expense: false }, preparation: [], time_commitment: { hours_per_week: 10, total_weeks: 4 } };
const BUSY: StudentProfile = { ...OK_STUDENT, hours_per_week_available: 4 };

describe('analyzeGaps — pending 支持按引擎口径判断（M1）', () => {
  it('cost：已批准 $30 + 待批准 $100，获批后合计 $130 ≥ 缺口 $130 → 会化解（不说只覆盖一部分）', () => {
    const grants = [grant('a30', 'fee_waiver', 'approved', { amount_usd: 30 }), grant('p100', 'fee_waiver', 'pending', { amount_usd: 100 })];
    const g = analyzeGaps(BROKE, COST_OPP, grants, TODAY);
    const cost = byId(g, 'time_and_cost:cost');
    expect(cost.title).toBe('Cost: short $130');
    expect(cost.action).toContain('once approved, this barrier would be resolved');
    expect(cost.action).not.toContain('only part');
    expect(cost.action).toContain('not in effect yet');
    // 与引擎一致：把 pending 当作 approved 时引擎确实化解
    const flipped = analyzeReachability(BROKE, COST_OPP, grants.map((x) => ({ ...x, status: 'approved' as const })), TODAY);
    expect(flipped.barriers.find((b) => b.type === 'cost')?.resolved).toBe(true);
  });

  it('cost：已批准 $30 + 待批准 $50 → 只能化解一部分，写出剩余 $50', () => {
    const grants = [grant('a30', 'fee_waiver', 'approved', { amount_usd: 30 }), grant('p50', 'fee_waiver', 'pending', { amount_usd: 50 })];
    const cost = byId(analyzeGaps(BROKE, COST_OPP, grants, TODAY), 'time_and_cost:cost');
    expect(cost.action).toContain('would cover only part of the gap: you would still be short $50.');
    expect(cost.action).toContain('not in effect yet');
  });

  it('cost：已批准一张无金额减免 + 待批准一张无金额减免 → 获批也不改变，如实说明，不说覆盖一部分', () => {
    const grants = [grant('a-null', 'fee_waiver', 'approved', { amount_usd: null }), grant('p-null', 'fee_waiver', 'pending', { amount_usd: null })];
    const cost = byId(analyzeGaps(BROKE, COST_OPP, grants, TODAY), 'time_and_cost:cost');
    expect(cost.action).toContain('even if approved it would not reduce this gap');
    expect(cost.action).toContain('only covers the official fee once');
    expect(cost.action).not.toContain('only part');
    expect(cost.action).not.toContain('would be resolved');
    expect(cost.action).toContain('not in effect yet');
    expect(cost.action).toContain('fee waiver or financial aid'); // 仍给出无 pending 时的建议
    // 建议里注明已生效的支持已抵掉的部分（缺口 $130 中 $100 已由无金额减免抵掉）
    expect(cost.action).toContain('approved support already covers $100 of it, so about $30 is still uncovered');
  });

  it('time_support：已批准 2 小时 + 待批准 4 小时 → 会化解；待批准 1 小时 → 一部分（还差 3 小时）；待批准 0 小时 → 不改变', () => {
    const a2 = grant('a2', 'time_support', 'approved', { hours_per_week: 2 });
    const full = byId(analyzeGaps(BUSY, TIME_OPP, [a2, grant('p4', 'time_support', 'pending', { hours_per_week: 4 })], TODAY), 'time_and_cost:time');
    expect(full.title).toBe('Time: short 6 hours per week');
    expect(full.action).toContain('this barrier would be resolved');
    expect(full.action).toContain('not in effect yet');
    const part = byId(analyzeGaps(BUSY, TIME_OPP, [a2, grant('p1', 'time_support', 'pending', { hours_per_week: 1 })], TODAY), 'time_and_cost:time');
    expect(part.action).toContain('would cover only part of the gap: you would still be short about 3 hours per week.');
    const none = byId(analyzeGaps(BUSY, TIME_OPP, [a2, grant('p0', 'time_support', 'pending', { hours_per_week: 0 })], TODAY), 'time_and_cost:time');
    expect(none.action).toContain('would not reduce this gap');
    expect(none.action).not.toContain('only part');
    expect(none.action).toContain('not in effect yet');
  });

  it('device：待批准的同设备 grant → 会化解；设备按名称对应', () => {
    const o: Opportunity = { ...COST_OPP, cost: { fee_usd: 0, requires_travel_expense: false }, preparation: [], required_devices: ['laptop', 'webcam'] };
    const s: StudentProfile = { ...OK_STUDENT, devices: ['laptop'] };
    const g = analyzeGaps(s, o, [grant('p-cam', 'device', 'pending', { device: 'webcam' })], TODAY);
    expect(ids(g, 'time_and_cost')).toEqual(['time_and_cost:device:webcam']);
    expect(byId(g, 'time_and_cost:device:webcam').action).toContain('this barrier would be resolved');
  });
});

describe('analyzeGaps — 报名费未知时的缺口数字（M2）', () => {
  const FEE_NULL: Opportunity = {
    ...COST_OPP,
    id: 'fictional-fee-null',
    cost: { fee_usd: null, requires_travel_expense: false },
    preparation: [prep({ id: 'prep-kit', title: 'Buy a starter kit', estimated_hours: 0, estimated_cost_usd: 100, required_for_application: true })],
  };
  const S = { ...OK_STUDENT, budget_usd: 50 };

  it('fee 未知、必需准备 $100、预算 $50、已批准 $20：标题、行动、estimated_cost_usd、detail 都是至少 $30', () => {
    const cost = byId(analyzeGaps(S, FEE_NULL, [grant('a20', 'fee_waiver', 'approved', { amount_usd: 20 })], TODAY), 'time_and_cost:cost');
    expect(cost.title).toBe('Cost: short at least $30');
    expect(cost.estimated_cost_usd).toBe(30);
    expect(cost.action).toContain('at least $30');
    expect(cost.detail).toContain('short at least $30');
    // 缺口数字只有一个口径（detail 里的 $50 是预算，不是缺口）
    for (const t of [cost.title, cost.action ?? '']) expect(t).not.toContain('$50');
    expect(cost.detail).not.toMatch(/short (at least )?\$50/);
  });

  it('fee 未知且有 pending：获批后可算出的缺口被抵掉时，说明官方费用不清楚、总额可能仍超出', () => {
    const grants = [grant('a20', 'fee_waiver', 'approved', { amount_usd: 20 }), grant('p30', 'fee_waiver', 'pending', { amount_usd: 30 })];
    const cost = byId(analyzeGaps(S, FEE_NULL, grants, TODAY), 'time_and_cost:cost');
    expect(cost.action).toContain('official fee is not clear');
    expect(cost.action).toContain('not in effect yet');
    const part = byId(analyzeGaps(S, FEE_NULL, [grant('a20', 'fee_waiver', 'approved', { amount_usd: 20 }), grant('p10', 'fee_waiver', 'pending', { amount_usd: 10 })], TODAY), 'time_and_cost:cost');
    expect(part.action).toContain('you would still be short at least $20.');
  });
});

describe('analyzeGaps — 成环依赖、档案损坏、非法 today', () => {
  it('准备项 A、B 互相依赖：不互相写「先做对方」，改为中性说明', () => {
    const o: Opportunity = {
      ...OPP,
      preparation: [
        prep({ id: 'prep-a', title: 'Item A', depends_on: ['prep-b'] }),
        prep({ id: 'prep-b', title: 'Item B', depends_on: ['prep-a'] }),
        prep({ id: 'prep-c', title: 'Item C', depends_on: ['prep-a'] }),
      ],
    };
    const g = analyzeGaps(OK_STUDENT, o, [], TODAY);
    const a = byId(g, 'knowledge_or_experience:prep-a');
    const b = byId(g, 'knowledge_or_experience:prep-b');
    expect(a.action).not.toMatch(/first:/);
    expect(b.action).not.toMatch(/first:/);
    expect(a.action).toContain('this item and "Item B" depend on each other');
    expect(b.action).toContain('this item and "Item A" depend on each other');
    expect(a.action).toContain('ask the organizer');
    // 不成环的依赖照常提示先后
    expect(byId(g, 'knowledge_or_experience:prep-c').action).toMatch(/^Do "Item A" first/);
  });

  it.each([
    ['skills 元素的 name 不是字符串', { skills: [{ name: 5, level: 'beginner' }] }, 'profile.skills'],
    ['skills 元素的 level 不合法', { skills: [{ name: 'python', level: 'expert' }] }, 'profile.skills'],
    ['citizenships 含非字符串', { citizenships: [5] }, 'profile.citizenships'],
    ['devices 不是数组', { devices: 'laptop' }, 'profile.devices'],
    ['region.country 不是字符串', { region: { country: 5 } }, 'profile.region'],
    ['evidence 某条 title 不是字符串', { evidence: [{ id: 'e1', title: 5, kind: 'project', skills: [], status: 'self_reported', added_on: '2026-11-01' }] }, 'profile.evidence'],
  ])('档案损坏（%s）→ 列为档案字段，不说官方要求读不了', (_name, patch, field) => {
    const g = analyzeGaps({ ...STUDENT, ...patch } as unknown as StudentProfile, OPP, [], TODAY);
    expect(g.items.map((i) => i.id)).toEqual([`unknown_info:${field}`]);
    const it0 = g.items[0];
    expect(it0.title).toMatch(/^Unclear in your profile: /);
    expect(it0.action).toMatch(/^Correct .+ in your Skill Passport\.$/);
    expect(g.items.some((i) => /Official requirement could not be read/.test(i.title))).toBe(false);
    expect(g.eligibility_overall).toBe('unknown');
    expect(g.reachable).toBeNull();
    expect(g.summary).toContain('Skill Passport');
  });

  it('today 是非法字符串：文案为 missing or could not be read，不说 was not provided / did not pass', () => {
    const g = analyzeGaps(STUDENT, OPP, [], { today: 'not-a-date' });
    const t = byId(g, 'unknown_info:options.today');
    expect(t.title).toBe("Today's date was missing or could not be read");
    for (const s of texts(t)) expect(s).not.toMatch(/was not provided|did not pass/);
  });
});

describe('analyzeGaps — 年龄 / 年级「以后可能满足」的共同口径', () => {
  it('参考日在未来、学生到参考日会超过上限：不说以后可能满足', () => {
    const o = oneReq({ id: 'req-age', type: 'age', min: 16, max: 16, as_of: '2029-11-17', label: 'Age 16 on Nov 17, 2029', hard: true, source_text: 'Must be 16 on Nov 17, 2029.' });
    const g = analyzeGaps({ ...OK_STUDENT, age: 15 }, o, [], TODAY);
    const i = byId(g, 'unchangeable_eligibility:req-age');
    expect(i.detail).not.toContain('may be met later');
  });

  it('参考日在未来、到参考日仍低于下限：说以后可能满足', () => {
    const o = oneReq({ id: 'req-age', type: 'age', min: 18, as_of: '2027-11-17', label: '18+', hard: true, source_text: 'Must be 18.' });
    const i = byId(analyzeGaps({ ...OK_STUDENT, age: 15 }, o, [], TODAY), 'unchangeable_eligibility:req-age');
    expect(i.detail).toContain('as you get older');
  });

  it('grade 区间无效（max < min）：不说以后可能满足', () => {
    const o = oneReq({ id: 'req-g', type: 'grade', min: 11, max: 9, label: 'Broken range', hard: true, source_text: 'Grades 11-9.' });
    const i = byId(analyzeGaps({ ...OK_STUDENT, grade: 8 }, o, [], TODAY), 'unchangeable_eligibility:req-g');
    expect(i.detail).not.toContain('may be met later');
  });
});

describe('analyzeGaps — 已过截止日期的追加说明', () => {
  const PASSED = { today: '2027-03-01' };
  const passed = (o: Opportunity) => analyzeGaps({ ...STUDENT, grade: 11 }, o, [], PASSED).items.find((i) => i.title === 'Deadline has passed') as GapItem;

  it('每年举办：「下一届」只出现一次（引擎原文），追加的一句只指向替代机会', () => {
    const i = passed(OPP);
    expect(i.detail.match(/next round/gi)).toHaveLength(1);
    expect(i.detail).toContain('See the alternatives for this opportunity.');
  });

  it('recurring_annually === false：追加的一句不提下一届', () => {
    const i = passed({ ...OPP, recurring_annually: false });
    const r = analyzeReachability({ ...STUDENT, grade: 11 }, { ...OPP, recurring_annually: false }, [], PASSED);
    const engine = r.barriers.find((b) => b.type === 'time' && b.shortfall == null)!.description;
    expect(i.detail.startsWith(engine)).toBe(true);
    const extra = i.detail.slice(engine.length);
    expect(extra).not.toMatch(/next round|next year|next cycle/i);
    expect(extra).toContain('same field');
    expect(i.action).toBeNull();
  });
});

describe('analyzeGaps — 全文扫描（放在最后，覆盖以上所有用例的结果）', () => {
  it('unchangeable_eligibility 永远没有 action；任何文字都不出现绕过类字样或内部字段名', () => {
  const banned = /work ?around|bypass|get around|loophole|shortcut|sneak|trick/i;
  const internal = /\b(profile|opportunity|options)\.[a-z_]/;
  /**
   * 不暗示录取、不出现分数或名次：
   * - 「会 / 将被录取」类肯定句：(will|would|could|should|can|going to|likely to) be admitted；
   *   否定句（"does not mean admitted"、"says nothing about admission"）不匹配，是允许的。
   * - guarantee 的任何形式（guarantee / guaranteed / guarantees）。
   * - score / rank 作为独立单词及其常见变形（\b 保证不误伤 "frank" 之类）。
   */
  const admission = /\b(will|would|could|should|can|going to|likely to) be admitted\b|guarantee|\bscor(e|es|ed|ing)\b|\brank(s|ed|ing)?\b/i;
  for (const g of SEEN) {
    expect(g.summary).not.toMatch(banned);
    expect(g.summary).not.toMatch(internal);
    expect(g.summary).not.toMatch(admission);
    for (const i of g.items) {
      if (i.category === 'unchangeable_eligibility') {
        expect(i.action).toBeNull();
        expect(i.improvable).toBe(false);
      }
      for (const t of texts(i)) {
        expect(t).not.toMatch(banned);
        expect(t).not.toMatch(internal);
        expect(t).not.toMatch(admission);
      }
    }
  }
  expect(SEEN.length).toBeGreaterThan(30);
  });

  it('admission 正则本身：区分肯定句与否定句', () => {
    const admission = /\b(will|would|could|should|can|going to|likely to) be admitted\b|guarantee|\bscor(e|es|ed|ing)\b|\brank(s|ed|ing)?\b/i;
    expect('Reachable does not mean admitted.').not.toMatch(admission);
    expect('this is reachable, which does not mean admitted').not.toMatch(admission);
    expect('You will be admitted.').toMatch(admission);
    expect('Admission is guaranteed.').toMatch(admission);
    expect('Your score is 80.').toMatch(admission);
    expect('You rank first.').toMatch(admission);
    expect('Be frank with the organizer.').not.toMatch(admission);
  });
});
