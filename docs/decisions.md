# Source and decisions
- 2026-11-17: user confirmed Opportunity_Compass_最终融合版_项目说明书.pdf as the final product definition (15 pages).
- This repository summarizes that document. The original remains with the user; it is not automatically uploaded.
- Preserve student discovery, understanding, growth and application as the main journey. Organizer functionality is supporting.
- Retain the complete scope, including joint application planning, Skill Passport, Quest Creator and optional Talent Board.
- Initialize independently, without importing ExamPilot code or history.
- Initial visibility: private. No open-source license has been selected.
- Initial deliverable: documentation and directories only. No implementation, test pass, deployment or social-impact claims.
- Stack, schemas, interfaces and delivery dates remain open engineering decisions.
- 2026-11-17: narrowed scope for the four-day Bridge The Gap Hacks competition. Stack: Next.js (App Router) + TypeScript + Tailwind + Vitest, deployed on Vercel; no backend or database (data in `data/*.json`, student input in browser localStorage). Removed the placeholder directories `src/opportunity_compass/` and `apps/` in favor of `app/`, `lib/`, `components/` and `data/`. Parts of "Retain the complete scope" not built in the four days (accounts, database, Quest Creator, Talent Board, two-way matching) move to the README "后续计划 / Future work" section and are not described as implemented. The four-day scope is defined by CONTRACT.md.
