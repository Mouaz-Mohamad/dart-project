# Dart — دليل الكود العربي

هذا الملف خريطة قراءة للمشروع. التعليقات داخل ملفات الكود تشرح مسؤولية كل ملف باختصار، وهنا توجد خريطة حتى للملفات التي لا تسمح صيغتها بتعليقات مثل JSON والصور.

## قاعدة القراءة

- الواجهة لا تُعد مصدر الحقيقة للسعر أو المخزون أو الصلاحيات؛ الـBackend/PostgreSQL هما المرجع.
- ابدأ من الصفحة أو الـroute ثم اتبع الاستدعاء إلى الـservice ثم قاعدة البيانات.
- ملفات migrations تاريخية: لا تعدّل migration مطبق؛ أضف migration جديدًا.
- أي تغيير في Auth/Inventory/Orders/Finance يحتاج اختبارًا آليًا قبل اعتباره مكتملًا.

## خريطة الملفات

| الملف | المسؤولية |
|---|---|
| `.github/dependabot.yml` | إعداد Dependabot لمتابعة تحديثات واعتمادات المشروع. |
| `.github/workflows/backend-ci.yml` | إعداد GitHub Actions للتحقق الآلي من الكود قبل الدمج أو النشر. |
| `.github/workflows/batch-policy.yml` | إعداد GitHub Actions للتحقق الآلي من الكود قبل الدمج أو النشر. |
| `.github/workflows/code-comments.yml` | إعداد GitHub Actions للتحقق الآلي من الكود قبل الدمج أو النشر. |
| `.github/workflows/frontend-ci.yml` | إعداد GitHub Actions للتحقق الآلي من الكود قبل الدمج أو النشر. |
| `AGENTS.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `CSS/base.css` | تنسيقات الواجهة العامة؛ حافظ على تقسيم base/main/responsive وتجنب تكرار القواعد. |
| `CSS/main.css` | تنسيقات الواجهة العامة؛ حافظ على تقسيم base/main/responsive وتجنب تكرار القواعد. |
| `CSS/responsive.css` | تنسيقات الواجهة العامة؛ حافظ على تقسيم base/main/responsive وتجنب تكرار القواعد. |
| `Codex_Master_Prompt.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `Contact us.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `Eye/Dart Eye.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `Eye/dart-admin-auth.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-domain-state.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-finance.css` | تنسيقات قسم من Dart Eye Dashboard مع دعم الكمبيوتر والموبايل. |
| `Eye/dart-finance.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-inventory.css` | تنسيقات قسم من Dart Eye Dashboard مع دعم الكمبيوتر والموبايل. |
| `Eye/dart-inventory.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-operations.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-orders-api.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-settings.css` | تنسيقات قسم من Dart Eye Dashboard مع دعم الكمبيوتر والموبايل. |
| `Eye/dart-settings.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-size-chart.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart-staff.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart.css` | تنسيقات قسم من Dart Eye Dashboard مع دعم الكمبيوتر والموبايل. |
| `Eye/dart.js` | منطق Dart Eye Dashboard؛ يعرض/يدير البيانات عبر الـAPI مع احترام صلاحيات الموظف. |
| `Eye/dart_logo.png` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `Js/dart-address.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-api.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-catalog.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-groups.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-platform.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-rep.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-returns.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-site-settings.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-state.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-storefront.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-tracking.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Js/dart-ui.js` | وحدة JavaScript للموقع العام؛ مسؤولة عن جزء محدد من تجربة العميل والتواصل مع الـAPI. |
| `Sign Up modern.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `about.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `backend/BACKUP_OPERATIONS.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/OUTBOX_OPERATIONS.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/README.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/VERCEL_DEPLOYMENT.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/compose.yaml` | ملف إعداد تشغيلي/CI؛ تغيير القيم هنا يؤثر على الأتمتة وليس منطق المتجر مباشرة. |
| `backend/eslint.config.js` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/migrations/0001_platform_foundation.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0002_identity_auth.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0003_catalog_inventory.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0004_catalog_assets.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0005_cart_orders.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0006_site_settings.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0007_dashboard_domain_state.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0008_customer_interactions.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0009_representative_tracking.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0010_inventory_return_link.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0011_customer_admin_permissions.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0012_return_admin_permissions.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0013_customer_cart_sync.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0013_customer_preferences.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0013_dashboard_domain_permissions.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0013_representative_manage_permission.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0013_staff_onboarding.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0014_cart_price_review.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0014_damage_manage_permission.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0015_inventory_cost_snapshot.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0015_platform_reset_permission.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0016_guest_cart_ownership.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0017_order_delivery_cost_snapshot.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0018_relational_business_domains.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0019_relational_domains_authoritative.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0020_return_damage_typed_core.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0021_action_permissions.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0022_staff_whatsapp_delivery.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0023_staff_mfa_pending_setup.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0024_staff_google_identity.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0025_staff_simple_email_access.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/migrations/0026_remove_retired_staff_google_identity.sql` | Migration لقاعدة PostgreSQL؛ يغيّر الـschema بترتيب ثابت ولا يُعدّل بعد تطبيقه في بيئة حقيقية. |
| `backend/openapi.yaml` | ملف إعداد تشغيلي/CI؛ تغيير القيم هنا يؤثر على الأتمتة وليس منطق المتجر مباشرة. |
| `backend/package-lock.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/package.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/scripts/check-env.ts` | أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح. |
| `backend/scripts/check-vercel-config.mjs` | أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح. |
| `backend/scripts/database-backup.mjs` | أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح. |
| `backend/scripts/vercel-ignore-backend.sh` | أداة تشغيل/صيانة للـBackend؛ تُستخدم من npm scripts أو CI ولا تعمل داخل المتصفح. |
| `backend/src/app.ts` | إنشاء Runtime وربط الخدمات وقاعدة البيانات بالتطبيق، مع fallback آمن عند سوء الإعداد. |
| `backend/src/application.ts` | تجميع تطبيق Express: الأمان وCORS والـrate limits والـrouters ومعالجة الأخطاء. |
| `backend/src/config/env.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/config/logger.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/config/runtime.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/database/migrate.ts` | طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات. |
| `backend/src/database/pool.ts` | طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات. |
| `backend/src/database/seed.ts` | طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات. |
| `backend/src/database/seeds/development.ts` | طبقة PostgreSQL: اتصال أو migration أو seed؛ الخادم هو مصدر الحقيقة للبيانات. |
| `backend/src/http/app-error.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/middleware/authentication.ts` | Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes. |
| `backend/src/middleware/error-handler.ts` | Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes. |
| `backend/src/middleware/not-found.ts` | Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes. |
| `backend/src/middleware/request-context.ts` | Middleware مركزي يطبّق قاعدة مشتركة على طلبات HTTP قبل وصولها للـroutes. |
| `backend/src/modules/catalog/catalog.asset.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/catalog/catalog.asset.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/catalog/catalog.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/catalog/catalog.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/commerce/commerce.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/commerce/commerce.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/commerce/customer-interaction.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/commerce/customer-interaction.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/dashboard/dashboard-state.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/dashboard/dashboard-state.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/dashboard/relational-domain.store.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/modules/finance/finance.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/finance/finance.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/health/health.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/identity/identity.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/identity/identity.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/identity/identity.types.ts` | تعريف أنواع TypeScript والعقود المشتركة بين أجزاء الـBackend. |
| `backend/src/modules/identity/staff-management.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/identity/staff-onboarding.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/outbox/email-provider.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/modules/outbox/email-templates.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/src/modules/outbox/outbox.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/outbox/outbox.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/platform/platform-admin.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/platform/platform-admin.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/modules/settings/site-settings.routes.ts` | تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService. |
| `backend/src/modules/settings/site-settings.service.ts` | منطق أعمال خادمي؛ ينفذ القواعد ويقرأ/يكتب PostgreSQL بدل الثقة في المتصفح. |
| `backend/src/security/crypto.ts` | وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة. |
| `backend/src/security/normalization.ts` | وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة. |
| `backend/src/security/password.ts` | وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة. |
| `backend/src/security/session-token.ts` | وظائف أمنية مشتركة للمصادقة أو التطبيع أو حماية الجلسات والبيانات الحساسة. |
| `backend/src/server.ts` | تشغيل HTTP server وإدارة الإغلاق الآمن واتصال PostgreSQL. |
| `backend/src/types/express.d.ts` | تعريف أنواع TypeScript والعقود المشتركة بين أجزاء الـBackend. |
| `backend/tests/backup-operations.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/browser-polling.contract.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/catalog-cost-snapshot.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/catalog-integrity.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/commerce-integrity.contract.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/commerce.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/config.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/dashboard-state.routes.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/database.integration.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/email-provider.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/finance.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/health.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/identity.integration.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/identity.routes.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/migration-naming.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/migrations.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/outbox.integration.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/outbox.service.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/permissions.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/production-event-delivery.contract.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/relational-domain.contract.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/representative-image-security.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/return-policy.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/runtime-bootstrap.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/runtime.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/security.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/seed.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tests/staff-email-access.integration.test.ts` | اختبار آلي للـBackend يحمي سلوكًا مهمًا من الرجوع أو الكسر. |
| `backend/tsconfig.build.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/tsconfig.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/vercel.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `backend/vitest.config.ts` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `cart-checkout.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `docs/API_CONTRACT.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/CHANGELOG.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/CODE_MAP.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/DEPLOYMENT_BATCHING.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/IMAGE_DESCRIPTIONS.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/MAINTENANCE_REPORT_V12.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/PROJECT_STRUCTURE.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/README.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `docs/VERIFICATION_REPORT.md` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `form-return.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `index.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `manifest.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `policies.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `products.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `profile.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `rep.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `robots.txt` | تعليمات لمحركات البحث حول مسارات الموقع التي يمكن زحفها. |
| `scripts/add-arabic-code-comments.mjs` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |
| `scripts/vercel-ignore-frontend.sh` | سكريبت Shell مساعد للتشغيل أو النشر. |
| `search-serial.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `sections/Nav-Bar.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/birthday-details.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/birthday.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/card.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/dart-for-you.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/footer.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/form-contact.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/form-feedback.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/leaderboard-card.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/story.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sections/why-dart.html` | جزء HTML قابل لإعادة الاستخدام ويتم حقنه داخل صفحات الموقع. |
| `sitemap.xml` | خريطة صفحات الموقع لمحركات البحث. |
| `sw.js` | Service Worker للموقع؛ يدير التخزين المؤقت وسلوك الشبكة دون أن يصبح مصدر بيانات تجاري. |
| `tests/address-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/auth-contract.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/catalog-browser.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/catalog-pricing-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/css-architecture.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/dart-finance-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/dashboard-v9-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/database-authoritative-storage.cjs` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/finance-dashboard-contract.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/full-site-browser.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/performance-budget.cjs` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/platform-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/rep-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/returns-accounting-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/security-boundaries.cjs` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/seo_checks.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/server-authority-contract.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/settings-and-groups-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/settings-reset-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/static_checks.py` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/tracking-unit.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/v8-features-browser.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `tests/v9-requested-features.js` | اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع. |
| `track.html` | صفحة HTML تشغيلية؛ الهيكل ثابت والمنطق الديناميكي موجود في ملفات JavaScript المرتبطة. |
| `vercel.json` | ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله. |

تم توليد هذا الدليل بواسطة `scripts/add-arabic-code-comments.mjs`.
