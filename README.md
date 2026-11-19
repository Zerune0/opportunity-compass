# Opportunity Compass
**A Bridge Between Potential and Opportunity**

Discover Opportunities. Understand the Gap. Grow Through Quests. Take Action.

帮助缺少资源、人脉和专业指导的学生发现真实机会，理解资格、准备差距与现实参与障碍，选择可执行的成长路线，并以技能证据和申请规划采取行动。

## Project status
**Live demo:** https://opportunity-compass-six.vercel.app

**Built for Bridge The Gap Hacks.** The four-day scope is defined in `CONTRACT.md`. This is an independent project; no ExamPilot code is included.

- **Implemented (student-side engine):** four pure functions in `lib/` — `checkEligibility`, `analyzeReachability`, `planRoutes` and `diffRoutes` — with Vitest unit tests, including fairness control tests (`lib/fairness.test.ts`, and `lib/fairness-p2.test.ts` for the four phase 2 functions) showing results do not change when only the school name or display name changes.
- **Implemented (organizer side, simulation only):** `solveJoint` (exact search over support measures and shared-resource allocation, with honest statuses OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT) and `verifyPlan` (an independent verifier that does not import the solver), cross-checked in Vitest against brute-force enumeration; plus the `/organizer` what-if page, which runs on two sample scenarios (`data/scenarios/device-loan.json` and `data/scenarios/venue-tradeoff.json`) and shows only aggregate counts, never individual students. All organizer results are simulated and are not real-world impact.
- **Implemented (organizer side, layer 3, simulation only):** a tradeoff mode (the organizer sets an explicit loss cap before any existing commitment may be revoked; the default protect mode never revokes anything), fairness floors based only on students' self-declared statuses, and a baseline comparison (`compareBaselines`) of A eligibility-only, B student-side planner and C organizer-side planner against the joint solver, all re-checked by the same verifier. Baseline D (a fully coordinated separate planner) from the product docs is **not implemented**. The `/organizer` page can switch between two sample scenarios (`device-loan.json`, `venue-tradeoff.json`). Baselines are deterministic simplifications, not models of any real system; all numbers are simulated.
- **Implemented (student pages):** `/quests` (Quest Board and quest details with official eligibility, preparation readiness and practical reachability shown separately), `/map` (Adventure Map with 2–3 routes and a recommendation replay) and `/passport` (Skill Passport: load one of four clearly labelled sample profiles, add evidence). Student data stays in the browser's localStorage; there is no backend or account system.
- **Opportunities:** `data/opportunities.json` currently holds 12 real opportunities (research, internships, scholarships, a fellowship, a hackathon, a summer program and citizen-science projects), each with an official link, a verification date and the verifier's name. Anything the official page does not state is left as `null` and shown as "unknown"; it is not guessed.
- **Still a placeholder:** the opportunity used in the two sample organizer scenarios is a clearly marked placeholder event, not a real opportunity.
- **Sample profiles:** `data/profiles.json` holds 4 sample profiles (`is_sample: true`, labelled "Sample"): three high-school students and one first-year undergraduate (`sample-noor`, added in phase 2 so undergraduate opportunities can be checked).
- **Known demo limits:** whether a student–opportunity combination can evaluate to "reachable" depends on the opportunity record stating both its fee and its weekly hours. Of the 12 current records, 2 state a fee and 1 states weekly hours; the rest are `null` (unknown, not guessed), so no sample profile currently evaluates to "reachable" on a real opportunity, and the "barrier resolved by a grant" step is shown on the organizer page with sample data. Only one real record lists a preparation item, so cross-opportunity planning (`planAcrossOpportunities`) shows almost no hours on real data yet; its weekly load, conflicts and material reuse are exercised by tests with clearly fictional fixtures.
- **Live demo:** https://opportunity-compass-six.vercel.app (deployed on Vercel from `main`). The app is a static-friendly Next.js build with no environment variables; see "Deploying" below.

