/**
 * lib/metrics/student-reliability — 学生端（checkEligibility / analyzeReachability / planRoutes）的可靠性指标。
 *
 * 范围：传入的全部档案 × 全部机会；planRoutes 调用时传 { today, catalog }。每条路线由 ./route-checker
 * （不 import lib/path 的独立检查器）复核，计划级一致性由 checkPlan 复核。
 *
 * 输出只含汇总数字：不含任何档案的 id、显示名、学校名或年龄；机会 id 只在「有问题的路线 / 出错的对」明细里出现
 * （没有问题时明细为空数组）。这是算法在这些（合成的示例）输入上的表现，不是准确率，也不说明真实影响。
 *
 * 纯函数：不读时钟（today 由调用方传入）、无 IO、不修改输入。engines 可注入（测试用来模拟出错的引擎）。
 */
import { checkEligibility } from '../eligibility';
import { analyzeReachability } from '../reachability';
import { planRoutes } from '../path';
import { ROUTE_TYPES } from '../types';
import type { ISODate, Opportunity, RouteType, StudentProfile } from '../types';
import { PLAN_CHECKS, ROUTE_CHECKS, checkPlan, checkRoute } from './route-checker';
import type { PlanCheckName, RouteCheckName } from './route-checker';

export interface StudentEngines {
  checkEligibility: typeof checkEligibility;
  analyzeReachability: typeof analyzeReachability;
  planRoutes: typeof planRoutes;
}

export const DEFAULT_STUDENT_ENGINES: StudentEngines = { checkEligibility, analyzeReachability, planRoutes };

export interface StudentSideInput {
  profiles: StudentProfile[];
  catalog: Opportunity[];
  today: ISODate;
  engines?: Partial<StudentEngines>;
}

export interface ProblemRoute {
  opportunity_id: string;
  route_type: string;
  checks: string[];
}

export interface StudentSideMetrics {
  reference_date: ISODate;
  profiles: number;
  opportunities: number;
  pairs: number;
  /** 引擎抛错的对（不计入下面的统计）；只列机会 id。 */
  engine_errors: { count: number; opportunity_ids: string[] };
  eligibility: { eligible: number; not_eligible: number; unknown: number };
  /**
   * 分母 = 硬性资格不是 not_eligible 的对；三类之和 = 分母。with_feasible_route = 至少一条 true；
   * best_is_unknown = 没有 true、至少一条 null；all_infeasible = 其余（全部 false；万一没有路线也归这里，
   * 那种情况同时会被 checkPlan 报出）。
   */
  route_discovery: {
    denominator: number;
    with_feasible_route: number;
    best_is_unknown: number;
    all_infeasible: number;
    rate: number | null;
  };
  plans: { routes: number; blocked: number };
  routes_total: number;
  routes_by_type: Record<RouteType, number>;
  false_feasibility: { claimed_feasible: number; rejected_by_deadline_check: number };
  checker: {
    routes_checked: number;
    routes_with_problems: number;
    /** 每个检查项不通过的路线条数。 */
    problems_by_check: Record<RouteCheckName, number>;
    plans_checked: number;
    /** blocked_has_no_routes 不通过的计划数。 */
    blocked_plan_violations: number;
    plan_problems_by_check: Record<PlanCheckName, number>;
    /** 有问题的路线（没有问题时为空）。 */
    problem_routes: ProblemRoute[];
    /** 有问题的计划（没有问题时为空）。 */
    problem_plans: { opportunity_id: string; checks: string[] }[];
  };
  unknown_rates: {
    eligibility_items: number;
    eligibility_items_unknown: number;
    eligibility_item_unknown_rate: number | null;
    reachability_null_pairs: number;
    reachability_null_rate: number | null;
    routes_feasibility_null: number;
    routes_feasibility_null_rate: number | null;
  };
}

/**
 * `npm run metrics` 用的固定参考日期（不读系统时间，结果可复现）。与 CONTRACT「真实数据上的结果」一节的日期相同。
 */
export const STUDENT_METRICS_REFERENCE_DATE: ISODate = '2026-11-19';

