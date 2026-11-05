-- Commit-time version invalidations only: no customers, tokens or order payloads.
SET LOCAL lock_timeout = '3s';
CREATE FUNCTION dart_publish_change_signal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.version IS NOT DISTINCT FROM OLD.version THEN RETURN NEW; END IF;
  PERFORM pg_notify('dart_changes_' || md5(TG_TABLE_SCHEMA), json_build_object(
    'scope', CASE WHEN TG_TABLE_NAME = 'domain_state_versions' THEN 'version' ELSE 'domain' END,
    'name', NEW.domain, 'version', NEW.version)::text);
  RETURN NEW;
END $$;
CREATE TRIGGER dart_version_change_signal AFTER INSERT OR UPDATE OF version ON domain_state_versions
  FOR EACH ROW EXECUTE FUNCTION dart_publish_change_signal();
CREATE TRIGGER dart_domain_change_signal AFTER INSERT OR UPDATE OF version ON dashboard_domain_state
  FOR EACH ROW EXECUTE FUNCTION dart_publish_change_signal();
