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
- **Skill Passport (`/passport`):** edit your own profile (including an optional date of birth for exact age checks), or load one of 4 clearly labelled sample profiles; add, edit and remove evidence, and link evidence to an opportunity's preparation steps. In Adventure View the saved evidence is shown as an inventory grid; Classic View keeps the plain cards. Both offer exactly the same actions.
- **Quest Journal (`/journal`):** in Adventure View each quest is a quest card and in Classic View a plain card, with the same controls in both; four separate status lines per quest (your application, official eligibility confirmation, the admission decision, participation), corrections and back-dated entries, tasks from the opportunity's preparation steps, application materials stored once and shared between quests, a cross-quest plan (weekly load, conflicts, material reuse), deadline export to a calendar file (.ics), "Print this plan", and section jump links.
- **Your data (`/data`):** see what is stored in this browser, download it as one JSON file, import such a file (it replaces what is stored; no merging), or delete it all. This is a manual backup file, not sync.
- **Organizer what-if (`/organizer`):** a simulation page (see the next section) that runs the joint solver and the independent verifier on sample scenarios and shows aggregate counts only, never individual students.

Behind these pages are pure functions in `lib/`, all with Vitest tests: `checkEligibility`, `analyzeReachability`, `planRoutes`, `diffRoutes`, `analyzeGaps`, `findAlternatives`, `explainMatch`, `planAcrossOpportunities`, `solveJoint`, `verifyPlan` and `compareBaselines`. `npm test` currently runs 2,991 tests in 73 files (55 under `lib/`, 18 under `app/`), including fairness control tests (`lib/fairness.test.ts`, `lib/fairness-p2.test.ts`, `lib/fairness-p4.test.ts`) showing results do not change when only the school name or display name changes, and an end-to-end engine test of the demo path (`lib/demo-mainline.test.ts`).

Engine additions in this round (rules in `CONTRACT.md`, tests in `lib/engine-p4.test.ts` and `lib/fairness-p4.test.ts`): `planRoutes` can add a "Beginner competition" route when it is given the verified catalog and finds a related hackathon or competition that ends before the target's deadline, and every route step now says how it relates to the target, whether it is an official requirement, a team suggestion or the application itself, and what evidence it produces. `findAlternatives` can add evidence-building steps (`stepping_stone`, always worded as "not a prerequisite") and online options (`remote_option`; for a hybrid target it only says to confirm with the organizer), and `analyzeGaps` reads an opportunity's team requirement when one is recorded. On the 13 opportunities and 4 sample profiles as of 2026-11-19 these appear rarely, and we report that as is: 1 competition route (the sample profile Noor preparing for the Rutgers Newark summer research program is offered HackRare 2027, a rare-disease hackathon in the same field that ends before the Rutgers deadline; because HackRare does not state the hours it takes, the route says it cannot tell yet whether it fits before the deadline, and it notes that travel is not counted), 0 evidence-building steps, 0 online options (the Dan Herbatschek Fellowship is recorded with an unknown participation format because its official pages do not state one), and 1 team requirement (HackRare: teams of 2–5). All three kinds are produced in tests with clearly fictional fixtures. The Adventure Map passes the verified catalog to `planRoutes`, so a competition route would be shown as soon as the catalog contains a fitting competition.

