# V8 changes

- Routed Contact Us messages into the Review dashboard inbox and added a source filter.
- Restored the complete return decision and inspection controls.
- Kept the destination map visible under a 20% waiting layer and tied live tracking to the representative's Start Delivery action for each order.
- Added monthly/annual Top Clients filters, delivered-order-first ranking, refund-aware spending, customer ages and purchase trends.
- Fixed the map initialization race that removed the newly created Leaflet map.
- Bumped the public static cache name so browsers fetch the corrected assets.
- Corrected the public Leaderboard to subtract completed returned Item Codes from `PIC` while leaving pending and rejected return requests uncounted.

Implementation notes and backend boundaries are in `README.md` and `API_CONTRACT.md`. Verification evidence is in `VERIFICATION_REPORT.md`.

## Clean structure update

- Removed recursively copied projects from `CSS`, `Icons` and `sections`.
- Kept one root copy of every standalone page, including `policies.html` and `pdf.html`.
- Kept one root copy of `manifest.json`, `sw.js`, `sitemap.xml` and `robots.txt`.
- Kept `sections/leaderboard-card.html` as the only Leaderboard fragment.
- Consolidated historical change, code-map and verification documents into current files under `docs`.
- Removed duplicate stylesheet/script imports from reusable fragments and normalized their shared asset paths.
- Added one full-site smoke test for shared sections, menus, filters, authentication switches, receipt rendering, tracking, every dashboard navigation target and root PWA/SEO files.
- Added automated SEO/structure checks for metadata, JSON-LD, sitemap membership, noindex pages, unique canonical files, explicit button types and safe external links.
- Improved public metadata, social previews, structured data and heading semantics; added private-page indexing headers for Vercel.
