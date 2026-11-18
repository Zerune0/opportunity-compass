/**
 * solveJoint 第 3 层：权衡分析模式（撤回已有 grant）与保护模式「不动任何已有承诺」。
 * 规范：CONTRACT.md「联合求解模型」第 2、3（第 8 款 a–d）、5 条。全部是示例 / 模拟数据。
 *
 * 权衡场景 data/scenarios/venue-tradeoff.json 的手算依据：
 * - 两个占位机会：工作日场 WD（时段 2027-01-13-wed）、周末场 WE（时段 2027-01-16-sat），都在主会场线下举行、免费、
 *   每周 3 小时、不需要设备；资格 = 9–12 年级 + 加州居民。
 * - 9 名示例学生 vt-s01…vt-s09：全部符合两场的资格、都有笔记本、每周可用 6 小时，**全部没有交通**
 *   （transport.level = none）→ 每个对都只差交通这一条障碍。statuses：全部 high_school_student；
 *   vt-s06…vt-s09 含 low_income；vt-s02 / vt-s05 / vt-s08 含 first_generation。
 * - 措施（全部 approved）：
 *   iv-weekday-shuttle   工作日接驳车（已在运行）transport_subsidy，仅 WD，容量 3，每人 $15，与卫星会场互斥
 *   iv-weekday-carpool   工作日拼车补助          transport_subsidy，仅 WD，容量 2，每人 $25，与卫星会场互斥
 *   iv-weekend-satellite 周末卫星会场            alternative_access，仅 WE，容量 6，固定 $80 + 每人 $10
 * - 已有 grant：shuttle-grant-1/2/3 → vt-s01/s02/s03 的 WD（approved，intervention_id = 接驳车，占满容量 3）。
 * - 预算 $300，evaluation_date 2026-11-17。
 * R0 = {(s01,WD), (s02,WD), (s03,WD)}（3 个对，靠接驳车）。
 * - protect（默认）：卫星会场与「有已有 grant 的接驳车」互斥 → 不能选（启用就必须撤回，而保护模式不撤回）。
 *   接驳车名额已满、R0 的对无需再分配；拼车补助 2 个名额给工作日场 → 按编号给 s04、s05：G = 2、L = 0、N = 2，$50。
 * - tradeoff，loss_cap ≥ 3：启用卫星会场 → 强制撤回 3 条接驳车 grant（forced_by = 卫星会场），s01–s03 的 WD 不可达
 *   （接驳车、拼车都与卫星会场互斥，无法补位）→ L = 3；卫星会场 6 个座位给周末场，按编号 s01…s06 → G = 6；
 *   N = 3 > 2，成本 $80 + 6 × $10 = $140。
 * - tradeoff，loss_cap = 2：卫星会场会造成 L = 3 > 2，不能启用 → 与 protect 相同（N = 2）。
 */
import { describe, expect, it } from 'vitest';
import { solveJoint } from './solve';
import { verifyPlan } from './verify';
import { VENUE_TRADEOFF_IDS as V, deviceLoanScenario, venueTradeoffScenario, withEnabledInterventions } from './scenarios';
import { validateOpportunities, validateProfile } from '../validation';
import type { Intervention, JointPlan, JointResult, Opportunity, ResourceGrant, Scenario, SolveOptions, StudentProfile } from '../types';

const WD = V.weekdayOpportunity;
const WE = V.weekendOpportunity;
const SHUTTLE = V.weekdayShuttle;
const CARPOOL = V.weekdayCarpool;
const SATELLITE = V.weekendSatellite;

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const pairs = (ids: string[], opp: string) => ids.map((s) => ({ student_id: s, opportunity_id: opp }));
const studentsOf = (r: { allocations: { student_id: string }[] }) => [...new Set(r.allocations.map((a) => a.student_id))].sort();

/** 用求解时的同一组选项独立复核（带 R0，metrics 会逐项比对）。 */
function verifyWith(s: Scenario, r: JointResult, opts: SolveOptions = {}) {
  const { mode, loss_cap, required_intervention_ids, min_gain, fairness_floors } = opts;
  const vo = Object.fromEntries(
    Object.entries({ mode, loss_cap, required_intervention_ids, min_gain, fairness_floors }).filter(([, v]) => v !== undefined),
  );
  return verifyPlan(s, r as JointPlan, vo);
}

