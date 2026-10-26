# إصلاحات فحص مجلس المستشارين الثاني — 2026-10-26

هذه الدفعة تعالج الأعطال المثبتة في الفحص الثاني. لا تعني اعتماد المتجر لكل حمل أو تكامل خارجي محتمل. التنفيذ مبني على نسخة `9548397` ومراجعة الكود وقاعدة الإنتاج بقراءات فقط. قبل الدفعة: 63 migration، و16 طلبًا و21 قطعة طلب ومجموعة Set تاريخية واحدة؛ لا توجد طلبات Card دون قطع Card فعلية ولا فروق بين إجمالي الطلب ومجموع قطعه في البيانات الموجودة. لا إعادة تسعير تاريخية أو إرسال تجريبي للعملاء.

## النتائج والملفات

| المسار | الإصلاح | الدليل الآلي |
|---|---|---|
| تعديل الطلب الإداري | يحافظ على promotion والمبالغ المدفوعة/المرتجعة والحالة والعنوان والحقول الاختيارية عند حذفها من المدخل. Set/reward/delivered snapshots مقفلة. لا يعاد COD Verified بسبب تغيير الاسم أو الملاحظات. | metadata ثم delivery مع بقاء Birthday ledger صحيحًا؛ وNew عادي يبقى بسعره المحفوظ بعد تغيير سعر الكتالوج |
| Set Checkout | `checkoutPricing` في `commerce.service.ts` يستخدم تخصيص `cart_set_components` قبل الحجز والرد؛ يجبر reconciliation قبل البريد والكاش. | Set بسعر 1200: قاعدة البيانات والرد والبريد متطابقة |
| Dart Card | تخصيص Set مستقل عن model fallback؛ يحسب حجز Sets في السلال والطلبات، وقفل مشترك لكل عميل بين attach وcheckout. عدد القطع يساوي خطوط Card الفعلية. | مستخدم 8 + Set بقطعتين + قطعة عادية = 10؛ استعادة 9 ثم 8 عند الإرجاع، وخصم Set نفسه لا يستهلك Card |
| Birthday legacy | migration 0064 تجمع Mixed مع Set-only fallback وتستخدم expiry التاريخية؛ تتزامن حالة Set usage مع lifecycle دون تعديل الأسعار. | إلغاء Set-only يحرر الحجز؛ المرتجع الجزئي يبقي Used والكامل يحرر داخل النافذة |
| السعر المعروض | `GET /me/cart/quote` وCheckout يستخدمان الحساب نفسه. الواجهة تعرض القروش الصحيحة؛ قبول السعر مربوط بـfingerprint للأسعار ومصدر الخصم. | إجمالي محلي 160 يتحول لمراجعة 180؛ تغيّر fingerprint أثناء القبول يرفض قبل أي POST |
| إعادة المحاولة | إزالة PromotionRouter preflight؛ completed idempotency يسبق صلاحية السلة. دعم hash القديم للكود التلقائي دون قبول بيانات اتصال مختلفة. Quote يستعيد رد المفتاح القياسي المؤكد بعد استهلاك السلة. | طلب HTTP كامل مكرر: 201 بنفس الرد وطلب واحد، واختبار توافق الكاش القديم |
| COD | إيصال استلام مؤرخ هو Cash In؛ Paid وحدها لا تثبت استلام Dart. gross receivable لا ينقص برد دفعته Dart؛ الرد Cash Out واحد. | طريقتا ترتيب receipt/refund تعطيان صافي 400 لكل طلب، والشهر السابق لا يتغير |
| خصوصية العميل | إزالة acquisition cost من `/me/commerce` وcheckout والردود المؤكدة القديمة؛ allowlist عامة للقطعة. | الرد والكاش واستعادة الرد وsnapshot بلا costSnapshot؛ تفاصيل التكلفة الإدارية محفوظة |
| Leaderboard | مفتاح المرتجع = الطلب والقطعة. | إرجاع ثم إعادة بيع نفس القطعة لا يخفض عداد البيع الجديد |
| واجهة الحساب | poll يحدث الإحصاءات دون استبدال draft العميل نفسه؛ Save/Cancel ينهيانه صراحة. | اختبار تشغيل renderProfile مع مدخل لم يحفظ بعد |
| استعادة الكتالوج | version poll/online يعيد hydration حتى بعد فشل أول تحميل عند version صفر. تسليم الكتالوج مصغر من `src/storefront/catalog.js` بنفس URL. | فشل bootstrap ثم checkForServerChanges صحي يعيد البيانات |
| Password Reset | تشغيل رسالة challenge المطلوبة مباشرة بدلاً من 5 رسائل FIFO غير مرتبطة. | اختبار HTTP يتتبع deduplication key المحدد |
| الحزم الأمنية | Nodemailer 10.2.1 وZod 4.6.7؛ overrides لـbody-parser 2.4.0 وip-address 10.7.5 وZod المتداخل. بقي Vercel Functions دون downgrade. | `npm audit --omit=dev`: صفر؛ MIME multipart فعلي محلي دون SMTP، واختبارات النقل وTS |

