/**
 * lib/metrics/format-student — 把 ./student-reliability 的结果排成可读的纯文本表（英文）。
 * 开头写明：合成的示例档案、对数、参考日期；这是算法在这些输入上的表现，不是准确率，不说明真实影响。
 * 纯函数：不读时钟、无 IO、不修改输入。输出只含计数与比例（有问题时附机会 id），不含档案信息。
 */
import { ROUTE_TYPES } from '../types';
import { PLAN_CHECKS, ROUTE_CHECKS } from './route-checker';
import type { StudentSideMetrics } from './student-reliability';

const pct = (r: number | null): string => (r === null ? 'n/a' : `${(r * 100).toFixed(1)}%`);

function table(rows: [string, string][]): string[] {
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`);
}

export function formatStudentSideReport(m: StudentSideMetrics): string {
  const lines: string[] = [];
  lines.push('Student-side route planner (sample profiles × verified catalog)');
  lines.push('='.repeat(64));
  lines.push(`Reference date: ${m.reference_date}`);
  lines.push(
    `Inputs: ${m.profiles} synthetic sample profiles × ${m.opportunities} verified opportunities = ${m.pairs} pairs; no grants.`,
  );
  lines.push(
    'This is how the algorithm behaves on these inputs, checked by an independent route checker that does not import the planner.',
  );
  lines.push('It is not an accuracy figure and says nothing about real-world impact. Reachable / feasible ≠ admitted.');
  if (m.engine_errors.count > 0) {
    lines.push(`Engine errors: ${m.engine_errors.count} pair(s) (opportunities: ${m.engine_errors.opportunity_ids.join(', ')}); not counted below.`);
  }
  lines.push('');

  lines.push('Eligibility (pairs)');
  lines.push(
    ...table([
      ['eligible', String(m.eligibility.eligible)],
      ['not_eligible', String(m.eligibility.not_eligible)],
      ['unknown', String(m.eligibility.unknown)],
    ]),
  );
  lines.push('');

  const d = m.route_discovery;
  lines.push('Valid route discovery (pairs whose hard eligibility is not not_eligible)');
  lines.push(
    ...table([
      ['denominator', String(d.denominator)],
      ['at least one route feasible by deadline', `${d.with_feasible_route} (${pct(d.rate)})`],
      ['best is unknown (null), none true', `${d.best_is_unknown} (${pct(d.denominator ? d.best_is_unknown / d.denominator : null)})`],
      ['all routes false', `${d.all_infeasible} (${pct(d.denominator ? d.all_infeasible / d.denominator : null)})`],
    ]),
  );
  lines.push('');

  lines.push('Plans and routes');
  lines.push(
    ...table([
      ['plans with routes', String(m.plans.routes)],
      ['blocked plans', String(m.plans.blocked)],
      ['routes', String(m.routes_total)],
      ...ROUTE_TYPES.map((t): [string, string] => [`  ${t}`, String(m.routes_by_type[t])]),
    ]),
  );
  lines.push('');

  lines.push('False feasibility (independent deadline check; expected 0)');
  lines.push(
    ...table([
      ['routes claiming feasible_by_deadline = true', String(m.false_feasibility.claimed_feasible)],
      ['of which rejected by deadline_claim', String(m.false_feasibility.rejected_by_deadline_check)],
    ]),
  );
  lines.push('');

  const c = m.checker;
  lines.push('Route checker (routes failing each check; expected 0)');
  lines.push(
    ...table([
      ['routes checked', String(c.routes_checked)],
      ['routes with any problem', String(c.routes_with_problems)],
      ...ROUTE_CHECKS.map((k): [string, string] => [`  ${k}`, String(c.problems_by_check[k])]),
      ['plans checked', String(c.plans_checked)],
      ...PLAN_CHECKS.map((k): [string, string] => [`  ${k}`, String(c.plan_problems_by_check[k])]),
    ]),
  );
  lines.push('  budget_claim: not checked (routes have no structured budget field).');
  for (const r of c.problem_routes) lines.push(`  problem route: ${r.opportunity_id} / ${r.route_type}: ${r.checks.join(', ')}`);
  for (const p of c.problem_plans) lines.push(`  problem plan: ${p.opportunity_id}: ${p.checks.join(', ')}`);
  lines.push('');

  const u = m.unknown_rates;
  lines.push('Unknown rates (information missing, not guessed)');
  lines.push(
    ...table([
      ['eligibility items unknown', `${u.eligibility_items_unknown} / ${u.eligibility_items} (${pct(u.eligibility_item_unknown_rate)})`],
      ['pairs with reachable = null', `${u.reachability_null_pairs} / ${m.pairs - m.engine_errors.count} (${pct(u.reachability_null_rate)})`],
      ['routes with feasible_by_deadline = null', `${u.routes_feasibility_null} / ${m.routes_total} (${pct(u.routes_feasibility_null_rate)})`],
    ]),
  );
  return lines.join('\n');
}
