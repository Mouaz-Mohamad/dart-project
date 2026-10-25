# إصلاحات مراجعة المجلس — 25 أكتوبر 2026

هذه الدفعة تعالج حالات فشل محددة أثبتتها مراجعة الكود والاختبارات. ليست شهادة بأن كل حالات الإنتاج أو الأحمال قد اختُبرت.

## النتيجة والسلوك

| الجزء | الإصلاح | الملفات المعتمدة |
| --- | --- | --- |
| هوية المرتجع | ربط المطالبة بعملية البيع وسطرها؛ المرتجع القديم لا يمنع مشتريًا لاحقًا من المطالبة | `commerce.returns.ts`, `customer-interaction.service.ts`, `commerce.customer-queries.ts`, `promotion.service.ts` |
| المخزون والأموال | تعديل مرتجع قديم لا يحرر قطعة بيعت/حُجزت لاحقًا؛ منع refund أكبر من صافي السطر؛ تثبيت أصل المرتجع | `commerce.service.ts`, `src/dashboard/core/return-editor.js` |
| حركة الأوردر | رفض Back بعد مرتجعات/Refund/COD settlement أو تغير مالك القطعة؛ الاحتفاظ بالتصحيح الآمن | `commerce.service.ts` |
| الخصومات | Campaign داخل Scope فقط، Birthday/Card لبقية القطع، وحماية Model discount من الجمع اليدوي | `commerce.pricing.ts`, `commerce.service.ts`, `promotion.service.ts`, `set-cart.service.ts` |
| Ledgers | دعم Mixed مع دعم snapshots القديمة؛ الحجز والاستخدام والاسترجاع لكل benefit استُخدمت فعليًا | `backend/migrations/0063_mixed_line_discounts.sql` |
| Checkout | معالج واحد يحتفظ ببوابة العنوان ومراجعة السعر؛ فشل refresh بعد commit لا يكرر الأوردر؛ عرض القروش | `src/storefront/platform/checkout.js`, `auth-forms.js`, `shared.js`, `Js/dart-ui.js` |
| Returns UI | تثبيت النجاح عند فشل refresh وحصر القراءات في صلاحية الموظف | `src/dashboard/core/return-workflow.js` |
| Waiting UI | ربط صف العرض بالـID بدل ترتيب المصفوفة؛ الحفاظ على صفوف Sets | `src/storefront/platform/waiting.js`, `src/storefront/profile-records.js` |
| Email | أحداث جديدة فقط عبر Outbox مع recipient من الحساب وdeduplication؛ SMTP retry منفصل عن المعاملة التجارية | `commerce.notifications.ts`, `commerce.routes.ts`, `outbox/email-templates.ts` |
| حجم الواجهة | Profile delivery مولد ومصغر من مصدر قابل للصيانة، بنفس URL ودون تغيير CSS | `scripts/build-home-runtime.cjs`, `src/README.md` |

لم تُضف endpoints جديدة. تغيرت ضمانات المسارات الحالية: `POST /orders`, `POST /returns`, `POST /admin/returns/manual`, إجراءات مرتجعات الإدارة/المندوب، أوامر حالة الأوردر وإنشائه وتعديله. تفاصيل العقود في `API_CONTRACT.md` و`backend/openapi.yaml`.

## التحقق الآلي

قبل النشر:

- Backend: `npm run check` — lint/typecheck/Vercel config ناجحة؛ **450 passed / 48 skipped** من أصل 498. الاختبارات المتخطاة تتطلب `TEST_DATABASE_URL`؛ تشمل اختبار طلبَي refund متزامنين.
- اختبارات الدفعة الجديدة تستخدم كل migrations/triggers الفعلية: PGlite محليًا، وPostgreSQL داخل schema معزول عند توفر `TEST_DATABASE_URL` في GitHub.
- Frontend: `npm run check` — **34 فحصًا ناجحًا**، منها تشغيل handlers الفعلية داخل VM.
- `npm run build` للواجهة وBackend build ناجحان.
- Performance: **957 KiB core / 225 KiB homepage direct** ضمن الحدود الأصلية؛ لم تُرفع ميزانية الحجم.
- CSS audit: **0** overridden selector/property عبر 4 delivery groups. لا تغيير في ملفات CSS بهذه الدفعة.
- `git diff --check` ناجح.
- Chromium المحلي: تعذر تشغيله لغياب executable؛ نتائج 11 browser suites تعتمد على GitHub Frontend CI لنفس commit قبل اعتبار الإصدار متحققًا.

