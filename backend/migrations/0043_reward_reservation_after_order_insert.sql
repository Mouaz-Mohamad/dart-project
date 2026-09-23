-- DART CODE GUIDE | backend/migrations/0037_reward_reservation_after_order_insert.sql
-- الغرض: حجز Birthday/Promotion usage بعد وجود صف order فعليا، مع بقاء العملية داخل نفس transaction بالكامل.

DROP TRIGGER IF EXISTS orders_reward_reservation_guard ON orders;
CREATE TRIGGER orders_reward_reservation_guard
AFTER INSERT ON orders
FOR EACH ROW EXECUTE FUNCTION dart_reserve_order_rewards();
