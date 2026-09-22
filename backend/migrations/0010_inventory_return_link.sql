-- DART CODE GUIDE | backend/migrations/0010_inventory_return_link.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS return_request_id TEXT;

CREATE INDEX IF NOT EXISTS inventory_items_return_request_idx
  ON inventory_items (return_request_id)
  WHERE return_request_id IS NOT NULL;
