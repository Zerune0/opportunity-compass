import { describe, expect, it } from 'vitest';
import { checkEligibility } from './index';
import { parseISODate, wholeYearsBetween } from './dates';
import profilesJson from '@/data/profiles.json';
import {
  ELIGIBILITY_STATUSES,
  type Opportunity,
  type Requirement,
  type StudentProfile,
} from '../types';

// 虚构测试数据（不是真实机会），链接用 example.com。
function makeOpp(requirements: Requirement[], extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'fictional-test-program',
    title: '虚构测试项目（非真实机会）',
    organizer: 'Example Org（虚构）',
    category: 'summer_program',
    fields: ['computer_science'],
    summary: '仅用于单元测试的虚构机会。',
    official_url: 'https://example.com/fictional-program',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: '2027-03-01',
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 5, total_weeks: 6 },
    required_devices: [],
    requirements,
    preparation: [],
    is_sample: true,
    ...extra,
  };
}

const BASE: StudentProfile = { id: 'p1', is_sample: true, display_name: '测试学生', evidence: [] };

function one(req: Requirement, profile: StudentProfile, extra: Partial<Opportunity> = {}, today?: string) {
  const r = checkEligibility(profile, makeOpp([req], extra), today ? { today } : undefined);
  return r.items[0];
}

function expectUnknownWithHint(item: ReturnType<typeof one>, req: Requirement) {
  expect(item.status).toBe('unknown');
  expect(typeof item.confirm_with_official).toBe('string');
  expect(item.confirm_with_official!.length).toBeGreaterThan(0);
  expect(item.source_text).toBe(req.source_text);
}

const GRADE: Requirement = { id: 'req-grade', type: 'grade', min: 9, max: 12, label: '9–12 年级', hard: true, source_text: 'Open to students in grades 9-12.' };

describe('checkEligibility — grade', () => {
  it('填了 → satisfied / not_satisfied；没填 → unknown（对照）', () => {
    const ok = one(GRADE, { ...BASE, grade: 10 });
    expect(ok.status).toBe('satisfied');
    expect(ok.confirm_with_official).toBeNull();
    expect(ok.used_profile_fields).toEqual(['grade']);
    expect(one(GRADE, { ...BASE, grade: 8 }).status).toBe('not_satisfied');
    expect(one(GRADE, { ...BASE, grade: 13 }).status).toBe('not_satisfied');
    expectUnknownWithHint(one(GRADE, BASE), GRADE);
    expectUnknownWithHint(one(GRADE, { ...BASE, grade: null }), GRADE);
    expect(one(GRADE, BASE).used_profile_fields).toEqual(['grade']);
  });

  it('只有 min 时另一侧不限', () => {
    const req: Requirement = { ...GRADE, max: undefined };
    expect(one(req, { ...BASE, grade: 17 }).status).toBe('satisfied');
  });
});

