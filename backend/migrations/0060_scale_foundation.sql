-- Bounded, shared security counters. Contains HMAC hashes, never raw IPs.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  scope TEXT NOT NULL CHECK (length(scope) BETWEEN 1 AND 80),
  key_hash BYTEA NOT NULL CHECK (octet_length(key_hash)=32),
  hits BIGINT NOT NULL CHECK (hits >= 0),
  expires_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, key_hash)
);
CREATE INDEX IF NOT EXISTS api_rate_limits_expiry_idx ON api_rate_limits(expires_at);
ALTER TABLE api_rate_limits ENABLE ROW LEVEL SECURITY;
