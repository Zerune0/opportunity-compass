/**
 * 公平性对照测试（第 3 层）
 *
 * 目的：证明学生端四个判断函数（checkEligibility / analyzeReachability / planRoutes / diffRoutes）
 * 的结果不受学校名（school_name）和显示名（display_name）影响。
 *
 * 做法：
 * 1. 正向对照：对每个（档案 × 机会）组合，只替换 school_name 或 display_name（id 等其余字段完全相同），
 *    断言四个函数结果严格相等；diffRoutes 报告「无变化」。带 today 与不带 today 各跑一遍。
 * 2. 反向对照：改一个确实应影响结果的字段（grade / devices），断言结果不相等——
 *    证明「相等」不是因为函数什么都不区分。
 * 3. 静态守卫：判断函数源码（去掉注释后）不出现 school_name / display_name 标识符或字符串。
 *
 * 所有机会都是虚构的（example.com、is_sample: true），不是真实机会。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import profilesJson from '@/data/profiles.json';
import { checkEligibility } from './eligibility';
import { analyzeReachability } from './reachability';
import { diffRoutes, planRoutes } from './path';
import type { EvalOptions, Opportunity, PrepItem, ResourceGrant, StudentProfile } from './types';

// ───────────────────────── 虚构机会 fixture（非真实机会） ─────────────────────────

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

const BASE_OPP = {
  organizer: 'Example Org（虚构）',
  summary: '仅用于公平性对照测试的虚构机会。',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  recurring_annually: true,
  is_sample: true,
} as const;

/** 情形 A：线上、免费、资格宽松，有多个准备项和依赖关系。 */
const OPP_OPEN: Opportunity = {
  ...BASE_OPP,
  id: 'fictional-open-data-camp',
  title: '虚构线上数据营（非真实机会）',
  category: 'summer_program',
  fields: ['computer_science', 'data_science'],
  official_url: 'https://example.com/fictional-open-data-camp',
  deadline: '2027-03-01',
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 3, total_weeks: 6 },
  required_devices: [],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 9, max: 12, label: '9–12 年级', hard: true, source_text: 'Open to students in grades 9-12.' },
    { id: 'req-region', type: 'region', countries: ['US'], label: '美国居民', hard: true, source_text: 'Applicants must reside in the United States.' },
  ],
  preparation: [
    prep({ id: 'prep-python', title: '学会 Python 基础', skill: 'python', estimated_hours: 10 }),
    prep({ id: 'prep-data', title: '学数据分析入门', skill: 'data_analysis', estimated_hours: 8, depends_on: ['prep-python'] }),
    prep({ id: 'prep-project', title: '做一个数据小项目', skill: 'data_project', evidence_kind: 'project', estimated_hours: 12, estimated_cost_usd: 5, depends_on: ['prep-python'], required_for_application: true }),
    prep({ id: 'prep-essay', title: '写个人陈述', estimated_hours: 4, required_for_application: true }),
    prep({ id: 'prep-letter', title: '请老师写推荐信', evidence_kind: 'recommendation_letter', estimated_hours: 1, depends_on: ['prep-essay'], required_for_application: true }),
  ],
};

