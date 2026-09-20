import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AppError } from "../../http/app-error.js";

const ALLOWED = new Set(["image/jpeg","image/png","image/webp"]);
const MAX_BYTES = 4 * 1024 * 1024;

function detectedImageType(content: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) return "image/jpeg";
  if (
    content.length >= 8 &&
    content.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
  ) return "image/png";
  if (
    content.length >= 12 &&
    content.subarray(0, 4).toString("ascii") === "RIFF" &&
    content.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return null;
}

export class CatalogAssetService {
  constructor(private readonly pool: Pool) {}

  async get(assetId: string): Promise<{ content: Buffer; contentType: string; originalName: string; sha256: string } | null> {
    const result = await this.pool.query<{
      content: Buffer;
      content_type: string;
      original_name: string;
      sha256: string;
    }>(
      "SELECT content, content_type, original_name, sha256 FROM catalog_assets WHERE asset_id = $1",
      [assetId],
    );
    const row = result.rows[0];
    return row
      ? {
          content: row.content,
          contentType: row.content_type,
          originalName: row.original_name,
          sha256: row.sha256,
        }
      : null;
  }

  async put(input: {
    assetId: string;
    originalName: string;
    contentType: string;
    base64: string;
    actorId: string;
  }): Promise<{ id: string; urlPath: string }> {
    if (!ALLOWED.has(input.contentType)) {
      throw new AppError(422, "ASSET_TYPE_INVALID", "Only JPG, PNG or WebP images are allowed");
    }
    const content = Buffer.from(input.base64, "base64");
    if (!content.length || content.length > MAX_BYTES) {
      throw new AppError(422, "ASSET_SIZE_INVALID", "Compressed image must be between 1 byte and 4 MB");
    }
    const detectedType = detectedImageType(content);
    if (!detectedType || detectedType !== input.contentType) {
      throw new AppError(422, "ASSET_CONTENT_INVALID", "Image bytes do not match the declared image type");
    }
    const digest = createHash("sha256").update(content).digest("hex");
    await this.pool.query(
      `INSERT INTO catalog_assets (
         asset_id, original_name, content_type, content, byte_size, sha256, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (asset_id) DO UPDATE SET
         original_name=EXCLUDED.original_name,
         content_type=EXCLUDED.content_type,
         content=EXCLUDED.content,
         byte_size=EXCLUDED.byte_size,
         sha256=EXCLUDED.sha256,
         updated_at=now()`,
      [
        input.assetId,
        input.originalName || "",
        input.contentType,
        content,
        content.length,
        digest,
        input.actorId,
      ],
    );
    return { id: input.assetId, urlPath: `/api/v1/catalog/assets/${encodeURIComponent(input.assetId)}` };
  }
}
