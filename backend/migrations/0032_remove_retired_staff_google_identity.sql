-- DART CODE GUIDE | backend/migrations/0026_remove_retired_staff_google_identity.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
-- Remove the retired Google/Supabase Staff identity storage after the
-- simplified email-verification flow became the only Dart Eye Staff auth path.

UPDATE staff_invitations
   SET access_mode='email_otp',
       mfa_required=false,
       updated_at=now()
 WHERE access_mode='google';

DROP INDEX IF EXISTS staff_users_supabase_user_unique;
DROP INDEX IF EXISTS staff_users_provider_subject_unique;
DROP INDEX IF EXISTS staff_invitations_google_allowlist_idx;

ALTER TABLE staff_users
  DROP CONSTRAINT IF EXISTS staff_users_auth_provider_check,
  DROP CONSTRAINT IF EXISTS staff_users_google_link_consistency,
  DROP COLUMN IF EXISTS auth_provider,
  DROP COLUMN IF EXISTS supabase_user_id,
  DROP COLUMN IF EXISTS provider_subject,
  DROP COLUMN IF EXISTS identity_linked_at,
  DROP COLUMN IF EXISTS identity_last_login_at;

ALTER TABLE staff_invitations
  DROP CONSTRAINT IF EXISTS staff_invitations_access_mode_check;

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_access_mode_check CHECK (
    access_mode IN ('legacy_otp', 'email_otp')
  );

INSERT INTO audit_logs (
  actor_type, actor_id, action, entity_type, entity_id, metadata
) VALUES (
  'system',
  NULL,
  'STAFF_RETIRED_GOOGLE_IDENTITY_STORAGE_REMOVED',
  'staff_access',
  'email_otp',
  '{"activeAuth":"email_otp","googleIdentityStorageRemoved":true}'::jsonb
);
