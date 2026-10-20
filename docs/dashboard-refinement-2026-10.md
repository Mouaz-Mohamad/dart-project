# Dashboard refinement — October 2026

This batch improves presentation and command feedback while retaining the existing operations, permissions and server contracts. The user explicitly requested one commit per task and a deployment after all seven tasks; the seven commits are published together in one push. No database migration, endpoint, production record or storefront business rule is changed.

| Task | Implementation | Main files | Manual verification |
| --- | --- | --- | --- |
| 1. Concise records | Orders, clients and other operational tables show their important fields first. Details retains the original fields and action controls in one accessible panel. The order's existing next action is also available in its summary. | `Eye/dart-dashboard-ui.js`, `Eye/dart-dashboard-ui.css`, `Eye/dart.js` | Open Orders and Clients, open Details, use Escape, reopen and check Edit, History, archive/delete, payment and delivery controls. Repeat at 390 px and desktop width. |
| 2. Order editor | Existing controls grouped into customer, pieces, delivery, payment/discount and review areas. Name and main phone are the required customer contact fields; email and second phone remain available. Search existing clients, physical item codes and auto allocation remain. | `Eye/dart-operations.js`, `Eye/Dart Eye.html` | Create with name/phone and valid delivery/items; test existing client search and both piece selection methods. Check advance payment, paid/refunded amounts and discounts. Reject invalid values without losing the draft. |
| 3. Filters | Common record filters have an All option, visible active selections, individual removal and Clear Filters. Waiting and News reset their own filters. Reporting periods retain their explicit date ranges and have Reset period; archive visibility retains its separate Active/Archived/All control. | `Eye/dart.js`, `Eye/dart-waiting.js`, `Eye/dart-news-admin.js`, `Eye/dart-finance.js` | Search for a nonexistent record, clear its filter and recover the rows without a reload. Repeat status/model/size/date filters and archive views. |
| 4. Execution feedback | Buttons expose pending state immediately. Each order retains its independent command lock. Success follows a confirmed response; related reads refresh in the background through the existing coalescer. Duplicate post-save hydrations removed. Modal close and repeat submit are guarded while its save is pending. | `Eye/dart-orders-api.js`, `Eye/dart-operations.js`, `Eye/dart.js`, `Eye/dart-dashboard-ui.js` | Send commands for two different orders, confirm both can run, and a second conflicting command for the same order is blocked. Return responses out of order. Double-submit the manual editor and try closing during save. |
| 5. Settings | General, Hero Words and Staff remain internal tabs. Search/jump controls, clearer form groups, preserved unsaved drafts, and server-confirmed saving state. Optional density and summary-column ordering are UI preferences only. | `Eye/dart-settings.js`, `Eye/dart-settings.css`, `Eye/dart-display-preferences.js` | Search within each tab, edit a value while a background refresh arrives, save it, then reload. Choose/reorder summary columns and reset preferences; every original field remains in Details. |
| 6. Staff | Compact searchable directory. Only the selected member has a details/permissions editor. Permission groups, isolated in-memory drafts, pending account actions and an initially collapsed Add Staff form. Protected owner behavior is retained; stale directory reads cannot restore data after logout. | `Eye/dart-staff.js`, `Eye/dart-settings.css`, `Eye/Dart Eye.html` | Select two employees in turn, edit one permission draft and switch back. Save, test access/session actions with an authorized test identity, and verify protected owner restrictions. Expand Add Staff and Pending invitations. |
| 7. Hero sentences | Each typing scene is one sentence group, with preview, hold and movement controls. Word text, color, size, weight, movement, deletion and scene reassignment remain available. Sentence order is the saved order. | `Eye/dart-settings.js`, `Eye/dart-settings.css`, `Eye/Dart Eye.html` | Move words within a sentence, move a whole sentence, reassign a word using Word settings, add/remove a word and save. Reload and confirm grouping/timing/styles. |

## Validation

- `npm run check` in `backend`: lint and TypeScript passed; 65 test files / 362 tests passed. Six environment-dependent files / 47 tests skipped; no claim of a live PostgreSQL integration run.
- `npm run build` in `backend`: passed. No backend source or dependency changes.
- All 31 `ciStatic` suites in `tests/test-inventory.json`: passed, including server authority, browser storage, security boundaries, finance, filters/refresh and performance budgets. Browser JavaScript syntax passed.
- All nine `ciBrowser` suites: passed using Playwright Chromium headless shell. The existing `DART_TEST_HEADLESS_SHELL=1` exception applies only to native BFCache assertions in `navigation-browser.cjs`. Full Chromium BFCache assertions remain required in GitHub CI; they cannot run in this container because its native socket policy prevents full Chrome startup.
- Expanded real DOM regressions cover retained order controls, optional contact fields, client search, duplicate submit, pending close, concurrent orders with reversed responses, Details keyboard/focus behavior, filter restoration, settings drafts/preferences, staff selection/draft/save/owner protection, and hero grouping/reorder/save/reload.
- Founder PNG upload, compression, preview, About-page refresh/reload, historical picture cleanup and restore-to-original all remain covered by `tests/storefront-settings-regression.js`.
- Visible dashboard text is checked for white foreground on white background across sections. Staff, order editor, record panels and hero editor are checked at 390 px and 1366 px. Visual review corrected a narrow status message and a legacy white table-heading override.
- Static baseline comparison retained all 599 existing HTML element IDs and 75 named buttons. Dynamic record controls are additionally checked in the browser suite.
- Production build preparation: `build-home-css.cjs`, `build-home-runtime.cjs`, `stage-vercel-public.cjs` passed. Homepage delivery remains inside its existing 225 KiB source budget. Dashboard adapters are scoped to Dart Eye.

## Dart quality review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. State coverage | Pass | Empty/search-empty, pending, success and failure views; drafts retained after failure and background refresh. |
| 2. Server authority | Pass | No business endpoint changes. Prices, stock, discount eligibility and status remain server validated; monetary preview uses minor units. Browser persistence is limited to display preferences. |
| 3. Concurrency | Pass | Existing order versions and per-order pending lock retained; reversed-response browser regression. Staff draft isolation and stale-read guard; form repeat-submit/pending-close checks. |
| 4. Validation and authorization | Pass | Central `DartAdminAccess` guards and unchanged server authorization; optional contact validation and protected owner checks. Backend authorization tests passed. |
| 5. Idempotency | Pass / existing server contracts | No new command endpoint or retry behavior. Existing idempotency/version logic retained; manual editor and staff controls suppress duplicate in-flight actions. |
| 6. Audit | Pass / existing server contracts | All sensitive operations keep their original audited endpoints. No audit schema or logging changes. |
| 7. External cost | N/A | No message sending or paid integration calls added. |
| 8. Regression safety | Pass | Existing named controls retained; nine browser suites include storefront, sets, waitlist, News, auth, navigation and founder media. No migrations or production data writes. |
| 9. Tests | Pass with stated environment limits | Local commands/scenarios above. Native BFCache and skipped database integration coverage remain explicit. |
| 10. Secrets | Pass | No new credential, token or environment configuration. |

## Release verification

The final commit contains `[batch:7] [deploy]`. Push all seven commits once; the storefront builds the final tree and the frontend-only batch skips the API build. Verify the final GitHub checks, deployment SHA and public dashboard assets, then both storefront and API production aliases. Keep the previous ready storefront deployment as the rollback candidate.
