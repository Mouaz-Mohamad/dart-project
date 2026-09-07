# V9 verification — 2026-09-07

## Clean structure and SEO

- Removed the recursively duplicated project copies from `CSS/`, `Icons/`, `sections/` and `sections/sections`.
- Kept one canonical copy of every page, runtime file and reusable fragment. A whole-project SHA-256 scan found no duplicate runtime files.
- Kept dashboard HTML, styles, scripts and private images together under `Eye/`; reusable page fragments remain under `sections/`.
- Consolidated historical reports into one current changelog, code map and verification report under `docs/`.
- Verified all local HTML/CSS/JavaScript/image references and all static buttons. Buttons now declare an explicit type, external new-tab links use `noopener`, and reusable fragments do not reload scripts or styles.
- Added page-specific titles, descriptions, canonicals, robots directives, Open Graph, Twitter cards, headings and valid JSON-LD to every public indexable page.
- Kept only public pages in `sitemap.xml`. Account, checkout, profile, tracking, representative, receipt and dashboard pages are excluded from the sitemap and carry `noindex` in HTML and Vercel headers.
- Added the verified Instagram profile to the Organization structured data and removed placeholder social destinations.

## Passed behavior

- A real Contact Us form submission was stored in the dashboard Review inbox with source, customer contact details and message. Status, stars and title rendered as `-`; Contact Us and Review filters returned only their matching rows.
- Pending returns displayed Accept/Reject. Acceptance exposed Good/Damaged inspection. Good restored the physical item to stock; Damaged changed the item and created a Damage record.
- The tracking module created one map and kept it alive through DOM initialization. The destination marker appeared before representative assignment. The waiting layer computed to 20% black. Assignment alone kept the layer and hid courier location; `deliveryStartedAt` removed it and displayed the courier marker.
- Top Clients defaulted to This Month/None, ranked two orders above one even when the one-order customer spent more, subtracted refunds, switched exclusively to annual mode, and returned to This Month when both filters were cleared.
- Age appeared in Top Clients, Birthday and Client rows. Client History reported separate order and spending changes using the last two complete months.
- Previous V7 browser scenarios still passed: catalogue, shared images, groups, purchase selection, reservations, checkout snapshots, Sold Out and archive behavior.
- Platform, Cairo/Giza address, representative, tracking resolution, syntax, HTML/assets/accessibility and integer-money tests passed.

## Test boundaries

The acceptance tests use isolated local records and a Leaflet-compatible map stub so they can verify application state, marker activation and lifecycle without depending on public tile/router uptime. Live tile delivery, OSRM response time, real GPS permissions and cross-device updates require staging tests after the backend is connected.

The V8 browser suites passed before the structure cleanup. After cleanup, unit, structure, accessibility, asset and SEO suites passed again. A final Chromium rerun could not be completed in this environment because the browser binary was unavailable and its download timed out; `tests/full-site-browser.js` remains in the package for the next local or CI run and now covers every dashboard navigation target.

This package is still a browser-local prototype. The production backend requirements are documented in `API_CONTRACT.md`.
