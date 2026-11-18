/**
 * solveJoint 第 3 层：公平底线（软要求）、三项软要求的统一放松规则、新的 UNSUPPORTED_INPUT 条件、
 * 确定性与耗时。规范：CONTRACT.md「联合求解模型」第 4、6 条。全部是示例 / 模拟数据。
 *
 * 设备借用场景（data/scenarios/device-loan.json）的身份分布（学生自己声明的 statuses）：
 * - 全部含 high_school_student；low_income：dl-s07、dl-s08、dl-s09、dl-s10（编号靠后）；
 *   first_generation：dl-s03、dl-s06、dl-s08。
 * - 10 人都符合资格（9–12 年级、加州）→ 每条底线的分母 = 群体人数。
 * - 都缺笔记本；dl-s03 / dl-s06 / dl-s09 还缺交通（只借笔记本不够）。
 * 只启用设备借用（5 台，$100 + 每人 $20，预算 $400）时手算：
 * - 不设底线：交通可靠的 7 人里按编号取前 5 名 → s01、s02、s04、s05、s07；低收入覆盖 1/4 = 25%。
 * - 「低收入覆盖 ≥ 50%」：仍是 5 人、$200，但至少要 2 名低收入学生；s09 缺交通、只借笔记本不可达，
 *   可选的低收入学生是 s07、s08、s10 → 字典序最小的是 s01、s02、s04、s07、s08（2/4 = 50%）。
 * - 「低收入覆盖 100%」：s09 只靠设备借用不可达 → 最多 3/4 → INFEASIBLE。
 *   全部措施启用时，s09 可以「笔记本 + 交通补助 $25」→ 可行：s07–s10 + s01，$100 + 5 × $20 + $25 = $225。
 */
import { describe, expect, it } from 'vitest';
import { solveJoint } from './solve';
import { verifyPlan } from './verify';
import {
  DEVICE_LOAN_IDS as IDS,
  SCENARIOS,
  deviceLoanScenario,
  venueTradeoffScenario,
  withBudget,
  withEnabledInterventions,
} from './scenarios';
import type { FairnessFloor, JointPlan, JointResult, ResourceGrant, Scenario, SolveOptions } from '../types';

const LAPTOP = IDS.laptopLoan;
const ONLINE = IDS.onlineEntry;
const SATELLITE = IDS.satelliteVenue;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const laptopOnly = (s: Scenario = deviceLoanScenario) => withEnabledInterventions(s, [LAPTOP]);
const studentsOf = (r: { allocations: { student_id: string }[] }) => [...new Set(r.allocations.map((a) => a.student_id))].sort();
const LOW = ['dl-s07', 'dl-s08', 'dl-s09', 'dl-s10'];

function floor(id: string, statuses: FairnessFloor['statuses_any_of'], min: number, label = `示例群体 ${id}`): FairnessFloor {
  return { id, label, basis: '示例：虚构的资助章程（仅用于测试）', statuses_any_of: statuses, min_ratio: min };
}
const lowIncome = (min: number) => floor('low', ['low_income'], min, '低收入学生');

function verifyWith(s: Scenario, r: JointResult, opts: SolveOptions = {}) {
  const { mode, loss_cap, required_intervention_ids, min_gain, fairness_floors } = opts;
  const vo = Object.fromEntries(
    Object.entries({ mode, loss_cap, required_intervention_ids, min_gain, fairness_floors }).filter(([, v]) => v !== undefined),
  );
  return verifyPlan(s, r as JointPlan, vo);
}