describe('checkEligibility — age', () => {
  const NO_REF: Requirement = { id: 'req-age', type: 'age', min: 14, max: 18, label: '14–18 岁', hard: true, source_text: 'Applicants must be 14-18 years old.' };

  it('没填年龄 → unknown（对照：填了 → 有结论）', () => {
    expectUnknownWithHint(one(NO_REF, BASE, { deadline: null }), NO_REF);
    expect(one(NO_REF, { ...BASE, age: 16 }, { deadline: null }).status).toBe('satisfied');
  });

  it('无参考日（无 as_of、无截止）→ 用当前年龄', () => {
    expect(one(NO_REF, { ...BASE, age: 16 }, { deadline: null }).status).toBe('satisfied');
    expect(one(NO_REF, { ...BASE, age: 19 }, { deadline: null }).status).toBe('not_satisfied');
  });

  it('有参考日但没传 today → unknown（不猜）', () => {
    const item = one(NO_REF, { ...BASE, age: 16 }, { deadline: '2027-03-01' });
    expectUnknownWithHint(item, NO_REF);
  });

  it('参考日早于 today 且两种可能都满足 → satisfied', () => {
    const req: Requirement = { ...NO_REF, as_of: '2026-01-01' };
    expect(one(req, { ...BASE, age: 18 }, {}, '2026-11-17').status).toBe('satisfied'); // 17 或 18
  });

  it('参考日在 today 之后：两种可能都满足 / 都不满足 / 取决于生日', () => {
    const today = '2026-11-17';
    // 截止 2027-03-01，间隔不足 1 年 → 可能是 age 或 age+1
    expect(one(NO_REF, { ...BASE, age: 15 }, {}, today).status).toBe('satisfied'); // 15 或 16
    expect(one(NO_REF, { ...BASE, age: 12 }, {}, today).status).toBe('not_satisfied'); // 12 或 13
    const edge = one(NO_REF, { ...BASE, age: 18 }, {}, today); // 18 或 19
    expectUnknownWithHint(edge, NO_REF);
    expect(edge.explanation).toContain('生日');
    const edgeMin = one(NO_REF, { ...BASE, age: 13 }, {}, today); // 13 或 14
    expect(edgeMin.status).toBe('unknown');
  });

  it('参考日早于 today：不能直接用当前年龄，候选为 age−n−1 / age−n', () => {
    const today = '2026-11-17';
    // 2026-09-01 → 2026-11-17 不足 1 年：那天可能是 13 或 14
    const minReq: Requirement = { id: 'req-age', type: 'age', min: 14, as_of: '2026-09-01', label: '至少 14 岁', hard: true, source_text: 'Must be 14 by September 1, 2026.' };
    const a = one(minReq, { ...BASE, age: 14 }, {}, today);
    expectUnknownWithHint(a, minReq);
    expect(a.explanation).toContain('13 岁或14 岁');
    // 那天可能是 18 或 19
    const maxReq: Requirement = { id: 'req-age', type: 'age', max: 18, as_of: '2026-09-01', label: '不超过 18 岁', hard: true, source_text: 'Must be 18 or younger on September 1, 2026.' };
    expectUnknownWithHint(one(maxReq, { ...BASE, age: 19 }, {}, today), maxReq);
    expect(one(maxReq, { ...BASE, age: 18 }, {}, today).status).toBe('satisfied'); // 17 或 18
    expect(one(maxReq, { ...BASE, age: 20 }, {}, today).status).toBe('not_satisfied'); // 19 或 20
    // 2020-01-01 → 2026-11-17：6 个完整年，有零头 → 那天 9 或 10 岁
    const old: Requirement = { id: 'req-age', type: 'age', max: 14, as_of: '2020-01-01', label: '不超过 14 岁', hard: true, source_text: 'Age 14 or under as of January 1, 2020.' };
    expect(one(old, { ...BASE, age: 16 }, {}, today).status).toBe('satisfied');
    // 恰好整年：2025-11-17 → 2026-11-17 正好 1 年 → 只能是 age−1
    const exact: Requirement = { ...minReq, as_of: '2025-11-17' };
    expect(one(exact, { ...BASE, age: 15 }, {}, today).status).toBe('satisfied'); // 14
    expect(one(exact, { ...BASE, age: 14 }, {}, today).status).toBe('not_satisfied'); // 13
  });

  it('参考日就是 today → 只用当前年龄', () => {
    const req: Requirement = { ...NO_REF, as_of: '2026-11-17' };
    expect(one(req, { ...BASE, age: 18 }, {}, '2026-11-17').status).toBe('satisfied');
    expect(one(req, { ...BASE, age: 19 }, {}, '2026-11-17').status).toBe('not_satisfied');
    expect(one(req, { ...BASE, age: 14 }, {}, '2026-11-17').status).toBe('satisfied');
    expect(one(req, { ...BASE, age: 13 }, {}, '2026-11-17').status).toBe('not_satisfied');
    // 截止日期作为参考日、恰好是今天
    expect(one(NO_REF, { ...BASE, age: 18 }, { deadline: '2026-11-17' }, '2026-11-17').status).toBe('satisfied');
  });

  it('闰日参考日', () => {
    const req: Requirement = { id: 'req-age', type: 'age', min: 14, max: 18, as_of: '2028-02-29', label: '14–18 岁', hard: true, source_text: 'Ages 14-18 as of February 29, 2028.' };
    // today 2027-02-28 → 2028-02-29：1 个完整年、有零头 → 那天 age+1 或 age+2
    expect(one(req, { ...BASE, age: 13 }, {}, '2027-02-28').status).toBe('satisfied'); // 14 或 15
    expect(one(req, { ...BASE, age: 12 }, {}, '2027-02-28').status).toBe('unknown'); // 13 或 14
    // 参考日已过：2028-02-29 → today 2029-03-01，1 个完整年、有零头 → 那天 age−2 或 age−1
    expect(one(req, { ...BASE, age: 20 }, {}, '2029-03-01').status).toBe('unknown'); // 18 或 19
    expect(one(req, { ...BASE, age: 19 }, {}, '2029-03-01').status).toBe('satisfied'); // 17 或 18
    // 2028-02-29 → 2032-02-29 恰好 4 年 → 只能是 age−4
    expect(one(req, { ...BASE, age: 22 }, {}, '2032-02-29').status).toBe('satisfied'); // 18
    expect(one(req, { ...BASE, age: 23 }, {}, '2032-02-29').status).toBe('not_satisfied'); // 19
    // 参考日就是闰日当天
    expect(one(req, { ...BASE, age: 18 }, {}, '2028-02-29').status).toBe('satisfied');
  });

  it('as_of 优先于截止日期；恰好整年时只有一种可能', () => {
    const req: Requirement = { ...NO_REF, as_of: '2027-11-17' };
    // 恰好 1 年 → 只能是 age+1
    expect(one(req, { ...BASE, age: 17 }, {}, '2026-11-17').status).toBe('satisfied'); // 18
    expect(one(req, { ...BASE, age: 18 }, {}, '2026-11-17').status).toBe('not_satisfied'); // 19
  });
});

