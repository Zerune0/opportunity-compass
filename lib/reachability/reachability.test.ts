import { describe, expect, it } from 'vitest';
import { analyzeReachability } from './index';
import { findCoveringEvidence } from './coverage';
import profilesJson from '@/data/profiles.json';
import {
  BARRIER_TYPES,
  SUPPORT_RESOLVES,
  type Opportunity,
  type ResourceGrant,
  type StudentProfile,
} from '../types';

const TODAY = { today: '2026-11-17' };

// 虚构测试数据（不是真实机会），链接用 example.com。
function makeOpp(extra: Partial<Opportunity> = {}): Opportunity {
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
    requirements: [
      { id: 'req-grade', type: 'grade', min: 9, max: 12, label: '9–12 年级', hard: true, source_text: 'Open to students in grades 9-12.' },
    ],
    preparation: [],
    is_sample: true,
    ...extra,
  };
}

/** 信息完整、条件良好的学生。 */
const GOOD: StudentProfile = {
  id: 'p1',
  is_sample: true,
  display_name: '测试学生',
  grade: 10,
  hours_per_week_available: 10,
  budget_usd: 100,
  transport: { level: 'reliable' },
  devices: ['laptop', 'home_internet'],
  skills: [],
  evidence: [],
};

function grant(g: Partial<ResourceGrant> & Pick<ResourceGrant, 'id' | 'type'>): ResourceGrant {
  return {
    student_id: 'p1',
    opportunity_id: 'fictional-test-program',
    status: 'approved',
    provider: 'Example Org（虚构）',
    is_sample: true,
    ...g,
  };
}

describe('analyzeReachability — 基本', () => {
  it('信息完整、无障碍 → reachable true，summary 写明可达 ≠ 录取', () => {
    const r = analyzeReachability(GOOD, makeOpp(), [], TODAY);
    expect(r.barriers).toEqual([]);
    expect(r.missing_info).toEqual([]);
    expect(r.reachable).toBe(true);
    expect(r.summary).toContain('Reachable does not mean admitted');
    expect(r.summary).not.toMatch(/MOCK/i);
  });

  it('硬性不满足 → false', () => {
    const r = analyzeReachability({ ...GOOD, grade: 8 }, makeOpp(), [], TODAY);
    expect(r.eligibility.overall).toBe('not_eligible');
    expect(r.reachable).toBe(false);
    expect(r.summary).toContain('9–12 年级');
  });

  it('资格 unknown、无障碍 → null', () => {
    const r = analyzeReachability({ ...GOOD, grade: null }, makeOpp(), [], TODAY);
    expect(r.reachable).toBeNull();
    expect(r.summary).toContain('eligibility to confirm with the organizer');
  });

  it('确定性：同输入两次 toEqual', () => {
    const opp = makeOpp({ required_devices: ['laptop', 'webcam'], location: { format: 'in_person' } });
    const g = [grant({ id: 'g1', type: 'device', device: 'webcam' })];
    expect(analyzeReachability(GOOD, opp, g, TODAY)).toEqual(analyzeReachability(GOOD, opp, g, TODAY));
  });
});

