-- First-class relational storage for critical dashboard business domains.
-- dashboard_domain_state remains only as a compatibility/version envelope during migration.

CREATE TABLE return_requests (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  return_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'returnId','')) STORED,
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  request_type TEXT GENERATED ALWAYS AS (COALESCE(payload->>'requestType','')) STORED,
  inspection_status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'inspectionStatus','')) STORED,
  customer_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'clientId',payload->>'customerId','')) STORED,
  order_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'orderId','')) STORED,
  item_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'itemCode','')) STORED,
  representative_id TEXT GENERATED ALWAYS AS (COALESCE(payload->>'representativeId','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX return_requests_return_code_unique ON return_requests(return_code) WHERE return_code <> '';
CREATE INDEX return_requests_item_idx ON return_requests(item_code);
CREATE INDEX return_requests_customer_idx ON return_requests(customer_code);
CREATE INDEX return_requests_status_idx ON return_requests(status);
CREATE INDEX return_requests_rep_status_idx ON return_requests(representative_id,status);

CREATE TABLE damage_records (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  item_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'itemCode','')) STORED,
  order_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'orderId','')) STORED,
  return_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'returnId','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX damage_records_item_idx ON damage_records(item_code);
CREATE INDEX damage_records_status_idx ON damage_records(status);

CREATE TABLE promotion_records (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  code TEXT GENERATED ALWAYS AS (upper(COALESCE(payload->>'code',''))) STORED,
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX promotion_records_code_unique ON promotion_records(code) WHERE code <> '';
CREATE INDEX promotion_records_status_idx ON promotion_records(status);

CREATE TABLE loyalty_cards (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  card_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'cardId',payload->>'id','')) STORED,
  customer_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'clientId',payload->>'customerId','')) STORED,
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_cards_code_unique ON loyalty_cards(card_code) WHERE card_code <> '';
CREATE INDEX loyalty_cards_customer_idx ON loyalty_cards(customer_code);
CREATE INDEX loyalty_cards_status_idx ON loyalty_cards(status);

CREATE TABLE birthday_rewards (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  customer_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'clientId',payload->>'customerId','')) STORED,
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  order_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'orderId','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX birthday_rewards_customer_idx ON birthday_rewards(customer_code);
CREATE INDEX birthday_rewards_status_idx ON birthday_rewards(status);

CREATE TABLE notification_records (
  record_id TEXT PRIMARY KEY,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  record_type TEXT GENERATED ALWAYS AS (COALESCE(payload->>'type','')) STORED,
  related_entity_type TEXT GENERATED ALWAYS AS (COALESCE(payload->>'relatedEntityType','')) STORED,
  related_entity_id TEXT GENERATED ALWAYS AS (COALESCE(payload->>'relatedEntityId','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_records_type_idx ON notification_records(record_type);
CREATE INDEX notification_records_entity_idx ON notification_records(related_entity_type,related_entity_id);

CREATE TABLE message_records (
  domain TEXT NOT NULL CHECK (domain IN ('birthday_messages','message_queue')),
  record_id TEXT NOT NULL,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  customer_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'clientId',payload->>'customerId','')) STORED,
  channel TEXT GENERATED ALWAYS AS (COALESCE(payload->>'channel','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(domain,record_id)
);
CREATE INDEX message_records_status_idx ON message_records(domain,status);
CREATE INDEX message_records_customer_idx ON message_records(customer_code);

CREATE TABLE finance_records (
  domain TEXT NOT NULL CHECK (domain IN (
    'finance_expenses','finance_budgets','finance_invoices','finance_goals',
    'finance_marketing','finance_settlements','finance_audit'
  )),
  record_id TEXT NOT NULL,
  position BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload)='object'),
  status TEXT GENERATED ALWAYS AS (COALESCE(payload->>'status','')) STORED,
  order_code TEXT GENERATED ALWAYS AS (COALESCE(payload->>'orderId','')) STORED,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(domain,record_id)
);
CREATE INDEX finance_records_domain_status_idx ON finance_records(domain,status);
CREATE INDEX finance_records_order_idx ON finance_records(order_code) WHERE order_code <> '';

CREATE OR REPLACE FUNCTION dart_domain_record_id(value JSONB)
RETURNS TEXT LANGUAGE SQL IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(value->>'id',''),
    NULLIF(value->>'returnId',''),
    NULLIF(value->>'cardId',''),
    NULLIF(value->>'damageId',''),
    NULLIF(value->>'code',''),
    md5(value::text)
  )
$$;

CREATE OR REPLACE FUNCTION dart_sync_relational_domain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.domain = 'returns' THEN
    DELETE FROM return_requests;
    INSERT INTO return_requests(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'damage' THEN
    DELETE FROM damage_records;
    INSERT INTO damage_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'promotions' THEN
    DELETE FROM promotion_records;
    INSERT INTO promotion_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'cards' THEN
    DELETE FROM loyalty_cards;
    INSERT INTO loyalty_cards(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'birthday_rewards' THEN
    DELETE FROM birthday_rewards;
    INSERT INTO birthday_rewards(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'notifications' THEN
    DELETE FROM notification_records;
    INSERT INTO notification_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain IN ('birthday_messages','message_queue') THEN
    DELETE FROM message_records WHERE domain=NEW.domain;
    INSERT INTO message_records(domain,record_id,position,payload)
    SELECT NEW.domain, dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(domain,record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain IN (
    'finance_expenses','finance_budgets','finance_invoices','finance_goals',
    'finance_marketing','finance_settlements','finance_audit'
  ) THEN
    DELETE FROM finance_records WHERE domain=NEW.domain;
    INSERT INTO finance_records(domain,record_id,position,payload)
    SELECT NEW.domain, dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(domain,record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER dashboard_domain_relational_sync
AFTER INSERT OR UPDATE OF data ON dashboard_domain_state
FOR EACH ROW EXECUTE FUNCTION dart_sync_relational_domain();

-- Backfill every existing critical domain through the same transactional sync path.
UPDATE dashboard_domain_state
   SET data=data,
       updated_at=updated_at
 WHERE domain IN (
   'returns','damage','promotions','cards','birthday_rewards','notifications',
   'birthday_messages','message_queue',
   'finance_expenses','finance_budgets','finance_invoices','finance_goals',
   'finance_marketing','finance_settlements','finance_audit'
 );
