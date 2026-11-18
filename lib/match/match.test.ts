/**
 * explainMatch / findAlternatives（均为完整实现）测试；explainMatch 的分项理由测试在 ./explain.test.ts。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { checkEligibility } from '../eligibility';
import { analyzeGaps } from '../gap';
import { explainMatch, findAlternatives } from '.';
import {
  MATCH_REASON_KINDS,
  type AlternativeSuggestion,
  type Opportunity,
  type PrepItem,
  type Requirement,
  type ResourceGrant,
  type StudentProfile,
} from '../types';

const TODAY = { today: '2026-11-17' };

function opp(id: string, over: Partial<Opportunity> = {}): Opportunity {
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
    deadline: '2027-02-01',
    recurring_annually: false,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 4 },
    required_devices: [],
    requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12.' }],
    preparation: [],
    is_sample: true,
    ...over,
  };
}

const TARGET = opp('fictional-target', { fields: ['climate', 'data_science'], recurring_annually: true });
const ELIGIBLE_A = opp('fictional-b-eligible', { fields: ['climate'] });
const ELIGIBLE_B = opp('fictional-a-eligible', { fields: ['data_science'] });
const UNKNOWN = opp('fictional-c-unknown', {
  fields: ['climate'],
  requirements: [{ id: 'req-m', type: 'manual', label: 'Interview', hard: true, source_text: 'Interview required.' }],
});
const NOT_ELIGIBLE = opp('fictional-0-not-eligible', {
  fields: ['climate'],
  requirements: [{ id: 'req-grade', type: 'grade', min: 13, label: 'Undergraduates', hard: true, source_text: 'Undergraduates only.' }],
});
const EXTRA = opp('fictional-d-extra', { fields: ['data_science'] });
const UNRELATED = opp('fictional-unrelated', { fields: ['music'] });
const POSTED = opp('fictional-e-posted', { fields: ['climate'], source_tier: 'user_posted', posted_by: 'sample-pub' });

const CATALOG = [TARGET, ELIGIBLE_A, ELIGIBLE_B, UNKNOWN, NOT_ELIGIBLE, EXTRA, UNRELATED, POSTED];

const STUDENT: StudentProfile = {
  id: 'match-student',
  is_sample: true,
  display_name: 'Sample student (match test)',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  school_name: 'Example High (fictional)',
  hours_per_week_available: 5,
  budget_usd: 20,
  transport: { level: 'reliable' },
  devices: ['laptop'],
  skills: [],
  evidence: [],
  interests: ['Climate', 'music'],
};

function collectKeys(v: unknown, out: Set<string>): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
    out.add(k);
    collectKeys(x, out);
  }
  return out;
}

describe('explainMatch', () => {
  const m = explainMatch(STUDENT, TARGET, TODAY);

  it('形状：线上机会 → interest / eligibility / reachability / format / time / cost / device（无 transport），按 MATCH_REASON_KINDS 顺序', () => {
    expect(m.profile_id).toBe(STUDENT.id);
    expect(m.opportunity_id).toBe(TARGET.id);
    expect(m.reasons.map((r) => r.kind)).toEqual(['interest', 'eligibility', 'reachability', 'format', 'time', 'cost', 'device']);
    const idx = m.reasons.map((r) => MATCH_REASON_KINDS.indexOf(r.kind));
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
    expect(m.shared_interests).toEqual(['climate']);
    expect(m.eligibility_overall).toBe('eligible');
    expect(m.reasons[0].positive).toBe(true);
    expect(m.summary.length).toBeGreaterThan(0);
  });

  it('如实：返回对象里没有任何 score / rank / rating 键，也没有百分比', () => {
    const keys = [...collectKeys(m, new Set())].map((k) => k.toLowerCase());
    for (const bad of ['score', 'rank', 'rating']) expect(keys.some((k) => k.includes(bad))).toBe(false);
    expect(JSON.stringify(m)).not.toMatch(/\d+\s*%/);
  });

  it('信息不足：兴趣没填 → interest positive null、shared_interests []；资格 unknown → eligibility positive null', () => {
    const r = explainMatch({ ...STUDENT, interests: null }, UNKNOWN, TODAY);
    expect(r.reasons[0].positive).toBeNull();
    expect(r.shared_interests).toEqual([]);
    expect(r.eligibility_overall).toBe('unknown');
    expect(r.reasons[1].positive).toBeNull();
    expect(r.reasons[2].positive).toBe(r.reachable);
  });

  it('不满足硬性资格 → eligibility positive false；兴趣无交集 → interest positive false', () => {
    const r = explainMatch({ ...STUDENT, interests: ['art'] }, NOT_ELIGIBLE, TODAY);
    expect(r.reasons[0].positive).toBe(false);
    expect(r.reasons[1].positive).toBe(false);
    expect(r.reachable).toBe(false);
  });

  it('确定性、不修改输入', () => {
    const p = structuredClone(STUDENT);
    const o = structuredClone(TARGET);
    expect(explainMatch(p, o, TODAY)).toEqual(explainMatch(p, o, TODAY));
    expect(p).toEqual(STUDENT);
    expect(o).toEqual(TARGET);
  });

  it('空 / 缺字段输入不抛错', () => {
    expect(() => explainMatch({ id: 'x', is_sample: true, display_name: '', evidence: [] }, TARGET)).not.toThrow();
    expect(() => explainMatch(STUDENT, { id: 'broken' } as unknown as Opportunity, TODAY)).not.toThrow();
    expect(explainMatch(STUDENT, { id: 'broken' } as unknown as Opportunity, TODAY).reachable).toBeNull();
    expect(() => explainMatch(null as unknown as StudentProfile, null as unknown as Opportunity)).not.toThrow();
  });
});

// ───────────────────────────── findAlternatives（完整实现）─────────────────────────────

/** 本文件里所有 findAlternatives 结果的 reason，最后统一扫描禁用措辞。 */
const ALL_REASONS: string[] = [];
function fa(...args: Parameters<typeof findAlternatives>): AlternativeSuggestion[] {
  const r = findAlternatives(...args);
  for (const a of r) ALL_REASONS.push(a.reason);
  return r;
}
const kinds = (r: AlternativeSuggestion[]) => r.map((a) => a.kind);
const sameIds = (r: AlternativeSuggestion[]) => r.filter((a) => a.kind === 'same_field').map((a) => a.opportunity_id);
const nextOf = (r: AlternativeSuggestion[]) => r.find((a) => a.kind === 'next_cycle');