function expectWellFormed(r: JointResult) {
  expect(r.N).toBe(r.G - r.L);
  expect(r.lost_pairs).toHaveLength(r.L);
  expect(r.revocations?.map((x) => x.grant_id)).toEqual(r.revoked_grant_ids);
  expect([...(r.revoked_grant_ids ?? [])].sort()).toEqual(r.revoked_grant_ids);
  expect(r.cost.total_usd).toBeCloseTo(r.cost.fixed_usd + r.cost.marginal_usd, 9);
}

// ───────────────────────────── 虚构小场景的构件（基于演示场景的示例学生 / 占位机会） ─────────────────────────────

const baseOpp = deviceLoanScenario.opportunities[0]; // 线下、需要 laptop、9–12 年级、加州
const baseStudent = deviceLoanScenario.students[0]; // 交通可靠，只缺 laptop

function opp(id: string, minGrade = 9, maxGrade = 12): Opportunity {
  return {
    ...clone(baseOpp),
    id,
    title: `【示例 / 占位】${id}`,
    requirements: baseOpp.requirements.map((r) => (r.type === 'grade' ? { ...r, min: minGrade, max: maxGrade } : r)),
  };
}
function student(id: string, grade = 10): StudentProfile {
  return { ...clone(baseStudent), id, grade, display_name: `示例学生 ${id}` };
}
function loan(id: string, patch: Partial<Intervention> = {}): Intervention {
  return { id, title: `示例借用 ${id}`, type: 'device', resolves: ['device'], device: 'laptop', unit_cost_usd: 10, fixed_cost_usd: 0, capacity: null, ...patch };
}
function laptopGrant(id: string, s: string, o: string, iv: string | null, status: 'approved' | 'pending' = 'approved'): ResourceGrant {
  return { id, student_id: s, opportunity_id: o, intervention_id: iv, type: 'device', device: 'laptop', status, provider: '示例（模拟）', is_sample: true };
}
function mini(p: Partial<Scenario>): Scenario {
  return {
    id: 'mini',
    title: '示例 / 模拟小场景',
    is_sample: true,
    evaluation_date: deviceLoanScenario.evaluation_date,
    budget_usd: 1000,
    students: [],
    opportunities: [],
    interventions: [],
    ...p,
  };
}

// ───────────────────────────── 权衡场景数据 ─────────────────────────────

describe('venue-tradeoff 场景数据', () => {
  it('全部是示例：占位机会、example.com、示例学生，通过机会 / 档案校验', () => {
    const s = venueTradeoffScenario;
    expect(s.is_sample).toBe(true);
    expect(s.students).toHaveLength(9);
    expect(s.students.every((x) => x.is_sample === true)).toBe(true);
    expect(s.opportunities.map((o) => o.id)).toEqual([WD, WE]);
    for (const o of s.opportunities) {
      expect(o.is_sample).toBe(true);
      expect(o.title).toContain('占位');
      expect(o.official_url).toContain('example.com');
    }
    expect(validateOpportunities(s.opportunities)).toEqual([]);
    for (const p of s.students) expect(validateProfile(p)).toEqual([]);
    expect((s.existing_grants ?? []).every((g) => g.is_sample === true && g.intervention_id === SHUTTLE)).toBe(true);
  });
});

// ───────────────────────────── 权衡场景：protect / tradeoff ─────────────────────────────

