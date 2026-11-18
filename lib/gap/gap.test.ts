/**
 * analyzeGaps（第二阶段示例版本）测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { analyzeGaps } from '.';
import { GAP_CATEGORIES, type Opportunity, type PrepItem, type ResourceGrant, type StudentProfile } from '../types';

const TODAY = { today: '2026-11-17' };

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 2, estimated_cost_usd: 0, depends_on: [], required_for_application: false, ...p };
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

describe('analyzeGaps — 形状与口径', () => {
  const g = analyzeGaps(STUDENT, OPP, [], TODAY);

  it('基本字段与 counts 五个键齐全、与 items 一致', () => {
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

  it('五类归类正确', () => {
    const ids = (c: string) => g.items.filter((i) => i.category === c).map((i) => i.id);
    expect(ids('knowledge_or_experience')).toEqual(['knowledge_or_experience:req-py', 'knowledge_or_experience:prep-python']);
    expect(ids('materials')).toEqual(['materials:req-pf', 'materials:prep-resume']);
    expect(ids('time_and_cost')).toEqual(['time_and_cost:time', 'time_and_cost:cost', 'time_and_cost:device']);
    expect(ids('unchangeable_eligibility')).toEqual(['unchangeable_eligibility:req-grade']);
    // citizenships 没填 → unknown；manual → unknown
    expect(ids('unknown_info')).toEqual(['unknown_info:req-cit', 'unknown_info:req-interview']);
    expect(g.eligibility_overall).toBe('not_eligible');
    expect(g.reachable).toBe(false);
  });

  it('如实：不可改变的资格限制 improvable 为 false、action 为 null，并附官网原文', () => {
    for (const i of g.items.filter((x) => x.category === 'unchangeable_eligibility')) {
      expect(i.improvable).toBe(false);
      expect(i.action).toBeNull();
      expect(i.basis).toMatchObject({ kind: 'requirement', source_text: 'Open to grades 11-12.' });
    }
  });

  it('其余可改善的差距都有 action；材料类准备项带依据原文与小时', () => {
    for (const i of g.items.filter((x) => x.category !== 'unchangeable_eligibility')) {
      expect(i.improvable).toBe(true);
      expect(typeof i.action).toBe('string');
    }
    const resume = g.items.find((i) => i.id === 'materials:prep-resume')!;
    expect(resume.basis).toEqual({ kind: 'prep_item', prep_item_id: 'prep-resume', source_text: 'Submit a resume.' });
    expect(resume.estimated_hours).toBe(3);
  });

  it('已化解的障碍不列；approved 设备 grant 后设备差距消失', () => {
    const grant: ResourceGrant = { id: 'g1', student_id: STUDENT.id, opportunity_id: OPP.id, type: 'device', device: 'laptop', status: 'approved', provider: 'Example Org (fictional)', is_sample: true };
    const after = analyzeGaps(STUDENT, OPP, [grant], TODAY);
    expect(after.items.some((i) => i.id === 'time_and_cost:device')).toBe(false);
  });

  it('missing_info 每个字段各一条 unknown_info（逐条，不合并）', () => {
    const sparse: StudentProfile = { id: 'sparse', is_sample: true, display_name: 'x', evidence: [] };
    const r = analyzeGaps(sparse, OPP, [], TODAY);
    const fields = r.items.filter((i) => i.basis.kind === 'missing_field').map((i) => (i.basis as { field: string }).field);
    expect(fields).toEqual(['profile.devices', 'profile.budget_usd', 'profile.transport', 'profile.hours_per_week_available']);
    for (const i of r.items.filter((x) => x.basis.kind === 'missing_field')) {
      expect(i.category).toBe('unknown_info');
      expect(i.action).toContain('Skill Passport');
    }
  });

  it('已过截止日期：time_and_cost 条目不可改善、action 为 null', () => {
    const r = analyzeGaps({ ...STUDENT, grade: 11 }, OPP, [], { today: '2027-03-01' });
    const passed = r.items.find((i) => i.title === 'Deadline has passed')!;
    expect(passed).toBeDefined();
    expect(passed.improvable).toBe(false);
    expect(passed.action).toBeNull();
  });
});

describe('analyzeGaps — 确定性、不修改输入、健壮性', () => {
  it('同输入两次结果相同', () => {
    expect(analyzeGaps(STUDENT, OPP, [], TODAY)).toEqual(analyzeGaps(STUDENT, OPP, [], TODAY));
  });

  it('不修改输入', () => {
    const p = structuredClone(STUDENT);
    const o = structuredClone(OPP);
    const grants: ResourceGrant[] = [];
    analyzeGaps(p, o, grants, TODAY);
    expect(p).toEqual(STUDENT);
    expect(o).toEqual(OPP);
    expect(grants).toEqual([]);
  });

  it('空 preparation、空 requirements、缺字段档案、坏输入都不抛错', () => {
    const empty = { ...OPP, preparation: [], requirements: [] };
    expect(() => analyzeGaps(STUDENT, empty, [], TODAY)).not.toThrow();
    expect(() => analyzeGaps({ id: 'x', is_sample: true, display_name: '', evidence: [] }, OPP, [], undefined)).not.toThrow();
    const broken = { id: 'broken', title: 'Broken' } as unknown as Opportunity;
    const r = analyzeGaps(STUDENT, broken, [], TODAY);
    expect(r.eligibility_overall).toBe('unknown');
    expect(r.reachable).toBeNull();
    expect(r.counts.unknown_info).toBe(1);
    expect(() => analyzeGaps(null as unknown as StudentProfile, null as unknown as Opportunity, null as unknown as ResourceGrant[])).not.toThrow();
    expect(() => analyzeGaps({ id: 'y' } as unknown as StudentProfile, OPP, [], TODAY)).not.toThrow();
  });

  it('示例档案 × 真实机会全部不抛错，counts 与 items 一致', () => {
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const o of opportunitiesJson as unknown as Opportunity[]) {
        for (const opts of [TODAY, undefined]) {
          const r = analyzeGaps(p, o, [], opts);
          expect(r.items.length).toBe(Object.values(r.counts).reduce((a, b) => a + b, 0));
        }
      }
    }
  });
});