describe('analyzeReachability — 准备差距与覆盖', () => {
  const opp = makeOpp({
    preparation: [
      { id: 'prep-python', title: '学 Python 基础', skill: 'python', estimated_hours: 10, estimated_cost_usd: 0, depends_on: [], required_for_application: false },
      { id: 'prep-project', title: '做一个数据项目', skill: 'data_analysis', evidence_kind: 'project', estimated_hours: 15, estimated_cost_usd: 0, depends_on: ['prep-python'], required_for_application: true },
      { id: 'prep-essay', title: '写个人陈述', estimated_hours: 5, estimated_cost_usd: 0, depends_on: [], required_for_application: true },
    ],
  });

  it('未覆盖的准备项都是差距', () => {
    const r = analyzeReachability(GOOD, opp, [], TODAY);
    expect(r.readiness_gaps.map((g) => g.prep_item_id)).toEqual(['prep-python', 'prep-project', 'prep-essay']);
    expect(r.readiness_gaps[0].reason).toContain('python');
  });

  it('按技能、按 kind、按 prep_item_ids（带前缀或裸 id）覆盖', () => {
    const p: StudentProfile = {
      ...GOOD,
      evidence: [
        { id: 'ev1', title: 'Python 课（虚构）', kind: 'course', skills: ['python', 'data_analysis'], status: 'self_reported', added_on: '2026-11-01' },
        { id: 'ev2', title: '陈述草稿（虚构）', kind: 'other', skills: [], prep_item_ids: ['fictional-test-program:prep-essay'], status: 'self_reported', added_on: '2026-11-02' },
      ],
    };
    // ev1 有 data_analysis 但 kind 不是 project → 不覆盖 prep-project
    const r = analyzeReachability(p, opp, [], TODAY);
    expect(r.readiness_gaps.map((g) => g.prep_item_id)).toEqual(['prep-project']);
    expect(findCoveringEvidence(p, opp, opp.preparation[0]).map((e) => e.id)).toEqual(['ev1']);

    const bare: StudentProfile = {
      ...GOOD,
      evidence: [{ id: 'ev3', title: '项目（虚构）', kind: 'other', skills: [], prep_item_ids: ['prep-project'], status: 'evidence_attached', added_on: '2026-11-03' }],
    };
    expect(findCoveringEvidence(bare, opp, opp.preparation[1]).map((e) => e.id)).toEqual(['ev3']);
  });
});

describe('analyzeReachability — device', () => {
  const opp = makeOpp({ required_devices: ['laptop', 'webcam'] });

  it('缺设备 → 障碍；approved 设备 grant 后 reachable 从 false 变 true', () => {
    const p: StudentProfile = { ...GOOD, devices: ['smartphone', 'webcam'] };
    const before = analyzeReachability(p, opp, [], TODAY);
    expect(before.barriers.map((b) => b.type)).toEqual(['device']);
    expect(before.reachable).toBe(false);

    const after = analyzeReachability(p, opp, [grant({ id: 'g-laptop', type: 'device', device: 'laptop' })], TODAY);
    expect(after.barriers[0].resolved).toBe(true);
    expect(after.barriers[0].resolved_by_grant_ids).toEqual(['g-laptop']);
    expect(after.applied_grant_ids).toEqual(['g-laptop']);
    expect(after.reachable).toBe(true);
  });

  it('设备型号不同的 grant 不化解', () => {
    const p: StudentProfile = { ...GOOD, devices: ['webcam'] };
    const r = analyzeReachability(p, opp, [grant({ id: 'g-tab', type: 'device', device: 'tablet' })], TODAY);
    expect(r.reachable).toBe(false);
  });

  it('devices 没填 → missing，reachable null', () => {
    const r = analyzeReachability({ ...GOOD, devices: null }, opp, [], TODAY);
    expect(r.barriers).toEqual([]);
    expect(r.missing_info).toEqual(['profile.devices']);
    expect(r.reachable).toBeNull();
  });

  it('pending grant 不化解，但出现在 pending_grant_ids', () => {
    const p: StudentProfile = { ...GOOD, devices: ['webcam'] };
    const r = analyzeReachability(p, opp, [grant({ id: 'g-p', type: 'device', device: 'laptop', status: 'pending' })], TODAY);
    expect(r.barriers[0].resolved).toBe(false);
    expect(r.barriers[0].pending_grant_ids).toEqual(['g-p']);
    expect(r.applied_grant_ids).toEqual([]);
    expect(r.reachable).toBe(false);
  });

  it('别的学生 / 别的机会的 grant 不生效', () => {
    const p: StudentProfile = { ...GOOD, devices: ['webcam'] };
    const r = analyzeReachability(
      p,
      opp,
      [
        grant({ id: 'g-other-student', type: 'device', device: 'laptop', student_id: 'p2' }),
        grant({ id: 'g-other-opp', type: 'device', device: 'laptop', opportunity_id: 'another-fictional' }),
      ],
      TODAY,
    );
    expect(r.barriers[0].resolved).toBe(false);
    expect(r.applied_grant_ids).toEqual([]);
    expect(r.reachable).toBe(false);
  });
});