describe('venue-tradeoff：保护模式不动已有承诺', () => {
  it('protect（默认）：卫星会场不能启用；拼车补助 2 人 → G = 2、L = 0、N = 2、$50，不撤回', () => {
    const r = solveJoint(venueTradeoffScenario);
    expectWellFormed(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.R0).toEqual(pairs(['vt-s01', 'vt-s02', 'vt-s03'], WD));
    expect(r.selected_intervention_ids).toEqual([CARPOOL]);
    expect(r.selected_intervention_ids).not.toContain(SATELLITE);
    expect(r.allocations.map((a) => [a.student_id, a.opportunity_id])).toEqual([
      ['vt-s04', WD],
      ['vt-s05', WD],
    ]);
    expect([r.G, r.L, r.N]).toEqual([2, 0, 2]);
    expect(r.cost).toEqual({ fixed_usd: 0, marginal_usd: 50, total_usd: 50 });
    expect(r.revoked_grant_ids).toEqual([]);
    expect(r.revocations).toEqual([]);
    expect(r.lost_pairs).toEqual([]);
    expect(r.fairness).toBeUndefined();
    expect(r.verification?.passed).toBe(true);
    expect(verifyWith(venueTradeoffScenario, r).passed).toBe(true);
    // 显式 mode: 'protect' 与缺省相同。
    expect(solveJoint(venueTradeoffScenario, { mode: 'protect' })).toEqual(r);
  });

  it('protect：把卫星会场设为必须启用 → INFEASIBLE，alternative 放松「必须启用」并写明保护模式不撤回', () => {
    const r = solveJoint(venueTradeoffScenario, { required_intervention_ids: [SATELLITE] });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.revoked_grant_ids).toEqual([]);
    expect(r.R1).toEqual(r.R0);
    const alt = r.alternative!;
    expect(alt.relaxed).toEqual(['required_intervention_ids']);
    expect(alt.note).toContain('互斥');
    expect(alt.note).toContain('保护模式');
    expect(alt.note).toContain(SHUTTLE);
    expect(alt.revoked_grant_ids).toEqual([]);
    expect(alt.G).toBe(2);
    expect(verifyPlan(venueTradeoffScenario, alt).passed).toBe(true);
    // 权衡模式下同一要求可行（L = 3 ≤ 3）。
    const t = solveJoint(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 3, required_intervention_ids: [SATELLITE] });
    expect(t.status).toBe('OPTIMAL');
    expect(t.N).toBe(3);
  });

  it('protect：任何结果（主结果、alternative、conditional）的 revoked_grant_ids 都为空', () => {
    const pendingSat = { ...venueTradeoffScenario, interventions: venueTradeoffScenario.interventions.map((iv) => (iv.id === SATELLITE ? { ...iv, status: 'pending' as const } : iv)) };
    const runs: [Scenario, SolveOptions][] = [
      [venueTradeoffScenario, {}],
      [venueTradeoffScenario, { min_gain: 6 }],
      [venueTradeoffScenario, { required_intervention_ids: [SATELLITE, SHUTTLE] }],
      [venueTradeoffScenario, { fairness_floors: [{ id: 'f', label: '低收入学生', basis: '示例依据', statuses_any_of: ['low_income'], min_ratio: 0.5 }] }],
      [pendingSat, {}],
      [{ ...venueTradeoffScenario, budget_usd: 10_000 }, {}],
    ];
    for (const [s, o] of runs) {
      const r = solveJoint(s, o);
      for (const plan of [r, r.alternative, r.conditional]) {
        if (!plan) continue;
        expect(plan.revoked_grant_ids).toEqual([]);
        expect(plan.revocations).toEqual([]);
        expect(plan.L).toBe(0);
        expect(plan.selected_intervention_ids).not.toContain(SATELLITE);
      }
    }
    // pending 的卫星会场即使假设获批，conditional 在保护模式下也不能启用它。
    const c = solveJoint(pendingSat).conditional!;
    expect(c.status).toBe('OPTIMAL');
    expect(c.selected_intervention_ids).toEqual([CARPOOL]);
  });

  it('protect：已有 grant 是 pending 也不撤回（不能为腾名额撤回 pending 承诺）', () => {
    // 措施 loan 容量 1，学生 z 有它的 pending grant（不化解障碍，但占名额）；学生 b 也缺笔记本。
    const s = mini({
      students: [student('b'), student('z')],
      opportunities: [opp('o1')],
      interventions: [loan('loan', { capacity: 1 })],
      existing_grants: [laptopGrant('pending-z', 'z', 'o1', 'loan', 'pending')],
    });
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    expect(r.revoked_grant_ids).toEqual([]);
    // 名额被 z 的 pending 占着：只能分给 z（不另占名额，pending 不免成本）。
    expect(r.allocations).toEqual([{ intervention_id: 'loan', student_id: 'z', opportunity_id: 'o1', cost_usd: 10 }]);
    // 独立复核：protect 下带撤回的方案（哪怕只撤回 pending）判不通过。
    const cheat: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [{ intervention_id: 'loan', student_id: 'b', opportunity_id: 'o1', cost_usd: 10 }],
      revoked_grant_ids: ['pending-z'],
    };
    expect(verifyPlan(s, cheat).checks.find((c) => c.name === 'revocation')?.passed).toBe(false);
    expect(verifyPlan(s, cheat, { mode: 'tradeoff', loss_cap: 0 }).passed).toBe(true);
  });
});

