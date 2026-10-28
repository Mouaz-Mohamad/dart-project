# WhatsApp customer messages and delivery receipts

The existing PostgreSQL outbox owns sending, retries and delivery attempts. The
existing five-minute worker also queues eligible birthday messages.

| Event | Category | Body parameters | Schedule |
| --- | --- | --- | --- |
| CUSTOMER_BIRTHDAY_MESSAGE | Marketing | Customer name, discount percent, validity days | 13:00 on the Cairo birthday date |
| CUSTOMER_POST_DELIVERY_REVIEW | Utility, subject to Meta approval | Customer name, order code | Seven elapsed hours after Delivered, moved to the next allowed Cairo time |

Sending is allowed from **13:00 inclusive to 22:00 exclusive in Africa/Cairo**.
The server rechecks immediately before contacting Meta. A delivery at 10:00 is
due at 17:00; a delivery at 17:00 is due at 13:00 the following day. If the
seven-hour target is before 13:00, it moves to 13:00 that day. Quiet hours take
precedence when seven to eight hours cannot fit inside the permitted window.
The five-minute worker normally collects a due event within that interval;
GitHub scheduling and Meta delivery latency are outside the app's control.

The post-delivery trigger is atomic with a new transition into Delivered. It
does not backfill historical orders and deduplicates by order ID. Before sending,
the server rechecks the order status, exact delivery timestamp, active account,
current phone, independent review opt-in and expiry. Cancelled or changed
deliveries, revoked consent, changed phones and stale events are suppressed.
Post-delivery events expire 24 hours after their scheduled time. Birthday events
cannot send after their birthday date. Uncertain provider acceptance is
quarantined for reconciliation instead of being sent twice.

Both optional consents are available in Profile. Birthday opt-in never implies
review consent. Consent is versioned and bound to the primary phone. Routine
order status notifications retain Email, Web Push and in-site delivery.

## Deployment and activation

1. Run backend lint, typecheck, build and tests, frontend checks and the
   database-authoritative browser storage check. Test migrations in isolation.
2. Apply **0066_whatsapp_delivery_status.sql** and **0067_whatsapp_automations.sql**
   through the ordered, checksummed migration runner on the intended Neon
   database before releasing this code. Never edit applied migration SQL.
3. Configure these server-only values in Vercel **dart-api** production:
   - WHATSAPP_PHONE_NUMBER_ID
   - WHATSAPP_CLOUD_API_TOKEN
   - WHATSAPP_APP_SECRET
   - WHATSAPP_WEBHOOK_VERIFY_TOKEN (new random string, at least 32 characters)
   - WHATSAPP_BIRTHDAY_TEMPLATE (Meta-approved Marketing template)
   - WHATSAPP_POST_DELIVERY_TEMPLATE (Meta-approved, order-specific Utility template)
4. Keep **WHATSAPP_SEND_ENABLED=false** during setup. Credentials alone never
   enable sending. Disabled or quiet-hour WhatsApp events are not claimed and do
   not consume retries; Email and Web Push continue.
5. Deploy one reviewed batch on main. Register the callback URL in Meta:
   https://dart-api-dusky.vercel.app/api/v1/webhooks/whatsapp
   Enter the same verify token and subscribe the WABA to the messages field.
6. Test a controlled message, signed receipts and their audit entries. Confirm
   approved template names/categories and review the pending queue.
7. Set WHATSAPP_SEND_ENABLED=true for the approved activation. Enabled sending
   requires both template names and all four Meta values. Keep secrets out of
   chat, frontend code and Git.

The webhook verifies exact request bytes using HMAC SHA-256, limits bodies to
256 KB, filters the configured number, and persists monotonic Sent/Delivered/
Read/Failed states. It does not acknowledge truncated batches. Append-only
audit entries are atomic with real state changes. Request logs and Sentry
redact verification tokens.

Delivery health remains GET /api/v1/admin/messaging/delivery-health, protected by
the central messaging.read permission. Events expose category, masked recipient,
state, provider identity and safe error code. The Birthday dashboard shows recent
Marketing/Utility counts and states. Event counts are **not an exact Meta invoice**.

## Proposed Arabic template bodies

Submit and approve the exact body in Meta. The approved category is authoritative;
adding offers to the order follow-up changes its purpose.

Birthday — three body parameters:

> كل سنة وإنت طيب يا {{1}} 🎂 من Dart ليك خصم عيد ميلادك {{2}}%، ساري لمدة {{3}} أيام وفق شروط خصم عيد الميلاد في حسابك. نتمنالك سنة جميلة ❤️

Order follow-up — two body parameters, no promotional offer:

> أهلًا {{1}}، بنطمن إن طلبك رقم {{2}} من Dart وصلك وكل حاجة تمام. رأيك في الخامة والمقاس وتجربة الاستلام يهمنا. لو عندك ملاحظة، تقدر تتواصل مع خدمة العملاء من موقعنا.

Production delivery remains unverified until Meta credentials, approved templates,
webhook subscription and a controlled live test are completed.