const REQ_GRADE_12: Requirement = { id: 'req-grade', type: 'grade', min: 12, max: 12, label: 'Grade 12 only', hard: true, source_text: 'Open to grade 12 students only.' };
const REQ_GRADE_MAX_10: Requirement = { id: 'req-grade', type: 'grade', min: 9, max: 10, label: 'Grades 9–10', hard: true, source_text: 'Grades 9-10 only.' };
const REQ_REGION_UK: Requirement = { id: 'req-region', type: 'region', countries: ['GB'], label: 'UK residents', hard: true, source_text: 'UK residents only.' };
const REQ_SKILL: Requirement = { id: 'req-skill', type: 'prerequisite_skill', skill: 'fictional_skill', label: 'Fictional skill', hard: true, source_text: 'Must know the fictional skill.' };
const BIG_PREP = (required: boolean): PrepItem => ({
  id: 'prep-big',
  title: 'Big fictional prep',
  estimated_hours: 100,
  estimated_cost_usd: 0,
  depends_on: [],
  required_for_application: required,
});

describe('findAlternatives：受阻原因与 next_cycle', () => {
  const T = (over: Partial<Opportunity>) => opp('fictional-target', { fields: ['climate'], recurring_annually: true, ...over });
  const CAT = [opp('fictional-same', { fields: ['climate'] })];

  it('学生没有受阻（资格符合、可达、来得及）→ 返回 []（不推销其他机会）', () => {
    expect(fa(STUDENT, TARGET, CATALOG, TODAY)).toEqual([]);
    expect(fa(STUDENT, T({}), CAT, TODAY)).toEqual([]);
  });

  it('截止日期已过 → 给 next_cycle（并给同领域）；没给 today 时不算过期', () => {
    const r = fa(STUDENT, T({ deadline: '2026-11-01' }), CAT, TODAY);
    expect(kinds(r)).toEqual(['next_cycle', 'same_field']);
    expect(nextOf(r)).toMatchObject({ opportunity_id: 'fictional-target', eligibility_overall: null, shared_fields: ['climate'] });
    expect(nextOf(r)!.reason).toContain('has passed');
    expect(fa(STUDENT, T({ deadline: '2026-11-01' }), CAT, undefined)).toEqual([]);
  });

  it('年级低于下限（会随时间改善）→ 给 next_cycle，理由写出那条要求', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_12] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['next_cycle', 'same_field']);
    expect(nextOf(r)!.reason).toContain('"Grade 12 only"');
    expect(nextOf(r)!.reason).toMatch(/move up a grade/);
  });

  it('年级低于下限 + 地区不符（不会改善）→ 不给 next_cycle，仍给同领域', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_12, REQ_REGION_UK] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['same_field']);
  });

  it('只缺技能（可以自己补）→ 不给 next_cycle，仍给同领域', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_SKILL] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['same_field']);
  });

  it('年级低于下限 + 缺技能 → 给 next_cycle，并说明技能也要补上', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_12, REQ_SKILL] }), CAT, TODAY);
    expect(nextOf(r)!.reason).toContain('"Fictional skill"');
  });

  it('年级高于上限（不会改善）→ 不给 next_cycle', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_MAX_10] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['same_field']);
  });

  it('截止已过但有不会改善的阻断 → 不给 next_cycle（下一届同样不符合）', () => {
    const r = fa(STUDENT, T({ deadline: '2026-11-01', requirements: [REQ_REGION_UK] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['same_field']);
  });

  it('来不及准备（每条路线都 feasible_by_deadline === false）→ 给 next_cycle', () => {
    const tight = { deadline: '2026-12-01', preparation: [BIG_PREP(true)] };
    const r = fa(STUDENT, T(tight), CAT, TODAY);
    expect(kinds(r)).toEqual(['next_cycle', 'same_field']);
    expect(nextOf(r)!.reason).toContain('none of the suggested routes');
    // 只有建议项（不影响可达性）也来不及：仍算受阻
    const r2 = fa(STUDENT, T({ deadline: '2026-12-01', preparation: [BIG_PREP(false)] }), CAT, TODAY);
    expect(kinds(r2)).toEqual(['next_cycle', 'same_field']);
    // 时间宽裕 → 不受阻
    expect(fa(STUDENT, T({ deadline: '2028-12-01', preparation: [BIG_PREP(true)] }), CAT, TODAY)).toEqual([]);
  });

  it('recurring_annually === false → 各种情形都不给 next_cycle', () => {
    for (const over of [
      { deadline: '2026-11-01' },
      { requirements: [REQ_GRADE_12] },
      { deadline: '2026-12-01', preparation: [BIG_PREP(true)] },
    ]) {
      const r = fa(STUDENT, T({ ...over, recurring_annually: false }), CAT, TODAY);
      expect(nextOf(r)).toBeUndefined();
      expect(kinds(r)).toEqual(['same_field']);
    }
  });

  it.each([null, undefined])('recurring_annually 为 %j → 给 next_cycle，并注明是否每年举办未确认', (v) => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_12], recurring_annually: v }), CAT, TODAY);
    expect(nextOf(r)!.reason).toContain('whether it runs every year is not confirmed — check with the organizer'.replace(/^w/, 'W'));
    const sure = fa(STUDENT, T({ requirements: [REQ_GRADE_12] }), CAT, TODAY);
    expect(nextOf(sure)!.reason).not.toContain('not confirmed');
  });

  it('不承诺下一届一定能申请：理由提醒届时按官网最新要求确认', () => {
    const r = fa(STUDENT, T({ requirements: [REQ_GRADE_12] }), CAT, TODAY);
    expect(nextOf(r)!.reason).toMatch(/can't promise/);
    expect(nextOf(r)!.reason).toMatch(/latest official rules/);
  });

  it('只有现实障碍（不可达）→ 不给 next_cycle，但给同领域', () => {
    const r = fa(STUDENT, T({ required_devices: ['webcam'] }), CAT, TODAY);
    expect(kinds(r)).toEqual(['same_field']);
  });
});

