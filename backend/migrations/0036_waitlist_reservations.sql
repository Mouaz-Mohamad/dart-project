-- DART CODE GUIDE | backend/migrations/0030_waitlist_reservations.sql
-- الغرض: Waiting / Restock Reservation خادمي، FIFO افتراضي، وتحكم إداري موثق.

ALTER TABLE cart_reservations
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'cart';

ALTER TABLE cart_reservations
  DROP CONSTRAINT IF EXISTS cart_reservations_source_check;

ALTER TABLE cart_reservations
  ADD CONSTRAINT cart_reservations_source_check
  CHECK (source IN ('cart','waitlist'));

CREATE INDEX IF NOT EXISTS cart_reservations_customer_source_idx
  ON cart_reservations(customer_user_id, source, updated_at DESC)
  WHERE customer_user_id IS NOT NULL;

CREATE SEQUENCE IF NOT EXISTS waitlist_priority_seq START WITH 1;

CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id) ON DELETE RESTRICT,
  model_id TEXT NOT NULL REFERENCES catalog_models(model_id) ON DELETE RESTRICT,
  size TEXT NOT NULL,
  desired_color TEXT NOT NULL,
  allow_alternative_color BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting','reserved','confirmed','converted','expired','cancelled')),
  priority_override BIGINT NOT NULL DEFAULT 0 CHECK (priority_override >= 0),
  declined_alternative_colors JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(declined_alternative_colors)='array'),
  eligible_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ,
  reserved_until TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  converted_order_code TEXT,
  cancelled_at TIMESTAMPTZ,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_customer_variant_active_unique
  ON waitlist_entries(customer_user_id, model_id, size, desired_color)
  WHERE status IN ('waiting','reserved','confirmed');

CREATE INDEX IF NOT EXISTS waitlist_fifo_exact_idx
  ON waitlist_entries(model_id, size, desired_color, priority_override DESC, requested_at, id)
  WHERE status='waiting';

