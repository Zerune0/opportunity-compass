/**
 * planAcrossOpportunities(profile, opps, options?) — 多个机会一起排期（CrossPlan），完整版。
 * 只把数字摆出来，不替学生决定放弃哪个机会。
 *
 * 做了什么：
 * 1. 机会去重（同 id 只取第一条；非对象 / 无 id 的跳过并写进 warnings）。每个机会调用 planRoutes：
 *    - blocked → status 'blocked'、小时为 0、route_type null，note 用 planRoutes 的第一条原因；
 *    - 否则若按 options.today 截止日期已过 → status 'past_deadline'、小时为 0、route_type null；
 *    - planRoutes 因数据不完整抛错 → status 'insufficient_data'（小时为 0、route_type null、note 说明缺什么），
 *      仍列入 items，同时写进 warnings 与 missing_info（`opportunity.<id>`）；
 *    - 否则 'planned'，按第 2 步选路线、算必需小时。
 * 2. 路线选择与必需小时（RouteStep 上没有「建议 / 可选」字段，用 step.prep_item_id 找回 PrepItem.required_for_application 区分）：
 *    - 「已完成」的步骤 = step.skipped（证据覆盖）或被 options.materials 里就绪材料覆盖（见第 4 步）；
 *    - 必需步骤 = 从 required_for_application === true 的未完成步骤出发，沿 depends_on 追到的未完成前置步骤
 *      （已完成的步骤不再往前追，与 requiredPrepClosure 同一口径）+ 路线固定步骤（社区路线的「找同伴」2h、「提交申请」0h；
 *      不沿「提交申请」的依赖追，否则所有步骤都成了必需）。prep_item_id 找不到对应准备项的步骤按必需算（不确定时不少算）。
 *    - 建议项 = 其余未完成的步骤：小时不计入负荷，在 note 里如实写出（"Plus N optional hours of suggested prep, not counted here."）。
 *    - 在 planRoutes 的路线里选一条：先看 feasible_by_deadline === true 的（planRoutes 自己的判断，按含建议项的总小时），
 *      其中取必需小时最少的；没有可行的就在全部路线里取必需小时最少的；并列按 planRoutes 原顺序。
 *    - hours_before_reuse = 所选路线的必需小时；feasible_alone 用与 weekly_load 相同的按天公式（不抄 feasible_by_deadline）。
 * 3. 依赖链：在所选路线的必需步骤里求最长依赖链（按步骤数组顺序做最长路径；依赖环上指向后面的边忽略）。
 *    链上至少两个有小时的步骤、且链的小时数 > H × D / 7（与 feasible_alone 同一口径）时，在 note 与 warnings 里说明。
 *    注意：学生一个人顺序完成，链的小时 ≤ 必需小时总和，所以这条提醒只会和 feasible_alone === false 同时出现；
 *    它多说明的是「光是这条必须按顺序做的链就放不下」。不逐步排日程。
 * 4. 已有材料（options.materials，缺省 = 不考虑）：只有 status 'ready' 且 profile_id 与档案相同（或没写）的材料生效，
 *    kind 与步骤准备项的 material_kind 相同，并且满足其一：
 *    - 材料是通用的（reusable === true）且准备项标明可复用（reusable_across_opportunities === true）——
 *      准备项要求针对性准备（false / 未标明）时，通用材料不抵消，不假设省时间；
 *    - 材料针对的就是这个机会（opportunity_id 相同），若带 prep_item_id 还须与准备项 id 相同。
 *    被覆盖的步骤小时计 0（视同已完成），note 里说明 "already prepared"；这类步骤不再进入材料复用统计。
 * 5. order：按截止日期升序（无截止日期 / 无法解析的排最后），同日期按输入顺序；items 按 order 排列。
 * 6. 材料复用（只看所选路线里计入必需小时、且准备项 material_kind 非空的步骤）：
 *    - reusable_across_opportunities === true 的同类材料被 ≥ 2 个机会用到 → 一条 reusable: true 的 MaterialReuse：
 *      hours_each = 各机会该材料小时的最大值；hours_saved = 各机会之和 − hours_each；
 *      这份材料只算在 order 最靠前的那个机会上（按 hours_each 计，所以它的 required_hours 可能大于 hours_before_reuse），
 *      其他机会的 required_hours 减去自己那份，并把这份记进 hours_saved_by_reuse；这些非承担者的 note 里写一句
 *      "<材料> hours are counted under "<承担者标题>" (prepared once, reused here)."；
 *    - 其余（不可复用 / 未标明）的同类材料被 ≥ 2 个机会用到 → 一条 reusable: false、hours_saved 0 的说明。
 * 7. weekly_load（按天分摊）：需要 options.today。设 H = 每周可用小时（profile.hours_per_week_available）。
 *    - 每个 planned 机会：D = today（含）到截止日（含）的天数，每天分摊 = required_hours / D，
 *      落在某周的天数 × 每天分摊 = 它在该周的小时；按周一对齐汇总成 hours_needed。
 *    - 计划窗口 = today 到计入负荷的机会中最晚的截止日（都含）；days = 该周落在窗口里的天数（1–7）；
 *      hours_available = H × days / 7；over = hours_needed > hours_available。
 *    - feasible_alone = hours_before_reuse ≤ H × D / 7。
 *    没有截止日期（或无法解析）的机会不进 weekly_load，并写进 missing_info（`opportunity.<id>.deadline`）。
 *    H 没填时 hours_available / over 为 null，并写进 missing_info。超出的周生成一条 conflicts 文字；若学生给了
 *    options.priorities，再说明「只保留这一周涉及的前几个优先项时那一周需要多少小时」：直接点出机会标题（不说
 *    "your top priority"，因为这一周可能只有靠后的优先项），每个 k 都在保留的子集里重算材料复用（与第 8 步同一函数），
 *    不沿用全量计划的承担者归属；一个都放不下时说「即使只留 "Y" 也需要约 N 小时」。
 * 8. 优先顺序的整体对照（给了 priorities 且有超出的周、H 已填时）：k 从「有截止日期的 planned 机会数 − 1」（不超过其中优先项的个数）递减到 1，
 *    只保留前 k 个优先项重新算复用与每周负荷，取第一个让所有周都不超的 k；都不行就说明「即使只保留第一个」也有几周超出。
 *    这条放在 conflicts 末尾，只做对照，措辞不建议放弃。priorities 里不是本次机会 id 的项忽略并写一条 warning。
 * 9. 参与期（time_commitment.start_date / end_date / hours_per_week 都有效的 planned 机会；数据缺失就不判断，也不写 missing_info）：
 *    - ≥ 2 个机会的参与期重叠、合计每周小时 > H → 每个重叠区间（参与机会集合相同的连续日期合并）一条 warning；
 *    - 某机会的准备期（today 到截止日）与另一个机会的参与期重叠 → 一条 warning，说明那段时间每周大约还剩几小时可用于准备。
 *    有 today 时只看 today 及以后的日期。参与期小时不计入 weekly_load（weekly_load 只算准备）。
 * 10. total_hours / total_hours_without_reuse 只算 planned 的机会。
 *
 * 仍然不做：
 * - 不逐步排日程（每周负荷仍是按天平均摊开的估计），不考虑考试周、节假日等个人日历；
 * - 材料复用只按 material_kind 粗分（同类即视为同一份），不看材料内容是否真能通用；
 * - 不判断材料质量；学生标记 ready 的材料就按已完成算；
 * - 不替学生取舍、不给分数或排名：order 只按截止日期，优先项只用于对照。
 *
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO、不调 AI。
 * 永不抛异常。
 */