describe('venue-tradeoff：权衡分析模式', () => {
  it('loss_cap = 3：启用卫星会场，G = 6、L = 3、N = 3、$140；3 条接驳车 grant 被强制撤回', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3 };
    const r = solveJoint(venueTradeoffScenario, opts);
    expectWellFormed(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual([SATELLITE]);
    expect([r.G, r.L, r.N]).toEqual([6, 3, 3]);
    expect(r.cost).toEqual({ fixed_usd: 80, marginal_usd: 60, total_usd: 140 });
    // 卫星会场 6 个座位按编号给 s01…s06 的周末场。
    expect(r.allocations.map((a) => a.student_id)).toEqual(['vt-s01', 'vt-s02', 'vt-s03', 'vt-s04', 'vt-s05', 'vt-s06']);
    expect(r.allocations.every((a) => a.intervention_id === SATELLITE && a.opportunity_id === WE)).toBe(true);
    expect(r.revoked_grant_ids).toEqual([...V.shuttleGrants]);
    expect(r.revocations).toEqual(
      V.shuttleGrants.map((g, k) => ({ grant_id: g, intervention_id: SHUTTLE, student_id: V.shuttleStudents[k], forced_by: SATELLITE })),
    );
    expect(r.lost_pairs).toEqual(pairs([...V.shuttleStudents], WD));
    expect(r.R1).toEqual(pairs(['vt-s01', 'vt-s02', 'vt-s03', 'vt-s04', 'vt-s05', 'vt-s06'], WE));
    expect(r.verification?.passed).toBe(true);
    expect(verifyWith(venueTradeoffScenario, r, opts).passed).toBe(true);
    // 同一方案按 protect 复核：revocation / coverage_loss 不通过。
    const asProtect = verifyPlan(venueTradeoffScenario, r as JointPlan);
    expect(asProtect.passed).toBe(false);
    expect(asProtect.checks.find((c) => c.name === 'revocation')?.passed).toBe(false);
    expect(asProtect.checks.find((c) => c.name === 'coverage_loss')?.passed).toBe(false);
    expect(r.notes.join('')).toContain('强制撤回 3 条');
  });

  it('loss_cap = 10：与 loss_cap = 3 相同（没有更好的方案）', () => {
    const a = solveJoint(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 3 });
    const b = solveJoint(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 10 });
    expect(b.status).toBe('OPTIMAL');
    expect([b.G, b.L, b.N]).toEqual([6, 3, 3]);
    expect(b.allocations).toEqual(a.allocations);
    expect(b.revocations).toEqual(a.revocations);
    expect(verifyWith(venueTradeoffScenario, b, { mode: 'tradeoff', loss_cap: 10 }).passed).toBe(true);
  });

  it('loss_cap = 2：卫星会场会造成 L = 3，不能启用 → 与 protect 相同（拼车 2 人，N = 2，不撤回）', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 2 };
    const r = solveJoint(venueTradeoffScenario, opts);
    expectWellFormed(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual([CARPOOL]);
    expect([r.G, r.L, r.N]).toEqual([2, 0, 2]);
    expect(r.revoked_grant_ids).toEqual([]);
    expect(r.cost.total_usd).toBe(50);
    expect(verifyWith(venueTradeoffScenario, r, opts).passed).toBe(true);
    // loss_cap 0 同理。
    expect(solveJoint(venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 0 }).N).toBe(2);
  });

  it('tradeoff 下不做无益的自愿撤回：接驳车名额换人不增加 N（目标 ② L 小、⑥ 撤回少）', () => {
    // 接驳车容量 3 已满。若自愿撤回 s01 的座位换给 s04：s01 的 WD 失去（L + 1），s04 的 WD 获得（G + 1），N 不变而 L 变大。
    const onlyShuttle = withEnabledInterventions(venueTradeoffScenario, [SHUTTLE]);
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3 };
    const r = solveJoint(onlyShuttle, opts);
    expect(r.status).toBe('OPTIMAL');
    expect([r.G, r.L, r.N]).toEqual([0, 0, 0]);
    expect(r.revoked_grant_ids).toEqual([]);
    expect(r.selected_intervention_ids).toEqual([]);
    expect(verifyWith(onlyShuttle, r, opts).passed).toBe(true);
  });
});

// ───────────────────────────── 自愿撤回、补位 ─────────────────────────────