الملفات الأساسية: `backend/src/modules/commerce/` و`promotions/` و`finance/finance.service.ts` و`sets/set-cart.service.ts` و`identity/identity.routes.ts` و`outbox/outbox.dispatch.ts`، ومصادر `src/storefront/platform/`، و`Js/dart-ui.js` و`Js/dart-sets.js` و`Eye/dart-finance.js`. مواصفات HTTP في `backend/openapi.yaml` و`docs/API_CONTRACT.md`. ملفات التسليم أعيد توليدها من مصادرها؛ لم تتغير CSS.

## الاختبارات

- `npm run check` للواجهة: 34 فحصًا ثابتًا، بما فيها التخزين الخادمي، الحماية، المصادر، المالية والأسعار.
- `backend: npm run check` يشمل Vercel config وlint وTypeScript وVitest. اختبارات قاعدة الإنتاج الجديدة تستخدم PGlite محليًا وPostgreSQL الفعلي في CI عند وجود `TEST_DATABASE_URL`، دون لمس الإنتاج. الاختبارات التي تتطلب خادم PostgreSQL لا تدعي النجاح محليًا إذا لم يتوفر؛ CI تشغلها.
- `council-second-repairs.postgres.test.ts`: السيناريوهات التشغيلية المذكورة في الجدول؛ `email-message-compatibility.test.ts`: تكوين البريد الفعلي محليًا. اختبارات مصادر الواجهة تشمل حوار قبول السعر ومسودة الحساب واستعادة فشل bootstrap وtargeted reset.
- Build الواجهة وAPI و`audit:css -- --check` ناجحة. حدود JS محفوظة: core 951 KiB، Home 216 KiB، scoped 436 KiB. لا رفع لميزانيات الأداء.
- فحوص المتصفح تستخدم بيانات API تركيبية فقط. headless shell المحلي يستثني إثبات BFCache الأصلي؛ CI تستخدم Chrome الكامل وتتحقق منه. تكافؤ CSS يقارن 185 حالة مع النسخة السابقة.
- النتيجة النهائية لـCI والنشر تُراجع على نفس commit قبل إعلان الدفعة live.

## Dart Quality Review

