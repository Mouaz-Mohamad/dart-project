-- DART CODE GUIDE | backend/migrations/0025_staff_simple_email_access.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
-- Simplified Dart Eye Staff access:
-- Owner manages an email allowlist and role; Staff prove email ownership with a one-time code.
-- No Google OAuth, Supabase Auth, password or TOTP is required for this path.

ALTER TABLE staff_invitations
  DROP CONSTRAINT IF EXISTS staff_invitations_access_mode_check;

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_access_mode_check CHECK (
    access_mode IN ('legacy_otp', 'google', 'email_otp')
  );

UPDATE staff_invitations
   SET access_mode='email_otp',
       mfa_required=false,
       updated_at=now()
 WHERE status='pending'
   AND access_mode='google';

UPDATE staff_users
   SET mfa_required=false,
       updated_at=now()
 WHERE mfa_required=true;

CREATE TABLE staff_email_login_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized TEXT NOT NULL,
  staff_user_id UUID REFERENCES staff_users(user_id) ON DELETE CASCADE,
  invitation_id UUID REFERENCES staff_invitations(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  attempts_remaining SMALLINT NOT NULL DEFAULT 5
    CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_email_login_target_check CHECK (
    (staff_user_id IS NOT NULL AND invitation_id IS NULL)
    OR
    (staff_user_id IS NULL AND invitation_id IS NOT NULL)
  ),
  CONSTRAINT staff_email_login_email_format CHECK (
    email_normalized = lower(btrim(email_normalized))
    AND position('@' IN email_normalized) > 1
  ),
  CONSTRAINT staff_email_login_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX staff_email_login_one_active_email_idx
  ON staff_email_login_challenges (email_normalized)
  WHERE consumed_at IS NULL;

CREATE INDEX staff_email_login_staff_idx
  ON staff_email_login_challenges (staff_user_id, created_at DESC)
  WHERE staff_user_id IS NOT NULL;

CREATE INDEX staff_email_login_invitation_idx
  ON staff_email_login_challenges (invitation_id, created_at DESC)
  WHERE invitation_id IS NOT NULL;

INSERT INTO audit_logs (
  actor_type, actor_id, action, entity_type, entity_id, metadata
) VALUES (
  'system',
  NULL,
  'STAFF_SIMPLE_EMAIL_ACCESS_READY',
  'staff_access',
  'email_otp',
  '{"passwordless":true,"google_required":false,"totp_required":false}'::jsonb
);
