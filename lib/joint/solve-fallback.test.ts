/**
 * 求解器的「复核不通过」兜底（CONTRACT.md「联合求解模型」第 6 条）与搜索上限时的候选回退。
 *
 * 合法输入下求解器与验证器应当一致，无法自然构造「复核不通过」。这里用 vi.mock 包一层 ./verify：
 * 对满足条件的方案在真实复核结果后追加一条不通过的检查（测试注入），检验求解器不会返回
 * 「OPTIMAL 但复核不通过」，conditional / alternative 也不会给出复核不通过的方案。
 * 全部是示例 / 模拟数据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Intervention, JointPlan, ResourceGrant, Scenario, VerifyResult } from '../types';
import { solveJoint } from './solve';
import { DEVICE_LOAN_IDS as IDS, deviceLoanScenario, withEnabledInterventions } from './scenarios';
import { makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { runWhatIf } from './whatif';

const state = vi.hoisted(() => ({ failIf: ((() => false) as (plan: JointPlan) => boolean) }));

vi.mock('./verify', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./verify')>();
  return {
    ...actual,
    verifyPlan: (...args: Parameters<typeof actual.verifyPlan>): VerifyResult => {
      const r = actual.verifyPlan(...args);
      if (!state.failIf(args[1])) return r;
      return { passed: false, checks: [...r.checks, { name: 'metrics', passed: false, detail: '测试注入：模拟复核不通过' }] };
    },
  };
});

const selects = (id: string) => (p: JointPlan) => Array.isArray(p?.selected_intervention_ids) && p.selected_intervention_ids.includes(id);

afterEach(() => {
  state.failIf = () => false;
});

const LAPTOP = IDS.laptopLoan;
const SATELLITE = IDS.satelliteVenue;
const laptopOnly = () => withEnabledInterventions(deviceLoanScenario, [LAPTOP]);

describe('M1(b)：复核不通过时不返回 OPTIMAL', () => {
  it('主结果：最优方案复核不通过 → UNSUPPORTED_INPUT + 空方案，verification 保留失败的复核', () => {
    state.failIf = selects(LAPTOP);
    const r = solveJoint(laptopOnly());
    expect(r.status).toBe('UNSUPPORTED_INPUT');
    expect(r.selected_intervention_ids).toEqual([]);
    expect(r.allocations).toEqual([]);
    expect(r.cost).toEqual({ fixed_usd: 0, marginal_usd: 0, total_usd: 0 });
    expect([r.R0, r.R1, r.G, r.L, r.N]).toEqual([[], [], 0, 0, 0]);
    expect(r.verification?.passed).toBe(false);
    expect(r.verification?.checks.some((c) => c.detail.includes('测试注入'))).toBe(true);
    expect(r.notes.join('')).toContain('内部复核未通过，按不支持的输入处理，请检查场景数据');
    expect(r.alternative ?? null).toBeNull();
    expect(r.conditional ?? null).toBeNull();
  });

  it('What-if 视图：内部复核未通过时展示那次失败的复核，并标为不通过', () => {
    state.failIf = selects(LAPTOP);
    const v = runWhatIf(deviceLoanScenario, { enabledIds: [LAPTOP], requiredIds: [], budget: 400 });
    expect(v.status).toBe('UNSUPPORTED_INPUT');
    expect(v.verification.passed).toBe(false);
    expect(v.verification.note).toContain('没有通过独立复核');
    expect(v.verification.checks.some((c) => !c.passed)).toBe(true);
    expect(v.uncovered).toBeNull();
  });

  it('conditional：条件性最优方案复核不通过 → 不给出该方案，status UNSUPPORTED_INPUT，note 说明', () => {
    // 3 名缺交通的学生已有学校笔记本，只差交通；卫星会场（pending）获批后会被选中。
    const laptopGrant = (s: string): ResourceGrant => ({
      id: `school-${s}`,
      student_id: s,
      opportunity_id: IDS.opportunity,
      intervention_id: null,
      type: 'device',
      device: 'laptop',
      status: 'approved',
      provider: '示例学校借用（模拟）',
      is_sample: true,
    });
    const sc = withEnabledInterventions(
      { ...deviceLoanScenario, existing_grants: IDS.transportLackingStudents.map(laptopGrant) },
      [LAPTOP, SATELLITE],
    );
    const ok = solveJoint(sc);
    expect(ok.conditional?.selected_intervention_ids).toContain(SATELLITE);

    state.failIf = selects(SATELLITE);
    const r = solveJoint(sc);
    expect(r.status).toBe('OPTIMAL'); // 主结果不含 pending，不受影响
    expect(r.verification?.passed).toBe(true);
    const c = r.conditional!;
    expect(c.status).toBe('UNSUPPORTED_INPUT');
    expect(c.selected_intervention_ids).toEqual([]);
    expect(c.allocations).toEqual([]);
    expect(c.note).toContain('内部复核未通过');
    expect(c.note).toContain('尚未生效');
    const v = runWhatIf(sc, { enabledIds: [LAPTOP, SATELLITE], requiredIds: [], budget: 400 });
    expect(v.conditional?.verification_passed).toBe(false);
  });

  it('alternative：放松后的方案复核不通过 → 不给出该方案（空方案占位），note 说明', () => {
    state.failIf = selects(LAPTOP);
    const r = solveJoint(laptopOnly(), { min_gain: 6 });
    expect(r.status).toBe('INFEASIBLE');
    const alt = r.alternative!;
    expect(alt.relaxed).toEqual(['min_gain']);
    expect(alt.selected_intervention_ids).toEqual([]);
    expect(alt.allocations).toEqual([]);
    expect(alt.note).toContain('内部复核未通过');
    expect(alt.note).toContain('占位');
  });
});

describe('S5：达到搜索上限时回退到复核通过的较早候选', () => {
  // 一名缺笔记本的学生；两种借用：a 贵（$100）、b 便宜（$10）。搜索先找到 {a}，再找到更优的 {b}。
  const sc: Scenario = makeScenario({
    students: [makeStudent('x')],
    opportunities: [makeOpp('o1')],
    interventions: [
      makeIntervention('a-expensive', { unit_cost_usd: 100 }),
      makeIntervention('b-cheap', { unit_cost_usd: 10 }),
    ] as Intervention[],
  });

  it('当前最好方案 {b} 复核不通过时，返回较早记录、复核通过的 {a}，而不是退回空方案', () => {
    let found = false;
    for (let n = 1; n <= 400 && !found; n++) {
      state.failIf = () => false;
      const plain = solveJoint(sc, { max_search_nodes: n });
      if (plain.status !== 'SEARCH_LIMIT_REACHED' || plain.selected_intervention_ids.join() !== 'b-cheap') continue;
      state.failIf = selects('b-cheap');
      const r = solveJoint(sc, { max_search_nodes: n });
      expect(r.status).toBe('SEARCH_LIMIT_REACHED');
      expect(r.selected_intervention_ids).toEqual(['a-expensive']);
      expect(r.verification?.passed).toBe(true);
      expect(r.notes.join('')).toContain('未证明最优');
      found = true;
    }
    expect(found).toBe(true);
  });

  it('任何上限下都不返回复核不通过的方案', () => {
    state.failIf = selects('b-cheap');
    for (let n = 1; n <= 200; n++) {
      const r = solveJoint(sc, { max_search_nodes: n });
      expect(r.selected_intervention_ids).not.toContain('b-cheap');
      if (r.status === 'SEARCH_LIMIT_REACHED') expect(r.verification).toBeTruthy();
      if (r.status === 'OPTIMAL' || r.status === 'SEARCH_LIMIT_REACHED') {
        if (r.selected_intervention_ids.length > 0) expect(r.verification?.passed).toBe(true);
      }
    }
  });
});
