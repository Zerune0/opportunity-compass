/**
 * 第三阶段：可选的出生日期 birth_date（精确判断年龄要求）。
 *
 * - ageOn：生日前一天 / 当天 / 后一天、闰日（非闰年按 3 月 1 日满岁）、非法、未来；
 * - checkEligibility：原本 unknown 的临界用例在有 birth_date 时变为确定结论；没有 birth_date 时结果不变；
 *   与 age 矛盾时以 birth_date 为准并在 explanation 里写明；
 * - analyzeGaps / findAlternatives / planRoutes 的「以后可能满足」在有 birth_date 时给确定结论；
 * - 分享视图不含 birth_date / age；store 丢弃非法 birth_date 而不丢档案；validateProfile 的规则；
 * - 公平性对照：带 birth_date 的档案只改学校名 / 显示名，结果严格相等。
 *
 * 机会均为虚构（example.com、is_sample: true），另用 data/opportunities.json 做公平性对照。
 */
import { afterEach, describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { checkEligibility } from './eligibility';
import { ageOn } from './eligibility/dates';
import { exactAgeOnReference } from './eligibility/age';
import { analyzeGaps } from './gap';
import { explainMatch, findAlternatives } from './match';
import { planRoutes } from './path';
import { ageCandidates, belowMinimumLater } from './requirement-timing';
import { buildSharedProfileView, defaultShareSettings, loadProfile, saveProfile, updateProfile } from './store';
import { validateProfile } from './validation';
import type { EvalOptions, Opportunity, PlanResult, Requirement, StudentProfile } from './types';

/** blocked 计划里是否有下一届提示（routes 计划没有 alternatives）。 */
const hasNextCycle = (r: PlanResult): boolean => r.status === 'blocked' && r.alternatives.some((a) => a.kind === 'next_cycle');

const TODAY = '2026-11-18';
const T: EvalOptions = { today: TODAY };

function makeOpp(requirements: Requirement[], extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'fictional-age-program',
    title: 'Fictional Age Program (sample, not real)',
    organizer: 'Example Org (fictional)',
    category: 'summer_program',
    fields: ['computer_science'],
    summary: 'Fictional opportunity for birth date tests.',
    official_url: 'https://example.com/fictional-age-program',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: '2027-03-01',
    recurring_annually: true,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 4 },
    required_devices: [],
    requirements,
    preparation: [],
    is_sample: true,
    ...extra,
  };
}

const BASE: StudentProfile = { id: 'bd-student', is_sample: true, display_name: 'Sample student', evidence: [] };

/** 「到 2027-06-01 满 16 岁」：今天 15 岁的学生，那天可能 15 或 16 → 没有生日时 unknown。 */
const MIN16: Requirement = {
  id: 'req-age',
  type: 'age',
  min: 16,
  as_of: '2027-06-01',
  label: 'At least 16 by June 1, 2027',
  hard: true,
  source_text: 'Applicants must be at least 16 years old by June 1, 2027.',
};
/** 「到 2027-06-01 不超过 15 岁」。 */
const MAX15: Requirement = {
  id: 'req-age',
  type: 'age',
  max: 15,
  as_of: '2027-06-01',
  label: 'At most 15 on June 1, 2027',
  hard: true,
  source_text: 'Applicants must be 15 or younger on June 1, 2027.',
};

const ageItem = (p: StudentProfile, req: Requirement, opts?: EvalOptions, extra: Partial<Opportunity> = {}) =>
  checkEligibility(p, makeOpp([req], extra), opts).items[0];

// ───────────────────────────── ageOn ─────────────────────────────

