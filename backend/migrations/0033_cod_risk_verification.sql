-- DART CODE GUIDE | backend/migrations/0033_cod_risk_verification.sql
-- الغرض: تأسيس COD Risk & Verification كحاجز خادمي قبل Preparing، مع سجل تدقيق وتهيئة قابلة للنسخ.
-- Starter defaults for rapid-repeat/order-value are intentionally configurable because the approved plan
-- defines the signals and refusal escalation, but does not prescribe numeric thresholds for those two signals.

ALTER TABLE customers
  ADD COLUMN cod_risk_level TEXT NOT NULL DEFAULT 'Low'
    CHECK (cod_risk_level IN ('Low','Medium','High','Restricted')),
  ADD COLUMN cod_risk_score SMALLINT NOT NULL DEFAULT 0
    CHECK (cod_risk_score BETWEEN 0 AND 100),
  ADD COLUMN cod_risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(cod_risk_reasons)='array'),
  ADD COLUMN cod_refusals_in_window INTEGER NOT NULL DEFAULT 0
    CHECK (cod_refusals_in_window >= 0),
  ADD COLUMN cod_risk_policy_version BIGINT NOT NULL DEFAULT 1
    CHECK (cod_risk_policy_version > 0),
  ADD COLUMN cod_risk_updated_at TIMESTAMPTZ;

ALTER TABLE orders
  ADD COLUMN cod_risk_level TEXT NOT NULL DEFAULT 'Low'
    CHECK (cod_risk_level IN ('Low','Medium','High','Restricted')),
  ADD COLUMN cod_risk_score SMALLINT NOT NULL DEFAULT 0
    CHECK (cod_risk_score BETWEEN 0 AND 100),
  ADD COLUMN cod_risk_reasons JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(cod_risk_reasons)='array'),
  ADD COLUMN cod_refusals_in_window INTEGER NOT NULL DEFAULT 0
    CHECK (cod_refusals_in_window >= 0),
  ADD COLUMN cod_risk_policy_version BIGINT NOT NULL DEFAULT 1
    CHECK (cod_risk_policy_version > 0),
  ADD COLUMN cod_verification_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN cod_verification_status TEXT NOT NULL DEFAULT 'Not Required'
    CHECK (cod_verification_status IN (
      'Not Required','Required','Pending','Verified','Failed','Manual Review'
    )),
  ADD COLUMN cod_verification_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN cod_verified_at TIMESTAMPTZ,
  ADD COLUMN cod_verified_by UUID REFERENCES staff_users(user_id) ON DELETE SET NULL;

CREATE INDEX orders_cod_verification_queue_idx
  ON orders (cod_verification_status, created_at DESC)
  WHERE NOT is_deleted AND status IN ('New','Accepted');

CREATE INDEX customers_cod_risk_idx
  ON customers (cod_risk_level, cod_risk_updated_at DESC);

CREATE INDEX orders_customer_refusal_history_idx
  ON orders (customer_user_id, updated_at DESC)
  WHERE status='Refused' AND NOT is_deleted;

CREATE TABLE cod_verification_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  customer_user_id UUID REFERENCES customers(user_id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  risk_level TEXT NOT NULL
    CHECK (risk_level IN ('Low','Medium','High','Restricted')),
  risk_score SMALLINT NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  verification_status TEXT NOT NULL
    CHECK (verification_status IN (
      'Not Required','Required','Pending','Verified','Failed','Manual Review'
    )),
  policy_version BIGINT NOT NULL CHECK (policy_version > 0),
  reason TEXT NOT NULL DEFAULT '',
  actor_type TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('system','customer','staff','representative','api_client')),
  actor_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata)='object'),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX cod_verification_events_order_idx
  ON cod_verification_events (order_id, occurred_at DESC);
CREATE INDEX cod_verification_events_customer_idx
  ON cod_verification_events (customer_user_id, occurred_at DESC)
  WHERE customer_user_id IS NOT NULL;

INSERT INTO permissions (key, description) VALUES
  ('orders.verify_cod', 'Approve or fail COD verification before Preparing')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id
FROM roles
JOIN permissions ON permissions.key='orders.verify_cod'
WHERE roles.name='Owner'
ON CONFLICT (role_id, permission_id) DO NOTHING;

UPDATE site_settings
   SET data=jsonb_set(
         data,
         '{codRisk}',
         '{
           "version": 1,
           "refusalWindowDays": 90,
           "manualReviewRefusalCount": 2,
           "rapidRepeatWindowMinutes": 120,
           "rapidRepeatOrderCount": 3,
           "highOrderValueMinor": 300000,
           "restrictedOrderValueMinor": 750000,
           "mediumScoreMin": 20,
           "highScoreMin": 50,
           "restrictedScoreMin": 80,
           "requireFirstOrderVerification": true,
           "requireUnverifiedPhoneVerification": true
         }'::jsonb,
         true
       ),
       version=version+1,
       updated_at=now()
 WHERE id='main'
   AND NOT (data ? 'codRisk');

