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
import { EligibilityDetailTable, OtherDemands, ParticipationTable } from '../../app/organizer/barriers/detail-tables';
import { analyzeReachability } from '../reachability';
import type { BarrierType, EvidenceItem, Opportunity, PrepItem, Requirement, ResourceGrant, Scenario, SupportType } from '../types';
import {
  BARRIER_REPORT_CAVEATS,
  BARRIER_ROW_TEXT,
  ELIGIBILITY_DETAIL_LABELS,
  ELIGIBILITY_DETAIL_NOTE,
  ELIGIBILITY_DETAIL_ORDER,
  ELIGIBILITY_NOTE,
  ELIGIBILITY_NOT_REMOVABLE_REASON,
  MATERIALS_BURDEN_LABELS,
  MATERIALS_BURDEN_NOTE,
  MATERIALS_BURDEN_ORDER,
  MISSING_INFO_CATEGORIES,
  MISSING_INFO_LABELS,
  MISSING_INFO_NOTE,
  NOT_REMOVABLE_REASONS,
  NOT_REMOVABLE_REASON_TEXT,
  OTHER_DEMANDS_NOTE,
  OVERALL_ELIGIBILITY_LABELS,
  OVERALL_ELIGIBILITY_ORDER,
  PARTICIPATION_FORMAT_LABELS,
  PARTICIPATION_FORMAT_ORDER,
  PARTICIPATION_INTERNET_NOTE,
  PARTICIPATION_NOTE,
  PARTICIPATION_TRANSPORT_NOTE,
  SHORT_CAVEATS,
  TEAM_REQUIREMENT_LABELS,
  TEAM_REQUIREMENT_NOTE,
  TEAM_REQUIREMENT_ORDER,
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
  // 新增四部分的固定键名与文字。
  ...Object.keys(ELIGIBILITY_DETAIL_LABELS),
  ...Object.values(ELIGIBILITY_DETAIL_LABELS),
  ELIGIBILITY_DETAIL_NOTE,
  ...PARTICIPATION_FORMAT_ORDER,
  ...Object.values(PARTICIPATION_FORMAT_LABELS),
  PARTICIPATION_NOTE,
  PARTICIPATION_TRANSPORT_NOTE,
  PARTICIPATION_INTERNET_NOTE,
  ...TEAM_REQUIREMENT_ORDER,
  ...Object.values(TEAM_REQUIREMENT_LABELS),
  TEAM_REQUIREMENT_NOTE,
  ...Object.keys(MATERIALS_BURDEN_LABELS),
  ...Object.values(MATERIALS_BURDEN_LABELS),
  MATERIALS_BURDEN_NOTE,
  OTHER_DEMANDS_NOTE,
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

// ───────────────────────────── 新增四部分：资格明细、参与形式、组队要求、材料负担 ─────────────────────────────

const sumOf = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
const eligPairs = (s: BarrierSummary, status: string) => s.eligibility.find((e) => e.status === status)!.pairs;

/** 新增四部分的结构不变量（对任何场景都成立）。 */
function expectNewPartInvariants(s: BarrierSummary) {
  const eligible = eligPairs(s, 'eligible');
  const notEligible = eligPairs(s, 'not_eligible');
  const unknown = eligPairs(s, 'unknown');

  // 资格明细：八行固定 + 可选 other；每行不超过该资格层的对数；该层有对时至少一行有数（一对至少有一条对应的硬性要求）。
  const detailKeys = s.eligibility_detail.map((d) => d.requirement_type);
  expect(detailKeys.slice(0, 8)).toEqual([...ELIGIBILITY_DETAIL_ORDER]);
  expect(detailKeys.length === 8 || (detailKeys.length === 9 && detailKeys[8] === 'other')).toBe(true);
  for (const d of s.eligibility_detail) {
    expect(d.not_eligible_pairs).toBeLessThanOrEqual(notEligible);
    expect(d.unknown_pairs).toBeLessThanOrEqual(unknown);
  }
  if (detailKeys.length === 9) expect(s.eligibility_detail[8].not_eligible_pairs + s.eligibility_detail[8].unknown_pairs).toBeGreaterThan(0);
  expect(s.eligibility_detail.some((d) => d.not_eligible_pairs > 0)).toBe(notEligible > 0);
  expect(s.eligibility_detail.some((d) => d.unknown_pairs > 0)).toBe(unknown > 0);

  // 参与形式：四行固定，合计 = 对数；交通列只在有线下部分的形式，家庭网络列只在有线上部分的形式。
  const rows = s.participation.rows;
  expect(rows.map((r) => r.format)).toEqual([...PARTICIPATION_FORMAT_ORDER]);
  expect(sumOf(rows, (r) => r.pairs)).toBe(s.pair_count);
  for (const r of rows) {
    const inPersonPart = r.format === 'in_person' || r.format === 'hybrid';
    const onlinePart = r.format === 'online' || r.format === 'hybrid';
    expect('transport_limited_or_none' in r).toBe(inPersonPart);
    expect('transport_not_recorded' in r).toBe(inPersonPart);
    expect('home_internet_not_listed' in r).toBe(onlinePart);
    expect('devices_not_recorded' in r).toBe(onlinePart);
    if (inPersonPart) expect(r.transport_limited_or_none! + r.transport_not_recorded!).toBeLessThanOrEqual(r.pairs);
    if (onlinePart) expect(r.home_internet_not_listed! + r.devices_not_recorded!).toBeLessThanOrEqual(r.pairs);
  }

  // 组队要求与材料负担：合计 = 对数，eligible 列合计 = 资格 eligible 的对数。
  const d = s.other_demands;
  expect(d.team_requirement.map((r) => r.status)).toEqual([...TEAM_REQUIREMENT_ORDER]);
  expect(d.materials.map((r) => r.band)).toEqual([...MATERIALS_BURDEN_ORDER]);
  const tables: { pairs: number; eligible_pairs: number }[][] = [d.team_requirement, d.materials];
  for (const table of tables) {
    expect(sumOf(table, (r) => r.pairs)).toBe(s.pair_count);
    expect(sumOf(table, (r) => r.eligible_pairs)).toBe(eligible);
    for (const r of table) expect(r.eligible_pairs).toBeLessThanOrEqual(r.pairs);
  }
}

/** 把新增四部分压成便于比较的形状（只重排，不重算）。 */
function digestNew(s: BarrierSummary) {
  return {
    detail: Object.fromEntries(s.eligibility_detail.map((d) => [d.requirement_type, [d.not_eligible_pairs, d.unknown_pairs]])),
    formats: Object.fromEntries(
      s.participation.rows.map((r) => [r.format, Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'format' && k !== 'label'))]),
    ),
    team: Object.fromEntries(s.other_demands.team_requirement.map((r) => [r.status, [r.pairs, r.eligible_pairs]])),
    materials: Object.fromEntries(s.other_demands.materials.map((r) => [r.band, [r.pairs, r.eligible_pairs]])),
  };
}

