/**
 * 第四阶段第 1 层公平性对照：只改 school_name / display_name，下列结果完全相同（toStrictEqual）：
 * - 带 options.catalog 的 planRoutes（含 competition 路线与三个步骤说明字段）；
 * - findAlternatives 的 stepping_stone / remote_option；
 * - 共用筛选 findEvidenceBuildingCandidates；
 * - analyzeGaps 的组队要求条目。
 * 先断言虚构场景里新结果确实出现（否则对照等于没测），再做对照；另有反向对照（改 grade 结果不同）。
 * 机会与学生都是本文件内的虚构数据（example.com、is_sample: true），外加 data/ 的真实目录与示例档案。
 */
import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from './data';
import { analyzeGaps } from './gap';
import { findAlternatives } from './match';
import { findEvidenceBuildingCandidates } from './match/evidence-building';
import { planRoutes } from './path';
import type { Opportunity, PrepItem, StudentProfile } from './types';

const TODAY = '2026-11-19';

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 2, estimated_cost_usd: 0, depends_on: [], required_for_application: false, ...p };
}

const STUDENT: StudentProfile = {
  id: 'fair-p4-student',
  is_sample: true,
  display_name: 'Fair Student (fictional)',
  grade: 10,
  age: 15,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  school_name: 'Fictional High School',
  hours_per_week_available: 8,
  budget_usd: 50,
  transport: { level: 'none' },
  devices: ['laptop'],
  skills: [],
  evidence: [],
  interests: ['software_development'],
};

const BASE_OPP: Omit<Opportunity, 'id' | 'title' | 'official_url' | 'category' | 'location'> = {
  organizer: 'Example Org (fictional)',
  fields: ['software_development'],
  summary: 'Fictional opportunity for fairness tests.',
  verified_on: '2026-11-18',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  recurring_annually: true,
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 4, total_weeks: 4 },
  required_devices: [],
  requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12.' }],
  preparation: [],
  is_sample: true,
};

/** hybrid 目标：缺作品（偏好）、有未覆盖的实践项、交通受阻、组队要求未知。 */
const TARGET: Opportunity = {
  ...BASE_OPP,
  id: 'fair-p4-target',
  title: 'Fictional Fair Studio (sample, not real)',
  official_url: 'https://example.com/fair-p4-target',
  category: 'summer_program',
  location: { format: 'hybrid', country: 'US', state: 'CA' },
  requirements: [...BASE_OPP.requirements, { id: 'req-pf', type: 'portfolio', label: 'A project', hard: false, source_text: 'A project is a plus.' }],
  preparation: [
    prep({ id: 'prep-learn', title: 'Learn the basics', skill: 'javascript' }),
    prep({ id: 'prep-build', title: 'Build something', evidence_kind: 'project', depends_on: ['prep-learn'] }),
    prep({ id: 'prep-essay', title: 'Essay', material_kind: 'essay', required_for_application: true, source_text: 'Submit an essay.' }),
  ],
  team_requirement: { required: null, source_text: null },
};

const HACK: Opportunity = {
  ...BASE_OPP,
  id: 'fair-p4-hack',
  title: 'Fictional Fair Hack (sample, not real)',
  official_url: 'https://example.com/fair-p4-hack',
  category: 'hackathon',
  deadline: '2026-12-01',
  location: { format: 'online' },
  time_commitment: { hours_per_week: null, total_weeks: 1, start_date: '2026-12-05', end_date: '2026-12-06' },
};

const ONLINE_CLUB: Opportunity = {
  ...BASE_OPP,
  id: 'fair-p4-club',
  title: 'Fictional Fair Online Club (sample, not real)',
  official_url: 'https://example.com/fair-p4-club',
  category: 'other',
  location: { format: 'online' },
};

const TEAM_TARGET: Opportunity = { ...TARGET, id: 'fair-p4-team', team_requirement: { required: true, min_size: 2, max_size: 3, source_text: 'Teams of 2-3.' } };

const FICTIONAL = [TARGET, HACK, ONLINE_CLUB, TEAM_TARGET];
const CATALOG = [...catalogOpportunities(), ...FICTIONAL];

function variants(p: StudentProfile): StudentProfile[] {
  return [
    { ...p, school_name: 'A Very Different Academy' },
    { ...p, school_name: null },
    { ...p, display_name: 'Someone Else Entirely' },
    { ...p, school_name: 'Another School', display_name: 'Another Name' },
  ];
}

function allResults(p: StudentProfile) {
  return CATALOG.map((o) => ({
    plan: planRoutes(p, o, { today: TODAY, catalog: CATALOG }),
    alts: findAlternatives(p, o, CATALOG, { today: TODAY }),
    stones: findEvidenceBuildingCandidates(p, o, CATALOG, { today: TODAY }),
    gaps: analyzeGaps(p, o, [], { today: TODAY }),
  }));
}

describe('第四阶段公平性：只改学校名 / 显示名，新功能的结果完全一致', () => {
  it('虚构场景里新结果确实出现（对照有效的前提）', () => {
    const plan = planRoutes(STUDENT, TARGET, { today: TODAY, catalog: CATALOG });
    expect(plan.status === 'routes' && plan.routes.some((r) => r.type === 'competition')).toBe(true);
    const kinds = findAlternatives(STUDENT, TARGET, CATALOG, { today: TODAY }).map((a) => a.kind);
    expect(kinds).toContain('remote_option');
    const pricey = { ...TARGET, cost: { fee_usd: 500, requires_travel_expense: false } };
    expect(findAlternatives(STUDENT, pricey, CATALOG, { today: TODAY }).map((a) => a.kind)).toContain('stepping_stone');
    expect(analyzeGaps(STUDENT, TEAM_TARGET, [], { today: TODAY }).items.some((i) => i.id === 'materials:team_requirement')).toBe(true);
  });

  it.each([STUDENT, ...sampleProfiles()].map((p) => [p.id, p] as const))('%s', (_id, p) => {
    const base = allResults(p);
    for (const v of variants(p)) expect(allResults(v)).toStrictEqual(base);
  });

  it('费用受阻时的 stepping_stone 也不受影响', () => {
    const pricey = { ...TARGET, cost: { fee_usd: 500, requires_travel_expense: false } };
    const base = findAlternatives(STUDENT, pricey, CATALOG, { today: TODAY });
    for (const v of variants(STUDENT)) expect(findAlternatives(v, pricey, CATALOG, { today: TODAY })).toStrictEqual(base);
  });
});

describe('反向对照：改 grade，结果应当不同（证明对照有效）', () => {
  it('grade 10 → 13：目标变为 blocked，competition 与新建议都消失', () => {
    const older = { ...STUDENT, grade: 13 };
    expect(planRoutes(older, TARGET, { today: TODAY, catalog: CATALOG }).status).toBe('blocked');
    expect(allResults(older)).not.toStrictEqual(allResults(STUDENT));
  });
});
