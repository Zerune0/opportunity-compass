/**
 * planAcrossOpportunities(profile, opps, options?) — 多个机会一起排期（CrossPlan）。
 * 只把数字摆出来，不替学生决定放弃哪个机会。
 *
 * PHASE 2 SAMPLE VERSION — replaced in layer 1 / 2
 * 示例版本：签名与返回形状和最终版一致，内容简化但如实。
 *
 * 示例版本实际做的：
 * 1. 机会去重（同 id 只取第一条；非对象 / 无 id 的跳过并写进 warnings）。每个机会调用 planRoutes：
 *    - blocked → status 'blocked'、小时为 0、route_type null，note 用 planRoutes 的第一条原因；
 *    - 否则若按 options.today 截止日期已过 → status 'past_deadline'、小时为 0、route_type null；
 *    - 否则 'planned'：取第一条路线（learning_first），hours_before_reuse = 它未跳过步骤的小时合计（= route.total_hours），
 *      feasible_alone = 该路线的 feasible_by_deadline；
 *    - planRoutes 因数据不完整抛错 → 不列入 items，写进 warnings 与 missing_info（`opportunity.<id>`）。
 * 2. order：按截止日期升序（无截止日期 / 无法解析的排最后），同日期按输入顺序；items 按 order 排列。
 * 3. 材料复用（只看 planned 机会第一条路线里未跳过、且对应 PrepItem.material_kind 非空的步骤）：
 *    - reusable_across_opportunities === true 的同类材料被 ≥ 2 个机会用到 → 一条 reusable: true 的 MaterialReuse：
 *      hours_each = 各机会该材料小时的最大值；hours_saved = 各机会之和 − hours_each；
 *      这份材料只算在 order 最靠前的那个机会上（按 hours_each 计），其他机会的 required_hours 减去自己那份；
 *    - 其余（不可复用 / 未标明）的同类材料被 ≥ 2 个机会用到 → 一条 reusable: false、hours_saved 0 的说明。
 * 4. weekly_load：需要 options.today。每个 planned 机会的 required_hours 在「today 所在周的周一」到「截止日期所在周」
 *    之间按周平均摊开；没有截止日期（或无法解析）的机会不进 weekly_load，并写进 missing_info（`opportunity.<id>.deadline`）。
 *    hours_available = profile.hours_per_week_available（没填为 null，over 也为 null，并写进 missing_info）；
 *    超出的周 over: true，并生成一条 conflicts 文字；若学生给了 options.priorities，再说明「只保留前几个优先项时
 *    那一周需要多少小时」，只做对照，不替学生取舍。
 * 5. total_hours / total_hours_without_reuse 只算 planned 的机会。
 *
 * 与最终版相比省略了：
 * - 只按 learning_first 路线（含建议项）计小时，不在多条路线之间挑选，也不区分「只做必需项」的最低负荷；
 * - 每周负荷是平均摊开的粗略估计，不考虑步骤依赖顺序、参与期本身的每周投入（time_commitment）与考试周等；
 * - 材料复用只按 material_kind 粗分（同类即视为同一份），不看材料内容是否真能通用；
 * - 冲突说明里的「只保留优先项」只按周计算，不给跨周的整体方案。
 *
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO、不调 AI。
 * 永不抛异常。
 */
import { checkEligibility } from '../eligibility';
import { dayNumber, parseISODate } from '../eligibility/dates';
import { fmt, plural } from '../format';
import { asArray, finiteOrNull, round2, safeOpportunity, safeProfile } from '../gap/inputs';
import { planRoutes } from '../path';
import {
  MATERIAL_KINDS,
  type CrossPlan,
  type CrossPlanItem,
  type CrossPlanOptions,
  type MaterialKind,
  type MaterialReuse,
  type Opportunity,
  type PlanResult,
  type Route,
  type StudentProfile,
  type WeeklyLoad,
} from '../types';

const MATERIAL_LABEL: Record<MaterialKind, string> = {
  resume: 'Resume',
  transcript: 'Transcript',
  personal_statement: 'Personal statement',
  recommendation_letter: 'Recommendation letter',
  portfolio: 'Portfolio',
  essay: 'Essay',
  other: 'Other material',
};

