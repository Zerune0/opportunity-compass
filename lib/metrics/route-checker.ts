/**
 * lib/metrics/route-checker — 学生端路线的独立检查器（与联合求解的 verifyPlan 同一思路：
 * 被检查的引擎给出结果，检查器按 CONTRACT 的文字自己重算一遍，不信引擎自报的标记）。
 *
 * 独立性：本文件**不 import lib/path**（被检查对象），也不 import lib/match、lib/gap、lib/planner、lib/reachability。
 * 只用 lib/types 的类型、lib/eligibility 的 checkEligibility（资格引擎不是被检查对象；只在 checkPlan 里用来判断
 * 「硬性资格 not_eligible 时计划必须 blocked」）与 lib/eligibility/dates 的纯日期解析。有静态守卫测试。
 *
 * 检查项（`check` 名稳定；出处为 CONTRACT.md 的节名 / lib/types.ts 的注释）：
 *  - step_ids_unique      步骤 id 不重复。出处：types.ts `RouteStep.id`「路线内唯一」。
 *  - dependencies_exist   每个 depends_on 指向本路线里存在的步骤、且不指向自己。出处：types.ts `RouteStep.depends_on`
 *                         「依赖的步骤 id（同一路线内）」。
 *  - dependency_order     每一步排在它依赖的所有步骤之后（因此也无环）。出处：CONTRACT ①「Route / RouteStep」一行
 *                         「steps（已按依赖排序）」；types.ts `Route.steps`「已按依赖拓扑排序」。
 *                         注：机会数据本身有依赖环时引擎会强行放入一步并加提醒（lib/path/plan.ts 文件头第 4 条），
 *                         这时本检查如实报出（路线确实没有按依赖排好），不做豁免。
 *  - prep_items_exist     带 prep_item_id 的步骤，对应准备项在这条机会的 preparation 里。出处：types.ts
 *                         `RouteStep.prep_item_id`「对应的准备项 id」；CONTRACT「planAcrossOpportunities」用它找回准备项。
 *  - required_prep_covered 机会里每个 required_for_application: true 的准备项，路线里都有 prep_item_id 指向它的步骤
 *                         （skipped 的也算）。范围：id 为固定步骤 id（submit-application / find-partner）的准备项不算
 *                         （CONTRACT「接入学生端函数的提示」：准备项不要用这些 id）；同一 id 重复时按一项算。
 *                         competition 路线例外（CONTRACT「第四阶段第 1 层：引擎规则」·planRoutes 的 competition 路线：
 *                         「其他步骤照旧，被替代的准备项换成『参加 <候选标题>』一步」，被替代项是实践类准备项，
 *                         可以是申请必需项）：允许至多一个实践类（evidence_kind ∈ project / portfolio /
 *                         competition_result / work_experience / volunteer_experience）必需项缺席，且路线里必须有
 *                         一个带 related_opportunity_id 的竞赛步骤。
 *  - skips_justified      skipped: true 的步骤：skip_reason 非空、satisfied_by_evidence_ids 非空且每个 id 都在档案
 *                         evidence 里；skipped: false 的步骤 satisfied_by_evidence_ids 为空。出处：types.ts
 *                         `RouteStep.skip_reason`「skipped 为 true 时非空」、`satisfied_by_evidence_ids`「让该步骤被跳过的
 *                         证据 id」；CONTRACT「接入学生端函数的提示」「证据跳过步骤」。
 *  - total_hours          total_hours = 未跳过步骤 hours 之和（误差 1e-9）。出处：types.ts `Route.total_hours`
 *                         「未跳过步骤的小时合计」；CONTRACT「证据跳过步骤」「不计入总小时 / 费用」。
 *  - total_cost           total_cost_usd = 未跳过步骤 cost_usd 之和（误差 1e-9）。出处同上（`Route.total_cost_usd`）。
 *  - deadline_claim       只核对 feasible_by_deadline === true 的断言（false / null 不算错误可行）。true 成立需要：
 *                         有可解析的 today（types.ts `EvalOptions`：不传 today 时 feasible_by_deadline 为 null）；
 *                         机会 deadline 可解析（types.ts `Route.feasible_by_deadline`：截止日期未知为 null）；
 *                         档案每周可用小时是有限正数（同上：可用小时未知为 null）；截止日不早于 today
 *                         （CONTRACT「接入学生端函数的提示」：已过截止日期 → 来不及）；并且
 *                         未跳过步骤的小时之和（独立重算，不用引擎的 total_hours）≤ 每周小时 × 天数 / 7，
 *                         天数 = 截止日 − today（「today 到截止日的天数差，不含 today 当天」：CONTRACT
 *                         「planAcrossOpportunities」中 feasible_alone 一条的注意、types.ts `CrossPlanItem.feasible_alone`
 *                         注释）。另外 competition 路线：竞赛步骤对应的候选在 options.catalog 里、而它的
 *                         hours_per_week × total_weeks 算不出（小时未知）时，true 必须改报 null（CONTRACT
 *                         「第四阶段第 1 层：引擎规则」·competition 路线「候选小时未知时 … 改报 null」）。
 *                         说明：截止日就是 today 时天数为 0、容量为 0，按规则文字照算（引擎实现里取 max(天数, 1)，
 *                         规则没有写这一点，所以这种情况下引擎的 true 会被本检查报出——如实报告，不迁就）。
 *  - budget_claim         **未实现**：Route 上没有「预算放得下」的结构化字段，只有 warnings 文本（"Over budget by …"）；
 *                         按任务要求不解析自然语言，所以这一项不检查。
 *  - blocked_has_no_routes（计划级，checkPlan）：status === 'blocked' 时 routes 为空；checkEligibility 判 not_eligible 时
 *                         计划必须 blocked；计划 blocked 时 checkEligibility 必须是 not_eligible。出处：CONTRACT
 *                         「接入学生端函数的提示」「硬性不满足不给绕过路线」；types.ts `PlanResult` 注释。
 *  - route_count         （计划级）status === 'routes' 时非 competition 路线 2–3 条，路线类型不重复，competition 至多一条且排在最后。
 *                         出处：CONTRACT ①「PlanResult」一行（2–3 条；传了 catalog 时可能在最后多一条 competition，最多 4 条）。
 *
 * 没有检查的方面（CONTRACT 没有写成可核对的规则，或需要引擎内部口径）：
 *  - 「应该被跳过却没跳过」：证据覆盖准备项的完整口径（按技能匹配等）只写在 lib/reachability/coverage.ts，CONTRACT 只写了
 *    prep_item_ids 的建议写法，所以只核对被跳过步骤引用的证据存在，不核对证据是否真的覆盖、也不找漏跳的步骤。
 *  - feasible_by_deadline 为 false / null 时是否「本该是 true」（漏报可行）：不属于错误可行，不查。
 *  - estimated_weeks 的取整方式（types.ts 只写「完成需要的周数」）、rationale / warnings / description 的文字。
 *  - 各路线的排序优先级（学习优先 / 实践优先 / 社区）只是偏好，不查；只查依赖顺序。
 *  - competition 步骤的小时 / 费用是否等于候选记录（规则有，但不在本任务的检查清单里）；候选不在传入的 catalog 时不核对
 *    竞赛小时是否已知。
 *  - submit-application 是否依赖其他全部步骤、find-partner 是否 2 小时（只写在引擎文件头）。
 *  - 预算（见 budget_claim）。
 *
 * 纯函数：不读时钟（today 由调用方传入）、无 IO、不修改输入；遇到坏数据不抛异常，报成问题。
 */
