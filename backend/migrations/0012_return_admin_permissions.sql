-- DART CODE GUIDE | backend/migrations/0012_return_admin_permissions.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
INSERT INTO permissions (key, description) VALUES
  ('returns.read', 'Read return and exchange requests'),
  ('returns.manage', 'Approve reject assign and inspect return requests')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('returns.read','returns.manage')
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