describe('ageOn', () => {
  it('生日前一天 / 当天 / 后一天', () => {
    expect(ageOn('2010-06-15', '2026-06-14')).toBe(15);
    expect(ageOn('2010-06-15', '2026-06-15')).toBe(16);
    expect(ageOn('2010-06-15', '2026-06-16')).toBe(16);
    expect(ageOn('2010-12-31', '2026-01-01')).toBe(15);
  });

  it('2 月 29 日出生：非闰年按 3 月 1 日满岁，闰年按 2 月 29 日', () => {
    expect(ageOn('2008-02-29', '2025-02-28')).toBe(16);
    expect(ageOn('2008-02-29', '2025-03-01')).toBe(17);
    expect(ageOn('2008-02-29', '2028-02-28')).toBe(19);
    expect(ageOn('2008-02-29', '2028-02-29')).toBe(20);
    expect(ageOn('2008-02-29', '2100-02-28')).toBe(91); // 2100 不是闰年
    expect(ageOn('2008-02-29', '2100-03-01')).toBe(92);
  });

  it('非法日期 → null；出生日期晚于参考日 → null；同一天 → 0', () => {
    expect(ageOn('2010-02-30', TODAY)).toBeNull();
    expect(ageOn('2010-6-15', TODAY)).toBeNull();
    expect(ageOn('not a date', TODAY)).toBeNull();
    expect(ageOn(null, TODAY)).toBeNull();
    expect(ageOn(undefined, TODAY)).toBeNull();
    expect(ageOn('2010-06-15', '2026-13-01')).toBeNull();
    expect(ageOn('2010-06-15', null)).toBeNull();
    expect(ageOn('2027-01-01', TODAY)).toBeNull();
    expect(ageOn(TODAY, TODAY)).toBe(0);
  });
});

// ───────────────────────────── checkEligibility ─────────────────────────────

