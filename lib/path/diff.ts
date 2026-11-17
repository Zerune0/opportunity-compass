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

const ALT_LABELS: Record<AlternativeHint['kind'], string> = {
  next_cycle: '关注下一届',
  same_field: '同领域替代',
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

function routeList(types: RouteType[]): string {
  return types.map((t) => ROUTE_TITLES[t]).join('、');
}

function each(types: RouteType[]): string {
  return types.length > 1 ? '各' : '';
}

function amountText(hours: number, cost: number): string {
  const parts: string[] = [];
  if (hours !== 0) parts.push(`${fmt(hours)} 小时`);
  if (cost !== 0) parts.push(usd(cost));
  return parts.join('、');
}

function feasibleZh(v: boolean | null): string {
  return v === true ? '来得及' : v === false ? '可能来不及' : '无法判断';
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
      added_steps.push(change(s, '机会的准备项有更新，新增了这一步'));
      continue;
    }
    if (s.skipped && !prev.skipped) {
      newly_skipped_steps.push(change(s, s.skip_reason ?? '已有证据覆盖这一项'));
    } else if (!s.skipped && prev.skipped) {
      unskipped_steps.push(
        change(s, `之前${prev.skip_reason ?? '已有证据覆盖'}，现在对应的证据不再覆盖这一项（可能被删除或修改了）`),
      );
    }
    if (s.hours !== prev.hours || s.cost_usd !== prev.cost_usd) estimateChanges.push({ step: s, before: prev });
  }
  for (const s of b.steps) {
    if (!aSteps.has(s.id)) removed_steps.push(change(s, '机会的准备项有更新，这一步不再需要'));
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
    if (before.profile_id !== after.profile_id) what.push('学生档案');
    if (before.opportunity_id !== after.opportunity_id) what.push('机会');
    push(`注意：两次规划的${what.join('和')}不是同一个，下面的差异不只是档案更新造成的，请谨慎解读。`);
  }

  // ── 状态变化 ──
  const status_change = before.status === after.status ? null : { from: before.status, to: after.status };
  if (before.status === 'blocked' && after.status === 'routes') {
    const labels = before.blocking_requirements.map((b) => `「${b.label}」`).join('、');
    push(
      `之前因为不满足硬性要求${labels}而无法规划（${before.reasons.map(stripEnd).join('；')}）；现在这些要求不再判定为不满足，所以给出了 ${after.routes.length} 条路线。`,
    );
  } else if (before.status === 'routes' && after.status === 'blocked') {
    push(
      `现在无法规划路线：${after.reasons.map(stripEnd).join('；')}。之前的 ${before.routes.length} 条路线不再适用，也不提供绕过要求的路线。`,
    );
  } else if (before.status === 'blocked' && after.status === 'blocked') {
    const bIds = new Set(before.blocking_requirements.map((i) => i.requirement_id));
    const aIds = new Set(after.blocking_requirements.map((i) => i.requirement_id));
    after.blocking_requirements.forEach((item, idx) => {
      if (!bIds.has(item.requirement_id)) push(`新增阻断：${stripEnd(after.reasons[idx] ?? item.label)}。`);
    });
    for (const item of before.blocking_requirements) {
      if (!aIds.has(item.requirement_id)) {
        push(`「${item.label}」已不再阻断，但仍有其他硬性要求不满足，所以还是无法规划路线。`);
      }
    }
    // 阻断集合不变、但同一要求的说明有更新（如官网原文或判断说明变了）。
    const sameSet = bIds.size === aIds.size && [...aIds].every((id) => bIds.has(id));
    if (sameSet && !deepEqual(before.reasons, after.reasons)) {
      push('阻断的要求没变，但阻断原因的说明有更新（可能是档案或机会数据有变化），请以现在的说明为准。');
    }
    // 替代提示变化（kind + text 比较）。
    for (const alt of after.alternatives) {
      const prev = before.alternatives.find((x) => x.kind === alt.kind);
      if (!prev) push(`新增替代提示「${ALT_LABELS[alt.kind]}」：${stripEnd(alt.text)}。`);
      else if (prev.text !== alt.text) push(`替代提示「${ALT_LABELS[alt.kind]}」有更新：${stripEnd(alt.text)}。`);
    }
    for (const alt of before.alternatives) {
      if (after.alternatives.some((x) => x.kind === alt.kind)) continue;
      push(
        alt.kind === 'next_cycle'
          ? '「关注下一届」的提示不再出现：现在的阻断不会随年级 / 年龄增长而解除，或机会不再确定每年举办。'
          : `替代提示「${ALT_LABELS[alt.kind]}」不再出现（机会的领域信息有变化）。`,
      );
    }
  }

  // ── 整体提醒变化（两边都有路线时） ──
  if (before.status === 'routes' && after.status === 'routes') {
    for (const w of after.warnings) if (!before.warnings.includes(w)) push(`新的整体提醒：${stripEnd(w)}。`);
    for (const w of before.warnings) if (!after.warnings.includes(w)) push(`这条整体提醒已不再出现：${stripEnd(w)}。`);
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
            ? '新出现实践优先路线：现在有尚未被证据覆盖的实践类准备项（项目、作品等），可以先动手做。'
            : '实践优先路线不再出现：实践类准备项（项目、作品等）都已被证据覆盖或不再需要，剩下的路线已足够。',
        );
      } else if (bothRoutes) {
        push(`${ROUTE_TITLES[type]}路线${a ? '新出现' : '不再出现'}。`);
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
        addEvent(`skipped:${s.id}:${s.skip_reason}`, { kind: 'skipped', title: s.title, detail: s.skip_reason ?? '已有证据覆盖这一项', hours: s.hours, cost: s.cost_usd }, type);
        explained = true;
      } else if (prev && !s.skipped && prev.skipped) {
        addEvent(`unskipped:${s.id}:${prev.skip_reason}`, { kind: 'unskipped', title: s.title, detail: prev.skip_reason ?? '已有证据覆盖', hours: s.hours, cost: s.cost_usd }, type);
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
          ? `报名费从 ${usd(prev.cost_usd)} 变为 ${usd(step.cost_usd)}`
          : `预估从 ${fmt(prev.hours)} 小时、${usd(prev.cost_usd)} 变为 ${fmt(step.hours)} 小时、${usd(step.cost_usd)}`;
      addEvent(`estimate:${step.id}:${detail}`, { kind: 'estimate', title: step.title, detail, hours: 0, cost: 0 }, type);
      explained = true;
    }
    if (feeStatusChanged) {
      const aSubmit = a.steps.find((s) => s.id === SUBMIT_STEP_ID);
      const bSubmit = cmp.bSteps.get(SUBMIT_STEP_ID);
      const detail = bFeeUnknown
        ? `报名费从官网未写清变为 ${usd(aSubmit?.cost_usd ?? 0)}`
        : `报名费从 ${usd(bSubmit?.cost_usd ?? 0)} 变为官网未写清（未计入费用，请向官方确认）`;
      addEvent(`estimate:${SUBMIT_STEP_ID}:${detail}`, { kind: 'estimate', title: aSubmit?.title ?? '提交申请', detail, hours: 0, cost: 0 }, type);
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
          ? `所需小时数从 ${fmt(b.total_hours)} 变为 ${fmt(a.total_hours)}`
          : '所需小时数没变，是每周可用小时或日期信息有变化';
      const key = `能否在截止日期前完成：从「${feasibleZh(b.feasible_by_deadline)}」变为「${feasibleZh(a.feasible_by_deadline)}」（${cause}）`;
      feasibleGroups.set(key, [...(feasibleGroups.get(key) ?? []), type]);
      explained = true;
    }
    if (a.estimated_weeks !== b.estimated_weeks && a.total_hours === b.total_hours) {
      const key = `预计周数从 ${b.estimated_weeks ?? '无法估算'} 变为 ${a.estimated_weeks ?? '无法估算'}（每周可用小时有变化）`;
      weeksGroups.set(key, [...(weeksGroups.get(key) ?? []), type]);
      explained = true;
    }
    const bBudget = b.warnings.find((w) => w.startsWith('超出预算'));
    const aBudget = a.warnings.find((w) => w.startsWith('超出预算'));
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
        const key = `新的提醒：${stripEnd(w)}`;
        warningGroups.set(key, [...(warningGroups.get(key) ?? []), type]);
        any = true;
      }
      for (const w of b.warnings) {
        if (a.warnings.includes(w)) continue;
        const key = `这条提醒已不再出现：${stripEnd(w)}`;
        warningGroups.set(key, [...(warningGroups.get(key) ?? []), type]);
        any = true;
      }
      if (!any) unexplained.push(type);
    }
  }

  // ── 步骤级原因（同一步骤跨路线合并） ──
  for (const ev of events.values()) {
    const rl = routeList(ev.routes);
    const amt = amountText(ev.hours, ev.cost);
    switch (ev.kind) {
      case 'skipped':
        push(`「${ev.title}」这一步现在被跳过：${ev.detail}。${amt ? `${rl}路线${each(ev.routes)}少 ${amt}。` : `涉及${rl}路线。`}`);
        break;
      case 'unskipped':
        push(`「${ev.title}」这一步不再被跳过：之前${ev.detail}，现在对应的证据不再覆盖这一项（可能被删除或修改了）。${amt ? `${rl}路线${each(ev.routes)}多 ${amt}。` : ''}`);
        break;
      case 'added':
        push(`新增步骤「${ev.title}」：机会的准备项有更新。${amt ? `${rl}路线${each(ev.routes)}多 ${amt}。` : `涉及${rl}路线。`}`);
        break;
      case 'removed':
        push(`步骤「${ev.title}」不再需要：机会的准备项有更新。${amt ? `${rl}路线${each(ev.routes)}少 ${amt}。` : `涉及${rl}路线。`}`);
        break;
      case 'estimate':
        push(`「${ev.title}」的${ev.detail}（机会数据有更新），涉及${rl}路线。`);
        break;
    }
  }
  for (const [text, types] of feasibleGroups) push(`${routeList(types)}路线${text}。`);
  for (const [text, types] of weeksGroups) push(`${routeList(types)}路线${text}。`);
  for (const [text, types] of budgetAppeared) push(`${routeList(types)}路线${stripEnd(text)}。`);
  if (budgetGone.length > 0) push(`${routeList(budgetGone)}路线不再超出预算。`);
  if (orderChanged.length > 0) push(`${routeList(orderChanged)}路线的步骤顺序有调整（机会的依赖关系有更新）。`);
  for (const [text, types] of warningGroups) push(`${routeList(types)}路线${text}。`);
  if (unexplained.length > 0) {
    push(`${routeList(unexplained)}路线的说明或提醒有更新（可能是档案、日期或机会数据有变化），请以现在的路线说明为准。`);
  }

  if (reasons.length === 0 || (reasons.length === 1 && reasons[0].startsWith('注意：') && status_change === null && route_changes.every((c) => c.change === 'unchanged'))) {
    push('两次规划没有变化。');
  }

  return { status_change, route_changes, reasons };
}
