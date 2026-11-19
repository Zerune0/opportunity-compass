/**
 * 参与形式未知（location.format = 'unknown'）与「线下地点不明确」（只有国家）的规则。
 * 全部用文件内的虚构机会（example.com、is_sample: true），不依赖真实数据。
 */
import { describe, expect, it } from 'vitest';
import { analyzeReachability } from './reachability';
import { explainMatch } from './match';
import { analyzeGaps } from './gap';
import { opportunityWarnings, validateOpportunity } from './validation';
import { partitionOpportunities } from './data';
import { buildBackup, parseBackup } from './backup';
import type { MatchExplanation, Opportunity, OpportunityLocation, ResourceGrant, StudentProfile } from './types';

const TODAY = '2026-11-19';
const OPTS = { today: TODAY };

// 虚构测试数据（不是真实机会），链接用 example.com。
function makeOpp(location: OpportunityLocation, extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'fictional-format-test',
    title: 'Fictional format test program (not a real opportunity)',
    organizer: 'Example Org (fictional)',
    category: 'fellowship',
    fields: ['computer_science'],
    summary: 'Fictional opportunity used only in unit tests.',
    official_url: 'https://example.com/fictional-format-test',
    verified_on: '2026-11-19',
    verified_by: 'test-fixture',
    deadline: '2027-03-01',
    location,
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 5, total_weeks: 6 },
    required_devices: [],
    requirements: [
      { id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9-12', hard: true, source_text: 'Open to students in grades 9-12.' },
    ],
    preparation: [],
    recurring_annually: true,
    is_sample: true,
    ...extra,
  };
}

const UNKNOWN = makeOpp({ format: 'unknown', country: null, state: null, city: null });

/** 信息完整、交通可靠的虚构学生。 */
const GOOD: StudentProfile = {
  id: 'p-format',
  is_sample: true,
  display_name: 'Test student',
  school_name: 'Example High School',
  grade: 10,
  hours_per_week_available: 10,
  budget_usd: 100,
  transport: { level: 'reliable' },
  devices: ['laptop', 'home_internet'],
  skills: [],
  interests: ['computer_science'],
  evidence: [],
};
const LIMITED: StudentProfile = { ...GOOD, transport: { level: 'limited' } };

function grant(g: Partial<ResourceGrant> & Pick<ResourceGrant, 'id' | 'type'>): ResourceGrant {
  return {
    student_id: GOOD.id,
    opportunity_id: 'fictional-format-test',
    status: 'approved',
    provider: 'Example Org (fictional)',
    is_sample: true,
    ...g,
  };
}

const byKind = (m: MatchExplanation, kind: string) => m.reasons.find((r) => r.kind === kind);

describe('format unknown — 数据层', () => {
  it('通过校验；partitionOpportunities 不拒绝；提醒「形式未确认」，不再给「线下但差旅未知」那条', () => {
    expect(validateOpportunity(UNKNOWN)).toEqual([]);
    const withNullTravel = makeOpp(UNKNOWN.location, { cost: { fee_usd: 0, requires_travel_expense: null } });
    const part = partitionOpportunities([withNullTravel]);
    expect(part.rejected).toEqual([]);
    expect(part.opportunities.map((o) => o.id)).toEqual(['fictional-format-test']);
    const w = opportunityWarnings(withNullTravel);
    expect(w.some((x) => x.includes('location.format'))).toBe(true);
    expect(w.some((x) => x.includes('cost.requires_travel_expense'))).toBe(false);
    // 不认识的取值仍然被拒绝。
    expect(validateOpportunity(makeOpp({ format: 'remote' as never })).length).toBeGreaterThan(0);
  });

  it('备份往返：含 unknown 形式的用户发布机会，导出再导入后还在', () => {
    const posted: Opportunity = { ...UNKNOWN, id: 'posted-unknown', source_tier: 'user_posted', is_sample: true };
    const file = buildBackup({ user_posted_opportunities: [posted] }, '2026-11-19');
    const parsed = parseBackup(JSON.stringify(file));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.backup.data.user_posted_opportunities).toEqual([posted]);
  });
});