describe('findAlternatives：same_field 过滤', () => {
  const BLOCKED_TARGET = opp('fictional-target', { fields: ['climate', 'data_science'], recurring_annually: true, requirements: [REQ_GRADE_12] });

  it('过滤 not_eligible、已过截止、自身、重复 id、无共同标签', () => {
    const DUP = opp('fictional-b-eligible', { fields: ['climate'], title: 'Duplicate (should not appear)' });
    const PAST = opp('fictional-a-past', { fields: ['climate'], deadline: '2026-11-01' });
    const r = fa(STUDENT, BLOCKED_TARGET, [BLOCKED_TARGET, NOT_ELIGIBLE, PAST, ELIGIBLE_A, DUP, UNRELATED], TODAY);
    expect(sameIds(r)).toEqual(['fictional-b-eligible']);
    expect(r.find((a) => a.opportunity_id === 'fictional-b-eligible')!.title).toBe(ELIGIBLE_A.title);
  });

  it('最多 3 条；理由不把候选说成原机会的一部分', () => {
    const r = fa(STUDENT, BLOCKED_TARGET, CATALOG, TODAY);
    expect(sameIds(r)).toEqual(['fictional-a-eligible', 'fictional-b-eligible', 'fictional-d-extra']);
    for (const a of r.filter((x) => x.kind === 'same_field')) {
      expect(a.reason).toMatch(/^A separate opportunity/);
      expect(a.eligibility_overall).not.toBe('not_eligible');
    }
  });

  it('如实：返回的同领域机会对该学生都不是 not_eligible', () => {
    for (const a of fa(STUDENT, BLOCKED_TARGET, CATALOG, TODAY)) {
      if (a.kind !== 'same_field') continue;
      const o = CATALOG.find((x) => x.id === a.opportunity_id)!;
      expect(checkEligibility(STUDENT, o, TODAY).overall).not.toBe('not_eligible');
    }
  });

  it('user_posted 排在所有非 user_posted 之后，并在理由里注明未经官网核实', () => {
    const POSTED_A = opp('fictional-0-posted', { fields: ['climate', 'data_science'], source_tier: 'user_posted', posted_by: 'sample-pub' });
    const UNK = opp('fictional-z-unknown', { fields: ['climate'], deadline: null, requirements: UNKNOWN.requirements });
    const r = fa(STUDENT, BLOCKED_TARGET, [POSTED_A, UNK], TODAY);
    expect(sameIds(r)).toEqual(['fictional-z-unknown', 'fictional-0-posted']);
    expect(r.find((a) => a.opportunity_id === 'fictional-0-posted')!.reason).toContain('not verified on an official site');
    expect(r.find((a) => a.opportunity_id === 'fictional-z-unknown')!.reason).not.toContain('not verified');
  });

  it('shared_fields 用候选原本的写法，按归一化去重', () => {
    const c = opp('fictional-dupe-tags', { fields: ['Data-Science', 'data_science', 'climate'] });
    const r = fa(STUDENT, BLOCKED_TARGET, [c], TODAY);
    expect(r.find((a) => a.kind === 'same_field')!.shared_fields).toEqual(['Data-Science', 'climate']);
  });

  it('目标机会没有领域标签 → 没有同领域建议', () => {
    expect(sameIds(fa(STUDENT, { ...BLOCKED_TARGET, fields: [] }, CATALOG, TODAY))).toEqual([]);
  });
});

