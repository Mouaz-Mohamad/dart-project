CREATE SEQUENCE dart_return_request_seq START WITH 1;

CREATE TABLE dashboard_domain_state (
  domain TEXT PRIMARY KEY CHECK (domain IN (
    'customers','returns','reviews','cards','representatives','damage',
    'notifications','contacts','finance_expenses','finance_budgets',
    'finance_invoices','finance_goals','finance_marketing','finance_settlements'
  )),
  data JSONB NOT NULL DEFAULT '[]'::jsonb,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dashboard_domain_state_array CHECK (jsonb_typeof(data) = 'array')
);

INSERT INTO dashboard_domain_state (domain)
VALUES
  ('customers'),('returns'),('reviews'),('cards'),('representatives'),('damage'),
  ('notifications'),('contacts'),('finance_expenses'),('finance_budgets'),
  ('finance_invoices'),('finance_goals'),('finance_marketing'),('finance_settlements')
ON CONFLICT (domain) DO NOTHING;

INSERT INTO permissions (key, description) VALUES
  ('dashboard_state.read', 'Read migrated dashboard state domains'),
  ('dashboard_state.manage', 'Write migrated dashboard state domains')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('dashboard_state.read','dashboard_state.manage')
WHERE roles.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;
