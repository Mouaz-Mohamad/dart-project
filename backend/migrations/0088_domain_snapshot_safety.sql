-- Preserve authoritative row stores when an adapter snapshot is incomplete.
CREATE FUNCTION dart_domain_snapshot(domain_name TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE table_name TEXT; result JSONB;
BEGIN
  table_name := CASE domain_name
    WHEN 'returns' THEN 'return_requests' WHEN 'damage' THEN 'damage_records'
    WHEN 'promotions' THEN 'promotion_records' WHEN 'cards' THEN 'loyalty_cards'
    WHEN 'birthday_rewards' THEN 'birthday_rewards' WHEN 'notifications' THEN 'notification_records'
    ELSE NULL END;
  IF table_name IS NOT NULL THEN
    EXECUTE format('SELECT COALESCE(jsonb_agg(payload ORDER BY position,record_id),''[]''::jsonb) FROM %I',table_name) INTO result;
  ELSIF domain_name IN ('birthday_messages','message_queue') THEN
    SELECT COALESCE(jsonb_agg(payload ORDER BY position,record_id),'[]') INTO result FROM message_records WHERE domain=domain_name;
  ELSIF domain_name IN ('finance_expenses','finance_budgets','finance_invoices','finance_goals','finance_marketing','finance_settlements','finance_audit') THEN
    SELECT COALESCE(jsonb_agg(payload ORDER BY position,record_id),'[]') INTO result FROM finance_records WHERE domain=domain_name;
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION dart_guard_domain_snapshot() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE previous JSONB; removed_id TEXT;
BEGIN
  previous := dart_domain_snapshot(NEW.domain);
  IF previous IS NULL THEN RETURN NEW; END IF;
  removed_id := current_setting('dart.domain_remove_id',true);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(previous) stored
    WHERE dart_domain_record_id(stored) IS DISTINCT FROM removed_id
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.data) incoming
        WHERE dart_domain_record_id(incoming)=dart_domain_record_id(stored))
  ) THEN RAISE EXCEPTION 'DOMAIN_SNAPSHOT_INCOMPLETE: %',NEW.domain USING ERRCODE='P0001'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_dashboard_snapshot_guard BEFORE INSERT OR UPDATE OF data ON dashboard_domain_state
FOR EACH ROW EXECUTE FUNCTION dart_guard_domain_snapshot();

-- Canonicalize the authoritative records directly, never their empty envelopes.
CREATE FUNCTION dart_canonical_domain_customer(row_data JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE key TEXT; replacement TEXT;
BEGIN
  FOREACH key IN ARRAY ARRAY['clientId','customerId','customerCode','clientCode'] LOOP
    SELECT c.client_code INTO replacement FROM customer_identity_aliases a JOIN customers c ON c.user_id=a.customer_user_id
      WHERE a.alias=row_data->>key;
    IF replacement IS NOT NULL THEN row_data := jsonb_set(row_data,ARRAY[key],to_jsonb(replacement)); END IF;
  END LOOP;
  RETURN row_data;
END $$;
DO $$
DECLARE target TEXT;
BEGIN
  FOREACH target IN ARRAY ARRAY['return_requests','damage_records','promotion_records','loyalty_cards','birthday_rewards','notification_records','message_records','finance_records'] LOOP
    EXECUTE format('UPDATE %I SET payload=dart_canonical_domain_customer(payload) WHERE payload IS DISTINCT FROM dart_canonical_domain_customer(payload)',target);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION dart_domain_snapshot(TEXT),dart_guard_domain_snapshot(),dart_canonical_domain_customer(JSONB) FROM PUBLIC;
