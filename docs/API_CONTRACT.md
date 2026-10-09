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

## Promotion campaigns

- `GET /api/v1/me/promotions/resolve?reservationId=...` يحسم أعلى حملة تلقائية مؤهلة للسلة المحجوزة دون استهلاكها.
- `GET /api/v1/me/promotions/validate-v2?code=...` يتحقق من أهلية العميل لكود الحملة.
- `GET /api/v1/admin/promotions` يعرض الحملات.
- `POST /api/v1/admin/promotions` ينشئ حملة بصلاحية `promotions.manage`.
- `PUT /api/v1/admin/promotions/:id` يحدّث الحملة باستخدام `expectedVersion` لمنع الكتابة فوق تعديل أحدث.
- `GET /api/v1/admin/promotions/:id/analytics` يعرض المحجوز والمستخدم والعملاء والإيراد وتكلفة الخصم والمتبقي.

حد الحملة يدعم `limitBasis: "orders" | "customers"`. ويطبق Checkout خصمًا واحدًا فقط لكل قطعة بالترتيب: Model ثم Campaign ثم Birthday ثم Dart Card.

## Customer authentication

`POST /api/v1/auth/register` ينشئ Customer + session مباشرة ويرجع `201`. تسجيل العميل الجديد ليس gated بـEmail OTP. OTP ما زال موجودًا للتدفقات الصريحة مثل password recovery / verification flows.

قواعد الحساب الحالية:

- Birthday مطلوب عند إنشاء أي Customer جديد.
- Customer password: **6 خانات على الأقل فقط**. لا يوجد شرط Uppercase/Lowercase ولا شرط حرف/رقم؛ الحروف والأرقام والرموز والمسافات والنص غير اللاتيني كلها مسموحة ضمن حد 200 حرف.
- Representative password يظل أقوى: 12+ chars مع lowercase + uppercase + digit.
- Staff flow منفصل ويعتمد على allowed Email + one-time email code ولا يستخدم Staff password.

### Google / Facebook customer sign-in

Social login للعملاء فقط ويستخدم OAuth authorization-code flow من الـBackend. الـprovider secret لا يخرج للمتصفح، وDart لا يخزن provider access/refresh tokens.

Flow:

1. العميل يبدأ Google أو Facebook من صفحة Login/Register.
2. الـProvider يثبت الهوية والبريد ويرجع authorization code للـBackend.
3. Dart ينشئ one-time completion capability قصيرة العمر؛ المخزن في PostgreSQL هو الـhash فقط، والـcapability نفسها ترجع للمتصفح داخل URL fragment وليس query string. بعد إزالة الـfragment من العنوان، الواجهة تقرأ بيانات الـchallenge عبر `POST /api/v1/auth/social/challenge` وتضع الـcapability في JSON body حتى لا تظهر في request URL/logs.
4. كل Social completion يطلب **Dart Password + Confirm Password + Birthday**.
5. إذا كان Social account جديدًا في Dart، يطلب أيضًا Full Name + Primary Phone (وPhone 2 اختياري) قبل إنشاء الحساب.
6. إذا كان العميل موجودًا، يجب أن يؤكد Dart password الحالية. Birthday المحفوظة لا يتم استبدالها من تسجيل الدخول؛ القيمة المدخلة تملأ فقط Legacy account لا يحتوي Birthday.
7. بعد النجاح تصدر نفس Secure HttpOnly Customer session العادية ويمكن Claim للـguest cart.

Providers لا يصبحوا Active إلا عند ضبط server-side environment credentials. عدم ضبطهم لا يسبب fallback غير آمن؛ الواجهة توضح أن المزود غير مهيأ.

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
- Migration `0038` تضيف DB insert guard حتى لا يمكن إنشاء Customer جديد بدون Birthday من مسار داخلي يتجاوز HTTP schema.

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
3. إذا تساوى أعلى العملاء **تمامًا** في عدد القطع وصافي الإنفاق:
   - شخص واحد: يفوز وحده.
   - شخصان: كلاهما يفوز.
   - 3 أشخاص: الثلاثة يفوزون.
   - 4 أشخاص أو أكثر: يتم اختيار **3 فائزين مختلفين عشوائيًا** من مجموعة الـexact ties فقط.

