-- Make row-level tables authoritative for critical business domains.
-- The dashboard_domain_state row remains only as an optimistic-concurrency/version envelope.

DROP TRIGGER IF EXISTS dashboard_domain_relational_sync
  ON dashboard_domain_state;

-- 0018 already backfilled the relational tables. Clear the duplicated arrays before
-- installing the new BEFORE trigger so the clear itself cannot erase the backfill.
UPDATE dashboard_domain_state
   SET data='[]'::jsonb
 WHERE domain IN (
   'returns','damage','promotions','cards','birthday_rewards','notifications',
   'birthday_messages','message_queue',
   'finance_expenses','finance_budgets','finance_invoices','finance_goals',
   'finance_marketing','finance_settlements','finance_audit'
 );

CREATE OR REPLACE FUNCTION dart_sync_relational_domain()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.domain = 'returns' THEN
    DELETE FROM return_requests;
    INSERT INTO return_requests(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'damage' THEN
    DELETE FROM damage_records;
    INSERT INTO damage_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'promotions' THEN
    DELETE FROM promotion_records;
    INSERT INTO promotion_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'cards' THEN
    DELETE FROM loyalty_cards;
    INSERT INTO loyalty_cards(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'birthday_rewards' THEN
    DELETE FROM birthday_rewards;
    INSERT INTO birthday_rewards(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain = 'notifications' THEN
    DELETE FROM notification_records;
    INSERT INTO notification_records(record_id,position,payload)
    SELECT dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain IN ('birthday_messages','message_queue') THEN
    DELETE FROM message_records WHERE domain=NEW.domain;
    INSERT INTO message_records(domain,record_id,position,payload)
    SELECT NEW.domain, dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(domain,record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  ELSIF NEW.domain IN (
    'finance_expenses','finance_budgets','finance_invoices','finance_goals',
    'finance_marketing','finance_settlements','finance_audit'
  ) THEN
    DELETE FROM finance_records WHERE domain=NEW.domain;
    INSERT INTO finance_records(domain,record_id,position,payload)
    SELECT NEW.domain, dart_domain_record_id(value), ordinality, value
      FROM jsonb_array_elements(NEW.data) WITH ORDINALITY AS rows(value,ordinality)
    ON CONFLICT(domain,record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now();
  END IF;

  IF NEW.domain IN (
    'returns','damage','promotions','cards','birthday_rewards','notifications',
    'birthday_messages','message_queue',
    'finance_expenses','finance_budgets','finance_invoices','finance_goals',
    'finance_marketing','finance_settlements','finance_audit'
  ) THEN
    NEW.data := '[]'::jsonb;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER dashboard_domain_relational_sync
BEFORE INSERT OR UPDATE OF data ON dashboard_domain_state
FOR EACH ROW EXECUTE FUNCTION dart_sync_relational_domain();
