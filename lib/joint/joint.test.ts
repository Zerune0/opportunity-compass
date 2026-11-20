/**
 * solveJoint 求解器测试（演示场景 data/scenarios/device-loan.json + 由它派生的虚构变体）。
 * 全部是示例 / 模拟数据，不是真实学生、真实机会或真实影响。
 *
 * 演示场景关键数字（手算依据）：
 * - 1 个占位线下机会（需要 laptop，免费，无准备项，截止 2026-12-15，时段 '2027-01-09-day'）。
 * - 10 名示例学生 dl-s01…dl-s10：全部符合资格、全部缺笔记本；dl-s03 / dl-s06 / dl-s09 还缺交通。
 * - 措施：
 *   iv-laptop-loan       device(laptop)       固定 $100，每人 $20，容量 5（per_time_slot），approved
 *   iv-transport-subsidy transport_subsidy    固定 $0，  每人 $25，不限容量，approved
 *   iv-online-entry      alternative_access   固定 $150，每人 $0， 不限容量，approved，requires 设备借用，与卫星会场互斥
 *   iv-satellite-venue   alternative_access   固定 $60， 每人 $10，容量 3（per_time_slot），pending
 * - 预算 $400，evaluation_date 2026-11-17。
 */
import { describe, expect, it } from 'vitest';
import { solveJoint, verifyPlan } from './index';
import { isPlaceholderOpportunity } from './scenario-utils';
import {
  DEVICE_LOAN_IDS as IDS,
  deviceLoanScenario,
  resolveEnabledInterventions,
  withBudget,
  withEnabledInterventions,
} from './scenarios';
import type { Intervention, JointPlan, JointResult, Opportunity, ResourceGrant, Scenario } from '../types';

const OPP = IDS.opportunity;
const LAPTOP = IDS.laptopLoan;
const SUBSIDY = IDS.transportSubsidy;
const ONLINE = IDS.onlineEntry;
const SATELLITE = IDS.satelliteVenue;
const RELIABLE = ['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07', 'dl-s08', 'dl-s10'];
const NO_TRANSPORT: readonly string[] = IDS.transportLackingStudents;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const laptopOnly = (s: Scenario = deviceLoanScenario) => withEnabledInterventions(s, [LAPTOP]);
const studentsOf = (r: { allocations: { student_id: string }[] }) => [...new Set(r.allocations.map((a) => a.student_id))];
const pairsOf = (ids: string[], opp = OPP) => ids.map((s) => ({ student_id: s, opportunity_id: opp }));

/** 已有笔记本的 grant（不来自场景措施：intervention_id 为 null，只影响可达性，不占容量）。 */
function laptopGrant(student: string, opp: string | null = OPP): ResourceGrant {
  return {
    id: `school-laptop-${student}`,
    student_id: student,
    opportunity_id: opp,
    intervention_id: null,
    type: 'device',
    device: 'laptop',
    status: 'approved',
    provider: 'Sample school loan (simulated)',
    is_sample: true,
  };
}

function withInterventionPatch(s: Scenario, id: string, patch: Partial<Intervention>): Scenario {
  return { ...s, interventions: s.interventions.map((iv) => (iv.id === id ? { ...iv, ...patch } : iv)) };
}

function expectConsistent(r: JointResult) {
  expect(r.N).toBe(r.G - r.L);
  expect(r.cost.total_usd).toBeCloseTo(r.cost.fixed_usd + r.cost.marginal_usd, 9);
  expect(r.cost.marginal_usd).toBeCloseTo(r.allocations.reduce((s, a) => s + a.cost_usd, 0), 9);
  expect(r.notes.join('')).toContain('Simulated');
  expect(r.notes.join('')).toContain('does not mean admitted');
  expect(r.notes.join('')).not.toContain('MOCK');
}

describe('演示场景数据', () => {
  it('全部是示例数据，机会是明显的占位', () => {
    expect(deviceLoanScenario.is_sample).toBe(true);
    expect(deviceLoanScenario.students).toHaveLength(10);
    expect(deviceLoanScenario.students.every((s) => s.is_sample)).toBe(true);
    const opp = deviceLoanScenario.opportunities[0];
    expect(opp.is_sample).toBe(true);
    expect(opp.id).toBe('placeholder-inperson-event');
    expect(opp.title).toBe('[Sample] In-person coding workshop');
    // 占位判定靠 is_sample（不靠标题里的 Placeholder 字样），主办方页面的 Placeholder 标注不变
    expect(isPlaceholderOpportunity(opp)).toBe(true);
    expect(opp.official_url).toContain('example.com');
  });

  it('只启用设备借用时：R0 为空（10 人都缺笔记本）', () => {
    const r = solveJoint(laptopOnly());
    expect(r.R0).toEqual([]);
  });
});