describe('format unknown — analyzeReachability', () => {
  it('不出交通障碍；missing_info 含形式；其余信息齐全时 reachable 为 null（不是 true）', () => {
    const r = analyzeReachability(GOOD, UNKNOWN, [], OPTS);
    expect(r.barriers).toEqual([]);
    expect(r.missing_info).toEqual(['opportunity.location.format']);
    expect(r.reachable).toBeNull();
    expect(r.summary).toContain('online or in person');
  });

  it('交通受限 / 没有交通也不当作线下：不造交通障碍，仍为 null', () => {
    for (const level of ['limited', 'none'] as const) {
      const r = analyzeReachability({ ...GOOD, transport: { level } }, UNKNOWN, [], OPTS);
      expect(r.barriers.filter((b) => b.type === 'transport')).toEqual([]);
      expect(r.reachable).toBeNull();
    }
  });

  it('另有未化解障碍（缺设备）→ false', () => {
    const opp = makeOpp(UNKNOWN.location, { required_devices: ['webcam'] });
    const r = analyzeReachability(GOOD, opp, [], OPTS);
    expect(r.missing_info).toContain('opportunity.location.format');
    expect(r.reachable).toBe(false);
  });

  it('给了交通补助 / 替代参与方式 grant 也不会变成 true', () => {
    const grants = [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 }), grant({ id: 'g-alt', type: 'alternative_access' })];
    for (const p of [GOOD, LIMITED]) {
      const r = analyzeReachability(p, UNKNOWN, grants, OPTS);
      expect(r.reachable).toBeNull();
      expect(r.missing_info).toContain('opportunity.location.format');
    }
  });

  it('形式未知时不当作「不需要到场」：交通没填、差旅不明照常列为缺失', () => {
    const opp = makeOpp(UNKNOWN.location, { cost: { fee_usd: 0, requires_travel_expense: null } });
    const r = analyzeReachability({ ...GOOD, transport: null }, opp, [], OPTS);
    expect(r.missing_info).toEqual(['profile.transport', 'opportunity.cost.requires_travel_expense', 'opportunity.location.format']);
    expect(r.reachable).toBeNull();
  });

  it('硬性资格不满足照常 not_eligible、reachable false', () => {
    const r = analyzeReachability({ ...GOOD, grade: 7 }, UNKNOWN, [], OPTS);
    expect(r.eligibility.overall).toBe('not_eligible');
    expect(r.reachable).toBe(false);
  });
});

describe('format unknown — explainMatch / analyzeGaps', () => {
  it('format 与 transport 两条理由都是 null；summary 说得出缺的是参与形式', () => {
    const m = explainMatch(GOOD, UNKNOWN, OPTS);
    expect(m.reachable).toBeNull();
    expect(byKind(m, 'format')?.positive).toBeNull();
    expect(byKind(m, 'format')?.text).toBe('The organizer has not said whether this is online or in person. Confirm the format with the organizer.');
    expect(byKind(m, 'transport')?.positive).toBeNull();
    expect(byKind(m, 'transport')?.text).toContain('whether it takes place online or in person');
    expect(m.summary).toContain('whether it takes place online or in person');
  });

  it('文字不把它说成 hybrid / 线上，不含 % / score / rank', () => {
    for (const p of [GOOD, LIMITED, { ...GOOD, transport: null }]) {
      const m = explainMatch(p, UNKNOWN, OPTS);
      const texts = [...m.reasons.map((r) => r.text), m.summary];
      for (const t of texts) {
        expect(t.toLowerCase()).not.toContain('hybrid');
        // 「online」只能出现在「online or in person」这种「没说是线上还是线下」的陈述里。
        expect(t.replace(/online or in person/g, '').toLowerCase()).not.toContain('online');
        expect(t).not.toContain('%');
        expect(t).not.toMatch(/score|rank/i);
      }
    }
  });

  it('analyzeGaps 把形式列进 unknown_info，标题与行动是可读文字（不露字段路径）', () => {
    const g = analyzeGaps(GOOD, UNKNOWN, [], OPTS);
    const item = g.items.find((i) => i.id === 'unknown_info:opportunity.location.format');
    expect(item).toBeDefined();
    expect(item!.title).toBe('Not clear from the organizer: whether it takes place online or in person');
    expect(item!.action).toContain('Confirm whether it takes place online or in person with the organizer');
    for (const t of [item!.title, item!.detail, item!.action ?? '']) expect(t).not.toContain('opportunity.');
    expect(g.reachable).toBeNull();
  });
});

