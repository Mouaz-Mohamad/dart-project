# Outbox maintenance failure isolation

The authenticated POST outbox processor catches maintenance failures and still calls the durable batch processor. Reservation cleanup, rate-limit pruning and birthday queuing run sequentially with independent failure handling; later jobs are attempted after an earlier failure. Birthday events remain queued before the batch so an otherwise empty queue can deliver them in the same invocation.

The response adds `maintenance: { ok, failedJobs }` without raw exception details. The scheduled worker drains its bounded queue before failing visibly for maintenance issues, separately from provider failures and overdue messages. Existing auth, batch limits, deduplication, retries and health reporting remain authoritative. No migration, public endpoint or provider change.

Manual verification should use an isolated test app with a failing maintenance stub and fake outbox provider: messages still process, all remaining maintenance tasks run, and the response/worker reports the failure. Never trigger production messages just to test this change.

| Review item | Result |
| --- | --- |
| 1. States | Pass: successful, failed and absent maintenance represented explicitly. |
| 2. Authority | Pass: durable outbox and existing service policy unchanged. |
| 3. Concurrency | Pass: sequential maintenance retained; outbox claim locking unchanged. |
| 4. Auth/input | Pass: bearer secret validation and bounded query limit run before any work. |
| 5. Idempotency | Pass: no new sends/retries; existing deduplication retained. |
| 6. Observability | Pass: named failure logs, authenticated status and failed scheduled run after draining. |
| 7. Cost | Pass: fake providers in tests; no new channel/event category. |
| 8. Regression | Pass: normal birthday queue-before-delivery order preserved. |
| 9. Tests | Pass: thrown/partial maintenance, successful/default response, unauthorized call and bounded worker continuation. 18 targeted tests pass. |
| 10. Secrets | Pass: response/log additions contain task names only. |
