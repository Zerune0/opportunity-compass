# Opportunity Compass
**A Bridge Between Potential and Opportunity**

Discover Opportunities. Understand the Gap. Grow Through Quests. Take Action.

帮助缺少资源、人脉和专业指导的学生发现真实机会，理解资格、准备差距与现实参与障碍，选择可执行的成长路线，并以技能证据和申请规划采取行动。

## Project status
**Early scaffold for Bridge The Gap Hacks.** A Next.js app skeleton with four placeholder pages exists. No eligibility engine, route planner, optimizer, or deployed service has been completed yet. All capabilities below are product goals unless stated otherwise; the four-day scope is defined in `CONTRACT.md`. This is an independent project; no ExamPilot code is included.

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
app/                    Next.js routes: /, /quests, /map, /passport, /organizer (placeholders for now)
lib/                    Pure decision functions and shared types (tested with Vitest)
components/             Shared UI components (planned)
data/profiles.json      Sample student profiles (is_sample: true)
data/opportunities.json Verified opportunity records (planned)
data/scenarios/         Simulated organizer scenarios (planned)
data/examples/          Explicitly synthetic fixtures
tests/                  Reserved for future behavioral tests
docs/                   Product and engineering plans
```

## 后续计划 / Future work
Not built in the four-day competition scope and not implemented:
- Accounts and a database
- Quest Creator (verified organizer publishing)
- Talent Board (optional field-level sharing)
- Consent-based two-way matching

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
