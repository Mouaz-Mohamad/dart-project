# Password-reset recipient protection

Forgot-password requests share an account-level PostgreSQL lock across email, phone and account-ID aliases, independently of IP/API instance. Unknown normalized identifiers use a hashed transaction advisory lock and the same response/cooldown rules, preserving non-enumerating behavior.

An email can be queued once per 60 seconds and at most three times in a rolling 15-minute window. Requests within those bounds reuse the latest challenge without resetting attempts or creating another event. A new request no longer invalidates older unexpired codes; successful password reset invalidates every other outstanding challenge while revoking existing sessions. Existing route IP limits, five attempts per challenge, encrypted OTP payload, provider deduplication and password policy remain in place.

No migration or new endpoint. The existing `POST /auth/forgot-password` response keeps its shape and explains throttled delivery. The UI and OpenAPI explain that earlier codes expire naturally. The live reset table was checked before considering an index: two rows/64 kB; no additional schema/index change is required for this repair.

Manual verification should use a synthetic account and fake provider: request through email and phone within a minute, confirm one queued event and the same challenge; after the cooldown request a second code, use the original valid code, and confirm the second is now refused. Exhausted attempts must not be restored by another request. Use isolated PostgreSQL for simultaneous requests from separate service instances.

| Review | Result |
| --- | --- |
| 1. States | Pass: unchanged generic response; limited sending and code lifetime explained. |
| 2. Authority | Pass: recipient budget and code attempts live in PostgreSQL. |
| 3. Concurrency | Pass: account-before-challenge lock order matches reset completion; unknown identifiers use a shared advisory lock. |
| 4. Auth/input | Pass: request schema and completion ownership/status checks retained; no account existence flag. |
| 5. Idempotency | Pass: reused challenges enqueue no duplicate event and retain attempt counts. |
| 6. Audit | Pass: existing issuance/completion audits retained. |
| 7. Cost | Pass: bounds reduce email volume; no WhatsApp or paid-provider test calls. |
| 8. Regression | Pass: account password policies, history and session revocation unchanged. |
| 9. Tests | Pass: alias cooldown, rolling budget, retained attempts, old-code validity, success invalidation, unknown recipients, real-PostgreSQL concurrency and existing UI/routes. 38 local targeted tests pass; two real-PostgreSQL tests run in CI. |
| 10. Secrets | Pass: OTP remains encrypted in outbox, absent from responses/log additions. |