describe('只启用设备借用', () => {
  it('预算充足：OPTIMAL，G = 5、L = 0、N = 5，复核通过，选中的都不是缺交通的学生', () => {
    const r = solveJoint(laptopOnly());
    expectConsistent(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.R0).toEqual([]);
    expect(r.R1).toHaveLength(5);
    expect([r.G, r.L, r.N]).toEqual([5, 0, 5]);
    expect(r.verification?.passed).toBe(true);
    expect(r.selected_intervention_ids).toEqual([LAPTOP]);
    const chosen = studentsOf(r);
    expect(chosen).toHaveLength(5);
    for (const s of chosen) expect(NO_TRANSPORT).not.toContain(s);
    // 并列时取字典序最小：按 id 升序的前 5 名交通可靠的学生。
    expect(chosen).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07']);
    expect(r.R1).toEqual(pairsOf(chosen));
    // 手算：固定 $100 + 5 × $20 = $200。
    expect(r.cost).toEqual({ fixed_usd: 100, marginal_usd: 100, total_usd: 200 });
    expect(r.conditional ?? null).toBeNull();
    expect(r.alternative ?? null).toBeNull();
  });

  it('10 人都缺设备、名额只有 5：无论预算多大 G 都不超过 5（共享资源不重复使用）', () => {
    for (const budget of [400, 10_000, 1_000_000]) {
      const r = solveJoint(withBudget(laptopOnly(), budget));
      expect(r.status).toBe('OPTIMAL');
      expect(r.G).toBe(5);
      expect(studentsOf(r)).toHaveLength(5);
      expect(r.cost.total_usd).toBe(200);
    }
  });

  it('预算只够一部分名额：固定成本只计一次，人均按人计', () => {
    // $160 = 固定 $100 + 3 × $20 → 3 人；$179 仍只够 3 人（第 4 人要到 $180）。
    for (const [budget, g, total] of [
      [160, 3, 160],
      [179, 3, 160],
      [180, 4, 180],
      [119.99, 0, 0],
      [120, 1, 120],
    ] as const) {
      const r = solveJoint(withBudget(laptopOnly(), budget));
      expect(r.status).toBe('OPTIMAL');
      expect(r.G).toBe(g);
      expect(r.cost.total_usd).toBe(total);
      expect(r.cost.total_usd).toBeLessThanOrEqual(budget);
      expect(r.verification?.passed).toBe(true);
      if (g > 0) {
        expect(r.cost.fixed_usd).toBe(100);
        expect(r.cost.marginal_usd).toBe(20 * g);
        expect(r.allocations.every((a) => a.cost_usd === 20)).toBe(true);
      } else {
        // 只够固定成本、不够任何一人：不启用措施（只启用不分配不会增加 N，反而多花钱）。
        expect(r.selected_intervention_ids).toEqual([]);
      }
    }
  });

  it('主办方要求必须启用设备借用而预算不够固定成本：INFEASIBLE，替代方案只放松软要求', () => {
    const scenario = withBudget(deviceLoanScenario, 80);
    const r = solveJoint(scenario, { required_intervention_ids: [LAPTOP] });
    expectConsistent(r);
    expect(r.status).toBe('INFEASIBLE');
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.allocations).toEqual([]);
    expect([r.G, r.L, r.N]).toEqual([0, 0, 0]);
    expect(r.R1).toEqual(r.R0);
    expect(r.verification ?? null).toBeNull();
    expect(r.alternative).toBeTruthy();
    const alt = r.alternative!;
    expect(alt.relaxed).toEqual(['required_intervention_ids']);
    expect(alt.note).toContain('relaxes');
    expect(alt.note).toContain('$100');
    // 硬约束没有放松：替代方案成本 ≤ 预算，且通过只带硬约束的独立复核。
    expect(alt.cost.total_usd).toBeLessThanOrEqual(80);
    expect(verifyPlan(scenario, alt).passed).toBe(true);
    // 手算：$80 买不起设备借用（$100）；交通类措施单独用不能让任何人可达（都缺笔记本）→ 空方案。
    expect(alt.selected_intervention_ids).toEqual([]);
    expect(alt.G).toBe(0);
  });

  it('min_gain 达不到：INFEASIBLE，替代方案放松 min_gain', () => {
    const r = solveJoint(laptopOnly(), { min_gain: 6 });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.G).toBe(0);
    expect(r.alternative?.relaxed).toEqual(['min_gain']);
    expect(r.alternative?.G).toBe(5);
    expect(r.alternative?.cost.total_usd).toBe(200);
    expect(r.alternative?.note).toContain('5');
    // min_gain 恰好可达时正常求解。
    const ok = solveJoint(laptopOnly(), { min_gain: 5 });
    expect(ok.status).toBe('OPTIMAL');
    expect(ok.verification?.passed).toBe(true);
  });
});

