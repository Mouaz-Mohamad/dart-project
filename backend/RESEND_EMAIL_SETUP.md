# Dart — Resend SMTP production activation

**Status: ready to configure, NOT activated.** This document never contains an API key or actual DNS verification token. Current production email must remain unchanged until the new service passes live checks.

1. Sign in to https://resend.com and select the **Free** plan. In **Domains**, add `dartofficial.com`. Let Resend generate its exact SPF/DKIM/TXT records. Do not invent or reuse sample verification values.
2. Add the records shown by Resend to the authoritative DNS zone for `dartofficial.com` (currently Vercel DNS). Do not delete existing website A/ALIAS or Google verification records. Check whether Resend requires an SPF record on a mail subdomain; do not create conflicting SPF records on the same DNS label.
3. Add a DMARC TXT record only after reviewing any existing one, starting in monitoring mode (`v=DMARC1; p=none`) and monitoring authentication. Ensure the actual sending From domain aligns with SPF or DKIM. SPF, DKIM and DMARC for the website's apex alone will not authenticate messages still sent from a gmail.com address.
4. Wait for **Verified** status in Resend, then generate a **sending-only**, ideally domain-scoped API key. Store this only in the Vercel project `dart-api` environment. Do NOT paste it into GitHub, frontend code, comments, logs or a chat message.
5. Prepare these production environment values atomically, **only after DNS verification**:
   - `EMAIL_PROVIDER=smtp`
   - `SMTP_HOST=smtp.resend.com`
   - `SMTP_PORT=465`
   - `SMTP_SECURE=true`
   - `SMTP_USER=resend`
   - `SMTP_PASS=<restricted Resend API key>` (secret)
   - `EMAIL_FROM=verify@dartofficial.com`
   - `EMAIL_FROM_NAME=Dart | for you`
   - `EMAIL_OTP_TTL_MINUTES=10`
6. Redeploy the API once all values are ready. Confirm new sign-up and sign-in OTPs arrive in **Inbox**, not only that SMTP accepted them. Test Gmail and Outlook, read full message headers (SPF/DKIM/DMARC pass, aligned From), verify expiry and cooldown. Do not perform any tests with real customers' accounts. Check outbox failures, and retain a tested rollback path to the previous SMTP provider.
7. Only declare the issue resolved after an actual deliverability test. An SMTP 250 acceptance is not proof of inbox placement. Keep marketing emails separate from authentication OTP traffic.

Resend SMTP: https://resend.com/docs/send-with-smtp

No production credentials or DNS records were changed by adding this document.
