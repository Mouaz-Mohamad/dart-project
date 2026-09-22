-- DART CODE GUIDE | backend/migrations/0006_site_settings.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
CREATE TABLE site_settings (
  id TEXT PRIMARY KEY DEFAULT 'main' CHECK (id = 'main'),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_settings (id, data)
VALUES ('main', '{}'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('settings.manage', 'Manage public storefront settings')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'settings.manage'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