كل فائز يأخذ Dart Card مستقلة: 40% حتى 10 pieces أو سنة من issue date، أيهما أولًا. `dart_card_draw_winners` يحفظ كل الفائزين ومركز كل فائز والكرت الصادر له، بينما الحقول القديمة في `dart_card_draws` تحتفظ بأول فائز للتوافق مع القراءات القديمة. كل Tie method وكل قائمة Winners تسجل في Draw events + Audit.

Eligibility:

- `customers.dart_card_draw_eligible = true`
- Customer account active
- عنده purchases مؤهلة في الشهر
- لا يملك Dart Card فعالة وغير منتهية وبها remaining capacity

Active-card decisions serialized per customer داخل PostgreSQL لمنع concurrent duplicate awards.

Endpoints:

- `GET /api/v1/admin/dart-card/draws/:period/preview`
- `POST /api/v1/admin/dart-card/draws/:period/run`
- `GET /api/v1/admin/dart-card/draws`
- `POST /api/v1/internal/dart-card/monthly-draw` protected by server-only `OUTBOX_CRON_SECRET`

`period_key` unique وrun يستخدم PostgreSQL advisory transaction lock؛ إعادة نفس الشهر idempotent ولا تمنح كروت إضافية.

## Sets — homepage presentation

Existing `POST /api/v1/admin/sets` and `PUT /api/v1/admin/sets/:setId` accept
`shortDescription` (trimmed text, at most 280 characters), `showOnHomepage` (boolean),
and `homepageOrder` (integer 0–9999; lower numbers first). These fields are stored in
`catalog_sets` by migration `0057_set_homepage_presentation.sql`. New Sets default to
hidden with empty short copy and order 0; omitted fields on update preserve the saved values.
A visible homepage Set requires its own uploaded Set image. Auth, CSRF, `sets.manage`,
version conflict handling and audit logs apply to these edits through the existing Set service.
`GET /api/v1/sets` and `GET /api/v1/sets/:setId` expose the presentation fields alongside
the server-calculated Set prices. Homepage visibility does not hide an active Set from
the regular catalogue, create inventory, or reserve pieces.

## Site Settings

`PUT /api/v1/admin/site-settings` يتطلب `expectedVersion` و`settings` التي تمر من strict central Zod schema. Unknown root settings are rejected. Public `GET /api/v1/site-settings` returns explicit allowlisted keys only؛ `codRisk` لا يخرج للمتصفح العام.

## Errors and concurrency

### Authoritative order commands

- `GET /api/v1/admin/orders-state` remains a read-only full snapshot, with its `version` and rows read in one PostgreSQL repeatable-read transaction. It requires `orders.read` and configured MFA.
- Legacy `PUT /api/v1/admin/orders-state` is disabled: authenticated authorized callers receive `405 ORDER_COMMAND_REQUIRED` and `Allow: GET`; it never replaces orders, items, money or status.
- Single `POST /api/v1/admin/orders/:orderRef/workflow` requires `orders.manage`; bulk `POST /api/v1/admin/orders/bulk-workflow` requires `orders.bulk_manage`. Both require CSRF, configured MFA, `expectedStatus` and `target`, reject unknown fields, and call the same server workflow. Stale state and invalid transitions return `409` before stock, rewards or money change.
- Bulk commands return explicit per-order results; partial success is preserved. Each successful transition and its inventory/reward effects are audited in the same transaction.
- A command whose transaction committed remains successful if loading its response snapshot fails: `200` includes `refreshRequired: true` and a placeholder empty `orders` array. Clients must retain the current rows, fetch the read-only snapshot and never automatically retry the mutation. A full snapshot is applied only when its version is at least the current client version.
- Order commands release their transaction connection before reading the response snapshot, including pools with one connection. Catalog/domain refresh runs separately from command completion.
- The dashboard prevents overlapping actions on the same order while permitting actions on different orders. Transport failures/timeouts and mutation `5xx` trigger read reconciliation; no automatic mutation retry. Legacy browser saves can change checkbox selection only.

