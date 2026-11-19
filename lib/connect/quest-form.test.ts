/**
 * Quest Creator 的纯逻辑（./quest-form）。示例发布者是虚构的；保存流程用内存版浏览器存储模拟。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from '../data';
import { checkEligibility } from '../eligibility';
import { analyzeGaps } from '../gap';
import { explainMatch, findAlternatives } from '../match';
import { planRoutes } from '../path';
import { planAcrossOpportunities } from '../planner';
import { analyzeReachability } from '../reachability';
import { addUserPostedOpportunity, loadUserPostedOpportunities, removeUserPostedOpportunity } from '../store';
import type { ResourceGrant, SamplePublisher } from '../types';
import { validateOpportunity } from '../validation';
import {
  INCOMPLETE_DATE_MESSAGE,
  QUEST_MAX_LENGTH,
  ROLLING_DEADLINE_NOTE,
  USER_POSTED_ID_PREFIX,
  buildUserPostedOpportunity,
  describeValidationProblems,
  emptyQuestForm,
  formatUsd,
  isRepeatSubmitAfterPost,
  postedThroughConnect,
  prepareQuestPost,
  problemsFor,
  questFormsEqual,
  uniqueUserPostedId,
  userPostedId,
  type QuestForm,
} from './quest-form';

const TODAY = '2026-11-19';
const ID = 'sample-post-weekend-sensor-build-abc';
const CLUB: SamplePublisher = { id: 'sample-test-club', name: 'Sample Test Club', kind: 'student_club', is_sample: true, description: null };
const LAB: SamplePublisher = { id: 'sample-test-lab', name: 'Sample Test Lab', kind: 'research_group', is_sample: true };
const PUBLISHERS = [CLUB, LAB];

const filled = (over: Partial<QuestForm> = {}): QuestForm => ({
  ...emptyQuestForm(CLUB.id),
  title: 'Weekend sensor build',
  activity: 'Build and test a small air-quality sensor with the club.',
  category: 'project',
  topics: 'Environmental Science, data-science, , environmental science',
  grade_min: '9',
  grade_max: '12',
  region_country: 'us',
  region_states: 'ca, or',
  required_devices: ['home_internet', 'laptop'],
  skill: 'Python',
  skill_level: 'beginner',
  format: 'in_person',
  city: 'Riverbend',
  state: 'ca',
  country: 'us',
  hours_per_week: '3',
  total_weeks: '6',
  start_date: '2027-01-10',
  end_date: '2027-02-20',
  fee_usd: '0',
  pay_usd: '150',
  travel_expense: 'no',
  outcome: 'A working sensor you keep and a short write-up for your portfolio.',
  deadline: '2026-12-15',
  ...over,
});

describe('buildUserPostedOpportunity', () => {
  it('完整表单 → user_posted + is_sample + posted_by，发布日期与示例发布者记在 verified_on / verified_by，并通过 validateOpportunity', () => {
    const opp = buildUserPostedOpportunity(filled(), CLUB, { today: TODAY, id: ID });
    expect(validateOpportunity(opp)).toEqual([]);
    expect(opp).toMatchObject({
      id: ID,
      title: 'Weekend sensor build',
      organizer: 'Sample Test Club',
      category: 'project',
      fields: ['environmental_science', 'data_science'],
      verified_on: TODAY,
      verified_by: 'Sample Test Club',
      deadline: '2026-12-15',
      source_tier: 'user_posted',
      is_sample: true,
      posted_by: 'sample-test-club',
      preparation: [],
      required_devices: ['laptop', 'home_internet'],
      location: { format: 'in_person', city: 'Riverbend', state: 'CA', country: 'US' },
      cost: { fee_usd: 0, requires_travel_expense: false, note: 'Pay offered by the sample publisher: $150 in total.' },
      time_commitment: { hours_per_week: 3, total_weeks: 6, start_date: '2027-01-10', end_date: '2027-02-20' },
    });
    expect(opp.official_url).toBe(`https://example.com/connect-sample/${ID}`);
    expect(opp.summary).toBe(
      'Build and test a small air-quality sensor with the club. What you get: A working sensor you keep and a short write-up for your portfolio. Pay: $150 in total.',
    );
  });

  it('资格只用引擎能判定的种类，全部硬性，source_text 写明出自示例发布者', () => {
    const opp = buildUserPostedOpportunity(filled(), CLUB, { today: TODAY, id: ID });
    expect(opp.requirements.map((r) => r.type)).toEqual(['grade', 'region', 'prerequisite_skill']);
    expect(opp.requirements.every((r) => r.hard === true)).toBe(true);
    expect(opp.requirements[0]).toMatchObject({ id: 'req-grade', min: 9, max: 12, label: 'Grade 9 to Grade 12' });
    expect(opp.requirements[1]).toMatchObject({ id: 'req-region', countries: ['US'], states: ['CA', 'OR'] });
    expect(opp.requirements[2]).toMatchObject({ id: 'req-skill', skill: 'python', min_level: 'beginner' });
    for (const r of opp.requirements) expect(r.source_text).toMatch(/^As posted by Sample Test Club \(sample publisher, not an official source\): /);
  });

  it('没填的资格不生成要求；只填最低年级；线上时忽略地点', () => {
    const opp = buildUserPostedOpportunity(
      filled({ grade_max: '', region_country: '', region_states: '', skill: '', format: 'online', city: 'Somewhere' }),
      CLUB,
      { today: TODAY, id: ID },
    );
    expect(opp.requirements).toHaveLength(1);
    expect(opp.requirements[0]).toMatchObject({ type: 'grade', min: 9, label: 'Grade 9 or above' });
    expect('max' in opp.requirements[0]).toBe(false);
    expect(opp.location).toEqual({ format: 'online', country: null, state: null, city: null });
  });

  it('空白数字 = 没写（null）；0 报酬写成 "none"；空截止日期 = 滚动申请', () => {
    const opp = buildUserPostedOpportunity(
      filled({ fee_usd: '', hours_per_week: ' ', total_weeks: '', pay_usd: '0', deadline: '' }),
      CLUB,
      { today: TODAY, id: ID },
    );
    expect(opp.cost.fee_usd).toBeNull();
    expect(opp.cost.note).toBe('No pay is offered.');
    expect(opp.time_commitment).toMatchObject({ hours_per_week: null, total_weeks: null });
    expect(opp.deadline).toBeNull();
    expect(opp.summary).toMatch(/Pay: none\.$/);
    expect(buildUserPostedOpportunity(filled({ pay_usd: '' }), CLUB, { today: TODAY, id: ID }).cost.note).toBeNull();
  });

  it('截止日期留空 = 滚动申请：deadline 为 null，deadline_note 写明（学生端 Quest Details 会显示），仍通过校验', () => {
    const rolling = buildUserPostedOpportunity(filled({ deadline: '' }), CLUB, { today: TODAY, id: ID });
    expect(rolling.deadline).toBeNull();
    expect(rolling.deadline_note).toBe(ROLLING_DEADLINE_NOTE);
    expect(ROLLING_DEADLINE_NOTE).toBe('Rolling applications (as posted by the sample publisher).');
    expect(validateOpportunity(rolling)).toEqual([]);
    expect(buildUserPostedOpportunity(filled(), CLUB, { today: TODAY, id: ID }).deadline_note).toBeNull();
  });

  it('金额：整数不带小数，否则两位小数；只接受普通十进制数', () => {
    expect(formatUsd(0.04)).toBe('$0.04');
    expect(formatUsd(1.5)).toBe('$1.50');
    expect(formatUsd(150)).toBe('$150');
    expect(buildUserPostedOpportunity(filled({ pay_usd: '0.04' }), CLUB, { today: TODAY, id: ID }).summary).toMatch(/Pay: \$0\.04 in total\.$/);
    expect(buildUserPostedOpportunity(filled({ pay_usd: '1.5' }), CLUB, { today: TODAY, id: ID }).cost.note).toBe(
      'Pay offered by the sample publisher: $1.50 in total.',
    );
    expect(buildUserPostedOpportunity(filled({ fee_usd: ' 5 ', hours_per_week: '1.5' }), CLUB, { today: TODAY, id: ID })).toMatchObject({
      cost: { fee_usd: 5 },
      time_commitment: { hours_per_week: 1.5 },
    });
    for (const bad of ['0x1A', '1e3', '-0', '1,000', '.5', '5.', 'Infinity']) {
      expect(Number.isNaN(buildUserPostedOpportunity(filled({ fee_usd: bad }), CLUB, { today: TODAY, id: ID }).cost.fee_usd), bad).toBe(true);
    }
  });

  it('summary 每段以句号结尾（已有 . ! ? 时不重复）', () => {
    const opp = buildUserPostedOpportunity(
      filled({ activity: 'Map three trails', outcome: 'A published map with your name on it!', pay_usd: '' }),
      CLUB,
      { today: TODAY, id: ID },
    );
    expect(opp.summary).toBe('Map three trails. What you get: A published map with your name on it!');
    expect(buildUserPostedOpportunity(filled({ activity: 'Ready?', outcome: 'A badge', pay_usd: '' }), CLUB, { today: TODAY, id: ID }).summary).toBe(
      'Ready? What you get: A badge.',
    );
  });

  it('确定性：同样的输入得到同样的输出；不修改表单', () => {
    const form = filled();
    const before = JSON.stringify(form);
    const a = buildUserPostedOpportunity(form, CLUB, { today: TODAY, id: ID });
    const b = buildUserPostedOpportunity(form, CLUB, { today: TODAY, id: ID });
    expect(a).toEqual(b);
    expect(JSON.stringify(form)).toBe(before);
  });
});

describe('userPostedId / uniqueUserPostedId', () => {
  it('由标题和传入的数字决定，kebab-case，带 sample-post- 前缀', () => {
    expect(userPostedId('Weekend Sensor Build!', 36)).toBe('sample-post-weekend-sensor-build-10');
    expect(userPostedId('Weekend Sensor Build!', 36)).toBe(userPostedId('Weekend Sensor Build!', 36));
    expect(userPostedId('   ', 0)).toBe('sample-post-quest-0');
    expect(userPostedId('数据', -5)).toBe('sample-post-quest-0');
    expect(userPostedId('a'.repeat(80), 1)).toMatch(/^sample-post-a{40}-1$/);
    for (const id of [userPostedId('x -- y', 99), userPostedId('---', 1)]) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it('与已有 id 冲突时顺延', () => {
    const taken = [userPostedId('Club', 10), userPostedId('Club', 11)];
    expect(uniqueUserPostedId('Club', 10, taken)).toBe(userPostedId('Club', 12));
    expect(uniqueUserPostedId('Club', 10, [])).toBe(userPostedId('Club', 10));
  });

  it('生成的 id 不可能与官方目录的 id 重合：目录 id 都不以 sample-post- 开头，生成的 id 都以它开头', () => {
    const catalogIds = catalogOpportunities().map((o) => o.id);
    expect(catalogIds.length).toBeGreaterThan(0);
    expect(catalogIds.filter((id) => id.startsWith(USER_POSTED_ID_PREFIX))).toEqual([]);
    for (const title of ['', 'NASA SEES 2027', catalogIds[0], 'x'.repeat(200)]) {
      for (const stamp of [0, 1, 1_763_500_000_000, 2 ** 48 - 1, -1, Number.NaN]) {
        const id = uniqueUserPostedId(title, stamp, catalogIds);
        expect(id.startsWith(USER_POSTED_ID_PREFIX)).toBe(true);
        expect(catalogIds).not.toContain(id);
      }
    }
  });
});

describe('isRepeatSubmitAfterPost（防重复提交）', () => {
  it('刚发布成功后、没改过的空表单再提交 → 不处理；改过或没有刚发布 → 正常处理', () => {
    const cleared = emptyQuestForm(CLUB.id);
    expect(isRepeatSubmitAfterPost(emptyQuestForm(CLUB.id), cleared)).toBe(true);
    expect(isRepeatSubmitAfterPost(emptyQuestForm(CLUB.id), null)).toBe(false);
    expect(isRepeatSubmitAfterPost({ ...cleared, title: 'x' }, cleared)).toBe(false);
    expect(isRepeatSubmitAfterPost({ ...cleared, required_devices: ['laptop'] }, cleared)).toBe(false);
    expect(isRepeatSubmitAfterPost(emptyQuestForm(LAB.id), cleared)).toBe(false);
  });

  it('questFormsEqual：设备按集合比较，其余逐字段比较', () => {
    expect(questFormsEqual(filled(), filled())).toBe(true);
    expect(questFormsEqual(filled({ required_devices: ['laptop', 'home_internet'] }), filled({ required_devices: ['home_internet', 'laptop'] }))).toBe(true);
    expect(questFormsEqual(filled(), filled({ deadline: '' }))).toBe(false);
    expect(questFormsEqual(filled({ required_devices: ['laptop'] }), filled({ required_devices: ['laptop', 'webcam'] }))).toBe(false);
  });
});

describe('prepareQuestPost', () => {
  it('合格时 ok 并返回机会', () => {
    const r = prepareQuestPost(filled(), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.opportunity?.posted_by).toBe(CLUB.id);
  });

  it('空表单：每个必填项都有一条英文问题，按表单顺序，什么都不返回', () => {
    const r = prepareQuestPost(emptyQuestForm(), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    expect(r.opportunity).toBeNull();
    expect(r.problems.map((p) => p.field)).toEqual(['publisher_id', 'title', 'activity', 'category', 'format', 'travel_expense', 'outcome']);
    expect(problemsFor(r.problems, 'publisher_id')).toEqual(['Choose a sample publisher.']);
    // 没有内部字段路径或「Opportunity "…" field」前缀
    for (const p of r.problems) expect(p.message).not.toMatch(/Opportunity "|field |expected/);
  });

  it('发布者只能是示例发布者列表里的', () => {
    for (const publisher_id of ['someone-real', '']) {
      const r = prepareQuestPost(filled({ publisher_id }), PUBLISHERS, { today: TODAY, id: ID });
      expect(r.ok).toBe(false);
      expect(r.problems).toEqual([{ field: 'publisher_id', message: 'Choose a sample publisher.' }]);
    }
    const notSample = { ...LAB, is_sample: false } as unknown as SamplePublisher;
    expect(prepareQuestPost(filled({ publisher_id: LAB.id }), [notSample], { today: TODAY, id: ID }).ok).toBe(false);
    expect(prepareQuestPost(filled({ publisher_id: LAB.id }), PUBLISHERS, { today: TODAY, id: ID }).opportunity?.organizer).toBe(LAB.name);
  });

  it.each([
    ['费用不是数字', { fee_usd: 'abc' }, 'fee_usd'],
    ['费用为负', { fee_usd: '-5' }, 'fee_usd'],
    ['每周小时不是数字', { hours_per_week: 'lots' }, 'hours_per_week'],
    ['周数为负', { total_weeks: '-1' }, 'total_weeks'],
    ['报酬不是数字', { pay_usd: 'some' }, 'pay_usd'],
    ['最低年级高于最高年级', { grade_min: '12', grade_max: '9' }, 'grade_min'],
    ['年级超出范围', { grade_max: '30' }, 'grade_max'],
    ['只填州没填国家', { region_country: '' }, 'region_country'],
    ['国家代码不是两位', { region_country: 'USA' }, 'region_country'],
    ['截止日期已过', { deadline: '2026-11-18' }, 'deadline'],
    ['截止日期不是真实日期', { deadline: '2026-02-30' }, 'deadline'],
    ['结束早于开始', { start_date: '2027-03-01', end_date: '2027-02-01' }, 'end_date'],
    ['开始日期非法', { start_date: 'soon' }, 'start_date'],
    ['地点国家代码非法', { country: 'usa' }, 'country'],
    ['没选形式', { format: '' }, 'format'],
    ['没选差旅', { travel_expense: '' }, 'travel_expense'],
    ['没写收获', { outcome: '   ' }, 'outcome'],
  ] as const)('%s → 对到 %s 字段', (_label, over, field) => {
    const r = prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    expect(r.problems.map((p) => p.field)).toContain(field);
    expect(problemsFor(r.problems, field).length).toBeGreaterThan(0);
  });

  it.each([
    ['州写成全名', { region_states: 'California' }, 'region_states', 'Use codes such as CA, not full names.'],
    ['州里混了全名', { region_states: 'CA, New York' }, 'region_states', 'Use codes such as CA, not full names.'],
    ['州代码太长', { region_states: 'CALI' }, 'region_states', 'Use codes such as CA, not full names.'],
    ['国家写成全名', { region_country: 'United States' }, 'region_country', 'Use a two-letter country code such as US, not a full name.'],
    ['国家代码三位', { region_country: 'USA' }, 'region_country', 'Use a two-letter country code such as US, not a full name.'],
    ['国家代码含数字', { region_country: 'U1' }, 'region_country', 'Use a two-letter country code such as US, not a full name.'],
    ['技能里有逗号', { skill: 'python, java' }, 'skill', 'Enter one skill.'],
    ['会场州写成全名', { state: 'California' }, 'state', 'Use codes such as CA, not full names.'],
  ] as const)('%s → 只报一条：%s', (_label, over, field, message) => {
    const r = prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    // 表单层已经说明的字段，不再重复 validateOpportunity 的另一种说法
    expect(problemsFor(r.problems, field)).toEqual([message]);
  });

  it.each([
    ['每周小时为 0', { hours_per_week: '0' }, 'hours_per_week', 'Hours per week must be more than 0. Leave it blank if it varies.'],
    ['每周小时为 0.0', { hours_per_week: '0.0' }, 'hours_per_week', 'Hours per week must be more than 0. Leave it blank if it varies.'],
    ['每周小时超过 168', { hours_per_week: '168.5' }, 'hours_per_week', 'Hours per week cannot be more than 168 (the hours in a week).'],
    ['每周小时为负', { hours_per_week: '-3' }, 'hours_per_week', 'Enter hours per week as a number above 0, or leave it blank if it varies.'],
    ['周数为 0', { total_weeks: '0' }, 'total_weeks', 'Total weeks must be more than 0. Leave it blank if it is not decided.'],
    ['周数不是整数', { total_weeks: '2.5' }, 'total_weeks', 'Total weeks must be a whole number of weeks.'],
    ['周数超过 520', { total_weeks: '521' }, 'total_weeks', 'Total weeks cannot be more than 520 (about ten years).'],
    ['周数为负', { total_weeks: '-1' }, 'total_weeks', 'Enter the number of weeks as a whole number above 0, or leave it blank.'],
  ] as const)('时间投入范围：%s → 只报一条，指明字段', (_label, over, field, message) => {
    const r = prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    expect(problemsFor(r.problems, field)).toEqual([message]);
  });

  it.each([
    ['每周小时正好 168', { hours_per_week: '168' }],
    ['每周小时为小数', { hours_per_week: '0.5' }],
    ['周数正好 520', { total_weeks: '520' }],
    ['周数为 1', { total_weeks: '1' }],
    ['两者都留空', { hours_per_week: '', total_weeks: '' }],
  ] as const)('时间投入范围：%s → 可以', (_label, over) => {
    expect(prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID }).ok).toBe(true);
  });

  it.each([
    ['小写州代码', { region_states: 'ca, or' }],
    ['数字州代码', { region_states: '01, 2A' }],
    ['小写国家代码', { region_country: 'us' }],
    ['线上时会场州不检查', { format: 'online', state: 'California' }],
  ] as const)('%s → 可以', (_label, over) => {
    expect(prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID }).ok).toBe(true);
  });

  it.each([
    ['title', 120],
    ['topics', 120],
    ['skill', 120],
    ['city', 120],
    ['region_states', 120],
    ['activity', 1000],
    ['outcome', 1000],
  ] as const)('%s 超过上限 %i 个字符 → 问题；刚好到上限可以', (field, max) => {
    expect(QUEST_MAX_LENGTH[field]).toBe(max);
    // 州代码用合法写法凑长度，确保只有长度这一个问题
    const tooLong = field === 'region_states' ? 'CA, '.repeat(40).slice(0, max + 1) : 'a'.repeat(max + 1);
    const r = prepareQuestPost(filled({ [field]: tooLong } as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    expect(problemsFor(r.problems, field)).toContain(`Keep this under ${max} characters.`);
    if (field !== 'region_states') {
      expect(prepareQuestPost(filled({ [field]: 'a'.repeat(max) } as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID }).ok).toBe(true);
    }
  });

  it('没填完的日期（页面从 validity.badInput 读到）→ 「Finish the date or clear it.」，什么都不返回；非日期字段忽略', () => {
    const r = prepareQuestPost(filled({ deadline: '' }), PUBLISHERS, { today: TODAY, id: ID, incompleteDates: ['deadline', 'title'] });
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ field: 'deadline', message: INCOMPLETE_DATE_MESSAGE }]);
    expect(INCOMPLETE_DATE_MESSAGE).toBe('Finish the date or clear it.');
    expect(prepareQuestPost(filled(), PUBLISHERS, { today: TODAY, id: ID, incompleteDates: [] }).ok).toBe(true);
  });

  it.each([
    ['结束日期已过', { start_date: '2026-10-01', end_date: '2026-11-01', deadline: '' }, 'end_date', 'The end date cannot be in the past.'],
    ['截止晚于结束', { end_date: '2027-02-20', deadline: '2027-03-01' }, 'deadline', 'The deadline cannot be after the end date.'],
    ['结束早于开始', { start_date: '2027-03-01', end_date: '2027-02-01', deadline: '' }, 'end_date', 'The end date cannot be before the start date.'],
  ] as const)('日期：%s', (_label, over, field, message) => {
    const r = prepareQuestPost(filled(over as Partial<QuestForm>), PUBLISHERS, { today: TODAY, id: ID });
    expect(r.ok).toBe(false);
    expect(problemsFor(r.problems, field)).toContain(message);
  });

  it('日期：结束日期是今天、截止等于结束日期都可以', () => {
    expect(prepareQuestPost(filled({ start_date: '', end_date: TODAY, deadline: TODAY }), PUBLISHERS, { today: TODAY, id: ID }).ok).toBe(true);
  });

  it.each(['1e3', '0x1A', '-0', '1,000'])('报酬 %s 不是普通数字 → 问题', (pay) => {
    const r = prepareQuestPost(filled({ pay_usd: pay }), PUBLISHERS, { today: TODAY, id: ID });
    expect(problemsFor(r.problems, 'pay_usd')).toEqual(['Enter the pay in US dollars (0 for unpaid), or leave it blank.']);
  });

  it('截止日期等于今天可以；today 非法时报一条对不上字段的问题', () => {
    expect(prepareQuestPost(filled({ deadline: TODAY }), PUBLISHERS, { today: TODAY, id: ID }).ok).toBe(true);
    const r = prepareQuestPost(filled(), PUBLISHERS, { today: 'not-a-date', id: ID });
    expect(r.ok).toBe(false);
    expect(r.problems.some((p) => p.field === null && p.message.includes('verified_on'))).toBe(true);
  });
});

describe('describeValidationProblems', () => {
  it('已知路径对到字段，未知路径保留原文、field 为 null', () => {
    expect(
      describeValidationProblems([
        'Opportunity "x" field title: expected a non-empty string, got ""',
        'Opportunity "x" field requirements[req-grade].min / max: expected min ≤ max, got "12 > 9"',
        'Opportunity "x" field preparation: expected an array (use [] if there are no prep items), got missing',
        'something else entirely',
      ]),
    ).toEqual([
      { field: 'title', message: 'Give the quest a title.' },
      { field: 'grade_min', message: 'The lowest grade must not be above the highest grade.' },
      {
        field: null,
        message: 'This posting has a problem the form cannot fix (preparation): expected an array (use [] if there are no prep items), got missing',
      },
      { field: null, message: 'This posting could not be checked: something else entirely' },
    ]);
  });
});

describe('保存到学生端（内存版浏览器存储）', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function installFakeWindow(): void {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    };
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  }

  it('合格的帖子存进去后学生端读得到（仍是 user_posted + is_sample），撤回后学生端也没了', () => {
    installFakeWindow();
    const r = prepareQuestPost(filled(), PUBLISHERS, { today: TODAY, id: ID });
    if (!r.ok) throw new Error('expected ok');
    expect(addUserPostedOpportunity(r.opportunity).map((o) => o.id)).toEqual([ID]);
    const stored = loadUserPostedOpportunities();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: ID, source_tier: 'user_posted', is_sample: true, posted_by: CLUB.id });
    expect(validateOpportunity(stored[0])).toEqual([]);
    expect(removeUserPostedOpportunity(ID)).toEqual([]);
    expect(loadUserPostedOpportunities()).toEqual([]);
  });

  it('撤回只删掉那一条，其余几条原样保留（深相等、顺序不变）', () => {
    installFakeWindow();
    const ids = ['sample-post-a-1', 'sample-post-b-2', 'sample-post-c-3'];
    for (const [i, id] of ids.entries()) {
      const r = prepareQuestPost(filled({ title: `Quest ${i}` }), PUBLISHERS, { today: TODAY, id });
      if (!r.ok) throw new Error('expected ok');
      addUserPostedOpportunity(r.opportunity);
    }
    const before = loadUserPostedOpportunities();
    expect(before.map((o) => o.id)).toEqual(ids);
    const after = removeUserPostedOpportunity('sample-post-b-2');
    expect(after).toEqual([before[0], before[2]]);
    expect(loadUserPostedOpportunities()).toEqual([before[0], before[2]]);
  });
});

describe('与学生端引擎一起跑通（示例档案）', () => {
  const TODAY_E2E = '2026-11-19';
  const form: QuestForm = {
    ...emptyQuestForm(CLUB.id),
    title: 'Weekend sensor build',
    activity: 'Build and test a small air-quality sensor with the club.',
    category: 'project',
    topics: 'environmental_science, computer_science',
    grade_min: '9',
    grade_max: '12',
    region_country: 'US',
    region_states: 'CA',
    required_devices: ['laptop'],
    format: 'in_person',
    city: 'Riverbend',
    state: 'CA',
    country: 'US',
    hours_per_week: '3',
    fee_usd: '0',
    travel_expense: 'no',
    outcome: 'A working sensor you keep.',
    deadline: '2026-12-15',
  };
  const opp = buildUserPostedOpportunity(form, CLUB, { today: TODAY_E2E, id: 'sample-post-weekend-sensor-build-1' });
  const profiles = sampleProfiles();

  it('组装出的机会通过 validateOpportunity', () => {
    expect(validateOpportunity(opp)).toEqual([]);
    expect(profiles.length).toBeGreaterThan(0);
  });

  it('每个示例档案调用学生端的判断函数都不抛异常', () => {
    const options = { today: TODAY_E2E };
    const catalog = [...catalogOpportunities(), opp];
    for (const p of profiles) {
      expect(() => checkEligibility(p, opp, options), p.id).not.toThrow();
      expect(() => analyzeReachability(p, opp, [], options), p.id).not.toThrow();
      expect(() => planRoutes(p, opp, options), p.id).not.toThrow();
      expect(() => analyzeGaps(p, opp, [], options), p.id).not.toThrow();
      expect(() => explainMatch(p, opp, options), p.id).not.toThrow();
      expect(() => findAlternatives(p, opp, catalog, options), p.id).not.toThrow();
      expect(() => planAcrossOpportunities(p, [opp], options), p.id).not.toThrow();
    }
  });

  it('sample-maya：资格 eligible，只差一台笔记本（唯一未化解的障碍是 device）→ 不可达；有一条已批准的示例笔记本 grant → 可达', () => {
    const maya = profiles.find((p) => p.id === 'sample-maya');
    if (!maya) throw new Error('sample-maya missing');
    expect(checkEligibility(maya, opp, { today: TODAY_E2E }).overall).toBe('eligible');
    const before = analyzeReachability(maya, opp, [], { today: TODAY_E2E });
    expect(before.eligibility.overall).toBe('eligible');
    const unresolved = before.barriers.filter((b) => !b.resolved);
    expect(unresolved.map((b) => b.type)).toEqual(['device']);
    expect(before.reachable).toBe(false);

    const laptop: ResourceGrant = {
      id: 'sample-grant-laptop',
      student_id: maya.id,
      opportunity_id: opp.id,
      type: 'device',
      status: 'approved',
      device: 'laptop',
      provider: 'Sample Test Club (sample)',
      is_sample: true,
    };
    const after = analyzeReachability(maya, opp, [laptop], { today: TODAY_E2E });
    expect(after.barriers.filter((b) => !b.resolved)).toEqual([]);
    expect(after.reachable).toBe(true);
  });
});

describe('postedThroughConnect（列表只列 Connect 自己发布的）', () => {
  const mine = { id: 'sample-post-a', posted_by: CLUB.id };
  const alsoMine = { id: 'sample-post-b', posted_by: LAB.id };
  const savedByAnotherPage = { id: 'placeholder-inperson-event', posted_by: null };
  const noField: { id: string; posted_by?: string | null } = { id: 'something-else' };
  const unknownPublisher = { id: 'sample-post-c', posted_by: 'not-in-the-list' };

  it('只留 posted_by 指向示例发布者的；返回原对象，顺序不变', () => {
    const out = postedThroughConnect([savedByAnotherPage, mine, noField, unknownPublisher, alsoMine], PUBLISHERS);
    expect(out).toEqual([mine, alsoMine]);
    expect(out[0]).toBe(mine);
  });

  it('没有发布者列表、或发布者不是示例 → 什么都不列；不修改输入', () => {
    const input = [mine, savedByAnotherPage];
    const before = JSON.stringify(input);
    expect(postedThroughConnect(input, [])).toEqual([]);
    expect(postedThroughConnect(input, [{ ...CLUB, is_sample: false as unknown as true }])).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('表单真正发布出来的任务会被列出', () => {
    const result = prepareQuestPost(filled(), PUBLISHERS, { today: TODAY, id: ID });
    expect(result.ok).toBe(true);
    expect(postedThroughConnect([result.opportunity!], PUBLISHERS)).toEqual([result.opportunity]);
  });
});
