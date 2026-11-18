/**
 * scenario-utils：勾选措施与「运行中的措施」（CONTRACT.md「联合求解模型」第 9 条，R2）。全部是示例 / 模拟数据。
 */
import { describe, expect, it } from 'vitest';
import {
  resolveEnabledInterventions,
  runningInterventionIds,
  withEnabledInterventions,
} from './scenario-utils';
import { solveJoint, validateJointInput } from './solve';
import { verifyPlan } from './verify';
import { VENUE_TRADEOFF_IDS as V, deviceLoanScenario, venueTradeoffScenario } from './scenarios';
import type { Intervention, ResourceGrant, Scenario } from '../types';

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe('runningInterventionIds', () => {
  it('有已有 grant 指向的场景内措施算运行中（不论 approved / pending、学生是否在场景内）', () => {
    expect(runningInterventionIds(venueTradeoffScenario)).toEqual([V.weekdayShuttle]);
    expect(runningInterventionIds(deviceLoanScenario)).toEqual([]);
    const s = clone(venueTradeoffScenario);
    s.existing_grants = [
      { ...s.existing_grants![0], id: 'g-out', student_id: 'not-in-scenario', intervention_id: V.weekdayCarpool, status: 'pending' },
      { ...s.existing_grants![0], id: 'g-none', intervention_id: null },
      { ...s.existing_grants![0], id: 'g-ext', intervention_id: 'iv-somewhere-else' },
    ];
    expect(runningInterventionIds(s)).toEqual([V.weekdayCarpool]);
  });
});

describe('resolveEnabledInterventions / withEnabledInterventions：运行中的措施', () => {
  it('取消勾选运行中的接驳车：保留在场景里（frozen），opportunity_ids = []，互斥与容量不变；拼车补助照常移除', () => {
    const r = resolveEnabledInterventions(venueTradeoffScenario, [V.weekendSatellite]);
    expect(r.enabled).toEqual([V.weekendSatellite]);
    expect(r.removed).toEqual([]);
    expect(r.running).toEqual([V.weekdayShuttle]);
    expect(r.frozen).toEqual([{ id: V.weekdayShuttle, reason: 'unchecked', missing_requires: [] }]);
    const s = withEnabledInterventions(venueTradeoffScenario, [V.weekendSatellite]);
    expect(s.interventions.map((i) => i.id)).toEqual([V.weekdayShuttle, V.weekendSatellite]);
    const shuttle = s.interventions.find((i) => i.id === V.weekdayShuttle)!;
    const orig = venueTradeoffScenario.interventions.find((i) => i.id === V.weekdayShuttle)!;
    expect(shuttle).toEqual({ ...orig, opportunity_ids: [] });
    expect(s.existing_grants).toEqual(venueTradeoffScenario.existing_grants);
    // 合法输入（opportunity_ids: [] 不会触发 UNSUPPORTED_INPUT）。
    expect(validateJointInput(s)).toEqual([]);
    expect(validateJointInput(s, { mode: 'tradeoff', loss_cap: 3 })).toEqual([]);
    // 不修改原场景。
    expect(orig.opportunity_ids).toEqual([V.weekdayOpportunity]);
  });

  it('勾选全部或包含接驳车：不冻结，与原场景相同', () => {
    const all = venueTradeoffScenario.interventions.map((i) => i.id);
    expect(resolveEnabledInterventions(venueTradeoffScenario, all).frozen).toEqual([]);
    expect(withEnabledInterventions(venueTradeoffScenario, all).interventions).toEqual(venueTradeoffScenario.interventions);
  });

  it('全部取消勾选：接驳车仍在运行，R0 不变，任何模式下都不会给它新分配', () => {
    const s = withEnabledInterventions(venueTradeoffScenario, []);
    expect(s.interventions.map((i) => i.id)).toEqual([V.weekdayShuttle]);
    for (const opts of [{}, { mode: 'tradeoff' as const, loss_cap: 5 }]) {
      const r = solveJoint(s, opts);
      expect(r.R0).toHaveLength(3);
      expect([r.G, r.L]).toEqual([0, 0]);
      expect(r.allocations).toEqual([]);
    }
  });

  it('冻结的措施不能有新分配：复核器对它的 Allocation 判 allocation_validity 不通过', () => {
    const s = withEnabledInterventions(venueTradeoffScenario, []);
    const plan = {
      selected_intervention_ids: [V.weekdayShuttle],
      allocations: [{ intervention_id: V.weekdayShuttle, student_id: 'vt-s04', opportunity_id: V.weekdayOpportunity, cost_usd: 15 }],
      revoked_grant_ids: [],
    };
    expect(verifyPlan(s, plan).checks.find((c) => c.name === 'allocation_validity')?.passed).toBe(false);
  });

  it('勾选了运行中的措施但其前置依赖没勾：冻结（missing_requires），依赖它的其他措施照常移除', () => {
    const iv = (id: string, extra: Partial<Intervention> = {}): Intervention => ({
      id,
      title: `示例措施 ${id}`,
      type: 'device',
      resolves: ['device'],
      device: 'laptop',
      unit_cost_usd: 1,
      capacity: null,
      ...extra,
    });
    const g: ResourceGrant = {
      id: 'g1',
      student_id: deviceLoanScenario.students[0].id,
      opportunity_id: null,
      intervention_id: 'run',
      type: 'device',
      device: 'laptop',
      status: 'approved',
      provider: '示例',
      is_sample: true,
    };
    const s: Scenario = {
      ...clone(deviceLoanScenario),
      interventions: [iv('base'), iv('run', { requires: ['base'] }), iv('next', { requires: ['run'] })],
      existing_grants: [g],
    };
    const r = resolveEnabledInterventions(s, ['run', 'next']);
    expect(r.enabled).toEqual([]);
    expect(r.frozen).toEqual([{ id: 'run', reason: 'missing_requires', missing_requires: ['base'] }]);
    expect(r.removed.map((x) => x.id)).toEqual(['next']);
    const w = withEnabledInterventions(s, ['run', 'next']);
    // run 留在场景里、不接受新分配；指向已移除措施 base 的 requires 被清理（否则会引用不存在的措施）。
    expect(w.interventions).toEqual([{ ...iv('run', { requires: [] }), opportunity_ids: [] }]);
    expect(validateJointInput(w)).toEqual([]);
  });
});