describe('analyzeReachability — cost', () => {
  const opp = makeOpp({
    cost: { fee_usd: 50, requires_travel_expense: false },
    preparation: [
      { id: 'prep-kit', title: '买材料包', estimated_hours: 0, estimated_cost_usd: 30, depends_on: [], required_for_application: true },
      { id: 'prep-book', title: '买参考书（建议）', estimated_hours: 0, estimated_cost_usd: 100, depends_on: [], required_for_application: false },
    ],
  });

  it('费用 + 必需准备费用 > 预算 → 障碍，shortfall 为差额', () => {
    const r = analyzeReachability({ ...GOOD, budget_usd: 20 }, opp, [], TODAY);
    const cost = r.barriers.find((b) => b.type === 'cost');
    expect(cost?.shortfall).toBe(60);
    expect(r.reachable).toBe(false);
  });

  it('fee_waiver 金额足够 → 化解；不足 → 不化解；amount null → 全额免除 fee', () => {
    const p = { ...GOOD, budget_usd: 20 };
    expect(analyzeReachability(p, opp, [grant({ id: 'w', type: 'fee_waiver', amount_usd: 60 })], TODAY).reachable).toBe(true);
    expect(analyzeReachability(p, opp, [grant({ id: 'w', type: 'fee_waiver', amount_usd: 40 })], TODAY).reachable).toBe(false);
    expect(analyzeReachability(p, opp, [grant({ id: 'w', type: 'fee_waiver', amount_usd: null })], TODAY).reachable).toBe(false); // 免 50 < 60
    expect(analyzeReachability({ ...GOOD, budget_usd: 10 }, makeOpp({ cost: { fee_usd: 50, requires_travel_expense: false } }), [grant({ id: 'w', type: 'fee_waiver', amount_usd: null })], TODAY).reachable).toBe(true);
  });

  it('fee_usd 为 null → missing；预算没填且需要花钱 → missing', () => {
    const r1 = analyzeReachability(GOOD, makeOpp({ cost: { fee_usd: null, requires_travel_expense: false } }), [], TODAY);
    expect(r1.missing_info).toEqual(['opportunity.cost.fee_usd']);
    expect(r1.reachable).toBeNull();
    const r2 = analyzeReachability({ ...GOOD, budget_usd: null }, opp, [], TODAY);
    expect(r2.missing_info).toEqual(['profile.budget_usd']);
    expect(r2.reachable).toBeNull();
    // 免费且无必需费用时不需要预算
    expect(analyzeReachability({ ...GOOD, budget_usd: null }, makeOpp(), [], TODAY).reachable).toBe(true);
  });

  it('多张 amount null 的 fee_waiver 只抵一次 fee，不能抵准备费', () => {
    const o = makeOpp({
      cost: { fee_usd: 100, requires_travel_expense: false },
      preparation: [{ id: 'prep-kit', title: '买材料包', estimated_hours: 0, estimated_cost_usd: 100, depends_on: [], required_for_application: true }],
    });
    const p = { ...GOOD, budget_usd: 0 };
    const two = [grant({ id: 'w1', type: 'fee_waiver', amount_usd: null }), grant({ id: 'w2', type: 'fee_waiver', amount_usd: null })];
    const r = analyzeReachability(p, o, two, TODAY);
    const cost = r.barriers.find((b) => b.type === 'cost');
    expect(cost?.shortfall).toBe(200);
    expect(cost?.resolved).toBe(false);
    expect(cost?.resolved_by_grant_ids).toEqual([]);
    expect(r.reachable).toBe(false);
    // null 金额（免 fee 100）+ 有金额 100 → 足够
    const mixed = [grant({ id: 'w1', type: 'fee_waiver', amount_usd: null }), grant({ id: 'w3', type: 'fee_waiver', amount_usd: 100 })];
    expect(analyzeReachability(p, o, mixed, TODAY).reachable).toBe(true);
  });

  describe('fee_usd 为 null', () => {
    const unknownFee = makeOpp({
      cost: { fee_usd: null, requires_travel_expense: false },
      preparation: [{ id: 'prep-kit', title: '买材料包', estimated_hours: 0, estimated_cost_usd: 80, depends_on: [], required_for_application: true }],
    });

    it('仅必需准备费下限就超出预算 → 未化解的 cost 障碍，reachable false，仍记 fee 缺失', () => {
      const r = analyzeReachability({ ...GOOD, budget_usd: 30 }, unknownFee, [], TODAY);
      const cost = r.barriers.find((b) => b.type === 'cost');
      expect(cost).toBeDefined();
      expect(cost!.resolved).toBe(false);
      expect(cost!.shortfall).toBe(50);
      expect(cost!.description).toContain('short at least $50');
      expect(cost!.description).toContain('real cost may be higher');
      expect(r.missing_info).toContain('opportunity.cost.fee_usd');
      expect(r.reachable).toBe(false);
    });

    it('有金额的 waiver 计入下限判断；null 金额 waiver 帮不了准备费', () => {
      const p = { ...GOOD, budget_usd: 30 };
      // 30 + 20 < 80 → 仍是障碍，至少还差 30
      const r1 = analyzeReachability(p, unknownFee, [grant({ id: 'w', type: 'fee_waiver', amount_usd: 20 })], TODAY);
      const c1 = r1.barriers.find((b) => b.type === 'cost');
      expect(c1?.resolved).toBe(false);
      expect(c1?.description).toContain('short at least $30');
      expect(r1.reachable).toBe(false);
      // 30 + 50 ≥ 80 → 下限没超，只记缺失 → null
      const r2 = analyzeReachability(p, unknownFee, [grant({ id: 'w', type: 'fee_waiver', amount_usd: 50 })], TODAY);
      expect(r2.barriers.filter((b) => b.type === 'cost')).toEqual([]);
      expect(r2.missing_info).toEqual(['opportunity.cost.fee_usd']);
      expect(r2.reachable).toBeNull();
      // null 金额 waiver 不抵准备费 → 仍是障碍
      const r3 = analyzeReachability(p, unknownFee, [grant({ id: 'w', type: 'fee_waiver', amount_usd: null })], TODAY);
      expect(r3.barriers.find((b) => b.type === 'cost')?.resolved).toBe(false);
      expect(r3.reachable).toBe(false);
    });

    it('下限不超预算 → 只记缺失，reachable null', () => {
      const r = analyzeReachability({ ...GOOD, budget_usd: 80 }, unknownFee, [], TODAY);
      expect(r.barriers).toEqual([]);
      expect(r.missing_info).toEqual(['opportunity.cost.fee_usd']);
      expect(r.reachable).toBeNull();
    });

    it('预算没填 → 同时记 profile.budget_usd', () => {
      const r = analyzeReachability({ ...GOOD, budget_usd: null }, unknownFee, [], TODAY);
      expect(r.missing_info).toEqual(['opportunity.cost.fee_usd', 'profile.budget_usd']);
      expect(r.reachable).toBeNull();
      const r2 = analyzeReachability({ ...GOOD, budget_usd: null }, makeOpp({ cost: { fee_usd: null, requires_travel_expense: false } }), [], TODAY);
      expect(r2.missing_info).toEqual(['opportunity.cost.fee_usd', 'profile.budget_usd']);
    });
  });
});