describe('findAlternatives：same_field 排序（每次只差一个键）', () => {
  const GRADE_TARGET = opp('fictional-target', { fields: ['climate', 'data_science'], requirements: [REQ_GRADE_12] });
  // 不可达（缺 webcam）、资格符合 → 受阻原因只有 not_reachable
  const DEVICE_TARGET = opp('fictional-target', { fields: ['climate', 'data_science'], required_devices: ['webcam'] });

  it('资格 eligible 在 unknown 之前', () => {
    const unk = opp('fictional-a', { requirements: UNKNOWN.requirements });
    const eli = opp('fictional-b');
    expect(sameIds(fa(STUDENT, GRADE_TARGET, [unk, eli], TODAY))).toEqual(['fictional-b', 'fictional-a']);
  });

  it('受阻原因含 not_reachable 时：reachable true < null < false，被排后的候选如实说明障碍类别', () => {
    const no = opp('fictional-a', { required_devices: ['webcam'] });
    const unknown = opp('fictional-b', { cost: { fee_usd: null, requires_travel_expense: false } });
    const yes = opp('fictional-c');
    const r = fa(STUDENT, DEVICE_TARGET, [no, unknown, yes], TODAY);
    expect(sameIds(r)).toEqual(['fictional-c', 'fictional-b', 'fictional-a']);
    expect(r.find((a) => a.opportunity_id === 'fictional-a')!.reason).toContain('unresolved barriers for you right now (device)');
    expect(r.find((a) => a.opportunity_id === 'fictional-b')!.reason).toContain("don't have enough info");
    expect(r.find((a) => a.opportunity_id === 'fictional-c')!.reason).toContain('realistically doable');
    // 受阻原因不含 not_reachable（年级阻断）→ 不按可达性排序，落到 id
    expect(sameIds(fa(STUDENT, GRADE_TARGET, [yes, unknown, no], TODAY))).toEqual(['fictional-a', 'fictional-b', 'fictional-c']);
  });

  it('共同标签多的在前', () => {
    const one = opp('fictional-a', { fields: ['climate'] });
    const two = opp('fictional-b', { fields: ['climate', 'data-science'] });
    const r = fa(STUDENT, GRADE_TARGET, [one, two], TODAY);
    expect(sameIds(r)).toEqual(['fictional-b', 'fictional-a']);
    expect(r.find((a) => a.opportunity_id === 'fictional-b')!.shared_fields).toEqual(['climate', 'data-science']);
  });

  it('截止日期早的在前，null 最后', () => {
    const rolling = opp('fictional-a', { deadline: null });
    const late = opp('fictional-b', { deadline: '2027-06-01' });
    const early = opp('fictional-c', { deadline: '2027-01-01' });
    expect(sameIds(fa(STUDENT, GRADE_TARGET, [rolling, late, early], TODAY))).toEqual(['fictional-c', 'fictional-b', 'fictional-a']);
  });

  it('其余都相同时按 id 字典序', () => {
    const r = fa(STUDENT, GRADE_TARGET, [opp('fictional-c'), opp('fictional-a'), opp('fictional-b')], TODAY);
    expect(sameIds(r)).toEqual(['fictional-a', 'fictional-b', 'fictional-c']);
  });
});

