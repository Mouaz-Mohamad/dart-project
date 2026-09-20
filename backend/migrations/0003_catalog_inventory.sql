CREATE TABLE catalog_models (
  model_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  cost_minor BIGINT NOT NULL DEFAULT 0 CHECK (cost_minor >= 0),
  selling_minor BIGINT NOT NULL DEFAULT 0 CHECK (selling_minor >= 0),
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  low_stock_limit INTEGER NOT NULL DEFAULT 5 CHECK (low_stock_limit >= 0),
  size_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  color_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  size_chart JSONB,
  active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  legacy JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX catalog_models_public_idx
  ON catalog_models (created_at DESC)
  WHERE active AND NOT is_archived AND NOT is_deleted;

CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  item_code TEXT NOT NULL UNIQUE,
  model_id TEXT NOT NULL REFERENCES catalog_models (model_id) ON DELETE RESTRICT,
  color TEXT NOT NULL,
  size TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'In stock',
  active BOOLEAN NOT NULL DEFAULT true,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  cart_reservation_id TEXT,
  reservation_until TIMESTAMPTZ,
  order_id TEXT,
  purchase_date TEXT,
  legacy JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inventory_reservation_consistency CHECK (
    (lower(status) = 'cart reserved' AND cart_reservation_id IS NOT NULL AND reservation_until IS NOT NULL)
    OR lower(status) <> 'cart reserved'
  )
);

CREATE INDEX inventory_items_model_variant_idx
  ON inventory_items (model_id, color, size, status);
CREATE INDEX inventory_items_available_idx
  ON inventory_items (model_id, color, size)
  WHERE active AND NOT is_archived AND NOT is_deleted AND lower(status) = 'in stock';
CREATE INDEX inventory_items_reservation_expiry_idx
  ON inventory_items (reservation_until)
  WHERE lower(status) = 'cart reserved';

CREATE TABLE domain_state_versions (
  domain TEXT PRIMARY KEY,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO domain_state_versions (domain, version)
VALUES ('catalog_inventory', 1)
ON CONFLICT (domain) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('catalog.manage', 'Create and edit catalogue models'),
  ('inventory.manage', 'Create and edit physical inventory items')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('catalog.manage', 'inventory.manage')
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
