-- DART CODE GUIDE | backend/migrations/0013_staff_onboarding.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
CREATE TABLE staff_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  mfa_required BOOLEAN NOT NULL DEFAULT true,
  permission_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','claimed','revoked','expired')),
  invited_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  claimed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_invitations_email_normalized_format CHECK (
    email_normalized = lower(btrim(email_normalized)) AND position('@' IN email_normalized) > 1
  ),
  CONSTRAINT staff_invitations_name_not_blank CHECK (length(btrim(display_name)) >= 3),
  CONSTRAINT staff_invitations_permissions_array CHECK (jsonb_typeof(permission_keys) = 'array')
);

CREATE UNIQUE INDEX staff_invitations_one_pending_email_idx
  ON staff_invitations (email_normalized)
  WHERE status='pending';

CREATE TABLE staff_onboarding_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id UUID NOT NULL REFERENCES staff_invitations(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  attempts_remaining SMALLINT NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  setup_token_hash CHAR(64),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_onboarding_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT staff_onboarding_setup_token_consistency CHECK (
    (verified_at IS NULL AND setup_token_hash IS NULL)
    OR verified_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX staff_onboarding_one_active_idx
  ON staff_onboarding_challenges (invitation_id)
  WHERE consumed_at IS NULL;

CREATE TABLE user_permission_overrides (
  user_id UUID NOT NULL REFERENCES staff_users(user_id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  allowed BOOLEAN NOT NULL,
  granted_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission_id)
);

INSERT INTO permissions (key, description) VALUES
  ('staff.read', 'Read staff accounts and invitations'),
  ('staff.manage', 'Invite staff and manage staff permissions')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('staff.read','staff.manage')
WHERE roles.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

INSERT INTO staff_invitations (
  email, email_normalized, display_name, is_owner, mfa_required,
  permission_keys, status, invited_by, expires_at
)
SELECT
  'midomoaaz3@gmail.com',
  'midomoaaz3@gmail.com',
  'Mouaz Mohammed',
  true,
  true,
  '[]'::jsonb,
  'pending',
  NULL,
  NULL
WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE is_owner)
  AND NOT EXISTS (
    SELECT 1 FROM staff_invitations
    WHERE email_normalized='midomoaaz3@gmail.com' AND status='pending'
  );