describe('自愿撤回（仅 tradeoff）', () => {
  // o1：9–12 年级；o2：只收 11–12 年级。a（9 年级）只符合 o1；b（11 年级）符合 o1、o2。
  // 措施 loan 容量 1（total），a 已有它的 approved grant（只对 o1）→ R0 = {(a, o1)}。
  const s = mini({
    students: [student('a', 9), student('b', 11)],
    opportunities: [opp('o1'), opp('o2', 11, 12)],
    interventions: [loan('loan', { capacity: 1 })],
    existing_grants: [laptopGrant('g-a', 'a', 'o1', 'loan')],
  });

  it('把名额从只覆盖 1 个对的学生换给能覆盖 2 个对的学生：L = 1、G = 2、N = 1（自愿撤回，forced_by = null）', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 1 };
    const r = solveJoint(s, opts);
    expectWellFormed(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.R0).toEqual([{ student_id: 'a', opportunity_id: 'o1' }]);
    expect([r.G, r.L, r.N]).toEqual([2, 1, 1]);
    expect(r.revoked_grant_ids).toEqual(['g-a']);
    expect(r.revocations).toEqual([{ grant_id: 'g-a', intervention_id: 'loan', student_id: 'a', forced_by: null }]);
    expect(r.lost_pairs).toEqual([{ student_id: 'a', opportunity_id: 'o1' }]);
    // 同一学生两个机会只计一次成本、占 1 个名额。
    expect(r.allocations).toEqual([
      { intervention_id: 'loan', student_id: 'b', opportunity_id: 'o1', cost_usd: 10 },
      { intervention_id: 'loan', student_id: 'b', opportunity_id: 'o2', cost_usd: 0 },
    ]);
    expect(verifyWith(s, r, opts).passed).toBe(true);
  });

  it('protect 或 loss_cap = 0：不撤回，N = 0', () => {
    for (const opts of [{}, { mode: 'tradeoff', loss_cap: 0 }] as SolveOptions[]) {
      const r = solveJoint(s, opts);
      expect(r.status).toBe('OPTIMAL');
      expect([r.G, r.L, r.N]).toEqual([0, 0, 0]);
      expect(r.revoked_grant_ids).toEqual([]);
    }
  });

  it('换人不增加 N 时不撤回（目标 ②：N 相同则 L 小者优先）', () => {
    const s1 = { ...s, students: [student('a', 9), student('b', 9)] }; // b 也只符合 o1
    const r = solveJoint(s1, { mode: 'tradeoff', loss_cap: 5 });
    expect(r.status).toBe('OPTIMAL');
    expect([r.G, r.L, r.N]).toEqual([0, 0, 0]);
    expect(r.revoked_grant_ids).toEqual([]);
  });

  it('撤回 pending 不产生损失；但能不撤回就不撤回（目标 ⑥ 先于字典序）', () => {
    // z 有 pending grant 占着唯一名额；b 的编号更小。给 z 分配（不另占名额）与撤回 z 的 pending、改给 b，
    // N、L、成本（都是 $10）、分配条数、措施数都相同；⑥ 撤回数少者优先 → 给 z，不撤回。
    const s2 = mini({
      students: [student('b'), student('z')],
      opportunities: [opp('o1')],
      interventions: [loan('loan', { capacity: 1 })],
      existing_grants: [laptopGrant('pending-z', 'z', 'o1', 'loan', 'pending')],
    });
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 0 };
    const r = solveJoint(s2, opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.revoked_grant_ids).toEqual([]);
    expect(r.allocations.map((a) => a.student_id)).toEqual(['z']);
    expect(verifyWith(s2, r, opts).passed).toBe(true);
    // 撤回 pending 的方案本身合法、L = 0（复核通过），只是按目标顺序不是最优。
    const alt: JointPlan = {
      selected_intervention_ids: ['loan'],
      allocations: [{ intervention_id: 'loan', student_id: 'b', opportunity_id: 'o1', cost_usd: 10 }],
      revoked_grant_ids: ['pending-z'],
    };
    expect(verifyPlan(s2, alt, opts).passed).toBe(true);
  });

  it('撤回 pending 腾出名额且有增益时会撤回（L = 0）', () => {
    // 两个名额都被 z1、z2 的 pending grant（对 o2）占着；b、c、z1、z2 都是 9 年级，只符合 o1。
    const s3 = mini({
      students: [student('b', 9), student('c', 9), student('z1', 9), student('z2', 9)],
      opportunities: [opp('o1', 9, 10), opp('o2', 11, 12)],
      interventions: [loan('loan', { capacity: 2 })],
      existing_grants: [laptopGrant('pz1', 'z1', 'o2', 'loan', 'pending'), laptopGrant('pz2', 'z2', 'o2', 'loan', 'pending')],
    });
    // 给 z1、z2 分配 o1（他们已占名额，不另占）与「撤回 pending、改给 b、c」增益相同（G = 2）、成本相同，
    // 撤回数更少者优先 → 不撤回，直接给 z1、z2。
    const r = solveJoint(s3, { mode: 'tradeoff', loss_cap: 0 });
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(2);
    expect(r.revoked_grant_ids).toEqual([]);
    expect(studentsOf(r)).toEqual(['z1', 'z2']);
    // 改成 z1、z2 是 11 年级（不符合 o1，场景里也没有别的机会）：只有撤回 pending 才能服务 b、c。
    const s4 = { ...s3, students: [student('b', 9), student('c', 9), student('z1', 11), student('z2', 11)], opportunities: [opp('o1', 9, 10)] };
    const r4 = solveJoint({ ...s4, existing_grants: [laptopGrant('pz1', 'z1', 'o1', 'loan', 'pending'), laptopGrant('pz2', 'z2', 'o1', 'loan', 'pending')] }, { mode: 'tradeoff', loss_cap: 0 });
    expect(r4.status).toBe('OPTIMAL');
    expect([r4.G, r4.L]).toEqual([2, 0]);
    expect(r4.revoked_grant_ids).toEqual(['pz1', 'pz2']);
    expect(r4.revocations?.every((x) => x.forced_by === null)).toBe(true);
    expect(studentsOf(r4)).toEqual(['b', 'c']);
    // protect：不能撤回 pending → 名额被占满，G = 0。
    const p4 = solveJoint({ ...s4, existing_grants: [laptopGrant('pz1', 'z1', 'o1', 'loan', 'pending'), laptopGrant('pz2', 'z2', 'o1', 'loan', 'pending')] });
    expect(p4.G).toBe(0);
    expect(p4.revoked_grant_ids).toEqual([]);
  });
});

