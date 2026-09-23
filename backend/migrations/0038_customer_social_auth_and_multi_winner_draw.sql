-- DART CODE GUIDE | backend/migrations/0038_customer_social_auth_and_multi_winner_draw.sql
-- الغرض: Social OAuth للعملاء + إلزام Birthday للحسابات الجديدة + دعم حتى 3 فائزين عند التعادل الكامل في Dart Card.

CREATE TABLE IF NOT EXISTS customer_social_auth_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL CHECK (provider IN ('google','facebook')),
  state_hash CHAR(64) NOT NULL UNIQUE,
  completion_hash CHAR(64),
  provider_subject TEXT,
  provider_email TEXT,
  provider_email_normalized TEXT,
  provider_name TEXT,
  next_destination TEXT NOT NULL DEFAULT 'profile'
    CHECK (next_destination IN ('profile','checkout')),
  status TEXT NOT NULL DEFAULT 'pending_provider'
    CHECK (status IN ('pending_provider','provider_exchange','pending_completion','consumed','cancelled')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT customer_social_challenge_expiry CHECK (expires_at > created_at),
  CONSTRAINT customer_social_completion_consistency CHECK (
    status NOT IN ('pending_completion','consumed')
    OR (provider_subject IS NOT NULL AND provider_email_normalized IS NOT NULL)
  )
);
CREATE INDEX IF NOT EXISTS customer_social_challenges_pending_idx
  ON customer_social_auth_challenges(expires_at)
  WHERE status IN ('pending_provider','provider_exchange','pending_completion');

CREATE TABLE IF NOT EXISTS customer_social_identities (
  provider TEXT NOT NULL CHECK (provider IN ('google','facebook')),
  provider_subject TEXT NOT NULL,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  provider_email_normalized TEXT NOT NULL,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_subject),
  CONSTRAINT customer_social_one_provider_per_customer UNIQUE (customer_user_id, provider)
);
CREATE INDEX IF NOT EXISTS customer_social_identity_customer_idx
  ON customer_social_identities(customer_user_id);

CREATE OR REPLACE FUNCTION dart_require_customer_birthday_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.birthday IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      MESSAGE='CUSTOMER_BIRTHDAY_REQUIRED';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS customers_require_birthday_on_insert ON customers;
CREATE TRIGGER customers_require_birthday_on_insert
BEFORE INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION dart_require_customer_birthday_on_insert();

ALTER TABLE dart_card_draws
  ADD COLUMN IF NOT EXISTS winner_count INTEGER NOT NULL DEFAULT 0
    CHECK (winner_count BETWEEN 0 AND 3);
UPDATE dart_card_draws
   SET winner_count=CASE WHEN winner_user_id IS NULL THEN 0 ELSE 1 END
 WHERE winner_count=0;

CREATE TABLE IF NOT EXISTS dart_card_draw_winners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id UUID NOT NULL REFERENCES dart_card_draws(id) ON DELETE RESTRICT,
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  client_code TEXT NOT NULL,
  piece_count INTEGER NOT NULL CHECK (piece_count > 0),
  net_spend_minor BIGINT NOT NULL CHECK (net_spend_minor >= 0),
  -- Historical snapshot by design: do not FK to loyalty_cards because legacy projection rebuilds may replace card rows.
  card_record_id TEXT NOT NULL UNIQUE,
  winner_position SMALLINT NOT NULL CHECK (winner_position BETWEEN 1 AND 3),
  selection_method TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT dart_card_draw_winner_customer_unique UNIQUE (draw_id, customer_user_id),
  CONSTRAINT dart_card_draw_winner_position_unique UNIQUE (draw_id, winner_position)
);
CREATE INDEX IF NOT EXISTS dart_card_draw_winners_draw_idx
  ON dart_card_draw_winners(draw_id, winner_position);

INSERT INTO dart_card_draw_winners(
  draw_id,customer_user_id,client_code,piece_count,net_spend_minor,
  card_record_id,winner_position,selection_method,created_at
)
SELECT id,winner_user_id,winner_client_code,winning_piece_count,winning_net_spend_minor,
       card_record_id,1,tie_break_method,executed_at
  FROM dart_card_draws
 WHERE winner_user_id IS NOT NULL
   AND card_record_id IS NOT NULL
ON CONFLICT (draw_id, customer_user_id) DO NOTHING;