### Simulated or sample
- **Sample profiles:** `data/profiles.json` holds 4 sample profiles (`is_sample: true`, labelled "Sample"): three high-school students and one first-year undergraduate.
- **Organizer side is simulation only.** `/organizer` runs on three sample scenarios (`data/scenarios/device-loan.json`, `data/scenarios/venue-tradeoff.json`, `data/scenarios/shared-support.json`) whose opportunities are clearly marked placeholder events, not real opportunities. `solveJoint` does an exact search over support measures and shared resources and reports honest statuses (OPTIMAL / INFEASIBLE / SEARCH_LIMIT_REACHED / UNSUPPORTED_INPUT); `verifyPlan` re-checks every plan without importing the solver. The page also offers a tradeoff mode with an explicit loss cap, fairness floors based only on self-declared statuses, and a baseline comparison (A eligibility-only, B student-side planner, C organizer-side planner, D coordinated separate planners) against the joint solver. Baselines are deterministic simplifications, not models of any real system. Baseline D is the strong one: a student-side and an organizer-side planner that stay separate but exchange complete information and re-plan until nothing changes; it does not call the joint solver. **On the three sample scenarios D reaches the same result as the joint solver in every case we run**, so on these inputs the joint solver beats A, B and C but not D. All organizer numbers are simulated and are not real-world impact.
- **Organizer support shown to students is simulated.** Support records ("grants") are always stored with `is_sample: true` and shown as "Simulated support". Only approved support resolves a barrier; pending support is shown as not in effect yet. "Reachable" means practically within reach given time, cost, transport and devices; it is not admission.
- **Applying an organizer plan to the student side is a local demo.** On `/organizer`, a plan that is OPTIMAL and passed the independent verifier can be written to the sample profile loaded in this browser as simulated support, and removed again (see "Known demo limits"). It uses a placeholder opportunity, not a real one.

### Not built
- **Connect is a local demo only** (`/connect`). Quest Creator posts a quest as one of four fictional sample publishers; the quest is saved in this browser, always labelled "User-posted · not verified against an official site · Sample", never shown as having an official page, and never used as a verified candidate for competition routes, evidence-building steps or online options. Talent Board lets the student choose, item by item, which skills, interests and evidence (kind and status only, never the title) a sample publisher could see; everything is off by default, can be turned off at once, and the preview shows an anonymous handle with no name, school, age, grade, location or contact details. Stricter defaults apply when the profile is under 18, in grade 12 or below, or has no usable age: sharing needs an extra confirmation, a collaboration note cannot be shared, and sample invitations are held until the student chooses to review them with a trusted adult and cannot be accepted there. The publisher preview is the same either way, so it does not reveal whether those defaults apply. Sample invitations come only from the fictional publishers, are limited to one pending invitation per publisher, and can be declined or blocked (and unblocked). All of this is a demo in one browser: there are no real publishers, no reporting or moderation, and nobody is contacted, so it is not real protection.
- **Barrier summary (`/organizer/barriers`)** shows aggregate counts of (student, opportunity) pairs per barrier type for each sample scenario, taken from the same engines the student pages use. It also breaks the pairs down by unmet or unconfirmed eligibility rule, participation format, team requirement and required application materials still to prepare. It is sample data, not a measure of real need, and with real data these tables would need a minimum group size before showing a number.
- **Reliability metrics for the organizer solver (`npm run metrics`)** print, for the three sample scenarios (26 cases with different budgets, modes and fairness floors): how many plans the solver returned as feasible were rejected by the independent verifier (0 of 40), how the solver compares with exhaustive search (42 cross-checks: 36 with no gap, 6 where both find no feasible plan, 0 with a gap), how often the suggested fairness floors could be met (9 of 13 cases; the other 4 are reported as infeasible and exhaustive search agrees), and whether solving twice gives the same result (26 of 26). These are synthetic scenarios, so the numbers say the algorithm behaves correctly on these inputs and nothing about real-world impact. For Baseline D it prints how often D ties the joint solver (26 of 26 cases; D never did better, which would mean a solver bug) and D's coordination rounds (1 or 2 in every case, because in this protocol the student side hands over its complete report in the first round, so the count reflects the protocol rather than how hard coordination is). Run times are printed but depend on the machine.
- **Reliability metrics for the student-side route planner** are printed by the same command. An independent route checker that does not import the planner re-checks every route for the 4 sample profiles on the 13 verified opportunities (52 pairs, reference date 2026-11-19): dependency order, required preparation, skipped steps backed by evidence, total hours and cost, and every "finishes before the deadline" claim. Of 86 routes, 0 fail any check, and 0 of the 41 routes that claim to finish before the deadline are rejected. Of the 40 pairs not blocked by a hard requirement, 20 have at least one route that finishes in time and 20 can only be reported as unknown, because 68% of the recorded requirements cannot be decided from the profile and the official text alone. The checker does not check budgets (routes carry no structured budget field) or whether a route reported as not feasible could in fact be done in time. When the deadline is the reference date itself, a route is reported as unknown, because the exact closing time and time zone are not known.
- The organizer action that writes approved support back to the student side (see above).
- Everything under "Future work" below.

