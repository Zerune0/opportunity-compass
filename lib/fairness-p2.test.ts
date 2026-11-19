/**
 * 第二阶段公平性对照测试：四个新函数（analyzeGaps / explainMatch / findAlternatives / planAcrossOpportunities）
 * 的结果不受学校名（school_name）与显示名（display_name）影响。
 *
 * 做法：对每份档案（data/profiles.json 全部示例 + 手写档案），只替换 school_name 或 display_name（id 等其余字段不变），
 * 断言四个函数结果严格相等（toStrictEqual）。带 today 与不带 today 各跑一遍；
 * 带 grants（explainMatch / findAlternatives / analyzeGaps）与带 materials（planAcrossOpportunities）的调用也在对照之内。
 * 另有反向对照：改 grade 这种确实应影响结果的字段，结果必须不同，证明对照有效。
 * 静态守卫（源码不出现这两个名字）在 lib/fairness.test.ts 的 ENGINE_DIRS 中，已包含 lib/gap、lib/match、lib/planner。
 *
 * 机会：data/opportunities.json 的真实机会 + 本文件内的虚构机会（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { analyzeGaps } from './gap';
import { explainMatch, findAlternatives } from './match';
import { planAcrossOpportunities } from './planner';
import type { CrossPlanOptions, Material, Opportunity, PrepItem, ResourceGrant, StudentProfile } from './types';

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 3, estimated_cost_usd: 0, depends_on: [], required_for_application: true, ...p };
}

const FICTIONAL: Opportunity[] = [
  {
    id: 'fictional-fair-camp',
    title: 'Fictional Fair Data Camp (sample, not real)',
    organizer: 'Example Org (fictional)',
    category: 'summer_program',
    fields: ['data_science', 'climate', 'stem'],
    summary: 'Fictional opportunity for fairness tests.',
    official_url: 'https://example.com/fictional-fair-camp',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: '2027-01-10',
    recurring_annually: true,
    location: { format: 'in_person', country: 'US' },
    cost: { fee_usd: 25, requires_travel_expense: false },
    time_commitment: { hours_per_week: 6, total_weeks: 4 },
    required_devices: ['laptop'],
    requirements: [
      { id: 'req-grade', type: 'grade', min: 9, max: 13, label: 'Grades 9–13', hard: true, source_text: 'Grades 9-13.' },
      { id: 'req-pf', type: 'portfolio', label: 'Portfolio', hard: false, source_text: 'Portfolio is a plus.' },
    ],
    preparation: [
      prep({ id: 'prep-python', title: 'Learn Python basics', skill: 'python', required_for_application: false, estimated_hours: 8 }),
      prep({ id: 'prep-resume', title: 'Write a resume', material_kind: 'resume', reusable_across_opportunities: true }),
    ],
    is_sample: true,
  },
  {
    id: 'fictional-fair-lab',
    title: 'Fictional Fair Lab (sample, not real)',
    organizer: 'Example Org (fictional)',
    category: 'research',
    fields: ['data_science', 'biology'],
    summary: 'Fictional opportunity for fairness tests.',
    official_url: 'https://example.com/fictional-fair-lab',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: '2026-12-20',
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 3, total_weeks: 8 },
    required_devices: [],
    requirements: [{ id: 'req-cit', type: 'citizenship', countries: ['US'], label: 'U.S. citizen', hard: true, source_text: 'U.S. citizens only.' }],
    preparation: [prep({ id: 'prep-resume', title: 'Write a resume', material_kind: 'resume', reusable_across_opportunities: true })],
    is_sample: true,
  },
];

const OPPS: Opportunity[] = [...(opportunitiesJson as unknown as Opportunity[]), ...FICTIONAL];

const SPARSE: StudentProfile = { id: 'fair2-sparse', is_sample: true, display_name: 'Sample student (sparse)', evidence: [] };
const PROFILES: StudentProfile[] = [...(profilesJson as unknown as StudentProfile[]), SPARSE];

function grantsFor(p: StudentProfile): ResourceGrant[] {
  return [
    { id: `g-laptop-${p.id}`, student_id: p.id, opportunity_id: null, type: 'device', device: 'laptop', status: 'approved', provider: 'Example Org (fictional)', is_sample: true },
    { id: `g-transport-${p.id}`, student_id: p.id, opportunity_id: 'fictional-fair-camp', type: 'transport_subsidy', amount_usd: 30, status: 'pending', provider: 'Example Org (fictional)', is_sample: true },
  ];
}

/** 学生已存的材料：一份就绪的通用简历（会抵消可复用的简历准备项）+ 一份未完成的针对性陈述（不抵消）。 */
function materialsFor(p: StudentProfile): Material[] {
  return [
    { id: `m-resume-${p.id}`, profile_id: p.id, kind: 'resume', title: 'Resume (sample)', reusable: true, opportunity_id: null, estimated_hours: 3, status: 'ready' },
    { id: `m-statement-${p.id}`, profile_id: p.id, kind: 'personal_statement', title: 'Statement draft (sample)', reusable: false, opportunity_id: 'fictional-fair-camp', estimated_hours: 4, status: 'in_progress' },
  ];
}

