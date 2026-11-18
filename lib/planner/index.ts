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
 *    - 否则 'planned'：取第一条路线（learning_first），hours_before_reuse = 它未跳过步骤的小时合计（= route.total_hours）；
 *      feasible_alone 用与 weekly_load 相同的按天公式（见第 4 步），不直接抄 route.feasible_by_deadline；
 *    - planRoutes 因数据不完整抛错 → status 'insufficient_data'（小时为 0、route_type null、note 说明缺什么），
 *      仍列入 items，同时写进 warnings 与 missing_info（`opportunity.<id>`）。
 * 2. order：按截止日期升序（无截止日期 / 无法解析的排最后），同日期按输入顺序；items 按 order 排列。
 * 3. 材料复用（只看 planned 机会第一条路线里未跳过、且对应 PrepItem.material_kind 非空的步骤）：
 *    - reusable_across_opportunities === true 的同类材料被 ≥ 2 个机会用到 → 一条 reusable: true 的 MaterialReuse：
 *      hours_each = 各机会该材料小时的最大值；hours_saved = 各机会之和 − hours_each；
 *      这份材料只算在 order 最靠前的那个机会上（按 hours_each 计，所以它的 required_hours 可能大于 hours_before_reuse），
 *      其他机会的 required_hours 减去自己那份，并把这份记进 hours_saved_by_reuse；
 *    - 其余（不可复用 / 未标明）的同类材料被 ≥ 2 个机会用到 → 一条 reusable: false、hours_saved 0 的说明。
 * 4. weekly_load（按天分摊）：需要 options.today。设 H = 每周可用小时（profile.hours_per_week_available）。
 *    - 每个 planned 机会：D = today（含）到截止日（含）的天数，每天分摊 = required_hours / D，
 *      落在某周的天数 × 每天分摊 = 它在该周的小时；按周一对齐汇总成 hours_needed。
 *    - 计划窗口 = today 到计入负荷的机会中最晚的截止日（都含）；days = 该周落在窗口里的天数（1–7）；
 *      hours_available = H × days / 7；over = hours_needed > hours_available。
 *    - feasible_alone = hours_before_reuse ≤ H × D / 7。只有一个机会时：某周 over ⇔ 每天分摊 > H / 7 ⇔ feasible_alone 为 false，
 *      两者结论一致（例：today 周日、截止次日周一、需 6h、H = 3 → D = 2、每天 3h，两周各需 3h、各只有 3/7h，都 over）。
 *    没有截止日期（或无法解析）的机会不进 weekly_load，并写进 missing_info（`opportunity.<id>.deadline`）。
 *    H 没填时 hours_available / over 为 null，并写进 missing_info。超出的周生成一条 conflicts 文字；若学生给了
 *    options.priorities，再说明「只保留前几个优先项时那一周需要多少小时」，只做对照，不替学生取舍。
 * 5. total_hours / total_hours_without_reuse 只算 planned 的机会。
 *
 * 与最终版相比省略了：
 * - 只按 learning_first 路线（含建议项）计小时，不在多条路线之间挑选，也不区分「只做必需项」的最低负荷；
 * - 每周负荷是按天平均摊开的粗略估计，不考虑步骤依赖顺序、参与期本身的每周投入（time_commitment）与考试周等；
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
  plan: PlanResult | null;
  route: Route | null;
  status: CrossPlanItem['status'];
  /** 自 1970-01-01 的天数；无截止日期或无法解析为 null。 */
  deadlineDay: number | null;
  hoursBefore: number;
  /** 规划出错时缺的说明（insufficient_data 用）。 */
  errorNote: string | null;
  /** 本机会未跳过的材料步骤：material_kind → { reusable, hours }。 */
  materials: { kind: MaterialKind; reusable: boolean; hours: number }[];
}

const EPS = 1e-9;

/** 周 [weekStart, weekStart + 6] 与 [from, to]（都含）重叠的天数。 */
function overlap(weekStart: number, from: number, to: number): number {
  return Math.max(0, Math.min(weekStart + 6, to) - Math.max(weekStart, from) + 1);
}

