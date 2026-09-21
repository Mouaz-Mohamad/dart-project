# Transactional outbox operations

Dart uses PostgreSQL `outbox_events` as the durable source of truth for outbound notifications. Business writes create events transactionally, and the backend publishes WhatsApp events directly to Meta WhatsApp Business Platform (Cloud API). No n8n or third-party automation webhook is required.

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
- approved template names such as `dart_staff_otp`

## Retry endpoint

Use `POST /api/v1/internal/outbox/process` with:

`Authorization: Bearer <OUTBOX_CRON_SECRET>`

The processor claims only WhatsApp events. Failed sends remain in PostgreSQL and retry with exponential backoff; stuck `processing` rows are reclaimable after the lock timeout.

## Security

OTP values stay encrypted at rest inside the outbox payload and are decrypted only immediately before server-side delivery to Meta. Meta access tokens never leave the backend.
