// DART CODE GUIDE | backend/src/http/app-error.ts
// الغرض: ملف مساعد ضمن مشروع Dart؛ راجع المسار والمستوردين قبل تعديله.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}