describe('findAlternatives：确定性与健壮性', () => {
  const BLOCKED_TARGET = opp('fictional-target', { fields: ['climate', 'data_science'], recurring_annually: null, requirements: [REQ_GRADE_12] });

  it('确定性、不修改输入（含目录顺序）', () => {
    const catalog = structuredClone(CATALOG);
    const p = structuredClone(STUDENT);
    const t = structuredClone(BLOCKED_TARGET);
    const a = fa(p, t, catalog, TODAY);
    expect(fa(p, t, [...catalog].reverse(), TODAY)).toEqual(a);
    expect(fa(p, t, catalog, TODAY)).toEqual(a);
    expect(catalog).toEqual(CATALOG);
    expect(p).toEqual(STUDENT);
    expect(t).toEqual(BLOCKED_TARGET);
  });

  it('只改 school_name / display_name，结果完全不变', () => {
    const other = { ...STUDENT, school_name: 'Another Fictional Academy', display_name: 'Someone else (sample)' };
    expect(fa(other, BLOCKED_TARGET, CATALOG, TODAY)).toEqual(fa(STUDENT, BLOCKED_TARGET, CATALOG, TODAY));
  });

  it('畸形输入不抛错', () => {
    const weird = [null, undefined, 42, 'x', [], {}, { id: 'bad', fields: ['climate'] }, { id: 7, fields: ['climate'] }, { ...ELIGIBLE_A, requirements: 'oops' }];
    expect(() => fa(STUDENT, BLOCKED_TARGET, weird as unknown as Opportunity[], TODAY)).not.toThrow();
    expect(sameIds(fa(STUDENT, BLOCKED_TARGET, weird as unknown as Opportunity[], TODAY))).not.toContain('bad');
    expect(() => fa({ id: 'x' } as unknown as StudentProfile, BLOCKED_TARGET, CATALOG)).not.toThrow();
    expect(() => fa(STUDENT, BLOCKED_TARGET, null as unknown as Opportunity[])).not.toThrow();
    expect(() => fa(null as unknown as StudentProfile, null as unknown as Opportunity, null as unknown as Opportunity[])).not.toThrow();
    expect(() => fa(STUDENT, { id: 'broken', fields: ['climate'], deadline: '2020-01-01' } as unknown as Opportunity, CATALOG, TODAY)).not.toThrow();
    expect(() => fa(STUDENT, { ...BLOCKED_TARGET, requirements: null } as unknown as Opportunity, CATALOG, { today: 'not-a-date' })).not.toThrow();
    expect(fa(STUDENT, { ...TARGET, recurring_annually: false }, [], TODAY)).toEqual([]);
  });

  it('机会数据残缺但截止已过：仍能如实给出 next_cycle', () => {
    const broken = { id: 'broken', title: 'Broken (fictional)', fields: ['climate'], deadline: '2026-11-01' } as unknown as Opportunity;
    const r = fa(STUDENT, broken, CATALOG, TODAY);
    expect(nextOf(r)?.reason).toContain('has passed');
  });
});

