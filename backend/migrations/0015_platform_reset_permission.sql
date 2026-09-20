INSERT INTO permissions (key, description) VALUES
  ('platform.reset', 'Permanently reset all Dart business data while preserving protected staff access and audit history')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key = 'platform.reset'
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
