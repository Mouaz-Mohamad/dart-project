# Courier browser acceptance follow-up — 11 November 2026

The independent GitHub Chromium run of repair `327db88` passed the vector 60-degree camera, heading/arrow, six-second GPS/acknowledgement, delivery confirmation and return pickup Exit/reopen scenarios. It then reproduced a real UI defect: `#repLogout` inherited `display:none` from the old generic `.rep-btn-cancel` style.

A rule scoped to `.dart-rep-dashboard-head #repLogout` restores the visible accessible button and a 44px touch target without changing cancellation buttons elsewhere. The browser test now asserts its visibility immediately after authenticated work is rendered, as well as clicking it after pickup navigation and verifying private work is cleared.

No JavaScript behavior, database migration, endpoint, rate, delivery radius, payment rule or provider configuration changed. The standard CSS bundle was rebuilt. Existing courier source/runtime tests, source freshness, database-authoritative storage, CSS contract and security boundaries are rechecked. The actual Chromium result must be checked after this follow-up is published; the local environment still blocks Chromium's required Unix socket.

Quality review: 1 states, 3 concurrency, 8 scoped regression, 9 test coverage and 10 secrets pass review. 2 server authority, 4 API authorization, 5 idempotency and 6 audit are unchanged. 7 adds no external requests or service costs. Real Android vector support and native floating-map PiP remain the limitations described in the initial repair report.
