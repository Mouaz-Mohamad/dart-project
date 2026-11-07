-- Exact-variant WhatsApp Marketing restock only when the Waiting customer explicitly opted in.
-- No historical backfill and no changes to existing Waiting reservation expiry.
ALTER TABLE waitlist_entries ADD COLUMN whatsapp_restock_opt_in_at TIMESTAMPTZ;
ALTER TABLE waitlist_entries ADD COLUMN whatsapp_restock_phone_normalized TEXT
  CHECK (whatsapp_restock_phone_normalized IS NULL OR whatsapp_restock_phone_normalized ~ '^201[0125][0-9]{8}$');
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_whatsapp_consent_pair
  CHECK ((whatsapp_restock_opt_in_at IS NULL) = (whatsapp_restock_phone_normalized IS NULL));

CREATE FUNCTION dart_queue_waitlist_restock_whatsapp()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, pg_temp AS $$
DECLARE
  v_allocation_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_due TIMESTAMPTZ;
  v_model_name TEXT;
  v_phone TEXT;
  v_event_id UUID;
BEGIN
  IF NEW.status <> 'reserved' OR OLD.status='reserved'
     OR NEW.whatsapp_restock_opt_in_at IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT wa.id,wa.expires_at,COALESCE(NULLIF(m.name,''),NEW.model_id),ph.phone_normalized
    INTO v_allocation_id,v_expires_at,v_model_name,v_phone
    FROM waitlist_allocations wa
    JOIN inventory_items i ON i.id=wa.inventory_item_id
    JOIN catalog_models m ON m.model_id=NEW.model_id
    JOIN users u ON u.id=NEW.customer_user_id
    JOIN account_phones ph ON ph.user_id=NEW.customer_user_id
      AND ph.is_primary AND ph.account_type='customer'
   WHERE wa.waitlist_entry_id=NEW.id
     AND wa.status='active' AND wa.match_type='exact'
     AND i.model_id=NEW.model_id AND i.size=NEW.size AND i.color=NEW.desired_color
     AND i.cart_reservation_id=wa.cart_reservation_id AND lower(i.status)='cart reserved'
     AND u.status='active' AND u.deleted_at IS NULL
     AND ph.phone_normalized=NEW.whatsapp_restock_phone_normalized
   ORDER BY wa.allocated_at DESC,wa.id DESC LIMIT 1;

  IF v_allocation_id IS NULL THEN RETURN NEW; END IF;

  -- Respect 13:00-22:00 Cairo; don't queue alerts for a hold that will already be over.
  v_due := dart_whatsapp_send_at(now());
  IF v_due >= v_expires_at THEN RETURN NEW; END IF;

  INSERT INTO outbox_events(aggregate_type,aggregate_id,event_type,payload,deduplication_key,available_at)
  VALUES ('waitlist',NEW.id::text,'WAITLIST_WHATSAPP_RESTOCK',
    jsonb_build_object('channel','whatsapp','category','marketing',
      'to',v_phone,'allocationId',v_allocation_id::text,'expiresAt',v_expires_at,
      'consentVersion','waitlist-restock-whatsapp-v1',
      'parameters',jsonb_build_array(v_model_name,NEW.desired_color,NEW.size)),
    'waitlist.whatsapp.restock:'||v_allocation_id::text,v_due)
  ON CONFLICT(deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NOT NULL THEN
    INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,new_values,metadata)
    VALUES('system','WAITLIST_WHATSAPP_RESTOCK_QUEUED','waitlist',NEW.id::text,
      jsonb_build_object('outboxEventId',v_event_id::text,'allocationId',v_allocation_id::text,
        'expiresAt',v_expires_at,'category','marketing'),
      jsonb_build_object('consentVersion','waitlist-restock-whatsapp-v1'));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER waitlist_restock_whatsapp_queued
AFTER UPDATE OF status ON waitlist_entries
FOR EACH ROW WHEN (NEW.status='reserved' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION dart_queue_waitlist_restock_whatsapp();
