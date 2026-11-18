# Validation requirements
Written before implementation. Vitest tests now exist under `lib/` (see README "Project status"); baseline D below is not implemented, and no user study or real-world measurement has been done.

## Required behavior
Check unknown eligibility, hard restrictions, task prerequisites, deadlines, travel and cost limits, material reuse and editing costs, evidence-triggered recalculation, approval states and access permissions.

Shared-resource cases must include scarce capacity (5 devices cannot cover 10 simultaneous users), time-slot conflicts, mutually exclusive interventions, fixed/shared cost accounting, original-coverage losses, infeasible fairness floors and zero denominators.

Return OPTIMAL, INFEASIBLE, SEARCH_LIMIT_REACHED or UNSUPPORTED_INPUT as appropriate. A search limit is not proof of infeasibility; show only independently verified candidates and do not claim global optimality.

## Independent checks
Verify eligibility, tasks, costs, timing, capacities, approvals and coverage losses separately from optimization. Cross-check small instances with exhaustive search.

## Comparisons
A: eligibility-only filtering.
B: student constraint planner.
C: organizer intervention planner.
D: fully coordinated separate planners exchanging complete information and shared constraints.
Use equal inputs, rules, budgets, capacities, fairness requirements and compute resources. D may match a joint optimum; do not weaken it to manufacture gains.

Track valid-route discovery, false feasibility, net coverage, fairness compliance, optimality gap, coordination rounds and runtime. Use paired profiles to test irrelevant school-prestige effects while respecting legitimate official requirements.

Synthetic reachability, algorithm correctness, user understanding, actual applications/participation and long-term outcomes are distinct evidence levels.