import { checkEligibility } from '../eligibility';
import { dayNumber, parseISODate } from '../eligibility/dates';
import { fmt, joinAnd, plural } from '../format';
import { asArray, finiteOrNull, round2, safeOpportunity, safeProfile } from '../gap/inputs';
import { planRoutes } from '../path';
import {
  MATERIAL_KINDS,
  type CrossPlan,
  type CrossPlanItem,
  type CrossPlanOptions,
  type Material,
  type MaterialKind,
  type MaterialReuse,
  type Opportunity,
  type PlanResult,
  type PrepItem,
  type Route,
  type RouteStep,
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

const EPS = 1e-9;

interface MaterialUse {
  kind: MaterialKind;
  reusable: boolean;
  hours: number;
}

/** 一条路线按「必需 / 建议 / 已完成」拆开后的结果。 */
interface RouteEval {
  route: Route;
  /** 必需步骤的小时合计。 */
  requiredHours: number;
  /** 建议项（未完成、非必需）的小时合计。 */
  suggestedHours: number;
  /** 计入必需小时的步骤 id。 */
  counted: Set<string>;
  /** 被就绪材料覆盖（未被证据跳过）的步骤。 */
  readyCovered: { kind: MaterialKind; hours: number }[];
  /** 计入必需小时的材料步骤。 */
  materials: MaterialUse[];
}

interface Work {
  opp: Opportunity;
  index: number;
  plan: PlanResult | null;
  chosen: RouteEval | null;
  status: CrossPlanItem['status'];
  /** 自 1970-01-01 的天数；无截止日期或无法解析为 null。 */
  deadlineDay: number | null;
  hoursBefore: number;
  /** 规划出错时缺的说明（insufficient_data 用）。 */
  errorNote: string | null;
}

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

function dayOf(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const ymd = parseISODate(v);
  return ymd ? dayNumber(ymd) : null;
}

function nonNeg(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
}

function isMaterialKind(v: unknown): v is MaterialKind {
  return typeof v === 'string' && (MATERIAL_KINDS as readonly string[]).includes(v);
}

/** 只保留形状正确、已就绪、属于该档案（或没写档案）的材料。 */
function readyMaterials(raw: unknown, profileId: string): Material[] {
  return asArray<unknown>(raw).filter((m): m is Material => {
    if (typeof m !== 'object' || m === null) return false;
    const x = m as Record<string, unknown>;
    if (x.status !== 'ready' || !isMaterialKind(x.kind)) return false;
    return x.profile_id == null || x.profile_id === profileId;
  });
}

/** 就绪材料是否覆盖这个准备项（规则见文件头第 4 步）。 */
function coveredByMaterial(prep: PrepItem, oppId: string, materials: Material[]): boolean {
  const kind = prep.material_kind;
  if (!isMaterialKind(kind)) return false;
  return materials.some((m) => {
    if (m.kind !== kind) return false;
    if (m.reusable === true && prep.reusable_across_opportunities === true) return true;
    return m.opportunity_id === oppId && (m.prep_item_id == null || m.prep_item_id === prep.id);
  });
}

/** 把一条路线拆成必需 / 建议 / 已完成（规则见文件头第 2、4 步）。 */
function evaluateRoute(route: Route, opp: Opportunity, materials: Material[]): RouteEval {
  const steps = asArray<RouteStep>(route.steps);
  const prepOf = (s: RouteStep): PrepItem | undefined =>
    s.prep_item_id == null ? undefined : opp.preparation.find((x) => x.id === s.prep_item_id);
  const byId = new Map<string, RouteStep>();
  for (const s of steps) if (!byId.has(s.id)) byId.set(s.id, s);
  const readyIds = new Set<string>();
  for (const s of steps) {
    const prep = prepOf(s);
    if (!s.skipped && prep && coveredByMaterial(prep, opp.id, materials)) readyIds.add(s.id);
  }
  const done = (s: RouteStep) => s.skipped || readyIds.has(s.id);

  const counted = new Set<string>();
  const stack: string[] = [];
  for (const s of steps) {
    if (done(s)) continue;
    if (s.prep_item_id == null) counted.add(s.id); // 路线固定步骤：计入，但不沿它的依赖追
    else {
      const prep = prepOf(s);
      if (!prep || prep.required_for_application === true) stack.push(s.id);
    }
  }
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (counted.has(id)) continue;
    const s = byId.get(id);
    if (!s || done(s)) continue;
    counted.add(id);
    for (const d of asArray<string>(s.depends_on)) if (!counted.has(d)) stack.push(d);
  }

  let requiredHours = 0;
  let suggestedHours = 0;
  const readyCovered: RouteEval['readyCovered'] = [];
  const mats: MaterialUse[] = [];
  for (const s of steps) {
    const h = nonNeg(s.hours);
    const prep = prepOf(s);
    if (readyIds.has(s.id)) {
      if (prep && isMaterialKind(prep.material_kind)) readyCovered.push({ kind: prep.material_kind, hours: h });
      continue;
    }
    if (s.skipped) continue;
    if (counted.has(s.id)) {
      requiredHours += h;
      if (prep && isMaterialKind(prep.material_kind)) {
        mats.push({ kind: prep.material_kind, reusable: prep.reusable_across_opportunities === true, hours: h });
      }
    } else suggestedHours += h;
  }
  return {
    route,
    requiredHours: round2(requiredHours),
    suggestedHours: round2(suggestedHours),
    counted,
    readyCovered,
    materials: mats,
  };
}

