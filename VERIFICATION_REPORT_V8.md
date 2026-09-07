# V8 verification — 2026-09-07

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

This package is still a browser-local prototype. The production backend requirements are documented in `API_CONTRACT.md`.
