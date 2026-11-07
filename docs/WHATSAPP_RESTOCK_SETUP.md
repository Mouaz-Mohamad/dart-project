# WhatsApp Restock — Dart

Meta-approved template: `dart_restock_available` (Arabic, Marketing).
Three body variables, in order: model name, actual color, actual size. The approved URL button opens `profile.html?view=waiting`.

## Eligibility
- The customer explicitly requests a Dart WhatsApp restock alert by clicking "Notify me when available". The adjacent notice identifies Dart | for you, WhatsApp and the scope of both exact and alternative offers. No separate checkbox is displayed. The authenticated POST endpoint records the affirmative customer request automatically, regardless of which Waiting button calls it; no legacy backfill or blanket consent.
- A customer with no saved primary phone still joins Waiting and receives the existing email and in-site notifications; WhatsApp is not sent without a bound number. Existing Waiting entries are not silently opted in.
- Exact restock uses the approved `dart_restock_available` template. Alternative color offers require a separately approved and explicitly labeled template; never reuse the exact template for an alternative.
- Database allocates a physical item and reserves it first, then queues a single durable outbox event in the same transaction when the entry becomes Reserved.
- The sender checks active allocation status, ownership, requested variant, inventory cart lock, consent phone vs current primary phone, user active state, and reservation expiry immediately before Meta.
- The outbox deduplicates by allocation ID and quarantines uncertain provider outcomes.
- A customer-requested restock message is queued immediately when the exact item is reserved (including overnight); it does not use the birthday/review 13:00–22:00 quiet-hour gate. Other templates keep their existing send windows. The system always rechecks the 4-hour allocation expiration at send time.
- No historical backfill or third-party automation.

## Deployment
- Apply migrations in order with the checksummed runner: 0076 must follow the already applied 0075.
- Configure `WHATSAPP_RESTOCK_TEMPLATE=dart_restock_available` only on Vercel `dart-api` Production (with `WHATSAPP_SEND_ENABLED=true`). An empty value disables just restock WhatsApp.
- Test fresh opt-in Waiting, exact match, alternative match, no opt-in, expired/cancelled/reassigned allocation, changed phone and duplicate trigger.
- A successful API request is not proof of delivery; require `Delivered` webhook receipt.
- The Meta template says 4 hours from the message; PostgreSQL holds are currently 4 hours from allocation, so My Waiting is the authoritative expiration time.