describe('checkEligibility：有 birth_date 时用确切年龄', () => {
  it('没有生日时临界 unknown → 有生日时确定 satisfied / not_satisfied', () => {
    const p15 = { ...BASE, age: 15 };
    expect(ageItem(p15, MIN16, T).status).toBe('unknown');
    expect(ageItem(p15, MAX15, T).status).toBe('unknown');

    const before = ageItem({ ...p15, birth_date: '2011-05-31' }, MIN16, T); // 2027-05-31 满 16
    expect(before.status).toBe('satisfied');
    expect(before.used_profile_fields).toEqual(['birth_date']);
    expect(before.confirm_with_official).toBeNull();
    expect(before.explanation).toContain('from your date of birth you are 16 years old on that day');
    expect(ageItem({ ...p15, birth_date: '2011-06-01' }, MIN16, T).status).toBe('satisfied'); // 当天满 16
    expect(ageItem({ ...p15, birth_date: '2011-06-02' }, MIN16, T).status).toBe('not_satisfied'); // 那天还是 15

    expect(ageItem({ ...p15, birth_date: '2011-06-02' }, MAX15, T).status).toBe('satisfied');
    expect(ageItem({ ...p15, birth_date: '2011-06-01' }, MAX15, T).status).toBe('not_satisfied');
  });

  it('参考日来自截止日期；as_of 与截止日期都在时不需要 today（不读系统时钟）', () => {
    const deadlineOnly: Requirement = { ...MIN16, as_of: undefined, label: 'At least 16 at the deadline' };
    const p = { ...BASE, birth_date: '2011-03-01' };
    expect(ageItem(p, deadlineOnly, undefined).status).toBe('satisfied'); // 2027-03-01 满 16
    expect(ageItem({ ...BASE, birth_date: '2011-03-02' }, deadlineOnly, undefined).status).toBe('not_satisfied');
    expect(ageItem(p, deadlineOnly, undefined).explanation).toContain('the deadline (2027-03-01)');
    // 没有 today、没有 age 时，旧规则是 unknown；有生日后可以确定
    expect(ageItem({ ...BASE, age: 15 }, MIN16, undefined).status).toBe('unknown');
    expect(ageItem({ ...BASE, age: 15, birth_date: '2011-05-31' }, MIN16, undefined).status).toBe('satisfied');
  });

  it('没有任何参考日：有 today 用 today 的确切年龄；没有 today 时与旧行为一致', () => {
    const noRef: Requirement = { id: 'req-age', type: 'age', min: 14, max: 18, label: 'Ages 14–18', hard: true, source_text: 'Ages 14-18.' };
    const extra = { deadline: null };
    const p = { ...BASE, birth_date: '2008-11-19' }; // 今天 17，明天 18
    const item = ageItem(p, noRef, T, extra);
    expect(item.status).toBe('satisfied');
    expect(item.explanation).toContain(`today (${TODAY})`);
    expect(ageItem({ ...BASE, birth_date: '2007-11-18' }, noRef, T, extra).status).toBe('not_satisfied'); // 今天满 19
    // 没有 today：只有生日 → unknown（算不出今天的年龄）；同时有 age → 与旧行为相同（用当前年龄）
    const onlyBirth = ageItem(p, noRef, undefined, extra);
    expect(onlyBirth.status).toBe('unknown');
    expect(onlyBirth.confirm_with_official).toBeTruthy();
    const withAge = ageItem({ ...p, age: 16 }, noRef, undefined, extra);
    expect(withAge).toStrictEqual(ageItem({ ...BASE, age: 16 }, noRef, undefined, extra));
  });

  it('与 age 矛盾：以 birth_date 为准，并在 explanation 里写明不一致', () => {
    const item = ageItem({ ...BASE, age: 17, birth_date: '2011-06-02' }, MIN16, T); // 生日算出今天 15
    expect(item.status).toBe('not_satisfied');
    expect(item.explanation).toContain('your profile says you are 17');
    expect(item.explanation).toContain('makes you 15 today');
    expect(item.explanation).toContain('we used your date of birth');
    // 一致时没有提示
    expect(ageItem({ ...BASE, age: 15, birth_date: '2011-06-02' }, MIN16, T).explanation).not.toContain('Note:');
    // 没有 today 时无法比较，不提示
    expect(ageItem({ ...BASE, age: 17, birth_date: '2011-06-02' }, MIN16, undefined).explanation).not.toContain('Note:');
  });

  it('出生日期非法或在今天之后：不用它，按 age 判断并如实说明', () => {
    const bad = ageItem({ ...BASE, age: 15, birth_date: '2011-02-30' }, MIN16, T);
    expect(bad.status).toBe('unknown');
    expect(bad.used_profile_fields).toEqual(['age']);
    expect(bad.explanation).toContain('not a valid past date');
    const future = ageItem({ ...BASE, age: 15, birth_date: '2027-01-01' }, MIN16, T);
    expect(future.status).toBe('unknown');
    expect(future.explanation).toContain('not a valid past date');
    const none = ageItem({ ...BASE, birth_date: 'oops' }, MIN16, T);
    expect(none.status).toBe('unknown');
    expect(none.confirm_with_official).toContain('Add your age');
  });

  it('没有 birth_date（缺省或 null）时与之前完全相同', () => {
    const fixtures: [StudentProfile, Requirement, EvalOptions | undefined][] = [
      [{ ...BASE, age: 15 }, MIN16, T],
      [{ ...BASE, age: 15 }, MAX15, T],
      [{ ...BASE, age: 17 }, MIN16, undefined],
      [{ ...BASE }, MIN16, T],
    ];
    for (const [p, req, opts] of fixtures) {
      expect(ageItem({ ...p, birth_date: null }, req, opts)).toStrictEqual(ageItem(p, req, opts));
    }
    // 第一阶段的说明文字原样保留
    expect(ageItem({ ...BASE, age: 15 }, MIN16, T).explanation).toBe(
      "Age is counted on the official reference date (2027-06-01): on that day you may be 15 or 16 years old, depending on whether your birthday comes before then; required: at least 16 years, so we can't be sure.",
    );
    const opps = opportunitiesJson as unknown as Opportunity[];
    for (const raw of profilesJson as unknown as StudentProfile[]) {
      for (const o of opps) {
        for (const opts of [undefined, T]) {
          expect(checkEligibility({ ...raw, birth_date: null }, o, opts)).toStrictEqual(checkEligibility(raw, o, opts));
          expect(planRoutes({ ...raw, birth_date: null }, o, opts)).toStrictEqual(planRoutes(raw, o, opts));
        }
      }
    }
  });
});

// ───────────────────────────── 统一入口与 requirement-timing ─────────────────────────────

describe('exactAgeOnReference / ageCandidates / belowMinimumLater', () => {
  it('有生日时返回单一确切值；没有时与之前相同', () => {
    const o = makeOpp([MIN16]);
    expect(ageCandidates(15, MIN16, o, T)).toEqual([15, 16]);
    expect(ageCandidates(15, MIN16, o, T, '2011-06-02')).toEqual([15]);
    expect(ageCandidates(null, MIN16, o, T, '2011-05-31')).toEqual([16]);
    expect(ageCandidates(null, MIN16, o, T)).toEqual([]);
    expect(exactAgeOnReference('2011-05-31', MIN16, o, T)).toEqual({ age: 16, on: '2027-06-01', on_which: 'as_of' });
    expect(exactAgeOnReference('2027-01-01', MIN16, o, T)).toBeNull(); // 晚于 today，不用
  });

  it('belowMinimumLater：没有生日时临界不确定 → false；有生日时给确定结论（age 可以没填）', () => {
    const o = makeOpp([MIN16]);
    expect(belowMinimumLater(MIN16, { ...BASE, age: 15 }, o, T)).toBe(false);
    expect(belowMinimumLater(MIN16, { ...BASE, age: 15, birth_date: '2011-06-02' }, o, T)).toBe(true);
    expect(belowMinimumLater(MIN16, { ...BASE, birth_date: '2011-06-02' }, o, T)).toBe(true);
    expect(belowMinimumLater(MIN16, { ...BASE, birth_date: '2011-05-31' }, o, T)).toBe(false);
  });
});