| # | البند | النتيجة |
|---|---|---|
| 1 | Empty / Loading / Error | ناجح: خطأ Quote يمنع الإرسال؛ السعر المتغير يفتح مراجعة؛ bootstrap يعيد المحاولة، ومسودة الحساب تبقى أثناء polling |
| 2 | سلطة الخادم | ناجح: الحساب مشترك داخل transaction، integer Piastres، expectedTotal للشرح فقط؛ PostgreSQL مصدر المخزون والمكافآت |
| 3 | التزامن | ناجح للمسارات المعدلة: قفل العميل بين Set وcheckout، أقفال السلة/القطع/المكافآت، وفحص fingerprint داخل المعاملة. لا ادعاء بقياس حمل الإنتاج |
| 4 | المدخلات والصلاحيات | ناجح: central customer authentication وownership في Quote؛ CSRF في POST؛ validation للـfingerprint والمبالغ؛ لا منح صلاحيات جديدة |
| 5 | عدم التكرار | ناجح: replay قبل eligibility/cart، توافق كاش سابق مضبوط بالـhash، outbox deduplication والمفتاح المحدد للـOTP |
| 6 | التدقيق | ناجح: metadata edit يسجل before/after المالية؛ تسويات COD وتغييرات الحالة والمرتجعات تحتفظ بالتدقيق الحالي؛ Quote لا يكتب حركة عمل |
| 7 | خدمات خارجية وتكلفة | ناجح: reset dispatch محصور بتحدٍ واحد؛ لا اختبار إرسال SMTP/WhatsApp حي؛ event/channel policy دون تغيير |
| 8 | منع التراجع | ناجح في الفحوص المحلية المطبقة؛ نفس URLs والميزانيات وCSS؛ لا framework جديد ولا تغيير أسعار تاريخية |
| 9 | المسارات الحرجة | ناجح: سيناريوهات الجدول مرتبطة بالاختبارات المذكورة؛ PostgreSQL والمتصفح الكامل مطلوبان في CI |
| 10 | الأسرار | ناجح: لا credentials ضمن الكود/fixtures؛ SQL الإنتاج فحص إجماليات فقط، وbackup مشفر عبر workflow الموجود |

نسخة backup والتحقق من الاستعادة قبل الترحيل نجحا: GitHub Actions run `40274275502` على `9548397`، بما فيه خطوة `Create encrypted backup and prove recovery`.

متابعة CI: كشف إنشاء SQL functions في schema معزول أن مسار `public` الآمن للإنتاج يحتاج الربط بالـschema الاختباري وقت إنشاء الدالة، لا بعد انتهاء migrations فقط. `runIsolatedMigrations` يربط مسار الدوال بالـschema المعزول أثناء التهيئة، مع إبقاء `check_function_bodies=on` وملفات الإنتاج/checksums دون تغيير. اختبار `migration-isolation.test.ts` ينفذ الدالة التابعة فعليًا في schema معزول. تعديلات التهيئة والسياسة اللاحقة لا تغيّر runtime المنشور؛ Vercel يتجاهل تغييرات الاختبارات فقط.

## الترحيل والتحقق التشغيلي

1. اكتمال الفحوص المحلية ثم commit ذري واحد وref update واحدة إلى main؛ بناء Frontend وAPI مرة واحدة لكل منهما.
2. نسخة احتياطية مشفرة واختبار استعادة حديثان عبر workflow الموجود قبل تطبيق 0064. يحتفظ 0063 بالـchecksum المنشور دون تعديل.
3. تطبيق 0064 داخل معاملة تحت قفل migrations وتسجيل checksum الملف نفسه؛ ثم فحص عداد migrations وحالة الاتصال، ومطابقة aliases مع commit الجديد.
4. Smoke read-only: الرئيسية، `/cart-checkout.html` وprofile، وhealth على API والـproxy؛ admin بلا جلسة يجب أن يبقى مرفوضًا.
5. E2E كتابي يتم في قاعدة اختبار: تعديل metadata لطلب Mixed، checkout ثم retry، delivery/returns للمكافآت، وCOD receipt/refund في ترتيبين وشهرين. لا إنشاء طلب أو تحويل مالي حي لمجرد الفحص.

حدود باقية: اعتماد SMTP وWhatsApp طرفًا لطرف بقياس وصول فعلي، وتحمّل ذروة تشغيلية، وWeb Push/notification center ليست مثبتة بهذه الدفعة. تسوية COD هنا gross receipt وrefund دفعته Dart؛ مقاصة refund دفعه المندوب تحتاج سيرًا ماليًا صريحًا يحدد الممول، ولا ينشئ النظام تلك المقاصة تلقائيًا. لا نعيد إنشاء إيصالات أو مبالغ تاريخية مفقودة بالتخمين.

للتراجع: إعادة دفعة التطبيق كوحدة إذا لزم، مع تقييم توافق الطلبات الجديدة أولًا. migration 0064 غير هدامة ولا تعيد كتابة البيانات؛ لا تحذف أو تعدل ملف 0063 المنشور، ولا تعكس حالة مكافآت تاريخية دون تسوية مدققة.
