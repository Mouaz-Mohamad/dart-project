-- 0096: Never reserve an alternative color from Waiting, whether triggered by
-- inventory restock, admin actions, or an explicit SQL allocator call.
-- Exact model + size + color retains the existing four-hour Waiting hold.
-- An alternative suggestion is informational: it has NO cart, allocation, or stock hold.
-- Historical reservations are intentionally not rewritten in this migration.

CREATE TABLE IF NOT EXISTS waitlist_alternative_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE CASCADE,
  offered_color TEXT NOT NULL,
  suggested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL CHECK (source IN ('system','staff')),
  actor_id UUID,
  CONSTRAINT waitlist_alternative_suggestion_once UNIQUE(waitlist_entry_id,offered_color)
);


-- Sensitive waitlist demand is only available to the authenticated server role.
ALTER TABLE waitlist_alternative_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY dart_waitlist_alternative_runtime ON waitlist_alternative_suggestions TO PUBLIC
  USING (current_user='dart_app_runtime') WITH CHECK (current_user='dart_app_runtime');
REVOKE ALL ON waitlist_alternative_suggestions FROM PUBLIC;

CREATE OR REPLACE FUNCTION dart_waitlist_suggest_alternative(
  p_entry_id UUID,
  p_color TEXT,
  p_actor_type TEXT DEFAULT 'system',
  p_actor_id UUID DEFAULT NULL,
  p_request_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_entry waitlist_entries%ROWTYPE;
  v_suggestion_id UUID;
  v_notification_id TEXT;
  v_client_code TEXT;
  v_model_name TEXT;
BEGIN
  SELECT * INTO v_entry FROM waitlist_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_entry.status<>'waiting' OR v_entry.eligible_after>now()
     OR NOT v_entry.allow_alternative_color
     OR NOT dart_waiting_bool_setting(ARRAY['waiting','enabled'],true)
     OR NOT dart_waiting_bool_setting(ARRAY['waiting','alternativeColorsEnabled'],true)
     OR p_color IS NULL OR p_color=v_entry.desired_color
     OR v_entry.declined_alternative_colors ? p_color THEN
    RETURN FALSE;
  END IF;

  -- Suggest only another color of the exact same model and size while genuinely in stock.
  IF NOT EXISTS (
    SELECT 1 FROM inventory_items i
     WHERE i.model_id=v_entry.model_id AND i.size=v_entry.size
       AND i.color=p_color AND i.active AND NOT i.is_archived
       AND NOT i.is_deleted AND lower(i.status)='in stock'
  ) THEN
    RETURN FALSE;
  END IF;

  INSERT INTO waitlist_alternative_suggestions(
    waitlist_entry_id,offered_color,source,actor_id
  ) VALUES(
    v_entry.id,p_color,
    CASE WHEN p_actor_type='staff' THEN 'staff' ELSE 'system' END,
    CASE WHEN p_actor_type='staff' THEN p_actor_id ELSE NULL END
  ) ON CONFLICT(waitlist_entry_id,offered_color) DO NOTHING
  RETURNING id INTO v_suggestion_id;

  IF v_suggestion_id IS NULL THEN RETURN TRUE; END IF;

  SELECT c.client_code,COALESCE(NULLIF(m.name,''),v_entry.model_id)
    INTO v_client_code,v_model_name
    FROM customers c LEFT JOIN catalog_models m ON m.model_id=v_entry.model_id
   WHERE c.user_id=v_entry.customer_user_id;

  IF dart_waiting_bool_setting(ARRAY['waiting','inSiteNotificationEnabled'],true) THEN
    v_notification_id := gen_random_uuid()::text;
    INSERT INTO notification_records(record_id,position,payload)
    VALUES(v_notification_id,0,jsonb_build_object(
      'id',v_notification_id,
      'type','WAITLIST_ALTERNATIVE_SUGGESTED',
      'title','Alternative color available — suggestion only',
      'message','اللون اللي طلبته لسه مش متوفر. فيه لون بديل متاح حاليًا، لكنه مش محجوز لك. لو مناسبك، ضيفه للسلة بنفسك قبل ما ينفد.',
      'timestamp',now(),
      'customerUserId',v_entry.customer_user_id,
      'clientId',v_client_code,
      'relatedEntityType','waiting',
      'relatedEntityId',v_entry.id::text,
      'modelId',v_entry.model_id,
      'modelName',v_model_name,
      'size',v_entry.size,
      'requestedColor',v_entry.desired_color,
      'availableColor',p_color,
      'reserved',false,
      'read',false,
      'resolved',false
    ));
  END IF;

  INSERT INTO audit_logs(
    actor_type,actor_id,action,entity_type,entity_id,request_id,new_values,metadata
  ) VALUES (
    CASE WHEN p_actor_type='staff' THEN 'staff' ELSE 'system' END,
    CASE WHEN p_actor_type='staff' THEN p_actor_id ELSE NULL END,
    'WAITLIST_ALTERNATIVE_SUGGESTED','waitlist',v_entry.id::text,
    p_request_id,
    jsonb_build_object('requestedColor',v_entry.desired_color,
      'suggestedColor',p_color,'reservationCreated',false),
    jsonb_build_object('suggestionId',v_suggestion_id::text,'stockHeld',false)
  );
  UPDATE domain_state_versions
     SET version=version+1,updated_at=now()
   WHERE domain='waiting';
  RETURN TRUE;
END;
$$;

-- Fail closed even if an old caller still tries to create an alternative allocation.
CREATE OR REPLACE FUNCTION dart_block_waitlist_alternative_allocation()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.match_type <> 'exact' THEN
    RAISE EXCEPTION 'WAITLIST_ALTERNATIVE_SUGGESTION_ONLY'
      USING ERRCODE='23514';
  END IF;
  -- An exact allocation must match the physical model, color, size and offered color.
  IF NOT EXISTS (
    SELECT 1
      FROM waitlist_entries w
      JOIN inventory_items i ON i.id=NEW.inventory_item_id
     WHERE w.id=NEW.waitlist_entry_id
       AND w.model_id=i.model_id
       AND w.size=i.size
       AND w.desired_color=i.color
       AND NEW.offered_color=i.color
  ) THEN
    RAISE EXCEPTION 'WAITLIST_VARIANT_MISMATCH'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_exact_allocation_only ON waitlist_allocations;
CREATE TRIGGER waitlist_exact_allocation_only
BEFORE INSERT OR UPDATE OF match_type,waitlist_entry_id,inventory_item_id,offered_color ON waitlist_allocations
FOR EACH ROW EXECUTE FUNCTION dart_block_waitlist_alternative_allocation();

-- Restrict the shared reservation function as well, before any cart write.
CREATE OR REPLACE FUNCTION dart_waitlist_assign_item(
  p_item_id TEXT,
  p_entry_id UUID,
  p_match_type TEXT,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_reason TEXT,
  p_request_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_item inventory_items%ROWTYPE;
  v_entry waitlist_entries%ROWTYPE;
  v_allocation_id UUID;
  v_cart_id TEXT;
  v_expires TIMESTAMPTZ;
  v_hours INTEGER;
  v_customer_name TEXT;
  v_client_code TEXT;
  v_email TEXT;
  v_model_name TEXT;
  v_notification_id TEXT;
  v_email_enabled BOOLEAN;
  v_in_site_enabled BOOLEAN;
  v_alternatives_enabled BOOLEAN;
BEGIN
  -- Waitlist allocations are exclusively for the exact color requested.
  -- A suggested color remains normal in-stock inventory until the customer adds it to cart.
  IF p_match_type <> 'exact' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_item
    FROM inventory_items
   WHERE id=p_item_id
   FOR UPDATE;

  IF NOT FOUND OR lower(v_item.status) <> 'in stock'
     OR NOT v_item.active OR v_item.is_archived OR v_item.is_deleted THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_entry
    FROM waitlist_entries
   WHERE id=p_entry_id
   FOR UPDATE;

  IF NOT FOUND OR v_entry.status <> 'waiting' OR v_entry.eligible_after > now() THEN
    RETURN NULL;
  END IF;

  IF v_entry.model_id <> v_item.model_id OR v_entry.size <> v_item.size THEN
    RETURN NULL;
  END IF;

  v_alternatives_enabled := dart_waiting_bool_setting(
    ARRAY['waiting','alternativeColorsEnabled'],
    true
  );

  IF v_entry.desired_color <> v_item.color THEN
    RETURN NULL;
  END IF;

  IF p_match_type='alternative_color' AND (
    NOT v_alternatives_enabled
    OR NOT v_entry.allow_alternative_color
    OR v_entry.desired_color = v_item.color
    OR (v_entry.declined_alternative_colors ? v_item.color)
  ) THEN
    RETURN NULL;
  END IF;

  v_hours := dart_waiting_reservation_hours();
  v_expires := now() + make_interval(hours => v_hours);
  v_cart_id := 'WAIT-' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO cart_reservations(
    id, customer_user_id, expires_at, pricing_snapshot, source
  ) VALUES (
    v_cart_id, v_entry.customer_user_id, v_expires, '[]'::jsonb, 'waitlist'
  );

  UPDATE inventory_items
     SET status='Cart Reserved',
         cart_reservation_id=v_cart_id,
         reservation_until=v_expires,
         version=version+1,
         updated_at=now()
   WHERE id=v_item.id
     AND lower(status)='in stock';

  IF NOT FOUND THEN
    DELETE FROM cart_reservations WHERE id=v_cart_id;
    RETURN NULL;
  END IF;

  INSERT INTO waitlist_allocations(
    waitlist_entry_id, inventory_item_id, cart_reservation_id,
    match_type, offered_color, status, expires_at
  ) VALUES (
    v_entry.id, v_item.id, v_cart_id,
    p_match_type, v_item.color, 'active', v_expires
  )
  RETURNING id INTO v_allocation_id;

  UPDATE waitlist_entries
     SET status='reserved',
         notified_at=now(),
         reserved_until=v_expires,
         version=version+1,
         updated_at=now()
   WHERE id=v_entry.id;

  SELECT c.full_name, c.client_code, u.email, m.name
    INTO v_customer_name, v_client_code, v_email, v_model_name
    FROM customers c
    JOIN users u ON u.id=c.user_id
    JOIN catalog_models m ON m.model_id=v_entry.model_id
   WHERE c.user_id=v_entry.customer_user_id;

  v_in_site_enabled := dart_waiting_bool_setting(
    ARRAY['waiting','inSiteNotificationEnabled'],
    true
  );
  v_email_enabled := dart_waiting_bool_setting(
    ARRAY['waiting','emailNotificationEnabled'],
    true
  );

  IF v_in_site_enabled THEN
    v_notification_id := gen_random_uuid()::text;
    INSERT INTO notification_records(record_id, position, payload)
    VALUES (
      v_notification_id,
      0,
      jsonb_build_object(
        'id', v_notification_id,
        'type', CASE WHEN p_match_type='exact'
          THEN 'WAITLIST_STOCK_RESERVED'
          ELSE 'WAITLIST_ALTERNATIVE_RESERVED'
        END,
        'title', CASE WHEN p_match_type='exact'
          THEN 'Your item is ready'
          ELSE 'Alternative color available'
        END,
        'message', CASE WHEN p_match_type='exact'
          THEN 'قطعتك متاحة الآن وتم حجزها لك مؤقتًا.'
          ELSE 'اللون المطلوب لسه غير متاح، لكن حجزنا لك لون بديل مؤقتًا.'
        END,
        'timestamp', now(),
        'customerUserId', v_entry.customer_user_id,
        'clientId', v_client_code,
        'relatedEntityType', 'waiting',
        'relatedEntityId', v_entry.id::text,
        'modelId', v_entry.model_id,
        'modelName', v_model_name,
        'size', v_entry.size,
        'requestedColor', v_entry.desired_color,
        'availableColor', v_item.color,
        'expiresAt', v_expires,
        'read', false,
        'resolved', false
      )
    );
  END IF;

  IF v_email_enabled AND COALESCE(v_email,'') <> '' THEN
    INSERT INTO outbox_events(
      aggregate_type, aggregate_id, event_type, payload, deduplication_key
    ) VALUES (
      'waitlist',
      v_entry.id::text,
      CASE WHEN p_match_type='exact'
        THEN 'WAITLIST_STOCK_RESERVED'
        ELSE 'WAITLIST_ALTERNATIVE_RESERVED'
      END,
      jsonb_build_object(
        'channel','email',
        'to',v_email,
        'expiresAt',v_expires,
        'parameters',jsonb_build_object(
          'customerName',v_customer_name,
          'modelId',v_entry.model_id,
          'modelName',v_model_name,
          'size',v_entry.size,
          'requestedColor',v_entry.desired_color,
          'availableColor',v_item.color,
          'reservationHours',v_hours
        )
      ),
      'waitlist.reserved:' || v_allocation_id::text || ':1'
    )
    ON CONFLICT(deduplication_key)
      WHERE deduplication_key IS NOT NULL
      DO NOTHING;
  END IF;

  INSERT INTO audit_logs(
    actor_type, actor_id, action, entity_type, entity_id,
    request_id, new_values, metadata
  ) VALUES (
    CASE WHEN p_actor_type IN ('customer','staff','representative','api_client')
      THEN p_actor_type ELSE 'system' END,
    p_actor_id,
    'WAITLIST_ITEM_RESERVED',
    'waitlist',
    v_entry.id::text,
    p_request_id,
    jsonb_build_object(
      'allocationId',v_allocation_id,
      'itemId',v_item.id,
      'itemCode',v_item.item_code,
      'matchType',p_match_type,
      'offeredColor',v_item.color,
      'expiresAt',v_expires
    ),
    jsonb_build_object(
      'reason',COALESCE(p_reason,''),
      'fifo',p_actor_type='system'
    )
  );

  UPDATE domain_state_versions
     SET version=version+1, updated_at=now()
   WHERE domain='waiting';

  RETURN v_allocation_id;
END;
$$;

-- A new or released physical item can hold only an exact matching Waiting request.
-- If none exists, suggest the color to the next eligible customer without a hold.
CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_item(p_item_id TEXT)
RETURNS UUID LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_item inventory_items%ROWTYPE;
  v_entry_id UUID;
BEGIN
  IF NOT dart_waiting_bool_setting(ARRAY['waiting','enabled'],true) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_item FROM inventory_items WHERE id=p_item_id FOR UPDATE;
  IF NOT FOUND OR lower(v_item.status)<>'in stock'
     OR NOT v_item.active OR v_item.is_archived OR v_item.is_deleted THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_entry_id
    FROM waitlist_entries
   WHERE status='waiting' AND eligible_after<=now()
     AND model_id=v_item.model_id AND size=v_item.size
     AND desired_color=v_item.color
   ORDER BY priority_override DESC,requested_at,id
   FOR UPDATE SKIP LOCKED LIMIT 1;

  IF v_entry_id IS NOT NULL THEN
    RETURN dart_waitlist_assign_item(v_item.id,v_entry_id,'exact',
      'system',NULL,'automatic_stock_match',NULL);
  END IF;

  -- An exact-color request takes precedence, including one locked concurrently.
  IF EXISTS (
    SELECT 1 FROM waitlist_entries
     WHERE status='waiting' AND eligible_after<=now()
       AND model_id=v_item.model_id AND size=v_item.size
       AND desired_color=v_item.color
  ) THEN
    RETURN NULL;
  END IF;

  IF dart_waiting_bool_setting(ARRAY['waiting','alternativeColorsEnabled'],true) THEN
    SELECT w.id INTO v_entry_id
      FROM waitlist_entries w
     WHERE w.status='waiting' AND w.eligible_after<=now()
       AND w.model_id=v_item.model_id AND w.size=v_item.size
       AND w.desired_color<>v_item.color AND w.allow_alternative_color
       AND NOT (w.declined_alternative_colors ? v_item.color)
       AND NOT EXISTS (
         SELECT 1 FROM waitlist_alternative_suggestions s
          WHERE s.waitlist_entry_id=w.id AND s.offered_color=v_item.color
       )
     ORDER BY w.priority_override DESC,w.requested_at,w.id
     FOR UPDATE OF w SKIP LOCKED LIMIT 1;
    IF v_entry_id IS NOT NULL THEN
      PERFORM dart_waitlist_suggest_alternative(v_entry_id,v_item.color);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- When a customer joins while other colors are already available, suggest but never hold.
CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_entry(
  p_entry_id UUID,p_actor_type TEXT,p_actor_id UUID,
  p_reason TEXT,p_request_id TEXT
) RETURNS UUID LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  v_entry waitlist_entries%ROWTYPE;
  v_item_id TEXT;
  v_other_color TEXT;
BEGIN
  IF NOT dart_waiting_bool_setting(ARRAY['waiting','enabled'],true) THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_entry FROM waitlist_entries WHERE id=p_entry_id FOR UPDATE;
  IF NOT FOUND OR v_entry.status<>'waiting' OR v_entry.eligible_after>now() THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_item_id FROM inventory_items
   WHERE model_id=v_entry.model_id AND size=v_entry.size
     AND color=v_entry.desired_color AND active AND NOT is_archived
     AND NOT is_deleted AND lower(status)='in stock'
   ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_item_id IS NOT NULL THEN
    RETURN dart_waitlist_assign_item(v_item_id,v_entry.id,'exact',
      p_actor_type,p_actor_id,p_reason,p_request_id);
  END IF;

  IF v_entry.allow_alternative_color
     AND dart_waiting_bool_setting(ARRAY['waiting','alternativeColorsEnabled'],true)
     AND NOT EXISTS (
       SELECT 1 FROM inventory_items
        WHERE model_id=v_entry.model_id AND size=v_entry.size
          AND color=v_entry.desired_color AND active
          AND NOT is_archived AND NOT is_deleted AND lower(status)='in stock'
     ) THEN
    SELECT color INTO v_other_color FROM inventory_items
     WHERE model_id=v_entry.model_id AND size=v_entry.size
       AND color<>v_entry.desired_color AND active
       AND NOT is_archived AND NOT is_deleted AND lower(status)='in stock'
       AND NOT (v_entry.declined_alternative_colors ? color)
     ORDER BY created_at,id LIMIT 1;
    IF v_other_color IS NOT NULL THEN
      PERFORM dart_waitlist_suggest_alternative(
        v_entry.id,v_other_color,p_actor_type,p_actor_id,p_request_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Keep permissions aligned with the existing restricted server role.
REVOKE ALL ON FUNCTION dart_waitlist_suggest_alternative(uuid,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION dart_block_waitlist_alternative_allocation() FROM PUBLIC;
DO $dart_grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dart_app_runtime') THEN
    GRANT SELECT,INSERT ON waitlist_alternative_suggestions TO dart_app_runtime;
    GRANT EXECUTE ON FUNCTION dart_waitlist_suggest_alternative(uuid,text,text,uuid,text) TO dart_app_runtime;
  END IF;
END;
$dart_grants$;
