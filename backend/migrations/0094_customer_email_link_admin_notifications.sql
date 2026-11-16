-- DART CODE GUIDE | backend/migrations/0094_customer_email_link_admin_notifications.sql
-- الغرض: تنبيه المالك بطلب ربط الإيميل بعد نجاح OTP فقط دون كشف تفاصيل العميل في إشعار الهاتف.
SET LOCAL lock_timeout = '3s';
ALTER TABLE admin_notifications DROP CONSTRAINT admin_notifications_event_type_check;
ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_event_type_check
  CHECK (event_type IN ('ORDER_CREATED','RETURN_CREATED','EXCHANGE_CREATED','REVIEW_CREATED','CUSTOMER_EMAIL_LINK_REQUESTED'));
