// DART CODE GUIDE | backend/src/modules/identity/identity.types.ts
// الغرض: تعريف أنواع TypeScript والعقود المشتركة بين أجزاء الـBackend.
export type AccountType = "customer" | "staff" | "representative";

export interface AuthenticatedAccount {
  userId: string;
  accountType: AccountType;
  status: string;
  email: string;
  emailVerified: boolean;
  mustChangePassword: boolean;
  sessionId: string;
  sessionFamilyId: string;
  csrfTokenHash: string;
  mfaRequired: boolean;
  mfaSatisfied: boolean;
  permissions: string[];
}

export interface IssuedSession {
  account: AuthenticatedAccount;
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface RequestMetadata {
  requestId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}