describe('示例场景的预设公平底线', () => {
  it('SCENARIOS 列出两个场景，预设底线格式合法、写明是示例依据', () => {
    expect(SCENARIOS.map((s) => s.id)).toEqual(['device-loan', 'venue-tradeoff']);
    for (const entry of SCENARIOS) {
      expect(entry.scenario.is_sample).toBe(true);
      expect(entry.description).toContain('示例');
      expect(entry.suggestedFairnessFloors.length).toBeGreaterThan(0);
      for (const f of entry.suggestedFairnessFloors) expect(f.basis).toContain('示例');
      const r = solveJoint(entry.scenario, { fairness_floors: entry.suggestedFairnessFloors });
      expect(r.status).not.toBe('UNSUPPORTED_INPUT');
      expect(r.fairness).toHaveLength(entry.suggestedFairnessFloors.length);
    }
  });

  it('设备借用场景：示例学生的 statuses 分布如注释所述', () => {
    const has = (st: string) => deviceLoanScenario.students.filter((s) => (s.statuses ?? []).includes(st as never)).map((s) => s.id);
    expect(has('high_school_student')).toHaveLength(10);
    expect(has('low_income')).toEqual(LOW);
    expect(has('first_generation')).toEqual(['dl-s03', 'dl-s06', 'dl-s08']);
  });
});

