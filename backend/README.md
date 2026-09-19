# Dart backend foundation

This folder is the server-authoritative Node.js/Express/TypeScript backend. The existing Vanilla storefront and Dart Eye dashboard remain unchanged until their individual flows are deliberately migrated to `/api/v1`.

## Local setup

1. Copy `.env.example` to `.env` and keep the file uncommitted.
2. Start PostgreSQL: `docker compose up -d postgres`.
3. Install dependencies: `npm install`.
4. Apply migrations: `npm run db:migrate`.
5. Start the API: `npm run dev`.

The API listens on `http://localhost:4000` by default. Check `/api/v1/health/live` for process liveness and `/api/v1/health/ready` for PostgreSQL readiness.

## Development seed

Synthetic data is disabled by default and forbidden in Production. To run the current foundation seed, set `ALLOW_DEVELOPMENT_SEED=true`, then run `npm run db:seed:dev`. The seed is idempotent and clearly marks its records as synthetic. Business-domain seed data will be added only alongside the matching domain tables.

## Migrations

- Apply all pending migrations: `npm run db:migrate`.
- Apply exactly the next pending migration: `npm run db:migrate:one -- 0001_platform_foundation`.

Applied migration checksums are recorded in `dart_schema_migrations`. Editing an already-applied migration is rejected; add a new migration instead.

## Current scope

This foundation intentionally contains no customer, catalogue, inventory, order, or messaging endpoint. Those modules will be added in approved increments after this platform layer passes review.