/** 选路线：可行的优先，其中必需小时最少；并列按原顺序。没有可行的就在全部里取最少。 */
function chooseRoute(evals: RouteEval[]): RouteEval | null {
  const feasible = evals.filter((e) => e.route.feasible_by_deadline === true);
  const pool = feasible.length > 0 ? feasible : evals;
  let best: RouteEval | null = null;
  for (const e of pool) if (best == null || e.requiredHours < best.requiredHours - EPS) best = e;
  return best;
}

/** 所选路线必需步骤里的最长依赖链（步骤数组已按依赖排序；指向后面的边视为环上的边，忽略）。 */
function longestChain(ev: RouteEval): { hours: number; titles: string[] } {
  const steps = asArray<RouteStep>(ev.route.steps).filter((s) => ev.counted.has(s.id));
  const pos = new Map<string, number>();
  steps.forEach((s, i) => {
    if (!pos.has(s.id)) pos.set(s.id, i);
  });
  const lp: number[] = [];
  const pred: number[] = [];
  steps.forEach((s, i) => {
    let best = 0;
    let from = -1;
    for (const d of asArray<string>(s.depends_on)) {
      const j = pos.get(d);
      if (j == null || j >= i) continue;
      if (lp[j] > best + EPS) {
        best = lp[j];
        from = j;
      }
    }
    lp[i] = best + nonNeg(s.hours);
    pred[i] = from;
  });
  let end = -1;
  for (let i = 0; i < steps.length; i++) if (end === -1 || lp[i] > lp[end] + EPS) end = i;
  const titles: string[] = [];
  for (let i = end; i !== -1; i = pred[i]) if (nonNeg(steps[i].hours) > 0) titles.unshift(steps[i].title);
  return { hours: end === -1 ? 0 : round2(lp[end]), titles };
}