describe('analyzeReachability — transport', () => {
  const inPerson = makeOpp({ location: { format: 'in_person', country: 'US', state: 'CA' } });

  it('线上跳过', () => {
    expect(analyzeReachability({ ...GOOD, transport: { level: 'none' } }, makeOpp(), [], TODAY).reachable).toBe(true);
  });

  it('交通 none → 障碍；approved 交通补助后 reachable 从 false 变 true', () => {
    const p: StudentProfile = { ...GOOD, transport: { level: 'none' } };
    const before = analyzeReachability(p, inPerson, [], TODAY);
    expect(before.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(before.reachable).toBe(false);
    const after = analyzeReachability(p, inPerson, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 80 })], TODAY);
    expect(after.barriers[0].resolved).toBe(true);
    expect(after.reachable).toBe(true);
  });

  it('需要自费差旅：交通 reliable 也是障碍；与 limited 合并为一条', () => {
    const travel = makeOpp({ location: { format: 'hybrid' }, cost: { fee_usd: 0, requires_travel_expense: true } });
    expect(analyzeReachability(GOOD, travel, [], TODAY).barriers.filter((b) => b.type === 'transport')).toHaveLength(1);
    const r = analyzeReachability({ ...GOOD, transport: { level: 'limited' } }, travel, [], TODAY);
    const t = r.barriers.filter((b) => b.type === 'transport');
    expect(t).toHaveLength(1);
    expect(t[0].description).toContain('pay for your own travel');
    expect(t[0].description).toContain('transportation is limited');
  });

  it('hybrid 形式也检查交通：none / limited → 障碍；reliable 且无需自费差旅 → 无障碍', () => {
    const hybrid = makeOpp({ location: { format: 'hybrid', country: 'US' } });
    const none = analyzeReachability({ ...GOOD, transport: { level: 'none' } }, hybrid, [], TODAY);
    expect(none.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(none.reachable).toBe(false);
    const limited = analyzeReachability({ ...GOOD, transport: { level: 'limited' } }, hybrid, [], TODAY);
    expect(limited.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(limited.barriers[0].description).toContain('transportation is limited');
    const ok = analyzeReachability(GOOD, hybrid, [], TODAY);
    expect(ok.barriers).toEqual([]);
    expect(ok.reachable).toBe(true);
    const fixed = analyzeReachability({ ...GOOD, transport: { level: 'none' } }, hybrid, [grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 40 })], TODAY);
    expect(fixed.reachable).toBe(true);
    expect(analyzeReachability({ ...GOOD, transport: null }, hybrid, [], TODAY).missing_info).toEqual(['profile.transport']);
  });

  it('alternative_access（替代参与方式）：approved 化解交通障碍、可达；pending 不化解，只列入 pending_grant_ids', () => {
    const p: StudentProfile = { ...GOOD, transport: { level: 'none' } };
    const before = analyzeReachability(p, inPerson, [], TODAY);
    expect(before.barriers.map((b) => b.type)).toEqual(['transport']);
    expect(before.reachable).toBe(false);

    const approvedAlt = analyzeReachability(p, inPerson, [grant({ id: 'g-online-entry', type: 'alternative_access' })], TODAY);
    expect(approvedAlt.barriers).toHaveLength(1);
    expect(approvedAlt.barriers[0].type).toBe('transport');
    expect(approvedAlt.barriers[0].resolved).toBe(true);
    expect(approvedAlt.barriers[0].resolved_by_grant_ids).toEqual(['g-online-entry']);
    expect(approvedAlt.applied_grant_ids).toEqual(['g-online-entry']);
    expect(approvedAlt.reachable).toBe(true);

    const pendingAlt = analyzeReachability(
      p,
      inPerson,
      [grant({ id: 'g-online-entry', type: 'alternative_access', status: 'pending' })],
      TODAY,
    );
    expect(pendingAlt.barriers[0].resolved).toBe(false);
    expect(pendingAlt.barriers[0].resolved_by_grant_ids).toEqual([]);
    expect(pendingAlt.barriers[0].pending_grant_ids).toEqual(['g-online-entry']);
    expect(pendingAlt.applied_grant_ids).toEqual([]);
    expect(pendingAlt.reachable).toBe(false);
  });

  it('transport_subsidy 与 alternative_access 同等对待：两者都 approved 时都记入 resolved_by_grant_ids（按输入顺序）', () => {
    const p: StudentProfile = { ...GOOD, transport: { level: 'none' } };
    const r = analyzeReachability(
      p,
      inPerson,
      [
        grant({ id: 'g-alt', type: 'alternative_access' }),
        grant({ id: 'g-bus', type: 'transport_subsidy', amount_usd: 80 }),
        grant({ id: 'g-alt-pending', type: 'alternative_access', status: 'pending' }),
        grant({ id: 'g-bus-pending', type: 'transport_subsidy', status: 'pending' }),
      ],
      TODAY,
    );
    expect(r.barriers[0].resolved).toBe(true);
    expect(r.barriers[0].resolved_by_grant_ids).toEqual(['g-alt', 'g-bus']);
    expect(r.barriers[0].pending_grant_ids).toEqual(['g-alt-pending', 'g-bus-pending']);
    expect(r.reachable).toBe(true);
  });

  it('alternative_access 不化解其他类型的障碍（如设备）', () => {
    const p: StudentProfile = { ...GOOD, devices: [] };
    const opp = makeOpp({ required_devices: ['laptop'] });
    const r = analyzeReachability(p, opp, [grant({ id: 'g-alt', type: 'alternative_access' })], TODAY);
    expect(r.barriers.map((b) => b.type)).toEqual(['device']);
    expect(r.barriers[0].resolved).toBe(false);
    expect(r.reachable).toBe(false);
  });

  it('SUPPORT_RESOLVES：alternative_access 与 transport_subsidy 都映射到 transport', () => {
    expect(SUPPORT_RESOLVES.alternative_access).toBe('transport');
    expect(SUPPORT_RESOLVES.transport_subsidy).toBe('transport');
  });

  it('transport 没填 → missing；差旅不明且无障碍 → missing', () => {
    const r = analyzeReachability({ ...GOOD, transport: null }, inPerson, [], TODAY);
    expect(r.missing_info).toEqual(['profile.transport']);
    expect(r.reachable).toBeNull();
    const unclear = makeOpp({ location: { format: 'in_person' }, cost: { fee_usd: 0, requires_travel_expense: null } });
    const r2 = analyzeReachability(GOOD, unclear, [], TODAY);
    expect(r2.missing_info).toEqual(['opportunity.cost.requires_travel_expense']);
    expect(r2.reachable).toBeNull();
  });
});

