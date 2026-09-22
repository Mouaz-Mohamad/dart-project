// DART CODE GUIDE | backend/src/config/runtime.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
export function shouldStartHttpListener(
  environment: { VERCEL?: string | undefined } = process.env,
): boolean {
  return environment.VERCEL !== "1";
}

export function shouldRunRuntimeMigrations(
  environment: {
    VERCEL?: string | undefined;
    DART_RUN_RUNTIME_MIGRATIONS?: string | undefined;
  } = process.env,
): boolean {
  // Serverless cold starts must never depend on migration files being present.
  // Production schema changes are applied explicitly with `npm run db:migrate`.
  return (
    environment.VERCEL !== "1" &&
    environment.DART_RUN_RUNTIME_MIGRATIONS === "1"
  );
}
