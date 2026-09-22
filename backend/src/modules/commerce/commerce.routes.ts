// DART CODE GUIDE | backend/src/modules/commerce/commerce.routes.ts
// الغرض: تعريف HTTP routes: يتحقق من الإدخال والصلاحيات ثم يمرر العمل إلى الـService.
import { createHmac, randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AppConfig } from "../../config/env.js";
import {
  authenticate,
  csrfProtection,
  requireAccountType,
  requireMfa,
  requirePermission,
  requireAnyPermission,
  requireActionPermission,
} from "../../middleware/authentication.js";
import type { IdentityService } from "../identity/identity.service.js";
import type { CommerceService } from "./commerce.service.js";
import type { OutboxService } from "../outbox/outbox.service.js";

const reservationId = z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9_-]+$/);

const cartLineSchema = z.object({
  modelId: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(120),
  size: z.string().trim().min(1).max(120),
  quantity: z.number().int().min(1).max(20),
});

const reserveSchema = z.object({
  reservationId,
  lines: z.array(cartLineSchema).min(1).max(20),
}).superRefine((value, context) => {
  const total = value.lines.reduce((sum, line) => sum + line.quantity, 0);
  if (total > 20) {
    context.addIssue({
      code: "custom",
      path: ["lines"],
      message: "A cart can reserve at most 20 physical items",
    });
  }
});

const adminOrderStateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  orders: z.array(z.record(z.string(), z.unknown())).max(10000),
});

const savedAddressSchema = z.object({
  address: z.string().trim().min(1).max(600),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  governorate: z.enum(["Cairo", "Giza"]),
  country: z.string().trim().max(120).optional(),
  area: z.string().trim().max(160).optional(),
  street: z.string().trim().max(200).optional(),
  building: z.string().trim().max(120).optional(),
  floor: z.string().trim().max(80).optional(),
});

const checkoutSchema = z.object({
  reservationId,
  contact: z.object({
    name: z.string().trim().min(2).max(160),
    phone1: z.string().trim().min(7).max(40),
    phone2: z.string().trim().max(40).optional(),
    email: z.string().trim().email().max(320),
  }),
  address: z.object({
    country: z.string().trim().min(2).max(120),
    governorate: z.enum(["Cairo", "Giza"]),
    area: z.string().trim().min(1).max(160),
    street: z.string().trim().min(1).max(200),
    building: z.string().trim().min(1).max(120),
    floor: z.string().trim().min(1).max(80),
    latitude: z.coerce.number().finite().min(-90).max(90).transform(String),
    longitude: z.coerce.number().finite().min(-180).max(180).transform(String),
    fullAddress: z.string().trim().max(600).optional(),
    addressSource: z.enum(["map", "manual"]),
  }),
  deliveryNotes: z.string().trim().max(1000).optional(),
  promotionCode: z.string().trim().min(1).max(120).optional(),
  acceptPriceChanges: z.boolean().optional(),
});

const GUEST_CART_COOKIE = "dart_guest_cart";