describe('对照：online / in_person / hybrid 行为不变', () => {
  const placed = { country: 'US', state: 'CA', city: 'Example City' };

  it('online：可达、format 理由 true、没有 transport 理由', () => {
    const opp = makeOpp({ format: 'online', country: null, state: null, city: null });
    const m = explainMatch(GOOD, opp, OPTS);
    expect(m.reachable).toBe(true);
    expect(byKind(m, 'format')?.positive).toBe(true);
    expect(byKind(m, 'transport')).toBeUndefined();
    expect(analyzeReachability(GOOD, opp, [], OPTS).missing_info).toEqual([]);
  });

  it('in_person / hybrid（有州和城市）：reliable → 可达、format true；limited → 交通障碍、format false；补助化解 → true', () => {
    for (const format of ['in_person', 'hybrid'] as const) {
      const opp = makeOpp({ format, ...placed });
      const ok = explainMatch(GOOD, opp, OPTS);
      expect(ok.reachable).toBe(true);
      expect(byKind(ok, 'format')?.positive).toBe(true);
      expect(byKind(ok, 'transport')?.positive).toBe(true);
      const bad = analyzeReachability(LIMITED, opp, [], OPTS);
      expect(bad.barriers.map((b) => b.type)).toEqual(['transport']);
      expect(bad.reachable).toBe(false);
      expect(byKind(explainMatch(LIMITED, opp, OPTS), 'format')?.positive).toBe(false);
      const fixed = analyzeReachability(LIMITED, opp, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 })], OPTS);
      expect(fixed.reachable).toBe(true);
    }
  });
});

describe('线下地点不明确（只有国家）', () => {
  const countryOnly = makeOpp({ format: 'in_person', country: 'US', state: null, city: null });

  it('× 交通 reliable → format 理由 null、missing_info 含地点、reachable 不为 true', () => {
    const r = analyzeReachability(GOOD, countryOnly, [], OPTS);
    expect(r.barriers).toEqual([]);
    expect(r.missing_info).toEqual(['opportunity.location']);
    expect(r.reachable).toBeNull();
    const m = explainMatch(GOOD, countryOnly, OPTS);
    expect(byKind(m, 'format')?.positive).toBeNull();
    expect(byKind(m, 'format')?.text).toBe(
      "It is in person, but the organizer has not said where (only the country is given), so we can't tell whether you can get there. Confirm the location with the organizer.",
    );
    expect(byKind(m, 'transport')?.positive).toBeNull();
    const gap = analyzeGaps(GOOD, countryOnly, [], OPTS).items.find((i) => i.id === 'unknown_info:opportunity.location');
    expect(gap?.title).toBe('Not clear from the organizer: where exactly it takes place');
  });

  it('hybrid 只有国家同样处理；交通没填时也记地点', () => {
    const hybrid = makeOpp({ format: 'hybrid', country: 'US' });
    expect(analyzeReachability(GOOD, hybrid, [], OPTS).missing_info).toEqual(['opportunity.location']);
    expect(byKind(explainMatch(GOOD, hybrid, OPTS), 'format')?.positive).toBeNull();
    const r = analyzeReachability({ ...GOOD, transport: null }, countryOnly, [], OPTS);
    expect(r.missing_info).toEqual(['profile.transport', 'opportunity.location']);
  });

  it('× 交通 limited → 仍是确定的交通障碍、format 理由 false、不记地点', () => {
    const r = analyzeReachability(LIMITED, countryOnly, [], OPTS);
    expect(r.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(r.missing_info).toEqual([]);
    expect(r.reachable).toBe(false);
    expect(byKind(explainMatch(LIMITED, countryOnly, OPTS), 'format')?.positive).toBe(false);
  });

  it('需要自费差旅（已有交通障碍）→ 不变：障碍照旧、不记地点', () => {
    const opp = makeOpp(countryOnly.location, { cost: { fee_usd: 0, requires_travel_expense: true } });
    const r = analyzeReachability(GOOD, opp, [], OPTS);
    expect(r.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(r.missing_info).toEqual([]);
    expect(r.reachable).toBe(false);
  });

  it('另有未化解障碍时为 false；补助 grant 不会因此让它变成 true', () => {
    const opp = makeOpp(countryOnly.location, { required_devices: ['webcam'] });
    expect(analyzeReachability(GOOD, opp, [], OPTS).reachable).toBe(false);
    const g = analyzeReachability(GOOD, countryOnly, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 })], OPTS);
    expect(g.reachable).toBeNull();
  });

  it('有州无城市、有城市无州 → 与之前相同：可达、format true、不记地点', () => {
    for (const loc of [
      { format: 'in_person', country: 'US', state: 'CA', city: null },
      { format: 'in_person', country: 'US', state: null, city: 'Example City' },
    ] as OpportunityLocation[]) {
      const opp = makeOpp(loc);
      const r = analyzeReachability(GOOD, opp, [], OPTS);
      expect(r.missing_info).toEqual([]);
      expect(r.reachable).toBe(true);
      expect(byKind(explainMatch(GOOD, opp, OPTS), 'format')?.positive).toBe(true);
    }
  });

  it('空白字符串的州 / 城市不算明确', () => {
    const opp = makeOpp({ format: 'in_person', country: 'US', state: '  ', city: '' });
    expect(analyzeReachability(GOOD, opp, [], OPTS).missing_info).toEqual(['opportunity.location']);
  });
});

