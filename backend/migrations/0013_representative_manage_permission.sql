INSERT INTO permissions (key, description) VALUES
  ('representatives.manage', 'Edit approved or pending representative profile data')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'representatives.manage'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
