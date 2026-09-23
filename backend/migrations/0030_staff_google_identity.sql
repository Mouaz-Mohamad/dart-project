-- DART CODE GUIDE | backend/migrations/0024_staff_google_identity.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
-- Phase 1: Google + Supabase identity for Dart Eye Staff.
-- Existing Staff password/OTP/TOTP primitives stay intact temporarily for rollback.

ALTER TABLE users
  ALTER COLUMN password_hash DROP NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_password_required_for_non_staff CHECK (
    account_type = 'staff' OR password_hash IS NOT NULL
  );

ALTER TABLE staff_users
  ADD COLUMN auth_provider TEXT,
  ADD COLUMN supabase_user_id UUID,
  ADD COLUMN provider_subject TEXT,
  ADD COLUMN identity_linked_at TIMESTAMPTZ,
  ADD COLUMN identity_last_login_at TIMESTAMPTZ,
  ADD COLUMN created_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  ADD COLUMN disabled_at TIMESTAMPTZ,
  ADD COLUMN disabled_reason TEXT;

ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_auth_provider_check CHECK (
    auth_provider IS NULL OR auth_provider = 'google'
  ),
  ADD CONSTRAINT staff_users_google_link_consistency CHECK (
    (
      auth_provider IS NULL
      AND supabase_user_id IS NULL
      AND provider_subject IS NULL
      AND identity_linked_at IS NULL
    )
    OR
    (
      auth_provider = 'google'
      AND supabase_user_id IS NOT NULL
      AND provider_subject IS NOT NULL
      AND identity_linked_at IS NOT NULL
    )
  );

CREATE UNIQUE INDEX staff_users_supabase_user_unique
  ON staff_users (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

CREATE UNIQUE INDEX staff_users_provider_subject_unique
  ON staff_users (auth_provider, provider_subject)
  WHERE provider_subject IS NOT NULL;

ALTER TABLE staff_invitations
  ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'legacy_otp',
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN revoked_reason TEXT;

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_access_mode_check CHECK (
    access_mode IN ('legacy_otp', 'google')
  );

DO $$
DECLARE
  active_owner_email TEXT;
  owner_email_user_is_owner BOOLEAN;
BEGIN
  SELECT u.email_normalized
    INTO active_owner_email
    FROM staff_users s
    JOIN users u ON u.id=s.user_id
   WHERE s.is_owner=true
     AND u.deleted_at IS NULL
   LIMIT 1;

  IF active_owner_email IS NOT NULL
     AND active_owner_email <> 'midomoaaz3@gmail.com' THEN
    RAISE EXCEPTION 'Existing Owner email does not match the protected Dart Owner';
  END IF;

  SELECT s.is_owner
    INTO owner_email_user_is_owner
    FROM users u
    JOIN staff_users s ON s.user_id=u.id
   WHERE u.account_type='staff'
     AND u.email_normalized='midomoaaz3@gmail.com'
     AND u.deleted_at IS NULL
   LIMIT 1;

  IF active_owner_email IS NULL
     AND owner_email_user_is_owner IS NOT NULL
     AND owner_email_user_is_owner=false THEN
    RAISE EXCEPTION 'Protected Owner email is already assigned to a non-Owner Staff account';
  END IF;
END;
$$;

-- The durable Owner allowlist entry exists before the first Google login.
UPDATE staff_invitations
   SET email='midomoaaz3@gmail.com',
       email_normalized='midomoaaz3@gmail.com',
       display_name='Mouaz Mohamad',
       phone='01104193534',
       phone_normalized='201104193534',
       access_mode='google',
       expires_at=NULL,
       updated_at=now()
 WHERE is_owner=true
   AND status='pending';

INSERT INTO staff_invitations (
  email, email_normalized, phone, phone_normalized,
  display_name, is_owner, mfa_required,
  permission_keys, status, invited_by, expires_at, access_mode
)
SELECT
  'midomoaaz3@gmail.com',
  'midomoaaz3@gmail.com',
  '01104193534',
  '201104193534',
  'Mouaz Mohamad',
  true,
  true,
  '[]'::jsonb,
  'pending',
  NULL,
  NULL,
  'google'
WHERE NOT EXISTS (
  SELECT 1
    FROM staff_users
   WHERE is_owner
)
AND NOT EXISTS (
  SELECT 1
    FROM staff_invitations
   WHERE is_owner=true
     AND status='pending'
);

CREATE UNIQUE INDEX staff_invitations_one_pending_owner_idx
  ON staff_invitations (is_owner)
  WHERE is_owner=true AND status='pending';

CREATE INDEX staff_invitations_google_allowlist_idx
  ON staff_invitations (email_normalized)
  WHERE access_mode='google' AND status='pending';

CREATE FUNCTION protect_last_dart_owner_staff_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_owner THEN
      RAISE EXCEPTION 'The protected Dart Owner cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_owner AND NEW.is_owner IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'The protected Dart Owner cannot be demoted';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_last_dart_owner_staff_row_trigger
  BEFORE UPDATE OF is_owner OR DELETE ON staff_users
  FOR EACH ROW EXECUTE FUNCTION protect_last_dart_owner_staff_row();

CREATE FUNCTION protect_last_dart_owner_user_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_is_owner BOOLEAN;
BEGIN
  SELECT is_owner
    INTO target_is_owner
    FROM staff_users
   WHERE user_id=OLD.id;

  IF TG_OP = 'DELETE' THEN
    IF COALESCE(target_is_owner, false) THEN
      RAISE EXCEPTION 'The protected Dart Owner cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF COALESCE(target_is_owner, false) AND (
    NEW.deleted_at IS NOT NULL
    OR NEW.status IS DISTINCT FROM 'active'
    OR NEW.account_type IS DISTINCT FROM 'staff'
  ) THEN
    RAISE EXCEPTION 'The protected Dart Owner cannot be disabled or deleted';
  END IF;

  IF COALESCE(target_is_owner, false)
     AND (
       NEW.email IS DISTINCT FROM OLD.email
       OR NEW.email_normalized IS DISTINCT FROM OLD.email_normalized
     )
     AND COALESCE(current_setting('dart.owner_break_glass', true), '') <> 'on'
  THEN
    RAISE EXCEPTION 'The protected Dart Owner email requires break-glass recovery';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER protect_last_dart_owner_user_row_trigger
  BEFORE UPDATE OF status, deleted_at, account_type, email, email_normalized OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_last_dart_owner_user_row();

INSERT INTO audit_logs (
  actor_type, actor_id, action, entity_type, entity_id, metadata
) VALUES (
  'system',
  NULL,
  'OWNER_GOOGLE_ALLOWLIST_READY',
  'staff_access',
  'owner',
  '{}'::jsonb
);
