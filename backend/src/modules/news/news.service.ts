// Server-authoritative News CRUD. No inventory, commerce or browser-persistent state.
import type { Pool, PoolClient } from "pg";
import { AppError } from "../../http/app-error.js";
import { catalogAssetUrl } from "../catalog/catalog.asset.cache.js";
import type { NewsList, NewsWrite } from "./news.schema.js";

interface NewsRow {
  news_id: string; title: string; excerpt: string; body: string;
  cover_asset_id: string; sha256: string; status: "draft" | "published";
  sort_order: number | null; is_archived: boolean; version: string;
  published_at: Date | null; created_at: Date; updated_at: Date; created_by: string | null;
}
const columns = `n.news_id,n.title,n.cover_asset_id,a.sha256,n.status,
  n.sort_order,n.is_archived,n.version::text,n.published_at,n.created_at,n.updated_at,n.created_by`;
const order = "n.sort_order ASC NULLS LAST,n.published_at DESC NULLS LAST,n.created_at DESC,n.news_id";
const visible = "n.status='published' AND NOT n.is_archived";
function view(row: NewsRow, admin: boolean, full: boolean) {
  return {
    newsId: row.news_id, title: row.title, excerpt: row.excerpt || (row.body || "").slice(0, 280),
    imageUrl: catalogAssetUrl(row.cover_asset_id, row.sha256), publishedAt: row.published_at,
    ...(full ? { body: row.body } : {}),
    ...(admin ? { coverAssetId: row.cover_asset_id, status: row.status, sortOrder: row.sort_order,
      isArchived: row.is_archived, version: Number(row.version), createdAt: row.created_at, updatedAt: row.updated_at } : {}),
  };
}
function sameInput(row: NewsRow, input: NewsWrite): boolean {
  return row.title === input.title && row.excerpt === input.excerpt && row.body === input.body &&
    row.cover_asset_id === input.coverAssetId && row.status === input.status && row.sort_order === input.sortOrder;
}
export class NewsService {
  constructor(private readonly pool: Pool) {}

