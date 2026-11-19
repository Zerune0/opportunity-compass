/**
 * summarizeBarriers 的测试：两个演示场景的固定数字、小型合成场景覆盖每个原因桶、
 * 对 SCENARIOS 全部场景的不变量（桶合计、非负整数、确定性、不改输入、不含学生信息）、
 * 与求解器 / What-if 的交叉检查，以及页面的渲染检查。全部是示例 / 模拟数据。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import BarrierSummaryPage from '../../app/organizer/barriers/page';
import { analyzeReachability } from '../reachability';
import type { BarrierType, Opportunity, ResourceGrant, Scenario, SupportType } from '../types';
import {
  BARRIER_REPORT_CAVEATS,
  BARRIER_ROW_TEXT,
  ELIGIBILITY_NOTE,
  ELIGIBILITY_NOT_REMOVABLE_REASON,
  MISSING_INFO_CATEGORIES,
  MISSING_INFO_LABELS,
  MISSING_INFO_NOTE,
  NOT_REMOVABLE_REASONS,
  NOT_REMOVABLE_REASON_TEXT,
  OVERALL_ELIGIBILITY_LABELS,
  OVERALL_ELIGIBILITY_ORDER,
  SHORT_CAVEATS,
  UPPER_BOUND_NOTE,
  summarizeBarriers,
  syntheticMeasureGrant,
} from './barrier-report';
import type { BarrierSummary, NotRemovableReason, SummarizeBarriersDeps } from './barrier-report';
import { SCENARIOS, deviceLoanScenario, venueTradeoffScenario } from './scenarios';
import { solveJoint } from './solve';
import { makeIntervention, makeOpp, makeScenario, makeStudent } from './testing/fixtures';
import { defaultWhatIfInput, runWhatIf } from './whatif';

// ───────────────────────────── 辅助 ─────────────────────────────

const NO_REASONS = Object.fromEntries(NOT_REMOVABLE_REASONS.map((r) => [r, 0])) as Record<NotRemovableReason, number>;

/** 期望的一行：受影响、可去掉、各原因（没写的为 0）。 */
const row = (affected: number, removable: number, reasons: Partial<Record<NotRemovableReason, number>> = {}) => ({
  affected,
  removable,
  reasons: { ...NO_REASONS, ...reasons },
});

/** 期望的一个资格行：对数、有未化解障碍、可能变为可达、不可能。 */
const elig = (pairs: number, unresolved: number, could: number, not: number) => ({ pairs, unresolved, could, not });

/** 把汇总压成便于比较的形状（只重排，不重算）。 */
function digest(s: BarrierSummary) {
  return {
    pairs: s.pair_count,
    students: s.student_count,
    opportunities: s.opportunity_count,
    eligibility: Object.fromEntries(
      s.eligibility.map((e) => [e.status, elig(e.pairs, e.with_unresolved_barrier, e.could_become_reachable, e.not_removable)]),
    ),
    rows: Object.fromEntries(
      s.barrier_rows.map((r) => [
        r.key,
        {
          affected: r.affected_pairs,
          removable: r.removable_by_approved_measure,
          reasons: Object.fromEntries(r.not_removable_by_reason.map((x) => [x.reason, x.pairs])),
        },
      ]),
    ),
    summary: {
      reachable_now: s.summary.reachable_now,
      not_eligible: s.summary.not_eligible,
      reachability_unknown: s.summary.reachability_unknown,
      missing: Object.fromEntries(s.summary.reachability_unknown_by_category.map((c) => [c.category, c.pairs])),
      with_unresolved_barrier: s.summary.with_unresolved_barrier,
      with_barrier_resolved_by_existing_support: s.summary.with_barrier_resolved_by_existing_support,
      could_become_reachable: s.summary.could_become_reachable,
    },
  };
}

const NO_MISSING = { eligibility_unknown: 0, student_profile: 0, opportunity_listing: 0, evaluation_date: 0, other: 0 };

/** 输出里允许出现的全部字符串：固定文字与固定的键名。 */
const ALLOWED_STRINGS = new Set<string>([
  ...Object.keys(BARRIER_ROW_TEXT),
  ...Object.values(BARRIER_ROW_TEXT).flatMap((t) => [t.label, t.description]),
  ...NOT_REMOVABLE_REASONS,
  ...Object.values(NOT_REMOVABLE_REASON_TEXT),
  ...OVERALL_ELIGIBILITY_ORDER,
  ...Object.values(OVERALL_ELIGIBILITY_LABELS),
  ...Object.values(ELIGIBILITY_NOT_REMOVABLE_REASON),
  ELIGIBILITY_NOTE,
  UPPER_BOUND_NOTE,
  ...MISSING_INFO_CATEGORIES,
  ...Object.values(MISSING_INFO_LABELS),
  MISSING_INFO_NOTE,
  ...SHORT_CAVEATS,
  ...BARRIER_REPORT_CAVEATS,
]);

