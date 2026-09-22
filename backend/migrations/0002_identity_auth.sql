-- DART CODE GUIDE | backend/migrations/0002_identity_auth.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
CREATE SEQUENCE dart_customer_code_seq START WITH 1;
CREATE SEQUENCE dart_staff_code_seq START WITH 1;
CREATE SEQUENCE dart_representative_code_seq START WITH 1;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type TEXT NOT NULL
    CHECK (account_type IN ('customer', 'staff', 'representative')),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'pending_approval', 'active', 'suspended', 'rejected', 'deleted')),
  email_verified_at TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT false,
  failed_login_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until TIMESTAMPTZ,
  session_version INTEGER NOT NULL DEFAULT 1 CHECK (session_version > 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT users_id_account_type_unique UNIQUE (id, account_type),
  CONSTRAINT users_email_normalized_format CHECK (
    email_normalized = lower(btrim(email_normalized)) AND position('@' IN email_normalized) > 1
  ),
  CONSTRAINT users_verification_consistency CHECK (
    status = 'pending_verification' OR email_verified_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX users_realm_email_unique
  ON users (account_type, email_normalized)
  WHERE deleted_at IS NULL;
CREATE INDEX users_status_idx ON users (account_type, status) WHERE deleted_at IS NULL;

CREATE TABLE account_phones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('customer', 'staff', 'representative')),
  phone_normalized TEXT NOT NULL,
  phone_display TEXT NOT NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT account_phones_user_realm_fk
    FOREIGN KEY (user_id, account_type) REFERENCES users (id, account_type) ON DELETE CASCADE,
  CONSTRAINT account_phones_egyptian_format CHECK (phone_normalized ~ '^20(10|11|12|15)[0-9]{8}$'),
  CONSTRAINT account_phones_user_value_unique UNIQUE (user_id, phone_normalized)
);

CREATE UNIQUE INDEX account_phones_realm_phone_unique
  ON account_phones (account_type, phone_normalized);
CREATE UNIQUE INDEX account_phones_one_primary_per_user
  ON account_phones (user_id)
  WHERE is_primary;

CREATE TABLE customers (
  user_id UUID PRIMARY KEY,
  account_type TEXT NOT NULL DEFAULT 'customer' CHECK (account_type = 'customer'),
  client_code TEXT NOT NULL UNIQUE
    DEFAULT ('DR-' || nextval('dart_customer_code_seq')::TEXT),
  full_name TEXT NOT NULL,
  birthday DATE,
  dart_card_draw_eligible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customers_name_not_blank CHECK (length(btrim(full_name)) >= 3),
  CONSTRAINT customers_user_realm_fk
    FOREIGN KEY (user_id, account_type) REFERENCES users (id, account_type) ON DELETE RESTRICT
);

