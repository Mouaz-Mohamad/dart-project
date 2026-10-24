# Dart documentation

هذه هي خريطة التوثيق الحالية المعتمدة. أي تقرير مراجعة مؤقت أو Verification report قديم لا يُستخدم كمرجع تشغيلي بعد الآن.

## العقود الحالية

- `backend/openapi.yaml` — HTTP contract للأجزاء الحساسة والمعلنة: Auth, Orders, Settings, Promotions, Dart Card, internal jobs.
- `API_CONTRACT.md` — invariants والقواعد التي يجب أن تبقى server-authoritative.
- `CODE_MAP.md` — أماكن تنفيذ الأنظمة الأساسية داخل الكود.
- `PROJECT_STRUCTURE.md` — شكل المشروع.
- `CODE_GUIDE_AR.md` — دليل قراءة وصيانة الكود.
- `../src/README.md` — مصادر المتصفح القابلة للتعديل، ملفات التشغيل المولدة وترتيب بنائها.
- `CSS_CLEANUP_2026-10-23_AR.md` — تنظيف القيم الملغاة في CSS، حفظ الشكل، سجل الحذف وطرق التحقق.
- `CODE_CLEANUP_2026-10-23_AR.md` — نطاق التنظيف والمحافظة على السلوك ودليل التحقق.
- `CHANGELOG.md` — سجل التغييرات التاريخي.
- `DEPLOYMENT_BATCHING.md` — قواعد batching فقط؛ النشر نفسه إجراء منفصل ولا يحدث لمجرد وجود كود جديد.
- `ORDER_PERFORMANCE.md` — compact order responses, safe related refresh, isolated measurements and bounded load commands.
- `FINANCE_NAVIGATION_PERFORMANCE.md` — archived expenses, combined finance snapshots, visible rendering, public preloading and native page restoration.
- `CATALOG_SCALE.md` — paged catalog reads, changed-record writes, shared limits, bounded worker and rollout checks.
- `SCALE_QUALITY_2026-10-13_AR.md` — verification evidence and outstanding production readiness gates for the unpublished scale batch.
- `NEWS.md` — News behavior, API/migration references, end-to-end checks and quality review.
- `DASHBOARD_STATUS_COLORS.md` — shared status palette, row coverage and browser verification.
- `TRAFFIC_ANALYTICS.md` — stable visit-N guest codes, identity persistence, shared chart periods and verification.
- `IMAGE_DESCRIPTIONS.md` — وصف الأصول البصرية.

## Rewards / Discounts authority

Birthday, Promotions وDart Card لا تعتمد على LocalStorage أو ظهور الـUI لاتخاذ القرار. PostgreSQL والـBackend هما مصدر الحقيقة، مع Transactions/Audit/Usage ledgers.

المسارات الجديدة الأساسية موثقة في `API_CONTRACT.md` و`backend/README.md`. طبقة الـDB الخاصة بها هي migration set متكامل: `0034`, `0035`, `0036`, `0037`.

## قاعدة التحديث

عند تغيير Route أو Schema أو Business invariant:

1. عدّل الكود والـZod/DB constraint أولًا.
2. حدّث `backend/openapi.yaml` و`API_CONTRACT.md` في نفس الـbatch.
3. أضف/حدّث Regression test يمنع رجوع العقد القديم.
4. لا تعتبر أي Migration مطبقة Production لمجرد أنها موجودة على GitHub.