CREATE INDEX IF NOT EXISTS waitlist_customer_idx
  ON waitlist_entries(customer_user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS waitlist_status_idx
  ON waitlist_entries(status, requested_at);

CREATE TABLE IF NOT EXISTS waitlist_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waitlist_entry_id UUID NOT NULL REFERENCES waitlist_entries(id) ON DELETE RESTRICT,
  inventory_item_id TEXT NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  cart_reservation_id TEXT REFERENCES cart_reservations(id) ON DELETE SET NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact','alternative_color')),
  offered_color TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','confirmed','cart','converted','expired','cancelled','declined','released','reassigned')),
  notification_count INTEGER NOT NULL DEFAULT 1 CHECK (notification_count >= 0),
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  converted_order_code TEXT,
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_live_allocation_per_item
  ON waitlist_allocations(inventory_item_id)
  WHERE status='active';

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_one_live_allocation_per_entry
  ON waitlist_allocations(waitlist_entry_id)
  WHERE status='active';

CREATE INDEX IF NOT EXISTS waitlist_allocations_entry_timeline_idx
  ON waitlist_allocations(waitlist_entry_id, allocated_at DESC);

CREATE INDEX IF NOT EXISTS waitlist_allocations_expiry_idx
  ON waitlist_allocations(expires_at)
  WHERE status IN ('active','confirmed');

INSERT INTO domain_state_versions(domain, version)
VALUES ('waiting', 1)
ON CONFLICT(domain) DO NOTHING;

INSERT INTO permissions(key, description) VALUES
  ('waiting.view', 'Read Waiting queue and demand analytics'),
  ('waiting.cancel', 'Cancel a customer Waiting entry'),
  ('waiting.release', 'Release an active Waiting reservation'),
  ('waiting.extend', 'Extend an active Waiting reservation'),
  ('waiting.edit', 'Change the requested Waiting size or color'),
  ('waiting.offer_alternative', 'Offer an alternative color to a Waiting customer'),
  ('waiting.resend', 'Resend a Waiting availability notification'),
  ('waiting.priority_override', 'Override FIFO priority for Waiting entries'),
  ('waiting.reassign', 'Reassign a reserved physical item to another Waiting customer'),
  ('waiting.audit_read', 'Read Waiting audit history')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN (
  'waiting.view','waiting.cancel','waiting.release','waiting.extend','waiting.edit',
  'waiting.offer_alternative','waiting.resend','waiting.priority_override',
  'waiting.reassign','waiting.audit_read'
)
WHERE r.name='Owner'
ON CONFLICT(role_id, permission_id) DO NOTHING;

CREATE OR REPLACE FUNCTION dart_waiting_bool_setting(path TEXT[], fallback BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  value JSONB;
BEGIN
  SELECT data #> path INTO value FROM site_settings WHERE id='main';
  IF value IS NULL OR jsonb_typeof(value) <> 'boolean' THEN
    RETURN fallback;
  END IF;
  RETURN (value #>> '{}')::boolean;
END;
$$;

CREATE OR REPLACE FUNCTION dart_waiting_reservation_hours()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  value JSONB;
  parsed NUMERIC;
BEGIN
  SELECT data #> '{waiting,reservationHours}' INTO value
    FROM site_settings WHERE id='main';
  IF value IS NULL OR jsonb_typeof(value) <> 'number' THEN
    RETURN 4;
  END IF;
  parsed := (value #>> '{}')::numeric;
  RETURN LEAST(72, GREATEST(1, FLOOR(parsed)::integer));
EXCEPTION WHEN OTHERS THEN
  RETURN 4;
END;
$$;

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
  IF p_match_type NOT IN ('exact','alternative_color') THEN
    RAISE EXCEPTION 'invalid waitlist match type';
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

  IF p_match_type='exact' AND v_entry.desired_color <> v_item.color THEN
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

CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_item(p_item_id TEXT)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item inventory_items%ROWTYPE;
  v_entry_id UUID;
  v_match_type TEXT;
  v_enabled BOOLEAN;
  v_alternatives_enabled BOOLEAN;
BEGIN
  v_enabled := dart_waiting_bool_setting(ARRAY['waiting','enabled'], true);
  IF NOT v_enabled THEN
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

  SELECT id INTO v_entry_id
    FROM waitlist_entries
   WHERE status='waiting'
     AND eligible_after <= now()
     AND model_id=v_item.model_id
     AND size=v_item.size
     AND desired_color=v_item.color
   ORDER BY priority_override DESC, requested_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_entry_id IS NOT NULL THEN
    v_match_type := 'exact';
  ELSE
    v_alternatives_enabled := dart_waiting_bool_setting(
      ARRAY['waiting','alternativeColorsEnabled'],
      true
    );

    IF v_alternatives_enabled THEN
      SELECT id INTO v_entry_id
        FROM waitlist_entries
       WHERE status='waiting'
         AND eligible_after <= now()
         AND model_id=v_item.model_id
         AND size=v_item.size
         AND desired_color<>v_item.color
         AND allow_alternative_color
         AND NOT (declined_alternative_colors ? v_item.color)
       ORDER BY priority_override DESC, requested_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1;

      IF v_entry_id IS NOT NULL THEN
        v_match_type := 'alternative_color';
      END IF;
    END IF;
  END IF;

  IF v_entry_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN dart_waitlist_assign_item(
    v_item.id,
    v_entry_id,
    v_match_type,
    'system',
    NULL,
    'automatic_stock_match',
    NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION dart_waitlist_try_allocate_entry(
  p_entry_id UUID,
  p_actor_type TEXT,
  p_actor_id UUID,
  p_reason TEXT,
  p_request_id TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry waitlist_entries%ROWTYPE;
  v_item_id TEXT;
  v_match_type TEXT;
  v_enabled BOOLEAN;
  v_alternatives_enabled BOOLEAN;
BEGIN
  v_enabled := dart_waiting_bool_setting(ARRAY['waiting','enabled'], true);
  IF NOT v_enabled THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_entry
    FROM waitlist_entries
   WHERE id=p_entry_id
   FOR UPDATE;

  IF NOT FOUND OR v_entry.status <> 'waiting' OR v_entry.eligible_after > now() THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_item_id
    FROM inventory_items
   WHERE model_id=v_entry.model_id
     AND size=v_entry.size
     AND color=v_entry.desired_color
     AND active
     AND NOT is_archived
     AND NOT is_deleted
     AND lower(status)='in stock'
   ORDER BY created_at, id
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF v_item_id IS NOT NULL THEN
    v_match_type := 'exact';
  ELSE
    v_alternatives_enabled := dart_waiting_bool_setting(
      ARRAY['waiting','alternativeColorsEnabled'],
      true
    );

    IF v_alternatives_enabled AND v_entry.allow_alternative_color THEN
      SELECT id INTO v_item_id
        FROM inventory_items
       WHERE model_id=v_entry.model_id
         AND size=v_entry.size
         AND color<>v_entry.desired_color
         AND active
         AND NOT is_archived
         AND NOT is_deleted
         AND lower(status)='in stock'
         AND NOT (v_entry.declined_alternative_colors ? color)
       ORDER BY created_at, id
       FOR UPDATE SKIP LOCKED
       LIMIT 1;

      IF v_item_id IS NOT NULL THEN
        v_match_type := 'alternative_color';
      END IF;
    END IF;
  END IF;

  IF v_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN dart_waitlist_assign_item(
    v_item_id,
    v_entry.id,
    v_match_type,
    p_actor_type,
    p_actor_id,
    p_reason,
    p_request_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION dart_waitlist_inventory_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_entry_id UUID;
  v_allocation_id UUID;
BEGIN
  IF TG_OP='UPDATE'
     AND lower(OLD.status)='cart reserved'
     AND lower(NEW.status)='processing/held' THEN
    UPDATE waitlist_allocations
       SET status='converted',
           converted_at=now(),
           converted_order_code=NEW.order_id,
           updated_at=now(),
           version=version+1
     WHERE inventory_item_id=NEW.id
       AND status IN ('active','confirmed','cart')
     RETURNING waitlist_entry_id, id
       INTO v_entry_id, v_allocation_id;

    IF v_entry_id IS NOT NULL THEN
      UPDATE waitlist_entries
         SET status='converted',
             converted_at=now(),
             converted_order_code=NEW.order_id,
             reserved_until=NULL,
             version=version+1,
             updated_at=now()
       WHERE id=v_entry_id;

      INSERT INTO audit_logs(
        actor_type, action, entity_type, entity_id, new_values, metadata
      ) VALUES (
        'system',
        'WAITLIST_CONVERTED_TO_ORDER',
        'waitlist',
        v_entry_id::text,
        jsonb_build_object(
          'allocationId',v_allocation_id,
          'itemId',NEW.id,
          'orderCode',NEW.order_id
        ),
        jsonb_build_object('source','checkout')
      );

      UPDATE domain_state_versions
         SET version=version+1, updated_at=now()
       WHERE domain='waiting';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE'
     AND lower(OLD.status)='cart reserved'
     AND lower(NEW.status)='in stock'
     AND current_setting('dart.skip_waitlist_allocation', true)='1' THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE'
     AND lower(OLD.status)='cart reserved'
     AND lower(NEW.status)='in stock' THEN
    UPDATE waitlist_allocations
       SET status='expired',
           released_at=now(),
           release_reason=COALESCE(release_reason,'reservation_expired'),
           updated_at=now(),
           version=version+1
     WHERE inventory_item_id=NEW.id
       AND status='active'
     RETURNING waitlist_entry_id, id
       INTO v_entry_id, v_allocation_id;

    IF v_entry_id IS NOT NULL THEN
      UPDATE waitlist_entries
         SET status='expired',
             reserved_until=NULL,
             version=version+1,
             updated_at=now()
       WHERE id=v_entry_id
         AND status='reserved';

      INSERT INTO audit_logs(
        actor_type, action, entity_type, entity_id, new_values, metadata
      ) VALUES (
        'system',
        'WAITLIST_RESERVATION_EXPIRED',
        'waitlist',
        v_entry_id::text,
        jsonb_build_object(
          'allocationId',v_allocation_id,
          'itemId',NEW.id
        ),
        jsonb_build_object('source','inventory_release')
      );

      UPDATE domain_state_versions
         SET version=version+1, updated_at=now()
       WHERE domain='waiting';
    END IF;

    UPDATE waitlist_allocations
       SET status='expired',
           released_at=now(),
           release_reason=COALESCE(release_reason,'confirmed_cart_released'),
           updated_at=now(),
           version=version+1
     WHERE inventory_item_id=NEW.id
       AND status IN ('confirmed','cart');
  END IF;

  IF lower(NEW.status)='in stock'
     AND current_setting('dart.skip_waitlist_allocation', true) IS DISTINCT FROM '1'
     AND NEW.active
     AND NOT NEW.is_archived
     AND NOT NEW.is_deleted
     AND (
       TG_OP='INSERT'
       OR lower(COALESCE(OLD.status,'')) <> 'in stock'
       OR OLD.model_id IS DISTINCT FROM NEW.model_id
       OR OLD.color IS DISTINCT FROM NEW.color
       OR OLD.size IS DISTINCT FROM NEW.size
     ) THEN
    PERFORM dart_waitlist_try_allocate_item(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_waitlist_transition ON inventory_items;

CREATE TRIGGER inventory_waitlist_transition
AFTER INSERT OR UPDATE OF status, model_id, color, size, active, is_archived, is_deleted
ON inventory_items
FOR EACH ROW
EXECUTE FUNCTION dart_waitlist_inventory_transition();
