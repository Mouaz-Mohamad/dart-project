-- DART CODE GUIDE | backend/migrations/0062_traffic_visitor_numbers.sql
-- الغرض: ترقيم الزوار بأكواد visit-N ثابتة مع الحفاظ على أحداث الزيارات القديمة.
CREATE TABLE traffic_analytics_visitors (
  visitor_id UUID PRIMARY KEY,
  visitor_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Keep older API instances compatible during rollout: every event writer uses
-- this mapping, and the backfill cannot race with an in-flight event insert.
LOCK TABLE traffic_analytics_events IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO traffic_analytics_visitors (visitor_id, created_at)
SELECT visitor_id, min(occurred_at)
FROM traffic_analytics_events
GROUP BY visitor_id
ORDER BY min(occurred_at), visitor_id;

CREATE FUNCTION dart_ensure_traffic_visitor() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  INSERT INTO public.traffic_analytics_visitors (visitor_id)
  SELECT NEW.visitor_id
  WHERE NOT EXISTS (
    SELECT 1 FROM public.traffic_analytics_visitors WHERE visitor_id=NEW.visitor_id
  )
  ON CONFLICT (visitor_id) DO NOTHING;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION dart_ensure_traffic_visitor() FROM PUBLIC;
CREATE TRIGGER traffic_analytics_visitor_identity
BEFORE INSERT ON traffic_analytics_events
FOR EACH ROW EXECUTE FUNCTION dart_ensure_traffic_visitor();

ALTER TABLE traffic_analytics_visitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON traffic_analytics_visitors FROM PUBLIC;
REVOKE ALL ON SEQUENCE traffic_analytics_visitors_visitor_number_seq FROM PUBLIC;

DO $$
DECLARE target_role TEXT;
BEGIN
  FOREACH target_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=target_role) THEN
      EXECUTE format('REVOKE ALL ON traffic_analytics_visitors FROM %I', target_role);
      EXECUTE format('REVOKE ALL ON SEQUENCE traffic_analytics_visitors_visitor_number_seq FROM %I', target_role);
    END IF;
  END LOOP;
END $$;
