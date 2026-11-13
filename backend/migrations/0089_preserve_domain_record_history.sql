-- Preserve row identity, references and history when legacy clients submit lists.
-- No business rows are rewritten by this migration.
CREATE OR REPLACE FUNCTION dart_sync_relational_domain()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE target TEXT; scoped BOOLEAN := false; removed_id TEXT;
BEGIN
  target := CASE NEW.domain
    WHEN 'returns' THEN 'return_requests' WHEN 'damage' THEN 'damage_records'
    WHEN 'promotions' THEN 'promotion_records' WHEN 'cards' THEN 'loyalty_cards'
    WHEN 'birthday_rewards' THEN 'birthday_rewards' WHEN 'notifications' THEN 'notification_records'
    WHEN 'birthday_messages' THEN 'message_records' WHEN 'message_queue' THEN 'message_records'
    WHEN 'finance_expenses' THEN 'finance_records' WHEN 'finance_budgets' THEN 'finance_records'
    WHEN 'finance_invoices' THEN 'finance_records' WHEN 'finance_goals' THEN 'finance_records'
    WHEN 'finance_marketing' THEN 'finance_records' WHEN 'finance_settlements' THEN 'finance_records'
    WHEN 'finance_audit' THEN 'finance_records' ELSE NULL END;
  IF target IS NULL THEN RETURN NEW; END IF;
  scoped := target IN ('message_records','finance_records');
  removed_id := current_setting('dart.domain_remove_id',true);

  -- Missing rows remain protected by a_dashboard_snapshot_guard. Only a named
  -- deletion command may remove its own row; foreign keys retain their meaning.
  IF NULLIF(removed_id,'') IS NOT NULL THEN
    EXECUTE format('DELETE FROM %I WHERE record_id=$1 %s AND NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements($3) value WHERE dart_domain_record_id(value)=$1)',
      target,CASE WHEN scoped THEN 'AND domain=$2' ELSE '' END)
      USING removed_id,NEW.domain,NEW.data;
  END IF;

  IF scoped THEN
    EXECUTE format('INSERT INTO %I AS stored(domain,record_id,position,payload)
      SELECT $1,dart_domain_record_id(value),ordinality,value
      FROM jsonb_array_elements($2) WITH ORDINALITY AS incoming(value,ordinality)
      ON CONFLICT(domain,record_id) DO UPDATE
      SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now()
      WHERE stored.payload IS DISTINCT FROM EXCLUDED.payload OR stored.position IS DISTINCT FROM EXCLUDED.position',target)
      USING NEW.domain,NEW.data;
  ELSIF target='promotion_records' THEN
    EXECUTE 'INSERT INTO promotion_records AS stored(record_id,position,payload,updated_by)
      SELECT dart_domain_record_id(value),ordinality,value,$2
      FROM jsonb_array_elements($1) WITH ORDINALITY AS incoming(value,ordinality)
      ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,
        version=stored.version+1,updated_by=EXCLUDED.updated_by,updated_at=now()
      WHERE stored.payload IS DISTINCT FROM EXCLUDED.payload OR stored.position IS DISTINCT FROM EXCLUDED.position'
      USING NEW.data,NEW.updated_by;
  ELSE
    EXECUTE format('INSERT INTO %I AS stored(record_id,position,payload)
      SELECT dart_domain_record_id(value),ordinality,value
      FROM jsonb_array_elements($1) WITH ORDINALITY AS incoming(value,ordinality)
      ON CONFLICT(record_id) DO UPDATE SET position=EXCLUDED.position,payload=EXCLUDED.payload,updated_at=now()
      WHERE stored.payload IS DISTINCT FROM EXCLUDED.payload OR stored.position IS DISTINCT FROM EXCLUDED.position',target)
      USING NEW.data;
  END IF;
  NEW.data := '[]'::jsonb;
  RETURN NEW;
END $$;

-- Append the financial history in the same transaction as the authoritative row.
CREATE FUNCTION dart_record_finance_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE event_id TEXT := 'FAUD-' || gen_random_uuid()::text; resource TEXT;
BEGIN
  resource := CASE WHEN TG_OP='DELETE' THEN OLD.domain ELSE NEW.domain END;
  IF resource='finance_audit' THEN
    IF TG_OP IN ('UPDATE','DELETE') THEN
      RAISE EXCEPTION 'FINANCE_AUDIT_IMMUTABLE' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND NEW.payload IS NOT DISTINCT FROM OLD.payload THEN RETURN NEW; END IF;
  INSERT INTO finance_records(domain,record_id,position,payload) VALUES('finance_audit',event_id,
    -floor(extract(epoch FROM clock_timestamp())*1000000)::bigint,
    jsonb_build_object('id',event_id,'action',TG_OP,'resource',replace(resource,'finance_',''),
      'entityId',CASE WHEN TG_OP='DELETE' THEN OLD.record_id ELSE NEW.record_id END,
      'before',CASE WHEN TG_OP='INSERT' THEN NULL ELSE OLD.payload END,
      'after',CASE WHEN TG_OP='DELETE' THEN NULL ELSE NEW.payload END,
      'actorId',NULLIF(current_setting('dart.finance_actor_id',true),''),
      'requestId',NULLIF(current_setting('dart.finance_request_id',true),''),
      'actorRole',CASE WHEN NULLIF(current_setting('dart.finance_actor_id',true),'') IS NULL THEN 'System' ELSE 'Staff' END,
      'timestamp',now()));
  UPDATE dashboard_domain_state SET version=version+1,updated_at=now() WHERE domain='finance_audit';
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER finance_record_history AFTER INSERT OR UPDATE OR DELETE ON finance_records
FOR EACH ROW EXECUTE FUNCTION dart_record_finance_history();
REVOKE ALL ON FUNCTION dart_sync_relational_domain(),dart_record_finance_history() FROM PUBLIC;