/** 收集 JSON 值里的全部叶子。 */
function leaves(value: unknown, out: unknown[] = []): unknown[] {
  if (Array.isArray(value)) value.forEach((v) => leaves(v, out));
  else if (value !== null && typeof value === 'object') Object.values(value).forEach((v) => leaves(v, out));
  else out.push(value);
  return out;
}

/** 结构上的不变量（对任何场景都成立）。 */
function expectInvariants(s: BarrierSummary) {
  // 叶子只有非负整数、true 与固定字符串。
  for (const leaf of leaves(s)) {
    if (typeof leaf === 'number') {
      expect(Number.isInteger(leaf) && leaf >= 0, `count ${leaf}`).toBe(true);
    } else if (typeof leaf === 'string') {
      expect(ALLOWED_STRINGS.has(leaf), `unexpected string: ${leaf}`).toBe(true);
    } else {
      expect(leaf).toBe(true);
    }
  }
  const m = s.summary;
  const sum = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
  expect(s.pair_count).toBe(s.student_count * s.opportunity_count);

  // 资格行：顺序固定；对数、有障碍、可能变为可达分别加起来等于汇总数；不可能 = 有障碍 − 可能。
  expect(s.eligibility.map((e) => e.status)).toEqual([...OVERALL_ELIGIBILITY_ORDER]);
  expect(sum(s.eligibility, (e) => e.pairs)).toBe(s.pair_count);
  expect(sum(s.eligibility, (e) => e.with_unresolved_barrier)).toBe(m.with_unresolved_barrier);
  expect(sum(s.eligibility, (e) => e.could_become_reachable)).toBe(m.could_become_reachable);
  const byStatus = Object.fromEntries(s.eligibility.map((e) => [e.status, e]));
  expect(byStatus.not_eligible.could_become_reachable).toBe(0);
  expect(byStatus.unknown.could_become_reachable).toBe(0);
  expect(byStatus.not_eligible.pairs).toBe(m.not_eligible);
  for (const e of s.eligibility) expect(e.with_unresolved_barrier).toBeLessThanOrEqual(e.pairs);

  // 障碍行：四行固定 + 可选 other；每个受影响的对恰好落在「可去掉」或一个原因里。
  const keys = s.barrier_rows.map((r) => r.key);
  expect(keys.slice(0, 4)).toEqual(['time', 'cost', 'transport', 'device']);
  expect(keys.length === 4 || (keys.length === 5 && keys[4] === 'other')).toBe(true);
  if (keys.length === 5) expect(s.barrier_rows[4].affected_pairs).toBeGreaterThan(0);
  for (const r of s.barrier_rows) {
    expect(r.not_removable_by_reason.map((x) => x.reason)).toEqual([...NOT_REMOVABLE_REASONS]);
    const reasons = Object.fromEntries(r.not_removable_by_reason.map((x) => [x.reason, x.pairs]));
    expect(r.removable_by_approved_measure + sum(r.not_removable_by_reason, (x) => x.pairs)).toBe(r.affected_pairs);
    expect(r.not_removable).toBe(r.affected_pairs - r.removable_by_approved_measure);
    expect(r.affected_pairs).toBeLessThanOrEqual(m.with_unresolved_barrier);
    // 整对原因不会超过对应资格状态下有障碍的对数；能变为可达的对在每一行都算可去掉。
    expect(reasons.not_eligible).toBeLessThanOrEqual(byStatus.not_eligible.with_unresolved_barrier);
    expect(reasons.eligibility_unknown).toBeLessThanOrEqual(byStatus.unknown.with_unresolved_barrier);
  }

  // 汇总：三类互斥（可达 / 未知 / 有未化解障碍）。
  expect(m.reachable_now + m.reachability_unknown + m.with_unresolved_barrier).toBeLessThanOrEqual(s.pair_count);
  expect(m.could_become_reachable).toBeLessThanOrEqual(m.with_unresolved_barrier);
  expect(m.reachability_unknown_by_category.map((c) => c.category)).toEqual([...MISSING_INFO_CATEGORIES]);
  for (const c of m.reachability_unknown_by_category) expect(c.pairs).toBeLessThanOrEqual(m.reachability_unknown);
  if (m.reachability_unknown > 0) expect(m.reachability_unknown_by_category.some((c) => c.pairs > 0)).toBe(true);
}

