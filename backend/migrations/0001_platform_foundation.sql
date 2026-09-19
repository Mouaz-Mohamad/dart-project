CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'customer', 'staff', 'representative', 'api_client')),
  actor_id UUID,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  old_values JSONB,
  new_values JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  request_id VARCHAR(128),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_timeline_idx
  ON audit_logs (entity_type, entity_id, occurred_at DESC);
CREATE INDEX audit_logs_actor_timeline_idx
  ON audit_logs (actor_type, actor_id, occurred_at DESC)
  WHERE actor_id IS NOT NULL;
CREATE INDEX audit_logs_request_id_idx
  ON audit_logs (request_id)
  WHERE request_id IS NOT NULL;

CREATE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  deduplication_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'published', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX outbox_events_deduplication_key_unique
  ON outbox_events (deduplication_key)
  WHERE deduplication_key IS NOT NULL;
CREATE INDEX outbox_events_pending_delivery_idx
  ON outbox_events (available_at, created_at)
  WHERE status IN ('pending', 'failed');
CREATE INDEX outbox_events_aggregate_idx
  ON outbox_events (aggregate_type, aggregate_id, created_at DESC);

CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  key_hash CHAR(64) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'failed')),
  response_code INTEGER CHECK (response_code BETWEEN 100 AND 599),
  response_body JSONB,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, key_hash),
  CONSTRAINT idempotency_keys_completed_response_check CHECK (
    status <> 'completed' OR response_code IS NOT NULL
  )
);

CREATE INDEX idempotency_keys_expiry_idx ON idempotency_keys (expires_at);