describe('analyzeReachability — time', () => {
  it('每周时间不够 → 障碍；time_support 足够 → 化解', () => {
    const opp = makeOpp({ time_commitment: { hours_per_week: 8, total_weeks: 6 } });
    const p = { ...GOOD, hours_per_week_available: 5 };
    const r = analyzeReachability(p, opp, [], TODAY);
    expect(r.barriers).toHaveLength(1);
    expect(r.barriers[0].type).toBe('time');
    expect(r.barriers[0].shortfall).toBe(3);
    expect(analyzeReachability(p, opp, [grant({ id: 't', type: 'time_support', hours_per_week: 3 })], TODAY).reachable).toBe(true);
    expect(analyzeReachability(p, opp, [grant({ id: 't', type: 'time_support', hours_per_week: 2 })], TODAY).reachable).toBe(false);
  });

  it('参与时间信息不足 → missing', () => {
    const r = analyzeReachability({ ...GOOD, hours_per_week_available: null }, makeOpp({ time_commitment: { hours_per_week: null, total_weeks: null } }), [], TODAY);
    expect(r.missing_info).toEqual(['opportunity.time_commitment.hours_per_week', 'profile.hours_per_week_available']);
    expect(r.reachable).toBeNull();
  });

  const prepOpp = makeOpp({
    deadline: '2026-12-01', // 距 2026-11-17 共 14 天 = 2 周
    preparation: [
      { id: 'prep-a', title: '必需准备 A', estimated_hours: 30, estimated_cost_usd: 0, depends_on: [], required_for_application: true },
      { id: 'prep-b', title: '建议准备 B', estimated_hours: 100, estimated_cost_usd: 0, depends_on: [], required_for_application: false },
    ],
  });

  it('截止前准备不完 → 障碍，shortfall 为每周缺口（向上取整到 0.5）', () => {
    // 需要 30h / 2 周 = 15h/周，可用 10 → 每周缺 5
    const r = analyzeReachability(GOOD, prepOpp, [], TODAY);
    const t = r.barriers.filter((b) => b.type === 'time');
    expect(t).toHaveLength(1);
    expect(t[0].shortfall).toBe(5);
    expect(r.reachable).toBe(false);
    expect(analyzeReachability(GOOD, prepOpp, [grant({ id: 't', type: 'time_support', hours_per_week: 5 })], TODAY).reachable).toBe(true);
  });

  it('必需准备已被证据覆盖 → 不再有准备时间障碍', () => {
    const p: StudentProfile = {
      ...GOOD,
      evidence: [{ id: 'ev', title: 'A 已完成（虚构）', kind: 'other', skills: [], prep_item_ids: ['prep-a'], status: 'self_reported', added_on: '2026-11-01' }],
    };
    expect(analyzeReachability(p, prepOpp, [], TODAY).reachable).toBe(true);
  });

  it('有截止、有必需准备但没传 today → missing options.today，reachable null', () => {
    const r = analyzeReachability(GOOD, prepOpp, []);
    expect(r.missing_info).toEqual(['options.today']);
    expect(r.reachable).toBeNull();
  });

  it('已过截止日期 → 障碍，任何 grant 都不能化解', () => {
    const r = analyzeReachability(GOOD, prepOpp, [grant({ id: 't', type: 'time_support', hours_per_week: 100 })], { today: '2026-12-05' });
    const past = r.barriers.find((b) => b.description.includes('has passed'));
    expect(past).toBeDefined();
    expect(past!.resolved).toBe(false);
    expect(past!.shortfall).toBeNull();
    expect(r.reachable).toBe(false);
    // 即使没有准备差距，过了截止也不可达
    expect(analyzeReachability(GOOD, makeOpp({ deadline: '2026-11-01' }), [], TODAY).reachable).toBe(false);
  });

  it('滚动截止（deadline null）→ 跳过准备时间检查', () => {
    const r = analyzeReachability(GOOD, { ...prepOpp, deadline: null }, [], TODAY);
    expect(r.reachable).toBe(true);
    // 滚动截止时不需要 today
    const r2 = analyzeReachability(GOOD, makeOpp({ deadline: null }), []);
    expect(r2.missing_info).toEqual([]);
    expect(r2.reachable).toBe(true);
  });

  it('有截止日但没有可用的 today（即使没有准备差距）→ missing options.today，reachable null', () => {
    const opp = makeOpp(); // 截止 2027-03-01，无准备项
    const r = analyzeReachability(GOOD, opp, []);
    expect(r.missing_info).toEqual(['options.today']);
    expect(r.reachable).toBeNull();
    expect(r.summary).toContain("today's date");
    const bad = analyzeReachability(GOOD, opp, [], { today: 'garbage' });
    expect(bad.missing_info).toEqual(['options.today']);
    expect(bad.reachable).toBeNull();
    // 对照：传了 today → true
    expect(analyzeReachability(GOOD, opp, [], TODAY).reachable).toBe(true);
  });

  it('截止日期无法解析（即使没有准备项）→ missing opportunity.deadline，reachable null', () => {
    const r = analyzeReachability(GOOD, makeOpp({ deadline: 'March 1' }), [], TODAY);
    expect(r.missing_info).toEqual(['opportunity.deadline']);
    expect(r.reachable).toBeNull();
  });

  it('截止日就是今天：文案写「今天截止」，不出现「还剩 1 天」「每周还差」', () => {
    const todayOpp = makeOpp({ deadline: '2026-11-17', preparation: prepOpp.preparation });
    const r = analyzeReachability(GOOD, todayOpp, [], TODAY);
    const t = r.barriers.filter((b) => b.type === 'time');
    expect(t).toHaveLength(1);
    expect(t[0].description).toContain('The deadline is today');
    expect(t[0].description).not.toContain('days left');
    expect(t[0].description).not.toContain('short about');
    expect(r.reachable).toBe(false);
    // 今天截止但没有准备差距 → 仍然可达（还没过期）
    expect(analyzeReachability(GOOD, makeOpp({ deadline: '2026-11-17' }), [], TODAY).reachable).toBe(true);
  });
});