Expected categories:

- `400` malformed business/request parameters
- `401` missing/invalid session or internal bearer
- `403` denied permission/MFA/CSRF
- `404` missing entity
- `409` optimistic concurrency, exhausted eligibility, conflicting state
- `422` request-schema validation
- `429` rate limit
- `5xx` unexpected infrastructure/server error without leaking stack/SQL/secrets

`expectedVersion` is required on versioned mutable admin resources. Order creation already uses `Idempotency-Key`; monthly Dart Card draw uses unique period + lock؛ Social completion يستخدم one-time hashed capability + row lock/advisory lock.

## Migration set

Rewards/Promotions/Dart Card/Social Auth hardening is an ordered set:

- `0034_rewards_promotions_draw_integrity.sql` — ledgers, draw/audit tables, business triggers and permissions.
- `0035_reward_history_reference_compatibility.sql` — preserves immutable historical IDs across legacy projection rebuilds.
- `0036_dart_card_active_concurrency_lock.sql` — per-customer active-card serialization.
- `0037_reward_reservation_after_order_insert.sql` — ensures FK-safe reward reservation timing while staying in the same order transaction.
- `0038_customer_social_auth_and_multi_winner_draw.sql` — hashed Social OAuth challenges/identity links, required-Birthday insert guard, and one-to-many Dart Card draw winners with maximum 3 winners.

## Deployment boundary

Code in GitHub does not mean production schema is applied. Migrations `0034`–`0038` must run through the existing migration runner in the target environment before enabling these current reward/social/draw contracts. Social providers also require their server-side environment credentials and provider callback registration. The internal monthly endpoint must be called by a trusted scheduler; it is intentionally scheduler-provider neutral.

## News

Migration `0059_news_foundation.sql` adds independent `news_articles`, with RLS and no direct Data API grants. The backend table owner reads it through permissioned APIs. Only Owner receives `news.read` and `news.manage` automatically; additional Staff access is explicitly granted in Settings.

- Public `GET /api/v1/news?limit=100&offset=0` returns published, non-archived summaries, `total` and nullable `nextOffset`. Full body and staff metadata are excluded.
- Public `GET /api/v1/news/:id` returns current complete plain text; draft/archived/missing records return 404.
- Staff `GET /api/v1/admin/news` accepts `q`, `status=all|draft|published`, `archive=active|archived|all`, `limit` (1–100) and `offset` (0–100000); read/detail require `news.read` or `news.manage`.
- Staff `POST /api/v1/admin/news` creates; `PUT /api/v1/admin/news/:id` replaces editable fields with `expectedVersion`; `POST /api/v1/admin/news/:id/state` accepts `archive|restore` and `expectedVersion`. All writes require `news.manage`, CSRF and MFA when configured.
- Staff `PUT /api/v1/admin/news/assets` uploads one primary JPG/PNG/WebP cover (4 MiB compressed maximum) under `NEWSIMG-…`; this does not require or grant catalog management.

Fields: title (1–160), optional excerpt (≤280; falls back to the start of body), plain-text body (1–30000), existing coverAssetId, draft/published status and optional integer sortOrder (0–9999). Unknown keys are rejected. Manual order ascending precedes automatic newest publication first. Republishing a draft sets a fresh publication timestamp; restoring an archived record preserves its prior publication status.

Row locks and expectedVersion prevent silent overwrites. A stable newsId plus identical create payload by the same actor is safe to retry; duplicate archive/restore is a no-op. Every successful content/state change writes actor, request ID and before/after values in the same transaction. News does not modify orders, prices or inventory and is never persisted in browser storage.

Public cards use 187.5×250px images (3:4) on desktop and mobile. News follows products on Home and brand story on About. Swipe/drag, arrows and five-second automatic movement share the same runtime; interaction, open dialogs, hidden pages and reduced-motion preferences pause automatic movement. Read more fetches current plain text into an accessible dialog, fullscreen on mobile.