describe('撤回后 R0 中的对由新分配补位', () => {
  // 旧借用点 old（容量 1）已给 a 发了 approved grant → R0 = {(a, o1)}；新借用点 new（容量 3、每人 $10）与 old 互斥。
  const s = mini({
    students: [student('a'), student('b'), student('c')],
    opportunities: [opp('o1')],
    interventions: [loan('new', { capacity: 3, mutually_exclusive_with: ['old'] }), loan('old', { capacity: 1, unit_cost_usd: 5 })],
    existing_grants: [laptopGrant('old-a', 'a', 'o1', 'old')],
  });

  it('tradeoff，loss_cap = 0：启用 new 强制撤回 old 的 grant，a 改由 new 补位 → G = 2、L = 0、N = 2', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 0 };
    const r = solveJoint(s, opts);
    expectWellFormed(r);
    expect(r.status).toBe('OPTIMAL');
    expect(r.selected_intervention_ids).toEqual(['new']);
    expect([r.G, r.L, r.N]).toEqual([2, 0, 2]);
    expect(r.lost_pairs).toEqual([]);
    expect(r.revocations).toEqual([{ grant_id: 'old-a', intervention_id: 'old', student_id: 'a', forced_by: 'new' }]);
    // a 的补位分配也计费（不是 old 的 approved grant 免成本：免成本只认同一措施）：3 × $10 = $30。
    expect(r.allocations.map((x) => x.student_id)).toEqual(['a', 'b', 'c']);
    expect(r.cost.total_usd).toBe(30);
    expect(r.R1).toEqual(pairs(['a', 'b', 'c'], 'o1'));
    expect(verifyWith(s, r, opts).passed).toBe(true);
  });

  it('protect：new 与有已有 grant 的 old 互斥，不能启用 → N = 0', () => {
    const r = solveJoint(s);
    expect(r.status).toBe('OPTIMAL');
    expect(r.N).toBe(0);
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.revoked_grant_ids).toEqual([]);
  });

  it('new 名额只有 2：补位 a 后只剩 1 个新增；不补位则 L = 1 —— loss_cap = 1 时两者 N 相同，L 小者优先', () => {
    const s2 = { ...s, interventions: [loan('new', { capacity: 2, mutually_exclusive_with: ['old'] }), loan('old', { capacity: 1 })] };
    // 补位：a + b → G = 1、L = 0、N = 1；不补位：b + c → G = 2、L = 1、N = 1。② L 小者优先 → 补位。
    const r = solveJoint(s2, { mode: 'tradeoff', loss_cap: 1 });
    expect(r.status).toBe('OPTIMAL');
    expect([r.G, r.L, r.N]).toEqual([1, 0, 1]);
    expect(r.allocations.map((x) => x.student_id)).toEqual(['a', 'b']);
    expect(verifyWith(s2, r, { mode: 'tradeoff', loss_cap: 1 }).passed).toBe(true);
  });
});

