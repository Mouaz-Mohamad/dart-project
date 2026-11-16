-- DART CODE GUIDE | backend/migrations/0093_customer_email_link_customer_retirement.sql
-- الغرض: عدم تعطيل حذف سجل عميل قديم بسبب طلب ربط إيميل؛ يتبع الطلب دورة حياة الحساب.
ALTER TABLE customer_email_link_requests
  DROP CONSTRAINT customer_email_link_requests_customer_user_id_fkey,
  ADD CONSTRAINT customer_email_link_requests_customer_user_id_fkey
    FOREIGN KEY (customer_user_id) REFERENCES users(id) ON DELETE CASCADE;
