ALTER TABLE target.customers
  ADD CONSTRAINT customers_status_chk CHECK (status IN ('active','inactive','closed')),
  ADD CONSTRAINT customers_ltv_chk CHECK (lifetime_value_cents >= 0),
  ADD CONSTRAINT customers_origin_chk CHECK (_origin IN ('preexisting','migrated'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON app.audit_events
  FOR EACH ROW EXECUTE FUNCTION app.audit_events_immutable();
--> statement-breakpoint
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON app.audit_events
  FOR EACH ROW WHEN (pg_trigger_depth() = 0 AND current_setting('app.allow_audit_delete', true) IS DISTINCT FROM 'on')
  EXECUTE FUNCTION app.audit_events_immutable();
