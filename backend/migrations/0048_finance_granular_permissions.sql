-- DART CODE GUIDE | backend/migrations/0048_finance_granular_permissions.sql
-- الغرض: فصل صلاحيات Finance للعرض والإدارة والتصدير بدون منح وصول مالي شامل.

INSERT INTO permissions (key, description) VALUES
  ('finance.view_revenue', 'View Finance revenue, order and customer-frequency metrics'),
  ('finance.view_cost', 'View Finance P&L cost and operating-cost metrics'),
  ('finance.view_profit', 'View Finance profit and margin metrics'),
  ('finance.view_cashflow', 'View Finance cash-flow metrics'),
  ('finance.view_inventory_value', 'View Finance inventory investment and damage-value metrics'),
  ('finance.view_marketing', 'View Finance marketing performance metrics'),
  ('finance.manage_expenses', 'Create and manage Finance expense records'),
  ('finance.manage_budgets', 'Create and manage Finance budget records'),
  ('finance.manage_invoices', 'Create and manage Finance invoice records'),
  ('finance.manage_goals', 'Create and manage Finance goal records'),
  ('finance.manage_marketing', 'Create and manage Finance marketing records'),
  ('finance.manage_settlements', 'Create and manage Finance COD settlement records'),
  ('finance.export', 'Export Finance data allowed by the employee view permissions')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN (
  'finance.view_revenue','finance.view_cost','finance.view_profit','finance.view_cashflow',
  'finance.view_inventory_value','finance.view_marketing','finance.manage_expenses',
  'finance.manage_budgets','finance.manage_invoices','finance.manage_goals',
  'finance.manage_marketing','finance.manage_settlements','finance.export'
)
WHERE roles.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