describe('analyzeReachability — 综合', () => {
  it('信息不足 → null，missing_info 去重且顺序稳定', () => {
    const p: StudentProfile = { id: 'p1', is_sample: true, display_name: '空档案', grade: 10, evidence: [] };
    const opp = makeOpp({
      required_devices: ['laptop'],
      location: { format: 'in_person' },
      cost: { fee_usd: 10, requires_travel_expense: null },
      preparation: [{ id: 'prep-a', title: 'A', estimated_hours: 10, estimated_cost_usd: 0, depends_on: [], required_for_application: true }],
    });
    const r = analyzeReachability(p, opp, [], TODAY);
    expect(r.reachable).toBeNull();
    expect(r.missing_info).toEqual([
      'profile.devices',
      'profile.budget_usd',
      'profile.transport',
      'opportunity.cost.requires_travel_expense',
      'profile.hours_per_week_available',
    ]);
    expect(r.summary).toContain('missing info');
  });

  it('有未化解障碍时，即使信息不足也是 false', () => {
    const p: StudentProfile = { id: 'p1', is_sample: true, display_name: '测试', devices: [], evidence: [] };
    const r = analyzeReachability(p, makeOpp({ required_devices: ['laptop'] }), [], TODAY);
    expect(r.eligibility.overall).toBe('unknown');
    expect(r.reachable).toBe(false);
  });

  it('障碍类型都合法', () => {
    const opp = makeOpp({
      required_devices: ['laptop'],
      location: { format: 'in_person' },
      cost: { fee_usd: 500, requires_travel_expense: true },
      time_commitment: { hours_per_week: 40, total_weeks: 4 },
    });
    const r = analyzeReachability({ ...GOOD, devices: [] }, opp, [], TODAY);
    expect(r.barriers.map((b) => b.type).sort()).toEqual(['cost', 'device', 'time', 'transport']);
    for (const b of r.barriers) expect(BARRIER_TYPES).toContain(b.type);
  });
});

