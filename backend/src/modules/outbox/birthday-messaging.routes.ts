import { Router } from "express";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import { AppError } from "../../http/app-error.js";
import { authenticate, csrfProtection, requireAccountType, requireMfa, requirePermission } from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import { BIRTHDAY_CONSENT_VERSION, REVIEW_CONSENT_VERSION, type BirthdayMessagingService } from "./birthday-messaging.service.js";
import type { OutboxService } from "./outbox.service.js";
import { dispatchOutbox } from "./outbox.dispatch.js";
import { WHATSAPP_ANALYTICS_TYPES } from "./whatsapp-analytics.service.js";
export function createBirthdayMessagingRouter(service: BirthdayMessagingService, identity: IdentityService, config: Pick<AppConfig, "sessionCookieName" | "authPepper">, outbox: OutboxService): Router {
    const router = Router(), signedIn = authenticate(identity, config), csrf = csrfProtection(config);
    router.get("/me/preferences/whatsapp", signedIn, requireAccountType("customer"), async (req, res) => {
        res.json(await service.preference(req.auth!.userId));
    });
    router.put("/me/preferences/whatsapp", signedIn, csrf, requireAccountType("customer"), async (req, res) => {
        const body = z.object({ birthdayMarketing: z.boolean(), consentVersion: z.literal(BIRTHDAY_CONSENT_VERSION),
            postDeliveryReview: z.boolean().optional(), reviewConsentVersion: z.literal(REVIEW_CONSENT_VERSION).optional(),
        }).strict().refine(value => value.postDeliveryReview === undefined || value.reviewConsentVersion === REVIEW_CONSENT_VERSION,
            { message: 'Review consent version is required', path: ['reviewConsentVersion'] }).parse(req.body);
        await service.setPreference(req.auth!.userId, body.birthdayMarketing, String(req.id), body.postDeliveryReview);
        res.json(await service.preference(req.auth!.userId));
    });
    router.post("/admin/messaging/birthdays", signedIn, csrf, requireAccountType("staff"), requireMfa, requirePermission("messaging.manage"), async (req, res) => {
        const body = z.object({ customerRefs: z.array(z.string().trim().min(1).max(160)).min(1).max(100), birthdayDate: z.iso.date() }).strict().parse(req.body);
        if (!outbox.configured("whatsapp"))
            throw new AppError(503, "WHATSAPP_NOT_CONFIGURED", "Connect WhatsApp Business Platform before sending birthday messages");
        const result = await service.queue([...new Set(body.customerRefs)], body.birthdayDate, req.auth!.userId, String(req.id));
        await dispatchOutbox(outbox, 5);
        res.status(202).json(result);
    });
    router.get("/admin/messaging/whatsapp-analytics", signedIn, requireAccountType("staff"), requireMfa, requirePermission("messaging.read"), async (req, res) => {
        const params=z.object({
            period:z.enum(["today","month","all"]).default("month"),
            type:z.enum(["all",...WHATSAPP_ANALYTICS_TYPES]).optional(),
            status:z.enum(["all","delivered","read","pending","sent","failed","attention","suppressed"]).optional(),
            offset:z.coerce.number().int().min(0).max(5000).optional(),
            limit:z.coerce.number().int().min(1).max(50).optional(),
        }).strict().parse(req.query);
        res.setHeader("Cache-Control","private, no-store");
        res.json(await outbox.whatsappAnalytics(params));
    });
    router.get("/admin/messaging/delivery-health", signedIn, requireAccountType("staff"), requireMfa, requirePermission("messaging.read"), async (_req, res) => {
        res.json({ queue: await outbox.health(), events: await outbox.recentEvents(50) });
    });
    return router;
}
