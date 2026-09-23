-- DART CODE GUIDE | backend/migrations/0014_damage_manage_permission.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
INSERT INTO permissions (key, description) VALUES
  ('damage.manage', 'Repair or destroy damaged physical inventory items')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'damage.manage'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
