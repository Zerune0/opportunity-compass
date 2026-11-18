/**
 * diffRoutes(before, after) — 两次规划之间的变化和原因（第 2 层实现）。
 *
 * 规则：
 * - status_change：两边 status 不同才非空；blocked ↔ routes 时 reasons 引用 blocked 一侧的原因。
 * - route_changes：按 RouteType 对齐，顺序固定 learning_first、practice_first、community，
 *   只列至少一侧存在的类型；步骤按 id 对齐，算新增 / 移除 / 新跳过 / 不再跳过，以及小时、费用、是否来得及。
 *   任一侧不存在时 delta 为 null。路线对象有任何差异即为 changed（结构化深比较，不受对象键顺序影响）。
 * - 报名费「官网未写清 ↔ 有数字」按 FEE_UNKNOWN_WARNING 区分，不说成「从 $0 变为 …」。
 * - blocked → blocked：比较阻断集合、阻断说明和替代提示（kind + text）。
 * - reasons：面向学生、每条一句、说得出为什么变；同一步骤在多条路线上的同一变化合并成一句；
 *   完全没变化时给「两次规划没有变化」。比较对象（学生 / 机会）不一致时不抛错，在 reasons 里注明。
 * 纯函数、确定性、无 IO。
 */
import type { AlternativeHint, PlanResult, Route, RouteChange, RouteDiff, RouteStep, RouteType, StepChange } from '../types';
import { ROUTE_TYPES } from '../types';
import { FEE_UNKNOWN_WARNING, ROUTE_TITLES, SUBMIT_STEP_ID, deepEqual, fmt, round2, usd } from './shared';
import { joinAnd, plural, pluralNoun } from '../format';

const ALT_LABELS: Record<AlternativeHint['kind'], string> = {
  next_cycle: 'Watch for the next round',
  same_field: 'Same-field alternatives',
};

type StepEventKind = 'skipped' | 'unskipped' | 'added' | 'removed' | 'estimate';

interface StepEvent {
  kind: StepEventKind;
  title: string;
  detail: string;
  hours: number;
  cost: number;
  routes: RouteType[];
}

/** "the Learning first route" / "the Learning first and Community routes" */
function routesPhrase(types: RouteType[]): string {
  return `the ${joinAnd(types.map((t) => ROUTE_TITLES[t]))} ${pluralNoun(types.length, 'route')}`;
}

function lcFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function ucFirst(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * How the routes' totals move, as a full sentence, or '' when nothing moves:
 * "The Learning first route is 1 hour shorter." /
 * "The Learning first and Community routes are each 2 hours shorter and cost $10 less."
 */
function deltaSentence(types: RouteType[], hours: number, cost: number, dir: 'less' | 'more'): string {
  if (hours === 0 && cost === 0) return '';
  const many = types.length > 1;
  const parts: string[] = [];
  if (hours !== 0) {
    parts.push(`${many ? 'are each' : 'is'} ${plural(hours, 'hour')} ${dir === 'less' ? 'shorter' : 'longer'}`);
  }
  if (cost !== 0) {
    parts.push(`${many && parts.length === 0 ? 'each cost' : many ? 'cost' : 'costs'} ${usd(cost)} ${dir}`);
  }
  return `${ucFirst(routesPhrase(types))} ${parts.join(' and ')}.`;
}

function feasibleZh(v: boolean | null): string {
  return v === true ? 'on time' : v === false ? 'may not make it' : "can't tell";
}

function stripEnd(s: string): string {
  return s.replace(/[。.]$/, '');
}

function change(step: RouteStep, reason: string): StepChange {
  return { step_id: step.id, title: step.title, reason };
}

/** 两条同类型路线的步骤级比较。 */
function compareSteps(b: Route, a: Route) {
  const bSteps = new Map(b.steps.map((s) => [s.id, s]));
  const aSteps = new Map(a.steps.map((s) => [s.id, s]));
  const added_steps: StepChange[] = [];
  const removed_steps: StepChange[] = [];
  const newly_skipped_steps: StepChange[] = [];
  const unskipped_steps: StepChange[] = [];
  const estimateChanges: { step: RouteStep; before: RouteStep }[] = [];

  for (const s of a.steps) {
    const prev = bSteps.get(s.id);
    if (!prev) {
      added_steps.push(change(s, "The opportunity's prep items were updated, and this step was added"));
      continue;
    }
    if (s.skipped && !prev.skipped) {
      newly_skipped_steps.push(change(s, s.skip_reason ?? 'Already covered by your evidence'));
    } else if (!s.skipped && prev.skipped) {
      unskipped_steps.push(
        change(s, `Before: ${prev.skip_reason ?? 'already covered by your evidence'}. Now that evidence no longer covers this step (it may have been deleted or changed)`),
      );
    }
    if (s.hours !== prev.hours || s.cost_usd !== prev.cost_usd) estimateChanges.push({ step: s, before: prev });
  }
  for (const s of b.steps) {
    if (!aSteps.has(s.id)) removed_steps.push(change(s, "The opportunity's prep items were updated, and this step is no longer needed"));
  }
  return { added_steps, removed_steps, newly_skipped_steps, unskipped_steps, estimateChanges, bSteps };
}

export function diffRoutes(before: PlanResult, after: PlanResult): RouteDiff {
  const reasons: string[] = [];
  const push = (r: string) => {
    if (!reasons.includes(r)) reasons.push(r);
  };

  if (before.profile_id !== after.profile_id || before.opportunity_id !== after.opportunity_id) {
    const what: string[] = [];
    if (before.profile_id !== after.profile_id) what.push('student profile');
    if (before.opportunity_id !== after.opportunity_id) what.push('opportunity');
    push(`Note: the two plans are for a different ${what.join(' and ')}, so the differences below are not only from profile updates. Read them with care.`);
  }

  // ── 状态变化 ──
  const status_change = before.status === after.status ? null : { from: before.status, to: after.status };
  if (before.status === 'blocked' && after.status === 'routes') {
    const labels = before.blocking_requirements.map((b) => `"${b.label}"`).join(', ');
    push(
      `Before, we couldn't plan because you didn't meet the hard ${pluralNoun(before.blocking_requirements.length, 'requirement')} ${labels} (${before.reasons.map(stripEnd).join('; ')}). Now ${before.blocking_requirements.length === 1 ? 'that requirement is' : 'those requirements are'} no longer marked as not met, so here ${after.routes.length === 1 ? 'is' : 'are'} ${plural(after.routes.length, 'route')}.`,
    );
  } else if (before.status === 'routes' && after.status === 'blocked') {
    push(
      `We can't plan routes now: ${after.reasons.map(stripEnd).join('; ')}. The ${plural(before.routes.length, 'earlier route')} no longer ${before.routes.length === 1 ? 'applies' : 'apply'}, and we don't offer routes that get around the requirements.`,
    );
  } else if (before.status === 'blocked' && after.status === 'blocked') {
    const bIds = new Set(before.blocking_requirements.map((i) => i.requirement_id));
    const aIds = new Set(after.blocking_requirements.map((i) => i.requirement_id));
    after.blocking_requirements.forEach((item, idx) => {
      if (!bIds.has(item.requirement_id)) push(`New blocker: ${stripEnd(after.reasons[idx] ?? item.label)}.`);
    });
    for (const item of before.blocking_requirements) {
      if (!aIds.has(item.requirement_id)) {
        push(`"${item.label}" no longer blocks you, but other hard requirements are still not met, so we still can't plan routes.`);
      }
    }
    // 阻断集合不变、但同一要求的说明有更新（如官网原文或判断说明变了）。
    const sameSet = bIds.size === aIds.size && [...aIds].every((id) => bIds.has(id));
    if (sameSet && !deepEqual(before.reasons, after.reasons)) {
      push('The blocking requirements are the same, but the explanation was updated (your profile or the opportunity data may have changed). Go by the current explanation.');
    }
    // 替代提示变化（kind + text 比较）。
    for (const alt of after.alternatives) {
      const prev = before.alternatives.find((x) => x.kind === alt.kind);
      if (!prev) push(`New alternative "${ALT_LABELS[alt.kind]}": ${stripEnd(alt.text)}.`);
      else if (prev.text !== alt.text) push(`Alternative "${ALT_LABELS[alt.kind]}" was updated: ${stripEnd(alt.text)}.`);
    }
    for (const alt of before.alternatives) {
      if (after.alternatives.some((x) => x.kind === alt.kind)) continue;
      push(
        alt.kind === 'next_cycle'
          ? 'The "Watch for the next round" hint is gone: the current blocker will not go away as you move up a grade / get older, or the opportunity is no longer known to run every year.'
          : `The alternative "${ALT_LABELS[alt.kind]}" is gone (the opportunity's field info changed).`,
      );
    }
  }

  // ── 整体提醒变化（两边都有路线时） ──
  if (before.status === 'routes' && after.status === 'routes') {
    for (const w of after.warnings) if (!before.warnings.includes(w)) push(`New overall note: ${stripEnd(w)}.`);
    for (const w of before.warnings) if (!after.warnings.includes(w)) push(`This overall note is gone: ${stripEnd(w)}.`);
  }

  // ── 路线对齐 ──
  const route_changes: RouteChange[] = [];
  const events = new Map<string, StepEvent>();
  const addEvent = (key: string, ev: Omit<StepEvent, 'routes'>, type: RouteType) => {
    const existing = events.get(key);
    if (existing) {
      if (!existing.routes.includes(type)) existing.routes.push(type);
    } else {
      events.set(key, { ...ev, routes: [type] });
    }
  };
  const feasibleGroups = new Map<string, RouteType[]>();
  const weeksGroups = new Map<string, RouteType[]>();
  const budgetAppeared = new Map<string, RouteType[]>();
  const budgetGone: RouteType[] = [];
  const orderChanged: RouteType[] = [];
  const unexplained: RouteType[] = [];
  const warningGroups = new Map<string, RouteType[]>();
  const bothRoutes = before.status === 'routes' && after.status === 'routes';

  for (const type of ROUTE_TYPES) {
    const b = before.routes.find((r) => r.type === type);
    const a = after.routes.find((r) => r.type === type);
    if (!b && !a) continue;

    const hours_before = b?.total_hours ?? null;
    const hours_after = a?.total_hours ?? null;
    const base: RouteChange = {
      route_type: type,
      change: 'unchanged',
      added_steps: [],
      removed_steps: [],
      newly_skipped_steps: [],
      unskipped_steps: [],
      hours_before,
      hours_after,
      hours_delta: b && a ? round2(a.total_hours - b.total_hours) : null,
      cost_delta_usd: b && a ? round2(a.total_cost_usd - b.total_cost_usd) : null,
      feasible_before: b?.feasible_by_deadline ?? null,
      feasible_after: a?.feasible_by_deadline ?? null,
    };

    if (!b || !a) {
      base.change = b ? 'removed' : 'added';
      route_changes.push(base);
      if (bothRoutes && type === 'practice_first') {
        push(
          a
            ? 'New Practice first route: there are now hands-on prep items (projects, portfolio, etc.) not yet covered by your evidence, so you can start by building.'
            : 'The Practice first route is gone: all hands-on prep items (projects, portfolio, etc.) are covered by your evidence or no longer needed, so the other routes are enough.',
        );
      } else if (bothRoutes) {
        push(`The ${ROUTE_TITLES[type]} route ${a ? 'is new' : 'is gone'}.`);
      }
      continue;
    }

    const cmp = compareSteps(b, a);
    base.added_steps = cmp.added_steps;
    base.removed_steps = cmp.removed_steps;
    base.newly_skipped_steps = cmp.newly_skipped_steps;
    base.unskipped_steps = cmp.unskipped_steps;
    const differs = !deepEqual(b, a);
    base.change = differs ? 'changed' : 'unchanged';
    route_changes.push(base);
    if (!differs) continue;

    let explained = false;
    for (const s of a.steps) {
      const prev = cmp.bSteps.get(s.id);
      if (prev && s.skipped && !prev.skipped) {
        addEvent(`skipped:${s.id}:${s.skip_reason}`, { kind: 'skipped', title: s.title, detail: s.skip_reason ?? 'Already covered by your evidence', hours: s.hours, cost: s.cost_usd }, type);
        explained = true;
      } else if (prev && !s.skipped && prev.skipped) {
        addEvent(`unskipped:${s.id}:${prev.skip_reason}`, { kind: 'unskipped', title: s.title, detail: prev.skip_reason ?? 'already covered by your evidence', hours: s.hours, cost: s.cost_usd }, type);
        explained = true;
      }
    }
    for (const c of cmp.added_steps) {
      const s = a.steps.find((x) => x.id === c.step_id) as RouteStep;
      addEvent(`added:${s.id}`, { kind: 'added', title: s.title, detail: '', hours: s.skipped ? 0 : s.hours, cost: s.skipped ? 0 : s.cost_usd }, type);
      explained = true;
    }
    for (const c of cmp.removed_steps) {
      const s = b.steps.find((x) => x.id === c.step_id) as RouteStep;
      addEvent(`removed:${s.id}`, { kind: 'removed', title: s.title, detail: '', hours: s.skipped ? 0 : s.hours, cost: s.skipped ? 0 : s.cost_usd }, type);
      explained = true;
    }
    // 报名费「官网未写清」↔「有数字」：未写清时费用记为 0 只是占位，不能说成「从 $0 变为 $25」。
    const bFeeUnknown = b.warnings.includes(FEE_UNKNOWN_WARNING);
    const aFeeUnknown = a.warnings.includes(FEE_UNKNOWN_WARNING);
    const feeStatusChanged = bFeeUnknown !== aFeeUnknown;
    for (const { step, before: prev } of cmp.estimateChanges) {
      if (step.id === SUBMIT_STEP_ID && feeStatusChanged) continue;
      const detail =
        step.id === SUBMIT_STEP_ID
          ? `application fee changed from ${usd(prev.cost_usd)} to ${usd(step.cost_usd)}`
          : `estimate changed from ${plural(prev.hours, 'hour')}, ${usd(prev.cost_usd)} to ${plural(step.hours, 'hour')}, ${usd(step.cost_usd)}`;
      addEvent(`estimate:${step.id}:${detail}`, { kind: 'estimate', title: step.title, detail, hours: 0, cost: 0 }, type);
      explained = true;
    }
    if (feeStatusChanged) {
      const aSubmit = a.steps.find((s) => s.id === SUBMIT_STEP_ID);
      const bSubmit = cmp.bSteps.get(SUBMIT_STEP_ID);
      const detail = bFeeUnknown
        ? `application fee changed from not clear on the official site to ${usd(aSubmit?.cost_usd ?? 0)}`
        : `application fee changed from ${usd(bSubmit?.cost_usd ?? 0)} to not clear on the official site (not counted in the cost; confirm with the organizer)`;
      addEvent(`estimate:${SUBMIT_STEP_ID}:${detail}`, { kind: 'estimate', title: aSubmit?.title ?? 'Submit application', detail, hours: 0, cost: 0 }, type);
      explained = true;
    }

    const sameSet = a.steps.length === b.steps.length && a.steps.every((s) => cmp.bSteps.has(s.id));
    if (sameSet && a.steps.some((s, i) => s.id !== b.steps[i].id)) {
      orderChanged.push(type);
      explained = true;
    }

    if (a.feasible_by_deadline !== b.feasible_by_deadline) {
      const cause =
        a.total_hours !== b.total_hours
          ? `hours needed changed from ${fmt(b.total_hours)} to ${fmt(a.total_hours)}`
          : 'hours needed did not change; your weekly hours or the dates changed';
      const key = `finishing before the deadline changed from "${feasibleZh(b.feasible_by_deadline)}" to "${feasibleZh(a.feasible_by_deadline)}" (${cause})`;
      feasibleGroups.set(key, [...(feasibleGroups.get(key) ?? []), type]);
      explained = true;
    }
    if (a.estimated_weeks !== b.estimated_weeks && a.total_hours === b.total_hours) {
      const key = `estimated weeks changed from ${b.estimated_weeks ?? "can't estimate"} to ${a.estimated_weeks ?? "can't estimate"} (your weekly hours changed)`;
      weeksGroups.set(key, [...(weeksGroups.get(key) ?? []), type]);
      explained = true;
    }
    const bBudget = b.warnings.find((w) => w.startsWith('Over budget'));
    const aBudget = a.warnings.find((w) => w.startsWith('Over budget'));
    if (aBudget && aBudget !== bBudget) {
      budgetAppeared.set(aBudget, [...(budgetAppeared.get(aBudget) ?? []), type]);
      explained = true;
    } else if (bBudget && !aBudget) {
      budgetGone.push(type);
      explained = true;
    }
    if (!explained) {
      // 步骤和可行性都没变，只是说明 / 提醒文字不同：列出具体提醒变化；没有提醒变化时用中性说法。
      let any = false;
      for (const w of a.warnings) {
        if (b.warnings.includes(w)) continue;
        const key = `new note: ${stripEnd(w)}`;
        warningGroups.set(key, [...(warningGroups.get(key) ?? []), type]);
        any = true;
      }
      for (const w of b.warnings) {
        if (a.warnings.includes(w)) continue;
        const key = `this note is gone: ${stripEnd(w)}`;
        warningGroups.set(key, [...(warningGroups.get(key) ?? []), type]);
        any = true;
      }
      if (!any) unexplained.push(type);
    }
  }

  // ── 步骤级原因（同一步骤跨路线合并） ──
  for (const ev of events.values()) {
    const affects = `Affects ${routesPhrase(ev.routes)}.`;
    switch (ev.kind) {
      case 'skipped':
        push(`The step "${ev.title}" is now skipped: ${ev.detail}. ${deltaSentence(ev.routes, ev.hours, ev.cost, 'less') || affects}`);
        break;
      case 'unskipped': {
        const delta = deltaSentence(ev.routes, ev.hours, ev.cost, 'more');
        push(`The step "${ev.title}" is no longer skipped: before, it was ${lcFirst(ev.detail)}; now that evidence no longer covers this step (it may have been deleted or changed).${delta ? ` ${delta}` : ''}`);
        break;
      }
      case 'added':
        push(`New step "${ev.title}": the opportunity's prep items were updated. ${deltaSentence(ev.routes, ev.hours, ev.cost, 'more') || affects}`);
        break;
      case 'removed':
        push(`The step "${ev.title}" is no longer needed: the opportunity's prep items were updated. ${deltaSentence(ev.routes, ev.hours, ev.cost, 'less') || affects}`);
        break;
      case 'estimate':
        push(`"${ev.title}": ${ev.detail} (the opportunity data was updated). ${affects}`);
        break;
    }
  }
  const forRoutes = (types: RouteType[], text: string) => push(`For ${routesPhrase(types)}: ${lcFirst(text)}.`);
  for (const [text, types] of feasibleGroups) forRoutes(types, text);
  for (const [text, types] of weeksGroups) forRoutes(types, text);
  for (const [text, types] of budgetAppeared) forRoutes(types, stripEnd(text));
  if (budgetGone.length > 0) forRoutes(budgetGone, 'no longer over budget');
  if (orderChanged.length > 0) forRoutes(orderChanged, "the step order changed (the opportunity's dependencies were updated)");
  for (const [text, types] of warningGroups) forRoutes(types, text);
  if (unexplained.length > 0) {
    push(`For ${routesPhrase(unexplained)}: the explanation or notes were updated (your profile, the dates or the opportunity data may have changed). Go by the current route details.`);
  }

  if (reasons.length === 0 || (reasons.length === 1 && reasons[0].startsWith('Note:') && status_change === null && route_changes.every((c) => c.change === 'unchanged'))) {
    push('Nothing changed between the two plans.');
  }

  return { status_change, route_changes, reasons };
}