import { checkEligibility } from '../eligibility';
import { daysBetween, parseISODate } from '../eligibility/dates';
import type { EvidenceKind, ISODate, Opportunity, PlanResult, Route, StudentProfile } from '../types';

export type RouteCheckName =
  | 'step_ids_unique'
  | 'dependencies_exist'
  | 'dependency_order'
  | 'prep_items_exist'
  | 'required_prep_covered'
  | 'skips_justified'
  | 'total_hours'
  | 'total_cost'
  | 'deadline_claim';

export type PlanCheckName = 'blocked_has_no_routes' | 'route_count';

/** 检查器实现的全部检查项（budget_claim 未实现，见文件头）。 */
export const ROUTE_CHECKS: readonly RouteCheckName[] = [
  'step_ids_unique',
  'dependencies_exist',
  'dependency_order',
  'prep_items_exist',
  'required_prep_covered',
  'skips_justified',
  'total_hours',
  'total_cost',
  'deadline_claim',
];

export const PLAN_CHECKS: readonly PlanCheckName[] = ['blocked_has_no_routes', 'route_count'];

export interface CheckProblem {
  check: RouteCheckName | PlanCheckName;
  detail: string;
}

export interface CheckOutcome {
  ok: boolean;
  problems: CheckProblem[];
}