/** 情形 B：有硬性要求（11–12 年级、美国公民、Python 中级），会把部分档案 blocked。 */
const OPP_HARD: Opportunity = {
  ...BASE_OPP,
  id: 'fictional-research-fellowship',
  title: '虚构研究奖学金（非真实机会）',
  category: 'fellowship',
  fields: ['computer_science', 'biology'],
  official_url: 'https://example.com/fictional-research-fellowship',
  deadline: '2027-01-15',
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 6, total_weeks: 8 },
  required_devices: ['laptop'],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 11, max: 12, label: '11–12 年级', hard: true, source_text: 'Open to high school juniors and seniors.' },
    { id: 'req-citizen', type: 'citizenship', countries: ['US'], label: '美国公民', hard: true, source_text: 'Applicants must be U.S. citizens.' },
    { id: 'req-python', type: 'prerequisite_skill', skill: 'python', min_level: 'intermediate', label: 'Python 中级', hard: true, source_text: 'Intermediate Python experience is required.' },
    { id: 'req-low-income', type: 'status', any_of: ['low_income', 'first_generation'], label: '低收入或第一代（优先）', hard: false, source_text: 'Priority is given to low-income and first-generation students.' },
    { id: 'req-interview', type: 'manual', label: '面试', hard: true, source_text: 'Finalists will be interviewed.' },
  ],
  preparation: [
    prep({ id: 'prep-proposal', title: '写研究计划', estimated_hours: 10, required_for_application: true }),
    prep({ id: 'prep-portfolio', title: '整理作品集', evidence_kind: 'portfolio', estimated_hours: 6, depends_on: ['prep-proposal'] }),
  ],
};

/** 情形 C：线下、有报名费和差旅、要求笔记本和摄像头（触发时间/费用/交通/设备障碍）。 */
const OPP_IN_PERSON: Opportunity = {
  ...BASE_OPP,
  id: 'fictional-city-hackathon',
  title: '虚构城市黑客松（非真实机会）',
  category: 'hackathon',
  fields: ['computer_science', 'public_health'],
  official_url: 'https://example.com/fictional-city-hackathon',
  deadline: '2027-02-01',
  location: { format: 'in_person', country: 'US', state: 'NY', city: 'Example Metro' },
  cost: { fee_usd: 150, requires_travel_expense: true, financial_aid_available: null },
  time_commitment: { hours_per_week: 8, total_weeks: 4 },
  required_devices: ['laptop', 'webcam'],
  requirements: [
    { id: 'req-age', type: 'age', min: 14, max: 19, label: '14–19 岁', hard: true, source_text: 'Participants must be 14-19 years old.' },
    { id: 'req-region', type: 'region', countries: ['US'], label: '美国居民', hard: true, source_text: 'Open to U.S. residents.' },
  ],
  preparation: [
    prep({ id: 'prep-team', title: '找队友并分工', estimated_hours: 2 }),
    prep({ id: 'prep-prototype', title: '做一个原型', evidence_kind: 'project', skill: 'web_dev', estimated_hours: 15, estimated_cost_usd: 20, depends_on: ['prep-team'] }),
  ],
};

const OPPS: Opportunity[] = [OPP_OPEN, OPP_HARD, OPP_IN_PERSON];

// ───────────────────────── 档案：3 个示例 + 3 个手写 ─────────────────────────

const SAMPLE_PROFILES = profilesJson as unknown as StudentProfile[];

/** 手写：信息完整、有作品证据（证据覆盖部分准备项）。 */
const WITH_EVIDENCE: StudentProfile = {
  id: 'fair-with-evidence',
  is_sample: true,
  display_name: '示例学生（有证据）',
  grade: 12,
  age: 17,
  region: { country: 'US', state: 'TX', locality: 'rural' },
  citizenships: ['US'],
  statuses: ['high_school_student', 'low_income'],
  school_name: 'Example Creek School（虚构）',
  hours_per_week_available: 8,
  budget_usd: 50,
  transport: { level: 'limited', max_one_way_minutes: 30, note: null },
  devices: ['laptop', 'home_internet'],
  skills: [
    { name: 'python', level: 'intermediate' },
    { name: 'data_analysis', level: 'beginner' },
  ],
  evidence: [
    { id: 'ev-proj', title: '数据小项目（示例）', kind: 'project', skills: ['data_project', 'python'], status: 'evidence_attached', url: 'https://example.com/ev-proj', added_on: '2026-11-10' },
    { id: 'ev-portfolio', title: '作品集页面（示例）', kind: 'portfolio', skills: [], status: 'reviewed', added_on: '2026-11-12' },
  ],
  interests: ['data_science'],
};

