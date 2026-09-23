-- DART CODE GUIDE | backend/migrations/0035_reward_history_reference_compatibility.sql
-- الغرض: الاحتفاظ بمراجع Promotion/Card التاريخية كمعرّفات immutable بدون كسر bulk compatibility القديمة التي تعيد بناء projection tables.

ALTER TABLE promotion_usages
  DROP CONSTRAINT IF EXISTS promotion_usages_promotion_record_id_fkey;

ALTER TABLE dart_card_draws
  DROP CONSTRAINT IF EXISTS dart_card_draws_card_record_id_fkey;

COMMENT ON COLUMN promotion_usages.promotion_record_id IS
  'Immutable promotion identifier snapshot. Deliberately not an FK because the legacy dashboard compatibility writer may rebuild promotion_records.';

COMMENT ON COLUMN dart_card_draws.card_record_id IS
  'Immutable awarded-card identifier snapshot. Deliberately not an FK because the legacy dashboard compatibility writer may rebuild loyalty_cards.';
