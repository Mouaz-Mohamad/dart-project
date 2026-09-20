ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS cost_snapshot_minor BIGINT;

UPDATE inventory_items i
   SET cost_snapshot_minor = m.cost_minor
  FROM catalog_models m
 WHERE m.model_id = i.model_id
   AND i.cost_snapshot_minor IS NULL;

ALTER TABLE inventory_items
  ALTER COLUMN cost_snapshot_minor SET NOT NULL;

ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_cost_snapshot_nonnegative
  CHECK (cost_snapshot_minor >= 0)
  NOT VALID;

ALTER TABLE inventory_items
  VALIDATE CONSTRAINT inventory_items_cost_snapshot_nonnegative;