describe('findAlternatives：示例档案 × 真实机会', () => {
  const opps = opportunitiesJson as unknown as Opportunity[];
  const profiles = profilesJson as unknown as StudentProfile[];
  const P = (id: string) => profiles.find((p) => p.id === id)!;
  const O = (id: string) => opps.find((o) => o.id === id)!;

  it('四个档案 × 三条机会 × 两个日期全部跑通，same_field 不含 not_eligible', () => {
    expect(profiles).toHaveLength(4);
    expect(opps).toHaveLength(3);
    for (const p of profiles) {
      for (const o of opps) {
        for (const opts of [TODAY, { today: '2027-02-01' }, undefined]) {
          for (const a of fa(p, o, opps, opts)) {
            if (a.kind === 'same_field') expect(a.eligibility_overall).not.toBe('not_eligible');
            expect(a.opportunity_id).not.toBeNull();
          }
        }
      }
    }
  });

  it('sample-maya（11 年级）× Rutgers（只收本科生）→ 一条 next_cycle，注明是否每年举办未确认；目录里没有同领域机会', () => {
    const r = fa(P('sample-maya'), O('rutgers-newark-summer-research-2027'), opps, TODAY);
    expect(kinds(r)).toEqual(['next_cycle']);
    expect(r[0].opportunity_id).toBe('rutgers-newark-summer-research-2027');
    expect(r[0].shared_fields).toEqual(['biomedical-research', 'life-sciences']);
    expect(r[0].reason).toContain('not confirmed — check with the organizer');
  });

  it('sample-noor × Rutgers：资格符合但有交通障碍 → 受阻，但不给 next_cycle，目录里也没有同领域机会 → []', () => {
    expect(fa(P('sample-noor'), O('rutgers-newark-summer-research-2027'), opps, TODAY)).toEqual([]);
  });

  it('没有受阻的组合（sample-maya × MLH，线上、资格符合）→ []', () => {
    expect(fa(P('sample-maya'), O('mlh-open-source-week-2026'), opps, TODAY)).toEqual([]);
  });

  it('DOE SULI 截止（2027-01-06）之后 → 每个档案都得到一条「已过截止」的 next_cycle', () => {
    for (const p of profiles) {
      const r = fa(p, O('doe-suli-summer-2027'), opps, { today: '2027-02-01' });
      expect(kinds(r)).toEqual(['next_cycle']);
      expect(r[0].reason).toContain('has passed');
    }
  });
});

describe('示例档案 × 真实机会', () => {
  it('explainMatch / findAlternatives 全部不抛错', () => {
    const opps = opportunitiesJson as unknown as Opportunity[];
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const o of opps) {
        for (const opts of [TODAY, undefined]) {
          const m = explainMatch(p, o, opts);
          // 完整版：每个种类最多一条，按 MATCH_REASON_KINDS 顺序；前三条恒为 interest / eligibility / reachability。
          expect(m.reasons.slice(0, 3).map((x) => x.kind)).toEqual(['interest', 'eligibility', 'reachability']);
          const idx = m.reasons.map((x) => MATCH_REASON_KINDS.indexOf(x.kind));
          expect(idx).toEqual([...new Set(idx)].sort((a, b) => a - b));
          for (const a of findAlternatives(p, o, opps, opts)) {
            if (a.kind === 'same_field') expect(a.eligibility_overall).not.toBe('not_eligible');
          }
        }
      }
    }
  });
});

describe('标签写法归一化（连字符 / 下划线 / 空格 / 大小写）', () => {
  const WRITINGS = ['data-science', 'data_science', 'data science', ' Data-Science '];

  it.each(WRITINGS)('explainMatch：兴趣写成 %j 时结果一致，shared_interests 用机会原本的写法', (w) => {
    const target = opp('fictional-tag-target', { fields: ['Data-Science', 'climate'] });
    const base = explainMatch({ ...STUDENT, interests: ['data_science'] }, target, TODAY);
    const r = explainMatch({ ...STUDENT, interests: [w] }, target, TODAY);
    expect(r).toEqual(base);
    expect(r.shared_interests).toEqual(['Data-Science']);
    expect(r.reasons[0].positive).toBe(true);
  });

  it.each(WRITINGS)('findAlternatives：机会领域写成 %j 时同领域结果一致，shared_fields 用候选机会原本的写法', (w) => {
    const target = opp('fictional-tag-target', { fields: [w], requirements: [REQ_GRADE_12] });
    const cand = opp('fictional-tag-cand', { fields: ['data-science'] });
    const r = fa(STUDENT, target, [cand], TODAY).filter((a) => a.kind === 'same_field');
    expect(r.map((a) => a.opportunity_id)).toEqual(['fictional-tag-cand']);
    expect(r[0].shared_fields).toEqual(['data-science']);
  });

  it('示例档案（下划线）× 真实机会（连字符）：至少有一个组合的 shared_interests 非空', () => {
    const opps = opportunitiesJson as unknown as Opportunity[];
    const hits: string[] = [];
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const o of opps) {
        const m = explainMatch(p, o, TODAY);
        if (m.shared_interests.length > 0) hits.push(`${p.id}×${o.id}:${m.shared_interests.join(',')}`);
        for (const t of m.shared_interests) expect(o.fields).toContain(t); // 原写法
      }
    }
    expect(hits.length).toBeGreaterThan(0);
    // 具体组合：sample-noor 的 biomedical_research（下划线）对上 Rutgers 的 biomedical-research（连字符）
    const noor = (profilesJson as unknown as StudentProfile[]).find((p) => p.id === 'sample-noor');
    const rutgers = opps.find((o) => o.id === 'rutgers-newark-summer-research-2027');
    if (noor && rutgers) expect(explainMatch(noor, rutgers, TODAY).shared_interests).toEqual(['biomedical-research']);
  });

  it('示例档案的 interests 统一用下划线写法', () => {
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const t of p.interests ?? []) expect(t).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    }
  });
});

