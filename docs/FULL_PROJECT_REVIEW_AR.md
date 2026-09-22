# Dart | for you — مراجعة المشروع الكاملة

**تاريخ المراجعة:** 22 سبتمبر 2026  
**الفرع:** `full-code-cleanup`  
**آخر HEAD وقت التقرير:** `0a45e20ba7748470a821068b1fb6d9d9bfbd494b`

> هذا التقرير يفرق بين شيئين:  
> 1) هل الكود الموجود حاليًا ينجح في الاختبارات ولا توجد به أخطاء معروفة في المسارات التي تم فحصها؟  
> 2) هل كل المزايا الموجودة في الخطة التقنية قد تم تنفيذها؟  
> النجاح في (1) لا يعني تلقائيًا اكتمال (2).

## النتيجة المختصرة

- Backend CI: **PASS**
- PostgreSQL integration tests: **PASS**
- Frontend static regression: **PASS**
- Chromium storefront + dashboard smoke: **PASS**
- Production readiness health check: **UP** في الفحص الذي تم أثناء المراجعة.
- التعليقات ودليل الكود: **مضافان** لمعظم ملفات المصدر القابلة للتعليق، مع خريطة لكل الملفات في `docs/CODE_GUIDE_AR.md`.
- Birthday reward integrity: **PASS** + regression test جديد.
- Customer password floor: **تم رفعه إلى 8 أحرف** للإنشاء الجديد.
- لا توجد نتيجة تسمح بالقول إن المشروع **مكتمل 100% حسب كل بنود الخطة**؛ توجد فجوات Features موثقة أدناه، أهمها COD Risk & Verification وWhatsApp Order Confirmation.

## ما تمت مراجعته

### Backend / Database
- Auth والجلسات.
- CSRF وCORS وrate limiting.
- RBAC والصلاحيات على الخادم.
- PostgreSQL migrations.
- Cart reservation.
- Checkout transaction وIdempotency-Key.
- إعادة حساب السعر/الخصم/المخزون على الخادم.
- Orders وReturns وInventory.
- Birthday rewards وDart Card.
- Outbox/Email/WhatsApp transport.
- Finance/COD accounting.
- Relational dashboard domains.
- اختبارات PostgreSQL الحقيقية.

### Frontend / Dashboard
- JavaScript syntax/static contracts.
- Storefront smoke على Chromium.
- Dart Eye dashboard smoke على Chromium.
- API adapters.
- عدم الاعتماد على LocalStorage كمصدر حقيقة للـdomains المنقولة للسيرفر.
- CSS split والتوثيق.
- الروابط والملفات التشغيلية التي تغطيها اختبارات الواجهة.

## إصلاحات تمت أثناء المراجعة

1. إصلاح استخدام PostgreSQL client واحد في استعلامات Leaderboard بشكل متزامن.
2. إضافة regression test يمنع رجوع مشكلة الاستعلامات المتوازية على نفس client.
3. إنشاء نظام تعليقات عربي قصير للملفات + `docs/CODE_GUIDE_AR.md`.
4. إصلاح Workflow التعليقات حتى لا يحاول تعديل ملفات workflow بصلاحية غير مسموحة.
5. إضافة تعليقات يدوية لملفات GitHub Actions.
6. تصحيح مرجع CSS القديم من `fixes.css` إلى `responsive.css`.
7. رفع الحد الأدنى لكلمة مرور العميل الجديد من 4 إلى 8 أحرف.
8. تعديل اختبارات كلمة المرور لتطابق السياسة الجديدة.
9. إضافة regression test لسلامة Birthday reward:
   - Reward ID مربوط بالعميل والسنة.
   - Delivered => Used.
   - Cancelled/Refused => يعاد Active فقط إذا لم تنته الصلاحية.

## التعليقات وفهم الكود

الدفعة الرئيسية للتعليقات عدلت **196 ملفًا** في commit واحد، ثم تم استكمال ملفات GitHub Actions يدويًا لأن GitHub لا يسمح للـworkflow نفسه بإعادة كتابة workflow files بدون صلاحيات إضافية.

كل ملف مصدر قابل للتعليق يحتوي Header من نوع:

```text
DART CODE GUIDE | <path>
الغرض: <شرح عربي مختصر لمسؤولية الملف>
```

الملفات التي لا يناسبها إدخال تعليق مباشر (مثل الصور وبعض صيغ البيانات) موثقة في:
- `docs/CODE_GUIDE_AR.md`

كما يوجد Generator:
- `scripts/add-arabic-code-comments.mjs`

## نتائج CI المؤكدة

### Backend
آخر تشغيل بعد تعديل Birthday test:
- Run: `35745910160`
- Conclusion: **success**
- Commit: `0a45e20ba7748470a821068b1fb6d9d9bfbd494b`

تشغيل سابق بعد تشديد Password policy:
- Run: `35743575457`
- Conclusion: **success**
- Commit: `8704fa36cb55c4ab9cbf8068f53a8c14c6a68882`

### Frontend
- Run: `35743322018`
- Conclusion: **success**
- Static regression: PASS
- Chromium storefront + dashboard smoke: PASS
- Commit: `b4799665cc9a9d0f08a29410fa6e409eb786bd45`

لم تتغير ملفات Frontend بعد هذا التشغيل؛ التغييرات اللاحقة كانت Backend/tests فقط.

