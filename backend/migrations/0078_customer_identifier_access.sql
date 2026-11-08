-- DART CODE GUIDE | backend/migrations/0078_customer_identifier_access.sql
-- الغرض: دخول العملاء بالهاتف أو البريد دون كلمة سر حسب اختيار المالك؛ حماية الموظفين والمناديب مستقلة.
-- Keep old password hashes for rollback/history; customer authentication ignores them.
ALTER TABLE users
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN email_normalized DROP NOT NULL;

ALTER TABLE users DROP CONSTRAINT users_password_required_for_non_staff;
ALTER TABLE users ADD CONSTRAINT users_representative_password_required CHECK (
  account_type <> 'representative' OR password_hash IS NOT NULL
);
ALTER TABLE users ADD CONSTRAINT users_email_pair_required CHECK (
  (account_type = 'customer' AND email IS NULL AND email_normalized IS NULL)
  OR (email IS NOT NULL AND email_normalized IS NOT NULL AND length(btrim(email)) > 0)
);

UPDATE users SET must_change_password=false, failed_login_count=0, locked_until=NULL,
  status=CASE WHEN status='pending_verification' THEN 'active' ELSE status END,
  updated_at=now(), version=version+1
WHERE account_type='customer' AND deleted_at IS NULL
  AND (must_change_password OR failed_login_count<>0 OR locked_until IS NOT NULL OR status='pending_verification');

UPDATE password_reset_requests SET status='cancelled', consumed_at=COALESCE(consumed_at,now())
WHERE account_type='customer' AND status='pending';
UPDATE email_verification_challenges SET consumed_at=now()
WHERE user_id IN (SELECT id FROM users WHERE account_type='customer') AND consumed_at IS NULL;