/** 规划出错时，用学生能看懂的话列出机会数据里缺的关键字段（只看形状，不猜内容）。 */
function describeMissing(opp: Opportunity): string {
  const o = opp as unknown as Record<string, unknown>;
  const missing: string[] = [];
  if (!Array.isArray(o.requirements)) missing.push('requirements');
  if (typeof o.cost !== 'object' || o.cost === null) missing.push('cost');
  if (typeof o.location !== 'object' || o.location === null) missing.push('location');
  if (typeof o.time_commitment !== 'object' || o.time_commitment === null) missing.push('time commitment');
  return missing.length > 0 ? `missing: ${missing.join(', ')}` : '';
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

    const deadlineYMD = typeof opp.deadline === 'string' ? parseISODate(opp.deadline) : null;
    const deadlineDay = deadlineYMD ? dayNumber(deadlineYMD) : null;

    let plan: PlanResult;
    try {
      plan = planRoutes(p, opp, evalOptions);
    } catch {
      const gaps = describeMissing(opp);
      warnings.push(`Could not plan "${opp.title || opp.id}" because its data is incomplete${gaps ? ` (${gaps})` : ''}. Check the official page.`);
      miss(`opportunity.${opp.id}`);
      works.push({
        opp,
        index,
        plan: null,
        route: null,
        status: 'insufficient_data',
        deadlineDay,
        hoursBefore: 0,
        errorNote: `We couldn't work out the hours for this one because its data is incomplete${gaps ? ` (${gaps})` : ''}. It is not counted in the plan; check the official page.`,
        materials: [],
      });
      return;
    }

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
      errorNote: null,
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
  const saved = new Map<string, number>(works.map((w) => [w.opp.id, 0]));
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
          if (i > 0) saved.set(id, round2((saved.get(id) ?? 0) + u.hours));
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

  // ── 每周可用小时 ──
  const hpw = finiteOrNull(p.hours_per_week_available);
  const hours_available_per_week = hpw != null && hpw >= 0 ? hpw : null;

  // ── items ──
  const items: CrossPlanItem[] = works.map((w, i) => {
    const deadline = typeof w.opp.deadline === 'string' ? w.opp.deadline : null;
    const weeks_left = w.deadlineDay != null && todayDay != null ? Math.round(((w.deadlineDay - todayDay) / 7) * 10) / 10 : null;
    let note: string;
    let feasible_alone: boolean | null = null;
    if (w.status === 'insufficient_data') {
      note = w.errorNote ?? "We couldn't work out the hours for this one because its data is incomplete.";
    } else if (w.status === 'blocked') {
      note = w.plan?.status === 'blocked' && w.plan.reasons.length > 0 ? w.plan.reasons[0] : "You don't meet a hard requirement, so this is not counted in the plan.";
    } else if (w.status === 'past_deadline') {
      note = `The deadline (${deadline}) has passed, so this is not counted in the plan.`;
      feasible_alone = false;
    } else {
      if (w.deadlineDay != null && todayDay != null && hours_available_per_week != null) {
        const days = w.deadlineDay - todayDay + 1;
        feasible_alone = w.hoursBefore <= (hours_available_per_week * days) / 7 + EPS;
      }
      const when = deadline ? `deadline ${deadline}` : 'no deadline listed';
      note = `Order ${i + 1} by deadline (${when}). Hours are from the "${w.route?.title ?? ''}" route, skipping steps your evidence already covers. This order is only a suggestion.`;
    }
    const isPlanned = w.status === 'planned';
    return {
      opportunity_id: w.opp.id,
      title: w.opp.title,
      deadline,
      status: w.status,
      route_type: w.route?.type ?? null,
      required_hours: isPlanned ? (required.get(w.opp.id) ?? 0) : 0,
      hours_before_reuse: isPlanned ? w.hoursBefore : 0,
      hours_saved_by_reuse: isPlanned ? (saved.get(w.opp.id) ?? 0) : 0,
      weeks_left,
      feasible_alone,
      order: i + 1,
      note,
    };
  });

  // ── warnings ──
  for (const w of works) {
    const name = `"${w.opp.title || w.opp.id}"`;
    if (w.status === 'insufficient_data') continue; // 已在第 1 步写过 warning。
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
      const item = items.find((x) => x.opportunity_id === w.opp.id);
      if (item?.feasible_alone === false) warnings.push(`${name}: at your weekly hours, this alone may not be finished before the deadline.`);
    }
  }

  // ── 4. weekly_load（按天分摊）──
  const hours_available = hours_available_per_week;
  const planned = items.filter((it) => it.status === 'planned');
  const weekly_load: WeeklyLoad[] = [];
  const conflicts: string[] = [];
  /** 计入负荷的机会：每天分摊的小时与截止日。 */
  const spread = new Map<string, { perDay: number; endDay: number }>();
  if (todayDay != null) {
    for (const it of planned) {
      const w = works.find((x) => x.opp.id === it.opportunity_id) as Work;
      if (w.deadlineDay == null) {
        miss(`opportunity.${it.opportunity_id}.deadline`);
        continue;
      }
      if (it.required_hours <= 0) continue;
      const days = w.deadlineDay - todayDay + 1; // planned 意味着截止日 ≥ today，days ≥ 1
      spread.set(it.opportunity_id, { perDay: it.required_hours / days, endDay: w.deadlineDay });
    }
    if (hours_available == null && spread.size > 0) miss('profile.hours_per_week_available');
    if (spread.size > 0) {
      const lastDay = Math.max(...[...spread.values()].map((x) => x.endDay));
      const priorities = asArray<unknown>(options?.priorities).filter((x): x is string => typeof x === 'string');
      for (let ws = mondayOf(todayDay); ws <= lastDay; ws += 7) {
        const days = overlap(ws, todayDay, lastDay);
        let hours = 0;
        const ids: string[] = [];
        for (const it of planned) {
          const sp = spread.get(it.opportunity_id);
          if (!sp) continue;
          const d = overlap(ws, todayDay, sp.endDay);
          if (d <= 0) continue;
          hours += sp.perDay * d;
          ids.push(it.opportunity_id);
        }
        if (ids.length === 0) continue;
        const availRaw = hours_available == null ? null : (hours_available * days) / 7;
        const over = availRaw == null ? null : hours > availRaw + EPS;
        const hours_needed = round2(hours);
        weekly_load.push({
          week_start: isoFromDay(ws),
          days,
          hours_needed,
          hours_available: availRaw == null ? null : round2(availRaw),
          over,
          opportunity_ids: ids,
        });
        if (over === true) {
          const titles = ids.map((id) => `"${items.find((x) => x.opportunity_id === id)?.title || id}"`).join(', ');
          const partial = days < 7 ? ` (only ${plural(days, 'day')} of this week count: ${plural(hours_available as number, 'hour')} per week × ${fmt(days)}/7)` : '';
          let text = `Week of ${isoFromDay(ws)}: about ${plural(hours_needed, 'hour')} needed (${titles}), but you have about ${plural(round2(availRaw as number), 'hour')} that week${partial}.`;
          text += priorityNote(ids, priorities, ws, availRaw as number);
          conflicts.push(text);
        }
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
    const hoursThisWeek = (id: string): number => {
      const sp = spread.get(id);
      return sp ? sp.perDay * overlap(weekStart, todayDay as number, sp.endDay) : 0;
    };
    let best = 0;
    let bestHours = 0;
    let acc = 0;
    for (let k = 0; k < ranked.length; k++) {
      acc += hoursThisWeek(ranked[k]);
      if (acc <= available + EPS) {
        best = k + 1;
        bestHours = acc;
      } else break;
    }
    if (best === 0) {
      return ` Even your top priority alone needs about ${plural(round2(hoursThisWeek(ranked[0])), 'hour')} that week. This is only for comparison; you decide.`;
    }
    return ` If you kept only your top ${fmt(best)} ${best === 1 ? 'priority' : 'priorities'} this week, it would need about ${plural(round2(bestHours), 'hour')}. This is only for comparison; you decide.`;
  }
}

