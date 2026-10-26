# Dart custom domain migration

The public storefront origin is `https://www.dartofficial.com` and its preferred
search site name is **Dart**, with **دارت** as an alternate. The apex domain redirects
to `www` through the existing Vercel domain configuration. The former storefront
host redirects permanently to the same path on the custom domain.

## Behavior and scope

- Saved catalog asset URLs on the known Dart hosts resolve through the active API
  origin. Asset IDs and content-version queries are retained; database records and
  image bytes do not need migration or re-uploading.
- Product cards, Set covers and galleries, cart images and profile image snapshots
  use that same catalog resolver. External image references and upload previews
  retain their previous behavior.
- Public HTML canonical links, social metadata, structured data and the static,
  product and News sitemaps use the custom domain. Private pages remain `noindex`.
- Client-side product navigation preserves the same page titles and canonical
  identity; Mobile/Desktop Lighthouse audits target the custom domain directly.
- Static JSON-LD CSP hashes were refreshed. Product SSR authorizes its actual
  rendered JSON-LD hash without enabling executable inline scripts.
- The API upstream remains `dart-api-dusky.vercel.app`. Its existing custom-domain
  CORS allowance is preserved. No database migration or new endpoint is required;
  existing sitemap GET responses now advertise the custom domain.

## Verification

- `npm run build` and `npm run check`: build, source freshness and 37 static checks.
- `cd backend && npm run check && npm run build`: lint, TypeScript, production build
  and 517 passing tests; 51 database-dependent tests skip without an isolated test
  database. This batch changes no database behavior.
- Chromium: `home-storefront-browser.js`, `full-site-browser.js`,
  `news-browser.cjs` and `sets-home-browser.js` passed with local API fixtures.
  The Home fixture serves an image saved under the former Vercel host and verifies
  that the real product card decodes it from the current host.
- `custom-domain-runtime.cjs` runs maintained and generated catalog code against
  apex, `www`, preview, localhost and explicit API origins. It checks product
  projections, string/object assets, hash queries, missing images and unrelated hosts.
- SSR tests check product variant/social images, canonical URLs, dynamic CSP hashes,
  News content and missing/unavailable responses. SEO checks enforce one consistent
  home-page WebSite identity, sitemaps and the former-host redirect.

## Dart quality review

| Section | Result | Evidence or applicability |
| --- | --- | --- |
| 1. State coverage | Pass | Missing-image fallback and existing loading, empty, retry, 404 and 503 scenarios pass. |
| 2. Server authority | N/A | No money, inventory, status or eligibility calculation changes. |
| 3. Concurrency | Pass / N/A | Resolution is deterministic and performs no writes; no competing business transaction is added. |
| 4. Validation and authorization | Pass | Rewriting is limited to known origins and catalog asset paths; permissions and private-page controls are preserved. |
| 5. Idempotency | Pass / N/A | Repeated URL resolution has the same result; no mutation is added. |
| 6. Audit | N/A | No sensitive business action is added or changed. |
| 7. External-service cost | N/A | No messaging or paid customer action is introduced. |
| 8. Regression safety | Pass | Full maintained static suite and four affected browser suites pass; no CSS/layout changes. |
| 9. Tests | Pass | Former-host image loading, SSR/social variants, CSP, site identity and sitemap origins are covered. |
| 10. Secrets | Pass | No credential is added to browser code, committed files or test fixtures. |

## Production acceptance and Search Console

Check Home, Products and Set images at mobile and desktop widths. Inspect initial
HTML for `https://www.dartofficial.com` canonical URLs, `WebSite.name = Dart` and
working social-image URLs. Open `/robots.txt`, `/sitemap.xml`,
`/product-sitemap.xml` and `/news-sitemap.xml`. Confirm the old storefront redirects
with its path/query preserved and both production projects point at this batch.

Register or verify the new domain in Google Search Console and submit
`https://www.dartofficial.com/sitemap.xml` using the owner's connected account.
Submission and Google re-crawling are separate from publishing these technical
changes; a preferred name or ranking is not guaranteed by the markup.