/** 只留已核实来源的机会：`source_tier ?? 'official'` 为 official，且有 verified_on。 */
export function verifiedOnly(catalog: readonly Opportunity[]): Opportunity[] {
  return catalog.filter(
    (o) => (o.source_tier ?? 'official') === 'official' && typeof o.verified_on === 'string' && o.verified_on !== '',
  );
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

export function measureStudentSide(input: StudentSideInput): StudentSideMetrics {
  const engines: StudentEngines = { ...DEFAULT_STUDENT_ENGINES, ...(input.engines ?? {}) };
  const { profiles, catalog, today } = input;

  const m: StudentSideMetrics = {
    reference_date: today,
    profiles: profiles.length,
    opportunities: catalog.length,
    pairs: 0,
    engine_errors: { count: 0, opportunity_ids: [] },
    eligibility: { eligible: 0, not_eligible: 0, unknown: 0 },
    route_discovery: { denominator: 0, with_feasible_route: 0, best_is_unknown: 0, all_infeasible: 0, rate: null },
    plans: { routes: 0, blocked: 0 },
    routes_total: 0,
    routes_by_type: zeroRecord(ROUTE_TYPES),
    false_feasibility: { claimed_feasible: 0, rejected_by_deadline_check: 0 },
    checker: {
      routes_checked: 0,
      routes_with_problems: 0,
      problems_by_check: zeroRecord(ROUTE_CHECKS),
      plans_checked: 0,
      blocked_plan_violations: 0,
      plan_problems_by_check: zeroRecord(PLAN_CHECKS),
      problem_routes: [],
      problem_plans: [],
    },
    unknown_rates: {
      eligibility_items: 0,
      eligibility_items_unknown: 0,
      eligibility_item_unknown_rate: null,
      reachability_null_pairs: 0,
      reachability_null_rate: null,
      routes_feasibility_null: 0,
      routes_feasibility_null_rate: null,
    },
  };

  let reachabilityPairs = 0;
  for (const profile of profiles) {
    for (const opp of catalog) {
      m.pairs += 1;
      let elig;
      let reach;
      let plan;
      try {
        elig = engines.checkEligibility(profile, opp, { today });
        reach = engines.analyzeReachability(profile, opp, [], { today });
        plan = engines.planRoutes(profile, opp, { today, catalog });
      } catch {
        m.engine_errors.count += 1;
        if (!m.engine_errors.opportunity_ids.includes(opp.id)) m.engine_errors.opportunity_ids.push(opp.id);
        continue;
      }

      m.eligibility[elig.overall] += 1;
      for (const item of elig.items) {
        m.unknown_rates.eligibility_items += 1;
        if (item.status === 'unknown') m.unknown_rates.eligibility_items_unknown += 1;
      }
      reachabilityPairs += 1;
      if (reach.reachable === null) m.unknown_rates.reachability_null_pairs += 1;

      if (plan.status === 'blocked') m.plans.blocked += 1;
      else m.plans.routes += 1;

      const planCheck = checkPlan(profile, opp, plan, { today, catalog });
      m.checker.plans_checked += 1;
      if (!planCheck.ok) {
        const names = [...new Set(planCheck.problems.map((p) => p.check))] as PlanCheckName[];
        for (const n of names) m.checker.plan_problems_by_check[n] += 1;
        if (names.includes('blocked_has_no_routes')) m.checker.blocked_plan_violations += 1;
        m.checker.problem_plans.push({ opportunity_id: opp.id, checks: names });
      }

      const routes = Array.isArray(plan.routes) ? plan.routes : [];
      for (const route of routes) {
        m.routes_total += 1;
        if (route.type in m.routes_by_type) m.routes_by_type[route.type] += 1;
        if (route.feasible_by_deadline === null) m.unknown_rates.routes_feasibility_null += 1;
        const outcome = checkRoute(profile, opp, route, { today, catalog });
        m.checker.routes_checked += 1;
        const names = [...new Set(outcome.problems.map((p) => p.check))] as RouteCheckName[];
        if (route.feasible_by_deadline === true) {
          m.false_feasibility.claimed_feasible += 1;
          if (names.includes('deadline_claim')) m.false_feasibility.rejected_by_deadline_check += 1;
        }
        if (names.length > 0) {
          m.checker.routes_with_problems += 1;
          for (const n of names) m.checker.problems_by_check[n] += 1;
          m.checker.problem_routes.push({ opportunity_id: opp.id, route_type: String(route.type), checks: names });
        }
      }

      if (elig.overall !== 'not_eligible') {
        m.route_discovery.denominator += 1;
        const values = routes.map((r) => r.feasible_by_deadline);
        if (values.includes(true)) m.route_discovery.with_feasible_route += 1;
        else if (values.includes(null)) m.route_discovery.best_is_unknown += 1;
        else m.route_discovery.all_infeasible += 1;
      }
    }
  }

  m.route_discovery.rate = ratio(m.route_discovery.with_feasible_route, m.route_discovery.denominator);
  m.unknown_rates.eligibility_item_unknown_rate = ratio(m.unknown_rates.eligibility_items_unknown, m.unknown_rates.eligibility_items);
  m.unknown_rates.reachability_null_rate = ratio(m.unknown_rates.reachability_null_pairs, reachabilityPairs);
  m.unknown_rates.routes_feasibility_null_rate = ratio(m.unknown_rates.routes_feasibility_null, m.routes_total);
  return m;
}