const grant = (id: string, overrides: Partial<ResourceGrant>): ResourceGrant => ({
  id,
  student_id: 's1',
  opportunity_id: 'o1',
  type: 'device',
  device: 'laptop',
  status: 'approved',
  provider: 'Sample provider (fictional)',
  is_sample: true,
  ...overrides,
});

/** 报名费 $200 的线上机会（不要设备）：预算 $100 的默认学生缺 $100。 */
const feeOpp = (id: string): Opportunity =>
  makeOpp(id, { required_devices: [], cost: { fee_usd: 200, requires_travel_expense: false } });

const waiver = (id: string, amount: number, overrides = {}) =>
  makeIntervention(id, { type: 'fee_waiver', resolves: ['cost'], device: null, amount_usd: amount, ...overrides });

const timeSupport = (id: string, hours: number, overrides = {}) =>
  makeIntervention(id, { type: 'time_support', resolves: ['time'], device: null, hours_per_week: hours, ...overrides });

// ───────────────────────────── 演示场景的固定数字 ─────────────────────────────

describe('summarizeBarriers：演示场景的固定数字', () => {
  it('device-loan：10 名学生 × 1 个机会；全缺笔记本（10 对），3 人还缺交通；已批准的借笔记本与交通补助都能去掉（上界）', () => {
    expect(digest(summarizeBarriers(deviceLoanScenario))).toEqual({
      pairs: 10,
      students: 10,
      opportunities: 1,
      eligibility: { eligible: elig(10, 10, 10, 0), not_eligible: elig(0, 0, 0, 0), unknown: elig(0, 0, 0, 0) },
      rows: {
        time: row(0, 0),
        cost: row(0, 0),
        transport: row(3, 3),
        device: row(10, 10),
      },
      summary: {
        reachable_now: 0,
        not_eligible: 0,
        reachability_unknown: 0,
        missing: NO_MISSING,
        with_unresolved_barrier: 10,
        with_barrier_resolved_by_existing_support: 0,
        could_become_reachable: 10,
      },
    });
  });

  it('venue-tradeoff：9 名学生 × 2 场；全部没有交通，接驳车已为 3 对化解（已可达），其余 15 对可由已批准措施去掉（上界，不看互斥）', () => {
    expect(digest(summarizeBarriers(venueTradeoffScenario))).toEqual({
      pairs: 18,
      students: 9,
      opportunities: 2,
      eligibility: { eligible: elig(18, 15, 15, 0), not_eligible: elig(0, 0, 0, 0), unknown: elig(0, 0, 0, 0) },
      rows: {
        time: row(0, 0),
        cost: row(0, 0),
        transport: row(15, 15),
        device: row(0, 0),
      },
      summary: {
        reachable_now: 3,
        not_eligible: 0,
        reachability_unknown: 0,
        missing: NO_MISSING,
        with_unresolved_barrier: 15,
        with_barrier_resolved_by_existing_support: 3,
        could_become_reachable: 15,
      },
    });
  });

  it('SCENARIOS 里的 device-loan / venue-tradeoff 就是上面这两个场景', () => {
    expect(SCENARIOS.find((e) => e.id === 'device-loan')?.scenario).toBe(deviceLoanScenario);
    expect(SCENARIOS.find((e) => e.id === 'venue-tradeoff')?.scenario).toBe(venueTradeoffScenario);
  });
});

// ───────────────────────────── 合成场景：每个原因桶 ─────────────────────────────

