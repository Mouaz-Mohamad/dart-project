-- DART CODE GUIDE | backend/migrations/0098_discount_codes_enforce_rls.sql
-- الغرض: تطبيق حماية RLS على أكواد الخصم وسجل استخدامها؛ السياسة وصلاحيات الدور الخادمي مُعرّفة مسبقاً.
-- The dedicated dart_app_runtime role already has an explicit dart_api_runtime policy.
-- Enabling RLS closes the previously unguarded path without changing discount data.
ALTER TABLE public.discount_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discount_code_usages ENABLE ROW LEVEL SECURITY;
