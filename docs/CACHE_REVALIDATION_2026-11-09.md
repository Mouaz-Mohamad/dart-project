# Browser cache and fresh catalog — 2026-11-09

## Behavior

- Production staging versions local HTML images, icons, styles/scripts, font references and CSS background media by their actual SHA-256 content (16 hex characters). Editing one asset changes only its version. Hero preload and the rendered image share the same key. Existing CDN/data/blob and API image URLs are not rewritten.
- Versioned static assets in CSS/Js/Photos/Icons use one-year immutable HTTP caching. Unversioned URLs revalidate before reuse. Existing founder fallback and cache-recovery no-store exceptions remain in force, as do private dashboard/HTML rules.
- Public `GET /api/v1/catalog` uses `private, no-cache, max-age=0, must-revalidate`. A browser may retain its HTTP response, but every reuse requires server validation against a freshly read public stock projection. Express computes an ETag over the full payload; unchanged responses return 304 with no body, changed models/stock/pagination return 200. Validation/errors retain no-store. Default browser fetch handles 304 transparently.
- Existing product image hash URLs and immutable caching, SSE notifications, catalog version reconciliation, pagination atomicity and server checkout authority are preserved.
- No business data is written to LocalStorage or IndexedDB. No Service Worker intercepts navigation or API requests. No stale/offline catalog fallback, background predownload of all images, paid service, database migration or checkout change was introduced.

## Files and contracts

`scripts/stage-vercel-public.cjs` versions media in delivery output; `vercel.json` supplies static cache policy. `backend/src/modules/catalog/catalog.routes.ts` permits conditional browser caching for the public projection only. `backend/openapi.yaml` and `docs/API_CONTRACT.md` document 200/304 behavior. Tests cover public revalidation and staged asset identity. There are no new endpoints.

## Validation before publication

- Backend `npm run check`: lint/typecheck/config checks passed; 116 test files and 828 tests passed, 8 files/66 tests skipped by their existing conditions.
- Final backend typecheck, build and 14 targeted catalog/cache/asset tests passed.
- Production build commands and staging passed (328 versioned references).
- Frontend source layout (69 sources), cache revalidation, SEO, founder media, database-authoritative storage, catalog pagination, direct changes and custom-domain media checks passed.
- Existing unrelated CSS/performance/navigation CI limitations are documented in the earlier SEO report; this task does not claim the full frontend suite is green.

## Quality review

| Area | Result |
| --- | --- |
| 1. Empty/loading/error | Pass: existing states retained; invalid public paging stays no-store; no stale offline fallback. |
| 2. Authority | Pass: fresh stock is read before ETag validation; cart/order authority untouched. |
| 3. Concurrency | Pass: unchanged pagination/version guards retained; response identity includes actual stock, not only model version. Main publication uses a head lease. |
| 4. Authorization | Pass: only the existing public projection is cacheable; staff/customer endpoints and permission guards unchanged. |
| 5. Idempotency | Pass: GET/304 are repeatable; staging regenerates hashes from bytes; no writes added. |
| 6. Audit | N/A: no sensitive business mutation. One source commit records this task. |
| 7. External costs | Pass: no new provider or paid operation. Caching reduces repeated payload transfer; no unsupported savings percentage is claimed. |
| 8. Regressions | Pass for targeted checks: hero preload identity, founder controls, SSE, media origin handling and private cache boundaries. |
| 9. Tests | Pass: stable 304/empty body, changed stock at same version -> 200/new ETag, different page representation -> 200, error no-store, staged media hashes and background URLs. |
| 10. Secrets | Pass: no secrets added; static cache does not include API/auth responses. |

## Production acceptance

After deployment, verify cache headers for a versioned static image, CSS and JavaScript; unversioned image revalidation; HTML freshness; public catalog 200 then matching ETag 304 through the storefront proxy and directly on the API; and existing immutable product image URLs. Use normal browser navigation to observe reuse; a hard refresh or an explicitly disabled browser cache may deliberately revalidate. Browser storage eviction and user clearing can require a new download. This is a performance cache, not an offline installation guarantee.
