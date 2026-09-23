-- DART CODE GUIDE | backend/migrations/0021_action_permissions.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
-- Fine-grained staff action permissions.
-- Broad *.manage permissions remain accepted temporarily as compatibility parents.

INSERT INTO permissions (key, description) VALUES
  ('orders.create', 'Create manual orders'),
  ('orders.edit', 'Edit existing orders'),
  ('orders.archive', 'Archive or restore orders'),
  ('orders.delete', 'Delete orders through the protected state action'),
  ('orders.bulk_manage', 'Use the transitional bulk order state endpoint'),
  ('returns.create_manual', 'Create or edit a manual return'),
  ('returns.review', 'Approve or reject return and exchange requests'),
  ('returns.assign', 'Assign a representative to a return or exchange'),
  ('returns.inspect', 'Record the final Good or Damaged return inspection'),
  ('damage.resolve', 'Mark damaged inventory as Repaired or Destroyed'),
  ('catalog.read', 'Read the private admin catalog state'),
  ('catalog.edit', 'Use the transitional bulk catalog state endpoint')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN (
  'orders.create','orders.edit','orders.archive','orders.delete','orders.bulk_manage',
  'returns.create_manual','returns.review','returns.assign','returns.inspect',
  'damage.resolve','catalog.read','catalog.edit'
)
WHERE roles.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