export interface RouteCheckOptions {
  today?: ISODate;
  /** 已核实目录；用来核对 competition 步骤指向的候选小时是否已知。 */
  catalog?: Opportunity[];
}

/** CONTRACT「接入学生端函数的提示」：固定步骤 id，准备项不要用。 */
const RESERVED_STEP_IDS: readonly string[] = ['submit-application', 'find-partner'];

/** CONTRACT「第四阶段第 1 层：引擎规则」：实践类准备项的 evidence_kind（口径同 practice_first）。 */
const PRACTICE_KINDS: readonly EvidenceKind[] = [
  'project',
  'portfolio',
  'competition_result',
  'work_experience',
  'volunteer_experience',
];

const EPS = 1e-9;

const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const finiteNonNeg = (n: unknown): number | null => (isFiniteNumber(n) && n >= 0 ? n : null);

/** 独立核对一条路线。 */
export function checkRoute(
  profile: StudentProfile,
  opp: Opportunity,
  route: Route,
  options: RouteCheckOptions = {},
): CheckOutcome {
  const problems: CheckProblem[] = [];
  const add = (check: RouteCheckName, detail: string) => problems.push({ check, detail });
  const steps = Array.isArray(route?.steps) ? route.steps : [];
  if (!Array.isArray(route?.steps)) add('dependency_order', 'route.steps is not an array');

  // 1. step_ids_unique
  const seen = new Set<string>();
  for (const s of steps) {
    if (seen.has(s.id)) add('step_ids_unique', `step id "${s.id}" appears more than once`);
    seen.add(s.id);
  }

  // 2 + 3. dependencies_exist / dependency_order
  const position = new Map<string, number>();
  steps.forEach((s, i) => {
    if (!position.has(s.id)) position.set(s.id, i);
  });
  steps.forEach((s, i) => {
    const deps = Array.isArray(s.depends_on) ? s.depends_on : [];
    if (!Array.isArray(s.depends_on)) add('dependencies_exist', `step "${s.id}" has no depends_on array`);
    for (const d of deps) {
      if (d === s.id) {
        add('dependencies_exist', `step "${s.id}" depends on itself`);
        continue;
      }
      const p = position.get(d);
      if (p === undefined) {
        add('dependencies_exist', `step "${s.id}" depends on "${d}", which is not a step of this route`);
        continue;
      }
      if (p >= i) add('dependency_order', `step "${s.id}" (position ${i}) comes before its dependency "${d}" (position ${p})`);
    }
  });

  // 4. prep_items_exist
  const preps = (Array.isArray(opp?.preparation) ? opp.preparation : []).filter(
    (p) => p != null && typeof p === 'object' && typeof p.id === 'string',
  );
  const prepIds = new Set(preps.map((p) => p.id));
  for (const s of steps) {
    const pid = s.prep_item_id;
    if (pid == null) continue;
    if (!prepIds.has(pid)) add('prep_items_exist', `step "${s.id}" points to prep item "${pid}", which is not in this opportunity's preparation`);
  }

  // 5. required_prep_covered
  const stepPrepIds = new Set(steps.map((s) => s.prep_item_id).filter((x): x is string => typeof x === 'string'));
  const requiredSeen = new Set<string>();
  const missing: { id: string; practice: boolean }[] = [];
  for (const p of preps) {
    if (RESERVED_STEP_IDS.includes(p.id) || requiredSeen.has(p.id)) continue;
    requiredSeen.add(p.id);
    if (p.required_for_application !== true) continue;
    if (!stepPrepIds.has(p.id)) {
      missing.push({ id: p.id, practice: p.evidence_kind != null && PRACTICE_KINDS.includes(p.evidence_kind) });
    }
  }
  if (missing.length > 0) {
    const competitionStep = steps.find((s) => typeof s.related_opportunity_id === 'string' && s.related_opportunity_id !== '');
    const replaceable = route.type === 'competition' && competitionStep != null && missing.length === 1 && missing[0].practice;
    if (!replaceable) {
      for (const m of missing) {
        add('required_prep_covered', `required prep item "${m.id}" has no step in this ${String(route.type)} route`);
      }
    }
  }

  // 6. skips_justified
  const evidenceIds = new Set(
    (Array.isArray(profile?.evidence) ? profile.evidence : [])
      .filter((e) => e != null && typeof e.id === 'string')
      .map((e) => e.id),
  );
  for (const s of steps) {
    const evIds = Array.isArray(s.satisfied_by_evidence_ids) ? s.satisfied_by_evidence_ids : [];
    if (s.skipped === true) {
      if (typeof s.skip_reason !== 'string' || s.skip_reason.trim() === '') {
        add('skips_justified', `step "${s.id}" is skipped but has no skip_reason`);
      }
      if (evIds.length === 0) add('skips_justified', `step "${s.id}" is skipped but lists no evidence`);
      for (const e of evIds) {
        if (!evidenceIds.has(e)) add('skips_justified', `step "${s.id}" is skipped by evidence "${e}", which is not in the profile`);
      }
    } else if (evIds.length > 0) {
      add('skips_justified', `step "${s.id}" is not skipped but lists satisfying evidence`);
    }
  }

  // 7 + 8. total_hours / total_cost
  const active = steps.filter((s) => s.skipped !== true);
  const sumHours = active.reduce((sum, s) => sum + (isFiniteNumber(s.hours) ? s.hours : NaN), 0);
  const sumCost = active.reduce((sum, s) => sum + (isFiniteNumber(s.cost_usd) ? s.cost_usd : NaN), 0);
  if (!isFiniteNumber(sumHours) || !isFiniteNumber(route.total_hours) || Math.abs(sumHours - route.total_hours) > EPS) {
    add('total_hours', `total_hours is ${String(route.total_hours)}, but the steps that are not skipped add up to ${String(sumHours)}`);
  }
  if (!isFiniteNumber(sumCost) || !isFiniteNumber(route.total_cost_usd) || Math.abs(sumCost - route.total_cost_usd) > EPS) {
    add('total_cost', `total_cost_usd is ${String(route.total_cost_usd)}, but the steps that are not skipped add up to ${String(sumCost)}`);
  }

  // 9. deadline_claim（只核对 true）
  if (route.feasible_by_deadline === true) {
    const reasons = deadlineClaimProblems(profile, opp, route, sumHours, options);
    for (const r of reasons) add('deadline_claim', r);
  }

  return { ok: problems.length === 0, problems };
}

