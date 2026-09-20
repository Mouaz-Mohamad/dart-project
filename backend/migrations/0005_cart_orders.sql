CREATE SEQUENCE dart_order_code_seq START WITH 1;

CREATE TABLE cart_reservations (
  id TEXT PRIMARY KEY,
  customer_user_id UUID REFERENCES customers(user_id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cart_reservations_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX cart_reservations_expiry_idx ON cart_reservations (expires_at);

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_cart_reservation_fk
  FOREIGN KEY (cart_reservation_id)
  REFERENCES cart_reservations(id)
  ON DELETE SET NULL
  NOT VALID;

ALTER TABLE inventory_items
  VALIDATE CONSTRAINT inventory_items_cart_reservation_fk;

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code TEXT NOT NULL UNIQUE DEFAULT ('K-' || nextval('dart_order_code_seq')::text),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'New'
    CHECK (status IN (
      'New','Preparing','Out With Representative','On The Way','Delivered',
      'Refused','Cancelled','Returned'
    )),
  payment_method TEXT NOT NULL DEFAULT 'Cash on Delivery',
  payment_status TEXT NOT NULL DEFAULT 'Unpaid'
    CHECK (payment_status IN ('Unpaid','Partially Paid','Paid','Refunded','Partially Refunded','Void')),
  subtotal_minor BIGINT NOT NULL CHECK (subtotal_minor >= 0),
  order_discount_minor BIGINT NOT NULL DEFAULT 0 CHECK (order_discount_minor >= 0),
  final_minor BIGINT NOT NULL CHECK (final_minor >= 0),
  amount_paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_paid_minor >= 0),
  amount_refunded_minor BIGINT NOT NULL DEFAULT 0 CHECK (amount_refunded_minor >= 0),
  promotion JSONB,
  delivery_address JSONB NOT NULL,
  delivery_notes TEXT NOT NULL DEFAULT '',
  order_source TEXT NOT NULL DEFAULT 'Website',
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  legacy JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ
);

CREATE INDEX orders_customer_created_idx ON orders (customer_user_id, created_at DESC);
CREATE INDEX orders_status_created_idx ON orders (status, created_at DESC)
  WHERE NOT is_deleted;

CREATE TABLE order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL UNIQUE REFERENCES inventory_items(id) ON DELETE RESTRICT,
  item_code TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  original_unit_minor BIGINT NOT NULL CHECK (original_unit_minor >= 0),
  model_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (model_discount_percent BETWEEN 0 AND 100),
  final_unit_minor BIGINT NOT NULL CHECK (final_unit_minor >= 0),
  cost_snapshot_minor BIGINT NOT NULL CHECK (cost_snapshot_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system','customer','staff','representative','api_client')),
  actor_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_events_order_timeline_idx ON order_events (order_id, occurred_at);

INSERT INTO permissions (key, description) VALUES
  ('orders.read', 'Read customer and admin orders'),
  ('orders.manage', 'Manage order workflow and statuses')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('orders.read', 'orders.manage')
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