describe('公平底线：设备借用场景', () => {
  it('不设底线：前 5 名交通可靠的学生，低收入只覆盖 1/4；给了空底线列表时 fairness 为空数组', () => {
    const r = solveJoint(laptopOnly());
    expect(studentsOf(r)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s05', 'dl-s07']);
    expect(r.fairness).toBeUndefined();
    expect(studentsOf(r).filter((s) => LOW.includes(s))).toHaveLength(1);
    const e = solveJoint(laptopOnly(), { fairness_floors: [] });
    expect(e.fairness).toEqual([]);
    expect(e.allocations).toEqual(r.allocations);
    expect(e.verification?.passed).toBe(true);
    // null 视同未给。
    const n = solveJoint(laptopOnly(), { fairness_floors: null as unknown as FairnessFloor[] });
    expect(n.fairness).toBeUndefined();
    expect(n.status).toBe('OPTIMAL');
  });

  it('「低收入覆盖 ≥ 50%」：仍是 5 人、$200，人选改变，低收入覆盖 2/4', () => {
    const opts: SolveOptions = { fairness_floors: [lowIncome(0.5)] };
    const before = solveJoint(laptopOnly());
    const r = solveJoint(laptopOnly(), opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(before.G);
    expect(r.G).toBe(5);
    expect(r.cost.total_usd).toBe(200);
    expect(studentsOf(r)).not.toEqual(studentsOf(before));
    expect(studentsOf(r).filter((s) => LOW.includes(s))).toHaveLength(2);
    expect(studentsOf(r)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s07', 'dl-s08']);
    expect(r.fairness).toEqual([
      { floor_id: 'low', eligible_members: 4, covered_members: 2, ratio: 0.5, min_ratio: 0.5, satisfied: true },
    ]);
    expect(r.verification?.passed).toBe(true);
    expect(verifyWith(laptopOnly(), r, opts).passed).toBe(true);
  });

  it('全部措施启用：底线 100% 可行（s09 用笔记本 + 交通补助），$225', () => {
    const opts: SolveOptions = { fairness_floors: [lowIncome(1)] };
    const r = solveJoint(deviceLoanScenario, opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.G).toBe(5);
    expect(studentsOf(r)).toEqual(['dl-s01', ...LOW]);
    expect(r.cost.total_usd).toBe(225);
    expect(r.fairness?.[0]).toMatchObject({ eligible_members: 4, covered_members: 4, ratio: 1, satisfied: true });
    expect(verifyWith(deviceLoanScenario, r, opts).passed).toBe(true);
  });

  it('底线达不到 → INFEASIBLE；主结果空方案带 fairness；alternative 放松 fairness_floors 并带报告', () => {
    const opts: SolveOptions = { fairness_floors: [lowIncome(1)] };
    const r = solveJoint(laptopOnly(), opts);
    expect(r.status).toBe('INFEASIBLE');
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.fairness).toEqual([{ floor_id: 'low', eligible_members: 4, covered_members: 0, ratio: 0, min_ratio: 1, satisfied: false }]);
    const alt = r.alternative!;
    expect(alt.relaxed).toEqual(['fairness_floors']);
    expect(alt.G).toBe(5);
    expect(alt.fairness?.[0]).toMatchObject({ covered_members: 1, eligible_members: 4, satisfied: false });
    expect(alt.note).toContain('公平底线');
    expect(alt.note).toContain('1/4');
    // 复核：去掉已放松的底线后通过；带上底线复核则 fairness 不通过。
    const plan = { ...alt, fairness: undefined } as unknown as JointPlan;
    expect(verifyPlan(laptopOnly(), plan).passed).toBe(true);
    expect(verifyPlan(laptopOnly(), alt as JointPlan, opts).checks.find((c) => c.name === 'fairness')?.passed).toBe(false);
  });

  it('分母为 0 的底线不适用、自动满足（ratio = null）', () => {
    const opts: SolveOptions = { fairness_floors: [floor('ug', ['undergraduate'], 1)] };
    const r = solveJoint(laptopOnly(), opts);
    expect(r.status).toBe('OPTIMAL');
    expect(r.fairness).toEqual([{ floor_id: 'ug', eligible_members: 0, covered_members: 0, ratio: null, min_ratio: 1, satisfied: true }]);
    expect(r.allocations).toEqual(solveJoint(laptopOnly()).allocations);
    expect(verifyWith(laptopOnly(), r, opts).passed).toBe(true);
  });

  it('分母只数至少对一个机会 eligible 的成员（不符合资格的成员不计入）', () => {
    // 把 dl-s10 改成 8 年级（不符合 9–12 年级）：低收入分母从 4 变成 3。
    const s: Scenario = { ...laptopOnly(), students: laptopOnly().students.map((x) => (x.id === 'dl-s10' ? { ...clone(x), grade: 8 } : x)) };
    const r = solveJoint(s, { fairness_floors: [lowIncome(0.5)] });
    expect(r.fairness?.[0].eligible_members).toBe(3);
    // 3 人里覆盖 2 人（s07、s08）即达标。
    expect(r.fairness?.[0].covered_members).toBe(2);
  });

  it('学生属于多个群体时各算各的；多条底线并存', () => {
    // 低收入 ≥ 50%（分母 4）+ 第一代 ≥ 1/3（分母 3：s03、s06、s08；只有 s08 交通可靠）。
    // s08 同时在两个群体里，各计一次：{s01, s02, s04, s07, s08} 同时满足两条。
    const opts: SolveOptions = { fairness_floors: [lowIncome(0.5), floor('fg', ['first_generation'], 1 / 3, '第一代学生')] };
    const r = solveJoint(laptopOnly(), opts);
    expect(r.status).toBe('OPTIMAL');
    expect(studentsOf(r)).toEqual(['dl-s01', 'dl-s02', 'dl-s04', 'dl-s07', 'dl-s08']);
    expect(r.fairness?.map((f) => [f.floor_id, f.covered_members, f.eligible_members, f.satisfied])).toEqual([
      ['low', 2, 4, true],
      ['fg', 1, 3, true],
    ]);
    expect(verifyWith(laptopOnly(), r, opts).passed).toBe(true);
    // statuses_any_of 取并集：「低收入或第一代」= s03、s06、s07、s08、s09、s10（6 人）。
    const union = solveJoint(laptopOnly(), { fairness_floors: [floor('u', ['low_income', 'first_generation'], 0.5)] });
    expect(union.fairness?.[0].eligible_members).toBe(6);
    expect(union.fairness?.[0].covered_members).toBe(3); // s07、s08、s10 三名（s03、s06、s09 缺交通）
    expect(union.status).toBe('OPTIMAL');
    // 第一代 ≥ 2/3 只靠设备借用达不到（s03、s06 缺交通）→ INFEASIBLE。
    const fg = solveJoint(laptopOnly(), { fairness_floors: [lowIncome(0.5), floor('fg', ['first_generation'], 2 / 3)] });
    expect(fg.status).toBe('INFEASIBLE');
    expect(fg.alternative?.relaxed).toEqual(['fairness_floors']);
  });

  it('statuses 没填（null / undefined / 非数组）的学生不计入群体', () => {
    const s: Scenario = {
      ...laptopOnly(),
      students: laptopOnly().students.map((x) => {
        if (x.id === 'dl-s07') return { ...clone(x), statuses: null };
        if (x.id === 'dl-s08') {
          const y = clone(x);
          delete y.statuses;
          return y;
        }
        if (x.id === 'dl-s10') return { ...clone(x), statuses: 'low_income' as unknown as never };
        return x;
      }),
    };
    const r = solveJoint(s, { fairness_floors: [lowIncome(0.5)] });
    // 只剩 s09 在群体里（缺交通，只靠设备借用不可达）→ 分母 1，覆盖 0 → INFEASIBLE。
    expect(r.fairness?.[0]).toMatchObject({ eligible_members: 1, covered_members: 0 });
    expect(r.status).toBe('INFEASIBLE');
  });

  it('不读学校名、显示名：只改它们，带底线的结果不变', () => {
    const renamed: Scenario = {
      ...laptopOnly(),
      students: laptopOnly().students.map((s, k) => ({ ...s, school_name: `Other ${k}（虚构）`, display_name: `X${9 - k}` })),
    };
    const opts: SolveOptions = { fairness_floors: [lowIncome(0.5)] };
    expect(solveJoint(renamed, opts).allocations).toEqual(solveJoint(laptopOnly(), opts).allocations);
  });

  it('权衡场景：底线改变卫星会场的座位分配（低收入 vt-s06…s09）', () => {
    // tradeoff loss_cap 3：不设底线时座位给 s01…s06（低收入只有 s06：1/4）；设 ≥ 50% 后给 s01–s04、s06、s07（2/4）。
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3, fairness_floors: [lowIncome(0.5)] };
    const r = solveJoint(venueTradeoffScenario, opts);
    expect(r.status).toBe('OPTIMAL');
    expect([r.G, r.L, r.N]).toEqual([6, 3, 3]);
    expect(studentsOf(r)).toEqual(['vt-s01', 'vt-s02', 'vt-s03', 'vt-s04', 'vt-s06', 'vt-s07']);
    expect(r.fairness?.[0]).toMatchObject({ eligible_members: 4, covered_members: 2, satisfied: true });
    expect(verifyWith(venueTradeoffScenario, r, opts).passed).toBe(true);
    // protect：R0 的 s01–s03 不是低收入；拼车 2 个名额都要给低收入 → s06、s07（2/4）。
    const p = solveJoint(venueTradeoffScenario, { fairness_floors: [lowIncome(0.5)] });
    expect(p.status).toBe('OPTIMAL');
    expect(p.allocations.map((a) => a.student_id)).toEqual(['vt-s06', 'vt-s07']);
    expect(p.N).toBe(2);
  });
});

describe('三项软要求的统一放松规则', () => {
  it('按放松项数从少到多：两项都单独放松不可行时，两项一起放松（relaxed 按固定优先级排列）', () => {
    // min_gain 6 > 5（名额上限）；底线 100% 需要 s09 而 s09 缺交通。单独放松任一项，另一项仍达不到。
    const r = solveJoint(laptopOnly(), { min_gain: 6, fairness_floors: [lowIncome(1)] });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.alternative?.relaxed).toEqual(['min_gain', 'fairness_floors']);
    expect(r.alternative?.G).toBe(5);
  });

  it('同一项数内按第 5 条取最优：放松底线得到 N = 5，优于放松 min_gain 的 N = 4（即使 min_gain 优先级更高）', () => {
    // 全部措施、预算 $210：底线 100% 需要 s07–s10（s09 还要交通补助）= $100 + 4 × $20 + $25 = $205，第 5 人 +$20 超预算 → G ≤ 4；
    // min_gain 5 与底线不能同时满足。放松 min_gain → G = 4（$205）；放松底线 → G = 5（$200）。
    const s = withBudget(deviceLoanScenario, 210);
    const r = solveJoint(s, { min_gain: 5, fairness_floors: [lowIncome(1)] });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.alternative?.relaxed).toEqual(['fairness_floors']);
    expect(r.alternative?.G).toBe(5);
    expect(r.alternative?.cost.total_usd).toBe(200);
    // 只给底线时：G = 4、$205 可行。
    const only = solveJoint(s, { fairness_floors: [lowIncome(1)] });
    expect(only.status).toBe('OPTIMAL');
    expect([only.G, only.cost.total_usd]).toEqual([4, 205]);
  });

  it('必须启用的措施超预算 + 底线：只放松「必须启用」即可（底线单独可行）', () => {
    // 预算 $230：必须启用线上入口（$150 + 依赖设备借用 $100 = $250）超预算；底线 100% 只要 $225。
    const s = withBudget(deviceLoanScenario, 230);
    const r = solveJoint(s, { required_intervention_ids: [ONLINE], fairness_floors: [lowIncome(1)] });
    expect(r.status).toBe('INFEASIBLE');
    expect(r.alternative?.relaxed).toEqual(['required_intervention_ids']);
    expect(r.alternative?.fairness?.[0].satisfied).toBe(true);
    expect(r.alternative?.note).toContain('$250');
  });

  it('三项都给、都需要放松时 relaxed = 三项（按 min_gain、fairness_floors、required 排列）', () => {
    const r = solveJoint(laptopOnly(), {
      min_gain: 6,
      fairness_floors: [lowIncome(1)],
      required_intervention_ids: [SATELLITE].filter((id) => laptopOnly().interventions.some((iv) => iv.id === id)),
    });
    // 只启用设备借用的场景里没有卫星会场 → required 为空列表（总能满足），只需放松前两项。
    expect(r.alternative?.relaxed).toEqual(['min_gain', 'fairness_floors']);
    const all = solveJoint(deviceLoanScenario, { min_gain: 9, fairness_floors: [floor('fg', ['first_generation'], 1)], required_intervention_ids: [SATELLITE] });
    // 卫星会场 pending → required 不可行；min_gain 9 > 5；第一代 100% 需 s03、s06（缺交通）+ s08，可以用交通补助 → 底线单独可行。
    expect(all.status).toBe('INFEASIBLE');
    expect(all.alternative?.relaxed).toEqual(['min_gain', 'required_intervention_ids']);
    const all3 = solveJoint(withBudget(deviceLoanScenario, 150), { min_gain: 9, fairness_floors: [lowIncome(1)], required_intervention_ids: [SATELLITE] });
    // 预算 $150：底线 100% 需要 $205 → 也不可行 → 三项都放松。
    expect(all3.alternative?.relaxed).toEqual(['min_gain', 'fairness_floors', 'required_intervention_ids']);
    expect(all3.alternative?.G).toBe(2); // $100 + 2 × $20 = $140
  });

  it('条件性结果沿用同一组软要求与底线，并带 fairness', () => {
    const r = solveJoint(deviceLoanScenario, { fairness_floors: [lowIncome(0.5)] });
    expect(r.conditional?.fairness).toHaveLength(1);
    expect(r.conditional?.fairness?.[0].satisfied).toBe(true);
  });
});

