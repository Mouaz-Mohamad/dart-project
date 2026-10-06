# Homepage Sets and Set navigation

The homepage spotlight sits immediately before **Newest products**. Its HTML/templates live in `index.html`, its styles in `CSS/main.css`, and its browser behavior in `Js/dart-home-sets.js`. `CSS/home.css` and `CSS/home.min.css` are generated delivery bundles.

Each card uses the uploaded Set cover at 3:4 with `object-fit: cover`, takes 90% of the carousel width, and leaves the next card visible. Phone and desktop use the same compact layout, capped at 410px; narrower phones fit their viewport. Right-hand piece thumbnails are 70×70px. Short copy and both prices appear on the left; **Shop the Set** opens the existing Set dialog. Navigation supports touch, mouse drag, arrows and keyboard without autoplay.

## Dashboard and API

In **Models → Sets → Edit**, save **Short Description**, **Show on Homepage** and **Homepage Order**. Lower order values appear first; equal orders use Set ID for deterministic ordering. Visibility requires a Set image. Existing Sets start hidden until selected. Empty selections hide the section; network/asset failures show a retry action.

Migration: `backend/migrations/0057_set_homepage_presentation.sql` adds `short_description`, `show_on_homepage` and `homepage_order`, constraints and a partial homepage index. It is additive and leaves prices/components/reservations unchanged. Apply it before deploying the new API.

Production can use a different database connection from Supabase Auth. For an explicit operational release, `DART_APPLY_SET_HOMEPAGE_MIGRATION=0057_set_homepage_presentation` applies only this approved migration using the API's connection before serving requests. It requires migration 0056, uses the migration lock/checksum ledger, and safely skips repeats. Remove the release flag after verification. Normal builds and normal runtime boots do not migrate.

`GET /api/v1/sets`, `GET /api/v1/sets/:setId`, `POST /api/v1/admin/sets` and `PUT /api/v1/admin/sets/:setId` expose/accept the presentation fields. New writes retain the existing central `sets.manage` permission, CSRF, version checks, transactions and audit trail. Updates from older clients preserve omitted presentation fields. Both displayed prices come from server pricing: `componentsSellingTotalMinor` and `finalMinor`.

## URLs and Back

`/sets/{SetID}` opens the existing dialog; Vercel rewrites shared links to `products.html`. `Js/dart-set-navigation.js` manages the navigation steps. A fresh shared link creates a Products-list entry underneath it. Reload preserves the same steps.

Piece/gallery previews use the HTML-owned native dialog and `Js/dart-set-image-preview.js`. First Back closes an enlarged image while preserving the Set. Next Back closes the Set and returns to its originating page. Forward restores the overlays. Repeated Close clicks do not traverse twice; late API replies cannot reopen a closed Set. Closing during a pending add does not cancel the already-submitted reservation or trigger another Back when it completes.

## Verification

| Review section | Result and evidence |
| --- | --- |
| 1. State coverage | PASS: loading, no featured Sets, single Set, API error/retry, asset error/retry, unavailable link. |
| 2. Server authority | PASS: prices come from the existing Set pricing service; reservation/stock validation remains server-side. |
| 3. Concurrency | PASS: stale admin versions reject with 409; repeated close/open and late-response traversal are tested; Back during add preserves one reservation. |
| 4. Validation/authorization | PASS: type/range/description/image rules, `sets.manage` denial and missing CSRF are covered. |
| 5. Idempotency | PASS: existing Set double-click purchase creates one reservation/group; repeated Close consumes one step. Presentation reads have no side effects. |
| 6. Audit/observability | PASS: Set create/update logs contain presentation values, including before/after on update. |
| 7. External-service cost | N/A: no WhatsApp, messaging or paid-service calls were added. |
| 8. Regression safety | PASS for affected paths: normal Product links/modals and Set listing/filter/sort/cart/reload remain covered. General CSS architecture check has a pre-existing failure at the unchanged `Eye/dart.css` Boxicons `@import` (also present at baseline `d8b7792`). |
| 9. Tests | PASS: backend check/build, admin browser round-trip, real homepage/products navigation and existing cart/Product contracts. Backend suite: 266 passed, 23 skipped; database integration tests require a dedicated test database and were not run against production. The operational migration tests cover disabled/unsupported flags, locking/checksum/order, repeat skips and rollback. |
| 10. Secrets | PASS: no credentials introduced; browser history stores navigation IDs/URLs, not prices, stock or business snapshots. |

Commands: `cd backend && npm run check && npm run build`; `node scripts/build-home-css.cjs --versioned`; `node scripts/stage-vercel-public.cjs`; `node tests/sets-runtime-contract.cjs`; `node tests/database-authoritative-storage.cjs`; existing Product contract checks. Browser checks: `tests/sets-admin-browser.js`, `tests/sets-home-browser.js`, `tests/sets-storefront-browser.js` (Playwright; `CHROMIUM_EXECUTABLE` can select an installed Chromium).

Manual check: choose two Sets, save their short copy/order/visibility, open the homepage, swipe between cards and enlarge a piece. Open a Set, copy/reload its URL, enlarge another image, then use Back twice and Forward. Save an unselected Set and verify it remains absent from the spotlight while still available in the normal catalogue.
