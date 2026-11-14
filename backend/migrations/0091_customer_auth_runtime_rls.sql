-- DART CODE GUIDE | backend/migrations/0091_customer_auth_runtime_rls.sql
-- الغرض: السماح لخادم Dart فقط بعمليات OTP وPasskeys مع إبقاء RLS مفعّلاً ومنع وصول الزوار المباشر.
-- Existing grants are managed by scripts/provision-runtime-grants.sql.
-- TO PUBLIC here does NOT grant access: the policy evaluates true only when the
-- authenticated PostgreSQL current_user is the restricted dart_app_runtime role.
-- This avoids hard-coding a role dependency before isolated test DBs provision it.
CREATE POLICY dart_customer_auth_runtime ON customer_email_otp_challenges
  FOR ALL TO PUBLIC
  USING (current_user = 'dart_app_runtime')
  WITH CHECK (current_user = 'dart_app_runtime');

CREATE POLICY dart_customer_auth_runtime ON customer_verified_sessions
  FOR ALL TO PUBLIC
  USING (current_user = 'dart_app_runtime')
  WITH CHECK (current_user = 'dart_app_runtime');

CREATE POLICY dart_customer_auth_runtime ON customer_passkey_credentials
  FOR ALL TO PUBLIC
  USING (current_user = 'dart_app_runtime')
  WITH CHECK (current_user = 'dart_app_runtime');

CREATE POLICY dart_customer_auth_runtime ON customer_passkey_challenges
  FOR ALL TO PUBLIC
  USING (current_user = 'dart_app_runtime')
  WITH CHECK (current_user = 'dart_app_runtime');
