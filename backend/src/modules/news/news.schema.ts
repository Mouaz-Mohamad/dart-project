import { z } from "zod";

export const newsIdSchema = z.string().trim().regex(/^[A-Za-z0-9_-]{1,120}$/);
export const newsWriteSchema = z.object({
  title: z.string().trim().min(1).max(160),
  excerpt: z.string().trim().max(280).default(""),
  body: z.string().trim().min(1).max(30000),
  coverAssetId: z.string().trim().regex(/^[A-Za-z0-9_-]{8,120}$/),
  status: z.enum(["draft", "published"]),
  sortOrder: z.number().int().min(0).max(9999).nullable().default(null),
}).strict();
export const newsCreateSchema = newsWriteSchema.extend({ newsId: newsIdSchema });
export const newsUpdateSchema = newsWriteSchema.extend({ expectedVersion: z.number().int().positive() });
export const newsStateSchema = z.object({
  action: z.enum(["archive", "restore"]),
  expectedVersion: z.number().int().positive(),
}).strict();
export const newsListSchema = z.object({
  q: z.string().trim().max(160).default(""),
  status: z.enum(["all", "draft", "published"]).default("all"),
  archive: z.enum(["active", "archived", "all"]).default("active"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
}).strict();
export const newsAssetSchema = z.object({
  assetId: z.string().regex(/^NEWSIMG-[A-Za-z0-9_-]{8,100}$/),
  originalName: z.string().trim().max(255).default(""),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  base64: z.string().min(4).max(5_600_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export type NewsWrite = z.infer<typeof newsWriteSchema>;
export type NewsList = z.infer<typeof newsListSchema>;
