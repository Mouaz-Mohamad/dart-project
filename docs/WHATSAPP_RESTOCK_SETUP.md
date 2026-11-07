# WhatsApp Restock — Dart

Meta-approved template: `dart_restock_available` (Arabic, Marketing).
Three body variables, in order: model name, actual color, actual size. The approved URL button opens `profile.html?view=waiting`.

## Eligibility
- Each Waiting request may opt in explicitly via the optional, unchecked WhatsApp Marketing checkbox. Old requests and unselected requests get the existing Email and in-site messages, unchanged.
- Exact variant only. Alternative color offers do not use this template.
- Database allocates a physical item and reserves it first, then queues a single durable outbox event in the same transaction when the entry becomes Reserved.
- The sender checks active allocation status, ownership, requested variant, inventory cart lock, consent phone vs current primary phone, user active state, and reservation expiry immediately before Meta.
- The outbox deduplicates by allocation ID and quarantines uncertain provider outcomes.
- Marketing is only sent within 13:00–22:00 Cairo. If a reservation expires before the next allowed window, the WhatsApp event is not queued. Existing other channels still work.
- No historical backfill or third-party automation.

## Deployment
- Apply migrations in order with the checksummed runner: 0074 must precede 0075.
- Configure `WHATSAPP_RESTOCK_TEMPLATE=dart_restock_available` only on Vercel `dart-api` Production (with `WHATSAPP_SEND_ENABLED=true`). An empty value disables just restock WhatsApp.
- Test fresh opt-in Waiting, exact match, alternative match, no opt-in, expired/cancelled/reassigned allocation, changed phone and duplicate trigger.
- A successful API request is not proof of delivery; require `Delivered` webhook receipt.
- The Meta template says 4 hours from the message; PostgreSQL holds are currently 4 hours from allocation, so My Waiting is the authoritative expiration time.
