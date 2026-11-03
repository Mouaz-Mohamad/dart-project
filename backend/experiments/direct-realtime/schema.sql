-- Fixture only: NOT a production migration. Keep the durable version journal.
DO $$ BEGIN
  IF current_setting('dart.realtime_pilot_fixture', true) IS DISTINCT FROM 'enabled'
    OR current_schema() = 'public' THEN
    RAISE EXCEPTION 'Direct realtime pilot requires an isolated schema';
  END IF;
END $$;
CREATE OR REPLACE FUNCTION realtime_pilot_capture_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE event_id uuid;
BEGIN
  INSERT INTO realtime_pilot_events(version) VALUES(NEW.version)
    ON CONFLICT(version) DO NOTHING RETURNING id INTO event_id;
  IF event_id IS NOT NULL THEN
    PERFORM pg_notify('dart_pilot_orders_' || md5(TG_TABLE_SCHEMA),
      json_build_object('id',event_id,'version',NEW.version)::text);
  END IF;
  RETURN NEW;
END $$;
