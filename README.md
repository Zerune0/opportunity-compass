# Opportunity Compass
**A Bridge Between Potential and Opportunity**

Discover Opportunities. Understand the Gap. Grow Through Quests. Take Action.

帮助缺少资源、人脉和专业指导的学生发现真实机会，理解资格、准备差距与现实参与障碍，选择可执行的成长路线，并以技能证据和申请规划采取行动。

## Project status
**Live demo:** https://opportunity-compass-six.vercel.app (deployed on Vercel from `main`; a static-friendly Next.js build with no environment variables, see "Deploying" below).

**Built for Bridge The Gap Hacks.** The four-day scope is defined in `CONTRACT.md`. This is an independent project; no ExamPilot code is included.

### Live now
What you can open and use on the live site. All student data stays in this browser's localStorage; there are no accounts and no backend.

- **Home (`/`)** with the demo steps; every top-level page is reachable from the site navigation or the home page (quest details open from the Quest Board).
- **Quest Board (`/quests`):** the 13 real opportunities in `data/opportunities.json`, with filters (collapsed behind a toggle on phones), keyword search, a "closing within 30 days" filter and a fee limit (records with an unstated fee are never treated as free; the page says how many are hidden), filters kept in the page address, saved quests with a side-by-side comparison of the saved ones (facts only, no ranking), how long ago each record was verified, and a source-tier label on each card.
- **Quest Details (`/quests/[id]`):** a "Questions to ask the organizer" draft built only from what the engines report as unconfirmed (requirements the organizer has to confirm and facts the record does not state; gaps in the student's own profile are listed separately and never go into the message; nothing is sent and no contact address is invented), plus official eligibility per requirement (Satisfied / Not Satisfied / Unknown, with the quoted official text), match reasons (reasons only, never a score or ranking), five gap groups (knowledge or experience, materials, time and cost, current eligibility limits, unknown info), alternatives shown only when the student is blocked, a "Support received" section, and "Add to my Quest Journal". On the live site the "Support received" section stays empty unless support records are imported from a `/data` backup file, because no page writes organizer support yet.
- **Adventure Map (`/map`):** 2–3 routes (learning first, practice first, community) with dependencies, hours, cost and whether they finish before the deadline; a Classic View of the same routes; and a replay of Before → What changed → After → Why, stored as plan snapshots (a snapshot is also recorded when evidence is linked to a preparation step).
- **Skill Passport (`/passport`):** edit your own profile (including an optional date of birth for exact age checks), or load one of 4 clearly labelled sample profiles; add, edit and remove evidence, and link evidence to an opportunity's preparation steps.
- **Quest Journal (`/journal`):** four separate status lines per quest (your application, official eligibility confirmation, the admission decision, participation), corrections and back-dated entries, tasks from the opportunity's preparation steps, application materials stored once and shared between quests, a cross-quest plan (weekly load, conflicts, material reuse), deadline export to a calendar file (.ics), "Print this plan", and section jump links.
- **Your data (`/data`):** see what is stored in this browser, download it as one JSON file, import such a file (it replaces what is stored; no merging), or delete it all. This is a manual backup file, not sync.
- **Organizer what-if (`/organizer`):** a simulation page (see the next section) that runs the joint solver and the independent verifier on sample scenarios and shows aggregate counts only, never individual students.

Behind these pages are pure functions in `lib/`, all with Vitest tests: `checkEligibility`, `analyzeReachability`, `planRoutes`, `diffRoutes`, `analyzeGaps`, `findAlternatives`, `explainMatch`, `planAcrossOpportunities`, `solveJoint`, `verifyPlan` and `compareBaselines`. `npm test` currently runs 2,500 tests in 53 files (41 under `lib/`, 12 under `app/`), including fairness control tests (`lib/fairness.test.ts`, `lib/fairness-p2.test.ts`, `lib/fairness-p4.test.ts`) showing results do not change when only the school name or display name changes, and an end-to-end engine test of the demo path (`lib/demo-mainline.test.ts`).

Engine additions in this round (rules in `CONTRACT.md`, tests in `lib/engine-p4.test.ts` and `lib/fairness-p4.test.ts`): `planRoutes` can add a "Beginner competition" route when it is given the verified catalog and finds a related hackathon or competition that ends before the target's deadline, and every route step now says how it relates to the target, whether it is an official requirement, a team suggestion or the application itself, and what evidence it produces. `findAlternatives` can add evidence-building steps (`stepping_stone`, always worded as "not a prerequisite") and online options (`remote_option`; for a hybrid target it only says to confirm with the organizer), and `analyzeGaps` reads an opportunity's team requirement when one is recorded. On the 13 opportunities and 4 sample profiles as of 2026-11-19 these appear rarely, and we report that as is: 1 competition route (the sample profile Noor preparing for the Rutgers Newark summer research program is offered HackRare 2027, a rare-disease hackathon in the same field that ends before the Rutgers deadline; because HackRare does not state the hours it takes, the route says it cannot tell yet whether it fits before the deadline, and it notes that travel is not counted), 0 evidence-building steps, 0 online options (the Dan Herbatschek Fellowship is recorded with an unknown participation format because its official pages do not state one), and 1 team requirement (HackRare: teams of 2–5). All three kinds are produced in tests with clearly fictional fixtures. The Adventure Map passes the verified catalog to `planRoutes`, so a competition route would be shown as soon as the catalog contains a fitting competition.

### Simulated or sample
- **Sample profiles:** `data/profiles.json` holds 4 sample profiles (`is_sample: true`, labelled "Sample"): three high-school students and one first-year undergraduate.
- **Organizer side is simulation only.** `/organizer` runs on three sample scenarios (`data/scenarios/device-loan.json`, `data/scenarios/venue-tradeoff.json`, `data/scenarios/shared-support.json`) whose opportunities are clearly marked placeholder events, not real opportunities. `solveJoint` does an exact search over support measures and shared resources and reports honest statuses (OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT); `verifyPlan` re-checks every plan without importing the solver. The page also offers a tradeoff mode with an explicit loss cap, fairness floors based only on self-declared statuses, and a baseline comparison (A eligibility-only, B student-side planner, C organizer-side planner) against the joint solver. Baselines are deterministic simplifications, not models of any real system. All organizer numbers are simulated and are not real-world impact.
- **Organizer support shown to students is simulated.** Support records ("grants") are always stored with `is_sample: true` and shown as "Simulated support". Only approved support resolves a barrier; pending support is shown as not in effect yet. "Reachable" means practically within reach given time, cost, transport and devices; it is not admission.
- **Applying an organizer plan back to the student side is not wired up in the UI.** The storage functions for it exist (`addGrants`, `removeGrants`, `grantsByIntervention` in `lib/store.ts`, with tests), but no page calls them yet.

### Not built
- **Connect** (Quest Creator, Talent Board, invitations): there are sample types and local storage functions in `lib/`, but **no pages**, not even a local sample demo.
- The organizer action that writes approved support back to the student side (see above).
- Everything under "Future work" below.

### Known demo limits
- Whether a student–opportunity pair can come out "reachable" depends on the opportunity record stating its fee, travel expectations and weekly hours. Of the 13 real records, 6 state a fee, 6 state whether travel must be self-paid and 2 state weekly hours; everything else is `null` (unknown, not guessed).
- As a result, **none of the 4 sample profiles evaluates to "reachable" on any real opportunity** (checked for all 52 pairs with `analyzeReachability` and no organizer support, evaluated on 2026-11-19): 30 pairs show "Reachability: Unknown" (missing information) and 22 show "Open barriers" (a hard requirement is not met, or there is an unresolved time or transport barrier). The "barrier resolved by approved support → reachable" step is therefore demonstrated with clearly fictional fixtures in tests and on the organizer page, not on real opportunities.
- All 13 real records list preparation steps, but few steps are marked as reusable materials, so material reuse in the cross-quest plan is mostly exercised by tests with fictional fixtures.
- The last step of the demo, "approved organizer support makes a student reachable", runs end to end as a **local demo on sample data**: load the sample profile Maya in Skill Passport, open `/organizer`, switch to the third scenario ("laptop loans and transport support"), and use "Write simulated support for the loaded sample profile". Only a plan that is OPTIMAL and passed the independent verifier can be written, pending measures are never written, every grant is marked simulated, and "Undo" removes exactly what was written. Quest Details for the sample opportunity then changes from "Not reachable right now" to reachable, and back after undo. The opportunity in that scenario is a placeholder (`placeholder-inperson-event`), not a real one: no real opportunity in the catalog states enough facts for this step. Nothing leaves the browser, and this is not how a real organizer would deliver support.
- Pages are covered by the `lib/` tests, a few `app/` view-model tests and manual walk-throughs, not by automated UI tests. The calendar file has not been tested by importing it into real calendar apps.

All capabilities described below are product goals unless stated otherwise above.

## How AI is used
AI assistants were used while building this project (writing and reviewing code, tests and documents). **The running product does not call any AI model.** Every eligibility result, barrier, route, gap, match reason and organizer plan is produced by the deterministic, tested functions in `lib/`, so the same input always gives the same output, and missing information comes out as "unknown" instead of a guess. Opportunity records are checked by a person against the official page; AI-suggested opportunity details are not used as data.

## Getting started
Requires Node.js >= 20.9 and npm.

```bash
npm install
npm run dev     # http://localhost:3000
npm test        # Vitest (lib/**/*.test.ts and app/**/*.test.ts)
npm run build
```

## Deploying
The app needs no environment variables, database or backend.

- **Vercel:** import the repository, keep the detected Next.js settings (build command `next build`, Node.js 20.9 or newer) and deploy.
- **Anywhere else:** `npm ci && npm run build && npm start`.

After deploying, open `/`, `/quests`, one quest detail page, `/passport` (load a sample profile), `/map?opp=<opportunity id>`, `/journal`, `/data` and `/organizer`, and confirm each renders.

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
app/                    Next.js routes:
  page.tsx                /           home and demo path
  quests/                 /quests     Quest Board; /quests/[id] Quest Details
  map/                    /map        Adventure Map, Classic View, recommendation replay
  passport/               /passport   Skill Passport (profile, sample profiles, evidence)
  journal/                /journal    Quest Journal (status lines, tasks, materials, cross-quest plan, .ics, print)
  data/                   /data       Your data: export / import / clear this browser's data
  organizer/              /organizer  What-if page (simulated, sample scenarios)
lib/                    Pure decision functions, shared types and storage (tested with Vitest)
  types.ts                shared types
  eligibility/            checkEligibility (incl. exact age from an optional date of birth)
  reachability/           analyzeReachability
  path/                   planRoutes, diffRoutes
  gap/                    analyzeGaps
  match/                  findAlternatives, explainMatch
  planner/                planAcrossOpportunities
  joint/                  solveJoint, verifyPlan, compareBaselines, what-if view model
  journal.ts              Quest Journal events (pure)
  store.ts                localStorage wrapper (profile, evidence, saved quests, grants, journal, materials, snapshots)
  backup.ts               export / import file checks for /data
  calendar.ts             .ics deadline export
  data.ts, validation.ts  validated loading of data/*.json
  tags.ts, format.ts, requirement-timing.ts  shared helpers
components/rpg/         Shared UI components (navigation, quest cards, buttons, status tags)
data/profiles.json      Sample student profiles (4, is_sample: true)
data/opportunities.json Verified opportunity records (13)
data/scenarios/         Simulated organizer scenarios (is_sample: true)
data/examples/          Reserved for clearly synthetic fixtures (currently empty)
tests/                  Reserved for future behavioral tests
docs/                   Product and engineering plans
```

## 后续计划 / Future work
Not built in the four-day competition scope and **not implemented**:
- Accounts and a database (data stays in one browser; the `/data` backup file is manual, not sync).
- Real Quest Creator publishing, a real Talent Board and real consent-based two-way connection. Not even a local sample demo of these has pages yet.
- Applying an organizer plan to the student side for a real opportunity and a real student (today this is a local demo with a sample profile and a placeholder opportunity).
- Integration with real organizer data (all organizer scenarios are sample / simulated).
- AI assistance inside the product (for example organizing opportunity information or wording explanations). It would need a server to hold an API key, which conflicts with the no-backend design, and explanations are currently rule-generated and reproducible.
- Opportunity Blind Spots. With 13 opportunities and no real regional demand data there is nothing honest to report.
- Impact Measurement. It needs voluntary data from real users; only the student's own outcome notes in the Quest Journal exist.
- Baseline D (a fully coordinated separate planner) in the baseline comparison.
- Automated UI tests for the pages.
- More complete opportunity records (fees, travel and weekly hours) so real opportunities can be evaluated as reachable.

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