/** 手写：几乎什么都没填（大量 unknown）。 */
const SPARSE: StudentProfile = {
  id: 'fair-sparse',
  is_sample: true,
  display_name: '示例学生（信息很少）',
  evidence: [],
};

/** 手写：部分填写（有年级、没地区、没设备信息）。 */
const PARTIAL: StudentProfile = {
  id: 'fair-partial',
  is_sample: true,
  display_name: '示例学生（部分填写）',
  grade: 11,
  school_name: 'Example Middle River High（虚构）',
  hours_per_week_available: 2,
  budget_usd: 0,
  skills: [{ name: 'python', level: 'beginner' }],
  evidence: [],
};

const PROFILES: StudentProfile[] = [...SAMPLE_PROFILES, WITH_EVIDENCE, SPARSE, PARTIAL];

// ───────────────────────── 对照档案构造 ─────────────────────────

/** 替换 school_name；`undefined` 表示把该键整个删掉（「不填」）。其余字段（含 id）不变。 */
function withSchool(p: StudentProfile, school: string | null | undefined): StudentProfile {
  const { school_name: _drop, ...rest } = p;
  void _drop;
  return school === undefined ? rest : { ...rest, school_name: school };
}

function withDisplayName(p: StudentProfile, name: string): StudentProfile {
  return { ...p, display_name: name };
}

const SCHOOL_VARIANTS: { label: string; value: string | null | undefined }[] = [
  { label: '虚构名校', value: 'Example Elite Preparatory Academy of Prestige（虚构名校）' },
  { label: '虚构乡镇学校', value: 'Example Rural County Consolidated School（虚构乡镇学校）' },
  { label: 'null', value: null },
  { label: '不填', value: undefined },
];

const NAME_VARIANTS = ['Alexander Whitmore-Example（虚构）', '示例学生 小芳（虚构）', ''];

/** 每个组合的 grants：四类资助都给（属于该学生 × 该机会，id 与对照档案相同）。 */
function grantsFor(p: StudentProfile, opp: Opportunity): ResourceGrant[] {
  const base = { student_id: p.id, opportunity_id: opp.id, status: 'approved' as const, provider: 'Example Org（虚构）', is_sample: true };
  return [
    { ...base, id: `g-device-${p.id}-${opp.id}`, type: 'device', device: 'laptop' },
    { ...base, id: `g-webcam-${p.id}-${opp.id}`, type: 'device', device: 'webcam' },
    { ...base, id: `g-transport-${p.id}-${opp.id}`, type: 'transport_subsidy', amount_usd: 200 },
    { ...base, id: `g-fee-${p.id}-${opp.id}`, type: 'fee_waiver', amount_usd: 150 },
    { ...base, id: `g-time-${p.id}-${opp.id}`, type: 'time_support', hours_per_week: 4 },
  ];
}

/** 跑全部学生端函数，返回可直接比较的结果。 */
function runAll(p: StudentProfile, opp: Opportunity, options: EvalOptions | undefined) {
  return {
    eligibility: checkEligibility(p, opp, options),
    reachability: analyzeReachability(p, opp, [], options),
    reachabilityWithGrants: analyzeReachability(p, opp, grantsFor(p, opp), options),
    plan: planRoutes(p, opp, options),
  };
}

function expectSameResults(a: StudentProfile, b: StudentProfile, opp: Opportunity, options: EvalOptions | undefined) {
  const ra = runAll(a, opp, options);
  const rb = runAll(b, opp, options);
  expect(rb.eligibility, 'checkEligibility').toStrictEqual(ra.eligibility);
  expect(rb.reachability, 'analyzeReachability（无 grants）').toStrictEqual(ra.reachability);
  expect(rb.reachabilityWithGrants, 'analyzeReachability（有 grants）').toStrictEqual(ra.reachabilityWithGrants);
  expect(rb.plan, 'planRoutes').toStrictEqual(ra.plan);

  const diff = diffRoutes(ra.plan, rb.plan);
  expect(diff.status_change, 'diffRoutes.status_change').toBeNull();
  for (const rc of diff.route_changes) {
    expect(rc.change, `diffRoutes ${rc.route_type}`).toBe('unchanged');
  }
}