describe('explainMatch：options.grants 与 analyzeGaps 一致', () => {
  const NEEDS_LAPTOP = opp('fictional-needs-laptop', { required_devices: ['laptop'] });
  const PHONE_ONLY: StudentProfile = { ...STUDENT, devices: ['smartphone'] };
  const GRANT: ResourceGrant = {
    id: 'g-laptop',
    student_id: PHONE_ONLY.id,
    opportunity_id: NEEDS_LAPTOP.id,
    type: 'device',
    device: 'laptop',
    status: 'approved',
    provider: 'Example Org (fictional)',
    is_sample: true,
  };

  it('没传 grants：设备障碍使其不可达；传入 approved grant：可达，且与 analyzeGaps 的 reachable 相同', () => {
    const without = explainMatch(PHONE_ONLY, NEEDS_LAPTOP, TODAY);
    expect(without.reachable).toBe(false);
    expect(without.reachable).toBe(analyzeGaps(PHONE_ONLY, NEEDS_LAPTOP, [], TODAY).reachable);
    const withG = explainMatch(PHONE_ONLY, NEEDS_LAPTOP, { ...TODAY, grants: [GRANT] });
    const gaps = analyzeGaps(PHONE_ONLY, NEEDS_LAPTOP, [GRANT], TODAY);
    expect(withG.reachable).toBe(true);
    expect(withG.reachable).toBe(gaps.reachable);
    expect(withG.reasons.find((r) => r.kind === 'reachability')?.positive).toBe(true);
  });

  it('grants 不是数组时按 [] 处理，不抛错', () => {
    expect(() => explainMatch(PHONE_ONLY, NEEDS_LAPTOP, { ...TODAY, grants: 'x' as unknown as ResourceGrant[] })).not.toThrow();
    expect(explainMatch(PHONE_ONLY, NEEDS_LAPTOP, { ...TODAY, grants: 'x' as unknown as ResourceGrant[] }).reachable).toBe(false);
  });
});

describe('findAlternatives：给了 today 时不推荐截止日期已过的同领域机会', () => {
  const PAST = opp('fictional-a-past', { fields: ['climate'], deadline: '2026-11-16' });
  const TODAY_DL = opp('fictional-b-today', { fields: ['climate'], deadline: '2026-11-17' });
  const ROLLING = opp('fictional-c-rolling', { fields: ['climate'], deadline: null });
  const PAST_BLOCKED_TARGET = opp('fictional-target', { fields: ['climate'], requirements: [REQ_GRADE_12] });

  it('截止已过的跳过；截止就是今天、滚动招生（null）的保留', () => {
    const r = fa(STUDENT, PAST_BLOCKED_TARGET, [PAST, TODAY_DL, ROLLING], TODAY).filter((a) => a.kind === 'same_field');
    expect(r.map((a) => a.opportunity_id)).toEqual(['fictional-b-today', 'fictional-c-rolling']);
  });

  it('没给 today 时不按日期过滤', () => {
    const r = fa(STUDENT, PAST_BLOCKED_TARGET, [PAST], undefined).filter((a) => a.kind === 'same_field');
    expect(r.map((a) => a.opportunity_id)).toEqual(['fictional-a-past']);
  });
});

