# Quest phase 2 review notes

All merges are reserved for the project lead. This change must not be merged automatically.

Remote branch starts from main 08e21d3fb5e88198d542c2f5439d99a53c494098. Latest main source was read through the authenticated GitHub web interface and reproduced in a separate local validation snapshot. Only app/quests/ and data/opportunities.json are submitted. No dependency or shared-engine edits.

Implemented: field/country/state/weekly-hours filters; saved opportunities and saved-only view through lib/store; deadline and interest-reason ordering through explainMatch; source/location/time displays; clearly labelled local user-posted samples behind official entries; local sample detail routing; five categories through analyzeGaps; individual missing fields with Passport links; concrete alternatives through grant-aware findAlternatives; approved support and the barriers it resolves; Map and Journal links.

Catalog: 12 human-verified official entries, at least three confirmed free remote entries, underscore tags, source_tier, and preparation for every entry. Rutgers has four optional team suggestions, including learning and project work. Human verification dates remain 2026-11-17 per the supplied records. Annual recurrence remains null when unconfirmed. Estimated preparation hours never fill official participation hours.

Browser checks: free filter gives three results; saving survives reload; country/state/field filters combine; filters work with keyboard; Noor sees Rutgers eligibility and transport barrier plus specific official unknowns; a hard-rejected NASA TAS page links concrete alternatives. At 375px, Rutgers detail scroll width was 360px. Approved/pending/other-student support display and source ordering have additional automated tests in this directory.

Run the root build, test, TypeScript and lint commands before review. Additional Quest tests are included with:
node node_modules/vitest/vitest.mjs run --config app/quests/vitest.config.mts

Latest-main validation: build passed with CIRCLE_NODE_TOTAL=2 (one build worker), lint and TypeScript passed, and all 15 new Quest tests passed. Combined suite: 1888 passed and 5 failed. The five shared assertions are lib/gap/gap.test.ts lines 532, 544 and 552 (they assume no preparation gaps), and lib/match/match.test.ts lines 419 and 494 (they require legacy hyphenated tags). These conflict with the required new preparation items and underscore migration. The lead owns updating those assertions or using dedicated fixtures. A has not modified lib/ tests.

Data follow-up before layer 1 can be called complete:
- Confirm annual recurrence for the original three entries.
- Confirm enough explicit high-school eligibility records to meet the required coverage; an empty requirements array does not establish a particular age range.
- Supply a verified real in-person demo opportunity with known eligibility, fee, weekly hours and device/transport terms. Rutgers fee and weekly hours remain unknown; it must not be presented as a proven grant-to-reachable transition.
- Jointly exercise actual Connect publishing and organizer-approved resources once those teammates' UI flows are available. Local sample support is always marked Simulated; reachability is not admission.

The PR description records the final validation results and remaining blockers. No merge or production deployment is performed by A.