describe('地点文字不声称「只有国家」', () => {
  it('完全没有地点的 hybrid：summary 与 format / reachability 理由都不含 "only the country"', () => {
    const none = makeOpp({ format: 'hybrid', country: null, state: null, city: null });
    const r = analyzeReachability(GOOD, none, [], OPTS);
    expect(r.missing_info).toEqual(['opportunity.location']);
    expect(r.summary).toContain('where exactly it takes place (the state or city is not given)');
    expect(r.summary).not.toContain('only the country');
    const m = explainMatch(GOOD, none, OPTS);
    expect(byKind(m, 'format')?.text).toContain('the organizer has not said where, so');
    for (const kind of ['format', 'reachability', 'transport']) expect(byKind(m, kind)?.text).not.toContain('only the country');
    expect(m.summary).not.toContain('only the country');
  });

  it('有国家时 format 理由可以说 "only the country is given"', () => {
    const m = explainMatch(GOOD, makeOpp({ format: 'hybrid', country: 'US' }), OPTS);
    expect(byKind(m, 'format')?.text).toContain('(only the country is given)');
  });
});

describe('地点不明确：结果表（不确定就不说可达）', () => {
  type Support = 'none' | 'subsidy' | 'alt' | 'pending';
  const SUPPORTS: Support[] = ['none', 'subsidy', 'alt', 'pending'];
  const LEVELS = ['reliable', 'limited', 'none'] as const;
  const supportGrants = (s: Support): ResourceGrant[] => {
    if (s === 'subsidy') return [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 })];
    if (s === 'alt') return [grant({ id: 'g-alt', type: 'alternative_access' })];
    if (s === 'pending') return [grant({ id: 'g-wait', type: 'transport_subsidy', amount_usd: 50, status: 'pending' })];
    return [];
  };
  const cells = LEVELS.flatMap((level) => [true, false].flatMap((travel) => SUPPORTS.map((s) => [level, travel, s] as const)));

  /** 是否有交通障碍：交通 limited / none，或需要自费差旅。 */
  const hasBarrier = (level: string, travel: boolean) => level !== 'reliable' || travel;

  it.each(cells)('只有国家：交通 %s × 自费差旅 %s × 支持 %s', (level, travel, s) => {
    const opp = makeOpp({ format: 'in_person', country: 'US', state: null, city: null }, { cost: { fee_usd: 0, requires_travel_expense: travel } });
    const profile = { ...GOOD, transport: { level } };
    const grants = supportGrants(s);
    const r = analyzeReachability(profile, opp, grants, OPTS);
    const m = explainMatch(profile, opp, { today: TODAY, grants });
    const resolved = s === 'subsidy' || s === 'alt';
    // 有障碍且未化解 → false（确定）；其余 → null（地点不明确）。没有一格是 true。
    const expected = hasBarrier(level, travel) && !resolved ? false : null;
    expect(r.reachable).toBe(expected);
    expect(m.reachable).toBe(expected);
    expect(r.missing_info.includes('opportunity.location')).toBe(expected === null);
    expect(r.summary).not.toContain('within reach');
    expect(m.summary).not.toContain('within reach');
    expect(byKind(m, 'reachability')?.positive).toBe(expected);
    // format：交通 reliable 时地点不明确就是 null；limited / none 未化解为 false，化解后也只能是 null。
    const format = level === 'reliable' ? null : expected === false ? false : null;
    expect(byKind(m, 'format')?.positive).toBe(format);
    expect(byKind(m, 'transport')?.positive).toBe(expected);
    for (const x of m.reasons) {
      expect(x.text).not.toContain('covers getting there');
      if (x.positive === true) expect(['interest', 'eligibility', 'time', 'cost', 'device']).toContain(x.kind);
    }
    if (expected === null && hasBarrier(level, travel)) {
      expect(byKind(m, 'transport')?.text).toContain('approved');
      expect(byKind(m, 'transport')?.text).toContain("can't confirm it is enough");
    }
  });

  it.each(cells)('有州（对照，规则不变）：交通 %s × 自费差旅 %s × 支持 %s', (level, travel, s) => {
    const opp = makeOpp({ format: 'in_person', country: 'US', state: 'CA', city: null }, { cost: { fee_usd: 0, requires_travel_expense: travel } });
    const profile = { ...GOOD, transport: { level } };
    const grants = supportGrants(s);
    const r = analyzeReachability(profile, opp, grants, OPTS);
    const resolved = s === 'subsidy' || s === 'alt';
    const expected = hasBarrier(level, travel) && !resolved ? false : true;
    expect(r.reachable).toBe(expected);
    expect(r.missing_info).toEqual([]);
    const m = explainMatch(profile, opp, { today: TODAY, grants });
    expect(byKind(m, 'transport')?.positive).toBe(expected);
    if (expected && hasBarrier(level, travel)) expect(byKind(m, 'transport')?.text).toContain('covers getting there');
  });

  it('单调性：同一条地点不明确的机会，更多支持不会把 null 变成 false；条件更差的学生不会比更好的学生更「可达」', () => {
    const rank = (v: boolean | null) => (v === false ? 0 : v === null ? 1 : 2);
    for (const travel of [true, false]) {
      const opp = makeOpp({ format: 'hybrid', country: 'US' }, { cost: { fee_usd: 0, requires_travel_expense: travel } });
      // 支持从少到多：无 → pending → approved 补助 → approved 补助 + 替代方式。
      const ladders: ResourceGrant[][] = [
        [],
        supportGrants('pending'),
        supportGrants('subsidy'),
        [...supportGrants('subsidy'), ...supportGrants('alt')],
      ];
      // 交通从差到好。
      for (const level of LEVELS) {
        let prev = -1;
        for (const grants of ladders) {
          const v = rank(analyzeReachability({ ...GOOD, transport: { level } }, opp, grants, OPTS).reachable);
          expect(v).toBeGreaterThanOrEqual(prev);
          expect(v).toBeLessThan(2);
          prev = v;
        }
      }
      for (const grants of ladders) {
        const byLevel = [...LEVELS].reverse().map((level) => rank(analyzeReachability({ ...GOOD, transport: { level } }, opp, grants, OPTS).reachable));
        // none ≤ limited ≤ reliable
        expect(byLevel[0]).toBeLessThanOrEqual(byLevel[1]);
        expect(byLevel[1]).toBeLessThanOrEqual(byLevel[2]);
      }
    }
  });
});

