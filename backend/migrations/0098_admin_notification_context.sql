-- DART CODE GUIDE | backend/migrations/0098_admin_notification_context.sql
-- الغرض: توسيع أنواع إشعارات الإدارة بسياق خادمي دون إرسال أحداث تاريخية.
SET LOCAL lock_timeout = '3s';
ALTER TABLE admin_notifications ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object');
ALTER TABLE admin_notifications DROP CONSTRAINT admin_notifications_event_type_check;
ALTER TABLE admin_notifications ADD CONSTRAINT admin_notifications_event_type_check
  CHECK(event_type IN ('ORDER_CREATED','RETURN_CREATED','EXCHANGE_CREATED','REVIEW_CREATED',
    'CUSTOMER_EMAIL_LINK_REQUESTED','ORDER_STATUS_CHANGED','CONTACT_CREATED','CUSTOMER_CREATED'));
