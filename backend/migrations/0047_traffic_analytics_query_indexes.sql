-- DART CODE GUIDE | backend/migrations/0047_traffic_analytics_query_indexes.sql
-- الغرض: إبقاء تقارير Traffic/Conversion سريعة مع نمو طلبات الموقع بدون تغيير بيانات الأعمال.
CREATE INDEX IF NOT EXISTS orders_website_created_idx
  ON orders (created_at DESC)
  WHERE NOT is_deleted AND order_source='Website';