describe('findAlternatives：options.grants（MatchOptions）', () => {
  const CAT = [opp('fictional-same', { fields: ['climate'] })];
  const CAM_TARGET = opp('fictional-target', { fields: ['climate'], recurring_annually: true, required_devices: ['webcam'] });
  const camGrant = (over: Partial<ResourceGrant> = {}): ResourceGrant => ({
    id: 'g-cam',
    student_id: STUDENT.id,
    opportunity_id: CAM_TARGET.id,
    type: 'device',
    device: 'webcam',
    status: 'approved',
    provider: 'Example Org (fictional)',
    is_sample: true,
    ...over,
  });

  it('缺 webcam、已批准 webcam 的 device grant：analyzeGaps 可达，findAlternatives 不再判为受阻；不传 grants 时仍受阻', () => {
    expect(analyzeGaps(STUDENT, CAM_TARGET, [camGrant()], TODAY).reachable).toBe(true);
    expect(fa(STUDENT, CAM_TARGET, CAT, { ...TODAY, grants: [camGrant()] })).toEqual([]);
    expect(kinds(fa(STUDENT, CAM_TARGET, CAT, TODAY))).toEqual(['same_field']);
    expect(kinds(fa(STUDENT, CAM_TARGET, CAT, { ...TODAY, grants: [] }))).toEqual(['same_field']);
  });

  it('不生效的 grant（pending、别的学生、别的机会、缺 opportunity_id）不解除受阻', () => {
    for (const g of [
      camGrant({ status: 'pending' }),
      camGrant({ student_id: 'someone-else' }),
      camGrant({ opportunity_id: 'another-opportunity' }),
      { ...camGrant(), opportunity_id: undefined } as unknown as ResourceGrant,
    ]) {
      expect(kinds(fa(STUDENT, CAM_TARGET, CAT, { ...TODAY, grants: [g] }))).toEqual(['same_field']);
    }
  });

  it('候选机会的可达性也用同一组 grants', () => {
    const target = opp('fictional-target', { fields: ['climate'], requirements: [REQ_GRADE_12] });
    const cand = opp('fictional-cam-cand', { fields: ['climate'], required_devices: ['webcam'] });
    const without = fa(STUDENT, target, [cand], TODAY).find((a) => a.kind === 'same_field')!;
    expect(without.reason).toContain('unresolved barriers for you right now (device)');
    const withG = fa(STUDENT, target, [cand], { ...TODAY, grants: [camGrant({ opportunity_id: null })] }).find((a) => a.kind === 'same_field')!;
    expect(withG.reason).toContain('realistically doable');
  });

  it('grants 不是数组时按 [] 处理，不抛错', () => {
    expect(() => fa(STUDENT, CAM_TARGET, CAT, { ...TODAY, grants: 'x' as unknown as ResourceGrant[] })).not.toThrow();
    expect(kinds(fa(STUDENT, CAM_TARGET, CAT, { ...TODAY, grants: [null, 5] as unknown as ResourceGrant[] }))).toEqual(['same_field']);
  });
});

describe('findAlternatives：年龄 / 年级「低于下限」与 analyzeGaps 同一口径', () => {
  const CAT = [opp('fictional-same', { fields: ['climate'] })];
  const T = (req: Requirement) => opp('fictional-target', { fields: ['climate'], recurring_annually: true, requirements: [req] });

  it('参考日在未来、学生到参考日会超过上限 → 不给 next_cycle，analyzeGaps 也不说以后可能满足', () => {
    const target = T({ id: 'req-age', type: 'age', min: 16, max: 16, as_of: '2029-11-17', label: 'Age 16 on Nov 17, 2029', hard: true, source_text: 'Must be 16 on Nov 17, 2029.' });
    const s = { ...STUDENT, age: 15 };
    expect(checkEligibility(s, target, TODAY).overall).toBe('not_eligible');
    expect(kinds(fa(s, target, CAT, TODAY))).toEqual(['same_field']);
    const gap = analyzeGaps(s, target, [], TODAY).items.find((i) => i.id === 'unchangeable_eligibility:req-age')!;
    expect(gap.detail).not.toContain('may be met later');
  });

  it('参考日在未来、到参考日仍低于下限 → 给 next_cycle，analyzeGaps 说以后可能满足', () => {
    const target = T({ id: 'req-age', type: 'age', min: 18, as_of: '2027-11-17', label: '18+', hard: true, source_text: 'Must be 18.' });
    const s = { ...STUDENT, age: 15 };
    expect(kinds(fa(s, target, CAT, TODAY))).toEqual(['next_cycle', 'same_field']);
    expect(analyzeGaps(s, target, [], TODAY).items.find((i) => i.id === 'unchangeable_eligibility:req-age')!.detail).toContain('as you get older');
  });

  it('grade 区间无效（max < min）→ 不给 next_cycle', () => {
    const target = T({ id: 'req-g', type: 'grade', min: 12, max: 9, label: 'Broken range', hard: true, source_text: 'Grades 12-9.' });
    expect(kinds(fa(STUDENT, target, CAT, TODAY))).toEqual(['same_field']);
  });
});

describe('findAlternatives：所有理由文字的措辞', () => {
  it('不含 prerequisite / stepping stone / required before / guarantee / score / rank（大小写不敏感）', () => {
    expect(ALL_REASONS.length).toBeGreaterThan(30);
    for (const reason of ALL_REASONS) {
      expect(reason).not.toMatch(/prerequisite|stepping[\s-]*stone|required before|guarantee|score|rank/i);
      expect(reason).not.toMatch(/\d+\s*%/);
    }
  });
});
