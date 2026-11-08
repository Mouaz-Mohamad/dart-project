# Dart branded search improvements — 2026-11-08

## Scope

The preferred site name remains `Dart`. Home and product Organization entities agree on ID, name, logo, URL and existing social profiles. Product Brand and News publisher naming agrees with that identity. About and collection metadata include the Arabic name naturally.

The footer adds a short visible Arabic description with Products and About links. Shared navigation uses `/` and `/products`. `/index.html` permanently redirects to `/`. Staging includes the exact original Story fragment in About's initial HTML. The existing static marker prevents a duplicate client load and preserves section events and the settings-controlled founder image. No Story text or styles were changed.

No database changes, migrations, backend endpoints, business rules, prices, authentication or analytics changes. Static JSON-LD hashes were refreshed in the existing CSP without weakening it.

## Validation

- Dependency installation and `npm run build` passed; production output includes 25 shared sections. Generated CSS differences were excluded from this SEO commit because no stylesheet source was changed.
- `npm run check:source` passed for 69 maintained browser sources.
- All 51 maintained frontend static checks ran individually: 49 passed. Both failures below were reproduced in a clean worktree at `4c4b60a37c91c296767f5461328adff3674cdec1`.
- Targeted checks passed: `tests/seo_checks.js`, `tests/product_ssr_seo.cjs`, `tests/news-seo.cjs`, `tests/product_deep_links.cjs`, `tests/founder-media-runtime.cjs`, `tests/database-authoritative-storage.cjs`, JavaScript syntax and `git diff --check`.
- SEO regression coverage: home/product brand consistency, social profiles, canonical navigation and redirect, visible Arabic copy, staged original Story and unique founder image.
- Before release, live home, robots, root sitemap and all child sitemaps returned HTTP 200. Static sitemap: 5 URLs; products: 5 URLs; News: 0 URLs. An empty valid News sitemap is expected without published articles.
- Local preview could not be reached by the remote browser. Production visual checks passed for the original Story/founder image, visible Arabic footer and Products link. About and Products had no horizontal overflow at the observed 1363 px viewport. Separate mobile viewport verification was not performed.
- Production HTTP checks passed: Home, About and Products returned 200 with canonical URLs and CSP-authorized JSON-LD. `/index.html` redirected to `/`; root/product/News sitemaps returned valid XML. Storefront release `02bcc8d` is READY on both custom domains; the previous READY API release was preserved by cancelling its unnecessary automatic rebuild.
- CI's navigation browser test initially searched for the old `/index.html` menu link. Its selector now follows the canonical `/` link; navigation behavior itself was checked in the live browser. The static CI job still reports the inherited CSS failure described below.

## Inherited check failures

| Check | Reproduced before this change |
| --- | --- |
| `css-cascade-contract.cjs` | Two covered declarations in an existing embedded style in `index.html`. |
| `performance-budget.cjs` | Committed homepage bundles differ from stylesheet sources; two existing Made For You PNGs exceed 2.5 MB. |

## Quality review

| Section | Result |
| --- | --- |
| 1. State coverage | Pass: existing SSR 404/503, empty News sitemap and fragment behavior tests; no new async UI flow. |
| 2. Server authority | N/A: no money, stock, eligibility or status calculations changed. |
| 3. Concurrency | Pass: main publication uses a head lease; static marker avoids duplicate Story loading. No business writes introduced. |
| 4. Validation and authorization | N/A: no input or permission paths changed. Security headers retained. |
| 5. Idempotency | Pass: staging regenerates output; Story uses the existing static marker. No business mutations. |
| 6. Audit and observability | N/A: no sensitive action introduced; one Git commit records the task. |
| 7. External costs | N/A: no messaging, paid API or additional subscription introduced. |
| 8. Regression safety | Targeted checks passed; inherited failures documented above. Original styles and Story retained; final visual check is part of release verification. |
| 9. Tests | Pass for brand metadata/CSP, canonical links, staged Story, founder settings, News/product SSR and database storage boundary. |
| 10. Secrets | Pass: no credentials added; existing public verification metadata retained. |

## Search measurement limitation

The GSC Wizard connection reports an expired trial/no active subscription, so ranking and Google index status could not be measured through it. HTTP availability and valid sitemaps do not prove indexing or ranking. No first-position or indexing-time guarantee, or Search Console submission, is claimed.

## Live review

Open Home, Products and About. Check the small Arabic footer introduction and both links. About must show the original Story and founder image. `/index.html` must redirect to `/`. Initial HTML must contain the Story, Arabic footer and JSON-LD without waiting for JavaScript.
