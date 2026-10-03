// DART CODE GUIDE | backend/src/modules/sets/set-waiting.routes.ts
// Customer/staff HTTP routes for whole-Set Waiting.
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,csrfProtection,requireAccountType,requireMfa,requirePermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { SetWaitingService } from "./set-waiting.service.js";

const idSchema=z.string().uuid();
const selectionSchema=z.object({
  modelId:z.string().trim().min(1).max(120),
  color:z.string().trim().min(1).max(120),
  size:z.string().trim().min(1).max(120),
});
const joinSchema=z.object({
  setId:z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  selections:z.array(selectionSchema).min(1).max(100),
});

export function createSetWaitingRouter(
  waiting:SetWaitingService,
  identity:IdentityService,
  config:Pick<AppConfig,"sessionCookieName"|"authPepper">,
):Router {
  const router=Router();
  const signedIn=authenticate(identity,config);
  const csrf=csrfProtection(config);
  const writeLimit=rateLimit({windowMs:10*60_000,limit:30,standardHeaders:"draft-8",legacyHeaders:false});

  router.get("/me/sets/waiting",signedIn,requireAccountType("customer"),async(request,response)=>{
    response.setHeader("Cache-Control","no-store");
    response.status(200).json(await waiting.mine(request.auth!.userId));
  });
  router.post("/me/sets/waiting",writeLimit,signedIn,csrf,requireAccountType("customer"),async(request,response)=>{
    const body=joinSchema.parse(request.body);
    response.status(201).json({entry:await waiting.join(request.auth!.userId,body,String(request.id))});
  });
  router.delete("/me/sets/waiting/:entryId",signedIn,csrf,requireAccountType("customer"),async(request,response)=>{
    response.status(200).json({entry:await waiting.cancelMine(request.auth!.userId,idSchema.parse(request.params.entryId),String(request.id))});
  });
  router.post("/me/sets/waiting/:entryId/confirm",writeLimit,signedIn,csrf,requireAccountType("customer"),async(request,response)=>{
    response.status(200).json({entry:await waiting.confirmMine(request.auth!.userId,idSchema.parse(request.params.entryId),String(request.id))});
  });
  router.post("/admin/sets/waiting/reconcile",writeLimit,signedIn,csrf,requireAccountType("staff"),requireMfa,requirePermission("sets.manage"),async(request,response)=>{
    response.status(200).json(await waiting.reconcile(request.auth!.userId,String(request.id)));
  });
  return router;
}
