/**
 * MOCK — 第 2 层替换（周四 20:00 前，主导）。
 *
 * planRoutes(profile, opp, options?)：给出 2–3 条路线（学习优先 / 实践优先 / 社区协作），
 *   硬性资格不满足时返回 status = 'blocked'，不生成绕过路线，只给原因和替代提示。
 * diffRoutes(before, after)：两次规划之间的变化和原因。
 *
 * 当前 mock：三条路线都直接用机会的准备项（按数组顺序），已有证据覆盖的步骤标为跳过；
 *   不检查依赖排序、预算和截止日期（feasible_by_deadline 固定为 null）。
 *   diffRoutes 只按步骤 id 做简单比较。
 * 签名与最终版一致，之后只替换实现。纯函数、确定性、无 IO。
 */
import { checkEligibility } from '../eligibility';
import type {
  EvalOptions,
  Opportunity,
  PlanResult,
  Route,
  RouteChange,
  RouteDiff,
  RouteStep,
  RouteType,
  StepChange,
  StudentProfile,
} from '../types';
import { ROUTE_TYPES } from '../types';

const ROUTE_TITLES: Record<RouteType, string> = {
  learning_first: '学习优先',
  practice_first: '实践优先',
  community: '社区协作',
};

export function planRoutes(
  profile: StudentProfile,
  opp: Opportunity,
  options?: EvalOptions,
): PlanResult {
  // MOCK 阶段只把 options 原样传给 checkEligibility，不检查截止日期（第 2 层实现）。
  const eligibility = checkEligibility(profile, opp, options);
  const blocking = eligibility.items.filter((i) => i.hard && i.status === 'not_satisfied');
  if (blocking.length > 0) {
    return {
      status: 'blocked',
      profile_id: profile.id,
      opportunity_id: opp.id,
      routes: [],
      blocking_requirements: blocking,
      reasons: blocking.map((b) => `（MOCK）不满足硬性要求：${b.label}`),
      alternatives: [{ kind: 'next_cycle', text: '（MOCK）可关注下一届。' }],
    };
  }

  const baseSteps: RouteStep[] = opp.preparation.map((prep) => {
    const covering = profile.evidence.filter(
      (e) =>
        e.prep_item_ids?.includes(prep.id) ||
        e.prep_item_ids?.includes(`${opp.id}:${prep.id}`) ||
        (prep.skill != null && e.skills.includes(prep.skill)),
    );
    const skipped = covering.length > 0;
    return {
      id: prep.id,
      title: prep.title,
      prep_item_id: prep.id,
      depends_on: [...prep.depends_on],
      hours: prep.estimated_hours,
      cost_usd: prep.estimated_cost_usd,
      skipped,
      skip_reason: skipped ? `（MOCK）已有证据「${covering[0].title}」` : null,
      satisfied_by_evidence_ids: covering.map((e) => e.id),
    };
  });

  const routes: Route[] = ROUTE_TYPES.map((type) => {
    const steps = baseSteps.map((s) => ({ ...s, depends_on: [...s.depends_on] }));
    const active = steps.filter((s) => !s.skipped);
    return {
      id: `${opp.id}:${type}`,
      type,
      title: ROUTE_TITLES[type],
      steps,
      total_hours: active.reduce((sum, s) => sum + s.hours, 0),
      total_cost_usd: active.reduce((sum, s) => sum + s.cost_usd, 0),
      estimated_weeks: null,
      feasible_by_deadline: null,
      rationale: `（MOCK）${ROUTE_TITLES[type]}路线示意，尚未按学生条件排序和校验。`,
      warnings: [],
    };
  });

  return {
    status: 'routes',
    profile_id: profile.id,
    opportunity_id: opp.id,
    routes,
    warnings:
      eligibility.overall === 'unknown' ? ['（MOCK）资格未确认，请先对照官网原文确认。'] : [],
  };
}

function toChange(step: RouteStep, reason: string): StepChange {
  return { step_id: step.id, title: step.title, reason };
}

export function diffRoutes(before: PlanResult, after: PlanResult): RouteDiff {
  const reasons: string[] = [];
  const status_change =
    before.status === after.status ? null : { from: before.status, to: after.status };
  if (status_change) reasons.push(`（MOCK）规划状态从 ${status_change.from} 变为 ${status_change.to}。`);

  const route_changes: RouteChange[] = [];
  for (const type of ROUTE_TYPES) {
    const b = before.routes.find((r) => r.type === type);
    const a = after.routes.find((r) => r.type === type);
    if (!b && !a) continue;

    const bSteps = new Map((b?.steps ?? []).map((s) => [s.id, s]));
    const aSteps = new Map((a?.steps ?? []).map((s) => [s.id, s]));
    const added_steps = [...aSteps.values()]
      .filter((s) => !bSteps.has(s.id))
      .map((s) => toChange(s, '（MOCK）新增步骤'));
    const removed_steps = [...bSteps.values()]
      .filter((s) => !aSteps.has(s.id))
      .map((s) => toChange(s, '（MOCK）移除步骤'));
    const newly_skipped_steps = [...aSteps.values()]
      .filter((s) => s.skipped && bSteps.get(s.id)?.skipped === false)
      .map((s) => toChange(s, s.skip_reason ?? '（MOCK）已有证据'));
    const unskipped_steps = [...aSteps.values()]
      .filter((s) => !s.skipped && bSteps.get(s.id)?.skipped === true)
      .map((s) => toChange(s, '（MOCK）对应证据已不再适用'));

    const hours_before = b?.total_hours ?? null;
    const hours_after = a?.total_hours ?? null;
    const cost_before = b?.total_cost_usd ?? null;
    const cost_after = a?.total_cost_usd ?? null;
    const anyStepChange =
      added_steps.length + removed_steps.length + newly_skipped_steps.length + unskipped_steps.length > 0;

    route_changes.push({
      route_type: type,
      change: !b ? 'added' : !a ? 'removed' : anyStepChange ? 'changed' : 'unchanged',
      added_steps,
      removed_steps,
      newly_skipped_steps,
      unskipped_steps,
      hours_before,
      hours_after,
      hours_delta: hours_before != null && hours_after != null ? hours_after - hours_before : null,
      cost_delta_usd: cost_before != null && cost_after != null ? cost_after - cost_before : null,
      feasible_before: b?.feasible_by_deadline ?? null,
      feasible_after: a?.feasible_by_deadline ?? null,
    });

    for (const s of newly_skipped_steps) {
      reasons.push(`（MOCK）${ROUTE_TITLES[type]}：跳过「${s.title}」，因为${s.reason}。`);
    }
  }

  if (reasons.length === 0) reasons.push('（MOCK）两次规划没有变化。');
  return { status_change, route_changes, reasons };
}
