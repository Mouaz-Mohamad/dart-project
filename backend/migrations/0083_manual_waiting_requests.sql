-- Create manual FIFO Waiting entries without sending a message on enrollment.
ALTER TABLE waitlist_entries
  ADD COLUMN source TEXT NOT NULL DEFAULT 'website' CHECK (source IN ('website','manual')),
  ADD COLUMN manual_notes TEXT NOT NULL DEFAULT '' CHECK (length(manual_notes)<=500),
  ADD COLUMN created_by_staff UUID REFERENCES staff_users(user_id);
ALTER TABLE waitlist_entries ADD CONSTRAINT waitlist_manual_source_consistency
  CHECK (source='website' OR created_by_staff IS NOT NULL);
CREATE INDEX waitlist_manual_staff_idx ON waitlist_entries(created_by_staff,requested_at DESC)
  WHERE source='manual';
INSERT INTO permissions(key,description)
VALUES('waiting.create','Create manual Waiting reservation with verified WhatsApp request')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.key='waiting.create'
WHERE r.name='Owner'
ON CONFLICT(role_id,permission_id) DO NOTHING;