describe('形式未知 × 需要自费差旅（主办方写明的事实）', () => {
  const travelOpp = makeOpp(UNKNOWN.location, { cost: { fee_usd: 0, requires_travel_expense: true } });

  it.each([
    ['预算够', { ...GOOD, budget_usd: 5000 }, [] as ResourceGrant[], false],
    ['预算不够', { ...GOOD, budget_usd: 0 }, [] as ResourceGrant[], false],
    ['有 approved 交通补助', GOOD, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 })], null],
    ['有 approved 替代参与方式', LIMITED, [grant({ id: 'g-alt', type: 'alternative_access' })], null],
    ['只有 pending', GOOD, [grant({ id: 'g-wait', type: 'transport_subsidy', status: 'pending' })], false],
  ] as const)('%s → %s（从不为 true）', (_name, profile, grants, expected) => {
    const r = analyzeReachability(profile, travelOpp, [...grants], OPTS);
    expect(r.reachable).toBe(expected);
    expect(r.missing_info).toContain('opportunity.location.format');
    const t = r.barriers.filter((b) => b.type === 'transport');
    expect(t).toHaveLength(1);
    expect(t[0].description).toBe('Transportation barrier: the organizer says you must pay for your own travel.');
    expect(t[0].description).not.toMatch(/in person|hybrid|local/);
    const m = explainMatch(profile, travelOpp, { today: TODAY, grants: [...grants] });
    expect(m.reachable).toBe(expected);
    expect(byKind(m, 'transport')?.positive).toBe(expected);
    expect(byKind(m, 'format')?.positive).toBeNull();
    expect(m.summary).not.toContain('within reach');
  });

  it('交通没填也照常记障碍，并把交通与形式列为缺失', () => {
    const r = analyzeReachability({ ...GOOD, transport: null }, travelOpp, [], OPTS);
    expect(r.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(r.missing_info).toEqual(['profile.transport', 'opportunity.location.format']);
    expect(r.reachable).toBe(false);
  });
});