### Known demo limits
- Whether a student–opportunity pair can come out "reachable" depends on the opportunity record stating its fee, travel expectations and weekly hours. Of the 13 real records, 6 state a fee, 6 state whether travel must be self-paid and 2 state weekly hours; everything else is `null` (unknown, not guessed).
- As a result, **none of the 4 sample profiles evaluates to "reachable" on any real opportunity** (checked for all 52 pairs with `analyzeReachability` and no organizer support, evaluated on 2026-11-19): 30 pairs show "Reachability: Unknown" (missing information) and 22 show "Open barriers" (a hard requirement is not met, or there is an unresolved time or transport barrier). The "barrier resolved by approved support → reachable" step is therefore demonstrated with clearly fictional fixtures in tests and on the organizer page, not on real opportunities.
- All 13 real records list preparation steps. Five of them (DOE SULI, DOE CCI, the Cooke transfer scholarship, NOAA Hollings and NASA Texas Aerospace Scholars) also list the application materials their official pages require, 15 steps in total, each quoting the official wording; route steps built from these are shown as "Stated by the organizer" with that quote, and everything else is shown as our team's suggestion. Transcripts are marked reusable, so the cross-quest plan shows material reuse when two of these quests are in the Journal together; the other eight records have only suggested preparation.
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
npm run metrics # prints reliability metrics for the organizer solver on the sample scenarios
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
  organizer/              /organizer  What-if page (simulated, sample scenarios) and /organizer/barriers (aggregate barrier summary)
  connect/                /connect    Local demo: Quest Creator and Talent Board with fictional sample publishers
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
- Real Quest Creator publishing, a real Talent Board and real consent-based two-way connection (today there is only a local demo with fictional publishers). Also not built: reporting and review of posted quests, real rate limits, protection for minors that works across people rather than in one browser, and editing a posted quest.
- Search-node counts for the organizer solver, and budget checks in the student-side route checker.
- Applying an organizer plan to the student side for a real opportunity and a real student (today this is a local demo with a sample profile and a placeholder opportunity).
- Integration with real organizer data (all organizer scenarios are sample / simulated).
- AI assistance inside the product (for example organizing opportunity information or wording explanations). It would need a server to hold an API key, which conflicts with the no-backend design, and explanations are currently rule-generated and reproducible.
- Opportunity Blind Spots. With 13 opportunities and no real regional demand data there is nothing honest to report.
- Impact Measurement. It needs voluntary data from real users; only the student's own outcome notes in the Quest Journal exist.
- A coordination protocol for Baseline D in which information is exchanged step by step (today the student side reports everything in the first round), and a real opportunity for the organizer scenarios: no verified record states a numeric fee, weekly hours, a travel answer and required devices together, so the shared-support scenario uses the placeholder `placeholder-inperson-event` (deadline 2026-12-15, after which its Quest Details page shows it as closed).
- Barrier summary tables on scenarios that exercise them: the team-requirement and required-materials tables are almost all zero because the scenarios use placeholder opportunities; `hackrare-2027` is the only record with a team requirement and no scenario uses it.
- Talent Board: a collaboration note hidden by the stricter defaults is shared again once those defaults stop applying (avoiding this needs a new field in the share settings); a student cannot block a publisher that has not sent an invitation; there is no reporting.
- Switching between Adventure View and Classic View while an edit form is open on Quest Journal or Skill Passport closes the form and drops what was typed but not saved.
- Accessibility checks that need a person: print preview with two quests, the reduced-motion setting, and a screen-reader pass have not been accepted yet.
- Automated UI tests for the pages.
- More complete opportunity records (fees, travel and weekly hours) so real opportunities can be evaluated as reachable.

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