const NO_DETAIL = Object.fromEntries(ELIGIBILITY_DETAIL_ORDER.map((t) => [t, [0, 0]]));

const req = (r: Record<string, unknown>): Requirement =>
  ({ label: `Fictional requirement ${String(r.id)}`, hard: true, source_text: 'Fictional rule for unit tests (sample).', ...r }) as Requirement;

const prep = (id: string, overrides: Partial<PrepItem> = {}): PrepItem => ({
  id,
  title: `Fictional prep item ${id}`,
  estimated_hours: 0,
  estimated_cost_usd: 0,
  depends_on: [],
  required_for_application: true,
  material_kind: 'resume',
  ...overrides,
});

/** 作品要求（硬性，要 project）+ 能产出它的必需准备项 + 必需的简历：一份作品算两条，共 3 条。 */
const dupOpp = (): Opportunity =>
  makeOpp('o-dup', {
    required_devices: [],
    requirements: [req({ id: 'req-grade', type: 'grade', min: 9, max: 12 }), req({ id: 'req-work', type: 'portfolio', evidence_kind: 'project' })],
    preparation: [prep('prep-project', { material_kind: 'portfolio', evidence_kind: 'project' }), prep('prep-resume')],
  });

const evidence = (id: string, overrides: Partial<EvidenceItem> = {}): EvidenceItem => ({
  id,
  title: `Fictional evidence ${id}`,
  kind: 'certificate',
  skills: [],
  status: 'self_reported',
  added_on: '2026-10-01',
  ...overrides,
});

