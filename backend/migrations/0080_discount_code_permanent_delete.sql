-- DART CODE GUIDE | backend/migrations/0080_discount_code_permanent_delete.sql
-- الغرض: حذف الكود نهائيًا مع الاحتفاظ بسجل الأوردرات والخصومات المالية.
ALTER TABLE discount_code_usages
  ADD COLUMN code_snapshot TEXT;

UPDATE discount_code_usages AS usage
   SET code_snapshot=code.code
  FROM discount_codes AS code
 WHERE usage.discount_code_id=code.id;

ALTER TABLE discount_code_usages
  ALTER COLUMN discount_code_id DROP NOT NULL;

ALTER TABLE discount_code_usages
  DROP CONSTRAINT discount_code_usages_discount_code_id_fkey;

ALTER TABLE discount_code_usages
  ADD CONSTRAINT discount_code_usages_discount_code_id_fkey
  FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id) ON DELETE SET NULL;