describe('形式缺失 / 非法 / location 不是对象：按 unknown 处理，不当作线下', () => {
  const bad: [string, unknown][] = [
    ['{}', {}],
    ["{format:'remote'}", { format: 'remote', country: 'US', state: 'CA', city: 'Example City' }],
    ['null', null],
    ['字符串', 'in_person'],
    ['数组', ['in_person']],
  ];
  it.each(bad)('location = %s', (_name, location) => {
    const opp = makeOpp(location as OpportunityLocation);
    for (const p of [GOOD, LIMITED, { ...GOOD, transport: null }]) {
      let r: ReturnType<typeof analyzeReachability> | undefined;
      expect(() => {
        r = analyzeReachability(p, opp, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 50 })], OPTS);
      }).not.toThrow();
      expect(r!.reachable).not.toBe(true);
      expect(r!.missing_info).toContain('opportunity.location.format');
      expect(r!.barriers.filter((b) => b.type === 'transport')).toEqual([]);
      let m: MatchExplanation | undefined;
      expect(() => {
        m = explainMatch(p, opp, OPTS);
      }).not.toThrow();
      expect(m!.reachable).not.toBe(true);
      expect(m!.reachable).toBe(analyzeReachability(p, opp, [], OPTS).reachable);
      const format = byKind(m!, 'format');
      if (format) expect(format.positive).toBeNull();
      expect(m!.summary).not.toContain('within reach');
    }
  });
});

describe('公平性：只改 school_name / display_name，结果深度相等', () => {
  const other: StudentProfile = { ...GOOD, school_name: 'A Different Academy', display_name: 'Someone else' };
  const cases = [UNKNOWN, makeOpp({ format: 'in_person', country: 'US' }), makeOpp({ format: 'hybrid', country: 'US' })];
  it.each(cases.map((o, i) => [i, o] as const))('case %i', (_i, opp) => {
    for (const [a, b] of [
      [GOOD, other],
      [LIMITED, { ...LIMITED, school_name: null, display_name: 'Anon' }],
    ] as const) {
      expect(analyzeReachability(b, opp, [], OPTS)).toEqual(analyzeReachability(a, opp, [], OPTS));
      expect(explainMatch(b, opp, OPTS)).toEqual(explainMatch(a, opp, OPTS));
      expect(analyzeGaps(b, opp, [], OPTS)).toEqual(analyzeGaps(a, opp, [], OPTS));
    }
  });
});