describe('checkEligibility — region', () => {
  const REGION: Requirement = { id: 'req-region', type: 'region', countries: ['US'], label: '美国', hard: true, source_text: 'Must reside in the United States.' };
  const STATE: Requirement = { ...REGION, id: 'req-state', states: ['CA', 'NY'], source_text: 'Open to residents of California or New York.' };

  it('国家匹配（大小写不敏感）→ satisfied；不匹配 → not_satisfied；没填 → unknown', () => {
    expect(one(REGION, { ...BASE, region: { country: 'us' } }).status).toBe('satisfied');
    expect(one(REGION, { ...BASE, region: { country: 'CA' } }).status).toBe('not_satisfied');
    expectUnknownWithHint(one(REGION, BASE), REGION);
  });

  it('states 非空：州没填 → unknown；匹配 → satisfied；不匹配 → not_satisfied；国家不对直接 not_satisfied', () => {
    expectUnknownWithHint(one(STATE, { ...BASE, region: { country: 'US' } }), STATE);
    expect(one(STATE, { ...BASE, region: { country: 'US', state: 'ca' } }).status).toBe('satisfied');
    expect(one(STATE, { ...BASE, region: { country: 'US', state: 'MT' } }).status).toBe('not_satisfied');
    expect(one(STATE, { ...BASE, region: { country: 'MX' } }).status).toBe('not_satisfied');
  });
});

describe('checkEligibility — citizenship', () => {
  const CIT: Requirement = { id: 'req-cit', type: 'citizenship', countries: ['US'], label: '美国公民或永久居民', hard: true, source_text: 'U.S. citizens or permanent residents only.' };
  it('有交集 → satisfied；空数组 / 无交集 → not_satisfied；null → unknown', () => {
    expect(one(CIT, { ...BASE, citizenships: ['MX', 'us'] }).status).toBe('satisfied');
    expect(one(CIT, { ...BASE, citizenships: [] }).status).toBe('not_satisfied');
    expect(one(CIT, { ...BASE, citizenships: ['CN'] }).status).toBe('not_satisfied');
    expectUnknownWithHint(one(CIT, { ...BASE, citizenships: null }), CIT);
  });
});

describe('checkEligibility — status', () => {
  const ST: Requirement = { id: 'req-status', type: 'status', any_of: ['high_school_student'], label: '在读高中生', hard: true, source_text: 'Current high school students.' };
  it('有交集 → satisfied；无 → not_satisfied；null → unknown', () => {
    expect(one(ST, { ...BASE, statuses: ['low_income', 'high_school_student'] }).status).toBe('satisfied');
    const no = one(ST, { ...BASE, statuses: ['undergraduate'] });
    expect(no.status).toBe('not_satisfied');
    expect(no.explanation).toContain('请在档案里补上');
    expectUnknownWithHint(one(ST, BASE), ST);
  });
});