/** feasible_by_deadline === true 不成立的原因（空数组 = 成立）。 */
function deadlineClaimProblems(
  profile: StudentProfile,
  opp: Opportunity,
  route: Route,
  activeHours: number,
  options: RouteCheckOptions,
): string[] {
  const out: string[] = [];
  const today = options.today == null ? null : parseISODate(options.today);
  if (options.today == null) out.push('claims feasible by deadline, but no today was given (the rule says null)');
  else if (today == null) out.push(`claims feasible by deadline, but today "${options.today}" cannot be read (the rule says null)`);

  const deadline = opp?.deadline == null ? null : parseISODate(opp.deadline);
  if (opp?.deadline == null) out.push('claims feasible by deadline, but the opportunity has no deadline (the rule says null)');
  else if (deadline == null) out.push(`claims feasible by deadline, but the deadline "${String(opp.deadline)}" cannot be read (the rule says null)`);

  const hpwRaw = profile?.hours_per_week_available;
  const hpw = isFiniteNumber(hpwRaw) && hpwRaw > 0 ? hpwRaw : null;
  if (hpwRaw == null) out.push('claims feasible by deadline, but the profile has no weekly available hours (the rule says null)');
  else if (hpw == null) out.push(`claims feasible by deadline, but the weekly available hours (${String(hpwRaw)}) are not a positive number`);

  // competition：候选小时未知时 true 必须改报 null。
  if (route.type === 'competition' && Array.isArray(options.catalog)) {
    for (const s of route.steps ?? []) {
      const rid = s.related_opportunity_id;
      if (typeof rid !== 'string' || rid === '') continue;
      const cand = options.catalog.find((c) => c?.id === rid);
      if (!cand) continue;
      const h = finiteNonNeg(cand.time_commitment?.hours_per_week);
      const w = finiteNonNeg(cand.time_commitment?.total_weeks);
      if (h == null || w == null) {
        out.push(`claims feasible by deadline, but the time needed for "${rid}" is not stated, so the total is only a minimum (the rule says null)`);
      }
    }
  }

  if (today != null && deadline != null) {
    const days = daysBetween(today, deadline);
    if (days < 0) {
      out.push(`claims feasible by deadline, but the deadline ${String(opp.deadline)} is before today ${String(options.today)}`);
    } else if (hpw != null) {
      const capacity = (hpw * days) / 7;
      if (!isFiniteNumber(activeHours) || activeHours > capacity + EPS) {
        out.push(
          `claims feasible by deadline, but ${String(activeHours)} hours do not fit in ${days} days at ${hpw} hours per week (capacity ${capacity.toFixed(2)} hours)`,
        );
      }
    }
  }
  return out;
}

