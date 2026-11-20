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
- Adventure Journal quest cards and Passport inventory are now present in main. Both presentations have been reviewed in this follow-up; the original optional-work note is superseded.
- Video work remains excluded by the user's instruction.


## Follow-up against main 0748f72 (2026-11-20)

Source: GitHub main ZIP downloaded after the repository showed merge PR #65 at 0748f72. The original local Git checkout is still at 0154b55 with its three uncommitted print changes intact. CLI fetch fails in the Git credential helper and the minimized GitHub Desktop window could not be restored by the desktop tool. This review copy is NOT a pulled Git branch; do not push it as a replacement history. Apply the accompanying patch to a new branch after fetching current main, then rerun checks if main has changed.

### Changes

- QuestList and SavedEvidence retain the same keyed ul/li/card structure in Adventure and Classic; only classes change. Classic keeps a plain stack/grid with list markers removed.
- JournalEntryCard keeps its header, status wrapper and feedback subtree in stable positions. View changes no longer remount the feedback form or status date controls.
- Existing Adventure presentation, controls, official-page safeguards and view-preference hook are retained. No store, engine, catalog, dependency or configuration changes.
- Carried forward the pending journal-page print-only block-flow/pagination adjustment on top of main's added Adventure styles. This still needs human print acceptance.

### Validation on this patched copy

- npm test: 73 files passed; 2988 tests passed, 3 skipped (2991 total).
- npm run lint: passed.
- npx tsc --noEmit --incremental false: passed.
- npm run build: passed, including all 14 static pages. No permission/security setting or build configuration changed.
- Actual production server on localhost:3204. Fresh port uses separate browser storage; Sample Maya was loaded there without replacing the user's deployed-site profile.
- Passport: opened the existing sample evidence editor; typed an unsaved title; Adventure to Classic to Adventure retained the open editor and actual typed value. Canceled afterward; no edited evidence was saved.
- Journal: added DOE SULI and NASA TAS, opened optional feedback and typed an unsaved note. Both directions retained the expanded feedback and typed note. A status date changed with keyboard input from 2026-11-20 to 2025-11-20 also survived switching from Classic to Adventure. No feedback or historical status event was saved. The browser fill helper did not update React's date state reliably, so only the subsequent keyboard check is counted as date acceptance.
- At 375x812, Journal in both modes and Passport Adventure with its editor open had document width 360px, viewport 375px, with no horizontal overflow; the card, editor and visible controls were visually inspected. Viewport restored afterward.
- Current localhost:3204/journal retains two Sample Maya quest entries for manual print acceptance. This is separate from the deployed site's browser data.

### Still not accepted

Human Chrome print preview/PDF with two quests; actual OS reduced-motion setting on home/map/Journal and the new Adventure pages; actual screen reader through Home -> Quest Board -> Quest Details -> Map Classic -> Journal. DOM/keyboard checks are not screen-reader acceptance. The code has not been pushed and no PR has been opened for this follow-up.

### Notes to relay to the lead

The unsaved-input view-switch limitation has a tested local fix and can be removed from README after the patch is merged and retested. Keep the three manual accessibility checks marked pending. Current demo facts from the lead: Noor/Rutgers can show HackRare as a fourth route; Noor/DOE SULI has three organizer-stated steps; Maya's organizer demo requires the third scenario and no pre-added laptop. Baseline D ties on the sample cases; do not claim the joint solver beats every baseline. No recording or editing was performed.


## Git integration follow-up (2026-11-20)

GitHub Desktop was restored and fetched origin/main successfully at 0748f72. The prior print work is preserved in a named Git stash on fix/journal-print-pagination. The reviewed patch has been applied to the real Git branch fix/preserve-view-drafts based directly on origin/main; all tracked source files were compared with the validated review copy with CRLF/LF normalized; only this integration documentation differs. No engine, catalog or shared hook change was added. The earlier ZIP-only/push-blocked note describes the preceding stage and is superseded by this integration note. Human print/reduced-motion/screen-reader acceptance remains pending.


The integrated checkout's additional build attempt compiled and type-checked, then failed to create .next/server/app/connect.segments/connect with EPERM. The identical normalized source already passed the full production build in the review copy (all 14 pages), along with tests, full lint and standalone tsc; only this Markdown record differs. No security setting, ACL, generated-directory workaround or build configuration was changed. Report both results rather than claiming a successful build in the original path. Publication status should be checked on the follow-up PR.