describe('checkEligibility — prerequisite_skill', () => {
  const PY: Requirement = { id: 'req-py', type: 'prerequisite_skill', skill: 'python', label: '会 Python', hard: true, source_text: 'Basic Python required.' };
  const PY_INT: Requirement = { ...PY, min_level: 'intermediate', source_text: 'Intermediate Python required.' };

  it('等级足够 → satisfied；不够或没有 → not_satisfied（提示补上）；skills 没填 → unknown', () => {
    expect(one(PY_INT, { ...BASE, skills: [{ name: 'python', level: 'advanced' }] }).status).toBe('satisfied');
    expect(one(PY_INT, { ...BASE, skills: [{ name: 'python', level: 'beginner' }] }).status).toBe('not_satisfied');
    const none = one(PY, { ...BASE, skills: [] });
    expect(none.status).toBe('not_satisfied');
    expect(none.explanation).toContain('如果你其实会');
    expectUnknownWithHint(one(PY, BASE), PY);
  });

  it('beginner 要求：有含该技能的证据也算 satisfied（即使 skills 没填）', () => {
    const p: StudentProfile = {
      ...BASE,
      evidence: [{ id: 'ev1', title: '天气数据小项目（虚构）', kind: 'project', skills: ['python'], status: 'evidence_attached', added_on: '2026-11-01' }],
    };
    expect(one(PY, p).status).toBe('satisfied');
    // 证据不能证明 intermediate
    expect(one(PY_INT, p).status).toBe('unknown');
  });
});

describe('checkEligibility — portfolio', () => {
  const PF: Requirement = { id: 'req-pf', type: 'portfolio', evidence_kind: 'project', skill: 'python', label: '一个 Python 项目', hard: true, source_text: 'Submit one Python project.' };
  it('有符合证据 → satisfied（写出标题和状态）；没有 → not_satisfied', () => {
    const p: StudentProfile = {
      ...BASE,
      evidence: [
        { id: 'ev0', title: 'Python 课程（虚构）', kind: 'course', skills: ['python'], status: 'self_reported', added_on: '2026-10-01' },
        { id: 'ev1', title: '天气数据小项目（虚构）', kind: 'project', skills: ['python'], status: 'evidence_attached', added_on: '2026-11-01' },
      ],
    };
    const ok = one(PF, p);
    expect(ok.status).toBe('satisfied');
    expect(ok.explanation).toContain('天气数据小项目');
    expect(ok.explanation).toContain('已附链接');
    expect(one(PF, { ...BASE, evidence: [p.evidence[0]] }).status).toBe('not_satisfied');
    expect(one(PF, BASE).status).toBe('not_satisfied');
  });
});

describe('checkEligibility — manual', () => {
  const M: Requirement = { id: 'req-manual', type: 'manual', label: '需要老师推荐', hard: true, source_text: 'A teacher nomination is required.' };
  it('永远 unknown', () => {
    expectUnknownWithHint(one(M, { ...BASE, grade: 10, age: 16 }), M);
  });
});

describe('checkEligibility — overall', () => {
  const PREF: Requirement = { id: 'req-pref', type: 'prerequisite_skill', skill: 'python', label: '会 Python 更好', hard: false, source_text: 'Python is a plus.' };
  const MANUAL: Requirement = { id: 'req-m', type: 'manual', label: '面试', hard: true, source_text: 'Interview required.' };

  it('eligible / not_eligible / unknown', () => {
    expect(checkEligibility({ ...BASE, grade: 10 }, makeOpp([GRADE])).overall).toBe('eligible');
    expect(checkEligibility({ ...BASE, grade: 8 }, makeOpp([GRADE, MANUAL])).overall).toBe('not_eligible');
    expect(checkEligibility({ ...BASE, grade: 10 }, makeOpp([GRADE, MANUAL])).overall).toBe('unknown');
  });

  it('非 hard 要求 not_satisfied / unknown 不影响 overall；无 hard 要求 → eligible', () => {
    const r = checkEligibility({ ...BASE, grade: 10, skills: [] }, makeOpp([GRADE, PREF]));
    expect(r.items[1].status).toBe('not_satisfied');
    expect(r.overall).toBe('eligible');
    expect(checkEligibility(BASE, makeOpp([PREF])).overall).toBe('eligible');
    expect(checkEligibility(BASE, makeOpp([])).overall).toBe('eligible');
  });

  it('items 顺序与 requirements 一致，source_text 原样带出', () => {
    const reqs = [GRADE, PREF, MANUAL];
    const r = checkEligibility(BASE, makeOpp(reqs));
    expect(r.items.map((i) => i.requirement_id)).toEqual(reqs.map((q) => q.id));
    expect(r.items.map((i) => i.source_text)).toEqual(reqs.map((q) => q.source_text));
    for (const i of r.items) {
      expect(ELIGIBILITY_STATUSES).toContain(i.status);
      expect(i.explanation).not.toMatch(/MOCK/i);
    }
  });
});