## فحص Dart Quality Review

| البند | النتيجة | الملاحظة |
|---|---|---|
| 1. State coverage | PASS للمسارات المختبرة | Empty/loading/error handling موجود في المسارات الرئيسية التي راجعتها؛ Features غير المنفذة لا تعتبر PASS. |
| 2. Server authority | PASS للمسارات المنقولة | Checkout/stock/pricing/discounts الحرجة يعاد التحقق منها على الخادم. |
| 3. Concurrency | PASS للمسارات المختبرة | Transactions + row locks + idempotency؛ وتم إصلاح Leaderboard shared-client issue. |
| 4. Validation & authorization | PASS | Zod + middleware مركزي + permissions على الخادم. |
| 5. Idempotency | PASS للمسارات الموجودة | Checkout/outbox لديهم حماية من التكرار. |
| 6. Audit & observability | PASS جزئي | العمليات الحساسة الرئيسية تسجل Audit؛ Features المستقبلية غير الموجودة لم تُقيّم كمنفذة. |
| 7. External-service awareness | PARTIAL | Outbox/WhatsApp transport موجود، لكن Order Confirmation workflow نفسه غير منفذ. |
| 8. Regression safety | PASS | Backend + Frontend CI ناجحان بعد التنظيف. |
| 9. Tests | PASS للمسارات التي تم تعديلها | أضيفت اختبارات للـLeaderboard/Birthday/Password policy. |
| 10. Secrets | PASS في المراجعة الحالية | الأسرار تؤخذ من env ولم يتم إدخال token جديد داخل الواجهة أو commits التي تمت. |

## فجوات مؤكدة بالنسبة للخطة

### 1. COD Risk & Verification — **غير منفذ كـModule كامل**
البحث في الكود الحالي لم يجد:
- `riskLevel`
- `verificationStatus`
- `riskScore`
- COD risk decision engine

الموجود حاليًا هو COD كطريقة دفع ومحاسبة وتسويات، وليس نظام المخاطر والتحقق المطلوب قبل تجهيز الطلب.

هذا يعني أنه لا يجوز اعتبار Launch Gate الخاص بالخطة مكتملًا حتى يتم تنفيذ هذا الجزء.

### 2. WhatsApp Order Confirmation Dialogue — **غير منفذ**
غير موجود حاليًا:
- `Confirmation Pending`
- `orders.confirmation_status`
- `order_confirmation_events`
- `ORDER_CONFIRMATION_REQUEST`
- Meta reply-button webhook
- Signature verification لردود Meta
- Reminder بعد ساعتين / انتهاء بعد 4 ساعات
- منع دخول الطلب إلى `Preparing` قبل التأكيد

### 3. Minimal customer WhatsApp order events — **غير مكتملة**
لم أجد تنفيذًا للأحداث بالأسماء المتفق عليها:
- `ORDER_PLACED`
- `ORDER_OUT_FOR_DELIVERY`
- `ORDER_DELIVERED`

طبقة WhatsApp transport نفسها موجودة في Outbox، لكن Business events المطلوبة ليست موصولة بها بعد.

### 4. Restock Reservation & Waitlist — **المواصفة موجودة وليست منفذة بالكامل**
Section 44 يطلب:
- Notify Me عند Out of Stock.
- FIFO waitlist.
- Exact match أولًا ثم alternative color.
- 4-hour reservation عند عودة المخزون.
- Cascade للعميل التالي.
- Waitlist & Demand dashboard.

لا يوجد Module كامل لهذه الوظيفة في الفرع الحالي.

### 5. Features المؤجلة في v2.2
بعض المزايا الكبيرة مثل Live Operations Map ومحرك الخصومات الكامل وغيرها موصوفة كمرحلة لاحقة في الخطة وليست شرطًا لسلامة الكود الحالي. عدم وجودها لا يعني أن الموجود مكسور، لكنه يعني أن المشروع ليس "كل ما في الخطة منفذ".

## ملاحظة عن Production

هذه المراجعة تمت على فرع `full-code-cleanup`.  
**لم يتم نشر هذا الفرع على Vercel ضمن هذه المهمة.**

فحص الـProduction الحالي أثناء المراجعة أعطى Database health طبيعيًا في العينات المتكررة، لكن نجاح الفرع لا يصبح Production deployment إلا بعد الدمج/النشر لاحقًا.

## ما أعتبره مغلقًا الآن

- تنظيف وتعليقات الكود: مغلق.
- Backend CI: مغلق.
- Frontend regression/smoke: مغلق.
- Password floor: مغلق.
- Birthday reward integrity الحالية: مغلقة باختبار.
- Leaderboard shared-client concurrency bug: مغلق.
- COD Risk + Order Confirmation: **مفتوح Feature gap** وليس Bug مخفي.
- Restock Waitlist: **مفتوح Feature gap**.

## قاعدة قبل أي دمج إلى Production

لا تدمج على أساس عبارة "كل شيء مكتمل 100%" فقط.  
القرار الصحيح حاليًا:

**الكود الموجود بعد التنظيف يمر باختبارات Backend/Frontend، لكن Launch Gate حسب الخطة ما زال يحتاج إغلاق COD Risk & Verification وWhatsApp confirmation workflow قبل اعتباره مكتملًا بالكامل.**