describe('撤回的其他规则', () => {
  it('强制撤回包括学生不在场景内的 grant（不产生损失）；撤回 (措施, 学生) 后不再给它分配', () => {
    const s = mini({
      students: [student('a'), student('b')],
      opportunities: [opp('o1')],
      interventions: [loan('new', { capacity: 5, unit_cost_usd: 1, mutually_exclusive_with: ['old'] }), loan('old', { capacity: 2 })],
      existing_grants: [laptopGrant('old-a', 'a', 'o1', 'old'), laptopGrant('old-outsider', 'outsider', 'o1', 'old')],
    });
    // new 每人 $1：启用 new（a 补位 + b）共 $2，比「自愿撤回 outsider 的 old 座位、把 old 给 b」（$10）便宜。
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 0 };
    const r = solveJoint(s, opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.revoked_grant_ids).toEqual(['old-a', 'old-outsider']);
    expect(r.revocations?.map((x) => x.forced_by)).toEqual(['new', 'new']);
    expect(r.allocations.some((x) => x.intervention_id === 'old')).toBe(false);
    expect([r.G, r.L]).toEqual([1, 0]);
    expect(r.cost.total_usd).toBe(2);
    expect(verifyWith(s, r, opts).passed).toBe(true);
    // new 改为 $20 时：自愿撤回场景外学生 outsider 的 old 座位、把 old 给 b 更便宜（$10），也不产生损失。
    const pricey = { ...s, interventions: [loan('new', { capacity: 5, unit_cost_usd: 20, mutually_exclusive_with: ['old'] }), loan('old', { capacity: 2 })] };
    const rp = solveJoint(pricey, opts);
    expect(rp.selected_intervention_ids).toEqual(['old']);
    expect(rp.revocations).toEqual([{ grant_id: 'old-outsider', intervention_id: 'old', student_id: 'outsider', forced_by: null }]);
    expect([rp.G, rp.L, rp.cost.total_usd]).toEqual([1, 0, 10]);
    expect(verifyWith(pricey, rp, opts).passed).toBe(true);
    // 撤回后又给同一 (措施, 学生) 分配的方案：revocation 不通过。
    const bad: JointPlan = {
      selected_intervention_ids: ['old'],
      allocations: [{ intervention_id: 'old', student_id: 'a', opportunity_id: 'o1', cost_usd: 10 }],
      revoked_grant_ids: ['old-a'],
    };
    expect(verifyPlan(s, bad, opts).checks.find((c) => c.name === 'revocation')?.passed).toBe(false);
  });

  it('forced_by 取 id 最小的互斥选中措施', () => {
    const s = mini({
      students: [student('a'), student('b')],
      opportunities: [opp('o1'), opp('o2', 11, 12)],
      interventions: [
        loan('x-loan', { mutually_exclusive_with: ['old'], opportunity_ids: ['o1'] }),
        { ...loan('w-time'), type: 'time_support', device: null, hours_per_week: 0, unit_cost_usd: 0, mutually_exclusive_with: ['old'], resolves: ['time'] },
        loan('old', { capacity: 1 }),
      ],
      existing_grants: [laptopGrant('old-a', 'a', 'o1', 'old')],
    });
    // 必须同时启用 w、x（w 本身无用）：两者都与 old 互斥 → forced_by = 'w-time'（id 更小）。
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 5, required_intervention_ids: ['w-time', 'x-loan'] };
    const r = solveJoint(s, opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.revocations).toEqual([{ grant_id: 'old-a', intervention_id: 'old', student_id: 'a', forced_by: 'w-time' }]);
    expect(verifyWith(s, r, opts).passed).toBe(true);
  });
});
