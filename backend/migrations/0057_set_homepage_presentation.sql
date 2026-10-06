-- DART CODE GUIDE | backend/migrations/0057_set_homepage_presentation.sql
-- الغرض: حفظ وصف كارت الطقم واختيار ظهوره وترتيبه في الرئيسية دون تغيير المخزون أو التسعير.
ALTER TABLE catalog_sets
  ADD COLUMN short_description TEXT NOT NULL DEFAULT '' CHECK (length(short_description) <= 280),
  ADD COLUMN show_on_homepage BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN homepage_order INTEGER NOT NULL DEFAULT 0 CHECK (homepage_order BETWEEN 0 AND 9999),
  ADD CONSTRAINT catalog_sets_homepage_image_required
    CHECK (NOT show_on_homepage OR jsonb_array_length(images) > 0);

CREATE INDEX catalog_sets_homepage_idx
  ON catalog_sets(homepage_order, created_at DESC, set_id)
  WHERE show_on_homepage AND active AND NOT is_archived AND NOT is_deleted;