describe('summarizeBarriers：原因桶', () => {
  it('只有待审批的措施能去掉 → pending_only；它优先于「类型对但去不掉」', () => {
    const base = { students: [makeStudent('s1')], opportunities: [makeOpp('o1')] };
    const onlyPending = summarizeBarriers(makeScenario({ ...base, interventions: [makeIntervention('iv-laptop', { status: 'pending' })] }));
    expect(digest(onlyPending).rows.device).toEqual(row(1, 0, { pending_only: 1 }));
    expect(onlyPending.summary.could_become_reachable).toBe(0);

    const withWrongDevice = summarizeBarriers(
      makeScenario({
        ...base,
        interventions: [makeIntervention('iv-laptop', { status: 'pending' }), makeIntervention('iv-tablet', { device: 'tablet' })],
      }),
    );
    expect(digest(withWrongDevice).rows.device).toEqual(row(1, 0, { pending_only: 1 }));
  });

  it('依赖待审批措施的已批准措施按 pending 计；依赖不存在的措施同样如此；依赖已批准措施的照常可去掉', () => {
    const base = { students: [makeStudent('s1')], opportunities: [makeOpp('o1')] };
    const needsPending = summarizeBarriers(
      makeScenario({
        ...base,
        interventions: [makeIntervention('iv-laptop', { requires: ['iv-base'] }), timeSupport('iv-base', 1, { status: 'pending' })],
      }),
    );
    expect(digest(needsPending).rows.device).toEqual(row(1, 0, { pending_only: 1 }));

    // 传递闭包：laptop → middle（已批准）→ base（待审批）。
    const transitive = summarizeBarriers(
      makeScenario({
        ...base,
        interventions: [
          makeIntervention('iv-laptop', { requires: ['iv-middle'] }),
          timeSupport('iv-middle', 1, { requires: ['iv-base'] }),
          timeSupport('iv-base', 1, { status: 'pending' }),
        ],
      }),
    );
    expect(digest(transitive).rows.device).toEqual(row(1, 0, { pending_only: 1 }));

    const needsMissing = summarizeBarriers(
      makeScenario({ ...base, interventions: [makeIntervention('iv-laptop', { requires: ['iv-not-in-scenario'] })] }),
    );
    expect(digest(needsMissing).rows.device).toEqual(row(1, 0, { pending_only: 1 }));

    const needsApproved = summarizeBarriers(
      makeScenario({ ...base, interventions: [makeIntervention('iv-laptop', { requires: ['iv-base'] }), timeSupport('iv-base', 1)] }),
    );
    expect(digest(needsApproved).rows.device).toEqual(row(1, 1));
  });

  it('类型对但去不掉（设备不对、减免金额不够、时间支持小时不够）→ partial_match；够的照样算可去掉', () => {
    const wrongDevice = summarizeBarriers(
      makeScenario({ students: [makeStudent('s1')], opportunities: [makeOpp('o1')], interventions: [makeIntervention('iv-tablet', { device: 'tablet' })] }),
    );
    expect(digest(wrongDevice).rows.device).toEqual(row(1, 0, { partial_match: 1 }));

    // 报名费 $200：s1 预算 $100（缺 $100），s2 预算 $180（缺 $20）；减免 $50 只够 s2。
    const smallWaiver = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1'), makeStudent('s2', { budget_usd: 180 })],
        opportunities: [feeOpp('o-fee')],
        interventions: [waiver('iv-waiver', 50)],
      }),
    );
    expect(digest(smallWaiver).rows.cost).toEqual(row(2, 1, { partial_match: 1 }));
    expect(smallWaiver.summary.could_become_reachable).toBe(1);

    // 每周要 15 小时，学生只有 10 小时（缺 5）；时间支持每周 2 小时不够。
    const fewHours = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [makeOpp('o-hours', { required_devices: [], time_commitment: { hours_per_week: 15, total_weeks: 6 } })],
        interventions: [timeSupport('iv-time', 2)],
      }),
    );
    expect(digest(fewHours).rows.time).toEqual(row(1, 0, { partial_match: 1 }));
  });

  it('两项各 $50 的减免只有一起才够 $100 的缺口 → 可去掉（不再逐项判断）', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [feeOpp('o-fee')],
        interventions: [waiver('iv-waiver-a', 50), waiver('iv-waiver-b', 50)],
      }),
    );
    expect(digest(s).rows.cost).toEqual(row(1, 1));
    expect(s.summary.could_become_reachable).toBe(1);
  });

  it('已有 approved 减免抵掉一部分缺口、措施补上其余 → 可去掉', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [feeOpp('o-fee')],
        interventions: [waiver('iv-waiver', 40)],
        existing_grants: [grant('g-waiver', { opportunity_id: 'o-fee', type: 'fee_waiver', device: null, amount_usd: 60 })],
      }),
    );
    // 已有的 $60 不够 $100，所以仍受影响；加上措施的 $40 正好够。
    expect(digest(s).rows.cost).toEqual(row(1, 1));
    expect(s.summary.with_barrier_resolved_by_existing_support).toBe(0);
  });

  it('场景里没有对应该类障碍的措施 → no_measure', () => {
    const s = summarizeBarriers(
      makeScenario({ students: [makeStudent('s1')], opportunities: [feeOpp('o-fee')], interventions: [makeIntervention('iv-laptop')] }),
    );
    expect(digest(s).rows.cost).toEqual(row(1, 0, { no_measure: 1 }));
    expect(digest(s).rows.device).toEqual(row(0, 0));
  });

  it('资格不符的对：障碍照样计入受影响，但任何措施都不算可去掉（not_eligible），也不会变为可达', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1', { grade: 8 }), makeStudent('s2')],
        opportunities: [makeOpp('o1')],
        interventions: [makeIntervention('iv-laptop')],
      }),
    );
    const d = digest(s);
    expect(d.eligibility).toEqual({ eligible: elig(1, 1, 1, 0), not_eligible: elig(1, 1, 0, 1), unknown: elig(0, 0, 0, 0) });
    expect(d.rows.device).toEqual(row(2, 1, { not_eligible: 1 }));
    expect(d.summary).toMatchObject({ not_eligible: 1, with_unresolved_barrier: 2, could_become_reachable: 1, reachable_now: 0 });
  });

  it('资格 unknown 的对：措施能去掉障碍也不算可去掉（eligibility_unknown），不会变为可达', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1', { grade: null })],
        opportunities: [makeOpp('o1')],
        interventions: [makeIntervention('iv-laptop')],
      }),
    );
    const d = digest(s);
    expect(d.eligibility).toEqual({ eligible: elig(0, 0, 0, 0), not_eligible: elig(0, 0, 0, 0), unknown: elig(1, 1, 0, 1) });
    expect(d.rows.device).toEqual(row(1, 0, { eligibility_unknown: 1 }));
    expect(d.summary.could_become_reachable).toBe(0);
    // 现在有未化解障碍 → reachable 为 false，不计入「可达性未知」。
    expect(d.summary.reachability_unknown).toBe(0);
  });

  it('信息不足：reachable === null 按固定类别计数；有障碍又缺信息的对落在 information_missing，不算可去掉', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [
          makeStudent('s1', { devices: null }), // 缺设备信息 → null
          makeStudent('s2', { grade: null, devices: ['laptop'] }), // 年级没填 → 资格 unknown → null
          makeStudent('s3', { hours_per_week_available: null }), // 缺时间信息，但缺笔记本 → false
        ],
        opportunities: [makeOpp('o1')],
        interventions: [makeIntervention('iv-laptop')],
      }),
    );
    const d = digest(s);
    expect(d.eligibility).toEqual({ eligible: elig(2, 1, 0, 1), not_eligible: elig(0, 0, 0, 0), unknown: elig(1, 0, 0, 0) });
    expect(d.summary.reachability_unknown).toBe(2);
    expect(d.summary.missing).toEqual({ ...NO_MISSING, eligibility_unknown: 1, student_profile: 1 });
    expect(d.rows.device).toEqual(row(1, 0, { information_missing: 1 }));
    expect(d.summary.could_become_reachable).toBe(0);
  });

  it('已被已有 approved grant 化解的障碍不算受影响；pending 的已有 grant 不化解、也不算措施', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1'), makeStudent('s2')],
        opportunities: [makeOpp('o1')],
        interventions: [],
        existing_grants: [grant('g-approved', { student_id: 's1' }), grant('g-pending', { student_id: 's2', status: 'pending' })],
      }),
    );
    const d = digest(s);
    expect(d.rows.device).toEqual(row(1, 0, { no_measure: 1 }));
    expect(d.summary).toMatchObject({ reachable_now: 1, with_barrier_resolved_by_existing_support: 1, with_unresolved_barrier: 1 });
  });

  it('只带「该对的」已有 grant：别人的、别的机会的 grant 不影响', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1'), makeStudent('s2')],
        opportunities: [makeOpp('o1'), makeOpp('o2')],
        interventions: [],
        existing_grants: [grant('g-s1-o2', { student_id: 's1', opportunity_id: 'o2' }), grant('g-s2-all', { student_id: 's2', opportunity_id: null })],
      }),
    );
    // s1 只在 o2 有笔记本；s2 的 grant 对所有机会有效。
    expect(digest(s).rows.device).toEqual(row(1, 0, { no_measure: 1 }));
    expect(s.summary.reachable_now).toBe(3);
  });

  it('措施的 opportunity_ids 只含另一个机会 → other_opportunity_only；适用的那个机会照样可去掉', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [makeOpp('o1'), makeOpp('o2')],
        interventions: [makeIntervention('iv-laptop', { opportunity_ids: ['o2'] })],
      }),
    );
    expect(digest(s).rows.device).toEqual(row(2, 1, { other_opportunity_only: 1 }));
    expect(s.summary.could_become_reachable).toBe(1);
  });

  it('待审批措施只适用于另一个机会：本机会 other_opportunity_only，那个机会 pending_only', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [makeOpp('o1'), makeOpp('o2')],
        interventions: [makeIntervention('iv-laptop', { status: 'pending', opportunity_ids: ['o2'] })],
      }),
    );
    expect(digest(s).rows.device).toEqual(row(2, 0, { other_opportunity_only: 1, pending_only: 1 }));
  });

  it('opportunity_ids: []（不接受新分配的措施）不适用于任何机会 → other_opportunity_only', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [makeOpp('o1')],
        interventions: [makeIntervention('iv-laptop', { opportunity_ids: [] })],
      }),
    );
    expect(digest(s).rows.device).toEqual(row(1, 0, { other_opportunity_only: 1 }));
  });

  it('「可去掉」故意不看名额与预算', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1'), makeStudent('s2'), makeStudent('s3')],
        opportunities: [makeOpp('o1')],
        interventions: [makeIntervention('iv-laptop', { capacity: 1, unit_cost_usd: 500, fixed_cost_usd: 500 })],
        budget_usd: 0,
      }),
    );
    expect(digest(s).rows.device).toEqual(row(3, 3));
  });

  it('已过截止日期 → 该对的每一行都落在 deadline_passed（时间支持、借笔记本都不算可去掉）', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s1')],
        opportunities: [makeOpp('o-late', { deadline: '2026-11-01' })],
        interventions: [makeIntervention('iv-laptop'), timeSupport('iv-time', 20)],
      }),
    );
    const d = digest(s);
    expect(d.rows.time).toEqual(row(1, 0, { deadline_passed: 1 }));
    expect(d.rows.device).toEqual(row(1, 0, { deadline_passed: 1 }));
    expect(d.eligibility.eligible).toEqual(elig(1, 1, 0, 1));
    expect(d.summary.could_become_reachable).toBe(0);
  });

  it('引擎出现四类以外的障碍类型时，归入追加在最后的 other 行，不丢弃；不回显障碍说明', () => {
    const marker = 'FREE-TEXT-MARKER-should-not-appear';
    const analyze: SummarizeBarriersDeps['analyze'] = (profile, opp, grants, options) => {
      const r = analyzeReachability(profile, opp, grants, options);
      return {
        ...r,
        barriers: [
          ...r.barriers,
          { type: 'weather' as unknown as BarrierType, description: marker, shortfall: null, resolved: false, resolved_by_grant_ids: [] },
        ],
        reachable: false,
        summary: marker,
      };
    };
    const scenario = makeScenario({ students: [makeStudent('s1')], opportunities: [makeOpp('o1')], interventions: [makeIntervention('iv-laptop')] });
    const s = summarizeBarriers(scenario, { analyze });
    expect(s.barrier_rows.map((r) => r.key)).toEqual(['time', 'cost', 'transport', 'device', 'other']);
    const d = digest(s);
    expect(d.rows.other).toEqual(row(1, 0, { no_measure: 1 }));
    expect(d.rows.device).toEqual(row(1, 1));
    expect(d.summary.could_become_reachable).toBe(0);
    expect(JSON.stringify(s)).not.toContain(marker);
    expectInvariants(s);
    // 不注入时只有四行。
    expect(summarizeBarriers(scenario).barrier_rows.map((r) => r.key)).toEqual(['time', 'cost', 'transport', 'device']);
  });

  it('空场景：全部为 0，四行照样给出', () => {
    const s = summarizeBarriers(makeScenario());
    expect(s.pair_count).toBe(0);
    expect(digest(s).rows).toEqual({ time: row(0, 0), cost: row(0, 0), transport: row(0, 0), device: row(0, 0) });
    expectInvariants(s);
  });
});