السيناريوهات الحرجة المغطاة:

1. رفض refund بقيمة الأوردر كله لقطعة قيمتها أقل، دون أي أثر جزئي.
2. تعديل refund قديم بعد إعادة بيع/حجز القطعة، مع بقاء المالك والحجز الجديدين.
3. رفض Back لأوردر قديم بعد مرتجع أو تغير الملكية، والسماح به إذا بقي البيع بلا آثار لاحقة.
4. إعادة شراء نفس القطعة ثم المطالبة بمرتجع جديد، ورفض تكرار المطالبة لنفس البيع.
5. رفض تحويل existingReturnId إلى قطعة أخرى، ورفض manual return لقطعة مملوكة لعملية أخرى.
6. سلة Campaign + Birthday + Model: حساب كل سطر وحجز السجلين دون تكرار؛ Campaign يبقى Used بعد المرتجع؛ Birthday لا يعود بعد مرتجع جزئي، ويعود بعد اكتمال قطعه داخل النافذة فقط.
7. Campaign + آخر خانة Dart Card: تطبيق Card على قطعة واحدة فقط، وعدم خصم قطعة زائدة أو قطعة لها Model discount؛ Delivered ثم refund يعيد الخانة.
8. Back وإعادة Delivered يعيدان حجز/استهلاك عدد قطع Card الصحيح فقط؛ إلغاء سلة مختلطة يحرر كل الحجوزات المستخدمة.
9. خصم يدوي 10% أو 30% لا يتراكم فوق Model 20%، بما في ذلك تعديل الأوردر.
10. أحداث Email مرتبطة بالبريد المسجل، HTML escaped، ولا تتكرر عند retry/no-op؛ تعطل SMTP لا يلغي الأوردر.
11. Checkout المؤكد ينجح مع فشل قراءات العرض؛ POST الفاشل يحتفظ بالسلة؛ Price Changed يطلب قبولًا صريحًا ويحفظ القروش.
12. صلاحية Return reviewer لا تستدعي Damage المحظور؛ فشل refresh لا يعكس نجاح الإجراء؛ Waiting يحتفظ بالمطابقة عند ترتيب عكسي.

## مراجعة dart-quality-review

| # | القسم | النتيجة والدليل |
| --- | --- | --- |
| 1 | الحالات | Pass: loading/locks باقية، أخطاء الأمر منفصلة عن refresh، fallback آمن إذا لم يتحمل Checkout UI |
| 2 | سلطة الخادم | Pass: المال والخصم والمخزون والأهلية محسوبة/مفحوصة على الخادم؛ الواجهة لا تمنح صلاحية مالية |
| 3 | التزامن | Pass على مستوى الكود: معاملات وأقفال order/item/domain؛ اختبار PostgreSQL المتزامن جزء من CI، وليس مثبتًا بـPGlite |
| 4 | الإدخال والصلاحيات | Pass: Zod وCSRF وMFA والصلاحيات المركزية القائمة؛ إضافة فحص ownership/sale identity؛ قراءات الواجهة مقيدة |
| 5 | التكرار | Pass: checkout idempotency، منع refund مكرر لنفس البيع، outbox deduplication، no-op status لا يكرر الحدث |
| 6 | التدقيق | Pass: حفظ معاملات المرتجع/الأوردر والقديم والجديد في Audit؛ تصحيح التقاط قيمة refund السابقة قبل mutation |
| 7 | الخدمات والتكلفة | Pass للنطاق: لا تغيير WhatsApp؛ SMTP وOutbox القائمان يسجلان المحاولات والنتيجة؛ الاختبارات تستعمل provider وهميًا بلا رسائل حقيقية |
| 8 | الرجوع الوظيفي | Pass محليًا للفحوص المعنية: لا تغيير تصميم/CSS أو حذف إجراءات؛ minification من source؛ browser CI بوابة إضافية |
| 9 | الاختبارات | Pass: السيناريوهات أعلاه آلية؛ حدود PostgreSQL/Chromium المحلي موضحة، ولا توجد دعوى load/capacity من هذه الأرقام |
| 10 | الأسرار | Pass: لا credentials جديدة أو مطبوعة أو مضافة للمتصفح/الـcommit؛ البريد والأسماء الاصطناعية في الاختبارات فقط |

