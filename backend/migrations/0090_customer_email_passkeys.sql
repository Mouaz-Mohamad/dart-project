-- DART CODE GUIDE | backend/migrations/0090_customer_email_passkeys.sql
-- الغرض: تحديات الدخول بالبريد ومفاتيح WebAuthn بدون تغيير سجلات العملاء القائمة.
CREATE TABLE customer_email_otp_challenges (
  id UUID PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('login','register')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  signup_data JSONB,
  code_hash CHAR(64) NOT NULL,
  attempts_remaining SMALLINT NOT NULL DEFAULT 5 CHECK (attempts_remaining BETWEEN 0 AND 5),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_otp_purpose_user CHECK (
    (purpose='login' AND user_id IS NOT NULL AND signup_data IS NULL)
    OR (purpose='register' AND user_id IS NULL AND signup_data IS NOT NULL)
  )
);
CREATE INDEX customer_email_otp_identity_idx ON customer_email_otp_challenges(email_normalized,purpose,created_at DESC);
CREATE INDEX customer_email_otp_expiration_idx ON customer_email_otp_challenges(expires_at);

CREATE TABLE customer_verified_sessions (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method IN ('email_otp','passkey')),
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_verified_session_owner_idx ON customer_verified_sessions(customer_user_id,verified_at DESC);

CREATE TABLE customer_passkey_credentials (
  credential_id TEXT PRIMARY KEY,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE CASCADE,
  public_key_spki BYTEA NOT NULL,
  sign_counter BIGINT NOT NULL DEFAULT 0 CHECK (sign_counter >= 0),
  transports TEXT[] NOT NULL DEFAULT '{}',
  label TEXT NOT NULL DEFAULT 'This device',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  CONSTRAINT customer_passkey_credential_id_length CHECK (length(credential_id) BETWEEN 16 AND 2048),
  CONSTRAINT customer_passkey_public_key_length CHECK (length(public_key_spki) BETWEEN 64 AND 4096)
);
CREATE INDEX customer_passkey_customer_idx ON customer_passkey_credentials(customer_user_id);

CREATE TABLE customer_passkey_challenges (
  id UUID PRIMARY KEY,
  customer_user_id UUID REFERENCES customers(user_id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('register','authenticate')),
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  expected_origin TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_passkey_register_session CHECK (
    action='authenticate' OR (customer_user_id IS NOT NULL AND session_id IS NOT NULL)
  )
);
CREATE INDEX customer_passkey_challenge_expiration_idx ON customer_passkey_challenges(expires_at);

ALTER TABLE customer_email_otp_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_verified_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_passkey_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_passkey_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_email_otp_challenges,customer_verified_sessions,
  customer_passkey_credentials,customer_passkey_challenges FROM PUBLIC;
