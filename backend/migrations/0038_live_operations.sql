-- DART CODE GUIDE | backend/migrations/0032_live_operations.sql
-- الغرض: حفظ ترتيب وحالة Stops لخريطة التشغيل الحية بدون إنشاء مصدر طلبات موازٍ.

CREATE TABLE IF NOT EXISTS delivery_route_stops (
  representative_user_id UUID NOT NULL REFERENCES representatives(user_id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sequence_number INTEGER NOT NULL DEFAULT 0 CHECK (sequence_number >= 0),
  route_state TEXT NOT NULL DEFAULT 'upcoming'
    CHECK (route_state IN ('upcoming','current','waiting','problem','delivered','cancelled','refused')),
  manually_ordered BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (representative_user_id, order_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS delivery_route_one_current_per_representative
  ON delivery_route_stops(representative_user_id)
  WHERE route_state='current';

CREATE INDEX IF NOT EXISTS delivery_route_stops_order_idx
  ON delivery_route_stops(order_id);

CREATE INDEX IF NOT EXISTS delivery_route_stops_rep_sequence_idx
  ON delivery_route_stops(representative_user_id, sequence_number, updated_at);

INSERT INTO permissions (key, description) VALUES
  ('live_map.read', 'View the live operations map and active delivery routes'),
  ('live_map.manage', 'Change live route states and route ordering'),
  ('representative_location.read', 'View active representative live locations')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN (
  'live_map.read','live_map.manage','representative_location.read'
)
WHERE roles.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
