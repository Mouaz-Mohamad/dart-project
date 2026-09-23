-- DART CODE GUIDE | 0029_password_reset_email_otp.sql
-- Self-service customer/representative password recovery by email OTP.

ALTER TABLE password_reset_requests
  ADD COLUMN IF NOT EXISTS code_hash CHAR(64),
  ADD COLUMN IF NOT EXISTS attempts_remaining SMALLINT NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

ALTER TABLE password_reset_requests
  DROP CONSTRAINT IF EXISTS password_reset_requests_attempts_remaining_check;
ALTER TABLE password_reset_requests
  ADD CONSTRAINT password_reset_requests_attempts_remaining_check
  CHECK (attempts_remaining BETWEEN 0 AND 5);

ALTER TABLE password_reset_requests
  DROP CONSTRAINT IF EXISTS password_reset_resolution_consistency;
ALTER TABLE password_reset_requests
  ADD CONSTRAINT password_reset_resolution_consistency CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL)
    OR status <> 'resolved'
  );

CREATE INDEX IF NOT EXISTS password_reset_expires_idx
  ON password_reset_requests (expires_at)
  WHERE status='pending' AND code_hash IS NOT NULL;
