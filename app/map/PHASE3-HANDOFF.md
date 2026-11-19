# Phase 3 handoff

Base: main 7c0055d (PR #25), including merged PR #23. Map alternative deduplication, grants and navigation cleanup are already in main; this branch does not repeat them.

## Changes

- ProfileEditor and YourData read browser state after mount using setTimeout, with matching clearTimeout cleanup.
- Blocked Adventure Map profiles see neutral official-requirements wording while retaining an always-available official link.
- The dark theme's former --color-white is now --color-surface; --color-white is real #fff. The one legacy organizer select.bg-white retains its dark background through a scoped compatibility rule. No organizer source or engine changes.
- Shared styles keep form controls and long labels inside narrow layouts, increase checkbox-label and summary targets to 44px, stack status definition lists correctly, and make small-screen padding consistent.
- Journal has section jump links to quests, materials and cross-quest planning, without moving or hiding features.
- Reduced-motion CSS removes animations, transitions, scanline/grille overlays and the title cursor. Print CSS uses black text on white and restores real table layout instead of mobile stacked rows.
- DEMO-STORYBOARD.md contains a 3:30 draft, recording gates and an honest fallback for a missing support bridge.

## Verification on 2026-11-19

- Default production next build: passed, all 10 static pages generated.
- Vitest: 35 files, 2015 tests passed.
- TypeScript --noEmit: passed.
- ESLint: passed.
- 375x812 browser: home, Passport, evidence editor/link form, Your data, populated Quest Details, and populated Journal checked; no document or content overflow found in the checked states.
- Visible form controls, buttons, checkbox labels and summaries measured at least 44px in checked Passport/Your data/Journal states.
- Keyboard Enter opened the evidence editor; Tab reached its title field with a visible 2px outline; cancelling restored focus to Edit. Keyboard Enter opened linking and added a sample quest to the Journal. Journal section links reached their headings.
- Printed layout CSS is implemented, but print preview is NOT accepted: window.print blocked control of the embedded browser, so the preview could not be inspected. No physical print job was submitted.
- Reduced-motion rules inspected in source; OS-level reduced-motion rendering was not independently emulated in the available browser API.

## Remaining gates

- Lead reviews and merges using a merge commit. Recheck deployed main after merge, including organizer select colors and any newly merged Connect pages.
- Manual print-preview acceptance and reduced-motion setting check remain open.
- Lead/Charles must confirm demo student, opportunity IDs, matching scenario and deployed support bridge. Teammate A owns real opportunity data and Devpost screenshots/text.
- Final recording waits for the final deployed version. Nothing in the draft asserts that the support bridge or Connect demo is already available.
