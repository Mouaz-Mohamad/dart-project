-- DART CODE GUIDE | backend/migrations/0092_customer_email_link_review.sql
-- الغرض: طلبات ربط البريد بحسابات الهواتف القديمة، بعد OTP وموافقة المالك، دون منح جلسة قبل الاعتماد.
CREATE TABLE customer_email_link_requests (
  id UUID PRIMARY KEY,
  customer_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  phone_normalized TEXT NOT NULL,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  code_hash CHAR(64) NOT NULL,
  attempts_remaining SMALLINT NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified','pending_review','approved','rejected','superseded')),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_email_link_verified_status CHECK (status='unverified' OR verified_at IS NOT NULL),
  CONSTRAINT customer_email_link_reviewed_status CHECK (
    (status IN ('approved','rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    OR status NOT IN ('approved','rejected')
  )
);
CREATE INDEX customer_email_link_email_window ON customer_email_link_requests (email_normalized,created_at DESC);
CREATE INDEX customer_email_link_phone_window ON customer_email_link_requests (phone_normalized,created_at DESC);
CREATE INDEX customer_email_link_review_queue ON customer_email_link_requests (created_at DESC) WHERE status='pending_review';
CREATE UNIQUE INDEX customer_email_link_single_pending ON customer_email_link_requests
  (customer_user_id,email_normalized) WHERE status='pending_review';
ALTER TABLE customer_email_link_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_email_link_requests FROM PUBLIC;
CREATE POLICY dart_customer_email_link_runtime ON customer_email_link_requests
  FOR ALL TO PUBLIC
  USING (current_user = 'dart_app_runtime')
  WITH CHECK (current_user = 'dart_app_runtime');
-- The runtime role is provisioned separately on test databases. Grant it on production
-- when available; this migration must also work on an isolated role-free test DB.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dart_app_runtime') THEN
    GRANT SELECT,INSERT,UPDATE,DELETE ON customer_email_link_requests TO dart_app_runtime;
  END IF;
END $$;
