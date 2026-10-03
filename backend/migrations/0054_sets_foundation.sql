-- DART CODE GUIDE | backend/migrations/0054_sets_foundation.sql
-- الغرض: إضافة Sets ككيان بيع مستقل فوق الموديلات والقطع الفعلية بدون إنشاء مخزون موازٍ.
-- كل Set يجمع موديلات موجودة؛ inventory_items تظل المصدر الوحيد للقطع الفعلية والـSerial والحالة.

CREATE TABLE catalog_sets (
  set_id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
  description TEXT NOT NULL DEFAULT '',
  base_price_minor BIGINT NOT NULL CHECK (base_price_minor >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  images JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(images)='array'),
  active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX catalog_sets_public_idx
  ON catalog_sets(created_at DESC)
  WHERE active AND NOT is_archived AND NOT is_deleted;

CREATE TABLE catalog_set_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  set_id TEXT NOT NULL REFERENCES catalog_sets(set_id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL REFERENCES catalog_models(model_id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 20),
  position INTEGER NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(set_id, model_id)
);

CREATE INDEX catalog_set_components_set_idx
  ON catalog_set_components(set_id, position, id);
CREATE INDEX catalog_set_components_model_idx
  ON catalog_set_components(model_id);

CREATE TABLE set_discount_settings (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id='main'),
  birthday_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (birthday_percent BETWEEN 0 AND 100),
  dart_card_percent NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (dart_card_percent BETWEEN 0 AND 100),
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO set_discount_settings(id) VALUES ('main') ON CONFLICT (id) DO NOTHING;

-- A cart Set is represented by one group and N physical components. The group does not
-- own stock; its components point to inventory_items that are already held by the cart.
CREATE TABLE cart_set_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id TEXT NOT NULL REFERENCES cart_reservations(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL REFERENCES catalog_sets(set_id) ON DELETE RESTRICT,
  set_version BIGINT NOT NULL CHECK (set_version > 0),
  unit_index INTEGER NOT NULL DEFAULT 1 CHECK (unit_index BETWEEN 1 AND 20),
  set_name_snapshot TEXT NOT NULL,
  set_image_snapshot TEXT NOT NULL DEFAULT '',
  components_total_minor BIGINT NOT NULL CHECK (components_total_minor >= 0),
  set_base_price_minor BIGINT NOT NULL CHECK (set_base_price_minor >= 0),
  discount_source TEXT NOT NULL DEFAULT 'None'
    CHECK (discount_source IN ('None','Set','Birthday','Dart Card')),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  final_minor BIGINT NOT NULL CHECK (final_minor >= 0),
  piece_count INTEGER NOT NULL CHECK (piece_count BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(reservation_id, set_id, unit_index)
);

CREATE INDEX cart_set_groups_reservation_idx ON cart_set_groups(reservation_id);

CREATE TABLE cart_set_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES cart_set_groups(id) ON DELETE CASCADE,
  component_id UUID REFERENCES catalog_set_components(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL UNIQUE REFERENCES inventory_items(id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL,
  model_name_snapshot TEXT NOT NULL,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  component_unit_index INTEGER NOT NULL DEFAULT 1 CHECK (component_unit_index BETWEEN 1 AND 20),
  original_model_selling_minor BIGINT NOT NULL CHECK (original_model_selling_minor >= 0),
  cost_snapshot_minor BIGINT NOT NULL CHECK (cost_snapshot_minor >= 0),
  allocated_base_minor BIGINT NOT NULL CHECK (allocated_base_minor >= 0),
  allocated_final_minor BIGINT NOT NULL CHECK (allocated_final_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, model_id, component_unit_index)
);

CREATE INDEX cart_set_components_group_idx ON cart_set_components(group_id);
CREATE INDEX cart_set_components_variant_idx ON cart_set_components(model_id, color, size);

-- Historical Set snapshot. No historical row depends on the current price/name of catalog_sets.
CREATE TABLE order_set_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  set_id TEXT NOT NULL,
  set_name_snapshot TEXT NOT NULL,
  set_image_snapshot TEXT NOT NULL DEFAULT '',
  set_version_snapshot BIGINT NOT NULL CHECK (set_version_snapshot > 0),
  components_total_minor BIGINT NOT NULL CHECK (components_total_minor >= 0),
  set_base_price_minor BIGINT NOT NULL CHECK (set_base_price_minor >= 0),
  discount_source TEXT NOT NULL DEFAULT 'None'
    CHECK (discount_source IN ('None','Set','Birthday','Dart Card')),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  final_minor BIGINT NOT NULL CHECK (final_minor >= 0),
  piece_count INTEGER NOT NULL CHECK (piece_count BETWEEN 1 AND 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX order_set_groups_order_idx ON order_set_groups(order_id, created_at);
CREATE INDEX order_set_groups_set_idx ON order_set_groups(set_id);

CREATE TABLE order_set_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES order_set_groups(id) ON DELETE RESTRICT,
  order_item_id UUID NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL,
  component_unit_index INTEGER NOT NULL DEFAULT 1 CHECK (component_unit_index BETWEEN 1 AND 20),
  original_model_selling_minor BIGINT NOT NULL CHECK (original_model_selling_minor >= 0),
  allocated_base_minor BIGINT NOT NULL CHECK (allocated_base_minor >= 0),
  allocated_final_minor BIGINT NOT NULL CHECK (allocated_final_minor >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, model_id, component_unit_index)
);

CREATE INDEX order_set_components_group_idx ON order_set_components(group_id);

-- Waiting never reserves a subset of a Set. selections stores every requested model/color/size;
-- allocation is attempted atomically by the Sets service only when all pieces are available.
CREATE TABLE set_waiting_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  set_id TEXT NOT NULL REFERENCES catalog_sets(set_id) ON DELETE RESTRICT,
  set_version BIGINT NOT NULL CHECK (set_version > 0),
  set_name_snapshot TEXT NOT NULL,
  set_image_snapshot TEXT NOT NULL DEFAULT '',
  selections JSONB NOT NULL CHECK (jsonb_typeof(selections)='array'),
  piece_count INTEGER NOT NULL CHECK (piece_count BETWEEN 1 AND 100),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','reserved','confirmed','converted','expired','cancelled')),
  reserved_until TIMESTAMPTZ,
  cart_reservation_id TEXT REFERENCES cart_reservations(id) ON DELETE SET NULL,
  order_id UUID REFERENCES orders(id) ON DELETE RESTRICT,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ
);

CREATE INDEX set_waiting_customer_idx
  ON set_waiting_entries(customer_user_id, requested_at DESC);
CREATE INDEX set_waiting_queue_idx
  ON set_waiting_entries(set_id, requested_at, id)
  WHERE status='waiting';

INSERT INTO permissions(key, description) VALUES
  ('sets.read', 'Read Sets definitions, pricing and Set waiting records'),
  ('sets.manage', 'Create, edit, archive and price Sets')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  JOIN permissions p ON p.key IN ('sets.read','sets.manage')
 WHERE r.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO domain_state_versions(domain, version)
VALUES ('sets', 1)
ON CONFLICT (domain) DO NOTHING;
