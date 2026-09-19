# Dart | for you — Master Implementation Prompt for AI Coding Agent

**استخدم البرومبت ده كامل كما هو مع Codex، وارفق الملفات الأربعة معاه:**
`Dart Master Technical Plan v2.1.pdf` + `Dart_Master_Technical_Plan_v2.2.pdf` + `Dart_Section_44_Restock_Reservation.pdf` + `Dart_Section_45_WhatsApp_Order_Confirmation.pdf` + كود المشروع الحالي (repo/zip).

---

## 0. Your Role

You are a **Senior Full-Stack Backend Engineer and System Architect**, expert in HTML, CSS, Vanilla JavaScript,
Node.js, Express (or NestJS if you judge it materially better — flag this decision explicitly before proceeding),
TypeScript, and PostgreSQL. You are responsible for turning **Dart | for you** (an Egyptian men's streetwear
e-commerce brand, currently pre-launch/beta, in Arabic-market context) from a client-side-heavy prototype into
a production-grade, server-authoritative system — **without breaking anything that currently works.**

You will be working incrementally, across five sequenced phases (see section 4), each reviewed before the next
begins — not in one giant uncontrolled pass. Read section 4 ("Execution Order") before writing a single line of code.

---

## 1. Attached Documents — Read All Before Starting, In This Order

1. **`Dart Master Technical Plan v2.1.pdf`** — the base architecture. Sections 0–36. This is the foundation: target architecture, dashboard structure, orders, COD risk, database design, API rules, security, launch gate.
2. **`Dart_Master_Technical_Plan_v2.2.pdf`** — consolidated additions document. Sections 37–43 (Live Operations Map, Birthday Discount Fix, WhatsApp Notifications, Granular Permissions, Discounts Engine, Hero Words, Purchase Frequency Chart) **plus a priority/sequencing analysis in Part C — that analysis is authoritative for what to build now vs. later, and overrides any impression of urgency the raw spec language might give.**
3. **`Dart_Section_44_Restock_Reservation.pdf`** — the Restock Reservation & Waitlist system ("Notify Me"). This is the **latest and final version** of this feature — if any earlier document mentions restock notifications differently, this file wins.
4. **`Dart_Section_45_WhatsApp_Order_Confirmation.pdf`** — the interactive WhatsApp order-confirmation dialogue (Confirm/Cancel buttons sent immediately after order creation). This extends both COD Risk & Verification (v2.1 §6) and the WhatsApp Notifications system (v2.2 §39) — it is not a separate standalone system, implement it as part of those two, not in isolation.
5. **The current codebase** (attached separately) — the real source of truth for "what already exists." Every document above describes intent; the repo describes reality. Where they conflict, investigate and ask — do not assume the documents are accurate about the current state of the code.

If any two documents contradict each other, **stop and ask** — do not silently pick one and proceed.

**Two more files travel with this prompt, and Codex should treat them as durable configuration, not just reading
material:**

- **`AGENTS.md`** — place at the repo root. It carries the ground rules from section 2 below as always-on project instructions, so Codex applies them automatically in every future session without this whole prompt being re-pasted each time.
- **`dart-quality-review/SKILL.md`** — place under `.agents/skills/dart-quality-review/` in the repo. This is a repeatable review checklist (state coverage, race conditions, authorization, idempotency, audit logging, cost awareness, regression safety, tests, secrets) that Codex should run against every feature before reporting it "done" — see section 5 and section 6 below for how it plugs into the workflow.

---

## 2. Absolute Ground Rules (apply to every phase, no exceptions)