## تحقق يدوي على بيئة اختبار

1. احجز سلة بها موديل عليه خصم، وموديل داخل Campaign، وآخر خارجها. راجع صافي كل سطر، ثم أنشئ الأوردر مرة واحدة. غيّر السعر قبل التأكيد وتحقق من شاشة المراجعة.
2. سلّم الطلب، ورد قطعة Good. احجزها لمشترٍ آخر، ثم عدّل مبلغ المرتجع القديم. يجب أن يبقى الحجز الثاني. Back للأوردر القديم يجب رفضه.
3. اشترِ القطعة في عملية جديدة واطلب Refund؛ يجب قبول المطالبة الجديدة مرة واحدة فقط.
4. جرّب حدود line refund، وBirthday الجزئي/الكامل/المنتهي، وCard عند 9/10 قطع؛ قارن ledger والمخزون وAudit.
5. استخدم Staff بصلاحية returns.review فقط، وافحص النجاح دون قراءات Damage ممنوعة. عطّل قراءات refresh بعد POST ناجح وتحقق أن النجاح يبقى ظاهرًا.
6. راجع Outbox للحدث الجديد، recipient والقالب؛ اختبر SMTP وهميًا. لا تستخدم عملاء حقيقيين لاختبار إرسال.

## تشغيل وترحيل

- Migration 0063 تغير دوال فقط وتدعم JSON القديم والجديد؛ لا تعيد تسعير الطلبات التاريخية ولا تعيد كتابة المخزون.
- يجب تطبيق SQL نفسها وحفظ SHA-256 في `dart_schema_migrations` داخل transaction مع قفل migrations قبل تشغيل كود Mixed الجديد.
- قبل الترحيل: نسخة 25 أكتوبر المشفرة واختبار الاستعادة ناجحان في GitHub run `40176702151`. قبل الإصدار: schema = 62، orders = 16، order lines = 21، returns = 1.
- طُبقت migration 0063 على Production في 25 أكتوبر، وأُثبتت بصمة `bb8ec34c24fae25582a6ec01a88101c2d349cfe5aaaf541a422e1c6315226e96`؛ تبقى أعداد orders/lines/returns كما كانت.
- النشر دفعة واحدة على main. تحقق من Backend CI وFrontend CI وproduction aliases لكل من API والمتجر ومطابقة commit.
- إذا تعثر النشر قبل استقبال عمليات Mixed جديدة، يمكن إبقاء API القديم مع الدوال المتوافقة. بعد عمليات Mixed جديدة يجب إصلاح الكود للأمام أو rollback إلى إصدار يفهم Mixed؛ الرجوع العشوائي إلى قارئ قديم قد يفسد reward projections. لا تسترجع backup فوق بيانات جديدة دون خطة تسوية.

## حدود متبقية

Email فقط هو قناة الإشعارات الجديدة في هذه الدفعة؛ Web Push ومركز إشعارات شامل لم يُبنَيا هنا. لا يوجد اختبار load حي أو دفع مالي حقيقي أو إرسال SMTP حقيقي بهذه الدفعة. لا تعني الاختبارات وحدها اعتمادًا شاملًا لكل الأحمال والتكاملات الخارجية والحالات المستقبلية.
