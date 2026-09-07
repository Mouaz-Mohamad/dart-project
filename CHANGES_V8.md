# V8 changes

- Routed Contact Us messages into the Review dashboard inbox and added a source filter.
- Restored the complete return decision and inspection controls.
- Kept the destination map visible under a 20% waiting layer and tied live tracking to the representative's Start Delivery action for each order.
- Added monthly/annual Top Clients filters, delivered-order-first ranking, refund-aware spending, customer ages and purchase trends.
- Fixed the map initialization race that removed the newly created Leaflet map.
- Bumped the public static cache name so browsers fetch the corrected assets.

Implementation notes and backend boundaries are in `README.md` and `API_CONTRACT.md`. Verification evidence is in `VERIFICATION_REPORT_V8.md`.