describe('新的 UNSUPPORTED_INPUT 条件', () => {
  const S = deviceLoanScenario;
  const g = (id: unknown): ResourceGrant =>
    ({ id, student_id: 'dl-s01', opportunity_id: IDS.opportunity, intervention_id: null, type: 'device', device: 'laptop', status: 'approved', provider: '示例', is_sample: true }) as ResourceGrant;
  const ok = lowIncome(0.5);
  const cases: [string, Scenario, SolveOptions][] = [
    ['已有 grant 的 id 不是字符串', { ...S, existing_grants: [g(3)] }, {}],
    ['已有 grant 的 id 重复', { ...S, existing_grants: [g('dup'), { ...g('dup'), student_id: 'dl-s02' }] }, {}],
    ['fairness_floors 不是数组', S, { fairness_floors: 'low' as unknown as FairnessFloor[] }],
    ['底线条目不是对象', S, { fairness_floors: [null as unknown as FairnessFloor] }],
    ['底线 id 为空', S, { fairness_floors: [{ ...ok, id: '' }] }],
    ['底线 id 重复', S, { fairness_floors: [ok, { ...ok }] }],
    ['底线 label 只有空格', S, { fairness_floors: [{ ...ok, label: '   ' }] }],
    ['底线 basis 缺失', S, { fairness_floors: [{ ...ok, basis: undefined as unknown as string }] }],
    ['statuses_any_of 为空数组', S, { fairness_floors: [{ ...ok, statuses_any_of: [] }] }],
    ['statuses_any_of 含不支持的值', S, { fairness_floors: [{ ...ok, statuses_any_of: ['rich' as never] }] }],
    ['min_ratio > 1', S, { fairness_floors: [{ ...ok, min_ratio: 1.5 }] }],
    ['min_ratio 为负', S, { fairness_floors: [{ ...ok, min_ratio: -0.1 }] }],
    ['min_ratio 非有限数', S, { fairness_floors: [{ ...ok, min_ratio: Number.NaN }] }],
  ];
  for (const [name, scenario, options] of cases) {
    it(name, () => {
      const r = solveJoint(scenario, options);
      expect(r.status).toBe('UNSUPPORTED_INPUT');
      expect([r.R0, r.R1, r.allocations, r.selected_intervention_ids]).toEqual([[], [], [], []]);
      expect(r.revoked_grant_ids).toEqual([]);
      expect(r.lost_pairs).toEqual([]);
      expect(r.revocations).toEqual([]);
      expect(r.fairness).toBeUndefined();
      expect(r.verification ?? null).toBeNull();
      // 验证器 input_validity 与之一致。
      const vo = options.fairness_floors !== undefined ? { fairness_floors: options.fairness_floors } : {};
      expect(verifyPlan(scenario, { selected_intervention_ids: [], allocations: [] }, vo).checks.find((c) => c.name === 'input_validity')?.passed).toBe(false);
    });
  }

  it('边界值合法：min_ratio 0 与 1、statuses_any_of 有重复值', () => {
    for (const f of [{ ...ok, min_ratio: 0 }, { ...ok, min_ratio: 1 }, { ...ok, statuses_any_of: ['low_income', 'low_income'] as FairnessFloor['statuses_any_of'] }]) {
      expect(solveJoint(S, { fairness_floors: [f] }).status).not.toBe('UNSUPPORTED_INPUT');
    }
  });
});

