// Customer passwordless routes are separate from Staff and Courier authentication.
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { authenticate, csrfProtection, requireAccountType } from "../../middleware/authentication.js";
import { sharedRateLimitStore } from "../../security/shared-rate-limit.js";
import { dispatchOutbox } from "../outbox/outbox.dispatch.js";
import type { OutboxService } from "../outbox/outbox.service.js";
import type { IdentityService } from "./identity.service.js";
import type { IssuedSession, RequestMetadata } from "./identity.types.js";
import type { CustomerEmailAuthService } from "./customer-email-auth.service.js";
import type { CustomerPasskeyService } from "./customer-passkeys.service.js";

const code=z.string().regex(/^\d{6}$/);
const challengeId=z.uuid();
const credential=z.record(z.string(),z.unknown());
const identifier=z.string().trim().min(3).max(254);
const signup=z.object({
  name:z.string().trim().min(3).max(120),
  email:z.email().max(254),
  phone1:z.string().trim().min(10).max(25),
  birthday:z.iso.date(),
});
function requestMeta(request:Request):RequestMetadata {
  return {requestId:String(request.id),
    ...(request.ip?{ipAddress:request.ip}:{}),
    ...(request.get("user-agent")?{userAgent:request.get("user-agent")}:{}),
  };
}
function originOf(request:Request):string {
  // Never trust X-Forwarded-Host for the cryptographic Relying Party.
  return request.get("origin") || "";
}
function issueCookies(response:Response,config:Pick<AppConfig,"nodeEnv"|"sessionCookieName"|"sessionCookieSameSite">,session:IssuedSession) {
  const secure=config.nodeEnv==="production"||config.sessionCookieSameSite==="none";
  response.cookie(config.sessionCookieName,session.sessionToken,{
    httpOnly:true,secure,sameSite:config.sessionCookieSameSite,path:"/api/v1",expires:session.expiresAt,
  });
  response.cookie("dart_csrf",session.csrfToken,{
    httpOnly:false,secure,sameSite:config.sessionCookieSameSite,path:"/",expires:session.expiresAt,
  });
}
export function createCustomerPasswordlessRouter(
  identity:IdentityService,
  emailAuth:CustomerEmailAuthService,
  passkeys:CustomerPasskeyService,
  config:AppConfig,
  outbox?:OutboxService,
):Router{
  const router=Router();
  const limit=rateLimit({
    store:sharedRateLimitStore(config,"customer-passwordless"),
    windowMs:15*60_000,limit:20,standardHeaders:"draft-8",legacyHeaders:false,
    handler(_request,response){response.status(429).json({
      error:{code:"AUTH_RATE_LIMITED",message:"Too many attempts. Try again later."},
    });},
  });
  const signedIn=authenticate(identity,config);
  const csrf=csrfProtection(config);
  router.use("/auth",limit);
  router.post("/auth/login",async(request,response)=>{
    const body=z.object({identifier}).parse(request.body);
    if(!outbox?.configured("email"))return response.status(503).json({error:{code:"EMAIL_UNAVAILABLE",message:"Email authentication is temporarily unavailable"}}); 
    const result=await emailAuth.startLogin(body.identifier);
    if(result.sent)await dispatchOutbox(outbox,1,"customer-email-login:"+result.challengeId);
    response.status(202).json({challengeId:result.challengeId,expiresAt:result.expiresAt,
      ...(result.emailDisplay?{email:result.emailDisplay}:{}),
      message:"If this account has a verified email, a code was sent to that address.",
    });
  });
  router.post("/auth/login/verify",async(request,response)=>{
    const body=z.object({challengeId,code}).parse(request.body);
    const session=await emailAuth.verify(body.challengeId,body.code,"login",requestMeta(request));
    issueCookies(response,config,session);
    response.status(200).json({user:await identity.profile(session.account),csrfToken:session.csrfToken,passkeyEnrollmentAvailable:true});
  });
  router.post("/auth/register",async(request,response)=>{
    const body=signup.parse(request.body);
    if(!outbox?.configured("email"))return response.status(503).json({error:{code:"EMAIL_UNAVAILABLE",message:"Email authentication is temporarily unavailable"}});
    const result=await emailAuth.startSignup(body);
    if(result.sent)await dispatchOutbox(outbox,1,"customer-email-register:"+result.challengeId);
    response.status(202).json({challengeId:result.challengeId,expiresAt:result.expiresAt,email:body.email,message:"A verification code was sent to the email you entered."});
  });
  router.post("/auth/register/verify",async(request,response)=>{
    const body=z.object({challengeId,code}).parse(request.body);
    const session=await emailAuth.verify(body.challengeId,body.code,"register",requestMeta(request));
    issueCookies(response,config,session);
    response.status(201).json({user:await identity.profile(session.account),csrfToken:session.csrfToken,passkeyEnrollmentAvailable:true});
  });
  router.post("/auth/passkeys/register/options",signedIn,csrf,requireAccountType("customer"),async(request,response)=>{
    response.json(await passkeys.registrationOptions(request.auth!,originOf(request)));
  });
  router.post("/auth/passkeys/register/verify",signedIn,csrf,requireAccountType("customer"),async(request,response)=>{
    const body=z.object({challengeId,credential}).parse(request.body);
    response.status(201).json(await passkeys.register(request.auth!,body.challengeId,body.credential));
  });
  router.post("/auth/passkeys/authenticate/options",async(request,response)=>{
    response.json(await passkeys.authenticationOptions(originOf(request)));
  });
  router.post("/auth/passkeys/authenticate/verify",async(request,response)=>{
    const body=z.object({challengeId,credential}).parse(request.body);
    const session=await passkeys.authenticate(body.challengeId,body.credential,requestMeta(request));
    issueCookies(response,config,session);
    response.status(200).json({user:await identity.profile(session.account),csrfToken:session.csrfToken});
  });
  return router;
}
