// DART CODE GUIDE | backend/src/modules/settings/site-settings.schema.ts
// الغرض: Contract مركزي وصارم لكل Settings المعروفة؛ أي root key غير معروفة تُرفض.
import { z } from "zod";
import { EGYPT_GOVERNORATES, validTrackingPortal } from "../commerce/shipping.core.js";
import { validateCompanyCoverage } from "../commerce/shipping.coverage.js";

const mediaAsset = z.union([
  z.string().max(4000),
  z.record(z.string(), z.unknown()),
]).nullable();

const siteDiscount = z.object({
  enabled: z.boolean(),
  percent: z.number().finite().min(0).max(100),
  startsAt: z.union([z.literal(""), z.iso.date()]),
  endsAt: z.union([z.literal(""), z.iso.date()]),
}).strict();

const waiting = z.object({
  enabled: z.boolean(),
  reservationHours: z.number().finite().min(0.25).max(168),
  alternativeColorsEnabled: z.boolean(),
  emailNotificationEnabled: z.boolean(),
  inSiteNotificationEnabled: z.boolean(),
}).strict();

const typingWord = z.object({
  text: z.string().trim().min(1).max(120),
  color: z.string().trim().min(1).max(40),
  size: z.number().finite().min(10).max(120),
  weight: z.number().int().min(100).max(900),
}).strict();

const typingScene = z.object({
  hold: z.number().int().min(0).max(60_000),
  words: z.array(typingWord).min(1).max(20),
}).strict();

const typing = z.object({
  typingSpeed: z.number().int().min(1).max(10_000),
  deletingSpeed: z.number().int().min(1).max(10_000),
  wordDelay: z.number().int().min(0).max(60_000),
  nextSceneDelay: z.number().int().min(0).max(60_000),
  scenes: z.array(typingScene).min(1).max(100),
}).strict();

const codRisk = z.object({
  version: z.number().int().min(1).max(1_000_000),
  refusalWindowDays: z.number().int().min(1).max(3650),
  manualReviewRefusalCount: z.number().int().min(2).max(100),
  rapidRepeatWindowMinutes: z.number().int().min(1).max(10080),
  rapidRepeatOrderCount: z.number().int().min(2).max(100),
  highOrderValueMinor: z.number().int().min(0).max(100_000_000),
  restrictedOrderValueMinor: z.number().int().min(0).max(100_000_000),
  mediumScoreMin: z.number().int().min(1).max(98),
  highScoreMin: z.number().int().min(2).max(99),
  restrictedScoreMin: z.number().int().min(3).max(100),
  requireFirstOrderVerification: z.boolean(),
  requireUnverifiedPhoneVerification: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.restrictedOrderValueMinor < value.highOrderValueMinor) {
    context.addIssue({ code: "custom", path: ["restrictedOrderValueMinor"], message: "Restricted order value must be >= high order value" });
  }
  if (!(value.mediumScoreMin < value.highScoreMin && value.highScoreMin < value.restrictedScoreMin)) {
    context.addIssue({ code: "custom", path: ["mediumScoreMin"], message: "COD score thresholds must be strictly increasing" });
  }
});

export const blockedGovernoratesSchema = z.array(z.enum(EGYPT_GOVERNORATES)).max(27)
  .refine(value => new Set(value).size === value.length, "Governorates must be unique");

export const shippingCompanySchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]{2,64}$/),
    name: z.string().trim().min(2).max(100),
    trackingUrl: z.string().trim().min(1).max(2000),
    active: z.boolean(),
    checkoutEnabled: z.boolean().optional(),
    governorates: z.array(z.string().trim().min(2).max(100)).max(27),
    coverage: z.record(z.string(),z.object({
      all:z.boolean(),
      cities:z.record(z.string(),z.object({all:z.boolean(),
        areas:z.array(z.string().trim().min(1).max(100)).max(200)}).strict()),
    }).strict()).optional(),
  }).strict().superRefine((company, context) => {
  try {
    if (company.id === "dart") throw new Error("Dart is the internal carrier and cannot be overwritten.");
    validTrackingPortal(company.trackingUrl);
    validateCompanyCoverage(company);
    if (company.checkoutEnabled && !company.coverage) throw new Error("Choose structured coverage before enabling checkout.");
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid shipping coverage" });
  }
});

export const siteSettingsSchema = z.object({
  version: z.number().int().positive().optional(),
  heroDayImage: mediaAsset.optional(),
  heroNightImage: mediaAsset.optional(),
  founderImage: mediaAsset.optional(),
  defaultMarkupPercent: z.number().finite().min(0).max(1000).optional(),
  courierFeePerOrder: z.number().finite().min(0).max(1_000_000).optional(),
  deliveryCostPerPiece: z.number().finite().min(0).max(1_000_000).optional(),
  birthdayDiscountPercent: z.number().finite().min(0).max(100).optional(),
  dartCardDiscountPercent: z.number().finite().min(0).max(100).optional(),
  dartCardEnabled: z.boolean().optional(),
  dartCardPausedAt: z.iso.datetime().nullable().optional(),
  dartCardResumedAt: z.iso.datetime().nullable().optional(),
  refundCustomerFee: z.number().finite().min(0).max(1_000_000).optional(),
  repeatExchangeCustomerFee: z.number().finite().min(0).max(1_000_000).optional(),
  exchangePeriodDays: z.number().int().nonnegative().optional(),
  refundPeriodDays: z.number().int().nonnegative().optional(),
  siteDiscount: siteDiscount.optional(),
  waiting: waiting.optional(),
  announcements: z.array(z.record(z.string(), z.unknown())).max(200).optional(),
  modelCards: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  typing: typing.optional(),
  codRisk: codRisk.optional(),
  blockedGovernorates: blockedGovernoratesSchema.optional(),
  shippingCompanies: z.array(shippingCompanySchema).max(50)
    .refine(companies => new Set(companies.map(company => company.id)).size === companies.length, "Shipping company IDs must be unique").optional(),
}).strict();

export type SiteSettings = z.infer<typeof siteSettingsSchema>;

const PUBLIC_KEYS = [
  "version","heroDayImage","heroNightImage","founderImage","defaultMarkupPercent",
  "courierFeePerOrder","deliveryCostPerPiece","birthdayDiscountPercent","dartCardDiscountPercent",
  "dartCardEnabled",
  "refundCustomerFee","repeatExchangeCustomerFee","exchangePeriodDays","refundPeriodDays",
  "siteDiscount","waiting","announcements",
  "modelCards","typing",
] as const;

export function publicSiteSettings(value: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const key of PUBLIC_KEYS) if (key in value) output[key] = value[key];
  return output;
}
