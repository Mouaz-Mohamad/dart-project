-- DART CODE GUIDE | backend/migrations/0046_traffic_analytics.sql
-- الغرض: تخزين تحليلات زيارات الموقع ومسار التحويل في PostgreSQL كمصدر الحقيقة.
CREATE TABLE traffic_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('visit','add_to_cart','order_completed')),
  visitor_id UUID NOT NULL,
  session_id UUID NOT NULL,
  customer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  order_code TEXT REFERENCES orders(order_code) ON DELETE SET NULL,
  reservation_id TEXT,
  path TEXT,
  model_id TEXT,
  color TEXT,
  size TEXT,
  quantity INTEGER CHECK (quantity IS NULL OR quantity BETWEEN 1 AND 100),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT traffic_analytics_path_length CHECK (path IS NULL OR length(path) <= 500),
  CONSTRAINT traffic_analytics_variant_consistency CHECK (
    event_type <> 'add_to_cart' OR (reservation_id IS NOT NULL AND model_id IS NOT NULL AND quantity IS NOT NULL)
  ),
  CONSTRAINT traffic_analytics_order_consistency CHECK (
    event_type <> 'order_completed' OR order_code IS NOT NULL
  )
);

CREATE INDEX traffic_analytics_occurred_idx
  ON traffic_analytics_events (occurred_at DESC);
CREATE INDEX traffic_analytics_visitor_idx
  ON traffic_analytics_events (visitor_id, occurred_at DESC);
CREATE INDEX traffic_analytics_customer_idx
  ON traffic_analytics_events (customer_user_id, occurred_at DESC)
  WHERE customer_user_id IS NOT NULL;
CREATE INDEX traffic_analytics_type_occurred_idx
  ON traffic_analytics_events (event_type, occurred_at DESC);

INSERT INTO permissions (key, description) VALUES
  ('analytics.read', 'Read website traffic, cart funnel and conversion analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'analytics.read'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
