-- DART CODE GUIDE | backend/migrations/0081_admin_notifications.sql
-- الغرض: إشعارات الإدارة وقراءة مستقلة لكل موظف واشتراكات أجهزة مشفرة.
SET LOCAL lock_timeout = '3s';
CREATE TABLE admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL CHECK(event_type IN ('ORDER_CREATED','RETURN_CREATED','EXCHANGE_CREATED','REVIEW_CREATED')),
  entity_id TEXT NOT NULL,
  entity_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(event_type,entity_id)
);
CREATE INDEX admin_notifications_page_idx ON admin_notifications(created_at DESC,id DESC);
CREATE TABLE admin_notification_reads (
  user_id UUID NOT NULL REFERENCES staff_users(user_id) ON DELETE CASCADE,
  notification_id UUID NOT NULL REFERENCES admin_notifications(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,notification_id)
);
CREATE TABLE admin_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES staff_users(user_id) ON DELETE CASCADE,
  session_family_id UUID NOT NULL,
  endpoint_hash TEXT NOT NULL UNIQUE,
  encrypted_subscription BYTEA NOT NULL,
  credentials_fingerprint TEXT NOT NULL,
  vapid_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disabled_reason TEXT
);
CREATE INDEX admin_push_owner_idx ON admin_push_subscriptions(customer_user_id) WHERE active;
INSERT INTO domain_state_versions(domain) VALUES ('admin_notifications') ON CONFLICT DO NOTHING;
CREATE FUNCTION dart_admin_notification_created() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE domain_state_versions SET version=version+1,updated_at=now() WHERE domain='admin_notifications';
  INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key)
  SELECT 'admin_notification',NEW.id,NEW.event_type,
    jsonb_build_object('channel','web_push','audience','staff','notificationId',NEW.id::text,
      'subscriptionId',p.id::text,'subscriptionVersion',p.version),
    'admin-push:'||NEW.id::text||':'||p.id::text
  FROM admin_push_subscriptions p JOIN users u ON u.id=p.customer_user_id
  WHERE p.active AND u.account_type='staff' AND u.status='active' AND u.deleted_at IS NULL
    AND EXISTS(SELECT 1 FROM sessions s WHERE s.family_id=p.session_family_id AND s.user_id=u.id
      AND s.revoked_at IS NULL AND s.expires_at>now() AND s.user_session_version=u.session_version)
  ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER admin_notification_created AFTER INSERT ON admin_notifications
  FOR EACH ROW EXECUTE FUNCTION dart_admin_notification_created();
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_notification_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON admin_notifications,admin_notification_reads,admin_push_subscriptions FROM PUBLIC;
