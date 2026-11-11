-- DART CODE GUIDE | backend/migrations/0085_unified_customer_records.sql
-- الغرض: هوية موحدة للعملاء مع فصل أرقام التواصل وحفظ مصادر البيانات وروابط السجلات القديمة.
CREATE TABLE customer_profile_details (
  customer_user_id UUID PRIMARY KEY REFERENCES customers(user_id),
  name_source TEXT NOT NULL DEFAULT 'admin',
  birthday_source TEXT NOT NULL DEFAULT 'admin',
  country TEXT NOT NULL DEFAULT 'Egypt',
  governorate TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Existing relational accounts were created through customer registration.
INSERT INTO customer_profile_details(customer_user_id,name_source,birthday_source)
SELECT user_id,'website','website' FROM customers;

CREATE TABLE customer_contact_phones (
  customer_user_id UUID NOT NULL REFERENCES customers(user_id),
  phone_normalized TEXT NOT NULL CHECK (phone_normalized ~ '^20(10|11|12|15)[0-9]{8}$'),
  phone_display TEXT NOT NULL,
  source TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_user_id,phone_normalized)
);
CREATE TABLE customer_identity_aliases (
  alias TEXT PRIMARY KEY CHECK (length(btrim(alias)) > 0),
  customer_user_id UUID NOT NULL REFERENCES customers(user_id),
  original_record JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customer_identity_aliases_customer_idx ON customer_identity_aliases(customer_user_id);
CREATE TABLE customer_address_history (
  customer_user_id UUID NOT NULL REFERENCES customers(user_id),
  source_key TEXT NOT NULL,
  address JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(customer_user_id,source_key)
);
CREATE TABLE customer_identity_conflicts (
  record_key TEXT PRIMARY KEY,
  original_record JSONB NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
ALTER TABLE customer_profile_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_contact_phones ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_address_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_identity_conflicts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_profile_details,customer_contact_phones,customer_identity_aliases,
  customer_address_history,customer_identity_conflicts FROM PUBLIC;

CREATE FUNCTION dart_customer_phone(value TEXT) RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE digits TEXT := regexp_replace(translate(COALESCE(value,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
BEGIN
  IF digits ~ '^00201(0|1|2|5)[0-9]{8}$' THEN digits := substring(digits FROM 3); END IF;
  IF digits ~ '^01(0|1|2|5)[0-9]{8}$' THEN digits := '20' || substring(digits FROM 2); END IF;
  RETURN CASE WHEN digits ~ '^201(0|1|2|5)[0-9]{8}$' THEN digits ELSE NULL END;
END $$;

INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source,recorded_at)
SELECT user_id,phone_normalized,phone_display,'profile',created_at FROM account_phones
WHERE account_type='customer' AND NOT is_primary;
-- Retire authentication sessions for accounts which previously exposed a contact
-- number as a login identity. Primary-only accounts keep their current sessions.
UPDATE sessions SET revoked_at=COALESCE(revoked_at,now()),revoke_reason=COALESCE(revoke_reason,'contact_phone_login_retired')
WHERE user_id IN (SELECT user_id FROM account_phones WHERE account_type='customer' AND NOT is_primary) AND revoked_at IS NULL;
UPDATE users SET session_version=session_version+1,version=version+1
WHERE id IN (SELECT user_id FROM account_phones WHERE account_type='customer' AND NOT is_primary);
DELETE FROM account_phones WHERE account_type='customer' AND NOT is_primary;

-- One command serves website signup/profile and dashboard creation. Its callers
-- validate permissions; the database serializes identity decisions and also has
-- unique email/primary-phone constraints as a final concurrency guard.
CREATE FUNCTION dart_upsert_customer_record(payload JSONB, origin TEXT, target_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  phone TEXT := dart_customer_phone(payload->>'phone1');
  second_phone TEXT := dart_customer_phone(payload->>'phone2');
  login_display TEXT := btrim(payload->>'phone1');
  mail TEXT := NULLIF(lower(btrim(payload->>'email')),'');
  email_display TEXT := NULLIF(btrim(payload->>'email'),'');
  customer_id UUID;
  matches UUID[];
  profile customer_profile_details%ROWTYPE;
  customer_code TEXT;
  old_record JSONB;
  new_record JSONB;
  ref TEXT;
  previous_id UUID;
  account_status TEXT;
BEGIN
  IF origin NOT IN ('website','admin','profile') THEN RAISE EXCEPTION 'CUSTOMER_ORIGIN_INVALID'; END IF;
  IF phone IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PHONE_INVALID'; END IF;
  IF length(btrim(COALESCE(payload->>'name',''))) NOT BETWEEN 3 AND 120 THEN RAISE EXCEPTION 'CUSTOMER_NAME_INVALID'; END IF;
  IF mail IS NOT NULL AND (length(mail)>254 OR mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN RAISE EXCEPTION 'CUSTOMER_EMAIL_INVALID'; END IF;
  IF COALESCE(payload->>'phone2','') NOT IN ('','-') AND second_phone IS NULL THEN RAISE EXCEPTION 'CUSTOMER_PHONE_INVALID'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('dart_unified_customer_identity'));
  SELECT array_agg(DISTINCT u.id) INTO matches FROM users u
  WHERE u.account_type='customer' AND u.deleted_at IS NULL AND (
    u.id=target_id OR (mail IS NOT NULL AND u.email_normalized=mail) OR EXISTS (
      SELECT 1 FROM account_phones p WHERE p.user_id=u.id AND p.is_primary AND p.phone_normalized=phone));
  IF cardinality(matches)>1 THEN RAISE EXCEPTION 'CUSTOMER_IDENTITY_CONFLICT'; END IF;
  customer_id := matches[1];
  IF target_id IS NOT NULL AND customer_id IS DISTINCT FROM target_id THEN
    IF origin='profile' THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_UNAVAILABLE'; END IF;
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND';
  END IF;
  IF customer_id IS NOT NULL THEN
    SELECT status INTO account_status FROM users WHERE id=customer_id FOR UPDATE;
    IF account_status NOT IN ('active','pending_verification') AND NOT (origin='admin' AND target_id IS NOT NULL AND account_status='suspended') THEN RAISE EXCEPTION 'CUSTOMER_ACCOUNT_UNAVAILABLE'; END IF;
    SELECT jsonb_build_object('name',c.full_name,'birthday',c.birthday,'email',u.email)
      INTO old_record FROM customers c JOIN users u ON u.id=c.user_id WHERE c.user_id=customer_id;
    SELECT * INTO profile FROM customer_profile_details WHERE customer_user_id=customer_id;
    IF origin='admin' AND target_id IS NULL THEN
      INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source)
        VALUES(customer_id,phone,login_display,'admin') ON CONFLICT(customer_user_id,phone_normalized) DO NOTHING;
      SELECT p.phone_normalized,p.phone_display INTO phone,login_display FROM account_phones p
        WHERE p.user_id=customer_id AND p.is_primary;
    END IF;
    UPDATE users SET email=CASE WHEN payload ? 'email' AND (mail IS NOT NULL OR origin='profile') AND (origin<>'admin' OR target_id IS NOT NULL OR email_normalized IS NULL) THEN email_display ELSE email END,
      email_normalized=CASE WHEN payload ? 'email' AND (mail IS NOT NULL OR origin='profile') AND (origin<>'admin' OR target_id IS NOT NULL OR email_normalized IS NULL) THEN mail ELSE email_normalized END,
      email_verified_at=CASE WHEN payload ? 'email' AND (mail IS NOT NULL OR origin='profile') AND (origin<>'admin' OR target_id IS NOT NULL OR email_normalized IS NULL) AND email_normalized IS DISTINCT FROM mail THEN NULL ELSE email_verified_at END,
      version=version+1,updated_at=now() WHERE id=customer_id;
    -- Preserve replaced login numbers as contact history, never as login aliases.
    INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source)
      SELECT customer_id,phone_normalized,phone_display,'previous_primary' FROM account_phones
      WHERE user_id=customer_id AND phone_normalized<>phone
      ON CONFLICT(customer_user_id,phone_normalized) DO NOTHING;
    DELETE FROM account_phones WHERE user_id=customer_id AND account_type='customer' AND phone_normalized<>phone;
    UPDATE customers SET
      full_name=CASE WHEN origin IN ('website','profile') OR COALESCE(profile.name_source,'admin')<>'website' THEN btrim(payload->>'name') ELSE full_name END,
      birthday=CASE WHEN NULLIF(payload->>'birthday','') IS NOT NULL AND
        (origin IN ('website','profile') OR COALESCE(profile.birthday_source,'admin')<>'website')
        THEN (payload->>'birthday')::date ELSE birthday END,
      updated_at=now() WHERE user_id=customer_id;
  ELSE
    customer_id := gen_random_uuid();
    INSERT INTO users(id,account_type,email,email_normalized,password_hash,status)
      VALUES(customer_id,'customer',email_display,mail,NULL,'active');
    INSERT INTO customers(user_id,full_name,birthday)
      VALUES(customer_id,btrim(payload->>'name'),NULLIF(payload->>'birthday','')::date);
    INSERT INTO user_roles(user_id,role_id) SELECT customer_id,id FROM roles WHERE name='Customer';
  END IF;
  INSERT INTO account_phones(user_id,account_type,phone_normalized,phone_display,is_primary)
    VALUES(customer_id,'customer',phone,login_display,true)
    ON CONFLICT(user_id,phone_normalized) DO UPDATE SET is_primary=true,phone_display=EXCLUDED.phone_display;
  IF second_phone IS NOT NULL AND second_phone<>phone THEN
    INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source)
      VALUES(customer_id,second_phone,btrim(payload->>'phone2'),origin)
      ON CONFLICT(customer_user_id,phone_normalized) DO UPDATE SET phone_display=EXCLUDED.phone_display,source=EXCLUDED.source,recorded_at=now();
  END IF;
  INSERT INTO customer_profile_details(customer_user_id,name_source,birthday_source,country,governorate)
    VALUES(customer_id,CASE WHEN origin IN ('website','profile') THEN 'website' ELSE 'admin' END,
      CASE WHEN origin IN ('website','profile') AND NULLIF(payload->>'birthday','') IS NOT NULL THEN 'website' ELSE 'admin' END,
      COALESCE(NULLIF(payload->>'country',''),'Egypt'),COALESCE(payload->>'governorate',''))
    ON CONFLICT(customer_user_id) DO UPDATE SET
      name_source=CASE WHEN origin IN ('website','profile') THEN 'website' ELSE customer_profile_details.name_source END,
      birthday_source=CASE WHEN origin IN ('website','profile') AND NULLIF(payload->>'birthday','') IS NOT NULL THEN 'website' ELSE customer_profile_details.birthday_source END,
      country=COALESCE(NULLIF(payload->>'country',''),customer_profile_details.country),
      governorate=COALESCE(NULLIF(payload->>'governorate',''),customer_profile_details.governorate),updated_at=now();
  SELECT client_code INTO customer_code FROM customers WHERE user_id=customer_id;
  FOREACH ref IN ARRAY ARRAY[payload->>'legacyCode',payload->>'legacyId'] LOOP
    IF ref IS NULL OR ref='' OR ref=customer_code OR ref=customer_id::text THEN CONTINUE; END IF;
    SELECT a.customer_user_id INTO previous_id FROM customer_identity_aliases a WHERE a.alias=ref;
    IF previous_id IS NOT NULL AND previous_id<>customer_id THEN RAISE EXCEPTION 'CUSTOMER_IDENTITY_CONFLICT'; END IF;
    INSERT INTO customer_identity_aliases(alias,customer_user_id,original_record)
      VALUES(ref,customer_id,COALESCE(payload->'originalRecord',payload)) ON CONFLICT(alias) DO NOTHING;
    UPDATE orders SET customer_user_id=customer_id,
      legacy=COALESCE(legacy,'{}') || jsonb_build_object('clientId',customer_code,'previousClientId',ref),
      updated_at=now(),version=version+1
      WHERE customer_user_id IS NULL AND legacy->>'clientId'=ref;
  END LOOP;
  SELECT jsonb_build_object('name',c.full_name,'birthday',c.birthday,'email',u.email)
    INTO new_record FROM customers c JOIN users u ON u.id=c.user_id WHERE c.user_id=customer_id;
  INSERT INTO audit_logs(actor_type,action,entity_type,entity_id,old_values,new_values,metadata)
    VALUES('system','CUSTOMER_RECORD_UNIFIED','customers',customer_id::text,old_record,new_record,
      jsonb_build_object('origin',origin,'legacyCode',payload->>'legacyCode'));
  RETURN customer_id;
END $$;

CREATE FUNCTION dart_capture_customer_order_details() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE value TEXT; normalized TEXT;
BEGIN
  IF NEW.customer_user_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.delivery_address,'{}')<>'{}'::jsonb THEN
    INSERT INTO customer_address_history(customer_user_id,source_key,address,recorded_at)
      VALUES(NEW.customer_user_id,'order:' || NEW.id::text,NEW.delivery_address,NEW.created_at)
      ON CONFLICT(customer_user_id,source_key) DO UPDATE SET address=EXCLUDED.address;
  END IF;
  FOREACH value IN ARRAY ARRAY[NEW.contact_snapshot->>'phone1',NEW.contact_snapshot->>'phone2'] LOOP
    normalized := dart_customer_phone(value);
    IF normalized IS NOT NULL THEN
      INSERT INTO customer_contact_phones(customer_user_id,phone_normalized,phone_display,source,recorded_at)
        VALUES(NEW.customer_user_id,normalized,value,'order',NEW.created_at)
        ON CONFLICT(customer_user_id,phone_normalized) DO UPDATE SET
          recorded_at=GREATEST(customer_contact_phones.recorded_at,EXCLUDED.recorded_at);
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER orders_customer_details AFTER INSERT OR UPDATE OF customer_user_id,contact_snapshot,delivery_address
ON orders FOR EACH ROW EXECUTE FUNCTION dart_capture_customer_order_details();

-- Canonicalize old and future array-adapter references before relational-domain
-- triggers see them. Names and recipient phone numbers are historical snapshots.
CREATE FUNCTION dart_unify_dashboard_customers() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE row JSONB; next_data JSONB := '[]'; customer_id UUID; code TEXT; key TEXT; replacement TEXT;
BEGIN
  FOR row IN SELECT value FROM jsonb_array_elements(NEW.data) LOOP
    IF NEW.domain='customers' THEN
      customer_id := NULL;
      SELECT c.user_id INTO customer_id FROM customers c
        WHERE c.user_id::text=row->>'id' OR c.client_code=row->>'clientId';
      IF customer_id IS NULL THEN
        SELECT a.customer_user_id INTO customer_id FROM customer_identity_aliases a
          WHERE a.alias IN (row->>'id',row->>'clientId') LIMIT 1;
      END IF;
      IF customer_id IS NULL AND COALESCE(row->>'isDeleted','false')<>'true' THEN
        BEGIN
          customer_id := dart_upsert_customer_record(jsonb_build_object(
            'name',row->>'clientName','phone1',row->>'phone1','phone2',NULLIF(row->>'phone2','-'),
            'email',NULLIF(row->>'email','-'),'birthday',NULLIF(row->>'birthday','-'),
            'country',row->>'country','governorate',row->>'governorate',
            'legacyCode',row->>'clientId','legacyId',row->>'id','originalRecord',row),'admin');
          UPDATE customer_identity_conflicts SET resolved_at=now() WHERE record_key=COALESCE(NULLIF(row->>'id',''),NULLIF(row->>'clientId',''),'unidentified:' || md5(row::text));
        EXCEPTION WHEN raise_exception OR invalid_datetime_format OR datetime_field_overflow OR unique_violation THEN
          IF current_setting('dart.customer_backfill',true) IS DISTINCT FROM 'on' THEN RAISE; END IF;
          INSERT INTO customer_identity_conflicts(record_key,original_record,reason)
            VALUES(COALESCE(NULLIF(row->>'id',''),NULLIF(row->>'clientId',''),'unidentified:' || md5(row::text)),row,SQLERRM)
            ON CONFLICT(record_key) DO UPDATE SET reason=EXCLUDED.reason;
          row := row || jsonb_build_object('identityConflict',true);
        END;
      END IF;
      IF customer_id IS NOT NULL THEN
        SELECT client_code INTO code FROM customers WHERE user_id=customer_id;
        row := (row - 'identityConflict') || jsonb_build_object('id',customer_id,'clientId',code,'serverAuthoritative',true);
        UPDATE customer_identity_conflicts SET resolved_at=now() WHERE record_key IN (row->>'id',row->>'clientId');
      END IF;
    ELSE
      FOREACH key IN ARRAY ARRAY['clientId','customerId','customerCode','clientCode'] LOOP
        SELECT c.client_code INTO replacement FROM customer_identity_aliases a JOIN customers c ON c.user_id=a.customer_user_id
          WHERE a.alias=row->>key;
        IF replacement IS NOT NULL THEN row := jsonb_set(row,ARRAY[key],to_jsonb(replacement)); END IF;
      END LOOP;
    END IF;
    next_data := next_data || jsonb_build_array(row);
  END LOOP;
  NEW.data := next_data;
  RETURN NEW;
END $$;
CREATE TRIGGER dashboard_customer_identity BEFORE INSERT OR UPDATE OF data ON dashboard_domain_state
FOR EACH ROW EXECUTE FUNCTION dart_unify_dashboard_customers();

-- Backfill is transactional, preserves ambiguous records for review, and saves
-- every original legacy record in its alias. Never merge two existing accounts.
SELECT set_config('dart.customer_backfill','on',true);
UPDATE dashboard_domain_state SET data=data,version=version+1 WHERE domain='customers';
SELECT set_config('dart.customer_backfill','off',true);
UPDATE dashboard_domain_state SET data=data,version=version+1 WHERE domain<>'customers';
UPDATE orders SET contact_snapshot=contact_snapshot WHERE customer_user_id IS NOT NULL;
INSERT INTO customer_address_history(customer_user_id,source_key,address,recorded_at)
  SELECT customer_user_id,'saved:' || md5(last_address::text),last_address,updated_at
  FROM customer_preferences WHERE last_address IS NOT NULL;

REVOKE ALL ON FUNCTION dart_customer_phone(TEXT),dart_upsert_customer_record(JSONB,TEXT,UUID),
  dart_capture_customer_order_details(),dart_unify_dashboard_customers() FROM PUBLIC;
