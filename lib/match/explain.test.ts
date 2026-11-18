/**
 * explainMatch 完整实现（第二阶段第 2 层）：分项理由、grants、资格细节、summary、禁用措辞、坏输入、一致性。
 * 机会 fixture 全部虚构（example.com、is_sample: true），不是真实机会。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { analyzeGaps } from '../gap';
import { analyzeReachability } from '../reachability';
import { explainMatch, findAlternatives } from '.';
import {
  MATCH_REASON_KINDS,
  type MatchExplanation,
  type MatchOptions,
  type MatchReason,
  type MatchReasonKind,
  type Opportunity,
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
    recurring_annually: true,
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

const STUDENT: StudentProfile = {
  id: 'explain-student',
  is_sample: true,
  display_name: 'Sample student (explain test)',
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
  interests: ['climate'],
};

function grant(over: Partial<ResourceGrant> & Pick<ResourceGrant, 'id' | 'type'>): ResourceGrant {
  return {
    student_id: STUDENT.id,
    opportunity_id: null,
    status: 'approved',
    provider: 'Example Org (fictional)',
    is_sample: true,
    ...over,
  };
}

function find(m: MatchExplanation, kind: MatchReasonKind): MatchReason | undefined {
  return m.reasons.find((r) => r.kind === kind);
}

function get(m: MatchExplanation, kind: MatchReasonKind): MatchReason {
  const r = find(m, kind);
  if (!r) throw new Error(`no ${kind} reason`);
  return r;
}

const IN_PERSON = { format: 'in_person' as const, country: 'US', state: 'CA', city: 'Fresno' };

// ───────────────────────────── format ─────────────────────────────

describe('format 理由', () => {
  it('线上 → true', () => {
    expect(get(explainMatch(STUDENT, opp('f-online'), TODAY), 'format').positive).toBe(true);
  });
  it('线下 + 交通 reliable → true，并写出地点', () => {
    const r = get(explainMatch(STUDENT, opp('f-ip', { location: IN_PERSON }), TODAY), 'format');
    expect(r.positive).toBe(true);
    expect(r.text).toContain('Fresno, CA, US');
  });
  it('线下 + 交通 limited → false；hybrid 写明 partly in person', () => {
    const r = get(explainMatch({ ...STUDENT, transport: { level: 'limited' } }, opp('f-hy', { location: { ...IN_PERSON, format: 'hybrid' } }), TODAY), 'format');
    expect(r.positive).toBe(false);
    expect(r.text).toContain('hybrid (partly in person');
  });
  it('线下 + 交通没填 → null，提示在 Skill Passport 补填', () => {
    const r = get(explainMatch({ ...STUDENT, transport: null }, opp('f-ip', { location: IN_PERSON }), TODAY), 'format');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('Skill Passport');
  });
  it('形式缺失 / 无法识别 → null，提示向主办方确认', () => {
    const r = get(explainMatch(STUDENT, opp('f-x', { location: {} as Opportunity['location'] }), TODAY), 'format');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('organizer');
  });
  it('交通 none，但交通障碍已被 approved grant 化解 → true', () => {
    const o = opp('f-ip', { location: IN_PERSON });
    const p = { ...STUDENT, transport: { level: 'none' as const } };
    expect(get(explainMatch(p, o, TODAY), 'format').positive).toBe(false);
    const g = grant({ id: 'g-t', type: 'transport_subsidy', amount_usd: 50 });
    const r = get(explainMatch(p, o, { ...TODAY, grants: [g] }), 'format');
    expect(r.positive).toBe(true);
    expect(r.text).toContain('approved');
  });
});

// ───────────────────────────── time ─────────────────────────────

describe('time 理由', () => {
  it('每周需要 ≤ 可用、截止前时间够 → true，写出剩余天数', () => {
    const r = get(explainMatch(STUDENT, opp('t-ok'), TODAY), 'time');
    expect(r.positive).toBe(true);
    expect(r.text).toContain('76 days are left before the deadline (2027-02-01)');
    expect(r.text).toContain('2 hours per week and you have 5 hours per week');
  });
  it('每周需要 > 可用 → false（引擎描述）', () => {
    const r = get(explainMatch(STUDENT, opp('t-weekly', { time_commitment: { hours_per_week: 10, total_weeks: 4 } }), TODAY), 'time');
    expect(r.positive).toBe(false);
    expect(r.text).toContain('short 5 hours per week');
  });
  it('已过截止日期 → false', () => {
    const r = get(explainMatch(STUDENT, opp('t-past', { deadline: '2026-11-01' }), TODAY), 'time');
    expect(r.positive).toBe(false);
    expect(r.text).toContain('has passed');
  });
  it('机会没写每周小时 → null，提示向主办方确认', () => {
    const r = get(explainMatch(STUDENT, opp('t-null', { time_commitment: { hours_per_week: null, total_weeks: null } }), TODAY), 'time');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('confirm how many hours per week the program needs with the organizer');
  });
  it('没传 today → null（不猜剩余时间）', () => {
    const r = get(explainMatch(STUDENT, opp('t-today')), 'time');
    expect(r.positive).toBeNull();
    expect(r.text).toContain("today's date");
  });
  it('approved time_support 化解 → true；pending 不化解且写明尚未生效', () => {
    const o = opp('t-weekly', { time_commitment: { hours_per_week: 10, total_weeks: 4 } });
    const ok = get(explainMatch(STUDENT, o, { ...TODAY, grants: [grant({ id: 'g-h', type: 'time_support', hours_per_week: 5 })] }), 'time');
    expect(ok.positive).toBe(true);
    expect(ok.text).toContain('time support the organizer approved');
    const pend = get(
      explainMatch(STUDENT, o, { ...TODAY, grants: [grant({ id: 'g-h', type: 'time_support', hours_per_week: 5, status: 'pending' })] }),
      'time',
    );
    expect(pend.positive).toBe(false);
    expect(pend.text).toContain('pending is not approved');
  });
});

// ───────────────────────────── cost ─────────────────────────────

describe('cost 理由', () => {
  it('费用在预算内 → true', () => {
    const r = get(explainMatch(STUDENT, opp('c-ok', { cost: { fee_usd: 10, requires_travel_expense: false } }), TODAY), 'cost');
    expect(r.positive).toBe(true);
    expect(r.text).toContain('within your budget of $20');
  });
  it('超出预算 → false；有资助只注明「有资助 ≠ 已获得」', () => {
    const r = get(
      explainMatch(STUDENT, opp('c-over', { cost: { fee_usd: 50, requires_travel_expense: false, financial_aid_available: true } }), TODAY),
      'cost',
    );
    expect(r.positive).toBe(false);
    expect(r.text).toContain('short $30');
    expect(r.text).toContain('does not mean you have it');
  });
  it('官方费用未知 → null，提示向主办方确认', () => {
    const r = get(explainMatch(STUDENT, opp('c-unk', { cost: { fee_usd: null, requires_travel_expense: false } }), TODAY), 'cost');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('confirm the official fee with the organizer');
  });
  it('预算没填 → null，提示补填', () => {
    const r = get(explainMatch({ ...STUDENT, budget_usd: null }, opp('c-b', { cost: { fee_usd: 10, requires_travel_expense: false } }), TODAY), 'cost');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('fill in how much you can pay yourself');
  });
  it('官方费用未知但必需准备费已超预算 → false，写成 at least $X，与 analyzeGaps 同一个数', () => {
    const o = opp('c-atleast', {
      cost: { fee_usd: null, requires_travel_expense: false },
      preparation: [
        { id: 'prep-kit', title: 'Buy a kit', estimated_hours: 1, estimated_cost_usd: 60, depends_on: [], required_for_application: true },
      ],
    });
    const g = grant({ id: 'g-w', type: 'fee_waiver', amount_usd: 15, opportunity_id: o.id });
    const r = get(explainMatch(STUDENT, o, { ...TODAY, grants: [g] }), 'cost');
    expect(r.positive).toBe(false);
    const gap = analyzeGaps(STUDENT, o, [g], TODAY).items.find((i) => i.basis.kind === 'barrier' && i.basis.barrier_type === 'cost');
    expect(gap?.estimated_cost_usd).toBe(25);
    expect(r.text).toContain('at least $25');
  });
  it('approved fee_waiver 化解 → true；只抵一部分 → false 并写出还差多少；pending 不化解', () => {
    const o = opp('c-over', { cost: { fee_usd: 50, requires_travel_expense: false } });
    const full = get(explainMatch(STUDENT, o, { ...TODAY, grants: [grant({ id: 'g-w', type: 'fee_waiver', amount_usd: null })] }), 'cost');
    expect(full.positive).toBe(true);
    expect(full.text).toContain('fee waiver the organizer approved');
    const part = get(explainMatch(STUDENT, o, { ...TODAY, grants: [grant({ id: 'g-w', type: 'fee_waiver', amount_usd: 10 })] }), 'cost');
    expect(part.positive).toBe(false);
    expect(part.text).toContain('Approved support already covers $10 of it, so about $20 is still uncovered.');
    const pend = get(
      explainMatch(STUDENT, o, { ...TODAY, grants: [grant({ id: 'g-w', type: 'fee_waiver', amount_usd: null, status: 'pending' })] }),
      'cost',
    );
    expect(pend.positive).toBe(false);
    expect(pend.text).toContain('pending is not approved');
  });
});

// ───────────────────────────── device ─────────────────────────────

describe('device 理由', () => {
  const NEEDS = opp('d-laptop', { required_devices: ['laptop', 'webcam'] });
  const PHONE: StudentProfile = { ...STUDENT, devices: ['smartphone', 'webcam'] };

  it('没有必需设备 → true；都有 → true', () => {
    expect(get(explainMatch(STUDENT, opp('d-none'), TODAY), 'device').positive).toBe(true);
    expect(get(explainMatch({ ...STUDENT, devices: ['laptop', 'webcam'] }, NEEDS, TODAY), 'device').positive).toBe(true);
  });
  it('缺设备 → false；档案没填设备 → null', () => {
    const r = get(explainMatch(PHONE, NEEDS, TODAY), 'device');
    expect(r.positive).toBe(false);
    expect(r.text).toContain('a laptop');
    const n = get(explainMatch({ ...STUDENT, devices: null }, NEEDS, TODAY), 'device');
    expect(n.positive).toBeNull();
    expect(n.text).toContain('Skill Passport');
  });
  it('approved device grant 化解 → true，写明是主办方批准的借用；同时 reachable 翻转', () => {
    const g = grant({ id: 'g-l', type: 'device', device: 'laptop', opportunity_id: NEEDS.id });
    const before = explainMatch(PHONE, NEEDS, TODAY);
    const after = explainMatch(PHONE, NEEDS, { ...TODAY, grants: [g] });
    expect(before.reachable).toBe(false);
    expect(after.reachable).toBe(true);
    const r = get(after, 'device');
    expect(r.positive).toBe(true);
    expect(r.text).toBe('The laptop loan the organizer approved covers the laptop requirement.');
  });
  it('pending / 别的学生 / 别的机会 / 缺 opportunity_id 的 grant 不化解', () => {
    const base = { id: 'g-l', type: 'device' as const, device: 'laptop' as const };
    const cases: ResourceGrant[] = [
      grant({ ...base, status: 'pending' }),
      grant({ ...base, student_id: 'someone-else' }),
      grant({ ...base, opportunity_id: 'other-opp' }),
      { ...grant(base), opportunity_id: undefined as unknown as null },
    ];
    for (const g of cases) {
      const r = get(explainMatch(PHONE, NEEDS, { ...TODAY, grants: [g] }), 'device');
      expect(r.positive).toBe(false);
    }
    expect(get(explainMatch(PHONE, NEEDS, { ...TODAY, grants: [cases[0]] }), 'device').text).toContain('pending is not approved');
  });
});

// ───────────────────────────── transport ─────────────────────────────

describe('transport 理由', () => {
  const IP = opp('tr-ip', { location: IN_PERSON });
  const LIMITED: StudentProfile = { ...STUDENT, transport: { level: 'limited' } };

  it('线上机会不输出 transport 理由', () => {
    expect(find(explainMatch(LIMITED, opp('tr-online'), TODAY), 'transport')).toBeUndefined();
  });
  it('线下 + reliable + 不需自费差旅 → true', () => {
    expect(get(explainMatch(STUDENT, IP, TODAY), 'transport').positive).toBe(true);
  });
  it('线下 + limited → false；需要自费差旅（即使 reliable）→ false', () => {
    expect(get(explainMatch(LIMITED, IP, TODAY), 'transport').positive).toBe(false);
    const travel = opp('tr-travel', { location: IN_PERSON, cost: { fee_usd: 0, requires_travel_expense: true } });
    const r = get(explainMatch(STUDENT, travel, TODAY), 'transport');
    expect(r.positive).toBe(false);
    expect(r.text).toContain('pay for your own travel');
  });
  it('交通没填 / 是否自费差旅不清楚 → null', () => {
    expect(get(explainMatch({ ...STUDENT, transport: null }, IP, TODAY), 'transport').positive).toBeNull();
    const unclear = opp('tr-unclear', { location: IN_PERSON, cost: { fee_usd: 0, requires_travel_expense: null } });
    const r = get(explainMatch(STUDENT, unclear, TODAY), 'transport');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('organizer');
  });
  it('approved 交通补助 / 替代参与方式 化解 → true 并写明；pending → false', () => {
    const sub = get(explainMatch(LIMITED, IP, { ...TODAY, grants: [grant({ id: 'g-s', type: 'transport_subsidy', amount_usd: 40 })] }), 'transport');
    expect(sub.positive).toBe(true);
    expect(sub.text).toBe('The travel subsidy the organizer approved covers getting there.');
    const alt = get(explainMatch(LIMITED, IP, { ...TODAY, grants: [grant({ id: 'g-a', type: 'alternative_access' })] }), 'transport');
    expect(alt.positive).toBe(true);
    expect(alt.text).toContain('alternative way to take part');
    const pend = get(explainMatch(LIMITED, IP, { ...TODAY, grants: [grant({ id: 'g-s', type: 'transport_subsidy', status: 'pending' })] }), 'transport');
    expect(pend.positive).toBe(false);
    expect(pend.text).toContain('pending is not approved');
  });
});

// ───────────────────────────── interest / eligibility ─────────────────────────────

describe('interest 理由', () => {
  it('true / false / null', () => {
    expect(get(explainMatch(STUDENT, opp('i'), TODAY), 'interest').positive).toBe(true);
    expect(get(explainMatch({ ...STUDENT, interests: ['music'] }, opp('i'), TODAY), 'interest').positive).toBe(false);
    expect(get(explainMatch({ ...STUDENT, interests: null }, opp('i'), TODAY), 'interest').positive).toBeNull();
    expect(get(explainMatch(STUDENT, opp('i', { fields: [] }), TODAY), 'interest').positive).toBeNull();
  });
});

function req(r: Requirement): Requirement {
  return r;
}

describe('eligibility 理由', () => {
  it('eligible → true', () => {
    expect(get(explainMatch(STUDENT, opp('e-ok'), TODAY), 'eligibility').positive).toBe(true);
  });

  it('not_eligible：指出具体要求，并区分「以后可能满足」/「无法改变」/「可以自己补上」', () => {
    const o = opp('e-no', {
      requirements: [
        req({ id: 'req-grade', type: 'grade', min: 12, label: 'Seniors only', hard: true, source_text: 'Grade 12.' }),
        req({ id: 'req-region', type: 'region', countries: ['CA'], label: 'Canada residents', hard: true, source_text: 'Canada only.' }),
        req({ id: 'req-skill', type: 'prerequisite_skill', skill: 'python', label: 'Python basics', hard: true, source_text: 'Python.' }),
      ],
    });
    const r = get(explainMatch(STUDENT, o, TODAY), 'eligibility');
    expect(r.positive).toBe(false);
    expect(r.text).toContain("You don't meet 3 hard official requirements");
    expect(r.text).toContain('"Seniors only" (you may meet it later as you move up a grade)');
    expect(r.text).toContain('"Canada residents" (not something you can change by preparing)');
    expect(r.text).toContain('"Python basics" (something you can work on yourself)');
    expect(r.text).toContain('check the official requirements again');
  });

  it('高于上限的年级 → 无法改变，不说以后可能满足', () => {
    const o = opp('e-max', { requirements: [req({ id: 'req-grade', type: 'grade', min: 6, max: 8, label: 'Middle school', hard: true, source_text: 'Grades 6-8.' })] });
    const r = get(explainMatch(STUDENT, o, TODAY), 'eligibility');
    expect(r.text).toContain('not something you can change');
    expect(r.text).not.toContain('may meet it later');
  });

  it('不满足的要求多于 3 条：只列 3 条并说明还有几条；偏好（非硬性）不列', () => {
    const many = [1, 2, 3, 4, 5].map((n) =>
      req({ id: `req-r${n}`, type: 'region', countries: ['CA'], label: `Region rule ${n}`, hard: true, source_text: `Rule ${n}.` }),
    );
    many.push(req({ id: 'req-soft', type: 'region', countries: ['CA'], label: 'Soft rule', hard: false, source_text: 'Preferred.' }));
    const r = get(explainMatch(STUDENT, opp('e-many', { requirements: many }), TODAY), 'eligibility');
    expect(r.text).toContain('Region rule 3');
    expect(r.text).not.toContain('Region rule 4');
    expect(r.text).toContain('and 2 more');
    expect(r.text).not.toContain('Soft rule');
  });

  it('unknown：列出待确认 / 待补填的项', () => {
    const o = opp('e-unk', {
      requirements: [
        req({ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12.' }),
        req({ id: 'req-m', type: 'manual', label: 'Interview', hard: true, source_text: 'Interview required.' }),
      ],
    });
    const r = get(explainMatch({ ...STUDENT, grade: null }, o, TODAY), 'eligibility');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('"Grades 9–12" (fill in your grade in your Skill Passport)');
    expect(r.text).toContain('"Interview" (confirm with the organizer)');
  });

  it('unknown 多于 3 条：列 3 条 + 还有几条', () => {
    const many = [1, 2, 3, 4].map((n) => req({ id: `req-m${n}`, type: 'manual', label: `Manual ${n}`, hard: true, source_text: `M${n}.` }));
    const r = get(explainMatch(STUDENT, opp('e-unk4', { requirements: many }), TODAY), 'eligibility');
    expect(r.text).toContain("We can't check 4 hard requirements yet");
    expect(r.text).toContain('and 1 more');
    expect(r.text).not.toContain('Manual 4');
  });
});

// ───────────────────────────── summary ─────────────────────────────

const ENCOURAGING = /\b(apply now|go for it|should apply|great fit|good fit|strong fit|worth applying|you can apply|within reach)\b/i;

describe('summary', () => {
  it('not_eligible：说明本届不能申请与原因，不含鼓励申请的措辞', () => {
    const o = opp('s-no', { requirements: [req({ id: 'req-grade', type: 'grade', min: 13, label: 'Undergraduates', hard: true, source_text: 'Undergrads.' })] });
    const m = explainMatch(STUDENT, o, TODAY);
    expect(m.summary).toBe(`You can't apply this round because you don't meet the hard requirement "Undergraduates".`);
    expect(m.summary).not.toMatch(ENCOURAGING);
  });
  it('eligibility unknown：先说要向官方确认', () => {
    const o = opp('s-unk', { requirements: [req({ id: 'req-m', type: 'manual', label: 'Interview', hard: true, source_text: 'Interview.' })] });
    const m = explainMatch(STUDENT, o, TODAY);
    expect(m.summary).toMatch(/^First confirm with the organizer/);
    expect(m.summary).toContain('"Interview"');
  });
  it('eligible + reachable true：within reach，并注明不代表录取；最后说兴趣', () => {
    const m = explainMatch(STUDENT, opp('s-ok'), TODAY);
    expect(m.reachable).toBe(true);
    expect(m.summary).toContain('within reach (this is not a prediction of admission)');
    expect(m.summary).toContain('it matches your interests (climate)');
    expect(m.summary.indexOf('within reach')).toBeLessThan(m.summary.indexOf('interests'));
  });
  it('eligible + reachable false：说出障碍类别', () => {
    const m = explainMatch(STUDENT, opp('s-cost', { cost: { fee_usd: 50, requires_travel_expense: false } }), TODAY);
    expect(m.summary).toContain('not realistic right now because of an unresolved cost barrier');
  });
  it('eligible + reachable null：说还缺什么信息', () => {
    const m = explainMatch(STUDENT, opp('s-null', { cost: { fee_usd: null, requires_travel_expense: false } }), TODAY);
    expect(m.reachable).toBeNull();
    expect(m.summary).toContain('we still need the official fee');
  });
  it('已过截止：summary 说截止已过', () => {
    const m = explainMatch(STUDENT, opp('s-past', { deadline: '2026-11-01' }), TODAY);
    expect(m.summary).toContain('the deadline for this round has passed');
  });
});

// ───────────────────────────── 评审回归 ─────────────────────────────

describe('评审回归', () => {
  it('cost：官方费用未知、必需准备费 60 > 预算 50、已批准 $20 减免补足 → 如实说高于预算、靠支持才放得下、总数可能更高', () => {
    const o = opp('rg-cost', {
      cost: { fee_usd: null, requires_travel_expense: false },
      preparation: [
        { id: 'prep-kit', title: 'Buy a kit', estimated_hours: 1, estimated_cost_usd: 60, depends_on: [], required_for_application: true },
      ],
    });
    const p = { ...STUDENT, budget_usd: 50 };
    const g = grant({ id: 'g-w', type: 'fee_waiver', amount_usd: 20, opportunity_id: o.id });
    const r = get(explainMatch(p, o, { ...TODAY, grants: [g] }), 'cost');
    expect(r.positive).toBeNull();
    expect(r.text).not.toContain('fits your budget of $50');
    expect(r.text).toContain('Required prep alone (about $60) is more than your budget of $50');
    expect(r.text).toContain('only fits once the $20 of support the organizer approved is added');
    expect(r.text).toContain('the official fee may make the total higher');
    // 没有 grant 时：引擎给未化解障碍 → false。
    expect(get(explainMatch(p, o, TODAY), 'cost').positive).toBe(false);
    // 准备费本身就在预算内：仍是「放得下，但总数可能更多」。
    const fits = get(explainMatch({ ...STUDENT, budget_usd: 80 }, o, TODAY), 'cost');
    expect(fits.text).toContain('Required prep alone (about $60) fits your budget of $80, but the total may be more.');
  });

  it('eligibility unknown：用到的档案字段里任意一个缺失（region.state）→ 提示补填州 / 省，不是向主办方确认', () => {
    const o = opp('rg-state', {
      requirements: [req({ id: 'req-st', type: 'region', countries: ['US'], states: ['CA'], label: 'California residents', hard: true, source_text: 'CA only.' })],
    });
    const m = explainMatch({ ...STUDENT, region: { country: 'US' } }, o, TODAY);
    expect(m.eligibility_overall).toBe('unknown');
    const r = get(m, 'eligibility');
    expect(r.text).toContain('"California residents" (fill in your state / province in your Skill Passport)');
    expect(r.text).not.toContain('confirm with the organizer');
  });

  it('eligibility unknown：生日不确定的年龄要求 → 向主办方确认（以引擎提示为准）', () => {
    const o = opp('rg-age', {
      deadline: '2027-06-01',
      requirements: [req({ id: 'req-age', type: 'age', min: 17, label: 'Age 17+', hard: true, source_text: '17 or older.' })],
    });
    const r = get(explainMatch(STUDENT, o, TODAY), 'eligibility');
    expect(r.positive).toBeNull();
    expect(r.text).toContain('"Age 17+" (confirm with the organizer)');
  });

  it('summary：不满足的硬性要求全部可自己补上 → 不说本届不能申请', () => {
    const o = opp('rg-fix', {
      requirements: [
        req({ id: 'req-skill', type: 'prerequisite_skill', skill: 'python', label: 'Python basics', hard: true, source_text: 'Python.' }),
        req({ id: 'req-pf', type: 'portfolio', label: 'A project sample', hard: true, source_text: 'Portfolio.' }),
      ],
    });
    const m = explainMatch(STUDENT, o, TODAY);
    expect(m.eligibility_overall).toBe('not_eligible');
    expect(m.summary).toBe(
      `Right now you don't meet the hard requirement "Python basics" (and 1 more hard requirement) — these are things you can work on yourself.`,
    );
    expect(m.summary).not.toContain("can't apply");
    expect(m.summary).not.toMatch(ENCOURAGING);
    const one = explainMatch(STUDENT, opp('rg-fix1', { requirements: [o.requirements[0]] }), TODAY);
    expect(one.summary).toBe(`Right now you don't meet the hard requirement "Python basics" — this is something you can work on yourself.`);
  });

  it('summary：fixable 与无法改变 / 以后才可能满足的混在一起 → 保留「本届不能申请」', () => {
    const skill = req({ id: 'req-skill', type: 'prerequisite_skill', skill: 'python', label: 'Python basics', hard: true, source_text: 'Python.' });
    const region = req({ id: 'req-region', type: 'region', countries: ['CA'], label: 'Canada residents', hard: true, source_text: 'Canada only.' });
    const grade = req({ id: 'req-grade', type: 'grade', min: 12, label: 'Seniors only', hard: true, source_text: 'Grade 12.' });
    expect(explainMatch(STUDENT, opp('rg-mix1', { requirements: [skill, region] }), TODAY).summary).toMatch(/^You can't apply this round/);
    expect(explainMatch(STUDENT, opp('rg-mix2', { requirements: [skill, grade] }), TODAY).summary).toMatch(/^You can't apply this round/);
  });

  it('interest：兴趣为空数组 → null，提示可在 Skill Passport 补充', () => {
    const r = get(explainMatch({ ...STUDENT, interests: [] }, opp('rg-i'), TODAY), 'interest');
    expect(r.positive).toBeNull();
    expect(r.text).toContain("You haven't added any interests yet");
    expect(r.text).toContain('Skill Passport');
    expect(r.text).not.toContain('None of your interests');
  });

  it('format：线下 + reliable + 需要自费差旅（未化解）→ 文字指向 transport 那条；已化解或不需差旅时不加', () => {
    const travel = opp('rg-travel', { location: IN_PERSON, cost: { fee_usd: 0, requires_travel_expense: true } });
    const r = get(explainMatch(STUDENT, travel, TODAY), 'format');
    expect(r.positive).toBe(true);
    expect(r.text).toContain('see the transportation reason');
    const covered = get(explainMatch(STUDENT, travel, { ...TODAY, grants: [grant({ id: 'g-s', type: 'transport_subsidy', amount_usd: 40 })] }), 'format');
    expect(covered.text).not.toContain('see the transportation reason');
    expect(get(explainMatch(STUDENT, opp('rg-ip', { location: IN_PERSON }), TODAY), 'format').text).not.toContain('see the transportation reason');
  });
});

// ───────────────────────────── 横向约束 ─────────────────────────────

const FIXTURES: Opportunity[] = [
  opp('x-online'),
  opp('x-ip', { location: IN_PERSON, required_devices: ['laptop', 'home_internet'] }),
  opp('x-cost', { cost: { fee_usd: 50, requires_travel_expense: true, financial_aid_available: true }, location: IN_PERSON }),
  opp('x-unk', { cost: { fee_usd: null, requires_travel_expense: null }, time_commitment: { hours_per_week: null, total_weeks: null }, deadline: null }),
  opp('x-past', { deadline: '2026-01-01' }),
  opp('x-no', { requirements: [req({ id: 'req-grade', type: 'grade', min: 13, label: 'Undergraduates', hard: true, source_text: 'Undergrads.' })] }),
  opp('x-man', { requirements: [req({ id: 'req-m', type: 'manual', label: 'Interview', hard: true, source_text: 'Interview.' })] }),
];
const FIXTURE_PROFILES: StudentProfile[] = [
  STUDENT,
  { ...STUDENT, id: 'x-p2', transport: { level: 'none' }, devices: [], budget_usd: 0, hours_per_week_available: 1, interests: null },
  { ...STUDENT, id: 'x-p3', transport: null, devices: null, budget_usd: null, hours_per_week_available: null, grade: null },
];
const GRANT_SETS = (p: StudentProfile): ResourceGrant[][] => [
  [],
  [
    grant({ id: 'g1', type: 'device', device: 'laptop', student_id: p.id }),
    grant({ id: 'g2', type: 'transport_subsidy', amount_usd: 30, student_id: p.id }),
    grant({ id: 'g3', type: 'fee_waiver', amount_usd: null, student_id: p.id, status: 'pending' }),
    grant({ id: 'g4', type: 'time_support', hours_per_week: 3, student_id: p.id }),
  ],
];

function allCases(): { p: StudentProfile; o: Opportunity; opts: MatchOptions | undefined }[] {
  const out: { p: StudentProfile; o: Opportunity; opts: MatchOptions | undefined }[] = [];
  const realOpps = opportunitiesJson as unknown as Opportunity[];
  const realProfiles = profilesJson as unknown as StudentProfile[];
  for (const p of [...realProfiles, ...FIXTURE_PROFILES]) {
    for (const o of [...realOpps, ...FIXTURES]) {
      out.push({ p, o, opts: undefined });
      for (const grants of GRANT_SETS(p)) out.push({ p, o, opts: { ...TODAY, grants } });
    }
  }
  return out;
}

describe('横向约束（全部真实机会 × 4 个示例档案 + 测试夹具）', () => {
  const cases = allCases();

  it('覆盖了真实数据：全部机会 × 4 个示例档案', () => {
    expect((opportunitiesJson as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect((profilesJson as unknown[]).length).toBe(4);
  });

  it('所有 text 与 summary 不含「数字 + %」、score / rank / rating / match level / percent', () => {
    for (const { p, o, opts } of cases) {
      const m = explainMatch(p, o, opts);
      for (const t of [m.summary, ...m.reasons.map((r) => r.text)]) {
        expect(t, `${p.id}×${o.id}`).not.toMatch(/\d\s*%/);
        expect(t, `${p.id}×${o.id}`).not.toMatch(/\b(score|scores|scored|rank|ranks|ranked|ranking|rating|percent|percentage|match level)\b/i);
        expect(t.length).toBeGreaterThan(0);
      }
    }
  });

  it('理由按 MATCH_REASON_KINDS 顺序、每个种类最多一条；reachability 理由与 reachable 一致', () => {
    for (const { p, o, opts } of cases) {
      const m = explainMatch(p, o, opts);
      const idx = m.reasons.map((r) => MATCH_REASON_KINDS.indexOf(r.kind));
      expect(idx.every((i) => i >= 0)).toBe(true);
      for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
      expect(get(m, 'reachability').positive).toBe(m.reachable);
    }
  });

  it('not_eligible 的 summary 都不含鼓励申请的措辞', () => {
    for (const { p, o, opts } of cases) {
      const m = explainMatch(p, o, opts);
      if (m.eligibility_overall === 'not_eligible') expect(m.summary).not.toMatch(ENCOURAGING);
    }
  });

  it('同一组 grants 下 reachable / eligibility_overall 与 analyzeReachability、analyzeGaps 一致', () => {
    for (const { p, o, opts } of cases) {
      const m = explainMatch(p, o, opts);
      const grants = opts?.grants ?? [];
      const evalOpts = opts ? { today: opts.today } : undefined;
      const r = analyzeReachability(p, o, grants, evalOpts);
      const g = analyzeGaps(p, o, grants, evalOpts);
      expect(m.reachable).toBe(r.reachable);
      expect(m.eligibility_overall).toBe(r.eligibility.overall);
      expect(m.reachable).toBe(g.reachable);
      expect(m.eligibility_overall).toBe(g.eligibility_overall);
    }
  });

  it('同输入两次调用深度相等，且不修改输入', () => {
    for (const { p, o, opts } of cases) {
      const pc = structuredClone(p);
      const oc = structuredClone(o);
      const optsc = structuredClone(opts);
      expect(explainMatch(pc, oc, optsc)).toEqual(explainMatch(pc, oc, optsc));
      expect(pc).toEqual(p);
      expect(oc).toEqual(o);
      expect(optsc).toEqual(opts);
    }
  });

  it('公平性：只改 school_name / display_name，结果深度相等', () => {
    for (const { p, o, opts } of cases) {
      const base = explainMatch(p, o, opts);
      expect(explainMatch({ ...p, school_name: 'Another School (fictional)' }, o, opts)).toStrictEqual(base);
      expect(explainMatch({ ...p, display_name: 'Another name (sample)' }, o, opts)).toStrictEqual(base);
    }
  });
});

describe('与 findAlternatives 一致：grant 化解障碍后不再受阻', () => {
  it('设备障碍：没 grant 时 findAlternatives 给出同领域替代；approved grant 后 explainMatch 可达、findAlternatives 返回 []', () => {
    const target = opp('fa-target', { required_devices: ['laptop'] });
    const cand = opp('fa-cand');
    const phone = { ...STUDENT, devices: ['smartphone' as const] };
    const g = grant({ id: 'g-l', type: 'device', device: 'laptop' });
    expect(explainMatch(phone, target, TODAY).reachable).toBe(false);
    expect(findAlternatives(phone, target, [cand], TODAY).length).toBeGreaterThan(0);
    expect(explainMatch(phone, target, { ...TODAY, grants: [g] }).reachable).toBe(true);
    expect(findAlternatives(phone, target, [cand], { ...TODAY, grants: [g] })).toEqual([]);
  });
});

// ───────────────────────────── 坏输入 ─────────────────────────────

describe('坏输入不抛异常', () => {
  const weird: unknown[] = [null, undefined, 'x', 42, [], {}, { id: 3 }];
  it('profile / opp / options 任意组合不抛错', () => {
    for (const p of [...weird, STUDENT]) {
      for (const o of [...weird, opp('w')]) {
        for (const opts of [undefined, null, 'x', { today: 5 }, { grants: 'x' }, { grants: [null, 1, 'g'] }, TODAY]) {
          expect(() => explainMatch(p as StudentProfile, o as Opportunity, opts as MatchOptions)).not.toThrow();
        }
      }
    }
  });

  it('机会数据不完整 → eligibility_overall unknown、reachable null，提示查看官网', () => {
    const m = explainMatch(STUDENT, { id: 'broken' } as unknown as Opportunity, TODAY);
    expect(m.eligibility_overall).toBe('unknown');
    expect(m.reachable).toBeNull();
    expect(get(m, 'eligibility').positive).toBeNull();
    expect(m.summary).toContain('official page');
  });

  it('档案字段损坏 → 说明是档案问题（不归咎于机会），与 analyzeGaps 结论一致', () => {
    const bad = { ...STUDENT, grade: 'eleven', devices: 'laptop' } as unknown as StudentProfile;
    const o = opp('w-bad');
    const m = explainMatch(bad, o, TODAY);
    expect(m.eligibility_overall).toBe('unknown');
    expect(m.reachable).toBeNull();
    const e = get(m, 'eligibility');
    expect(e.positive).toBeNull();
    expect(e.text).toContain('your grade and which devices you have');
    expect(e.text).toContain('Skill Passport');
    expect(e.text).not.toContain('opportunity data');
    expect(m.summary).toContain('your profile');
    const g = analyzeGaps(bad, o, [], TODAY);
    expect(g.reachable).toBe(m.reachable);
    expect(g.eligibility_overall).toBe(m.eligibility_overall);
  });
});
