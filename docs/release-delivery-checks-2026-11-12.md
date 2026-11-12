# Release checks and delivery fixes

The storefront and API builds now stop when their required local release checks fail. The API gate runs lint, types and backend tests with a small environment allowlist; it does not pass production database, provider or authentication credentials into tests, and never runs migrations. Real PostgreSQL integration and browser suites remain independent GitHub checks.

Storefront pages load pinned minified derivatives of the full platform and dialog runtimes; Home also loads a minified performance helper. The maintained sources remain available for editing, and SHA-256 provenance checks reject stale generated variants or a page reverting to an unminified input. Core and Home budgets were retained, not increased. The dashboard UI reuses a small element factory to stay within its existing delivery cap.

The image budget now checks referenced HTML/CSS/JS image assets, including srcsets. Unreferenced original photographs remain available; optimized WebP variants are already used in storefront markup. This corrects the earlier audit interpretation: those large originals were not evidence of their being downloaded on each page view.

Other regression fixes:

- Remove an exactly overridden popup `box-sizing` declaration; the winning value remains unchanged.
- Scope review line-count assertions to the existing one-line title and three-line body plus the full-text dialog. No visual redesign.
- Match actual `type` attributes without misidentifying `data-wa-type` as a duplicate. The prior HTML-duplication finding was a false positive in the test.
- Return-fee fixtures now model the current payer/amount contract and still verify Set exchange denial and refund fee presentation.
- Reset fixtures require removal of legacy browser business caches while preserving unrelated preferences. The real staff session remains an HttpOnly server session.
- Classify the existing return-wizard check and wire every maintained static check into CI.
- Wait for the product filter transition and fonts before capturing the navigation fixture's scroll position. Capturing while layout was still expanding caused the prior false scroll-restoration timeout.

Validation: all 58 maintained frontend static checks pass; the existing performance caps pass. The backend's full real PostgreSQL suite passed before the data-safety release. Browser scenarios must additionally pass in GitHub's Chromium environment; local shell Chromium cannot create its required Unix socket in this workspace. Live dashboard inspection reaches its sign-in gate, so authenticated visual verification requires an existing Owner session.
