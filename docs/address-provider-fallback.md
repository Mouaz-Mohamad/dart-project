# Address lookup outage fallback

After a map/GPS pin lookup fails, checkout and return forms offer **Confirm pin and typed address**. The customer must complete the Egypt governorate, area, street, building and floor. The API checks the pin against the existing local administrative polygons without Nominatim, a paid provider or a new service. A typed address alone never invents coordinates.

The new read-only `POST /api/v1/shipping/validate-point` accepts a canonical Egypt governorate and finite coordinates, rejects extra/malformed fields, uses a shared 20-per-minute IP limit and returns only a no-store boolean. This is a geometry check, not a shipping-eligibility grant. Existing checkout/quote coverage restrictions and return-pickup validation remain authoritative on submission.

The form remains invalid during lookup/API timeout, refuses mismatched pins, supports retry and ignores late responses. Editing fallback address details requires explicit reconfirmation; moving the pin removes the previous candidate. Normal verified/saved addresses retain their existing flow. Shared JSON transport, coordinate-zone assignment and selection events are reused to keep the existing frontend size budgets unchanged.

No migration or external provider configuration. Manual acceptance: simulate Nominatim failure, select a pin, complete all address fields, confirm it, and verify ordering stays blocked until the API validates it. Try a mismatched/foreign pin, an API outage, typing during verification and moving the pin. Repeat for return pickup. Use only synthetic API/browser fixtures when testing.

| Review | Result |
| --- | --- |
| 1. States | Pass: loading, geocoder failure, geometry failure, retry and success. |
| 2. Authority | Pass: local server geometry and final coverage/pickup validation; no frontend permission override. |
| 3. Concurrency | Pass: request generations and existing checkout snapshot guard reject stale validation. |
| 4. Auth/input | Pass: public read-only geometry has bounded strict input/rate limits and no customer-data response. Business writes retain authentication/ownership. |
| 5. Idempotency | Pass: confirming a pin never creates an order, return or message. |
| 6. Audit | Not applicable to new business mutations: none added; final order/return audit remains unchanged. |
| 7. Cost | Pass: no new geocoding provider, subscription or message. |
| 8. Regression | Pass: saved pins and normal map/manual/GPS flow covered; core/Home size limits unchanged. |
| 9. Tests | Pass: 21 targeted backend tests; executed runtime races; native Chromium form/fallback/retry/refusal/size checks; all 47 static checks. |
| 10. Secrets | Pass: no browser credentials, address persistence or cached pin response added. |