const OPTION_SETS: { label: string; options: EvalOptions | undefined }[] = [
  { label: 'today=2026-11-17', options: { today: '2026-11-17' } },
  { label: '不传 today', options: undefined },
];

const COMBOS = PROFILES.flatMap((p) => OPPS.map((opp) => ({ p, opp, name: `${p.id} × ${opp.id}` })));

// ───────────────────────── 1. 只改学校名 ─────────────────────────

describe.each(OPTION_SETS)('公平性：只改 school_name，结果不变（$label）', ({ options }) => {
  const [reference, ...others] = SCHOOL_VARIANTS;
  const cases = COMBOS.flatMap((c) => others.map((v) => ({ ...c, variant: v })));

  it.each(cases)('$name：「虚构名校」vs「$variant.label」四个函数结果相同', ({ p, opp, variant }) => {
    expectSameResults(withSchool(p, reference.value), withSchool(p, variant.value), opp, options);
  });

  it.each(COMBOS)('$name：原始档案 vs 删掉 school_name 结果相同', ({ p, opp }) => {
    expectSameResults(p, withSchool(p, undefined), opp, options);
  });
});

// ───────────────────────── 2. 只改显示名 ─────────────────────────

describe.each(OPTION_SETS)('公平性：只改 display_name，结果不变（$label）', ({ options }) => {
  const cases = COMBOS.flatMap((c) => NAME_VARIANTS.map((n) => ({ ...c, newName: n })));

  it.each(cases)('$name：显示名换成「$newName」四个函数结果相同', ({ p, opp, newName }) => {
    expectSameResults(p, withDisplayName(p, newName), opp, options);
  });
});

// ───────────────────────── 3. 反向对照：改有意义的字段，结果必须不同 ─────────────────────────

describe('反向对照：改确实应影响结果的字段，结果应当不同（证明对照测试有效）', () => {
  const TODAY: EvalOptions = { today: '2026-11-17' };
  const ana = SAMPLE_PROFILES.find((p) => p.id === 'sample-ana')!;

  it('示例档案里有 sample-ana', () => {
    expect(ana).toBeDefined();
  });

  it('grade 12 → 8：checkEligibility 结果不同（OPP_OPEN 年级要求不再满足）', () => {
    const a = checkEligibility(ana, OPP_OPEN, TODAY);
    const b = checkEligibility({ ...ana, grade: 8 }, OPP_OPEN, TODAY);
    expect(b).not.toEqual(a);
    expect(a.overall).toBe('eligible');
    expect(b.overall).toBe('not_eligible');
  });

  it('grade 12 → 8：planRoutes 从 routes 变 blocked，diffRoutes 报告 status_change', () => {
    const before = planRoutes(ana, OPP_OPEN, TODAY);
    const after = planRoutes({ ...ana, grade: 8 }, OPP_OPEN, TODAY);
    expect(after).not.toEqual(before);
    expect(before.status).toBe('routes');
    expect(after.status).toBe('blocked');
    const diff = diffRoutes(before, after);
    expect(diff.status_change).toEqual({ from: 'routes', to: 'blocked' });
  });

  it('去掉 devices：analyzeReachability（OPP_IN_PERSON 要求笔记本和摄像头）结果不同', () => {
    const a = analyzeReachability(ana, OPP_IN_PERSON, [], TODAY);
    const b = analyzeReachability({ ...ana, devices: [] }, OPP_IN_PERSON, [], TODAY);
    expect(b).not.toEqual(a);
    expect(a.barriers.some((x) => x.type === 'device' && !x.resolved)).toBe(false);
    expect(b.barriers.some((x) => x.type === 'device' && !x.resolved)).toBe(true);
  });

  it('去掉 devices 后再给 grants：带 grants 与不带 grants 的结果不同', () => {
    const p = { ...ana, devices: [] };
    const a = analyzeReachability(p, OPP_IN_PERSON, [], TODAY);
    const b = analyzeReachability(p, OPP_IN_PERSON, grantsFor(p, OPP_IN_PERSON), TODAY);
    expect(b).not.toEqual(a);
  });

  it('加一条覆盖准备项的作品证据：planRoutes 结果不同，diffRoutes 报告有路线变化', () => {
    const before = planRoutes(ana, OPP_OPEN, TODAY);
    const withEv: StudentProfile = {
      ...ana,
      evidence: [{ id: 'ev-new', title: '数据小项目（示例）', kind: 'project', skills: ['data_project'], status: 'evidence_attached', added_on: '2026-11-17' }],
    };
    const after = planRoutes(withEv, OPP_OPEN, TODAY);
    expect(after).not.toEqual(before);
    const diff = diffRoutes(before, after);
    expect(diff.route_changes.some((rc) => rc.change !== 'unchanged')).toBe(true);
  });

  it('同一份档案对不同机会给出不同结果（OPP_HARD 会把 sample-leo blocked，OPP_OPEN 不会）', () => {
    const leo = SAMPLE_PROFILES.find((p) => p.id === 'sample-leo')!;
    expect(planRoutes(leo, OPP_HARD, TODAY).status).toBe('blocked');
    expect(planRoutes(leo, OPP_OPEN, TODAY).status).toBe('routes');
  });
});

