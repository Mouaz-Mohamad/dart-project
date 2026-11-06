# Representative verification viewer

The dashboard opens a native modal dialog synchronously, then loads the three images through the existing permissioned admin document endpoint. It no longer uses a popup: `noopener` intentionally gives `window.open` no usable WindowProxy, and asynchronous API waits also lose browser user activation.

The dialog shows loading, handles individual failed documents with a safe retry, and accepts only embedded JPEG/PNG/WebP data URLs. Close, Escape and admin logout remove image sources and the dialog. Late API responses cannot reopen it. No browser persistence, API endpoint, permission or database change was introduced.

Manual test: use Verification documents on an authorized representative row; review three images in the same page; close using Close/Escape. Reopen under a simulated API failure and retry. Log out while loading to confirm the viewer disappears. Automated Chromium coverage uses only synthetic images and an API double, including narrow/wide screens and external URL rejection.

| Review | Result |
| --- | --- |
| 1. States | Pass: loading, partial failure and retry. |
| 2. Authority | Pass: documents still come exclusively from the protected API. |
| 3. Concurrency | Pass: closing/replacing/logout invalidates late responses. |
| 4. Auth/input | Pass: permissioned route unchanged; encoded representative ID and image-only embedded URLs. |
| 5. Idempotency | Pass: read-only retry, no operational mutation. |
| 6. Audit | Pass: existing server document-access audit remains unchanged. |
| 7. External cost | Not applicable: no provider or message call. |
| 8. Regression | Pass: approval/rejection and list rendering unchanged. |
| 9. Tests | Pass: native Chromium checks plus all 47 static frontend checks. |
| 10. Secrets | Pass: no raw API errors or persistent document bytes; images scrubbed on dismissal. |
