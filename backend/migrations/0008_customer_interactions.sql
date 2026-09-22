-- DART CODE GUIDE | backend/migrations/0008_customer_interactions.sql
-- الغرض: Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية.
CREATE SEQUENCE IF NOT EXISTS dart_return_request_seq START WITH 1;