describe('analyzeReachability — 公平性与示例档案', () => {
  const opp = makeOpp({
    required_devices: ['laptop'],
    location: { format: 'in_person', country: 'US' },
    cost: { fee_usd: 25, requires_travel_expense: false },
    preparation: [
      { id: 'prep-python', title: '学 Python 基础', skill: 'python', estimated_hours: 12, estimated_cost_usd: 0, depends_on: [], required_for_application: true },
    ],
  });

  it('仅学校名 / 显示名不同 → 结果完全一致', () => {
    const a: StudentProfile = { ...GOOD, school_name: 'Example Elite Academy（虚构）', display_name: 'A' };
    const b: StudentProfile = { ...GOOD, school_name: 'Example Rural School（虚构）', display_name: 'B' };
    expect(analyzeReachability(a, opp, [], TODAY)).toEqual(analyzeReachability(b, opp, [], TODAY));
  });

  it('全部示例档案都能跑，状态合法', () => {
    const profiles = profilesJson as unknown as StudentProfile[];
    for (const p of profiles) {
      const r = analyzeReachability(p, opp, [], TODAY);
      expect(r.profile_id).toBe(p.id);
      expect([true, false, null]).toContain(r.reachable);
      for (const b of r.barriers) expect(BARRIER_TYPES).toContain(b.type);
      expect(new Set(r.missing_info).size).toBe(r.missing_info.length);
      expect(r.summary.length).toBeGreaterThan(0);
    }
  });
});