describe('analyzeGaps / findAlternatives / planRoutes：「以后可能满足」', () => {
  const o = makeOpp([MIN16]);
  const CAT = [makeOpp([], { id: 'fictional-same-field', fields: ['computer_science'] })];
  const young = { ...BASE, age: 15, birth_date: '2011-06-02' };

  it('analyzeGaps：没有生日时只是待确认；有生日时确定不满足、以后可能满足', () => {
    const without = analyzeGaps({ ...BASE, age: 15 }, o, [], T);
    expect(without.items.some((i) => i.id === 'unknown_info:req-age')).toBe(true);
    const withBirth = analyzeGaps(young, o, [], T);
    const g = withBirth.items.find((i) => i.id === 'unchangeable_eligibility:req-age');
    expect(g).toBeDefined();
    expect(g!.detail).toContain('may be met later');
    expect(g!.action).toBeNull();
  });

  it('findAlternatives：有生日、低于下限 → next_cycle；超过上限 → 不给', () => {
    expect(findAlternatives({ ...BASE, age: 15 }, o, CAT, T).find((a) => a.kind === 'next_cycle')).toBeUndefined();
    const r = findAlternatives(young, o, CAT, T);
    expect(r.find((a) => a.kind === 'next_cycle')).toBeDefined();
    const over = findAlternatives({ ...BASE, age: 15, birth_date: '2011-06-01' }, makeOpp([MAX15]), CAT, T);
    expect(over.find((a) => a.kind === 'next_cycle')).toBeUndefined();
  });

  it('planRoutes：有生日时按参考日当天的确切年龄判断走向（与 requirement-timing 一致）', () => {
    // 16 岁限定、参考日 2029-06-01：今天 15（低于下限），到那天 17（超过上限）→ 不会随时间变好
    const only16: Requirement = { ...MIN16, max: 16, as_of: '2029-06-01', label: 'Exactly 16 on June 1, 2029', source_text: 'Must be 16 on June 1, 2029.' };
    const opp = makeOpp([only16]);
    const withBirth = planRoutes(young, opp, T);
    expect(withBirth.status).toBe('blocked');
    expect(hasNextCycle(withBirth)).toBe(false);
    expect(belowMinimumLater(only16, young, opp, T)).toBe(false);
    // 没有生日时保留第一阶段的规则（按当前年龄 15 < 16 → 给下一届提示），行为不变
    const without = planRoutes({ ...BASE, age: 15 }, opp, T);
    expect(without.status).toBe('blocked');
    expect(hasNextCycle(without)).toBe(true);
    // 有生日、确实低于下限 → 给下一届提示
    const below = planRoutes(young, o, T);
    expect(below.status).toBe('blocked');
    expect(hasNextCycle(below)).toBe(true);
  });
});

// ───────────────────────────── 隐私：分享视图 ─────────────────────────────

