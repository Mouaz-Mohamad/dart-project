# Dart API Contract — Canonical Notes

هذه الوثيقة تصف العقود التشغيلية الحالية التي لا يجوز للواجهة تجاوزها. المرجع التنفيذي النهائي هو Routes + Zod schemas + PostgreSQL migrations داخل `backend/`، و`backend/openapi.yaml` هو العقد المعلن القابل للقراءة آليًا.

## Authority

- كل Business State الحقيقي في PostgreSQL.
- Browser storage مسموح به للـUI/cache فقط.
- Inventory, prices, discounts, Birthday, Dart Card, permissions, finance and order workflow لا تُحسم في المتصفح.
- Money داخل الخادم بوحدة `minor` (piastres) متى كان الحقل ماليًا typed.
- State-changing authenticated requests تستخدم Secure HttpOnly session + CSRF.
- Admin permissions deny-by-default وStaff actions الحساسة تحتاج الصلاحية المناسبة.
- العمليات الحساسة تستخدم Transactions/locks/idempotency حيث يلزم.

## Customer authentication

`POST /api/v1/auth/register` ينشئ Customer + session مباشرة ويرجع `201`. تسجيل العميل الجديد ليس gated بـEmail OTP. OTP ما زال موجودًا للتدفقات الصريحة مثل password recovery / verification flows.

Customer وRepresentative passwords يمران من سياسة واحدة: 12+ chars، lowercase، uppercase، digit. Staff flow منفصل ويعتمد على allowed Email + one-time email code ولا يستخدم Staff password.

## Birthday discount

Business invariant:

`UNIQUE(customer_user_id, reward_year)` داخل `birthday_discount_usage`.

- Reward = مرة استخدام واحدة لكل Birthday occurrence year في توقيت Cairo.
- Checkout يحجز الاستخدام داخل نفس transaction بعد إنشاء صف Order.
- `Delivered` يحوله إلى `Used` ويملأ `last_birthday_discount_used_at`.
- `Cancelled`/`Refused` يحرر الحجز.
- تغيير Birthday بعد `Used` لا يفتح Reward جديدًا لنفس reward year، ولا يجب أن يظهر Active reward/message/countdown/navbar promotion مرة أخرى في نفس السنة.
- تغيير Birthday قبل الاستخدام يمسح current-year unused birthday projection ويسمح بإنشاء Reward على التاريخ الجديد عند وصوله.
- تعديل Birthday نفسه audited.

## Promotions Engine

Admin endpoints:

- `GET /api/v1/admin/promotions` — `promotions.read`
- `POST /api/v1/admin/promotions` — `promotions.manage` + CSRF
- `PUT /api/v1/admin/promotions/:id` — `promotions.manage` + `expectedVersion`
- `GET /api/v1/admin/promotions/:id/analytics` — `promotions.read`

Checkout preflight يعمل server-side قبل Commerce write ويعيد تقييم الـEligibility وقت الطلب، بينما usage limits تُحجز transactionally في PostgreSQL مع الأوردر.

### Customer rules

Rule يمكن أن يكون Condition أو Group nested:

```json
{
  "mode": "AND",
  "rules": [
    { "field": "ordersCount", "operator": "eq", "value": 0 },
    { "field": "accountAgeDays", "operator": "gte", "value": 7 }
  ]
}
```

Fields الحالية:

- `ordersCount`
- `purchasedPieces`
- `totalSpendingMinor`
- `lastOrderDaysAgo`
- `customerId` (UUID أو Dart client code)
- `accountAgeDays`
- `isBirthday`

Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `between`, `in`, `notIn`.

`purchasedPieces` يعتمد على Delivered pieces ويستبعد completed returned items. `totalSpendingMinor` = Delivered final minus recorded refunds.

### Campaign controls

- Draft / Scheduled / Active / Paused / Expired
- percent discount
- start/end Cairo dates
- automatic or code-based
- priority
- minimum order minor amount
- minimum quantity
- all/categories/models/products scope
- total usage limit
- per-customer usage limit
- no stacking by default

`promotion_usages` يحجز limit داخل order transaction، ويصبح `Used` عند `Delivered` أو `Released` عند `Cancelled/Refused`.

الـCommerce الحالي يطبق Campaign percentage على مستوى الأوردر؛ لذلك Scoped campaign لا تمر إلا إذا كل خطوط السلة داخل الـScope. هذا اختيار حماية مقصود لمنع خصم Product غير مؤهل داخل mixed cart.

## Dart Card monthly draw

Server ranking:

1. أكبر عدد Delivered/non-returned pieces داخل الشهر.
2. عند تعادل القطع: أعلى Net Spending في نفس الشهر.
3. عند التعادل الكامل في الاثنين: random فقط بين exact ties، ويتم تسجيل tie set + method في الـAudit.

Eligibility:

- `customers.dart_card_draw_eligible = true`
- Customer account active
- عنده purchases مؤهلة في الشهر
- لا يملك Dart Card فعالة وغير منتهية وبها remaining capacity

الفائز يأخذ Card: 40%، حتى 10 pieces أو سنة من issue date، أيهما أولًا. Active-card decisions serialized per customer داخل PostgreSQL لمنع concurrent duplicate awards.

Endpoints:

- `GET /api/v1/admin/dart-card/draws/:period/preview`
- `POST /api/v1/admin/dart-card/draws/:period/run`
- `GET /api/v1/admin/dart-card/draws`
- `POST /api/v1/internal/dart-card/monthly-draw` protected by server-only `OUTBOX_CRON_SECRET`

`period_key` unique وrun يستخدم PostgreSQL advisory transaction lock؛ إعادة نفس الشهر idempotent ولا تمنح Card ثانية.

## Site Settings

`PUT /api/v1/admin/site-settings` يتطلب `expectedVersion` و`settings` التي تمر من strict central Zod schema. Unknown root settings are rejected. Public `GET /api/v1/site-settings` returns explicit allowlisted keys only؛ `codRisk` لا يخرج للمتصفح العام.

## Errors and concurrency

Expected categories:

- `400` malformed business/request parameters
- `401` missing/invalid session or internal bearer
- `403` denied permission/MFA/CSRF
- `404` missing entity
- `409` optimistic concurrency, exhausted eligibility, conflicting state
- `422` request-schema validation
- `429` rate limit
- `5xx` unexpected infrastructure/server error without leaking stack/SQL/secrets

`expectedVersion` is required on versioned mutable admin resources. Order creation already uses `Idempotency-Key`; monthly Dart Card draw uses unique period + lock.

## Migration set

Rewards/Promotions/Dart Card hardening is an ordered set:

- `0034_rewards_promotions_draw_integrity.sql` — ledgers, draw/audit tables, business triggers and permissions.
- `0035_reward_history_reference_compatibility.sql` — preserves immutable historical IDs across legacy projection rebuilds.
- `0036_dart_card_active_concurrency_lock.sql` — per-customer active-card serialization.
- `0037_reward_reservation_after_order_insert.sql` — ensures FK-safe reward reservation timing while staying in the same order transaction.

All four must be applied before the new endpoints are exposed to production traffic.

## Deployment boundary

Code in GitHub does not mean production schema is applied. The `0034`–`0037` migration set must run through the existing migration runner in the target environment. The internal monthly endpoint must be called by a trusted scheduler; it is intentionally scheduler-provider neutral.