// ───────────────────────── 4. 静态守卫：判断函数源码不读学校名 / 显示名 ─────────────────────────

const REPO_ROOT = resolve(__dirname, '..');
const ENGINE_DIRS = ['lib/eligibility', 'lib/reachability', 'lib/path'];
const FORBIDDEN = ['school_name', 'display_name'];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * 用 TypeScript 解析源码，找出代码里（不含注释）出现的禁用名字：
 * 标识符（profile.school_name、{ school_name }）以及字符串 / 模板字面量（profile['school_name']）。
 * 注释中的说明文字（如「不读取 school_name」）不算违规。
 */
function forbiddenUsages(fileName: string, source: string): string[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const hits: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | null = null;
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) text = node.text;
    else if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) text = node.text;
    if (text !== null) {
      for (const name of FORBIDDEN) {
        if (text.includes(name)) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          hits.push(`${fileName}:${line + 1} ${name}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe('静态守卫：判断函数源码不使用 school_name / display_name', () => {
  const files = ENGINE_DIRS.flatMap((d) => listSourceFiles(join(REPO_ROOT, d)));

  it('能找到三个引擎目录下的源文件', () => {
    for (const d of ENGINE_DIRS) {
      expect(files.some((f) => f.startsWith(join(REPO_ROOT, d))), d).toBe(true);
    }
  });

  it('守卫本身有效：能抓到代码中的用法，不误报注释', () => {
    expect(forbiddenUsages('x.ts', 'const s = profile.school_name;')).toHaveLength(1);
    expect(forbiddenUsages('x.ts', "const s = profile['display_name'];")).toHaveLength(1);
    expect(forbiddenUsages('x.ts', 'const { display_name } = p;')).toHaveLength(1);
    expect(forbiddenUsages('x.ts', '// 不读取 school_name\n/* display_name */ const a = 1;')).toEqual([]);
  });

  it.each(files.map((f) => ({ f, rel: f.slice(REPO_ROOT.length + 1) })))('$rel 不出现 school_name / display_name', ({ f, rel }) => {
    expect(forbiddenUsages(rel, readFileSync(f, 'utf8'))).toEqual([]);
  });
});