describe('确定性、不修改输入、耗时', () => {
  const runs: [string, Scenario, SolveOptions][] = [
    ['device-loan 默认', deviceLoanScenario, {}],
    ['device-loan 底线', deviceLoanScenario, { fairness_floors: [lowIncome(0.5)] }],
    ['venue protect', venueTradeoffScenario, {}],
    ['venue tradeoff', venueTradeoffScenario, { mode: 'tradeoff', loss_cap: 3, fairness_floors: [lowIncome(0.5)] }],
  ];

  it('同输入同输出；不修改 scenario 与 options', () => {
    for (const [, s, o] of runs) {
      const scenario = clone(s);
      const options = clone(o);
      const before = clone({ scenario, options });
      const a = solveJoint(scenario, options);
      expect({ scenario, options }).toEqual(before);
      expect(solveJoint(scenario, options)).toEqual(a);
    }
  });

  it('两个场景在默认设置下几十毫秒内完成（宽松上限 1 秒，避免机器差异导致误报）', () => {
    for (const [name, s, o] of runs) {
      const t0 = performance.now();
      const r = solveJoint(clone(s), o);
      const ms = performance.now() - t0;
      expect(r.status, name).toBe('OPTIMAL');
      expect(ms, `${name} 耗时 ${ms.toFixed(1)}ms`).toBeLessThan(1000);
    }
  });

  it('搜索上限很小时：SEARCH_LIMIT_REACHED 的方案带撤回明细与 fairness，且复核通过或为空方案', () => {
    const opts: SolveOptions = { mode: 'tradeoff', loss_cap: 3, fairness_floors: [lowIncome(0)] };
    for (const n of [1, 5, 20, 60, 200]) {
      const r = solveJoint(venueTradeoffScenario, { ...opts, max_search_nodes: n });
      if (r.status === 'OPTIMAL') continue;
      expect(r.status).toBe('SEARCH_LIMIT_REACHED');
      expect(r.revocations).toBeDefined();
      expect(r.lost_pairs).toBeDefined();
      expect(r.fairness).toHaveLength(1);
      expect(r.verification).toBeTruthy();
      if (r.selected_intervention_ids.length > 0) expect(r.verification?.passed).toBe(true);
    }
  });
});
