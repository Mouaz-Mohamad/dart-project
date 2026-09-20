import type { AuthenticatedAccount } from "../modules/identity/identity.types.js";

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedAccount;
    }
  }
}

export {};
