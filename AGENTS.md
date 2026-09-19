# AGENTS.md — Dart | for you (always-on project rules)

Codex reads this file automatically before every task, so the rules below apply on every session without needing to be repeated in each prompt.

## Stack & Setup

- Frontend: Vanilla HTML/CSS/JavaScript (no framework). Do not introduce React/Vue/etc. without explicit approval.
- Backend: Node.js/Express, TypeScript, PostgreSQL.
- Before your first task in a fresh session, discover and record the actual install/build/test/lint commands from `package.json` and any README — do not guess them. If none exist yet for a piece you're adding, add them and keep this file's "Commands" section below updated.

## Commands

- Install: `cd backend && npm install`
- Run storefront dev server: `python3 -m http.server 4173`
- Run backend dev server: `cd backend && npm run dev`
- Run backend checks: `cd backend && npm run check`
- Run existing frontend checks: use the individual Node.js/Python commands listed under `docs/README.md` → **Checks**.
- Lint: `cd backend && npm run lint`
- Run a single migration: `cd backend && npm run db:migrate:one -- <migration-name>`

## Non-negotiable architecture rules (every task, every phase)

- **Backend is server-authoritative, always.** Price, discount, stock availability, order status, and COD eligibility are never decided by the client — only validated/displayed there.
- **PostgreSQL is the single source of truth.** No business-critical state lives only in `localStorage`, only in n8n, only in a cache, or only in the frontend.
- **Money is always an integer in Piastres**, with an explicit currency code and centralized rounding. Never a float.
- **Deny by default** on any permission-gated action: no explicit grant means refuse.
- **Do not remove, break, or silently redesign existing working features**, including code not mentioned in the current task. If a shared-code change is genuinely required, explain why before making it.
- **n8n / GPT / MCP / any automation layer is a limited API client, never a bypass** of authentication, authorization, or the database.
- **No secrets, tokens, or credentials in frontend code, client bundles, git history, or logs.** Ever.
- **WhatsApp messages cost money** (Utility ≈ $0.0036/msg in Egypt, Marketing ≈ $0.0644/msg) — never over-send, never misclassify a transactional message as Marketing, and log volume so cost is visible.
- **Approved channel policy:** WhatsApp is used only for interactive order confirmation, birthday messages, and post-delivery review requests. Routine order status events use Email, Web Push, and in-site notifications.
- Operational/technical names (buttons, statuses, field/module names) stay in English. Explanatory/admin-facing prose can be Arabic. Keep this convention consistent with the existing codebase.

## Workflow expectations

- Before writing implementation code for anything non-trivial: state your plan (files to touch, DB changes, endpoints) and wait for approval.
- Ambiguous or contradictory instructions → ask, don't guess silently.
- Before marking any feature "done," run the **`dart-quality-review`** skill (see `.agents/skills/`) against it.
- Report back per finished item: files changed, migrations added, endpoints added/changed, and how to manually test it end-to-end.

## Current execution phase

Refer to `Codex_Master_Prompt.md` for the full phased roadmap (Phase 1–5) and the four specification PDFs for feature detail. Do not start a phase before the previous one has been reviewed and approved.

## Existing-feature awareness

- Some features already exist and only need improvement.
- Some features already exist but still need integration.
- Inspect the current implementation before adding anything so the project does not gain duplicate flows, screens, state, or logic.
- Ask before proceeding whenever the existing implementation and the requested behavior are unclear or contradictory.