/** 材料复用（规则见文件头第 6 步）。works 须已按 order 排好，只含参与计算的 planned 机会。 */
function computeReuse(works: Work[]): {
  required: Map<string, number>;
  saved: Map<string, number>;
  reuse: MaterialReuse[];
  /** 非承担者机会 id → 它复用的材料种类与承担者机会 id（按 MATERIAL_KINDS 顺序）。 */
  sharedFrom: Map<string, { kind: MaterialKind; bearer: Work }[]>;
} {
  const required = new Map<string, number>(works.map((w) => [w.opp.id, w.hoursBefore]));
  const saved = new Map<string, number>(works.map((w) => [w.opp.id, 0]));
  const sharedFrom = new Map<string, { kind: MaterialKind; bearer: Work }[]>();
  const reuse: MaterialReuse[] = [];
  for (const kind of MATERIAL_KINDS) {
    for (const reusable of [true, false]) {
      const users = works
        .map((w) => {
          const mats = (w.chosen?.materials ?? []).filter((m) => m.kind === kind && m.reusable === reusable);
          return { w, hours: mats.reduce((s, m) => s + m.hours, 0), used: mats.length > 0 };
        })
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
          if (i > 0) {
            saved.set(id, round2((saved.get(id) ?? 0) + u.hours));
            sharedFrom.set(id, [...(sharedFrom.get(id) ?? []), { kind, bearer: users[0].w }]);
          }
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
  return { required, saved, reuse, sharedFrom };
}

interface Spread {
  id: string;
  perDay: number;
  endDay: number;
}

interface WeekCalc {
  ws: number;
  days: number;
  hours: number;
  avail: number | null;
  over: boolean | null;
  ids: string[];
}

/** 按天分摊后按周汇总（规则见文件头第 7 步）。spreads 为空时返回 []。 */
function weeksFor(spreads: Spread[], todayDay: number, hpw: number | null): WeekCalc[] {
  if (spreads.length === 0) return [];
  const lastDay = Math.max(...spreads.map((s) => s.endDay));
  const out: WeekCalc[] = [];
  for (let ws = mondayOf(todayDay); ws <= lastDay; ws += 7) {
    const days = overlap(ws, todayDay, lastDay);
    let hours = 0;
    const ids: string[] = [];
    for (const sp of spreads) {
      const d = overlap(ws, todayDay, sp.endDay);
      if (d <= 0) continue;
      hours += sp.perDay * d;
      ids.push(sp.id);
    }
    if (ids.length === 0) continue;
    const avail = hpw == null ? null : (hpw * days) / 7;
    out.push({ ws, days, hours, avail, over: avail == null ? null : hours > avail + EPS, ids });
  }
  return out;
}

export function planAcrossOpportunities(
  profile: StudentProfile,
  opps: Opportunity[],
  options?: CrossPlanOptions,
): CrossPlan {
  const p = safeProfile(profile);
  const opt = (typeof options === 'object' && options !== null ? options : {}) as CrossPlanOptions;
  const todayYMD = parseISODate(opt.today);
  const todayDay = todayYMD ? dayNumber(todayYMD) : null;
  const evalOptions = opt.today == null ? undefined : { today: opt.today };
  const materials = readyMaterials(opt.materials, p.id);

  const warnings: string[] = [];
  const missing: string[] = [];
  const miss = (f: string) => {
    if (!missing.includes(f)) missing.push(f);
  };
  if (todayDay == null) miss('options.today');

  const hpwRaw = finiteOrNull(p.hours_per_week_available);
  const hpw = hpwRaw != null && hpwRaw >= 0 ? hpwRaw : null;

  // ── 1–4. 逐个机会规划、选路线 ──
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

    const deadlineDay = dayOf(opp.deadline);
    const base = { opp, index, deadlineDay };

    let plan: PlanResult;
    let chosen: RouteEval | null = null;
    try {
      plan = planRoutes(p, opp, evalOptions);
      if (plan.status === 'routes') chosen = chooseRoute(plan.routes.map((r) => evaluateRoute(r, opp, materials)));
    } catch {
      const gaps = describeMissing(opp);
      warnings.push(`Could not plan "${opp.title || opp.id}" because its data is incomplete${gaps ? ` (${gaps})` : ''}. Check the official page.`);
      miss(`opportunity.${opp.id}`);
      works.push({
        ...base,
        plan: null,
        chosen: null,
        status: 'insufficient_data',
        hoursBefore: 0,
        errorNote: `We couldn't work out the hours for this one because its data is incomplete${gaps ? ` (${gaps})` : ''}. It is not counted in the plan; check the official page.`,
      });
      return;
    }

    let status: CrossPlanItem['status'] = 'planned';
    if (plan.status === 'blocked') status = 'blocked';
    else if (deadlineDay != null && todayDay != null && deadlineDay < todayDay) status = 'past_deadline';
    if (status !== 'planned') chosen = null;
    works.push({ ...base, plan, chosen, status, hoursBefore: chosen ? chosen.requiredHours : 0, errorNote: null });
  });

  // ── 5. 按截止日期排序 ──
  works.sort((a, b) => {
    if (a.deadlineDay == null && b.deadlineDay == null) return a.index - b.index;
    if (a.deadlineDay == null) return 1;
    if (b.deadlineDay == null) return -1;
    return a.deadlineDay - b.deadlineDay || a.index - b.index;
  });
  const plannedWorks = works.filter((w) => w.status === 'planned');
  const nameOf = (w: Work) => `"${w.opp.title || w.opp.id}"`;

  // ── 6. 材料复用 ──
  const { required, saved, reuse, sharedFrom } = computeReuse(plannedWorks);

  // ── 3. 依赖链（需要 today、截止日期与 H）──
  const chainNotes = new Map<string, string>();
  for (const w of plannedWorks) {
    if (!w.chosen || w.deadlineDay == null || todayDay == null || hpw == null) continue;
    const chain = longestChain(w.chosen);
    if (chain.titles.length < 2) continue;
    const capacity = (hpw * (w.deadlineDay - todayDay + 1)) / 7;
    if (chain.hours <= capacity + EPS) continue;
    const text = `The steps ${chain.titles.map((t) => `"${t}"`).join(' → ')} have to be done in this order and need about ${plural(chain.hours, 'hour')} on their own, but at your weekly hours you have about ${plural(round2(capacity), 'hour')} before the deadline, so even this chain may not fit.`;
    chainNotes.set(w.opp.id, text);
    warnings.push(`${nameOf(w)}: ${text}`);
  }

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
      if (w.deadlineDay != null && todayDay != null && hpw != null) {
        const days = w.deadlineDay - todayDay + 1;
        feasible_alone = w.hoursBefore <= (hpw * days) / 7 + EPS;
      }
      const when = deadline ? `deadline ${deadline}` : 'no deadline listed';
      const parts = [`Order ${i + 1} by deadline (${when}).`];
      if (w.chosen) {
        parts.push(
          `Hours are from the "${w.chosen.route.title}" route and count only the required steps (and the steps they depend on), skipping steps your evidence already covers.`,
        );
        if (w.chosen.suggestedHours > 0) parts.push(`Plus ${plural(w.chosen.suggestedHours, 'optional hour')} of suggested prep, not counted here.`);
        for (const s of sharedFrom.get(w.opp.id) ?? []) {
          parts.push(`${MATERIAL_LABEL[s.kind]} hours are counted under ${nameOf(s.bearer)} (prepared once, reused here).`);
        }
        for (const r of w.chosen.readyCovered) {
          parts.push(`Your ${MATERIAL_LABEL[r.kind].toLowerCase()} is already prepared (marked ready), so its time (about ${plural(r.hours, 'hour')}) is not counted.`);
        }
      } else {
        parts.push('No route was available to count hours from.');
      }
      const chainNote = chainNotes.get(w.opp.id);
      if (chainNote) parts.push(chainNote);
      parts.push('This order is only a suggestion.');
      note = parts.join(' ');
    }
    const isPlanned = w.status === 'planned';
    return {
      opportunity_id: w.opp.id,
      title: w.opp.title,
      deadline,
      status: w.status,
      route_type: isPlanned ? (w.chosen?.route.type ?? null) : null,
      required_hours: isPlanned ? (required.get(w.opp.id) ?? 0) : 0,
      hours_before_reuse: isPlanned ? w.hoursBefore : 0,
      hours_saved_by_reuse: isPlanned ? (saved.get(w.opp.id) ?? 0) : 0,
      weeks_left,
      feasible_alone,
      order: i + 1,
      note,
    };
  });

  // ── warnings（逐个机会）──
  for (const w of works) {
    if (w.status === 'insufficient_data') continue; // 已在第 1 步写过 warning。
    if (w.status === 'blocked') warnings.push(`${nameOf(w)} is not in the plan: you don't meet a hard requirement.`);
    else if (w.status === 'past_deadline') warnings.push(`${nameOf(w)} is not in the plan: the deadline has passed.`);
    else {
      let overall: string | null = null;
      try {
        overall = checkEligibility(p, w.opp, evalOptions).overall;
      } catch {
        overall = null;
      }
      if (overall === 'unknown') warnings.push(`${nameOf(w)}: eligibility is not confirmed yet. Confirm with the organizer before putting in time.`);
      const item = items.find((x) => x.opportunity_id === w.opp.id);
      if (item?.feasible_alone === false) warnings.push(`${nameOf(w)}: at your weekly hours, this alone may not be finished before the deadline.`);
    }
  }

  // ── priorities：只保留字符串、去重；不是本次机会 id 的写 warning ──
  const allIds = new Set(works.map((w) => w.opp.id));
  const priorities: string[] = [];
  for (const x of asArray<unknown>(opt.priorities)) {
    if (typeof x !== 'string' || x === '') {
      warnings.push('One of your priorities is not a valid opportunity id, so it was ignored.');
      continue;
    }
    if (!allIds.has(x)) {
      warnings.push(`Priority "${x}" doesn't match any opportunity in this plan, so it was ignored.`);
      continue;
    }
    if (!priorities.includes(x)) priorities.push(x);
  }

  // ── 7. weekly_load（按天分摊）──
  const titleOf = (id: string) => items.find((x) => x.opportunity_id === id)?.title || id;
  const weekly_load: WeeklyLoad[] = [];
  const conflicts: string[] = [];
  const spreads: Spread[] = [];
  if (todayDay != null) {
    for (const w of plannedWorks) {
      if (w.deadlineDay == null) {
        miss(`opportunity.${w.opp.id}.deadline`);
        continue;
      }
      const req = required.get(w.opp.id) ?? 0;
      if (req <= 0) continue;
      spreads.push({ id: w.opp.id, perDay: req / (w.deadlineDay - todayDay + 1), endDay: w.deadlineDay });
    }
    if (hpw == null && spreads.length > 0) miss('profile.hours_per_week_available');
    for (const wk of weeksFor(spreads, todayDay, hpw)) {
      const hours_needed = round2(wk.hours);
      weekly_load.push({
        week_start: isoFromDay(wk.ws),
        days: wk.days,
        hours_needed,
        hours_available: wk.avail == null ? null : round2(wk.avail),
        over: wk.over,
        opportunity_ids: wk.ids,
      });
      if (wk.over === true) {
        const titles = wk.ids.map((id) => `"${titleOf(id)}"`).join(', ');
        const partial = wk.days < 7 ? ` (only ${plural(wk.days, 'day')} of this week count: ${plural(hpw as number, 'hour')} per week × ${fmt(wk.days)}/7)` : '';
        let text = `Week of ${isoFromDay(wk.ws)}: about ${plural(hours_needed, 'hour')} needed (${titles}), but you have about ${plural(round2(wk.avail as number), 'hour')} that week${partial}.`;
        text += weekPriorityNote(wk);
        conflicts.push(text);
      }
    }
    // ── 8. 优先顺序的整体对照 ──
    const overall = overallPriorityNote();
    if (overall) conflicts.push(overall);
  }

  // ── 9. 参与期 ──
  participationWarnings();

  const plannedItems = items.filter((it) => it.status === 'planned');
  const plannedHours = plannedItems.reduce((s, it) => s + it.required_hours, 0);
  const plannedBefore = plannedItems.reduce((s, it) => s + it.hours_before_reuse, 0);

  return {
    profile_id: p.id,
    evaluated_on: todayDay != null ? (opt.today as string) : null,
    items,
    weekly_load,
    reuse,
    total_hours: round2(plannedHours),
    total_hours_without_reuse: round2(plannedBefore),
    conflicts,
    warnings,
    missing_info: missing,
  };

  /**
   * 若学生给了优先顺序：说明这一周只保留前 k 个优先项（只看这一周涉及的机会）时需要多少小时（只做对照）。
   * 每个 k 都在保留的子集里重算材料复用（与整体对照同一个 computeReuse），不沿用全量计划的承担者归属。
   */
  function weekPriorityNote(wk: WeekCalc): string {
    const ranked = priorities.filter((id) => wk.ids.includes(id));
    if (ranked.length === 0) return '';
    const today = todayDay as number;
    const hoursIfKept = (k: number): number => {
      const keep = new Set(ranked.slice(0, k));
      const subset = plannedWorks.filter((w) => keep.has(w.opp.id));
      const sub = computeReuse(subset);
      let hours = 0;
      for (const w of subset) {
        const req = sub.required.get(w.opp.id) ?? 0;
        if (w.deadlineDay == null || req <= 0) continue;
        hours += (req / (w.deadlineDay - today + 1)) * overlap(wk.ws, today, w.deadlineDay);
      }
      return hours;
    };
    const available = wk.avail as number;
    const names = (k: number) => joinAnd(ranked.slice(0, k).map((id) => `"${titleOf(id)}"`));
    let best = 0;
    let bestHours = 0;
    for (let k = 1; k <= ranked.length; k++) {
      const h = hoursIfKept(k);
      if (h <= available + EPS) {
        best = k;
        bestHours = h;
      } else break;
    }
    const tail = 'This is only for comparison; you decide.';
    if (best === 0) {
      return ` Even ${names(1)} alone needs about ${plural(round2(hoursIfKept(1)), 'hour')} that week. ${tail}`;
    }
    return ` If you kept only ${names(best)} this week, it would need about ${plural(round2(bestHours), 'hour')}. ${tail}`;
  }

  /** 跨周的整体对照（规则见文件头第 8 步）。不适用时返回 null。 */
  function overallPriorityNote(): string | null {
    if (todayDay == null || hpw == null || priorities.length === 0) return null;
    if (!weekly_load.some((w) => w.over === true)) return null;
    // 有截止日期的 planned 机会都算（复用后 required_hours 为 0 的也算：去掉承担者后它要自己准备材料）。
    const counted = new Set(plannedWorks.filter((w) => w.deadlineDay != null).map((w) => w.opp.id));
    const ranked = priorities.filter((id) => counted.has(id));
    if (ranked.length === 0 || counted.size < 2) return null;
    const totalNow = round2(spreads.reduce((s, sp) => s + (required.get(sp.id) ?? 0), 0));
    const evalTop = (k: number) => {
      const keep = new Set(ranked.slice(0, k));
      const subset = plannedWorks.filter((w) => keep.has(w.opp.id));
      const sub = computeReuse(subset);
      const subSpreads: Spread[] = [];
      let total = 0;
      for (const w of subset) {
        const req = sub.required.get(w.opp.id) ?? 0;
        total += req;
        if (w.deadlineDay == null || req <= 0) continue;
        subSpreads.push({ id: w.opp.id, perDay: req / (w.deadlineDay - (todayDay as number) + 1), endDay: w.deadlineDay });
      }
      const overWeeks = weeksFor(subSpreads, todayDay as number, hpw).filter((x) => x.over === true).length;
      return { total: round2(total), overWeeks, names: ranked.slice(0, k).map((id) => `"${titleOf(id)}"`) };
    };
    const maxK = Math.min(counted.size - 1, ranked.length);
    const tail = 'This is only a comparison, not advice to drop anything; you decide.';
    for (let k = maxK; k >= 1; k--) {
      const r = evalTop(k);
      if (r.overWeeks === 0) {
        const which = k === 1 ? 'your top priority' : `your top ${fmt(k)} priorities`;
        return `Across all weeks: if you kept only ${which} (${joinAnd(r.names)}), no week would exceed your ${plural(hpw as number, 'hour')} per week; that is about ${plural(r.total, 'hour')} in total, compared with about ${plural(totalNow, 'hour')} for everything counted now. ${tail}`;
      }
    }
    const r = evalTop(1);
    return `Across all weeks: even if you kept only your top priority (${joinAnd(r.names)}), ${plural(r.overWeeks, 'week')} would still exceed your ${plural(hpw as number, 'hour')} per week (about ${plural(r.total, 'hour')} in total, compared with about ${plural(totalNow, 'hour')} for everything counted now). ${tail}`;
  }

  /** 参与期重叠与「准备期 × 参与期」重叠（规则见文件头第 9 步）。 */
  function participationWarnings(): void {
    interface Part {
      w: Work;
      start: number;
      end: number;
      hours: number;
    }
    const parts: Part[] = [];
    for (const w of plannedWorks) {
      const tc = (w.opp as unknown as Record<string, unknown>).time_commitment;
      if (typeof tc !== 'object' || tc === null) continue;
      const t = tc as Record<string, unknown>;
      let start = dayOf(t.start_date);
      const end = dayOf(t.end_date);
      const hours = finiteOrNull(t.hours_per_week);
      if (start == null || end == null || end < start || hours == null || hours <= 0) continue;
      if (todayDay != null) {
        if (end < todayDay) continue;
        start = Math.max(start, todayDay);
      }
      parts.push({ w, start, end, hours });
    }

    // 参与期互相重叠：按边界切段，参与集合相同的连续段合并。
    if (parts.length >= 2) {
      const bounds = [...new Set(parts.flatMap((x) => [x.start, x.end + 1]))].sort((a, b) => a - b);
      const segs: { from: number; to: number; members: Part[] }[] = [];
      for (let i = 0; i + 1 < bounds.length; i++) {
        const from = bounds[i];
        const to = bounds[i + 1] - 1;
        const members = parts.filter((x) => x.start <= from && x.end >= to);
        if (members.length < 2) continue;
        const prev = segs[segs.length - 1];
        const key = members.map((m) => m.w.opp.id).join('|');
        if (prev && prev.to + 1 === from && prev.members.map((m) => m.w.opp.id).join('|') === key) prev.to = to;
        else segs.push({ from, to, members });
      }
      let needH = false;
      for (const s of segs) {
        const sum = round2(s.members.reduce((acc, m) => acc + m.hours, 0));
        if (hpw == null) {
          needH = true;
          continue;
        }
        if (sum <= hpw + EPS) continue;
        const list = joinAnd(s.members.map((m) => `${nameOf(m.w)} (about ${plural(m.hours, 'hour')}/week)`));
        warnings.push(
          `From ${isoFromDay(s.from)} to ${isoFromDay(s.to)}, the program periods of ${list} overlap: about ${plural(sum, 'hour')} per week in total, but you have about ${plural(hpw, 'hour')} per week. These hours are for taking part, not preparing, so they are not in the weekly load above.`,
        );
      }
      if (needH) miss('profile.hours_per_week_available');
    }

    // 准备期（today 到截止日）与另一个机会的参与期重叠。
    if (todayDay == null) return;
    for (const sp of spreads) {
      const prepWork = plannedWorks.find((w) => w.opp.id === sp.id) as Work;
      for (const part of parts) {
        if (part.w.opp.id === sp.id) continue;
        const from = Math.max(todayDay, part.start);
        const to = Math.min(sp.endDay, part.end);
        if (from > to) continue;
        let text = `From ${isoFromDay(from)} to ${isoFromDay(to)}, taking part in ${nameOf(part.w)} (about ${plural(part.hours, 'hour')}/week) overlaps the time before the deadline of ${nameOf(prepWork)}.`;
        if (hpw != null) {
          const left = round2(Math.max(hpw - part.hours, 0));
          text += ` In those days you would have about ${plural(left, 'hour')} per week left for preparing.`;
        }
        text += ' The weekly load above counts preparation only.';
        warnings.push(text);
      }
    }
  }
}