function runAll(p: StudentProfile, options: CrossPlanOptions | undefined) {
  return {
    matchWithGrants: OPPS.map((o) => explainMatch(p, o, { ...options, grants: grantsFor(p) })),
    alternativesWithGrants: OPPS.map((o) => findAlternatives(p, o, OPPS, { ...options, grants: grantsFor(p) })),
    planWithMaterials: planAcrossOpportunities(p, OPPS, { ...options, materials: materialsFor(p) }),
    gaps: OPPS.map((o) => analyzeGaps(p, o, grantsFor(p), options)),
    gapsNoGrants: OPPS.map((o) => analyzeGaps(p, o, [], options)),
    match: OPPS.map((o) => explainMatch(p, o, options)),
    alternatives: OPPS.map((o) => findAlternatives(p, o, OPPS, options)),
    plan: planAcrossOpportunities(p, OPPS, options),
    planWithPriorities: planAcrossOpportunities(p, OPPS, { ...options, priorities: ['fictional-fair-lab', 'fictional-fair-camp'] }),
  };
}

function withSchool(p: StudentProfile, school: string | null | undefined): StudentProfile {
  const { school_name: _drop, ...rest } = p;
  void _drop;
  return school === undefined ? rest : { ...rest, school_name: school };
}

const OPTION_SETS: { label: string; options: CrossPlanOptions | undefined }[] = [
  { label: 'today=2026-11-18', options: { today: '2026-11-18' } },
  { label: '不传 today', options: undefined },
];

const SCHOOLS: (string | null | undefined)[] = [
  'Example Elite Preparatory Academy of Prestige (fictional)',
  'Example Rural County Consolidated School (fictional)',
  null,
  undefined,
];
const NAMES = ['Alexander Whitmore-Example (fictional)', 'Sample student Mei (fictional)', ''];

describe.each(OPTION_SETS)('第二阶段公平性：只改学校名 / 显示名，四个新函数结果完全一致（$label）', ({ options }) => {
  it.each(PROFILES.map((p) => ({ p, id: p.id })))('$id：只改 school_name', ({ p }) => {
    const ref = runAll(withSchool(p, SCHOOLS[0]), options);
    for (const s of SCHOOLS.slice(1)) expect(runAll(withSchool(p, s), options)).toStrictEqual(ref);
  });

  it.each(PROFILES.map((p) => ({ p, id: p.id })))('$id：只改 display_name', ({ p }) => {
    const ref = runAll(p, options);
    for (const n of NAMES) expect(runAll({ ...p, display_name: n }, options)).toStrictEqual(ref);
  });
});

describe('反向对照：改 grade，结果应当不同（证明对照有效）', () => {
  it('sample-noor grade 13 → 8：四个函数里至少 analyzeGaps 与 planAcrossOpportunities 的结果不同', () => {
    const noor = PROFILES.find((p) => p.id === 'sample-noor')!;
    const opts = { today: '2026-11-18' };
    const a = runAll(noor, opts);
    const b = runAll({ ...noor, grade: 8 }, opts);
    expect(b.gaps).not.toStrictEqual(a.gaps);
    expect(b.plan).not.toStrictEqual(a.plan);
    expect(b.match).not.toStrictEqual(a.match);
  });

  it('对照里用的 grants 与 materials 确实起作用（否则带它们的对照等于没测）', () => {
    const maya = PROFILES.find((p) => p.id === 'sample-maya')!;
    const opts = { today: '2026-11-18' };
    const a = runAll(maya, opts);
    expect(a.planWithMaterials).not.toStrictEqual(a.plan);
    const camp = OPPS.find((o) => o.id === 'fictional-fair-camp')!;
    const noLaptop = { ...maya, devices: [] };
    expect(explainMatch(noLaptop, camp, { ...opts, grants: grantsFor(noLaptop) })).not.toStrictEqual(explainMatch(noLaptop, camp, opts));
  });
});
