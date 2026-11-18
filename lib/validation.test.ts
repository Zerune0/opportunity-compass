/**
 * lib/validation 的测试：现有数据全部合格；每类错误都能报出；data/opportunities.json 存在时自动校验。
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import profilesJson from '../data/profiles.json';
import deviceLoanJson from '../data/scenarios/device-loan.json';
import { opportunityWarnings, validateOpportunities, validateOpportunity, validateProfile } from './validation';

// ───────────────────────────── 虚构 fixture（example.com、is_sample） ─────────────────────────────

function goodOpp(): Record<string, unknown> {
  return {
    id: 'sample-validation-event',
    title: '【示例】校验用虚构活动',
    organizer: '示例主办方',
    category: 'project',
    fields: ['computer_science'],
    summary: '虚构机会，仅用于测试校验器。',
    official_url: 'https://example.com/sample-validation-event',
    verified_on: '2026-11-17',
    verified_by: '示例（虚构）',
    deadline: '2026-12-15',
    recurring_annually: true,
    location: { format: 'in_person', country: 'US', state: 'CA', city: 'Example City' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 4, total_weeks: 1, start_date: '2027-01-09', end_date: '2027-01-09' },
    required_devices: ['laptop'],
    requirements: [
      { id: 'req-grade', type: 'grade', min: 9, max: 12, hard: true, label: '9–12 年级', source_text: 'Grades 9–12.' },
      { id: 'req-region', type: 'region', countries: ['US'], states: ['CA'], hard: true, label: '加州', source_text: 'CA only.' },
      { id: 'req-cit', type: 'citizenship', countries: ['US'], hard: false, label: '美国', source_text: 'US.' },
      { id: 'req-status', type: 'status', any_of: ['high_school_student'], hard: true, label: '高中生', source_text: 'HS.' },
      { id: 'req-age', type: 'age', min: 13, max: 18, hard: false, label: '13–18 岁', source_text: 'Ages 13–18.' },
      { id: 'req-skill', type: 'prerequisite_skill', skill: 'python', min_level: 'beginner', hard: false, label: 'Python', source_text: 'Python.' },
      { id: 'req-port', type: 'portfolio', evidence_kind: 'project', hard: false, label: '作品', source_text: 'Project.' },
      { id: 'req-manual', type: 'manual', hard: true, label: '推荐信', source_text: 'Recommendation.' },
    ],
    preparation: [
      { id: 'prep-a', title: 'A', skill: 'python', evidence_kind: 'course', estimated_hours: 5, estimated_cost_usd: 0, depends_on: [], required_for_application: false },
      { id: 'prep-b', title: 'B', estimated_hours: 3, estimated_cost_usd: 0, depends_on: ['prep-a'], required_for_application: true },
    ],
    is_sample: true,
  };
}

function goodProfile(): Record<string, unknown> {
  return {
    id: 'sample-validation-student',
    is_sample: true,
    display_name: '示例学生（校验用）',
    grade: 10,
    age: 15,
    region: { country: 'US', state: 'CA', locality: 'urban' },
    citizenships: ['US'],
    statuses: ['high_school_student'],
    hours_per_week_available: 5,
    budget_usd: 10,
    transport: { level: 'reliable', max_one_way_minutes: 30 },
    devices: ['smartphone'],
    skills: [{ name: 'python', level: 'beginner' }],
    evidence: [
      { id: 'ev-1', title: '示例作品', kind: 'project', skills: ['python'], status: 'self_reported', url: 'https://example.com/x', added_on: '2026-11-01' },
    ],
    interests: ['computer_science'],
  };
}

type Mut = (o: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

function mutated(base: () => Record<string, unknown>, fn: Mut): Record<string, unknown> {
  const o = base();
  fn(o);
  return o;
}

const req = (o: Record<string, any>, id: string) => o.requirements.find((r: { id: string }) => r.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any
const prep = (o: Record<string, any>, id: string) => o.preparation.find((p: { id: string }) => p.id === id); // eslint-disable-line @typescript-eslint/no-explicit-any

// ───────────────────────────── 现有数据 ─────────────────────────────

describe('现有数据全部合格', () => {
  it('fixture 本身合格', () => {
    expect(validateOpportunity(goodOpp())).toEqual([]);
    expect(validateProfile(goodProfile())).toEqual([]);
  });

  it('data/profiles.json 的 4 个示例档案全部合格', () => {
    expect(profilesJson).toHaveLength(4);
    for (const p of profilesJson) expect(validateProfile(p), JSON.stringify(validateProfile(p))).toEqual([]);
  });

  it('data/scenarios/device-loan.json 的机会和 10 名学生全部合格', () => {
    expect(validateOpportunities(deviceLoanJson.opportunities)).toEqual([]);
    expect(deviceLoanJson.students).toHaveLength(10);
    for (const s of deviceLoanJson.students) expect(validateProfile(s)).toEqual([]);
  });
});

// ───────────────────────────── 机会：每类错误 ─────────────────────────────

const OPP_CASES: [string, Mut, RegExp][] = [
  ['缺 id', (o) => delete o.id, /id: expected a non-empty string/],
  ['id 不是 kebab-case', (o) => (o.id = 'Sample_Event'), /id: expected kebab-case/],
  ['title 为空', (o) => (o.title = ''), /title: expected a non-empty string/],
  ['organizer 缺失', (o) => delete o.organizer, /organizer: expected a non-empty string/],
  ['category 不在枚举内', (o) => (o.category = 'bootcamp'), /category: expected one of.*got "bootcamp"/],
  ['fields 不是数组', (o) => (o.fields = 'cs'), /fields: expected an array of strings/],
  ['fields 含非字符串', (o) => (o.fields = ['cs', 3]), /fields\[1\]: expected a non-empty string/],
  ['official_url 不是 http(s)', (o) => (o.official_url = 'ftp://example.com/x'), /official_url: expected the organizer's official link, starting with http\(s\)/],
  ['official_url 不是链接', (o) => (o.official_url = 'example.com'), /official_url: expected the organizer's official link, starting with http\(s\)/],
  ['verified_on 日期不存在', (o) => (o.verified_on = '2026-02-30'), /verified_on: expected a valid date/],
  ['verified_on 格式不对', (o) => (o.verified_on = '11/17/2026'), /verified_on: expected a valid date/],
  ['verified_by 为空', (o) => (o.verified_by = '  '), /verified_by: expected a non-empty string/],
  ['deadline 缺失（应填 null）', (o) => delete o.deadline, /deadline: expected required/],
  ['deadline 不是日期', (o) => (o.deadline = 'rolling'), /deadline: expected a valid date YYYY-MM-DD or null/],
  ['location.format 不在枚举内', (o) => (o.location.format = 'remote'), /location\.format: expected one of/],
  ['location.country 小写', (o) => (o.location.country = 'us'), /location\.country: expected a two-letter uppercase country code/],
  ['cost.fee_usd 为负', (o) => (o.cost.fee_usd = -5), /cost\.fee_usd: expected a non-negative finite number or null/],
  ['cost.fee_usd 缺失', (o) => delete o.cost.fee_usd, /cost\.fee_usd: expected required/],
  ['cost.fee_usd 是字符串', (o) => (o.cost.fee_usd = '0'), /cost\.fee_usd: expected a non-negative finite number or null/],
  ['cost.requires_travel_expense 不是布尔', (o) => (o.cost.requires_travel_expense = 'no'), /requires_travel_expense: expected true \/ false or null/],
  ['time_commitment.hours_per_week 为负', (o) => (o.time_commitment.hours_per_week = -1), /hours_per_week: expected a non-negative finite number or null/],
  ['time_commitment.total_weeks 为 Infinity', (o) => (o.time_commitment.total_weeks = Infinity), /total_weeks: expected a non-negative finite number or null/],
  ['time_commitment.start_date 不是日期', (o) => (o.time_commitment.start_date = '2027-13-01'), /start_date: expected a valid date/],
  ['required_devices 含不存在的设备', (o) => (o.required_devices = ['laptop', 'printer']), /required_devices\[1\]: expected one of.*"printer"/],
  ['requirements 不是数组', (o) => (o.requirements = null), /requirements: expected an array/],
  ['requirement 缺 source_text', (o) => delete req(o, 'req-grade').source_text, /requirements\[req-grade\]\.source_text: expected non-empty official text/],
  ['requirement source_text 只有空格', (o) => (req(o, 'req-grade').source_text = '   '), /req-grade\]\.source_text: expected non-empty official text/],
  ['requirement type 拼错', (o) => (req(o, 'req-grade').type = 'grades'), /req-grade\]\.type: expected one of.*"grades"/],
  ['requirement hard 不是布尔', (o) => (req(o, 'req-grade').hard = 'yes'), /req-grade\]\.hard: expected true/],
  ['requirement 缺 label', (o) => delete req(o, 'req-grade').label, /req-grade\]\.label: expected a non-empty string/],
  ['requirement id 重复', (o) => (req(o, 'req-region').id = 'req-grade'), /duplicate id \(must be unique within the opportunity\): "req-grade"/],
  ['grade min > max', (o) => Object.assign(req(o, 'req-grade'), { min: 12, max: 9 }), /req-grade\]\.min \/ max: expected min ≤ max/],
  ['grade 超出 1–17', (o) => (req(o, 'req-grade').max = 20), /req-grade\]\.max: expected a whole-number grade from 1–17/],
  ['age min > max', (o) => Object.assign(req(o, 'req-age'), { min: 19, max: 18 }), /req-age\]\.min \/ max: expected min ≤ max/],
  ['age as_of 不是日期', (o) => (req(o, 'req-age').as_of = 'deadline'), /req-age\]\.as_of: expected a valid date/],
  ['region countries 为空', (o) => (req(o, 'req-region').countries = []), /req-region\]\.countries: expected a non-empty array/],
  ['region 国家代码不是两位大写', (o) => (req(o, 'req-region').countries = ['USA']), /req-region\]\.countries\[0\]: expected a two-letter uppercase country code/],
  ['citizenship 缺 countries', (o) => delete req(o, 'req-cit').countries, /req-cit\]\.countries: expected a non-empty array/],
  ['status any_of 含不存在的身份', (o) => (req(o, 'req-status').any_of = ['student']), /req-status\]\.any_of\[0\]: expected one of/],
  ['status any_of 为空', (o) => (req(o, 'req-status').any_of = []), /req-status\]\.any_of: expected a non-empty array/],
  ['prerequisite_skill 缺 skill', (o) => delete req(o, 'req-skill').skill, /req-skill\]\.skill: expected a non-empty string/],
  ['prerequisite_skill min_level 不合法', (o) => (req(o, 'req-skill').min_level = 'expert'), /req-skill\]\.min_level: expected one of/],
  ['portfolio evidence_kind 不合法', (o) => (req(o, 'req-port').evidence_kind = 'essay'), /req-port\]\.evidence_kind: expected one of/],
  ['preparation 不是数组', (o) => (o.preparation = {}), /preparation: expected an array/],
  ['preparation id 重复', (o) => (prep(o, 'prep-b').id = 'prep-a'), /preparation\[prep-a\]\.id: duplicate id/],
  ['preparation estimated_hours 为负', (o) => (prep(o, 'prep-a').estimated_hours = -2), /prep-a\]\.estimated_hours: expected a non-negative finite number/],
  ['preparation estimated_cost_usd 为 NaN', (o) => (prep(o, 'prep-a').estimated_cost_usd = NaN), /prep-a\]\.estimated_cost_usd: expected a non-negative finite number/],
  ['preparation depends_on 引用不存在', (o) => (prep(o, 'prep-b').depends_on = ['prep-zzz']), /prep-b\]\.depends_on: refers to a prep item that does not exist: "prep-zzz"/],
  ['preparation 自依赖', (o) => (prep(o, 'prep-a').depends_on = ['prep-a']), /prep-a\]\.depends_on: cannot depend on itself/],
  ['preparation 依赖成环', (o) => (prep(o, 'prep-a').depends_on = ['prep-b']), /dependency loop: prep-a → prep-b → prep-a/],
  ['preparation evidence_kind 不合法', (o) => (prep(o, 'prep-a').evidence_kind = 'video'), /prep-a\]\.evidence_kind: expected one of/],
  ['preparation required_for_application 缺失', (o) => delete prep(o, 'prep-b').required_for_application, /prep-b\]\.required_for_application: expected true \/ false/],
  ['is_sample 不是布尔', (o) => (o.is_sample = 'yes'), /is_sample: expected true \/ false/],
  ['source_tier 不在枚举内', (o) => (o.source_tier = 'blog'), /source_tier: expected one of: official \/ trusted_aggregator \/ user_posted.*got "blog"/],
  ['source_tier 为 null（只能缺省）', (o) => (o.source_tier = null), /source_tier: expected one of/],
  ['posted_by 不是字符串', (o) => (o.posted_by = 42), /posted_by: expected a string or null/],
  ['preparation material_kind 不合法', (o) => (prep(o, 'prep-b').material_kind = 'cv'), /prep-b\]\.material_kind: expected one of.*"cv"/],
  ['preparation reusable_across_opportunities 不是布尔', (o) => (prep(o, 'prep-b').reusable_across_opportunities = 'yes'), /prep-b\]\.reusable_across_opportunities: expected true \/ false or null/],
];

describe('validateOpportunity：每类错误都能报出', () => {
  it.each(OPP_CASES)('%s', (_name, fn, pattern) => {
    const problems = validateOpportunity(mutated(goodOpp, fn));
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.some((p) => pattern.test(p)), problems.join('\n')).toBe(true);
    // 每条问题都写明是哪条机会
    for (const p of problems) expect(p).toMatch(/^Opportunity/);
  });

  it('问题里写清哪条机会、哪个字段、期望什么、实际是什么', () => {
    const [p] = validateOpportunity(mutated(goodOpp, (o) => (o.category = 'bootcamp')));
    expect(p).toBe(
      'Opportunity "sample-validation-event" field category: expected one of: research / scholarship / hackathon / competition / internship / fellowship / summer_program / public_service / project / other, got "bootcamp"',
    );
  });

  it.each([null, undefined, 42, 'x', [], true])('非对象输入 %s 不抛异常，返回问题', (v) => {
    expect(() => validateOpportunity(v)).not.toThrow();
    expect(validateOpportunity(v).length).toBeGreaterThan(0);
  });

  it('可缺省字段不填也合格（deadline 为 null、location 只有 format）', () => {
    const o = mutated(goodOpp, (x) => {
      x.deadline = null;
      x.location = { format: 'online' };
      delete x.recurring_annually;
      delete x.is_sample;
    });
    expect(validateOpportunity(o)).toEqual([]);
  });

  it('第二阶段新增的可选字段：合法取值都合格', () => {
    for (const tier of ['official', 'trusted_aggregator', 'user_posted']) {
      const o = mutated(goodOpp, (x) => {
        x.source_tier = tier;
        x.posted_by = tier === 'user_posted' ? 'sample-publisher-1' : null;
        prep(x, 'prep-b').material_kind = 'resume';
        prep(x, 'prep-b').reusable_across_opportunities = true;
        prep(x, 'prep-a').material_kind = null;
        prep(x, 'prep-a').reusable_across_opportunities = null;
      });
      expect(validateOpportunity(o)).toEqual([]);
    }
  });
});

describe('validateOpportunities：跨条目检查', () => {
  it('id 重复会被报出（写明第几条）', () => {
    const problems = validateOpportunities([goodOpp(), goodOpp()]);
    expect(problems).toEqual([expect.stringMatching(/sample-validation-event.*duplicate id \(#1 and #2 are the same/)]);
  });
  it('不是数组', () => {
    expect(validateOpportunities({})).toEqual([expect.stringMatching(/expected an array/)]);
  });
  it('缺 id 的条目用序号指明', () => {
    const problems = validateOpportunities([goodOpp(), mutated(goodOpp, (o) => delete o.id)]);
    expect(problems.some((p) => p.startsWith('Opportunity #2 (missing id)'))).toBe(true);
  });
});

// ───────────────────────────── 提醒 ─────────────────────────────

describe('opportunityWarnings：不算错误的提醒', () => {
  it('fixture 没有提醒', () => {
    expect(opportunityWarnings(goodOpp())).toEqual([]);
  });

  const WARN_CASES: [string, Mut, RegExp][] = [
    ['fields 含连字符', (o) => (o.fields = ['computer-science']), /has a hyphen.*computer_science/],
    ['fields 为空', (o) => (o.fields = []), /fields: is empty/],
    ['recurring_annually 没填', (o) => delete o.recurring_annually, /recurring_annually: is missing/],
    ['fee_usd 为 null', (o) => (o.cost.fee_usd = null), /cost\.fee_usd: is null/],
    ['requires_travel_expense 为 null（线下）', (o) => (o.cost.requires_travel_expense = null), /requires_travel_expense: is null/],
    ['hours_per_week 为 null', (o) => (o.time_commitment.hours_per_week = null), /hours_per_week: is null/],
    ['preparation 为空', (o) => (o.preparation = []), /preparation: is empty/],
    ['真实机会指向 example.com', (o) => (o.is_sample = false), /placeholder domain/],
    ['verified_on 晚于截止日期', (o) => (o.verified_on = '2026-12-20'), /verified_on: verified date 2026-12-20 is after the deadline/],
    ['开始日期晚于结束日期', (o) => (o.time_commitment.end_date = '2027-01-01'), /is after end date/],
    ['截止日期晚于开始日期', (o) => (o.deadline = '2027-02-01'), /deadline: deadline 2027-02-01 is after the program start date/],
  ];

  it.each(WARN_CASES)('%s', (_name, fn, pattern) => {
    const o = mutated(goodOpp, fn);
    expect(validateOpportunity(o)).toEqual([]); // 提醒不影响合格
    const warnings = opportunityWarnings(o);
    expect(warnings.some((w) => pattern.test(w)), warnings.join('\n')).toBe(true);
  });

  it('线上机会的 requires_travel_expense 为 null 不提醒（可达性对线上跳过交通判断）', () => {
    const o = mutated(goodOpp, (x) => {
      x.location = { format: 'online' };
      x.cost.requires_travel_expense = null;
    });
    expect(opportunityWarnings(o).some((w) => w.includes('requires_travel_expense'))).toBe(false);
  });

  it.each([null, 1, 'x', []])('非对象输入 %s 不抛异常', (v) => {
    expect(opportunityWarnings(v)).toEqual([]);
  });
});

// ───────────────────────────── 档案 ─────────────────────────────

const PROFILE_CASES: [string, Mut, RegExp][] = [
  ['缺 id', (p) => delete p.id, /^Profile \(missing id\) field id/],
  ['is_sample 不是布尔', (p) => (p.is_sample = 'true'), /is_sample: expected true \/ false/],
  ['display_name 为空', (p) => (p.display_name = ''), /display_name: expected a non-empty string/],
  ['grade 不是整数', (p) => (p.grade = 10.5), /grade: expected a whole number from 1–17/],
  ['age 为负', (p) => (p.age = -1), /age: expected a non-negative finite number/],
  ['region.country 不是两位大写', (p) => (p.region.country = 'usa'), /region\.country: expected a two-letter uppercase country code/],
  ['region.locality 不在枚举内', (p) => (p.region.locality = 'remote'), /region\.locality: expected one of/],
  ['citizenships 代码不合法', (p) => (p.citizenships = ['America']), /citizenships\[0\]: expected a two-letter uppercase country code/],
  ['statuses 含不存在的身份', (p) => (p.statuses = ['student']), /statuses\[0\]: expected one of/],
  ['budget_usd 为负', (p) => (p.budget_usd = -10), /budget_usd: expected a non-negative finite number/],
  ['transport.level 不在枚举内', (p) => (p.transport.level = 'car'), /transport\.level: expected one of/],
  ['devices 含不存在的设备', (p) => (p.devices = ['phone']), /devices\[0\]: expected one of/],
  ['skills level 不合法', (p) => (p.skills = [{ name: 'python', level: 'pro' }]), /skills\[0\]\.level: expected one of/],
  ['evidence 不是数组', (p) => (p.evidence = null), /evidence: expected an array/],
  ['evidence kind 不合法', (p) => (p.evidence[0].kind = 'video'), /evidence\[ev-1\]\.kind: expected one of/],
  ['evidence status 不合法', (p) => (p.evidence[0].status = 'verified'), /evidence\[ev-1\]\.status: expected one of/],
  ['evidence skills 不是数组', (p) => (p.evidence[0].skills = 'python'), /evidence\[ev-1\]\.skills: expected an array of strings/],
  ['evidence added_on 不是日期', (p) => (p.evidence[0].added_on = 'yesterday'), /evidence\[ev-1\]\.added_on: expected a valid date/],
  ['evidence url 不是链接', (p) => (p.evidence[0].url = 'not a url'), /evidence\[ev-1\]\.url: expected an http\(s\) link/],
  ['evidence id 重复', (p) => p.evidence.push({ ...p.evidence[0] }), /evidence\[ev-1\]\.id: duplicate id/],
  ['interests 含非字符串', (p) => (p.interests = [1]), /interests\[0\]: expected a non-empty string/],
];

describe('validateProfile', () => {
  it.each(PROFILE_CASES)('%s', (_name, fn, pattern) => {
    const problems = validateProfile(mutated(goodProfile, fn));
    expect(problems.some((p) => pattern.test(p)), problems.join('\n')).toBe(true);
  });

  it('可缺字段允许 null / 不填', () => {
    const p = {
      id: 'sample-min',
      is_sample: false,
      display_name: '最少字段',
      grade: null,
      age: null,
      region: null,
      citizenships: null,
      statuses: null,
      devices: null,
      skills: null,
      transport: null,
      interests: null,
      evidence: [],
    };
    expect(validateProfile(p)).toEqual([]);
    expect(validateProfile({ id: 'x', is_sample: true, display_name: 'x', evidence: [] })).toEqual([]);
  });

  it.each([null, 1, 'x', []])('非对象输入 %s 不抛异常', (v) => {
    expect(() => validateProfile(v)).not.toThrow();
    expect(validateProfile(v).length).toBeGreaterThan(0);
  });
});

// ───────────────────────────── data/opportunities.json（合并进来后自动校验） ─────────────────────────────

const OPPS_PATH = fileURLToPath(new URL('../data/opportunities.json', import.meta.url));
const hasOpps = existsSync(OPPS_PATH);

describe('data/opportunities.json', () => {
  const name = hasOpps
    ? '全部机会通过校验（提醒只打印，不让测试失败）'
    : '已跳过：data/opportunities.json 还不在本分支（队友 A 的分支合并进来后自动校验）';
  (hasOpps ? it : it.skip)(name, () => {
    const data: unknown = JSON.parse(readFileSync(OPPS_PATH, 'utf8'));
    const problems = validateOpportunities(data);
    expect(problems, `data/opportunities.json 有 ${problems.length} 个问题：\n${problems.join('\n')}`).toEqual([]);
    const warnings = Array.isArray(data) ? data.flatMap((o) => opportunityWarnings(o)) : [];
    if (warnings.length > 0) console.info(`data/opportunities.json 的提醒（不算错误）：\n${warnings.join('\n')}`);
  });
});