function guestCartOwnerHash(
  request: Request,
  response: Response,
  config: Pick<AppConfig, "authPepper" | "nodeEnv">,
  createIfMissing: boolean,
): string | null {
  let token =
    typeof request.cookies?.[GUEST_CART_COOKIE] === "string"
      ? String(request.cookies[GUEST_CART_COOKIE])
      : "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    if (!createIfMissing) return null;
    token = randomUUID();
    response.cookie(GUEST_CART_COOKIE, token, {
      httpOnly: true,
      secure: config.nodeEnv === "production",
      sameSite: "lax",
      path: "/api/v1",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  }
  return createHmac("sha256", config.authPepper)
    .update(`guest-cart:${token}`)
    .digest("hex");
}

export function createCommerceRouter(
  commerce: CommerceService,
  identity: IdentityService,
  config: Pick<AppConfig, "sessionCookieName" | "authPepper" | "nodeEnv">,
  outbox?: OutboxService,
): Router {
  const router = Router();
  const signedIn = authenticate(identity, config);
  const csrf = csrfProtection(config);

  router.get("/leaderboard", async (_request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(await commerce.publicLeaderboard());
  });

  router.get(
    "/me/promotions/validate",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      const code = z.string().trim().min(1).max(120).parse(request.query.code);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(
        await commerce.validatePromotionCode(request.auth!.userId, code),
      );
    },
  );

  router.put(
    "/me/preferences/address",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const address = savedAddressSchema.parse(request.body);
      response.status(200).json({
        savedAddress: await commerce.saveCustomerAddress(
          request.auth!.userId,
          address,
          String(request.id),
        ),
      });
    },
  );

  router.delete(
    "/me/preferences/address",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      await commerce.saveCustomerAddress(
        request.auth!.userId,
        null,
        String(request.id),
      );
      response.status(204).end();
    },
  );

  router.get(
    "/me/cart",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.customerCart(request.auth!.userId));
    },
  );

  router.put(
    "/me/cart/reservation",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = reserveSchema.parse(request.body);
      const result = await commerce.reserveCart(
        body.reservationId,
        body.lines,
        request.auth!.userId,
        guestCartOwnerHash(request, response, config, true) ?? undefined,
      );
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(result);
    },
  );

  router.delete(
    "/me/cart/reservation",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      await commerce.releaseCustomerCart(request.auth!.userId);
      response.status(204).end();
    },
  );

  router.put("/cart/reservation", rateLimit({ windowMs: 600000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false }), async (request, response) => {
    const body = reserveSchema.parse(request.body);
    const ownerHash = guestCartOwnerHash(request, response, config, true);
    if (!ownerHash) {
      throw new Error("Unable to establish guest cart ownership");
    }
    const result = await commerce.reserveCart(
      body.reservationId,
      body.lines,
      undefined,
      ownerHash,
    );
    response.setHeader("Cache-Control", "no-store");
    response.status(200).json(result);
  });

  router.get(
    "/cart/reservation/:reservationId",
    rateLimit({ windowMs: 600000, limit: 80, standardHeaders: "draft-8", legacyHeaders: false }),
    async (request, response) => {
      const id = reservationId.parse(request.params.reservationId);
      const ownerHash = guestCartOwnerHash(request, response, config, true);
      if (!ownerHash) {
        response.status(200).json({ cart: null });
        return;
      }
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.guestCart(id, ownerHash));
    },
  );

  router.delete("/cart/reservation/:reservationId", rateLimit({ windowMs: 600000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false }), async (request, response) => {
    const id = reservationId.parse(request.params.reservationId);
    const ownerHash = guestCartOwnerHash(request, response, config, false);
    if (ownerHash) await commerce.releaseCart(id, ownerHash);
    response.status(204).end();
  });

  router.post(
    "/admin/orders/:orderRef/state",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireActionPermission("action", {
      archive: ["orders.manage", "orders.archive"],
      restore: ["orders.manage", "orders.archive"],
      delete: ["orders.manage", "orders.delete"],
    }),
    async (request, response) => {
      const orderRef = z.string().trim().min(1).max(160).parse(request.params.orderRef);
      const body = z.object({
        action: z.enum(["archive", "restore", "delete"]),
      }).parse(request.body);
      response.status(200).json(
        await commerce.adminOrderStateAction(
          request.auth!.userId,
          orderRef,
          body.action,
          String(request.id),
        ),
      );
    },
  );

  router.post(
    "/admin/returns/manual",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("returns.manage", "returns.create_manual"),
    async (request, response) => {
      const body = z.object({
        existingReturnId: z.string().trim().min(1).max(120).optional(),
        itemCode: z.string().trim().min(1).max(120),
        reason: z.string().trim().min(1).max(500),
        condition: z.enum(["Good", "Bad"]),
        refundAmount: z.number().min(0).max(10_000_000),
        clientName: z.string().trim().max(160).optional(),
        phone1: z.string().trim().max(40).optional(),
        phone2: z.string().trim().max(40).optional(),
        email: z.string().trim().email().max(320).optional(),
      }).parse(request.body);
      response.status(200).json({
        return: await commerce.adminManualReturn(
          request.auth!.userId,
          body,
          String(request.id),
        ),
      });
    },
  );

  router.post(
    "/admin/returns/:returnRef/action",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireActionPermission("action", {
      approve: ["returns.manage", "returns.review"],
      reject: ["returns.manage", "returns.review"],
      assign: ["returns.manage", "returns.assign"],
      inspect: ["returns.manage", "returns.inspect"],
      back: ["returns.manage"],
    }),
    async (request, response) => {
      const returnRef = z.string().trim().min(2).max(120).parse(request.params.returnRef);
      const body = z.object({
        action: z.enum(["approve", "reject", "assign", "inspect", "back"]),
        replacementItemCode: z.string().trim().min(1).max(120).optional(),
        reason: z.string().trim().min(3).max(500).optional(),
        representativeId: z.string().trim().min(1).max(120).optional(),
        condition: z.enum(["Good", "Damaged"]).optional(),
      }).parse(request.body);
      response.status(200).json({
        return: await commerce.adminReturnAction(
          request.auth!.userId,
          returnRef,
          body,
          String(request.id),
        ),
      });
    },
  );

  router.post(
    "/admin/orders",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("orders.manage", "orders.create"),
    async (request, response) => {
      const body = z.object({
        clientId: z.string().trim().max(120).optional(),
        clientName: z.string().trim().min(2).max(160),
        phone1: z.string().trim().min(7).max(40),
        phone2: z.string().trim().max(40).optional(),
        email: z.string().trim().max(320).optional(),
        paymentMethod: z.string().trim().min(1).max(80).optional(),
        paymentStatus: z.enum(["Unpaid","Partially Paid","Paid","Refunded","Partially Refunded","Void"]).optional(),
        amountPaid: z.number().min(0).optional(),
        amountRefunded: z.number().min(0).optional(),
        orderSource: z.string().trim().max(80).optional(),
        deliveryNotes: z.string().trim().max(1000).optional(),
        itemCodes: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
        discountPercent: z.number().min(0).max(100).optional(),
        country: z.string().trim().max(120).optional(),
        governorate: z.string().trim().max(120).optional(),
        area: z.string().trim().max(160).optional(),
        street: z.string().trim().max(200).optional(),
        building: z.string().trim().max(120).optional(),
        floor: z.string().trim().max(80).optional(),
        latitude: z.string().trim().max(80).optional(),
        longitude: z.string().trim().max(80).optional(),
        fullAddress: z.string().trim().max(600).optional(),
      }).parse(request.body);
      response.status(201).json(
        await commerce.createAdminOrder(
          request.auth!.userId,
          body,
          String(request.id),
        ),
      );
    },
  );

  router.patch(
    "/admin/orders/:orderRef",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("orders.manage", "orders.edit"),
    async (request, response) => {
      const orderRef = z.string().trim().min(1).max(120).parse(request.params.orderRef);
      const body = z.object({
        clientId: z.string().trim().max(120).optional(),
        clientName: z.string().trim().min(2).max(160),
        phone1: z.string().trim().min(7).max(40),
        phone2: z.string().trim().max(40).optional(),
        email: z.string().trim().max(320).optional(),
        paymentMethod: z.string().trim().min(1).max(80).optional(),
        paymentStatus: z.enum(["Unpaid","Partially Paid","Paid","Refunded","Partially Refunded","Void"]).optional(),
        amountPaid: z.number().min(0).optional(),
        amountRefunded: z.number().min(0).optional(),
        orderSource: z.string().trim().max(80).optional(),
        deliveryNotes: z.string().trim().max(1000).optional(),
        itemCodes: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
        discountPercent: z.number().min(0).max(100).optional(),
        country: z.string().trim().max(120).optional(),
        governorate: z.string().trim().max(120).optional(),
        area: z.string().trim().max(160).optional(),
        street: z.string().trim().max(200).optional(),
        building: z.string().trim().max(120).optional(),
        floor: z.string().trim().max(80).optional(),
        latitude: z.string().trim().max(80).optional(),
        longitude: z.string().trim().max(80).optional(),
        fullAddress: z.string().trim().max(600).optional(),
      }).parse(request.body);
      response.status(200).json(
        await commerce.updateAdminOrder(
          request.auth!.userId,
          orderRef,
          body,
          String(request.id),
        ),
      );
    },
  );

  router.get(
    "/admin/orders-version",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("orders.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ version: await commerce.adminOrdersVersion() });
    },
  );

  router.get(
    "/admin/orders-state",
    signedIn,
    requireAccountType("staff"),
    requireMfa,
    requirePermission("orders.read"),
    async (_request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.adminOrders());
    },
  );

  router.put(
    "/admin/orders-state",
    signedIn,
    csrf,
    requireAccountType("staff"),
    requireMfa,
    requireAnyPermission("orders.manage", "orders.bulk_manage"),
    async (request, response) => {
      const body = adminOrderStateSchema.parse(request.body);
      response.status(200).json(
        await commerce.replaceAdminOrders(
          body.expectedVersion,
          body.orders,
          request.auth!.userId,
          String(request.id),
        ),
      );
    },
  );

  router.get(
    "/me/commerce",
    signedIn,
    requireAccountType("customer"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.customerSnapshot(request.auth!.userId));
    },
  );

  router.get(
    "/representatives/work",
    signedIn,
    requireAccountType("representative"),
    async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(await commerce.representativeWork(request.auth!.userId));
    },
  );

  router.put(
    "/representatives/location",
    rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }),
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const body = z.object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracyMeters: z.number().min(0).max(5000).nullable().optional(),
      }).parse(request.body);
      response.status(200).json(
        await commerce.updateRepresentativeLocation(
          request.auth!.userId,
          body.latitude,
          body.longitude,
          body.accuracyMeters ?? null,
        ),
      );
    },
  );

  router.post(
    "/representatives/orders/:orderCode/action",
    rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }),
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const orderCode = z.string().trim().min(2).max(120).parse(request.params.orderCode);
      const body = z.object({
        action: z.enum(["start", "cancel", "delivered"]),
      }).parse(request.body);
      const order = await commerce.representativeOrderAction(
          request.auth!.userId,
          orderCode,
          body.action,
        );
      await outbox?.processBatch(10).catch(() => undefined);
      response.status(200).json({ order });
    },
  );

  router.post(
    "/representatives/returns/:returnRef/action",
    rateLimit({ windowMs: 60000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false }),
    signedIn,
    csrf,
    requireAccountType("representative"),
    async (request, response) => {
      const returnRef = z.string().trim().min(2).max(120).parse(request.params.returnRef);
      const body = z.object({
        action: z.enum(["start", "cancel", "complete"]),
      }).parse(request.body);
      const result = await commerce.representativeReturnAction(
          request.auth!.userId,
          returnRef,
          body.action,
        );
      await outbox?.processBatch(10).catch(() => undefined);
      response.status(200).json({ return: result });
    },
  );

  router.post(
    "/orders",
    signedIn,
    csrf,
    requireAccountType("customer"),
    async (request, response) => {
      const body = checkoutSchema.parse(request.body);
      const idempotencyKey = z.string()
        .trim()
        .min(16)
        .max(128)
        .regex(/^[A-Za-z0-9:_-]+$/)
        .parse(request.get("Idempotency-Key"));
      const result = await commerce.checkout(
        request.auth!.userId,
        body,
        String(request.id),
        guestCartOwnerHash(request, response, config, false) ?? undefined,
        idempotencyKey,
      );
      await outbox?.processBatch(10).catch(() => undefined);
      response.status(201).json({ order: result });
    },
  );

  return router;
}