### Phase 2 (in progress)
- **Available in `lib/` now:** new shared types (source tier, application materials, gap analysis, alternatives, match explanation, cross-opportunity plan, Quest Journal, plan snapshots, Connect sample types) and new `lib/store.ts` functions (profile and evidence editing, a per-profile Quest Journal, application materials stored once and shared between entries, plan snapshots for replay, and local Connect sample data that refers to students only by an opaque share handle), with Vitest tests. The Quest Journal records four separate things — the student's application, official eligibility confirmation, the admission decision and participation — because submitting is not the same as being confirmed eligible or being admitted. Field and interest tags are compared with `normalizeTag` (`lib/tags.ts`), so `data-science`, `data_science` and `Data Science` count as the same tag.
- **Implemented in `lib/` and shown on Quest Details:** `analyzeGaps` sorts a student's gaps for one opportunity into five groups (knowledge or experience, materials, time and cost, current eligibility limits, unknown info), each with its source and a concrete action; current eligibility limits get no action and no workaround. `findAlternatives` suggests the next round or up to three same-field opportunities from the given catalog, only when the student is actually blocked (not eligible, deadline passed, an unresolved practical barrier, or no route finishes in time); it returns nothing otherwise and never presents an alternative as a prerequisite. Both have Vitest tests.
- **Also implemented in `lib/`:** `explainMatch` explains why one opportunity does or doesn't fit a student, one reason per kind (interest, eligibility, reachability, format, time, cost, device, transport), taken only from the existing eligibility and reachability engines; it gives reasons only, never a score or a ranking, and "within reach" is never presented as admission. `planAcrossOpportunities` lays several opportunities side by side: required hours per opportunity (suggested prep is listed but not counted), materials already marked ready, reusable materials counted once, a day-by-day weekly load, conflicts and program-period overlaps; it never decides which opportunity to drop, and a student's priorities are used only for comparison. Both have Vitest tests.
- **Student pages using them:** Quest Details (`/quests/[id]`) shows the match reasons, the five gap groups, alternatives when the student is blocked, and an "Add to my Quest Journal" button. The new Quest Journal (`/journal`) keeps the four separate status lines, tasks taken from the opportunity's listed preparation steps, the student's materials, and the cross-opportunity plan. The Adventure Map (`/map`) now stores plan snapshots in the browser and replays Before → What changed → After → Why after a refresh. These pages are covered by the `lib/` tests and a manual walk-through, not by automated UI tests.
- **Connect (Quest Creator / Talent Board / invitations)** will be a **local sample demo** only: sample publishers, data kept in the browser, no accounts, no backend and no real connection between people. It is not built yet.
- **Exact age checks (optional date of birth):** a student can add an optional date of birth in Skill Passport. When it is filled in, age requirements are checked with the exact age on the official reference date (birthdays on February 29 count from March 1 in non-leap years), so checks near a birthday no longer come out `unknown`; if it disagrees with the age field, the date of birth is used and the result says so. When it is left blank, age checks work exactly as before (a range inferred from the current age). The date of birth stays in the browser and is never part of a shared profile view. Covered by Vitest tests (`lib/birth-date.test.ts`).

All capabilities described below are product goals unless stated otherwise above.

## Getting started
Requires Node.js >= 20.9 and npm.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # Vitest (lib/**/*.test.ts)
npm run build
```

## Deploying
The app needs no environment variables, database or backend.

- **Vercel:** import the repository, keep the detected Next.js settings (build command `next build`, Node.js 20.9 or newer) and deploy.
- **Anywhere else:** `npm ci && npm run build && npm start`.

After deploying, open `/`, `/quests`, one quest detail page, `/passport` (load a sample profile), `/map?opp=<opportunity id>` and `/organizer`, and confirm each renders.

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
The files in `docs/` are the original product plan, written before any code. They describe the full product goal, not what is built. For what is implemented, use the "Project status" section above and `CONTRACT.md`.

- [Frozen product scope](docs/product-scope.md)
- [Architecture boundaries](docs/architecture.md)
- [Implementation roadmap](docs/roadmap.md)
- [Validation requirements](docs/validation.md)
- [Privacy and evidence rules](docs/privacy-and-evidence.md)
- [Source and decisions](docs/decisions.md)

## Structure
Stack: Next.js (App Router) + TypeScript + Tailwind + Vitest, deployed on Vercel. No backend or database: opportunities and sample profiles live in `data/*.json`; student input stays in browser localStorage.

```text
app/                    Next.js routes: /, /quests, /map, /passport, /journal, /organizer (what-if page, simulated)
lib/                    Pure decision functions, shared types and the localStorage wrapper (tested with Vitest)
components/rpg/         Shared UI components (navigation, quest cards, buttons, status tags)
data/profiles.json      Sample student profiles (is_sample: true)
data/opportunities.json Verified opportunity records (12 so far)
data/scenarios/         Simulated organizer scenarios (is_sample: true)
data/examples/          Explicitly synthetic fixtures
tests/                  Reserved for future behavioral tests
docs/                   Product and engineering plans
```

## 后续计划 / Future work
Not built in the four-day competition scope and **not implemented**:
- Accounts and a database
- Real Quest Creator publishing, a real Talent Board and real consent-based two-way connection (phase 2 plans only a local sample demo of these)
- Opportunity Blind Spots
- Impact Measurement
- Baseline D (a fully coordinated separate planner) in the baseline comparison
- Data loading with runtime validation (a `lib/data.ts` layer that checks `data/*.json` against the shared types at load time).
- Automated UI tests for the pages (only the `lib/` functions have tests).
- Details pages for user-posted opportunities (they are stored in the browser only and have no `/quests/[id]` page).
- Integration with real organizer data (all organizer scenarios are currently sample / simulated).

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