describe('checkEligibility — 确定性与公平性', () => {
  const AGE: Requirement = { id: 'req-age', type: 'age', min: 14, max: 18, label: '14–18 岁', hard: true, source_text: 'Ages 14-18.' };
  const opp = makeOpp([GRADE, AGE]);
  const p: StudentProfile = { ...BASE, grade: 11, age: 16, school_name: 'Example High（虚构）' };

  it('同输入两次结果相同', () => {
    expect(checkEligibility(p, opp, { today: '2026-11-17' })).toEqual(checkEligibility(p, opp, { today: '2026-11-17' }));
  });

  it('仅学校名 / 显示名不同 → 结果完全一致', () => {
    const q: StudentProfile = { ...p, school_name: 'Another Rural School（虚构）', display_name: '另一个名字' };
    expect(checkEligibility(q, opp, { today: '2026-11-17' })).toEqual(checkEligibility(p, opp, { today: '2026-11-17' }));
  });
});

describe('checkEligibility — 示例档案冒烟', () => {
  const profiles = profilesJson as unknown as StudentProfile[];
  const opp = makeOpp([
    GRADE,
    { id: 'req-age', type: 'age', min: 14, max: 18, label: '14–18 岁', hard: true, source_text: 'Ages 14-18.' },
    { id: 'req-region', type: 'region', countries: ['US'], label: '美国', hard: true, source_text: 'US residents.' },
    { id: 'req-cit', type: 'citizenship', countries: ['US'], label: '美国公民', hard: false, source_text: 'US citizens preferred.' },
    { id: 'req-status', type: 'status', any_of: ['high_school_student'], label: '高中生', hard: true, source_text: 'High school students.' },
    { id: 'req-py', type: 'prerequisite_skill', skill: 'python', label: 'Python', hard: false, source_text: 'Python helpful.' },
    { id: 'req-pf', type: 'portfolio', label: '作品', hard: false, source_text: 'Portfolio optional.' },
    { id: 'req-m', type: 'manual', label: '推荐信', hard: true, source_text: 'One recommendation.' },
  ]);

  it('三个示例档案都能跑，状态合法', () => {
    expect(profiles).toHaveLength(3);
    for (const p of profiles) {
      const r = checkEligibility(p, opp, { today: '2026-11-17' });
      expect(r.items).toHaveLength(8);
      expect(['eligible', 'not_eligible', 'unknown']).toContain(r.overall);
      for (const i of r.items) {
        expect(ELIGIBILITY_STATUSES).toContain(i.status);
        expect(i.confirm_with_official === null).toBe(i.status !== 'unknown');
      }
    }
  });
});

describe('dates', () => {
  it('解析与校验', () => {
    expect(parseISODate('2027-02-29')).toBeNull();
    expect(parseISODate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseISODate('2027/03/01')).toBeNull();
    expect(parseISODate(undefined)).toBeNull();
  });
  it('完整年数', () => {
    expect(wholeYearsBetween({ y: 2026, m: 11, d: 17 }, { y: 2027, m: 11, d: 16 })).toEqual({ years: 0, exact: false });
    expect(wholeYearsBetween({ y: 2026, m: 11, d: 17 }, { y: 2027, m: 11, d: 17 })).toEqual({ years: 1, exact: true });
  });
});
