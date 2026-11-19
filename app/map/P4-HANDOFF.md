# Supplementary tasks: student UI

## Scope and dependencies

Work branch: feat/map-p4, fast-forwarded to main 0e03999 on 2026-11-19. PR #35 (print), #36 (core helpers), #37 (phase-four contract), #39 (data), #40 (final-act tests), and #41 (README) are included. Video work remains excluded.

## Implemented contract presentation

- Global Adventure / Classic buttons use loadViewPreference and saveViewPreference, with aria-pressed and native keyboard activation. The map URL overrides saved preference for either valid view value; other pages retain their normal presentation. Same-tab updates, browser back, storage changes and pageshow refresh the map preference.
- Map calls planRoutes with the verified catalog. Competition routes show the explicit non-official disclaimer in both presentations. Alternative explanations remain verbatim, new alternative kinds have distinct labels and disclaimers, and opportunity links are limited to the verified catalog.
- Step details expose Why this step, Time and cost, Evidence you can record, Official requirement?, plus dependencies. Adventure uses native details/summary, including skipped steps; Classic shows the same fields in its responsive table. Missing optional fields are Not recorded, never inferred from older descriptions or preparation flags. Organizer classification quotes the original preparation source where available; evidence codes use readable labels.
- Current core contract explicitly does NOT yet generate competition routes, new alternatives, or the three new node fields. Actual generated-result end-to-end acceptance and competition-target links await the engine implementation and its concrete result shape. No synthetic result is represented as a real opportunity result.
- Existing merged replay and Journal mappings already include competition and unknown-type fallback.

## Record summary field mapping

| Displayed stage | Current source |
| --- | --- |
| Added to Journal | Entries for the current profile, unique opportunity_id |
| Previously unknown opportunity | outcome.discovered_new_opportunity === true |
| Understood eligibility | outcome.understood_eligibility === true |
| Completed materials | outcome.completed_materials === true (not inferred from materials) |
| Submitted | application === submitted |
| Eligibility confirmed | eligibility_confirmation === confirmed |
| Decision received | decision === admitted or not_admitted |
| Participated | participated === true |
| Notes, verbatim | outcome.helpful_note, paired with the opportunity title |

Other existing fields include submitted_on, added_on, history, route_type, tasks, material_ids, official_url and notes. None is used to infer a later stage. Corrections use the current status, not old history events. Explicit false/negative answers count as recorded but do not count as positive; missing answers show Not recorded. Removed entries leave the summary. Notes are rendered as plain text and retain whitespace.

## Verification

- Full suite on synchronized main plus implementation: 41 files / 2089 tests passed, including six node/view regression tests and six record-summary tests.
- Default production build completed all 10 static pages successfully, with unmodified repository next.config.ts. Earlier EPERM failures were intermittent in this environment; no ACL, security setting or production configuration was changed.
- Full ESLint and final standalone TypeScript --noEmit passed. git diff --check passed.
- Earlier browser acceptance for the record summary: empty sample Journal showed Not recorded, adding an opportunity and recording submission updated only those two stages. A 375px check showed no overflow. Production-mode browser acceptance at localhost:3201 also passed: explicit Classic URL selected Classic, Adventure button updated map presentation and URL, preference remained selected on Passport, returning with an explicit Classic URL overrode the stored Adventure preference, and Enter expanded a step in Adventure. Existing engine steps correctly showed Not recorded for all three new optional fields. Screenshot: ../p4-view-verified.jpg. Full screen-reader and mobile acceptance of the new controls remain outstanding.
- New tests cover old-snapshot absence, exact relation text, readable evidence kinds, official source, skipped steps, and URL preference precedence. UI source tests do not replace actual keyboard or screen-reader acceptance.

## Accessibility acceptance record

| Check | Status | Evidence and next action |
| --- | --- | --- |
| Print preview, two opportunities | Still has issues | User's print.pdf exposed unreadably narrow columns with one quest. Merged PR #35 changes the printed plan to labelled fields; corrected PDF and two-quest pagination still need acceptance. This also changes the original table-print proposal and needs corrected-PDF acceptance. |
| Reduced motion | Still unverified | Deployed CSS rules confirmed, but real Chrome media emulation has not been accepted. Check home, map and Journal with prefers-reduced-motion: reduce. |
| Screen reader | Still unverified | No actual screen-reader pass. On this Windows machine use an available Windows screen reader rather than macOS VoiceOver. Follow home -> Quest Board -> Details -> Classic Map -> Journal; record unnamed controls, color-only states and internal field names. |
| Keyboard | Specific controls passed; full path partially unverified | Quest Board Type select changed to Hackathon with keyboard arrows, leaving one result. Tab traversed the filters and Reset button to that result; Enter opened Details. Enter on View growth routes opened Map; Enter enabled Classic View with aria-pressed=true and view=classic in URL. Tab reached Practice first with a 2px focus outline; Enter selected it, and the Journal link opened with Enter. Entire home-to-Journal path and all filter combinations have not been certified. |

Record date, browser, profile, opportunity IDs, exact issue and retest result for each future check. Do not mark a source inspection as a rendering or screen-reader pass.
