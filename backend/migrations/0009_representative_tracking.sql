ALTER TABLE representatives
  ADD COLUMN IF NOT EXISTS address_text TEXT NOT NULL DEFAULT '';

CREATE TABLE representative_documents (
  representative_user_id UUID NOT NULL REFERENCES representatives(user_id) ON DELETE CASCADE,
  document_type TEXT NOT NULL CHECK (document_type IN ('id_front','id_back','face')),
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp')),
  encrypted_payload BYTEA NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 1048576),
  content_sha256 CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (representative_user_id, document_type)
);

CREATE TABLE representative_locations (
  representative_user_id UUID PRIMARY KEY REFERENCES representatives(user_id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_meters DOUBLE PRECISION CHECK (accuracy_meters IS NULL OR accuracy_meters >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS representative_user_id UUID REFERENCES representatives(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS orders_representative_active_idx
  ON orders (representative_user_id, status, created_at DESC)
  WHERE representative_user_id IS NOT NULL AND NOT is_deleted;

INSERT INTO permissions (key, description) VALUES
  ('representatives.read_applications', 'Read representative applications and encrypted verification documents')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'representatives.read_applications'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