// ───────────────────────────── 与求解器的一致性 ─────────────────────────────

describe('summarizeBarriers：与求解器一致', () => {
  const ALL_TYPES: SupportType[] = ['device', 'transport_subsidy', 'fee_waiver', 'time_support', 'alternative_access'];

  it.each(ALL_TYPES)('合成 grant（%s）与求解器的 Allocation 合成 grant 字段相同（CONTRACT 第 2 条）', (type) => {
    const scenario = makeScenario({ title: 'Sample scenario (simulated)' });
    const iv = makeIntervention('iv-x', { type, device: type === 'device' ? 'laptop' : null, amount_usd: 30, hours_per_week: 4 });
    const g = syntheticMeasureGrant(scenario, iv, 's1', 'o1');
    expect(Object.keys(g).sort()).toEqual(
      ['amount_usd', 'device', 'hours_per_week', 'id', 'intervention_id', 'is_sample', 'opportunity_id', 'provider', 'status', 'student_id', 'type'],
    );
    const { id, ...rest } = g;
    expect(id.endsWith(':iv-x:s1:o1')).toBe(true);
    expect(rest).toEqual({
      student_id: 's1',
      opportunity_id: 'o1',
      intervention_id: 'iv-x',
      type,
      amount_usd: 30,
      device: type === 'device' ? 'laptop' : null,
      hours_per_week: 4,
      status: 'approved',
      provider: scenario.title,
      is_sample: true,
    });
    // 缺省字段变成 null（与求解器的 `?? null` 一致）。
    const bare = syntheticMeasureGrant(scenario, { ...iv, amount_usd: undefined, device: undefined, hours_per_week: undefined }, 's1', 'o1');
    expect([bare.amount_usd, bare.device, bare.hours_per_week]).toEqual([null, null, null]);
  });

  it('名额与预算不限、没有互斥时：求解器的 R1 = 现在可达 + 可能变为可达（上界此时正好达到）', () => {
    const scenario = makeScenario({
      students: [
        makeStudent('s1'), // 缺笔记本；预算 $100
        makeStudent('s2', { devices: ['laptop'], transport: { level: 'none' }, budget_usd: 0 }),
        makeStudent('s3', { grade: null }), // 资格 unknown
        makeStudent('s4', { grade: 8 }), // 不符合资格
      ],
      opportunities: [
        makeOpp('o-dev'),
        makeOpp('o-in', { location: { format: 'in_person', country: 'US', state: 'CA' }, required_devices: [] }),
        feeOpp('o-fee'),
        makeOpp('o-hours', { required_devices: [], time_commitment: { hours_per_week: 15, total_weeks: 6 } }),
      ],
      interventions: [
        makeIntervention('iv-laptop', { unit_cost_usd: 1 }),
        makeIntervention('iv-shuttle', { type: 'transport_subsidy', resolves: ['transport'], device: null, amount_usd: 10, unit_cost_usd: 1 }),
        makeIntervention('iv-online', { type: 'alternative_access', resolves: ['transport'], device: null, unit_cost_usd: 1, opportunity_ids: ['o-in'] }),
        waiver('iv-waiver-a', 50, { unit_cost_usd: 1 }),
        waiver('iv-waiver-b', 50, { unit_cost_usd: 1 }),
        timeSupport('iv-time', 6, { unit_cost_usd: 1 }),
        // 依赖待审批措施：两边都不能用（s2 在 o-fee 缺 $200，只有它够）。
        waiver('iv-big-waiver', 500, { unit_cost_usd: 1, requires: ['iv-pending-base'] }),
        timeSupport('iv-pending-base', 0, { unit_cost_usd: 1, status: 'pending' }),
      ],
      budget_usd: 100_000,
    });
    const s = summarizeBarriers(scenario);
    const result = solveJoint(scenario);
    expect(result.status).toBe('OPTIMAL');
    expect(result.R0.length).toBe(s.summary.reachable_now);
    expect(result.R1.length).toBe(s.summary.reachable_now + s.summary.could_become_reachable);
    expect(s.summary.could_become_reachable).toBeGreaterThan(0);
    expect(digest(s).rows.cost.reasons.pending_only).toBe(1);
    expectInvariants(s);
  });

  it.each(SCENARIOS.map((e) => ({ id: e.id, scenario: e.scenario })))(
    '$id：What-if 默认方案的覆盖对数 ≤ 现在可达 + 可能变为可达（上界），且 R0 = 现在可达',
    ({ scenario }) => {
      const s = summarizeBarriers(scenario);
      const view = runWhatIf(scenario, defaultWhatIfInput(scenario));
      expect(view.R0_count).not.toBeNull();
      expect(view.R1_count).not.toBeNull();
      expect(view.R0_count).toBe(s.summary.reachable_now);
      expect(view.R1_count!).toBeLessThanOrEqual(s.summary.reachable_now + s.summary.could_become_reachable);
    },
  );
});