CREATE TABLE staff_users (
  user_id UUID PRIMARY KEY,
  account_type TEXT NOT NULL DEFAULT 'staff' CHECK (account_type = 'staff'),
  staff_code TEXT NOT NULL UNIQUE
    DEFAULT ('ST-' || nextval('dart_staff_code_seq')::TEXT),
  display_name TEXT NOT NULL,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  mfa_required BOOLEAN NOT NULL DEFAULT true,
  mfa_secret_encrypted BYTEA,
  mfa_enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staff_users_name_not_blank CHECK (length(btrim(display_name)) >= 3),
  CONSTRAINT staff_users_mfa_consistency CHECK (
    (mfa_enabled_at IS NULL AND mfa_secret_encrypted IS NULL)
    OR (mfa_enabled_at IS NOT NULL AND mfa_secret_encrypted IS NOT NULL)
  ),
  CONSTRAINT staff_users_user_realm_fk
    FOREIGN KEY (user_id, account_type) REFERENCES users (id, account_type) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX staff_single_owner_idx ON staff_users (is_owner) WHERE is_owner;

CREATE TABLE representatives (
  user_id UUID PRIMARY KEY,
  account_type TEXT NOT NULL DEFAULT 'representative' CHECK (account_type = 'representative'),
  representative_code TEXT NOT NULL UNIQUE
    DEFAULT ('Rep-' || nextval('dart_representative_code_seq')::TEXT),
  full_name TEXT NOT NULL,
  national_id_hash CHAR(64) NOT NULL UNIQUE,
  national_id_last4 CHAR(4) NOT NULL,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended')),
  approved_by UUID REFERENCES staff_users (user_id),
  approved_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT representatives_name_not_blank CHECK (length(btrim(full_name)) >= 3),
  CONSTRAINT representatives_national_id_last4_format CHECK (national_id_last4 ~ '^[0-9]{4}$'),
  CONSTRAINT representatives_approval_consistency CHECK (
    (approval_status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR approval_status <> 'approved'
  ),
  CONSTRAINT representatives_user_realm_fk
    FOREIGN KEY (user_id, account_type) REFERENCES users (id, account_type) ON DELETE RESTRICT
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id UUID NOT NULL DEFAULT gen_random_uuid(),
  token_hash CHAR(64) NOT NULL UNIQUE,
  csrf_token_hash CHAR(64) NOT NULL,
  user_session_version INTEGER NOT NULL CHECK (user_session_version > 0),
  user_agent TEXT,
  ip_hash CHAR(64),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mfa_verified_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  replaced_by_session_id UUID REFERENCES sessions (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT sessions_revocation_consistency CHECK (
    (revoked_at IS NULL AND revoke_reason IS NULL)
    OR (revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE INDEX sessions_user_active_idx
  ON sessions (user_id, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX sessions_family_idx ON sessions (family_id, created_at);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

CREATE TABLE email_verification_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'change_email')),
  code_hash CHAR(64) NOT NULL,
  attempts_remaining SMALLINT NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT email_verification_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX email_verification_one_active_idx
  ON email_verification_challenges (user_id, purpose)
  WHERE consumed_at IS NULL;

CREATE TABLE password_reset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users (id) ON DELETE SET NULL,
  account_type TEXT NOT NULL
    CHECK (account_type IN ('customer', 'staff', 'representative')),
  identifier_hash CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolved', 'cancelled', 'expired')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES staff_users (user_id),
  CONSTRAINT password_reset_resolution_consistency CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    OR status <> 'resolved'
  )
);

CREATE INDEX password_reset_pending_idx
  ON password_reset_requests (requested_at)
  WHERE status = 'pending';

CREATE TABLE password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX password_history_user_idx ON password_history (user_id, created_at DESC);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT true,
  is_protected BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT permissions_key_format CHECK (key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES staff_users (user_id),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  granted_by UUID REFERENCES staff_users (user_id),
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id UUID NOT NULL REFERENCES staff_users (user_id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, code_hash)
);

INSERT INTO roles (name, description, is_protected) VALUES
  ('Customer', 'Storefront customer', true),
  ('Owner', 'Protected brand owner', true),
  ('Staff', 'Base staff role; permissions are deny-by-default', true),
  ('Representative', 'Approved delivery representative', true);

INSERT INTO permissions (key, description) VALUES
  ('profile.read_own', 'Read the signed-in account profile'),
  ('profile.update_own', 'Update the signed-in account profile'),
  ('sessions.read_own', 'List own sessions'),
  ('sessions.revoke_own', 'Revoke own sessions'),
  ('staff.sessions_revoke', 'Revoke another account session'),
  ('representatives.approve', 'Approve or reject representative accounts');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN (
  'profile.read_own', 'profile.update_own', 'sessions.read_own', 'sessions.revoke_own'
)
WHERE roles.name IN ('Customer', 'Owner', 'Staff', 'Representative');

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key IN ('staff.sessions_revoke', 'representatives.approve')
WHERE roles.name = 'Owner';
