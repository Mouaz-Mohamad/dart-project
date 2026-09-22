// DART CODE GUIDE | backend/src/types/express.d.ts
// الغرض: تعريف أنواع TypeScript والعقود المشتركة بين أجزاء الـBackend.
import type { AuthenticatedAccount } from "../modules/identity/identity.types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedAccount;
    }
  }
}

export {};
