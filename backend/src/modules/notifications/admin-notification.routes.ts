// DART CODE GUIDE | backend/src/modules/notifications/admin-notification.routes.ts
// Separate staff session, central permission checks, CSRF and bounded mutations.
import { AppError } from "../../http/app-error.js";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { authenticate, csrfProtection, requireAccountType, requireMfa, requirePermission } from "../../middleware/authentication.js";
import { sharedRateLimitStore } from "../../security/shared-rate-limit.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { AdminNotificationService } from "./admin-notification.service.js";
import { pushSubscriptionSchema } from "./push-validation.js";
export function createAdminNotificationRouter(service: AdminNotificationService, identity: IdentityService, config: Pick<AppConfig,"sessionCookieName"|"authPepper">) {
  const router = Router();
  const gates = [authenticate(identity,config),requireAccountType("staff"),requireMfa,requirePermission("notifications.read")];
  const mutate = [csrfProtection(config),rateLimit({store:sharedRateLimitStore(config,"admin-notifications"),windowMs:60_000,limit:40,standardHeaders:"draft-8",legacyHeaders:false})];
  router.get("/admin/notifications",...gates,async(req,res)=>{
    const query=z.object({limit:z.coerce.number().int().min(1).max(50).default(25),cursor:z.string().max(300).optional()}).strict().parse(req.query);
    res.json(await service.list(req.auth!.userId,req.auth!.permissions,query.limit,query.cursor));
  });
  router.get("/admin/notifications/:id",...gates,async(req,res)=>{
    const page=await service.list(req.auth!.userId,req.auth!.permissions,1,undefined,z.string().uuid().parse(req.params.id));
    if(!page.notifications[0])throw new AppError(404,"NOT_FOUND","Notification not found");
    res.json({notification:page.notifications[0]});
  });
  router.post("/admin/notifications/read",...gates,...mutate,async(req,res)=>{
    const body=z.object({ids:z.array(z.string().uuid()).min(1).max(100)}).strict().parse(req.body);
    res.json(await service.markRead(req.auth!.userId,req.auth!.permissions,body.ids));
  });
  router.get("/admin/push/config",...gates,(_req,res)=>{res.json(service.push.pushConfig());});
  router.get("/admin/push/subscriptions",...gates,async(req,res)=>{res.json(await service.push.subscriptions(req.auth!.userId,req.auth!.sessionId));});
  router.post("/admin/push/subscriptions",...gates,...mutate,async(req,res)=>{
    const body=z.object({subscription:pushSubscriptionSchema,publicKey:z.string().max(100)}).strict().parse(req.body);
    res.json(await service.push.subscribe(req.auth!.userId,req.auth!.sessionId,body.subscription,body.publicKey,String(req.id)));
  });
  router.delete("/admin/push/subscriptions/:id",...gates,...mutate,async(req,res)=>{
    await service.push.unsubscribe(req.auth!.userId,z.string().uuid().parse(req.params.id),String(req.id));res.sendStatus(204);
  });
  return router;
}
