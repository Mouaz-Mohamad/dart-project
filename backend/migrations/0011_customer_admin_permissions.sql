-- DART CODE GUIDE | backend/migrations/0011_customer_admin_permissions.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
INSERT INTO permissions (key, description) VALUES
  ('customers.read', 'Read registered customer accounts'),
  ('customers.manage', 'Manage registered customer identity and profile data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('customers.read','customers.manage')
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