describe('pending 措施与条件性结果', () => {
  // 变体：3 名缺交通的学生已从学校借到笔记本（existing grant，不占场景措施容量），只差交通。
  const base = withEnabledInterventions(
    { ...deviceLoanScenario, existing_grants: NO_TRANSPORT.map((s) => laptopGrant(s)) },
    [LAPTOP, SATELLITE],
  );

  it('pending 措施不出现在主结果里；conditional 给出「如果获批」的结果', () => {
    const r = solveJoint(base);
    expectConsistent(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).not.toContain(SATELLITE);
    expect(r.allocations.some((a) => a.intervention_id === SATELLITE)).toBe(false);
    expect(r.G).toBe(5);
    expect(r.cost.total_usd).toBe(200);
    expect(r.notes).toContain(
      '1 support measure is pending approval and is not counted in the main result; see conditional for the outcome if approved (not in effect yet).',
    );

    const c = r.conditional!;
    expect(c).toBeTruthy();
    expect(c.status).toBe('OPTIMAL');
    expect(c.assumed_approved_intervention_ids).toEqual([SATELLITE]);
    expect(c.note).toContain('If these measures are approved');
    expect(c.note).toContain('Not in effect yet');
    // 手算：设备借用给 5 名交通可靠的学生（$100 + 5 × $20）+ 卫星会场给 3 名缺交通的学生（$60 + 3 × $10）= $290，G = 8。
    expect(c.G).toBe(8);
    expect(c.cost).toEqual({ fixed_usd: 160, marginal_usd: 130, total_usd: 290 });
    expect(c.selected_intervention_ids).toEqual([LAPTOP, SATELLITE]);
    expect(
      c.allocations.filter((a) => a.intervention_id === SATELLITE).map((a) => a.student_id),
    ).toEqual([...NO_TRANSPORT]);
    const withR0: JointPlan = { ...c, R0: r.R0 } as JointPlan;
    const v = verifyPlan(base, withR0, { assume_approved_intervention_ids: c.assumed_approved_intervention_ids });
    expect(v.passed).toBe(true);
    // 不假设获批时，同一方案复核不通过（approval）。
    expect(verifyPlan(base, c).passed).toBe(false);
  });

  it('必须启用 pending 措施：主结果 INFEASIBLE，conditional 可行', () => {
    const r = solveJoint(deviceLoanScenario, { required_intervention_ids: [SATELLITE] });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.alternative?.relaxed).toEqual(['required_intervention_ids']);
    expect(r.alternative?.note).toContain('pending approval');
    expect(r.alternative?.G).toBe(5);
    // 获批后：设备借用 5 人 $200 + 卫星会场固定 $60（笔记本名额已用完，缺交通的学生仍缺笔记本，无人可分）= $260。
    expect(r.conditional?.status).toBe('OPTIMAL');
    expect(r.conditional?.G).toBe(5);
    expect(r.conditional?.cost.total_usd).toBe(260);
    expect(r.conditional?.selected_intervention_ids).toEqual([LAPTOP, SATELLITE]);
  });
});

describe('互斥与前置依赖', () => {
  // 变体：10 人都已有学校笔记本 → 只剩 3 名缺交通的学生不可达；卫星会场改为 approved。
  const allLaptops: Scenario = withInterventionPatch(
    { ...deviceLoanScenario, existing_grants: deviceLoanScenario.students.map((s) => laptopGrant(s.id)) },
    SATELLITE,
    { status: 'approved' },
  );

  it('R0 = 7 名交通可靠的学生；最便宜的是交通补助 3 × $25 = $75', () => {
    const r = solveJoint(allLaptops);
    expect(r.R0).toEqual(pairsOf(RELIABLE));
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(3);
    expect(r.selected_intervention_ids).toEqual([SUBSIDY]);
    expect(r.cost.total_usd).toBe(75);
    expect(r.conditional ?? null).toBeNull();
  });

  it('前置依赖：线上入口必须连同设备借用一起启用（只选中、不必分配），成本计入其固定成本', () => {
    const s = withEnabledInterventions(allLaptops, [LAPTOP, ONLINE]);
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual([LAPTOP, ONLINE]);
    expect(r.allocations.every((a) => a.intervention_id === ONLINE)).toBe(true);
    expect(r.G).toBe(3);
    // $150 + $100（依赖项固定成本）+ 3 × $0 = $250。
    expect(r.cost.total_usd).toBe(250);
    expect(r.verification?.passed).toBe(true);
    // 预算 $200 不够 $250 → 只能不启用。
    const poor = solveJoint(withBudget(s, 200));
    expect(poor.status).toBe('OPTIMAL');
    expect(poor.selected_intervention_ids).toEqual([]);
    expect(poor.G).toBe(0);
  });

  it('互斥：线上入口与卫星会场不会同时选中；同时要求两者 → INFEASIBLE 并写明互斥', () => {
    const s = withEnabledInterventions(allLaptops, [LAPTOP, ONLINE, SATELLITE]);
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    // 卫星会场 $60 + 3 × $10 = $90 < 线上入口 $250。
    expect(r.selected_intervention_ids).toEqual([SATELLITE]);
    expect(r.cost.total_usd).toBe(90);

    const both = solveJoint(s, { required_intervention_ids: [ONLINE, SATELLITE] });
    expect(both.status).toBe('INFEASIBLE');
    expect(both.alternative?.relaxed).toEqual(['required_intervention_ids']);
    expect(both.alternative?.note).toContain('mutually exclusive');
    expect(both.alternative?.selected_intervention_ids).toEqual([SATELLITE]);
    expect(both.alternative?.selected_intervention_ids.includes(ONLINE)).toBe(false);
  });

  it('同时给出两项软要求、都不可行时两项都放松', () => {
    const s = withEnabledInterventions(allLaptops, [LAPTOP, ONLINE, SATELLITE]);
    // 必须同时启用两个互斥措施（不可行）；min_gain 4 > 最多 3（不可行）。
    const r = solveJoint(s, { required_intervention_ids: [ONLINE, SATELLITE], min_gain: 4 });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.alternative?.relaxed).toEqual(['min_gain', 'required_intervention_ids']);
    expect(r.alternative?.G).toBe(3);
  });
});