  async list(options: NewsList, admin = false) {
    const conditions = admin ? `($1='all' OR n.status=$1)
      AND ($2='all' OR n.is_archived=($2='archived'))
      AND ($3='' OR strpos(lower(n.title || ' ' || n.excerpt || ' ' || n.body),lower($3))>0)` : visible;
    const params: unknown[] = admin ? [options.status, options.archive, options.q] : [];
    const count = await this.pool.query<{ total: string }>(`SELECT count(*)::text AS total FROM news_articles n WHERE ${conditions}`, params);
    const pageParams = [...params, options.limit, options.offset];
    // The public list never transfers the full article body; read-more fetches it on demand.
    const result = await this.pool.query<NewsRow>(`SELECT ${columns},${admin ? "n.body,n.excerpt" : "COALESCE(NULLIF(n.excerpt,''),left(n.body,280)) AS excerpt"}
      FROM news_articles n JOIN catalog_assets a ON a.asset_id=n.cover_asset_id WHERE ${conditions}
      ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, pageParams);
    const total = Number(count.rows[0]?.total || 0);
    return { news: result.rows.map(row => view(row, admin, admin)), total,
      nextOffset: options.offset + result.rows.length < total ? options.offset + result.rows.length : null };
  }

  async get(newsId: string, admin = false) {
    const result = await this.pool.query<NewsRow>(`SELECT ${columns},n.body,n.excerpt FROM news_articles n
      JOIN catalog_assets a ON a.asset_id=n.cover_asset_id WHERE n.news_id=$1${admin ? "" : ` AND ${visible}`}`, [newsId]);
    if (!result.rows[0]) throw new AppError(404, "NEWS_NOT_FOUND", "News not found");
    return { news: view(result.rows[0], admin, true) };
  }

  private async row(client: PoolClient, id: string) {
    const result = await client.query<NewsRow>(`SELECT ${columns},n.body,n.excerpt FROM news_articles n
      JOIN catalog_assets a ON a.asset_id=n.cover_asset_id WHERE n.news_id=$1 FOR UPDATE OF n`, [id]);
    return result.rows[0];
  }

  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }

  private async audit(client: PoolClient, actorId: string, id: string, action: string, requestId: string,
    before: NewsRow | null, after: NewsRow) {
    await client.query(`INSERT INTO audit_logs(actor_type,actor_id,action,entity_type,entity_id,request_id,metadata)
      VALUES ('staff',$1,$2,'news',$3,$4,$5::jsonb)`,
    [actorId, action, id, requestId, JSON.stringify({ before: before ? view(before, true, true) : null, after: view(after, true, true) })]);
  }

  async save(actorId: string, id: string, input: NewsWrite, expectedVersion: number | null, requestId: string) {
    return this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`dart:news:${id}`]);
      const before = await this.row(client, id);
      if (expectedVersion === null && before) {
        // Retrying a timed-out create with the same ID/payload never adds another article or audit.
        if (before.created_by === actorId && !before.is_archived && sameInput(before, input)) return { news: view(before, true, true) };
        throw new AppError(409, "NEWS_ID_CONFLICT", "This News ID already exists");
      }
      if (expectedVersion !== null) {
        if (!before) throw new AppError(404, "NEWS_NOT_FOUND", "News not found");
        if (before.is_archived) throw new AppError(409, "NEWS_ARCHIVED", "Restore this News before editing it");
        if (Number(before.version) !== expectedVersion) throw new AppError(409, "NEWS_VERSION_CONFLICT", "This News changed in another session. Reload before editing");
      }
      const asset = await client.query("SELECT 1 FROM catalog_assets WHERE asset_id=$1 FOR SHARE", [input.coverAssetId]);
      if (!asset.rows.length) throw new AppError(422, "NEWS_IMAGE_REQUIRED", "Upload a cover image before saving News");
      const values = [id, input.title, input.excerpt, input.body, input.coverAssetId, input.status, input.sortOrder, actorId];
      if (!before) {
        await client.query(`INSERT INTO news_articles(news_id,title,excerpt,body,cover_asset_id,status,sort_order,created_by,updated_by,published_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,CASE WHEN $6='published' THEN now() END)`, values);
      } else {
        await client.query(`UPDATE news_articles SET title=$2,excerpt=$3,body=$4,cover_asset_id=$5,
          published_at=CASE WHEN $6='published' AND status='draft' THEN now() ELSE published_at END,
          status=$6,sort_order=$7,updated_by=$8,updated_at=now(),version=version+1 WHERE news_id=$1`, values);
      }
      const after = (await this.row(client, id))!;
      await this.audit(client, actorId, id, before ? "NEWS_UPDATED" : "NEWS_CREATED", requestId, before || null, after);
      return { news: view(after, true, true) };
    });
  }

  async state(actorId: string, id: string, action: "archive" | "restore", expectedVersion: number, requestId: string) {
    return this.transaction(async client => {
      const before = await this.row(client, id);
      if (!before) throw new AppError(404, "NEWS_NOT_FOUND", "News not found");
      const archived = action === "archive";
      if (before.is_archived === archived) return { news: view(before, true, true) };
      if (Number(before.version) !== expectedVersion) throw new AppError(409, "NEWS_VERSION_CONFLICT", "This News changed in another session. Reload and try again");
      await client.query(`UPDATE news_articles SET is_archived=$2,updated_by=$3,version=version+1,updated_at=now() WHERE news_id=$1`, [id, archived, actorId]);
      const after = (await this.row(client, id))!;
      await this.audit(client, actorId, id, archived ? "NEWS_ARCHIVED" : "NEWS_RESTORED", requestId, before, after);
      return { news: view(after, true, true) };
    });
  }
}
