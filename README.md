# Opportunity Compass
**A Bridge Between Potential and Opportunity**

Discover Opportunities. Understand the Gap. Grow Through Quests. Take Action.

帮助缺少资源、人脉和专业指导的学生发现真实机会，理解资格、准备差距与现实参与障碍，选择可执行的成长路线，并以技能证据和申请规划采取行动。

## Project status
**Work in progress for Bridge The Gap Hacks; not yet deployed.** The four-day scope is defined in `CONTRACT.md`. This is an independent project; no ExamPilot code is included.

- **Implemented (student-side engine):** four pure functions in `lib/` — `checkEligibility`, `analyzeReachability`, `planRoutes` and `diffRoutes` — with Vitest unit tests, including fairness control tests (`lib/fairness.test.ts`) showing results do not change when only the school name or display name changes.
- **Implemented (organizer side, simulation only):** `solveJoint` (exact search over support measures and shared-resource allocation, with honest statuses OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT) and `verifyPlan` (an independent verifier that does not import the solver), cross-checked in Vitest against brute-force enumeration; plus the `/organizer` what-if page, which runs on a sample scenario (`data/scenarios/device-loan.json`) and shows only aggregate counts, never individual students. All organizer results are simulated and are not real-world impact.
- **Still placeholders:** the `/quests`, `/map` and `/passport` pages, and the opportunity used in the sample organizer scenario (a clearly marked placeholder event).
- **No verified opportunities yet:** `data/opportunities.json` does not yet contain verified real opportunities; tests use clearly fictional fixtures (example.com, `is_sample: true`).
- **Not deployed** yet.

All capabilities described below are product goals unless stated otherwise above.

## Getting started
Requires Node.js >= 20.9 and npm.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # Vitest (lib/**/*.test.ts)
npm run build
```

## Student-first product
1. **Discover:** verified opportunity cards with official links, deadlines, restrictions, source trust and verification dates.
2. **Understand:** distinguish official eligibility (Satisfied / Not Satisfied / Unknown), preparation readiness, and practical reachability.
3. **Grow:** reverse-plan from a real target; compare routes with dependencies, time, cost and resource constraints; adapt when evidence or availability changes.
4. **Evidence:** Skill Passport with self-reported, attached, reviewed and unverified states; explain recommendation changes through decision replay.
5. **Apply:** coordinate multiple opportunities, reuse appropriate materials, maintain a Quest Journal and distinguish preparation, submission, participation and outcomes.

Engine principles (student-side functions in `lib/`):
- Missing or unclear information yields `unknown`, with a prompt to confirm with the official source; the engine does not guess.
- If a hard eligibility requirement is not met, `planRoutes` returns no workaround route — only the reason, quoted official text and next-cycle / same-field hints.
- "Reachable" means practically within reach given time, cost, transport and devices; it is not admission or acceptance.
- Decision functions do not read the student's school name or display name.

Adventure View and Classic View should support equivalent tasks. RPG progress must never create official eligibility requirements or block direct applications.

## Supporting modules
- **Connect:** verified Quest Creator publishing, optional field-level Talent Board sharing and consent-based two-way matching.
- **Organizer Intelligence:** aggregated barrier reports and what-if support scenarios. Shared resources must be included in student reachability calculations without double allocation.
- **Verification:** independent feasibility checks, strong baselines, fairness audits and honest solver statuses.

Organizer tools support the student journey; they do not replace it.

## Documentation
- [Frozen product scope](docs/product-scope.md)
- [Architecture boundaries](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Validation requirements](docs/validation.md)
- [Privacy and evidence rules](docs/privacy-and-evidence.md)
- [Source and decisions](docs/decisions.md)

## Structure
Stack: Next.js (App Router) + TypeScript + Tailwind + Vitest, deployed on Vercel. No backend or database: opportunities and sample profiles live in `data/*.json`; student input stays in browser localStorage.

```text
app/                    Next.js routes: /, /quests, /map, /passport (placeholders for now), /organizer (what-if page, simulated)
lib/                    Pure decision functions and shared types (tested with Vitest)
components/             Shared UI components (planned)
data/profiles.json      Sample student profiles (is_sample: true)
data/opportunities.json Verified opportunity records (planned)
data/scenarios/         Simulated organizer scenarios (is_sample: true)
data/examples/          Explicitly synthetic fixtures
tests/                  Reserved for future behavioral tests
docs/                   Product and engineering plans
```

## 后续计划 / Future work
Not built in the four-day competition scope and **not implemented**:
- Accounts and a database
- Quest Creator (verified organizer publishing)
- Talent Board (optional field-level sharing)
- Consent-based two-way matching
- Data loading with runtime validation (a `lib/data.ts` layer that checks `data/*.json` against the shared types at load time).
- Exact age calculation from date of birth (age on the reference date is currently inferred as a range from the student's current age, so age checks near a birthday can come out `unknown`).
- Automatic recommendation of same-field alternative opportunities (currently only a text hint is shown).
- Integration with real organizer data (all organizer scenarios are currently sample / simulated).

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
