-- DART CODE GUIDE | backend/migrations/0013_dashboard_domain_permissions.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
INSERT INTO permissions (key, description) VALUES
  ('reviews.read', 'Read customer reviews'),
  ('reviews.manage', 'Moderate and manage customer reviews'),
  ('contacts.read', 'Read customer contact submissions'),
  ('contacts.manage', 'Manage customer contact submissions'),
  ('loyalty.read', 'Read Dart Card and birthday reward state'),
  ('loyalty.manage', 'Manage Dart Card and birthday reward state'),
  ('messaging.read', 'Read customer message queues and birthday message history'),
  ('messaging.manage', 'Manage customer message queues and birthday message history'),
  ('notifications.read', 'Read internal operational notifications'),
  ('notifications.manage', 'Manage internal operational notifications'),
  ('promotions.read', 'Read promotional campaigns'),
  ('promotions.manage', 'Manage promotional campaigns'),
  ('finance.read', 'Read finance dashboard state'),
  ('finance.manage', 'Manage finance dashboard state')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN (
  'reviews.read','reviews.manage',
  'contacts.read','contacts.manage',
  'loyalty.read','loyalty.manage',
  'messaging.read','messaging.manage',
  'notifications.read','notifications.manage',
  'promotions.read','promotions.manage',
  'finance.read','finance.manage'
)
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