// ───────────────────────────── 不变量 ─────────────────────────────

describe('summarizeBarriers：对 SCENARIOS 每个场景的不变量', () => {
  it('SCENARIOS 不为空', () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(2);
  });

  it.each(SCENARIOS.map((e) => ({ id: e.id, scenario: e.scenario })))('$id：桶合计、非负整数、固定字符串', ({ scenario }) => {
    expectInvariants(summarizeBarriers(scenario));
  });

  it.each(SCENARIOS.map((e) => ({ id: e.id, scenario: e.scenario })))('$id：确定性，且不修改输入', ({ scenario }) => {
    const before = structuredClone(scenario);
    const a = summarizeBarriers(scenario);
    const b = summarizeBarriers(scenario);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(scenario).toEqual(before);
  });

  it.each(SCENARIOS.map((e) => ({ id: e.id, scenario: e.scenario })))('$id：JSON 里没有任何学生的 id、显示名、学校名', ({ scenario }) => {
    const json = JSON.stringify(summarizeBarriers(scenario));
    for (const s of scenario.students) {
      expect(json).not.toContain(s.id);
      expect(json).not.toContain(s.display_name);
      if (typeof s.school_name === 'string' && s.school_name !== '') expect(json).not.toContain(s.school_name);
    }
  });

  it('合成场景同样满足不变量，且不修改输入', () => {
    const scenarios: Scenario[] = [
      makeScenario({
        students: [makeStudent('s1', { grade: 8 }), makeStudent('s2', { devices: null }), makeStudent('s3', { budget_usd: 0 }), makeStudent('s4', { grade: null })],
        opportunities: [makeOpp('o1'), feeOpp('o-fee'), makeOpp('o-late', { deadline: '2026-11-01' })],
        interventions: [
          makeIntervention('iv-laptop', { opportunity_ids: ['o1'] }),
          makeIntervention('iv-tablet', { device: 'tablet', status: 'pending' }),
          waiver('iv-waiver', 50, { requires: ['iv-tablet'] }),
        ],
        existing_grants: [grant('g1', { student_id: 's3', opportunity_id: null })],
      }),
    ];
    for (const scenario of scenarios) {
      const before = structuredClone(scenario);
      const s = summarizeBarriers(scenario);
      expectInvariants(s);
      expect(summarizeBarriers(scenario)).toEqual(s);
      expect(scenario).toEqual(before);
    }
  });
});

