-- DART CODE GUIDE | backend/migrations/0027_customer_signup_without_email_otp.sql
-- الغرض: السماح للعميل بإنشاء حساب نشط مباشرة؛ OTP يظل لمسارات Staff وتغيير البريد فقط.
ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_verification_consistency;

ALTER TABLE users
  ADD CONSTRAINT users_verification_consistency CHECK (
    account_type = 'customer'
    OR status = 'pending_verification'
    OR email_verified_at IS NOT NULL
  );
