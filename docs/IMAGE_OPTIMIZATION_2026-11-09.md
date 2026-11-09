# Storefront image optimization — 2026-11-09

The home and products pages now deliver responsive WebP photographs. The original
PNG/JPEG files remain byte-for-byte unchanged. No database, endpoint, discount,
checkout, product data, or layout changes are included.

| Photograph | Original bytes | 480px WebP | 960px WebP |
| --- | ---: | ---: | ---: |
| Made For You2 | 3,812,540 | 30,562 | 88,320 |
| Made For You 4 | 3,860,388 | 32,438 | 92,128 |
| Hero model1 | 476,906 | 26,990 | 87,560 |
| Total | 8,149,834 | 89,990 | 268,008 |

The browser selects a candidate according to display width and pixel density.
This reduces these three photographs' bytes by 96.7–98.9%, depending on the chosen
candidate; it does not represent the same reduction in total page load time.

`scripts/optimize-store-images.py` reproducibly creates the variants with Pillow,
WebP quality 88 and proportional Lanczos resizing, with no crop or generated edits.
The checked-in outputs require no deployment dependency. Original/output SHA-256
checksums, dimensions and sizes are recorded in `scripts/store-image-manifest.json`.
The original/resized and compressed versions were visually compared at 480px;
branding, text, colors and clothing remain clear at the display size.

The hero preload and image share the same `srcset` and `sizes`. Production staging
content-versions every responsive candidate, including `imagesrcset`, preventing a
different preload cache key or stale optimized photo after replacement. Promotional
images remain lazy, with asynchronous decoding and intrinsic dimensions.

Saved day/night hero images still override the default photo. Their responsive
fallback candidates are removed while a saved image is active and restored on
clear or resolution failure. Late image loads cannot overwrite newer settings.

## Validation

- Production CSS/runtime rebuild and staging succeeded; `npm run check:source`
  passed after regeneration. Existing rebuild-only drift in generated CSS/runtime
  files was excluded from this image release; production builds regenerate them.
- `tests/cache-revalidation-contract.cjs`: original image integrity, optimized
  image format/size/checksums, production candidate hashes, matching responsive
  preload, and optimized references on both pages.
- `tests/founder-media-runtime.cjs`: default hero, custom override, reset, stale
  asynchronous load, clear during load and failed-resolution fallback; existing
  founder image regressions also pass.
- Home performance, SEO, product SSR SEO, database-authoritative storage and test
  inventory checks pass.
- The complete static suite encounters a pre-existing `CART_CONTENT_CHANGED`
  failure in `council-browser-runtime.cjs`, reproduced on unmodified base
  `bf9fc6315af1090aabb0e35426b5153127301bbe`. The legacy performance budget also
  flags the retained source PNGs and the existing core-JavaScript byte budget.
  Neither is reported as passing. Image references served by the changed pages
  point to the much smaller WebP files, not those retained originals.
- Running the remaining checks independently gives 47 passing checks out of 51.
  The other pre-existing failures are `council-third-runtime.cjs` (missing
  `resolveAutomaticCampaign` in its fixture) and `css-cascade-contract.cjs`
  (two covered declarations in the existing embedded homepage styles). These
  also reproduce on the unchanged base. None of the failing source paths or
  embedded style declarations is changed by this release.

## Quality review

| Section | Result | Evidence / applicability |
| --- | --- | --- |
| 1. States | Pass | Static responsive fallback, custom hero, clear and resolution failure covered. |
| 2. Server authority | N/A | No business calculations or writes. Database remains authoritative. |
| 3. Concurrency | Pass | Latest request wins; clearing cancels pending custom media. |
| 4. Validation / authorization | N/A | No endpoint or authorization changes; asset paths remain local and bounded. |
| 5. Idempotency | Pass | Repeated media application preserves attributes; staging starts from clean output. |
| 6. Audit | N/A | No sensitive business action introduced. Git and image manifest record changes. |
| 7. External costs | Pass | Static delivery, no additional external service or subscription. |
| 8. Regression | Pass | Existing classes/layout retained; saved hero and founder behavior tested. |
| 9. Tests | Pass with known suite failures | Targeted critical paths pass; unrelated existing suite failures listed above. |
| 10. Secrets | Pass | No credentials or environment changes introduced. |

## Manual check

Open the homepage and products page, scroll to both Made For You images and
confirm the photographs and text. Inspect their `currentSrc`: it should be a
versioned `Photos/optimized/*.webp` URL at 480 or 960px. The default hero should
also use that directory. On a local fixture, setting a saved day/night image must
display it; clearing the setting restores responsive default candidates. Automated
fixtures exercise these settings without modifying production business data.