describe('summarizeBarriers：新增四部分（资格明细、参与形式、组队要求、材料负担）', () => {
  it('device-loan / venue-tradeoff：占位机会都是线下、没有记录组队要求、没有准备项；交通列与障碍表 Transport 行不是同一个数', () => {
    const dl = summarizeBarriers(deviceLoanScenario);
    expect(digestNew(dl)).toEqual({
      detail: NO_DETAIL,
      formats: {
        online: { pairs: 0, home_internet_not_listed: 0, devices_not_recorded: 0 },
        hybrid: { pairs: 0, transport_limited_or_none: 0, transport_not_recorded: 0, home_internet_not_listed: 0, devices_not_recorded: 0 },
        in_person: { pairs: 10, transport_limited_or_none: 3, transport_not_recorded: 0 },
        unknown: { pairs: 0 },
      },
      team: { required: [0, 0], not_required: [0, 0], unclear: [0, 0], not_recorded: [10, 10] },
      materials: { none: [10, 10], one_or_two: [0, 0], three_or_more: [0, 0] },
    });

    const vt = summarizeBarriers(venueTradeoffScenario);
    expect(digestNew(vt).formats.in_person).toEqual({ pairs: 18, transport_limited_or_none: 18, transport_not_recorded: 0 });
    expect(digestNew(vt).team.not_recorded).toEqual([18, 18]);
    expect(digestNew(vt).materials.none).toEqual([18, 18]);
    // 18 对的学生都没有交通，但接驳车已为 3 对化解：障碍表只数仍未化解的 15 对。
    expect(vt.barrier_rows.find((r) => r.key === 'transport')!.affected_pairs).toBe(15);
    expectNewPartInvariants(dl);
    expectNewPartInvariants(vt);
  });

  it('资格明细：不符合的对按不满足的硬性要求类型、未知的对按待确认的硬性要求类型计数；每对每类型只计一次；偏好不计', () => {
    const rulesOpp = makeOpp('o-rules', {
      required_devices: [],
      requirements: [
        req({ id: 'req-grade', type: 'grade', min: 9, max: 12 }),
        req({ id: 'req-grade-2', type: 'grade', min: 10 }),
        req({ id: 'req-region', type: 'region', countries: ['US'], states: ['CA'] }),
        req({ id: 'req-status-pref', type: 'status', any_of: ['undergraduate'], hard: false }),
      ],
    });
    const manualOpp = makeOpp('o-manual', {
      required_devices: [],
      requirements: [req({ id: 'req-grade', type: 'grade', min: 9, max: 12 }), req({ id: 'req-manual', type: 'manual' })],
    });
    const s = summarizeBarriers(
      makeScenario({
        students: [
          makeStudent('s-ok'), // o-rules 符合（偏好不满足不影响）；o-manual 待确认（manual）
          makeStudent('s-young', { grade: 8 }), // 两条年级要求都不满足：grade 只计一次
          makeStudent('s-far', { grade: 9, region: { country: 'US', state: 'NY' } }), // o-rules：年级 + 地区；o-manual：manual
          makeStudent('s-nograde', { grade: null }), // 年级没填：两个机会都 unknown；o-manual 还有 manual
        ],
        opportunities: [rulesOpp, manualOpp],
      }),
    );
    expect(digest(s).eligibility).toEqual({
      eligible: elig(1, 0, 0, 0),
      not_eligible: elig(3, 0, 0, 0),
      unknown: elig(4, 0, 0, 0),
    });
    expect(digestNew(s).detail).toEqual({ ...NO_DETAIL, grade: [3, 2], region: [1, 0], manual: [0, 3] });
    // 不符合的那一对（s-young / o-manual）的 manual 待确认不计入 unknown 列（只看该对所在的资格层）。
    expectInvariants(s);
    expectNewPartInvariants(s);
  });

  it('资格明细：hard 按真值判断（与 checkEligibility 判总体资格同一口径）：数据损坏成 hard: 1 时，不符合的对照样有明细行', () => {
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s-young', { grade: 8 })],
        opportunities: [makeOpp('o1', { required_devices: [], requirements: [req({ id: 'req-grade', type: 'grade', min: 9, max: 12, hard: 1 })] })],
      }),
    );
    expect(digest(s).eligibility.not_eligible.pairs).toBe(1);
    expect(digestNew(s).detail).toEqual({ ...NO_DETAIL, grade: [1, 0] });
    expectInvariants(s);
    expectNewPartInvariants(s);
  });

  it('资格明细：引擎出现八种以外的要求类型时归入追加在最后的 other 行，不回显说明文字', () => {
    const marker = 'FREE-TEXT-REQUIREMENT-MARKER';
    const analyze: SummarizeBarriersDeps['analyze'] = (profile, opp, grants, options) => {
      const r = analyzeReachability(profile, opp, grants, options);
      const weird = { ...r.eligibility.items[0], requirement_type: 'weird' as never, status: 'not_satisfied' as const, explanation: marker, label: marker };
      return { ...r, eligibility: { ...r.eligibility, overall: 'not_eligible', items: [...r.eligibility.items, weird] }, reachable: false };
    };
    const s = summarizeBarriers(makeScenario({ students: [makeStudent('s1')], opportunities: [makeOpp('o1')] }), { analyze });
    expect(s.eligibility_detail.map((d) => d.requirement_type)).toEqual([...ELIGIBILITY_DETAIL_ORDER, 'other']);
    expect(digestNew(s).detail).toEqual({ ...NO_DETAIL, other: [1, 0] });
    expect(JSON.stringify(s)).not.toContain(marker);
    expectInvariants(s);
    expectNewPartInvariants(s);
  });

  it('参与形式：四种形式（坏的 location 算 unknown）；交通只数有线下部分的形式，家庭网络只数有线上部分的形式', () => {
    const at = (id: string, location: unknown) => makeOpp(id, { required_devices: [], location: location as Opportunity['location'] });
    const s = summarizeBarriers(
      makeScenario({
        students: [
          makeStudent('s-ok'), // 交通稳定，有家庭网络
          makeStudent('s-none', { transport: { level: 'none' }, devices: ['laptop'] }),
          makeStudent('s-limited', { transport: { level: 'limited' }, devices: null }),
          makeStudent('s-unrecorded', { transport: null, devices: [] }),
        ],
        opportunities: [
          at('o-online', { format: 'online' }),
          at('o-hybrid', { format: 'hybrid', country: 'US', state: 'CA' }),
          at('o-in-person', { format: 'in_person', country: 'US', state: 'CA' }),
          at('o-unknown', { format: 'unknown' }),
          at('o-broken', null),
        ],
      }),
    );
    expect(digestNew(s).formats).toEqual({
      online: { pairs: 4, home_internet_not_listed: 2, devices_not_recorded: 1 },
      hybrid: { pairs: 4, transport_limited_or_none: 2, transport_not_recorded: 1, home_internet_not_listed: 2, devices_not_recorded: 1 },
      in_person: { pairs: 4, transport_limited_or_none: 2, transport_not_recorded: 1 },
      unknown: { pairs: 8 },
    });
    // 障碍表的 Transport 行：只有 hybrid 与 in_person 上交通 limited / none 的 4 对（没有已有支持、不要求自费差旅）。
    expect(digest(s).rows.transport.affected).toBe(4);
    expectInvariants(s);
    expectNewPartInvariants(s);

    // 读不了的交通等级、不是数组的设备：算作「没填或读不了」，不当作有或没有。
    const unreadable = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s-bad', { transport: { level: 'teleport' } as never, devices: 'laptop' as never })],
        opportunities: [at('o-hybrid', { format: 'hybrid', country: 'US', state: 'CA' })],
      }),
    );
    expect(digestNew(unreadable).formats.hybrid).toEqual({
      pairs: 1,
      transport_limited_or_none: 0,
      transport_not_recorded: 1,
      home_internet_not_listed: 0,
      devices_not_recorded: 1,
    });
    expectNewPartInvariants(unreadable);
  });

  it('组队要求：required / not_required / unclear（required 为 null）/ not_recorded（字段缺失、null、坏数据）分开计；eligible 列只数资格 eligible 的对', () => {
    const team = (id: string, value: unknown) =>
      makeOpp(id, { required_devices: [], team_requirement: value as Opportunity['team_requirement'] });
    const s = summarizeBarriers(
      makeScenario({
        students: [makeStudent('s-eligible'), makeStudent('s-grade-8', { grade: 8 })],
        opportunities: [
          team('o-team', { required: true, min_size: 2, max_size: 4, source_text: 'Teams of 2 to 4. (fictional)' }),
          team('o-team-no-text', { required: true, source_text: null }),
          team('o-solo', { required: false, source_text: null }),
          team('o-unclear', { required: null, source_text: null }),
          makeOpp('o-missing', { required_devices: [] }),
          team('o-null', null),
          team('o-bad', 'yes'),
        ],
      }),
    );
    expect(digestNew(s).team).toEqual({ required: [4, 2], not_required: [2, 1], unclear: [2, 1], not_recorded: [6, 3] });
    // 组队要求不计入材料负担（analyzeGaps 把它放在 materials 组里，这里不用那个组）。
    expect(digestNew(s).materials).toEqual({ none: [14, 7], one_or_two: [0, 0], three_or_more: [0, 0] });
    // 组队要求不改变可达性，也不是障碍行。
    expect(s.summary.reachable_now).toBe(7);
    expect(s.barrier_rows.map((r) => r.key)).toEqual(['time', 'cost', 'transport', 'device']);
    expectInvariants(s);
    expectNewPartInvariants(s);
  });

  it('材料负担：只数机会要求的（required_for_application 的材料准备项、硬性作品要求），建议项与组队不算；按 0 / 1–2 / 3+ 分档', () => {
    const oppM2 = makeOpp('o-m2', {
      required_devices: [],
      preparation: [
        prep('prep-resume'),
        prep('prep-essay', { material_kind: 'essay', required_for_application: false }), // 建议项：不算
        prep('prep-notes', { material_kind: 'other', required_for_application: false }), // 建议项：不算
        prep('prep-python', { material_kind: null, skill: 'python' }), // 必需，但不是材料
      ],
    });
    const oppM3 = makeOpp('o-m3', {
      required_devices: [],
      preparation: [prep('prep-resume'), prep('prep-transcript', { material_kind: 'transcript' }), prep('prep-statement', { material_kind: 'personal_statement' })],
      team_requirement: { required: true, min_size: 3, max_size: 3, source_text: 'Teams of exactly 3. (fictional)' },
    });
    const oppPortfolio = makeOpp('o-port', {
      required_devices: [],
      requirements: [
        req({ id: 'req-grade', type: 'grade', min: 9, max: 12 }),
        req({ id: 'req-work', type: 'portfolio', evidence_kind: 'project' }), // 硬性：算
        req({ id: 'req-bonus', type: 'portfolio', evidence_kind: 'recommendation_letter', hard: false }), // 偏好：不算
      ],
    });
    const s = summarizeBarriers(
      makeScenario({
        students: [
          makeStudent('s-new'),
          // 证据只覆盖 o-m3 的简历（带机会前缀，不覆盖 o-m2 的同名准备项）；种类不是 project，作品要求仍不满足。
          makeStudent('s-ready', { evidence: [evidence('ev-1', { prep_item_ids: ['o-m3:prep-resume'] })] }),
        ],
        opportunities: [makeOpp('o-m0', { required_devices: [] }), oppM2, oppM3, oppPortfolio, dupOpp()],
      }),
    );
    // s-new：0、1（建议项不算）、3（组队不算）、1、3；s-ready：0、1、2、1、3。o-port、o-dup 的作品要求是硬性 → 不符合资格。
    expect(digestNew(s).materials).toEqual({ none: [2, 2], one_or_two: [5, 3], three_or_more: [3, 1] });
    expect(digestNew(s).team.required).toEqual([2, 2]);
    expect(digestNew(s).detail.portfolio).toEqual([4, 0]);
    expectInvariants(s);
    expectNewPartInvariants(s);
  });

  it('材料负担：作品要求与能产出它的准备项算两条（引擎没有可靠的对应关系，不去重；说明里写明）', () => {
    const s = summarizeBarriers(makeScenario({ students: [makeStudent('s-new')], opportunities: [dupOpp()] }));
    // 去重的话是 2 条（1–2 档）；不去重是 3 条。
    expect(digestNew(s).materials).toEqual({ none: [0, 0], one_or_two: [0, 0], three_or_more: [1, 0] });
    expect(MATERIALS_BURDEN_NOTE).toContain('A work-sample requirement and the prep item that would produce it count as separate items.');
    expect(MATERIALS_BURDEN_NOTE).toContain('Recommended preparation is not counted.');
    expect(MATERIALS_BURDEN_NOTE).toContain('Time and cost of required prep already feed the Time and Cost rows.');
  });

  it.each(SCENARIOS.map((e) => ({ id: e.id, scenario: e.scenario })))('$id：新增四部分的不变量', ({ scenario }) => {
    expectNewPartInvariants(summarizeBarriers(scenario));
  });

  it('隐私：新增部分同样不含学生 id、姓名、学校、出生日期；只有人数与固定文字；不修改输入', () => {
    const scenario = makeScenario({
      students: [
        makeStudent('stu-zq-001', { display_name: 'Zebulon Quarry (fictional)', school_name: 'Quarry Ridge Academy (fictional)', birth_date: '2010-05-17', age: 16 }),
        makeStudent('stu-zq-002', { display_name: 'Ysolde Pemberly (fictional)', school_name: 'Pemberly Day School (fictional)', grade: null, birth_date: '2009-02-28' }),
      ],
      opportunities: [
        makeOpp('o-team', { required_devices: [], team_requirement: { required: true, source_text: 'Teams only. (fictional)' }, preparation: [prep('prep-resume')] }),
        makeOpp('o-age', { required_devices: [], location: { format: 'hybrid', country: 'US', state: 'CA' }, requirements: [req({ id: 'req-age', type: 'age', min: 18 })] }),
      ],
    });
    const before = structuredClone(scenario);
    const s = summarizeBarriers(scenario);
    const json = JSON.stringify(s);
    for (const st of scenario.students) {
      for (const text of [st.id, st.display_name, st.school_name!, st.birth_date!]) expect(json).not.toContain(text);
    }
    expectInvariants(s);
    expectNewPartInvariants(s);
    expect(scenario).toEqual(before);
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

  it('新增部分：每个场景都有资格明细、参与形式、组队要求与材料负担，组队与材料在「Other demands on students」下；小数字提醒保留', () => {
    const count = (needle: string) => html.split(needle).length - 1;
    expect(count('Eligibility detail by requirement type (pairs)')).toBe(SCENARIOS.length);
    expect(count('>Participation format (pairs)</caption>')).toBe(SCENARIOS.length);
    expect(count('>Other demands on students</h3>')).toBe(SCENARIOS.length);
    expect(count('>Team requirement (pairs)</caption>')).toBe(SCENARIOS.length);
    expect(count('>Required application materials still to prepare (pairs)</caption>')).toBe(SCENARIOS.length);
    // renderToStaticMarkup 把撇号转义成 &#x27;。
    for (const text of [OTHER_DEMANDS_NOTE, TEAM_REQUIREMENT_NOTE, MATERIALS_BURDEN_NOTE, PARTICIPATION_TRANSPORT_NOTE, PARTICIPATION_INTERNET_NOTE]) {
      expect(count(text.replace(/'/g, '&#x27;'))).toBe(SCENARIOS.length);
    }
    // 组队与材料表在障碍表之后（不混进障碍行）。
    const firstBarrier = html.indexOf('>Real-world barriers (pairs)</caption>');
    expect(html.indexOf('>Team requirement (pairs)</caption>')).toBeGreaterThan(firstBarrier);
    expect(html).not.toContain('no online option');
    expect(html).toContain('In person (per the listing)');
  });

  it('顶部说明框：保留小数字提醒原文，并另加一句：新增各表用于真实数据前同样需要小数字抑制', () => {
    const noteStart = html.indexOf('<div role="note"');
    const note = html.slice(noteStart, html.indexOf('</div>', noteStart));
    expect(note).toContain(`>${SENTENCE}</p>`);
    expect(note).toContain(
      'Counts here are small. With real data, small counts could identify individual students, so a real version would need a minimum group size before showing a number.',
    );
    expect(note).toContain('would also need small-count suppression');
    expect(note).toContain('counting pairs instead of people does not protect them');
  });
});

// ───────────────────────────── 新增表格组件（fixture 渲染） ─────────────────────────────

describe('app/organizer/barriers/detail-tables.tsx', () => {
  const src = readFileSync(fileURLToPath(new URL('../../app/organizer/barriers/detail-tables.tsx', import.meta.url)), 'utf8');
  const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

  it('不是客户端组件；不 import 场景数据、lib/data 或 JSON；不读学生字段', () => {
    expect(src).not.toMatch(/['"]use client['"]/);
    expect(src).not.toMatch(/from\s+['"][^'"]*(scenarios|lib\/data|\.json)['"]/);
    expect(src).not.toMatch(/\.students\b/);
    expect(src).not.toContain('display_name');
    expect(src).not.toContain('school_name');
  });

  it('资格明细表：有不符合 / 未知的对时渲染成表格（caption、th scope、按类型的人数与计数规则说明），不含学生信息', () => {
    const scenario = makeScenario({
      students: [makeStudent('stu-ok'), makeStudent('stu-young', { grade: 8 }), makeStudent('stu-nograde', { grade: null })],
      opportunities: [makeOpp('o1', { required_devices: [] })],
    });
    const html = render(createElement(EligibilityDetailTable, { summary: summarizeBarriers(scenario) }));
    expect(html).toMatch(/^<div[^>]*><table[^>]*><caption[^>]*>Eligibility detail by requirement type \(pairs\)<\/caption>/);
    expect(html).not.toContain('Every pair in this scenario is eligible.');
    expect(html.match(/<th scope="col"/g)).toHaveLength(3);
    expect(html.match(/<th scope="row"/g)).toHaveLength(ELIGIBILITY_DETAIL_ORDER.length);
    for (const t of ELIGIBILITY_DETAIL_ORDER) expect(html).toContain(`>${ELIGIBILITY_DETAIL_LABELS[t]}</th>`);
    expect(html).toMatch(/<th scope="row"[^>]*>Grade<\/th><td[^>]*>1<\/td><td[^>]*>1<\/td>/);
    expect(html).toMatch(/<th scope="row"[^>]*>Age<\/th><td[^>]*>0<\/td><td[^>]*>0<\/td>/);
    expect(html).toContain(ELIGIBILITY_DETAIL_NOTE);
    for (const st of scenario.students) {
      expect(html).not.toContain(st.id);
      expect(html).not.toContain(st.display_name);
    }
  });

  it('参与形式表：不适用的格子显示「—」并带读屏文字 not applicable', () => {
    const s = summarizeBarriers(makeScenario({ students: [makeStudent('stu-1')], opportunities: [makeOpp('o1', { required_devices: [] })] }));
    const html = render(createElement(ParticipationTable, { title: 'Fixture scenario', summary: s }));
    // online 行 2 格、in_person 行 2 格、unknown 行 4 格不适用；hybrid 行全部适用。
    expect(html.split('<span aria-hidden="true">—</span><span class="sr-only">not applicable</span>').length - 1).toBe(8);
    expect(html).toContain('aria-label="Participation format table for Fixture scenario (scrolls horizontally)"');
    expect(html).toContain('>Student transport not recorded or unreadable</th>');
  });

  it('其他要求：组队与必需材料两张表，带各自的说明', () => {
    const s = summarizeBarriers(makeScenario({ students: [makeStudent('stu-1')], opportunities: [dupOpp()] }));
    const html = render(createElement(OtherDemands, { summary: s }));
    expect(html).toContain('>Team requirement (pairs)</caption>');
    expect(html).toContain('>Required application materials still to prepare (pairs)</caption>');
    expect(html).toMatch(/<th scope="row"[^>]*>3 or more items<\/th><td[^>]*>1<\/td><td[^>]*>0<\/td>/);
    expect(html).toContain(MATERIALS_BURDEN_NOTE.replace(/'/g, '&#x27;'));
  });
});
