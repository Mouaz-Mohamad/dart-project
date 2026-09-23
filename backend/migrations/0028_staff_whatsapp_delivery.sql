-- DART CODE GUIDE | backend/migrations/0022_staff_whatsapp_delivery.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
ALTER TABLE staff_invitations
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE staff_invitations
  ADD COLUMN IF NOT EXISTS phone_normalized TEXT;

UPDATE staff_invitations invitation
SET
  phone = COALESCE(
    invitation.phone,
    (
      SELECT event.payload->>'to'
      FROM outbox_events event
      WHERE event.aggregate_type='staff_invitation'
        AND event.aggregate_id=invitation.id::text
        AND event.event_type='STAFF_INVITED'
        AND event.payload->>'channel'='whatsapp'
      ORDER BY event.created_at DESC
      LIMIT 1
    )
  ),
  phone_normalized = COALESCE(
    invitation.phone_normalized,
    (
      SELECT regexp_replace(event.payload->>'to', '[^0-9]', '', 'g')
      FROM outbox_events event
      WHERE event.aggregate_type='staff_invitation'
        AND event.aggregate_id=invitation.id::text
        AND event.event_type='STAFF_INVITED'
        AND event.payload->>'channel'='whatsapp'
      ORDER BY event.created_at DESC
      LIMIT 1
    )
  )
WHERE invitation.phone_normalized IS NULL;

ALTER TABLE staff_invitations
  DROP CONSTRAINT IF EXISTS staff_invitations_phone_normalized_format;

ALTER TABLE staff_invitations
  ADD CONSTRAINT staff_invitations_phone_normalized_format CHECK (
    phone_normalized IS NULL
    OR phone_normalized ~ '^20(10|11|12|15)[0-9]{8}$'
  );

CREATE INDEX IF NOT EXISTS staff_invitations_phone_normalized_idx
  ON staff_invitations (phone_normalized)
  WHERE phone_normalized IS NOT NULL;
