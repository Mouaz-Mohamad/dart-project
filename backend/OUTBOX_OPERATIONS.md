# Transactional outbox operations

Dart uses PostgreSQL `outbox_events` as the durable source of truth for outbound notifications. Business writes create events transactionally, and the backend publishes email through SMTP and approved WhatsApp events directly through Meta WhatsApp Business Platform (Cloud API). No n8n or third-party automation webhook is required.

## Email delivery

Owner/Staff onboarding and customer verification emails are sent directly by the API through SMTP. Configure `EMAIL_PROVIDER=smtp`, the `SMTP_*` variables, `EMAIL_FROM`, and `EMAIL_FROM_NAME`. The public sender identity should be `Dart | for you`, while the authenticated mailbox address stays server-side.

The onboarding API returns `EMAIL_DELIVERY_UNAVAILABLE` instead of claiming success when SMTP is disabled or the immediate send fails. The failed outbox row remains durable and eligible for a protected retry.

## WhatsApp delivery

The backend sends approved WhatsApp templates directly to:

`https://graph.facebook.com/<GRAPH_VERSION>/<PHONE_NUMBER_ID>/messages`

Credentials are server-only environment variables. Never expose `WHATSAPP_CLOUD_API_TOKEN` or `WHATSAPP_PHONE_NUMBER_ID` in storefront or dashboard JavaScript.

Required production variables:

- `WHATSAPP_CLOUD_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_GRAPH_API_VERSION` (default: `v26.0`)
- `WHATSAPP_TEMPLATE_LANGUAGE`
- `WHATSAPP_OWNER_PHONE` for protected Owner onboarding
- approved template names such as `dart_staff_otp` (Meta AUTHENTICATION template with an OTP COPY_CODE button)

## Retry endpoint

Use `POST /api/v1/internal/outbox/process` with:

`Authorization: Bearer <OUTBOX_CRON_SECRET>`

The processor claims email and WhatsApp events. Failed sends remain in PostgreSQL and retry with exponential backoff; stuck `processing` rows are reclaimable after the lock timeout.

## Security

OTP values stay encrypted at rest inside the outbox payload and are decrypted only immediately before server-side delivery to Meta. Meta access tokens never leave the backend.


## Staff OTP template

Create `dart_staff_otp` in Meta as an `AUTHENTICATION` template with an OTP
`COPY_CODE` button. Dart sends the same one-time code as the body parameter and
the button parameter.
