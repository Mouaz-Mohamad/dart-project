# Courier portal reliability repair — 10 November 2026

## Behavior

- Local GPS continues to move the arrow and camera independently of network writes. Uploads are serialized at a minimum of six seconds, with a timeout, bounded retry/backoff, original sample timestamp and session cancellation. Duplicate acknowledged samples are skipped. PostgreSQL accepts at most one newer fix per five-second interval, protecting against duplicate tabs and older clients. The authenticated location limiter is per representative rather than shared by IP.
- Google VECTOR remains the preferred renderer. The 60-degree camera is applied after streets become ready even before GPS arrives, and after a late rendering-type change. Real GPS heading/movement, interpolation, manual rotation and retained Exit/Resume behavior remain. No timer destroys an otherwise viable vector map; Google's real raster fallback remains usable and clearly reported. A browser/device forced to raster cannot provide true vector tilt.
- Logout immediately stops GPS, cancels uploads and clears work, coordinates and map state even if server logout fails; a failed server revocation is explicitly reported. Old callbacks cannot restore another session. Temporary GPS errors retain the same watch; permission denial has a visible recovery message within navigation. Representative profiles are rehydrated from the authenticated API instead of persisted in sessionStorage.
- Initial work/network failures no longer prevent polling from starting. Expired sessions discard private work. Changed customer details, items, amount or address redraw their cards; a changed destination invalidates the retained route. Step selection has a fixed search window instead of a growing bound.
- Returns now open the same embedded navigation after a successful Start, offer Open navigation after Exit and serialize actions. Both order and pickup controls recover correctly when cards rerender mid-request. The footer retains exactly Exit/Arrived.
- Location authorization uses indexed EXISTS queries instead of downloading every return payload. Existing timestamp storage holds sample freshness; no new database schema is required. Delivery/pickup with a known destination requires recorded GPS accuracy of 100m or better. Existing delivery radius (500m), pickup radius (1km), manual-address exception, ownership, state/payment confirmation and audit behavior remain.

## Files and API

Maintained production files: `Js/dart-rep.js`, `Js/dart-google-maps.js`, `rep.html`, `backend/src/modules/commerce/commerce.routes.ts`, `backend/src/modules/commerce/commerce.service.ts`.

Existing `PUT /api/v1/representatives/location` accepts optional ISO `sampledAt` and returns `accepted` alongside `updatedAt`. Omission of the timestamp remains compatible with older clients. Stale/future samples are rejected and out-of-order, duplicate or too-frequent samples cannot replace the stored location. No new endpoint, migration, production test record or WhatsApp operation is introduced.

The standard build refreshes checked-in Home CSS and platform delivery outputs from their existing canonical sources; no unrelated maintained CSS/platform source was edited. The independent page-only Google code allowance is 132 KiB (previously 124); Home/core limits remain unchanged.

## Validation

- Full backend run: **121 files passed, 8 skipped; 863 tests passed, 66 skipped**. The two existing pickup fixtures were updated with accurate synthetic GPS for the new guard.
- Backend Vercel configuration, full lint, TypeScript check and production build pass.
- Source-executing courier tests pass: six-second cadence and one upload in flight; logout and delayed-response isolation; transient GPS recovery; updated contact/amount and destination; fixed step search; retained session and embedded pickup; 499/500/501m delivery and stale/inaccurate GPS.
- Embedded PostgreSQL checks pass: assigned pickup and unassigned-account authorization; stale/duplicate/out-of-order/too-frequent samples; archived return rejection. CI may use only its named loopback test database with an isolated schema.
- Frontend build, source freshness, storage authority and security-boundary checks pass. The expanded inventory runs 53 static checks: 47 pass and six fail identically on a clean checkout of the original revision after the same build. Baseline failures: `council-browser-runtime.cjs` (cart fixture), `council-third-runtime.cjs` (missing campaign helper), `home-performance-contract.cjs` (review clamp), `performance-budget.cjs` (existing core/image sizes), `server-authority-contract.js` (dashboard duplicate type), `test-inventory-contract.cjs` (existing notification test absent from workflow). The repaired courier payload passes its own allowance.
- Local Chromium could not launch because the environment denies its process-singleton socket. The browser regression was extended for six-second cadence, pickup Exit/reopen and logout erasure, and has its own independent GitHub job. Its result must be checked after publication; local mock tests do not certify Google rendering on the owner's Android device.

## Quality review

| Section | Result |
| --- | --- |
| 1 States | Pass: empty/loading/error, network retry, GPS denial/transient failure, logout failure and route retry. |
| 2 Server authority | Pass: assignment, fresh accurate location, geofence and existing payment/state authority. |
| 3 Concurrency | Pass: one GPS request, session guards, monotonic bounded DB writes and per-record action locks. |
| 4 Validation/auth | Pass: coordinates/sample-time validation, per-account limiter and existing middleware/ownership. |
| 5 Idempotency | Pass: duplicate locations skipped; existing audited order/return transition guards retained. |
| 6 Audit | Existing sensitive state/payment audit preserved; GPS samples do not create per-fix audit spam. |
| 7 Cost | Request/write rate reduced; existing Google Cloud billing/usage remains the cost source. No new dashboard cost ledger; this is an explicitly unchanged limitation. |
| 8 Regression | Relevant checks pass; six baseline frontend failures reproduced independently and listed above. |
| 9 Tests | Full backend and courier source regressions pass; browser CI and actual Android rendering require observation. |
| 10 Secrets | No keys, credentials, private coordinates or customer data introduced. |

Manual acceptance: use an assigned test delivery, verify 60-degree VECTOR streets/heading/arrow, observe location uploads six seconds apart, Exit/Resume, change destination and confirm route replacement. Deny/restore GPS and disconnect/reconnect network. Cancel the cash/handover confirmation before a real handover. Repeat Start/Exit/Open navigation for a pickup, and logout while an upload is pending. True Android floating-map PiP is outside this web repair and remains unimplemented.
