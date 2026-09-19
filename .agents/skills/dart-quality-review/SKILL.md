---
name: dart-quality-review
description: Run before marking any Dart feature or task "done". A repeatable quality-review checklist that catches race conditions, missing states, unvalidated inputs, and other issues that make code fragile — use this any time you finish implementing a backend endpoint, a database change, a payment/stock/discount calculation, or a WhatsApp/notification flow in the Dart project.
---

# Dart Quality Review

This skill is the standard pre-"done" checklist for the Dart | for you project. Run through every applicable
item below against the code you just wrote. Do not report a task as complete until it passes this review — if an
item doesn't apply, say so explicitly rather than skipping it silently.

## 1. State coverage
- [ ] Empty state handled explicitly (e.g., no waitlist entries, no active discounts, no representatives online).
- [ ] Loading state handled where the UI waits on an async call.
- [ ] Error state handled with a clear, non-leaking message (no stack traces, no internal identifiers exposed).

## 2. Server authority
- [ ] Every money, stock, eligibility, or status calculation is done (or re-validated) server-side, even if the
      client also renders an estimate for UX.
- [ ] No endpoint trusts a price, discount amount, or stock count sent from the client without recomputing it.

## 3. Concurrency & race conditions
- [ ] Explicitly consider: what happens if two requests hit this at the same instant? (e.g., two customers
      checking out the last unit, two admins editing the same order, a webhook arriving twice.)
- [ ] Optimistic locking / versioning used where two writers could otherwise silently overwrite each other.

## 4. Input validation & authorization
- [ ] Every endpoint validates input server-side: type, range, and ownership (this employee/customer is allowed
      to act on this specific resource).
- [ ] Permission check goes through the central authorization function — not a scattered/local role check.
- [ ] Unauthorized requests return a consistent 403 with no information leakage.

## 5. Idempotency
- [ ] Any action that could be retried or duplicated (webhook, notification send, payment confirmation) is safe
      to receive twice without side effects happening twice.

## 6. Audit & observability
- [ ] Every sensitive action (status change, refund, permission change, manual override, reservation/confirmation
      change) writes an audit log entry: who, what, when, old value, new value.
- [ ] Nothing sensitive is only visible by reading application logs — it's queryable through the audit trail.

## 7. Cost & external-service awareness
- [ ] If this touches WhatsApp/Meta API calls: confirm the message category (Utility vs Marketing) is correct,
      and that no redundant/duplicate sends are possible for the same event.
- [ ] If this touches a paid third-party service, volume/cost is logged somewhere visible in the admin dashboard.

## 8. Regression safety
- [ ] Confirm this change did not silently touch, redesign, or remove anything outside its stated scope.
- [ ] Existing pages/features that share a file, table, or component with this change still work as before.

## 9. Tests
- [ ] At least one automated test per critical path touched. List the exact scenarios covered (not just "tests
      added") in the final report.

## 10. Secrets
- [ ] No token, API key, or credential appears in frontend code, committed files, or log output introduced by
      this change.

---

## How to report the result

At the end of the review, summarize as a short pass/fail table against sections 1–10, not just "looks good."
Any unchecked item must either be fixed before reporting "done," or explicitly flagged with a reason it doesn't
apply to this particular piece of work.
