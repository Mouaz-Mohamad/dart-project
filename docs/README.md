# Dart documentation

هذه هي خريطة التوثيق الحالية المعتمدة. أي تقرير مراجعة مؤقت أو Verification report قديم لا يُستخدم كمرجع تشغيلي بعد الآن.

## العقود الحالية

- `backend/openapi.yaml` — HTTP contract للأجزاء الحساسة والمعلنة: Auth, Orders, Settings, Promotions, Dart Card, internal jobs.
- `API_CONTRACT.md` — invariants والقواعد التي يجب أن تبقى server-authoritative.
- `CODE_MAP.md` — أماكن تنفيذ الأنظمة الأساسية داخل الكود.
- `PROJECT_STRUCTURE.md` — شكل المشروع.
- `CODE_GUIDE_AR.md` — دليل قراءة وصيانة الكود.
- `CHANGELOG.md` — سجل التغييرات التاريخي.
- `DEPLOYMENT_BATCHING.md` — قواعد batching فقط؛ النشر نفسه إجراء منفصل ولا يحدث لمجرد وجود كود جديد.
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
