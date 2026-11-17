# Opportunity Compass
**A Bridge Between Potential and Opportunity**

Discover Opportunities. Understand the Gap. Grow Through Quests. Take Action.

帮助缺少资源、人脉和专业指导的学生发现真实机会，理解资格、准备差距与现实参与障碍，选择可执行的成长路线，并以技能证据和申请规划采取行动。

## Project status
**Planning and repository scaffold only.** No application, API, discovery pipeline, eligibility engine, optimizer, or deployed service has been implemented or tested. All capabilities below are planned product goals. This is an independent project; no ExamPilot code is included.

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
```text
apps/student/           Student Compass and dual views (placeholder)
apps/organizer/         Supporting organizer interface (placeholder)
src/opportunity_compass/
  discovery/            Sources and opportunity records
  eligibility/          Source-backed requirement evaluation
  reachability/         Practical participation constraints
  pathways/             Adaptive growth routes
  evidence/             Skill Passport and replay
  applications/         Multi-opportunity planning
  connect/              Consent-based publishing and matching
  organizer/            Supporting intervention scenarios
  shared_decision/      Shared capacity, cost and allocation
  validation/           Independent candidate verification
tests/                  Future behavioral tests
data/examples/          Future explicitly synthetic fixtures
docs/                   Product and engineering plans
```

These directories contain documentation placeholders, not working modules. No framework or dependency stack is frozen. There is no application run command yet.

## Boundaries
No admission guarantees, AI-invented opportunities, virtual-level eligibility, public ability rankings, mandatory streaks, virtual currency, generalized social network, recruitment ATS or complete course platform. Simulation outputs are not real-world impact evidence.
