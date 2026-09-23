-- DART CODE GUIDE | backend/migrations/0036_dart_card_active_concurrency_lock.sql
-- الغرض: منع سباق concurrent inserts من منح أكثر من Dart Card فعالة لنفس العميل.

CREATE OR REPLACE FUNCTION dart_guard_active_loyalty_card()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  code TEXT := COALESCE(NEW.payload->>'clientId',NEW.payload->>'customerId','');
  new_status TEXT := COALESCE(NEW.payload->>'status','');
  new_limit INTEGER := GREATEST(1,COALESCE(NULLIF(NEW.payload->>'itemLimit','')::integer,NULLIF(NEW.payload->>'purchasedLimit','')::integer,10));
  new_used INTEGER := GREATEST(0,COALESCE(NULLIF(NEW.payload->>'purchasedItems','')::integer,0));
  new_reserved INTEGER := GREATEST(0,COALESCE(NULLIF(NEW.payload->>'reservedItems','')::integer,0));
BEGIN
  IF new_status <> 'Active' OR code='' OR new_used + new_reserved >= new_limit THEN RETURN NEW; END IF;
  IF dart_parse_card_expiry(NEW.payload) IS NOT NULL
     AND dart_parse_card_expiry(NEW.payload) < (now() AT TIME ZONE 'Africa/Cairo')::date THEN RETURN NEW; END IF;

  -- Serialize all active-card decisions for one customer across draw/manual/API writers.
  PERFORM pg_advisory_xact_lock(hashtext('dart-active-card:' || code));

  IF EXISTS(
    SELECT 1 FROM loyalty_cards existing
     WHERE existing.record_id <> NEW.record_id
       AND existing.customer_code=code AND existing.status='Active'
       AND COALESCE(NULLIF(existing.payload->>'purchasedItems','')::integer,0)
         + COALESCE(NULLIF(existing.payload->>'reservedItems','')::integer,0)
         < GREATEST(1,COALESCE(NULLIF(existing.payload->>'itemLimit','')::integer,NULLIF(existing.payload->>'purchasedLimit','')::integer,10))
       AND (dart_parse_card_expiry(existing.payload) IS NULL
         OR dart_parse_card_expiry(existing.payload) >= (now() AT TIME ZONE 'Africa/Cairo')::date)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='CUSTOMER_ALREADY_HAS_ACTIVE_DART_CARD';
  END IF;
  RETURN NEW;
END
$$;
