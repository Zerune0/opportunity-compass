# Student UI supplementary acceptance record

## Current baseline and scope

Based on main b0b2c1c, including core PR #44 and UI integration PR #45. PR #42 has been incorporated; do not reopen or append to it. The five catalog-aware planner calls, optional related_opportunity_id links, competition step description and original alternative reasons are retained from main. No fixed stepping-stone or online-confirmation sentences are appended to engine reasons.

Working branch: fix/map-remote-self-link. Earlier overlapping local work is preserved in git stash under “backup: local p4 integration before main b0b2c1c”.

## Remaining fix

With Sample Noor and dan-herbatschek-fellowship-2027, the engine produces a remote_option about the target's hybrid participation format. Main linked that hint back to the same quest. The map now renders this case as plain text, while retaining links to different verified online opportunities and stepping stones. Unknown catalog IDs and future cycles remain unlinked. The engine explanation is unchanged and displayed once.

## Verification on 2026-11-19

- Latest unmodified main archive: 44 test files / 2281 tests passed.
- New branch on b0b2c1c: 45 files / 2284 tests passed; standalone TypeScript --noEmit, full ESLint and git diff --check passed.
- Default production build: the user ran npm run build in an ordinary Windows terminal in this repository and supplied the complete successful output: compilation, TypeScript, all 10 static pages and optimization completed. The earlier EPERM failures reproduced only in the agent runs; they did not reproduce in this user run. No permissions, endpoint protection or shared build configuration were changed. Together with the checks above, the four-command gate is now passed.
- Development-browser acceptance used an isolated copy of b0b2c1c with the same minimal map-link fix. Sample Noor, real Dan Herbatschek record: the remote hint has no self-link, its explanation appears once, and the ordinary Details link remains accessible.
- Four-route responsive acceptance used two explicitly fictional Sample opportunities only in a disposable data copy: QA Fictional Target and QA Fictional Hackathon, example.com URLs. Learning first, Practice first, Community and Beginner competition all rendered at viewport 375 x 812. Both comparison and checklist widths were 336px; document width 360px, without horizontal overflow. Enter selected Beginner competition; its step linked to /quests/qa-fictional-hack and displayed the engine description and non-official disclaimer. Fictional records were then removed from the disposable catalog; none was written into the repository data.
- Keyboard path: from the focused home brand, Tab reached Browse opportunities with a 2px outline and Enter opened Quest Board. Type was changed to Hackathon with Home/arrows/Enter; Tab reached Reset and then the single MLH result with a 2px outline. Enter opened Details, Add to my Quest Journal, View growth routes, global Classic View and Journal. Classic route table appeared with view=classic in the URL; Journal showed one added opportunity and all later outcomes Not recorded. This verifies those controls and the path, not every filter combination or screen-reader announcements.

Screenshots in the parent project folder: p4-four-routes-375.jpg (fictional Sample fixture), p4-remote-main-fix.jpg (real record with Sample profile).

## Outstanding acceptance

- Actual Chrome reduced-motion emulation on home/map/Journal remains unverified.
- Actual Windows screen-reader path remains unverified. Accessible DOM and keyboard checks are not a screen-reader pass.
- Corrected two-opportunity Chrome print/PDF pagination remains unverified. PR #35's labelled print fields are already merged; the earlier user print.pdf is not acceptance of the corrected layout.
- Passport backpack / Journal adventure-card presentation is optional work and has not been added. Existing operations retain their current presentation.
- Video work remains excluded by the user's instruction.