/** 计划级检查：blocked 与资格的一致性、路线条数。 */
export function checkPlan(
  profile: StudentProfile,
  opp: Opportunity,
  plan: PlanResult,
  options: RouteCheckOptions = {},
): CheckOutcome {
  const problems: CheckProblem[] = [];
  const add = (check: PlanCheckName, detail: string) => problems.push({ check, detail });
  let overall: string | null = null;
  try {
    overall = checkEligibility(profile, opp, { today: options.today }).overall;
  } catch {
    overall = null;
  }
  const routes: Route[] = Array.isArray(plan?.routes) ? plan.routes : [];

  if (plan.status === 'blocked') {
    if (routes.length > 0) add('blocked_has_no_routes', `plan is blocked but has ${routes.length} route(s)`);
    if (overall !== 'not_eligible') add('blocked_has_no_routes', `plan is blocked, but eligibility is ${String(overall)}, not not_eligible`);
  } else {
    if (overall === 'not_eligible') add('blocked_has_no_routes', 'eligibility is not_eligible, but the plan is not blocked');
    const types = routes.map((r) => r.type);
    const base = types.filter((t) => t !== 'competition').length;
    if (base < 2 || base > 3) add('route_count', `plan has ${base} non-competition route(s); the rule says 2–3`);
    if (new Set(types).size !== types.length) add('route_count', `route types repeat: ${types.join(', ')}`);
    const compIdx = types.indexOf('competition');
    if (compIdx !== -1 && compIdx !== types.length - 1) add('route_count', 'the competition route is not last');
  }
  return { ok: problems.length === 0, problems };
}
