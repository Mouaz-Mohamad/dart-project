import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { IdentityService } from "../src/modules/identity/identity.service.js";
import { CustomerEmailAuthService } from "../src/modules/identity/customer-email-auth.service.js";
import { CustomerPasskeyService } from "../src/modules/identity/customer-passkeys.service.js";
import type { AuthenticatedAccount } from "../src/modules/identity/identity.types.js";

describe("customer passwordless protections",()=>{
  it("never creates a login challenge or session for an unknown identifier",async()=>{
    const pool={query:vi.fn().mockResolvedValue({rows:[]}),connect:vi.fn()};
    const identity={loginLinkedSocialCustomer:vi.fn()};
    const service=new CustomerEmailAuthService(pool as unknown as Pool,
      {authPepper:"test-pepper",mfaEncryptionKey:Buffer.alloc(32)},identity as unknown as IdentityService);
    const result=await service.startLogin("01012345678");
    expect(result.sent).toBe(false);
    expect(result.challengeId).toBeDefined();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(identity.loginLinkedSocialCustomer).not.toHaveBeenCalled();
  });

  it("prevents unverified sessions from registering biometric credentials",async()=>{
    const pool={query:vi.fn().mockResolvedValue({rows:[{allowed:false}]})};
    const passkeys=new CustomerPasskeyService(pool as unknown as Pool,{} as IdentityService,
      {corsOrigins:["https://www.dartofficial.com"]});
    const account={accountType:"customer",sessionId:"123e4567-e89b-12d3-a456-426614174000",userId:"123e4567-e89b-12d3-a456-426614174002"} as AuthenticatedAccount;
    await expect(passkeys.registrationOptions(account,"https://www.dartofficial.com"))
      .rejects.toMatchObject({code:"FRESH_EMAIL_VERIFICATION_REQUIRED"});
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it("rejects untrusted WebAuthn origins before a challenge can be created",async()=>{
    const pool={query:vi.fn()};
    const passkeys=new CustomerPasskeyService(pool as unknown as Pool,{} as IdentityService,
      {corsOrigins:["https://www.dartofficial.com"]});
    await expect(passkeys.authenticationOptions("https://fake-dart.example"))
      .rejects.toMatchObject({code:"PASSKEY_ORIGIN_NOT_ALLOWED"});
    expect(pool.query).not.toHaveBeenCalled();
  });
});