describe('隐私：分享视图不含 birth_date / age', () => {
  it('buildSharedProfileView 即使全部分享也不带出生日期和年龄', () => {
    const p: StudentProfile = {
      ...BASE,
      id: 'bd-share',
      is_sample: false,
      age: 15,
      birth_date: '2011-06-02',
      skills: [{ name: 'python', level: 'beginner' }],
      interests: ['climate'],
      evidence: [{ id: 'e1', title: 'Project', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2026-11-01' }],
    };
    const settings = { ...defaultShareSettings('bd-share', TODAY, 'share-bd'), evidence_ids: ['e1'], skills: ['python'], share_interests: true, collaboration_note: 'Weekends' };
    const view = buildSharedProfileView(p, settings);
    expect(view).not.toBeNull();
    const text = JSON.stringify(view);
    expect(text).not.toContain('2011-06-02');
    expect(text).not.toContain('birth');
    expect(Object.keys(view!)).not.toContain('age');
    expect(Object.keys(view!)).not.toContain('birth_date');
  });
});

// ───────────────────────────── 校验与存储 ─────────────────────────────

describe('validateProfile：birth_date', () => {
  it('缺省 / null / 合法日期都通过；非法格式报错；传 today 时未来日期报错', () => {
    expect(validateProfile(BASE)).toEqual([]);
    expect(validateProfile({ ...BASE, birth_date: null })).toEqual([]);
    expect(validateProfile({ ...BASE, birth_date: '2011-06-02' }, { today: TODAY })).toEqual([]);
    expect(validateProfile({ ...BASE, birth_date: TODAY }, { today: TODAY })).toEqual([]);
    for (const bad of ['2011-02-30', '2011/06/02', '', 20110602]) {
      const problems = validateProfile({ ...BASE, birth_date: bad });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain('birth_date');
    }
    const future = validateProfile({ ...BASE, birth_date: '2026-11-19' }, { today: TODAY });
    expect(future).toHaveLength(1);
    expect(future[0]).toContain('no later than today');
    // 不传 today 时不读系统时钟，不检查未来日期
    expect(validateProfile({ ...BASE, birth_date: '2099-01-01' })).toEqual([]);
  });
});

function installFakeWindow(): void {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

describe('store：非法 birth_date 只丢弃这个值', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('loadProfile / updateProfile', () => {
    installFakeWindow();
    expect(saveProfile({ ...BASE, age: 15, birth_date: 'not-a-date' })).toBe(true);
    expect(loadProfile()).toEqual({ ...BASE, age: 15, birth_date: null });
    expect(updateProfile({ birth_date: '2011-06-02' })?.birth_date).toBe('2011-06-02');
    expect(loadProfile()?.birth_date).toBe('2011-06-02');
    expect(updateProfile({ birth_date: '2011-02-30' })).toMatchObject({ age: 15, birth_date: null });
    expect(updateProfile({ birth_date: '2011-06-02' })?.birth_date).toBe('2011-06-02');
    expect(updateProfile({ birth_date: null })?.birth_date).toBeNull();
    expect(loadProfile()?.age).toBe(15);
  });
});

// ───────────────────────────── 公平性 ─────────────────────────────

describe('公平性：带 birth_date 的档案只改学校名 / 显示名，结果相等', () => {
  const opps = [...(opportunitiesJson as unknown as Opportunity[]), makeOpp([MIN16]), makeOpp([MAX15], { id: 'fictional-age-max' })];
  const births = ['2011-06-02', '2011-05-31', '2008-02-29'];
  const profiles = (profilesJson as unknown as StudentProfile[]).flatMap((p, i) => [
    { ...p, birth_date: births[i % births.length] },
  ]);

  it.each(profiles.map((p) => ({ p, name: p.id })))('$name', ({ p }) => {
    const variants: StudentProfile[] = [
      { ...p, school_name: 'Example Fictional Academy' },
      { ...p, school_name: 'Another Example School' },
      { ...p, display_name: 'Someone Else (sample)' },
    ];
    for (const o of opps) {
      for (const opts of [undefined, T]) {
        const base = {
          e: checkEligibility(p, o, opts),
          r: planRoutes(p, o, opts),
          g: analyzeGaps(p, o, [], opts),
          a: findAlternatives(p, o, opps, opts),
          m: explainMatch(p, o, opts),
        };
        for (const v of variants) {
          expect({
            e: checkEligibility(v, o, opts),
            r: planRoutes(v, o, opts),
            g: analyzeGaps(v, o, [], opts),
            a: findAlternatives(v, o, opps, opts),
            m: explainMatch(v, o, opts),
          }).toStrictEqual(base);
        }
      }
    }
  });

  it('反向对照：改 birth_date 确实会改变年龄判断', () => {
    const o = makeOpp([MIN16]);
    expect(checkEligibility({ ...BASE, birth_date: '2011-05-31' }, o, T).overall).toBe('eligible');
    expect(checkEligibility({ ...BASE, birth_date: '2011-06-02' }, o, T).overall).toBe('not_eligible');
  });
});