interface Work {
  opp: Opportunity;
  index: number;
  plan: PlanResult;
  route: Route | null;
  status: CrossPlanItem['status'];
  /** 自 1970-01-01 的天数；无截止日期或无法解析为 null。 */
  deadlineDay: number | null;
  hoursBefore: number;
  /** 本机会未跳过的材料步骤：material_kind → { reusable, hours }。 */
  materials: { kind: MaterialKind; reusable: boolean; hours: number }[];
}

function isoFromDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

/** 该天所在周的周一（1970-01-01 是周四）。 */
function mondayOf(day: number): number {
  const weekday = (((day + 3) % 7) + 7) % 7; // 0 = 周一
  return day - weekday;
}

export function planAcrossOpportunities(
  profile: StudentProfile,
  opps: Opportunity[],
  options?: CrossPlanOptions,
): CrossPlan {
  const p = safeProfile(profile);
  const todayYMD = parseISODate(options?.today);
  const todayDay = todayYMD ? dayNumber(todayYMD) : null;
  const evalOptions = options?.today == null ? undefined : { today: options.today };

  const warnings: string[] = [];
  const missing: string[] = [];
  const miss = (f: string) => {
    if (!missing.includes(f)) missing.push(f);
  };
  if (todayDay == null) miss('options.today');

  // ── 1. 逐个机会规划 ──
  const works: Work[] = [];
  const seen = new Set<string>();
  asArray<unknown>(opps).forEach((raw, index) => {
    const opp = safeOpportunity(raw);
    if (opp.id === '') {
      warnings.push(`Item ${index + 1} in the list has no opportunity id, so it was skipped.`);
      return;
    }
    if (seen.has(opp.id)) return;
    seen.add(opp.id);

    let plan: PlanResult;
    try {
      plan = planRoutes(p, opp, evalOptions);
    } catch {
      warnings.push(`Could not plan "${opp.title || opp.id}" because its data is incomplete. Check the official page.`);
      miss(`opportunity.${opp.id}`);
      return;
    }

    const deadlineYMD = opp.deadline == null ? null : parseISODate(opp.deadline);
    const deadlineDay = deadlineYMD ? dayNumber(deadlineYMD) : null;
    let status: CrossPlanItem['status'] = 'planned';
    if (plan.status === 'blocked') status = 'blocked';
    else if (deadlineDay != null && todayDay != null && deadlineDay < todayDay) status = 'past_deadline';

    const route = status === 'planned' && plan.status === 'routes' ? (plan.routes[0] ?? null) : null;
    const materials: Work['materials'] = [];
    if (route) {
      for (const step of route.steps) {
        if (step.skipped || step.prep_item_id == null) continue;
        const prep = opp.preparation.find((x) => x.id === step.prep_item_id);
        const kind = prep?.material_kind;
        if (kind == null || !MATERIAL_KINDS.includes(kind)) continue;
        materials.push({ kind, reusable: prep?.reusable_across_opportunities === true, hours: step.hours });
      }
    }
    works.push({
      opp,
      index,
      plan,
      route,
      status,
      deadlineDay,
      hoursBefore: route ? round2(route.total_hours) : 0,
      materials,
    });
  });

  // ── 2. 按截止日期排序 ──
  works.sort((a, b) => {
    if (a.deadlineDay == null && b.deadlineDay == null) return a.index - b.index;
    if (a.deadlineDay == null) return 1;
    if (b.deadlineDay == null) return -1;
    return a.deadlineDay - b.deadlineDay || a.index - b.index;
  });

  // ── 3. 材料复用 ──
  const required = new Map<string, number>(works.map((w) => [w.opp.id, w.hoursBefore]));
  const reuse: MaterialReuse[] = [];
  for (const kind of MATERIAL_KINDS) {
    for (const reusable of [true, false]) {
      const users = works
        .map((w) => ({
          w,
          hours: w.materials.filter((m) => m.kind === kind && m.reusable === reusable).reduce((s, m) => s + m.hours, 0),
          used: w.materials.some((m) => m.kind === kind && m.reusable === reusable),
        }))
        .filter((u) => u.used);
      if (users.length < 2) continue;
      const hours_each = round2(Math.max(...users.map((u) => u.hours)));
      const sum = users.reduce((s, u) => s + u.hours, 0);
      const label = MATERIAL_LABEL[kind];
      if (reusable) {
        const hours_saved = round2(sum - hours_each);
        // 只算在 order 最靠前的机会上（按 hours_each），其他机会去掉自己那份。
        users.forEach((u, i) => {
          const id = u.w.opp.id;
          const cur = required.get(id) ?? 0;
          required.set(id, round2(i === 0 ? cur - u.hours + hours_each : cur - u.hours));
        });
        reuse.push({
          material_kind: kind,
          reusable: true,
          opportunity_ids: users.map((u) => u.w.opp.id),
          hours_each,
          hours_saved,
          note: `${label} can be reused across ${plural(users.length, 'opportunity', 'opportunities')}, so it is counted once (about ${plural(hours_each, 'hour')}); this saves about ${plural(hours_saved, 'hour')}.`,
        });
      } else {
        reuse.push({
          material_kind: kind,
          reusable: false,
          opportunity_ids: users.map((u) => u.w.opp.id),
          hours_each,
          hours_saved: 0,
          note: `${label} needs to be prepared separately for each of these ${plural(users.length, 'opportunity', 'opportunities')} (or the data doesn't say it can be reused), so no time is saved.`,
        });
      }
    }
  }

  // ── items ──
  const items: CrossPlanItem[] = works.map((w, i) => {
    const deadline = typeof w.opp.deadline === 'string' ? w.opp.deadline : null;
    const weeks_left = w.deadlineDay != null && todayDay != null ? Math.round(((w.deadlineDay - todayDay) / 7) * 10) / 10 : null;
    let note: string;
    let feasible_alone: boolean | null = null;
    if (w.status === 'blocked') {
      note = w.plan.status === 'blocked' && w.plan.reasons.length > 0 ? w.plan.reasons[0] : "You don't meet a hard requirement, so this is not counted in the plan.";
    } else if (w.status === 'past_deadline') {
      note = `The deadline (${deadline}) has passed, so this is not counted in the plan.`;
      feasible_alone = false;
    } else {
      feasible_alone = w.route?.feasible_by_deadline ?? null;
      const when = deadline ? `deadline ${deadline}` : 'no deadline listed';
      note = `Order ${i + 1} by deadline (${when}). Hours are from the "${w.route?.title ?? ''}" route, skipping steps your evidence already covers. This order is only a suggestion.`;
    }
    return {
      opportunity_id: w.opp.id,
      title: w.opp.title,
      deadline,
      status: w.status,
      route_type: w.route?.type ?? null,
      required_hours: w.status === 'planned' ? (required.get(w.opp.id) ?? 0) : 0,
      hours_before_reuse: w.hoursBefore,
      weeks_left,
      feasible_alone,
      order: i + 1,
      note,
    };
  });

  // ── warnings ──
  for (const w of works) {
    const name = `"${w.opp.title || w.opp.id}"`;
    if (w.status === 'blocked') warnings.push(`${name} is not in the plan: you don't meet a hard requirement.`);
    else if (w.status === 'past_deadline') warnings.push(`${name} is not in the plan: the deadline has passed.`);
    else {
      let overall: string | null = null;
      try {
        overall = checkEligibility(p, w.opp, evalOptions).overall;
      } catch {
        overall = null;
      }
      if (overall === 'unknown') warnings.push(`${name}: eligibility is not confirmed yet. Confirm with the organizer before putting in time.`);
      if (w.route?.feasible_by_deadline === false) warnings.push(`${name}: at your weekly hours, this alone may not be finished before the deadline.`);
    }
  }

  // ── 4. weekly_load ──
  const hpw = finiteOrNull(p.hours_per_week_available);
  const hours_available = hpw != null && hpw >= 0 ? hpw : null;
  const planned = items.filter((it) => it.status === 'planned');
  const weekly_load: WeeklyLoad[] = [];
  const conflicts: string[] = [];
  if (todayDay != null) {
    const start = mondayOf(todayDay);
    const loads = new Map<number, { hours: number; ids: string[] }>();
    for (const it of planned) {
      const w = works.find((x) => x.opp.id === it.opportunity_id) as Work;
      if (w.deadlineDay == null) {
        miss(`opportunity.${it.opportunity_id}.deadline`);
        continue;
      }
      if (it.required_hours <= 0) continue;
      const weeks = Math.floor((w.deadlineDay - start) / 7) + 1;
      const perWeek = it.required_hours / weeks;
      for (let k = 0; k < weeks; k++) {
        const ws = start + k * 7;
        const cur = loads.get(ws) ?? { hours: 0, ids: [] };
        cur.hours += perWeek;
        cur.ids.push(it.opportunity_id);
        loads.set(ws, cur);
      }
    }
    if (hours_available == null && loads.size > 0) miss('profile.hours_per_week_available');
    const weekStarts = [...loads.keys()].sort((a, b) => a - b);
    const priorities = asArray<unknown>(options?.priorities).filter((x): x is string => typeof x === 'string');
    for (const ws of weekStarts) {
      const { hours, ids } = loads.get(ws) as { hours: number; ids: string[] };
      const hours_needed = round2(hours);
      const over = hours_available == null ? null : hours_needed > hours_available + 1e-9;
      weekly_load.push({ week_start: isoFromDay(ws), hours_needed, hours_available, over, opportunity_ids: [...ids] });
      if (over === true) {
        const titles = ids.map((id) => `"${items.find((x) => x.opportunity_id === id)?.title || id}"`).join(', ');
        let text = `Week of ${isoFromDay(ws)}: about ${plural(hours_needed, 'hour')} needed (${titles}), but you have ${plural(hours_available as number, 'hour')} per week.`;
        text += priorityNote(ids, priorities, start, hours_available as number);
        conflicts.push(text);
      }
    }
  }

  const plannedHours = planned.reduce((s, it) => s + it.required_hours, 0);
  const plannedBefore = planned.reduce((s, it) => s + it.hours_before_reuse, 0);

  return {
    profile_id: p.id,
    evaluated_on: todayDay != null ? (options?.today as string) : null,
    items,
    weekly_load,
    reuse,
    total_hours: round2(plannedHours),
    total_hours_without_reuse: round2(plannedBefore),
    conflicts,
    warnings,
    missing_info: missing,
  };

  /** 若学生给了优先顺序：说明这一周只保留前 k 个优先项时需要多少小时（只做对照）。 */
  function priorityNote(ids: string[], priorities: string[], weekStart: number, available: number): string {
    const ranked = priorities.filter((id, i) => ids.includes(id) && priorities.indexOf(id) === i);
    if (ranked.length === 0) return '';
    const perWeekOf = (id: string): number => {
      const w = works.find((x) => x.opp.id === id) as Work;
      const it = items.find((x) => x.opportunity_id === id) as CrossPlanItem;
      const weeks = Math.floor(((w.deadlineDay as number) - weekStart) / 7) + 1;
      return it.required_hours / weeks;
    };
    let best = 0;
    let bestHours = 0;
    let acc = 0;
    for (let k = 0; k < ranked.length; k++) {
      acc += perWeekOf(ranked[k]);
      if (acc <= available + 1e-9) {
        best = k + 1;
        bestHours = acc;
      } else break;
    }
    if (best === 0) {
      return ` Even your top priority alone needs about ${plural(round2(perWeekOf(ranked[0])), 'hour')} that week. This is only for comparison; you decide.`;
    }
    return ` If you kept only your top ${fmt(best)} ${best === 1 ? 'priority' : 'priorities'} this week, it would need about ${plural(round2(bestHours), 'hour')}. This is only for comparison; you decide.`;
  }
}