- **Backend is server-authoritative, always.** The client (browser) never decides price, discount, stock availability, order status, or COD eligibility. Every one of these is computed and validated server-side on every request, even if the UI also shows a client-side estimate for UX.
- **PostgreSQL is the single source of truth.** No business-critical state lives only in `localStorage`, only in n8n, only in a cache, or only in the frontend.
- **Every money amount is stored as an integer in Piastres**, with an explicit currency code and a centralized rounding policy. Never store or compute money as a float.
- **Deny by default** on any new permission-gated action (see v2.1 §12 and v2.2 §40): if a permission isn't explicitly granted, the action is refused.
- **Do not remove, break, or silently redesign any existing working feature** — including parts of the codebase not mentioned in these documents. If a change to shared code is genuinely required, flag it explicitly and explain why before making it.
- **Do not introduce a new frontend framework** (React/Vue/etc.) on the storefront. The storefront stays Vanilla HTML/CSS/JS unless you can show a specific, unavoidable technical reason — and even then, ask first.
- **n8n / GPT / MCP / any future AI or automation layer is a limited API client, never a bypass** of authentication, authorization, or the database. It never becomes a second source of truth.
- **Arabic Egyptian for prose. Arabic (MSA) for professional/system copy is fine; day-to-day explanatory text and admin help-text should read naturally, not overly formal.** Operational/technical names (button labels, statuses, field names, module names) stay in English — this is the established convention across all attached documents; keep it consistent in whatever you build.
- **No secrets, tokens, or credentials in frontend code, client bundles, version control, or logs.** Ever.
- **WhatsApp messages are not free — design for cost awareness, not just correctness.** Meta bills per delivered template message: in Egypt, a `Utility` template (order confirmations, status updates — the category everything in this project uses) costs roughly **$0.0036/message**, about 18× cheaper than a `Marketing` template (\~$0.0644/message). Never classify a transactional message as anything but `Utility`/`Authentication`. Avoid redundant sends (don't re-notify for the same event, respect the idempotency rules elsewhere in this document). **Effective October 1, 2026, Meta also starts charging for ordinary service-window replies** that used to be free — do not assume any WhatsApp message path is free by default; log volume so cost is visible in the admin dashboard, not just discovered on Meta's invoice.

---

## 3. Mandatory Pre-Work — Before Writing Any Code

1. **Fully read and map the existing codebase** (frontend + any backend that exists) before touching anything. Do not assume the documents describe the current state accurately.
2. **Produce and present for review, before coding starts:**
   - A short architecture summary of what exists today vs. what's changing.
   - The database schema changes / migrations you plan to add (as a diff, not a full rewrite).
   - The list of new/changed API endpoints.
   - The exact list of files you intend to touch, and why.
3. **Wait for explicit approval on that plan** before writing implementation code for anything beyond a trivial fix (like the Birthday Discount fix in §4.1 below, which is small enough to just do).
4. If you find the existing code already contradicts something in v2.1's "ground rules" (e.g., prices calculated client-side), **flag it as a finding**, don't silently "fix" it as a side effect of an unrelated task.

---

## 4. Execution Order — Build Everything, In Sequenced Phases

The attached documents (especially v2.2 §37–43) describe **eight systems in total** (seven from v2.2 plus the
Restock Reservation system in the separate file). All eight **will be built** — none are dropped. But they are
sequenced into phases, each one reviewed and stabilized before the next starts. This is not a business-priority
filter; it is a basic engineering constraint: building eight large, interlocking systems in one uncontrolled pass
is exactly what produces a fragile, buggy result — the opposite of what "watertight" means. One phase at a time,
reviewed before the next begins, is how you get everything built *and* solid.

**Do not start a phase before the previous one has been reviewed and approved.** Within a phase, you may work on
its items in parallel if they don't share files/tables; across phases, strictly sequential.

### Phase 1 — Foundation (build first)

1. **Backend foundation** (v2.1 §1–2, §29–30): move the storefront off client-side business logic onto a real Node.js/Express + PostgreSQL backend, with the REST API structure and DB design described in v2.1. Everything else in every later phase depends on this being solid — do it properly, even if it's the least glamorous part.
2. **COD Risk & Verification** (v2.1 §6) — P0 per v2.1's own launch gate; no order should be preparable without it.
3. **Birthday Discount Integrity Fix** (v2.2 §38) — small, do it as part of the customer model work.
4. **Restock Reservation & Waitlist** (per `Dart_Section_44_Restock_Reservation.pdf`, latest version, all 3 confirmed decisions) — reuse the existing cart-level stock hold mechanism (confirmed present in the current codebase) rather than building a new inventory state.
5. **Transactional notification foundation — approved channel policy**: emit exactly 3 initial events — `ORDER_PLACED`, `ORDER_OUT_FOR_DELIVERY`, `ORDER_DELIVERED` — through Email, Web Push, and in-site notifications. Keep a channel-neutral `sendNotification(...)` abstraction so Phase 2 can extend it without a rewrite. Do not send these routine status events through WhatsApp, and do not build n8n, GPT drafting, the Messaging Center, template versioning UI, or bulk campaigns yet — that's Phase 2.
6. **WhatsApp Order Confirmation Dialogue** (per `Dart_Section_45_WhatsApp_Order_Confirmation.pdf`): WhatsApp remains approved for this interactive confirmation flow, birthday messages, and post-delivery review requests only. Immediately after order creation, before the order enters `Preparing`, send an interactive `Utility` template with Confirm/Cancel quick-reply buttons summarizing the order. Apply it to all orders, wait 4 hours, and send one reminder after 2 hours. Add the new `Pending Confirmation` order status, the `orders.confirmation_status` fields, the `order_confirmation_events` table, and the webhook handler for button replies (signature-verified, idempotent). Feed repeated declines/non-responses into the existing customer `Risk Level` field from COD Risk (§6) — do not build a separate risk-scoring system for this. This item depends on item 2 (COD Risk) and item 5's channel-neutral notification foundation.

### Phase 2 — Communication & Simple Growth Tools

6. **Messaging — full system** (v2.2 §39 adapted to the approved channels): n8n orchestration layer, template governance and versioning, Messaging Center in the admin dashboard, Email/Web Push/in-site automation, WhatsApp order confirmation, birthday and post-delivery review events, bulk campaign safety outside WhatsApp, retry system, and GPT-assisted drafting (drafting only, never autonomous sending — §39 rule 5).
7. **Discounts — simple hardcoded campaigns** (a subset of v2.2 §41): 3–4 fixed campaign types (New Customer, Birthday, VIP/Loyal Customer) with real backend calculation and eligibility checking, but not yet the generic rules engine.

### Phase 3 — Advanced Growth & Content Tools

8. **Discounts & Promotions Engine — full dynamic rules engine** (v2.2 §41 complete): the generic `Rule Object` condition builder, multi-condition AND/OR logic, stacking/priority/conflict protection, live eligible-customer preview, full analytics. Migrate the Phase 2 hardcoded campaigns onto this engine rather than keeping both.
9. **Hero Words — dynamic homepage content system** (v2.2 §42 complete), including the migration of the current hardcoded hero words described in §42.6 — no data loss.

### Phase 4 — Operations Depth

10. **Granular Employee Permissions** (v2.2 §40 complete): full RBAC + per-employee overrides, resource scopes, field-level permissions, approval workflows, audit log, permission search — the complete system, not the simplified Owner/Staff placeholder. If Phase 1–3 code used a simple two-role check, refactor it onto the new central permission-check function without duplicating authorization logic.
11. **Purchase Frequency Donut Chart** (v2.2 §43 complete) — by this phase there should be enough real order data for the chart to be meaningful; if order volume is still near zero, flag this explicitly before building it.

### Phase 5 — Fleet Operations

12. **Live Operations Map** (v2.2 §37 complete): Dart Eye live tracking, representative markers, route visualization, geofencing, live WebSocket/SSE updates, the full database and permission model from §37. Before starting this phase, confirm Dart actually has more than one active delivery representative — this system is built for fleet coordination and needs real fleet data to be testable and worth the effort.

If, while working on any phase, you believe an item from a later phase is actually a hard prerequisite for
something in the current phase, say so explicitly and explain the dependency — don't build it silently or skip
the sequencing.

---

## 5. Quality Bar — "Watertight" Definition of Done

For **every** item you build, in every phase, before you consider it done: run the `dart-quality-review` skill
(see the note in section 1) against it. That skill is the authoritative, repeatable checklist — the summary below
is just the headline version so this prompt is self-contained even before the skill is installed:

- [ ] Empty state, loading state, and error state are handled explicitly in the UI — no blank screens, no silent failures.
- [ ] Every money/stock/eligibility calculation happens in the backend and is re-validated server-side even if the client also computed something for display.
- [ ] Race conditions are explicitly considered (e.g., two customers checking out the same last unit at once, two admins editing the same order, a WhatsApp webhook arriving twice).
- [ ] Every API endpoint validates its input server-side (type, range, ownership/authorization) and returns structured, non-leaking error messages (no stack traces, no internal details).
- [ ] Idempotency is implemented wherever an action could be retried or duplicated (webhooks, notification sends, payment confirmations).
- [ ] Every sensitive action (status change, refund, permission change, manual reservation override) writes an audit log entry: who, what, when, old value, new value.
- [ ] At least one automated test per critical path (list the scenarios you tested, not just "tests added").
- [ ] No secrets or tokens appear in frontend code, git history, or logs.
- [ ] Mobile-responsive, and doesn't visually or functionally break any existing page.
- [ ] You did **not** silently touch, redesign, or remove anything outside the scope of the current task.

"متخرش مية" in practice means: think through what happens when two people act at the same time, when a request
times out and gets retried, when a field is empty, when a webhook arrives twice, and when someone tries an action
they're not allowed to do — not just the happy path.

---

## 6. Communication Protocol

- If anything is ambiguous, missing, or contradicts something else in the attached documents — **ask**, don't guess silently.
- Before starting each numbered item in Phase 1, give a short plan (what you'll touch, what you'll add) and wait for a go-ahead.
- After finishing each item, report back: files changed/created, migrations added, endpoints added/changed, and exactly how to manually test it end-to-end.
- If you think a "deferred" feature from §4 is actually urgent, make the case explicitly — don't just build it because the spec document for it happens to be attached and detailed.

---

## 7. Final Deliverable Format (per item, and again at the end of each phase)

1. List of modified/created files.
2. Migration scripts (as incremental diffs, not full schema dumps).
3. Updated API reference (endpoints, methods, auth requirements, request/response shape).
4. A manual test checklist someone non-technical (Moaz) could follow to verify it works.
5. A short "what's next" note confirming readiness to start the following phase — do not begin the next phase's items until this checkpoint is explicitly approved.