describe('existing_grants 占容量、免成本', () => {
  it('已有同一措施的 approved grant：计入 R0，占 1 个名额', () => {
    const grant: ResourceGrant = { ...laptopGrant('dl-s01'), id: 'prior-loan-s01', intervention_id: LAPTOP };
    const r = solveJoint(laptopOnly({ ...deviceLoanScenario, existing_grants: [grant] }));
    expect(r.R0).toEqual(pairsOf(['dl-s01']));
    expect(r.status).toBe('OPTIMAL');
    // 名额剩 4：$100 + 4 × $20 = $180。
    expect(r.G).toBe(4);
    expect(studentsOf(r)).toEqual(['dl-s02', 'dl-s04', 'dl-s05', 'dl-s07']);
    expect(r.cost.total_usd).toBe(180);
    expect(r.R1).toHaveLength(5);
  });

  it('已有同一措施的 pending grant：占名额（保守），但不免成本——该学生再分配要照常计费', () => {
    const grant: ResourceGrant = { ...laptopGrant('dl-s01'), id: 'pending-loan-s01', intervention_id: LAPTOP, status: 'pending' };
    const r = solveJoint(laptopOnly({ ...deviceLoanScenario, existing_grants: [grant] }));
    expect(r.R0).toEqual([]);
    expect(r.status).toBe('OPTIMAL');
    // dl-s01 已占 1 个名额：再分配给 dl-s01 不另占名额，其他人最多 4 个 → 仍可服务 5 人；
    // 但 pending 不免成本：$100 + 5 × $20 = $200。
    expect(r.G).toBe(5);
    expect(studentsOf(r)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07']);
    expect(r.allocations.find((a) => a.student_id === 'dl-s01')?.cost_usd).toBe(20);
    expect(r.cost.total_usd).toBe(200);
    expect(r.verification?.passed).toBe(true);
  });

  it('复现：措施已批准、容量 1、单价 $100，学生 t 有同措施的 pending 已有 grant → 给 t 分配计 $100', () => {
    const base = deviceLoanScenario.opportunities[0];
    const t = { ...clone(deviceLoanScenario.students[0]), id: 't' };
    const s: Scenario = {
      ...deviceLoanScenario,
      students: [t],
      opportunities: [base],
      interventions: [
        { id: 'loan', title: 'Sample loan', type: 'device', resolves: ['device'], device: 'laptop', unit_cost_usd: 100, fixed_cost_usd: 0, capacity: 1 },
      ],
      existing_grants: [{ ...laptopGrant('t'), id: 'pending-t', intervention_id: 'loan', status: 'pending' }],
      opportunity_time_slots: undefined,
    };
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    expect(r.allocations).toEqual([{ intervention_id: 'loan', student_id: 't', opportunity_id: OPP, cost_usd: 100 }]);
    expect(r.cost.total_usd).toBe(100);
    expect(r.verification?.passed).toBe(true);
    // 复核也不接受把它记 0。
    const cheat: JointPlan = { selected_intervention_ids: ['loan'], allocations: [{ ...r.allocations[0], cost_usd: 0 }] };
    expect(verifyPlan(s, cheat).checks.find((c) => c.name === 'cost_accounting')?.passed).toBe(false);
  });
});

describe('容量口径：per_time_slot 与 total', () => {
  // 两个不同时段的机会：A 只收 9–10 年级，B 只收 11–12 年级（虚构）。
  // 交通可靠的学生里，9–10 年级：dl-s01/s02/s05/s07/s10（5 人）；11–12 年级：dl-s04/s08（2 人）。
  function twoSlots(scope: 'per_time_slot' | 'total'): Scenario {
    const base = deviceLoanScenario.opportunities[0];
    const mk = (id: string, min: number, max: number): Opportunity => ({
      ...clone(base),
      id,
      title: `[Sample / Placeholder] In-person workshop ${id}`,
      requirements: base.requirements.map((r) => (r.type === 'grade' ? { ...r, min, max } : r)),
    });
    const s = withEnabledInterventions(
      {
        ...deviceLoanScenario,
        opportunities: [mk('opp-a', 9, 10), mk('opp-b', 11, 12)],
        opportunity_time_slots: { 'opp-a': 'saturday', 'opp-b': 'sunday' },
      },
      [LAPTOP],
    );
    return withInterventionPatch(s, LAPTOP, { capacity_scope: scope });
  }

  it('per_time_slot：每个时段各 5 台 → G = 5 + 2 = 7，$100 + 7 × $20 = $240', () => {
    const r = solveJoint(twoSlots('per_time_slot'));
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(7);
    expect(r.cost.total_usd).toBe(240);
    expect(r.verification?.passed).toBe(true);
  });

  it('total：整个场景只能服务 5 名不同学生 → G = 5，$200', () => {
    const r = solveJoint(twoSlots('total'));
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(5);
    expect(studentsOf(r)).toHaveLength(5);
    expect(r.cost.total_usd).toBe(200);
    expect(r.verification?.passed).toBe(true);
  });

  it('同一学生凭同一措施参加两个机会只占 1 个名额、只计一次成本', () => {
    const base = deviceLoanScenario.opportunities[0];
    const s = withInterventionPatch(
      laptopOnly({
        ...deviceLoanScenario,
        opportunities: [base, { ...clone(base), id: 'opp-twin', title: '[Sample / Placeholder] Another session the same day' }],
        opportunity_time_slots: { [OPP]: 'day', 'opp-twin': 'day' },
      }),
      LAPTOP,
      { capacity_scope: 'total' },
    );
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    // 5 名学生 × 2 个机会 = 10 对；成本 $100 + 5 × $20（每人只计一次）= $200。
    expect(r.G).toBe(10);
    expect(r.allocations).toHaveLength(10);
    expect(r.cost.total_usd).toBe(200);
    expect(r.allocations.filter((a) => a.cost_usd > 0)).toHaveLength(5);
    expect(r.verification?.passed).toBe(true);
  });
});

describe('全场景（全部措施）', () => {
  it('预算 $400：笔记本是瓶颈，G = 5，只启用设备借用，$200；卫星会场获批也不改变结果', () => {
    // 手算：每个新增可达的对都要一台借用笔记本（5 台），最省的是给 5 名交通可靠的学生（每人 $20），
    // 给缺交通的学生还要额外的交通措施，只会更贵。总成本 $100 + 5 × $20 = $200。
    const r = solveJoint(deviceLoanScenario);
    expectConsistent(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.R0).toEqual([]);
    expect([r.G, r.L, r.N]).toEqual([5, 0, 5]);
    expect(r.selected_intervention_ids).toEqual([LAPTOP]);
    expect(studentsOf(r)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07']);
    expect(r.cost).toEqual({ fixed_usd: 100, marginal_usd: 100, total_usd: 200 });
    expect(r.verification?.passed).toBe(true);
    expect(r.alternative ?? null).toBeNull();
    expect(r.conditional?.status).toBe('OPTIMAL');
    expect(r.conditional?.assumed_approved_intervention_ids).toEqual([SATELLITE]);
    expect(r.conditional?.G).toBe(5);
    expect(r.conditional?.cost.total_usd).toBe(200);
  });

  it('主办方必须启用交通补助：仍只补贴有用的人（无人可补贴时不做无效分配）', () => {
    const r = solveJoint(deviceLoanScenario, { required_intervention_ids: [SUBSIDY] });
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual([LAPTOP, SUBSIDY]);
    expect(r.allocations.every((a) => a.intervention_id === LAPTOP)).toBe(true);
    expect(r.G).toBe(5);
  });
});

describe('UNSUPPORTED_INPUT', () => {
  const S = deviceLoanScenario;
  const cases: [string, Scenario, Parameters<typeof solveJoint>[1]][] = [
    ['negative budget', withBudget(S, -1), {}],
    ['budget not finite', withBudget(S, Number.NaN), {}],
    ['tradeoff without loss_cap', S, { mode: 'tradeoff' }],
    ['negative loss_cap', S, { mode: 'tradeoff', loss_cap: -1 }],
    ['min_gain not finite', S, { min_gain: Number.POSITIVE_INFINITY }],
    ['max_search_nodes is 0', S, { max_search_nodes: 0 }],
    ['max_search_nodes not an integer', S, { max_search_nodes: 1.5 }],
    ['duplicate student id', { ...S, students: [...S.students, S.students[0]] }, {}],
    ['duplicate opportunity id', { ...S, opportunities: [...S.opportunities, S.opportunities[0]] }, {}],
    ['duplicate support measure id', { ...S, interventions: [...S.interventions, S.interventions[0]] }, {}],
    ['required references a missing measure', S, { required_intervention_ids: ['nope'] }],
    ['requires references itself', withInterventionPatch(S, LAPTOP, { requires: [LAPTOP] }), {}],
    ['requires references a missing measure', withInterventionPatch(S, LAPTOP, { requires: ['nope'] }), {}],
    ['mutual exclusion references a missing measure', withInterventionPatch(S, LAPTOP, { mutually_exclusive_with: ['nope'] }), {}],
    ['mutual exclusion references itself', withInterventionPatch(S, LAPTOP, { mutually_exclusive_with: [LAPTOP] }), {}],
    ['opportunity_ids references a missing opportunity', withInterventionPatch(S, LAPTOP, { opportunity_ids: ['nope'] }), {}],
    ['time slot key references a missing opportunity', { ...S, opportunity_time_slots: { nope: 'x' } }, {}],
    ['negative capacity', withInterventionPatch(S, LAPTOP, { capacity: -1 }), {}],
    ['unit cost not finite', withInterventionPatch(S, LAPTOP, { unit_cost_usd: Number.NaN }), {}],
    ['negative fixed cost', withInterventionPatch(S, LAPTOP, { fixed_cost_usd: -5 }), {}],
    ['invalid evaluation date', { ...S, evaluation_date: '2026-02-30' }, {}],
    ['wrong evaluation date format', { ...S, evaluation_date: '2026/11/17' }, {}],
    ['evaluation date with leading space', { ...S, evaluation_date: ' 2026-11-17' }, {}],
    ['evaluation date with trailing space', { ...S, evaluation_date: '2026-11-17 ' }, {}],
    ['time slot label not a string', { ...S, opportunity_time_slots: { [OPP]: 1 as unknown as string } }, {}],
    ['time slot label is an empty string', { ...S, opportunity_time_slots: { [OPP]: '' } }, {}],
    ['opportunity_time_slots is not an object', { ...S, opportunity_time_slots: 'x' as unknown as Record<string, string> }, {}],
    ['measure amount_usd negative', withInterventionPatch(S, SUBSIDY, { amount_usd: -25 }), {}],
    ['measure hours_per_week not finite', withInterventionPatch(S, LAPTOP, { hours_per_week: Number.POSITIVE_INFINITY }), {}],
    ['existing grant hours_per_week negative', { ...S, existing_grants: [{ ...laptopGrant('dl-s01'), type: 'time_support', hours_per_week: -3 }] }, {}],
    ['existing grant amount_usd not finite', { ...S, existing_grants: [{ ...laptopGrant('dl-s01'), amount_usd: Number.NaN }] }, {}],
    ['mode is not protect / tradeoff', S, { mode: 'aggressive' as 'protect' }],
    ['students is not an array', { ...S, students: null as unknown as Scenario['students'] }, {}],
    [
      'existing grants alone exceed capacity',
      {
        ...S,
        existing_grants: S.students.slice(0, 6).map((s) => ({ ...laptopGrant(s.id), id: `g-${s.id}`, intervention_id: LAPTOP })),
      },
      {},
    ],
  ];
  for (const [name, scenario, options] of cases) {
    it(name, () => {
      const r = solveJoint(scenario, options);
      expect(r.status).toBe('UNSUPPORTED_INPUT');
      expect(r.selected_intervention_ids).toEqual([]);
      expect(r.allocations).toEqual([]);
      expect(r.R0).toEqual([]);
      expect(r.R1).toEqual([]);
      expect([r.G, r.L, r.N]).toEqual([0, 0, 0]);
      expect(r.cost).toEqual({ fixed_usd: 0, marginal_usd: 0, total_usd: 0 });
      expect(r.alternative ?? null).toBeNull();
      expect(r.conditional ?? null).toBeNull();
      expect(r.verification ?? null).toBeNull();
      expect(r.notes.length).toBeGreaterThan(1);
    });
  }

  it('existing grant 恰好占满容量不算超出', () => {
    const s = {
      ...S,
      existing_grants: S.students.slice(0, 5).map((st) => ({ ...laptopGrant(st.id), id: `g-${st.id}`, intervention_id: LAPTOP })),
    };
    const r = solveJoint(laptopOnly(s));
    expect(r.status).toBe('OPTIMAL');
    // dl-s03 有笔记本但仍缺交通 → R0 = 4 对；名额已满，无法再借。
    expect(r.R0).toEqual(pairsOf(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05']));
    expect(r.G).toBe(0);
  });

  it('tradeoff 给了 loss_cap 是合法输入', () => {
    expect(solveJoint(laptopOnly(), { mode: 'tradeoff', loss_cap: 0 }).status).toBe('OPTIMAL');
  });
});

describe('搜索上限', () => {
  it('max_search_nodes 很小：SEARCH_LIMIT_REACHED，不声称最优，方案通过复核或为空方案', () => {
    for (const n of [1, 10, 50, 100, 500, 2000]) {
      const r = solveJoint(deviceLoanScenario, { max_search_nodes: n });
      expect(r.status).toBe('SEARCH_LIMIT_REACHED');
      expect(r.notes.join('')).toContain('optimality is not proven');
      expect(r.verification).toBeTruthy();
      if (r.selected_intervention_ids.length > 0 || r.allocations.length > 0) {
        expect(r.verification!.passed).toBe(true);
      } else {
        expect(r.cost.total_usd).toBe(0);
        expect(r.R1).toEqual(r.R0);
        expect(r.notes.join('')).toContain('placeholder plan');
      }
      expect(r.cost.total_usd).toBeLessThanOrEqual(deviceLoanScenario.budget_usd);
    }
  });

  it('上限足够时得到 OPTIMAL（缺省上限）', () => {
    expect(solveJoint(deviceLoanScenario).status).toBe('OPTIMAL');
  });
});

describe('确定性与纯函数', () => {
  it('同输入两次结果相同', () => {
    expect(solveJoint(deviceLoanScenario)).toEqual(solveJoint(deviceLoanScenario));
    const opts = { required_intervention_ids: [LAPTOP], min_gain: 9 };
    expect(solveJoint(deviceLoanScenario, opts)).toEqual(solveJoint(deviceLoanScenario, opts));
  });

  it('不修改输入对象', () => {
    const scenario = clone(deviceLoanScenario);
    const options = { required_intervention_ids: [LAPTOP], min_gain: 2 };
    const before = clone({ scenario, options });
    solveJoint(scenario, options);
    expect({ scenario, options }).toEqual(before);
  });

  it('输出数组按契约排序', () => {
    const r = solveJoint(deviceLoanScenario);
    const key = (a: { intervention_id: string; student_id: string; opportunity_id: string }) =>
      [a.intervention_id, a.student_id, a.opportunity_id].join('\u0000');
    const sorted = [...r.allocations].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    expect(r.allocations).toEqual(sorted);
    expect([...r.selected_intervention_ids].sort()).toEqual(r.selected_intervention_ids);
  });

  it('公平性：只改学校名和显示名，结果不变', () => {
    const renamed: Scenario = {
      ...deviceLoanScenario,
      students: deviceLoanScenario.students.map((s, k) => ({ ...s, school_name: `Other School ${9 - k} (fictional)`, display_name: `X${k}` })),
    };
    const a = solveJoint(deviceLoanScenario);
    const b = solveJoint(renamed);
    expect(b.allocations).toEqual(a.allocations);
    expect(b.G).toBe(a.G);
  });
});

describe('scenarios 辅助函数', () => {
  it('withEnabledInterventions：前置依赖未启用的措施一并移除（不放松依赖），清理互斥引用，不修改原场景', () => {
    const before = clone(deviceLoanScenario);
    // 线上入口 requires 设备借用；设备借用没勾 → 线上入口被移除，而不是删掉 requires 让它单独生效。
    const s = withEnabledInterventions(deviceLoanScenario, [ONLINE, SATELLITE]);
    expect(s.interventions.map((i) => i.id)).toEqual([SATELLITE]);
    expect(resolveEnabledInterventions(deviceLoanScenario, [ONLINE, SATELLITE]).removed).toEqual([
      { id: ONLINE, missing_requires: [LAPTOP] },
    ]);
    expect(deviceLoanScenario).toEqual(before);
    expect(solveJoint(s).status).not.toBe('UNSUPPORTED_INPUT');
    // 依赖一起勾上：都保留，requires 原样保留；互斥对象没勾 → 清理该互斥引用。
    const both = withEnabledInterventions(deviceLoanScenario, [ONLINE, LAPTOP]);
    expect(both.interventions.map((i) => i.id)).toEqual([LAPTOP, ONLINE]);
    const online = both.interventions.find((i) => i.id === ONLINE)!;
    expect(online.requires).toEqual([LAPTOP]);
    expect(online.mutually_exclusive_with).toEqual([]);
  });

  it('withEnabledInterventions：依赖链按闭包移除（c 需要 b，b 需要 a，只勾 b、c → 都移除）', () => {
    const mk = (id: string, requires?: string[]): Intervention => ({
      id,
      title: `Sample support measure ${id}`,
      type: 'device',
      resolves: ['device'],
      device: 'laptop',
      unit_cost_usd: 1,
      capacity: null,
      ...(requires ? { requires } : {}),
    });
    const s: Scenario = { ...deviceLoanScenario, interventions: [mk('c', ['b']), mk('b', ['a']), mk('a')] };
    const r = resolveEnabledInterventions(s, ['c', 'b']);
    expect(r.enabled).toEqual([]);
    expect(r.removed.map((x) => x.id).sort()).toEqual(['b', 'c']);
    expect(withEnabledInterventions(s, ['c', 'b']).interventions).toEqual([]);
    expect(withEnabledInterventions(s, ['c', 'b', 'a']).interventions.map((i) => i.id)).toEqual(['c', 'b', 'a']);
    // 依赖成环且都勾上：都保留。
    const cyc: Scenario = { ...deviceLoanScenario, interventions: [mk('x', ['y']), mk('y', ['x'])] };
    expect(resolveEnabledInterventions(cyc, ['x', 'y']).enabled).toEqual(['x', 'y']);
    expect(resolveEnabledInterventions(cyc, ['x']).enabled).toEqual([]);
  });

  it('withBudget 返回新场景', () => {
    const s = withBudget(deviceLoanScenario, 123);
    expect(s.budget_usd).toBe(123);
    expect(deviceLoanScenario.budget_usd).toBe(400);
  });
});

describe('第 1 层评审修复', () => {
  it('M1(a) 复现：时段标签不是字符串 → UNSUPPORTED_INPUT（不再给出复核不通过的 OPTIMAL）', () => {
    const base = deviceLoanScenario.opportunities[0];
    const o1: Opportunity = { ...clone(base), id: 'o1', title: '[Sample / Placeholder] o1', requirements: base.requirements.map((r) => (r.type === 'grade' ? { ...r, min: 9, max: 10 } : r)) };
    const o2: Opportunity = { ...clone(base), id: 'o2', title: '[Sample / Placeholder] o2', requirements: base.requirements.map((r) => (r.type === 'grade' ? { ...r, min: 11, max: 12 } : r)) };
    const a = { ...clone(deviceLoanScenario.students[0]), id: 'a', grade: 10 };
    const b = { ...clone(deviceLoanScenario.students[0]), id: 'b', grade: 11 };
    const loan: Intervention = { id: 'loan', title: 'Sample loan', type: 'device', resolves: ['device'], device: 'laptop', unit_cost_usd: 10, capacity: 1, capacity_scope: 'per_time_slot' };
    const sc: Scenario = {
      ...deviceLoanScenario,
      students: [a, b],
      opportunities: [o1, o2],
      interventions: [loan],
      opportunity_time_slots: { o1: 1, o2: 2 } as unknown as Record<string, string>,
    };
    const r = solveJoint(sc);
    expect(r.status).toBe('UNSUPPORTED_INPUT');
    expect(r.notes.join('')).toContain('time slot label');
    expect(verifyPlan(sc, { selected_intervention_ids: [], allocations: [] }).checks.find((c) => c.name === 'input_validity')?.passed).toBe(false);
    // 标签改成合法字符串后：两个时段各 1 个名额 → G = 2，OPTIMAL 且复核通过。
    const ok = solveJoint({ ...sc, opportunity_time_slots: { o1: 'AM', o2: 'PM' } });
    expect(ok.status).toBe('OPTIMAL');
    expect(ok.G).toBe(2);
    expect(ok.verification?.passed).toBe(true);
  });

  it('S1：options 中 loss_cap / min_gain 为 null 视同未给；措施 capacity 缺省（undefined）视同不限', () => {
    const r = solveJoint(laptopOnly(), { loss_cap: null, min_gain: null } as unknown as Parameters<typeof solveJoint>[1]);
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(5);
    expect(r.verification?.passed).toBe(true);
    const unlimited = laptopOnly(
      withInterventionPatch(deviceLoanScenario, LAPTOP, { capacity: undefined as unknown as null }),
    );
    const u = solveJoint(unlimited);
    expect(u.status).toBe('OPTIMAL');
    expect(u.G).toBe(7); // 不限名额：7 名交通可靠的学生都能借到
    expect(u.verification?.passed).toBe(true);
  });

  it('S4 复现：免费且无作用的 time_support 不会被选中（选中措施数更少者优先）', () => {
    const base = deviceLoanScenario.opportunities[0];
    const online: Opportunity = { ...clone(base), id: 'o-online', title: '[Sample / Placeholder] Online', location: { format: 'online' } };
    const stu = { ...clone(deviceLoanScenario.students[0]), id: 'x' };
    const sc: Scenario = {
      ...deviceLoanScenario,
      students: [stu],
      opportunities: [online],
      opportunity_time_slots: undefined,
      interventions: [
        { id: 'a', title: 'Sample time support', type: 'time_support', resolves: ['time'], hours_per_week: 0, unit_cost_usd: 0, fixed_cost_usd: 0, capacity: null },
        { id: 'b', title: 'Sample laptop loan', type: 'device', resolves: ['device'], device: 'laptop', unit_cost_usd: 10, fixed_cost_usd: 0, capacity: null },
      ],
    };
    const r = solveJoint(sc);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual(['b']);
    expect(r.allocations.map((x) => x.intervention_id)).toEqual(['b']);
    expect(r.cost.total_usd).toBe(10);
  });

  it('S2（第 3 层改写）：不撤回已有 grant 时 L 恒为 0（措施额度非负 → grant 只帮忙）', () => {
    // 第 3 层契约起 L > 0 可能来自撤回（见 solve-tradeoff.test.ts）；本场景没有可撤回的已有 grant，L 仍为 0。
    for (const r of [solveJoint(deviceLoanScenario), solveJoint(laptopOnly(), { mode: 'tradeoff', loss_cap: 3 })]) {
      expect(r.L).toBe(0);
      expect(r.revoked_grant_ids).toEqual([]);
      expect(r.lost_pairs).toEqual([]);
      expect(r.revocations).toEqual([]);
      expect(r.conditional?.L ?? 0).toBe(0);
    }
  });

  it('notes 写明名额并列按学生编号（模拟、不代表谁更需要）；conditional 不说「已生效」', () => {
    const r = solveJoint(deviceLoanScenario);
    expect(r.notes.join('')).toContain('When capacity is tied, slots go in student id order (simulated). This does not represent who needs help more');
    expect(r.conditional?.note).toContain('main result, which has approved measures only');
    expect(r.conditional?.note).not.toMatch(/(currently|already|now) in effect/i);
    const req = solveJoint(deviceLoanScenario, { required_intervention_ids: [SATELLITE] });
    expect(req.alternative?.note).not.toMatch(/(currently|already|now) in effect/i);
  });
});