// ───────────────────────────── 页面 ─────────────────────────────

describe('app/organizer/barriers/page.tsx', () => {
  const src = readFileSync(fileURLToPath(new URL('../../app/organizer/barriers/page.tsx', import.meta.url)), 'utf8');
  const html = renderToStaticMarkup(createElement(BarrierSummaryPage));
  const SENTENCE = 'Sample data. Not a measure of real need.';

  it('是 server component（没有 "use client"），源码不读学生字段', () => {
    expect(src).not.toMatch(/['"]use client['"]/);
    expect(src).not.toMatch(/\.students\b/);
    expect(src).not.toContain('display_name');
    expect(src).not.toContain('school_name');
  });

  it('页面顶部的说明框原样显示示例数据说明，且在第一张表格之前', () => {
    const noteStart = html.indexOf('<div role="note"');
    expect(noteStart).toBeGreaterThanOrEqual(0);
    const noteEnd = html.indexOf('</div>', noteStart);
    const note = html.slice(noteStart, noteEnd);
    expect(note).toContain(`>${SENTENCE}</p>`);
    expect(html.indexOf(SENTENCE)).toBe(noteStart + note.indexOf(SENTENCE));
    expect(noteEnd).toBeLessThan(html.indexOf('<table'));
    expect(html.indexOf('<h1')).toBeLessThan(noteStart);
  });

  it('每个场景一节；上界说明紧跟在障碍表之后；不出现任何学生信息', () => {
    for (const e of SCENARIOS) {
      expect(html).toContain(`id="barriers-${e.id}"`);
      for (const s of e.scenario.students) {
        expect(html).not.toContain(s.id);
        expect(html).not.toContain(s.display_name);
        if (typeof s.school_name === 'string' && s.school_name !== '') expect(html).not.toContain(s.school_name);
      }
    }
    const segments = html.split('>Real-world barriers (pairs)</caption>').slice(1);
    expect(segments).toHaveLength(SCENARIOS.length);
    for (const seg of segments) {
      const afterTable = seg.slice(seg.indexOf('</table>'));
      const next = afterTable.indexOf('<table');
      const between = next === -1 ? afterTable : afterTable.slice(0, next);
      expect(between).toContain(UPPER_BOUND_NOTE);
    }
  });

  it('滚动区域的标签互不相同（含场景标题）；两列的表格不加滚动区域', () => {
    const labels = [...html.matchAll(/role="region" aria-label="([^"]*)"/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThanOrEqual(2 * SCENARIOS.length);
    expect(new Set(labels).size).toBe(labels.length);
    for (const label of labels) expect(SCENARIOS.some((e) => label.includes(e.title))).toBe(true);
    expect(html).not.toMatch(/role="region"[^>]*>\s*<table[^>]*>\s*<caption[^>]*>Summary \(pairs\)/);
  });
});
