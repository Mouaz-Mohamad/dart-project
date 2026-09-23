-- DART CODE GUIDE | backend/migrations/0023_staff_mfa_pending_setup.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
-- Allow the required intermediate TOTP setup state:
-- encrypted secret stored, but the first authenticator code not confirmed yet.
-- Existing applied migrations remain immutable.
ALTER TABLE staff_users
  DROP CONSTRAINT IF EXISTS staff_users_mfa_consistency;

ALTER TABLE staff_users
  ADD CONSTRAINT staff_users_mfa_consistency CHECK (
    mfa_enabled_at IS NULL OR mfa_secret_encrypted IS NOT NULL
  );
