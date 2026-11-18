/**
 * explainMatch / findAlternatives（第二阶段示例版本）测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { checkEligibility } from '../eligibility';
import { explainMatch, findAlternatives } from '.';
import { MATCH_REASON_KINDS, type Opportunity, type StudentProfile } from '../types';

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

  it('形状：三条理由（interest / eligibility / reachability），按 MATCH_REASON_KINDS 顺序', () => {
    expect(m.profile_id).toBe(STUDENT.id);
    expect(m.opportunity_id).toBe(TARGET.id);
    expect(m.reasons.map((r) => r.kind)).toEqual(['interest', 'eligibility', 'reachability']);
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

describe('findAlternatives', () => {
  const alts = findAlternatives(STUDENT, TARGET, CATALOG, TODAY);

  it('next_cycle 仅当 recurring_annually === true，指向原机会、eligibility 为 null', () => {
    expect(alts[0]).toMatchObject({ kind: 'next_cycle', opportunity_id: TARGET.id, eligibility_overall: null, shared_fields: TARGET.fields });
    for (const v of [false, null, undefined]) {
      const r = findAlternatives(STUDENT, { ...TARGET, recurring_annually: v }, CATALOG, TODAY);
      expect(r.some((a) => a.kind === 'next_cycle')).toBe(false);
    }
  });

  it('same_field：有交集、不是自身、非 not_eligible，按 id 排序，最多 3 条', () => {
    const same = alts.filter((a) => a.kind === 'same_field');
    expect(same.map((a) => a.opportunity_id)).toEqual(['fictional-a-eligible', 'fictional-b-eligible', 'fictional-c-unknown']);
    expect(same.find((a) => a.opportunity_id === 'fictional-c-unknown')?.eligibility_overall).toBe('unknown');
    expect(same.find((a) => a.opportunity_id === 'fictional-a-eligible')?.shared_fields).toEqual(['data_science']);
  });

  it('如实：不返回该学生 not_eligible 的机会', () => {
    const all = findAlternatives(STUDENT, TARGET, [NOT_ELIGIBLE], TODAY);
    expect(all.filter((a) => a.kind === 'same_field')).toEqual([]);
    for (const a of findAlternatives(STUDENT, TARGET, CATALOG, TODAY)) {
      if (a.kind !== 'same_field') continue;
      const o = CATALOG.find((x) => x.id === a.opportunity_id)!;
      expect(checkEligibility(STUDENT, o, TODAY).overall).not.toBe('not_eligible');
    }
  });

  it('用户发布的示例机会在理由里注明未经官网核实', () => {
    const r = findAlternatives(STUDENT, TARGET, [POSTED], TODAY);
    expect(r.find((a) => a.opportunity_id === POSTED.id)?.reason).toContain('not verified on an official site');
  });

  it('确定性、不修改输入（含目录顺序）', () => {
    const catalog = structuredClone(CATALOG);
    const reversed = [...catalog].reverse();
    expect(findAlternatives(STUDENT, TARGET, catalog, TODAY)).toEqual(findAlternatives(STUDENT, TARGET, reversed, TODAY));
    expect(catalog).toEqual(CATALOG);
  });

  it('空目录、坏目录、缺字段档案都不抛错', () => {
    expect(findAlternatives(STUDENT, { ...TARGET, recurring_annually: false }, [], TODAY)).toEqual([]);
    expect(() => findAlternatives(STUDENT, TARGET, [null, { id: 'bad', fields: ['climate'] }] as unknown as Opportunity[], TODAY)).not.toThrow();
    expect(() => findAlternatives({ id: 'x' } as unknown as StudentProfile, TARGET, CATALOG)).not.toThrow();
    expect(() => findAlternatives(STUDENT, TARGET, null as unknown as Opportunity[])).not.toThrow();
  });
});

describe('示例档案 × 真实机会', () => {
  it('explainMatch / findAlternatives 全部不抛错', () => {
    const opps = opportunitiesJson as unknown as Opportunity[];
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const o of opps) {
        for (const opts of [TODAY, undefined]) {
          const m = explainMatch(p, o, opts);
          expect(m.reasons).toHaveLength(3);
          for (const a of findAlternatives(p, o, opps, opts)) {
            if (a.kind === 'same_field') expect(a.eligibility_overall).not.toBe('not_eligible');
          }
        }
      }
    }
  });
});