WITH stats AS (
  SELECT
    c.user_id,
    count(o.id) FILTER (
      WHERE o.status='Refused'
        AND NOT o.is_deleted
        AND o.updated_at >= now() - interval '90 days'
    )::int AS refusals_in_window,
    EXISTS (
      SELECT 1
        FROM account_phones p
       WHERE p.user_id=c.user_id
         AND p.account_type='customer'
         AND p.verified_at IS NOT NULL
    ) AS verified_phone
  FROM customers c
  LEFT JOIN orders o ON o.customer_user_id=c.user_id
  GROUP BY c.user_id
)
UPDATE customers c
   SET cod_risk_level=CASE
         WHEN s.refusals_in_window >= 2 THEN 'Restricted'
         WHEN s.refusals_in_window = 1 THEN 'High'
         WHEN NOT s.verified_phone THEN 'Medium'
         ELSE 'Low'
       END,
       cod_risk_score=CASE
         WHEN s.refusals_in_window >= 2 THEN 100
         WHEN s.refusals_in_window = 1 THEN 50
         WHEN NOT s.verified_phone THEN 20
         ELSE 0
       END,
       cod_risk_reasons=CASE
         WHEN s.refusals_in_window >= 2 THEN '["MULTIPLE_REFUSALS_IN_WINDOW"]'::jsonb
         WHEN s.refusals_in_window = 1 THEN '["REFUSAL_HISTORY"]'::jsonb
         WHEN NOT s.verified_phone THEN '["PHONE_NOT_VERIFIED"]'::jsonb
         ELSE '[]'::jsonb
       END,
       cod_refusals_in_window=s.refusals_in_window,
       cod_risk_updated_at=now()
  FROM stats s
 WHERE c.user_id=s.user_id;

WITH policy AS (
  SELECT
    COALESCE(NULLIF(data #>> '{codRisk,version}','')::bigint,1) AS policy_version,
    COALESCE(NULLIF(data #>> '{codRisk,highOrderValueMinor}','')::bigint,300000) AS high_order_value_minor
  FROM site_settings
  WHERE id='main'
),
facts AS (
  SELECT
    o.id,
    c.cod_risk_level AS customer_risk_level,
    c.cod_risk_score AS customer_risk_score,
    c.cod_risk_reasons AS customer_risk_reasons,
    c.cod_refusals_in_window,
    p.policy_version,
    NOT EXISTS (
      SELECT 1
        FROM orders prior
       WHERE prior.customer_user_id=o.customer_user_id
         AND prior.id<>o.id
         AND NOT prior.is_deleted
         AND prior.created_at < o.created_at
    ) AS first_order,
    NOT EXISTS (
      SELECT 1
        FROM account_phones phone
       WHERE phone.user_id=o.customer_user_id
         AND phone.account_type='customer'
         AND phone.verified_at IS NOT NULL
    ) AS phone_not_verified,
    o.final_minor >= p.high_order_value_minor AS high_order_value
  FROM orders o
  JOIN customers c ON c.user_id=o.customer_user_id
  CROSS JOIN policy p
  WHERE o.status IN ('New','Accepted')
    AND NOT o.is_deleted
    AND lower(o.payment_method) LIKE '%cash%'
),
scored AS (
  SELECT
    f.*,
    LEAST(
      100,
      f.customer_risk_score
      + CASE WHEN f.first_order THEN 30 ELSE 0 END
      + CASE WHEN f.phone_not_verified THEN 20 ELSE 0 END
      + CASE WHEN f.high_order_value THEN 20 ELSE 0 END
    )::int AS score
  FROM facts f
)
UPDATE orders o
   SET cod_risk_level=CASE
         WHEN s.customer_risk_level='Restricted' OR s.score >= 80 THEN 'Restricted'
         WHEN s.customer_risk_level='High' OR s.score >= 50 THEN 'High'
         WHEN s.score >= 20 THEN 'Medium'
         ELSE 'Low'
       END,
       cod_risk_score=s.score,
       cod_risk_reasons=
         s.customer_risk_reasons
         || CASE WHEN s.first_order THEN '["FIRST_ORDER"]'::jsonb ELSE '[]'::jsonb END
         || CASE WHEN s.phone_not_verified THEN '["PHONE_NOT_VERIFIED"]'::jsonb ELSE '[]'::jsonb END
         || CASE WHEN s.high_order_value THEN '["HIGH_ORDER_VALUE"]'::jsonb ELSE '[]'::jsonb END,
       cod_refusals_in_window=s.cod_refusals_in_window,
       cod_risk_policy_version=s.policy_version,
       cod_verification_required=(
         s.customer_risk_level<>'Low'
         OR s.first_order
         OR s.phone_not_verified
         OR s.high_order_value
       ),
       cod_verification_status=CASE
         WHEN s.customer_risk_level='Restricted' THEN 'Manual Review'
         WHEN s.customer_risk_level<>'Low' OR s.first_order OR s.phone_not_verified OR s.high_order_value
           THEN 'Required'
         ELSE 'Not Required'
       END,
       cod_verification_reason='Backfilled COD risk profile',
       version=version+1,
       updated_at=now()
  FROM scored s
 WHERE o.id=s.id;

UPDATE domain_state_versions
   SET version=version+1, updated_at=now()
 WHERE domain='orders';
