-- DART CODE GUIDE | backend/migrations/0097_optional_customer_birthday.sql
-- الغرض: تاريخ الميلاد اختياري؛ لا نغير سجلات العملاء الحالية أو مزاياهم.
-- Existing birthday benefit rules ignore NULL; PostgreSQL DATE still validates supplied dates.
ALTER TABLE public.customers DISABLE TRIGGER customers_require_birthday_on_insert;
