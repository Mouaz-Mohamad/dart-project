-- Isolated experiment only. Not a production migration and never auto-applied.
DO $$ BEGIN
  IF current_setting('dart.realtime_pilot_fixture', true) IS DISTINCT FROM 'enabled' THEN
    RAISE EXCEPTION 'Realtime pilot requires an explicitly isolated fixture';
  END IF;
END $$;
CREATE TABLE realtime_pilot_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version BIGINT NOT NULL UNIQUE CHECK(version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','publishing','published','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_id UUID,
  lease_until TIMESTAMPTZ,
  published_at TIMESTAMPTZ
);
CREATE INDEX realtime_pilot_pending ON realtime_pilot_events(available_at, version) WHERE state <> 'published';
ALTER TABLE realtime_pilot_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON realtime_pilot_events FROM PUBLIC;
CREATE FUNCTION realtime_pilot_capture_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO realtime_pilot_events(version) VALUES(NEW.version) ON CONFLICT(version) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER realtime_pilot_order_version
AFTER UPDATE OF version ON domain_state_versions
FOR EACH ROW WHEN(NEW.domain='orders' AND NEW.version > OLD.version)
EXECUTE FUNCTION realtime_pilot_capture_version();
