import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { MemoryStore, type Options, type Store, type ClientRateLimitInfo } from "express-rate-limit";

// One atomic database statement per security-sensitive request, across all instances.
export class PostgresRateLimitStore implements Store {
  readonly localKeys = false;
  readonly prefix: string;
  private windowMs = 60_000;
  constructor(private readonly pool: Pool, private readonly scope: string, private readonly pepper: string) {
    this.prefix = `${scope}:`;
  }
  init(options: Options): void { this.windowMs = options.windowMs; }
  private hash(key: string): Buffer { return createHmac("sha256", this.pepper).update(key).digest(); }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const result = await this.pool.query<{ hits: string; expires_at: Date }>(
      `INSERT INTO api_rate_limits(scope,key_hash,hits,expires_at)
       VALUES ($1,$2,1,now()+($3::bigint*interval '1 millisecond'))
       ON CONFLICT(scope,key_hash) DO UPDATE SET
         hits=CASE WHEN api_rate_limits.expires_at<=now() THEN 1 ELSE api_rate_limits.hits+1 END,
         expires_at=CASE WHEN api_rate_limits.expires_at<=now()
           THEN now()+($3::bigint*interval '1 millisecond') ELSE api_rate_limits.expires_at END
       RETURNING hits::text,expires_at`, [this.scope, this.hash(key), this.windowMs],
    );
    return { totalHits: Number(result.rows[0]!.hits), resetTime: result.rows[0]!.expires_at };
  }
  async decrement(key: string): Promise<void> {
    await this.pool.query("UPDATE api_rate_limits SET hits=greatest(0,hits-1) WHERE scope=$1 AND key_hash=$2", [this.scope, this.hash(key)]);
  }
  async resetKey(key: string): Promise<void> {
    await this.pool.query("DELETE FROM api_rate_limits WHERE scope=$1 AND key_hash=$2", [this.scope, this.hash(key)]);
  }
}

const stores = new WeakMap<object, { pool: Pool; pepper: string }>();
export function registerSharedRateLimits(config: object, pool: Pool, pepper: string): void {
  stores.set(config, { pool, pepper });
}
export function sharedRateLimitStore(config: object, scope: string): Store {
  const source = stores.get(config);
  return source ? new PostgresRateLimitStore(source.pool, scope, source.pepper) : new MemoryStore();
}

export async function pruneRateLimits(pool: Pool): Promise<number> {
  const result = await pool.query(`DELETE FROM api_rate_limits WHERE (scope,key_hash) IN (
    SELECT scope,key_hash FROM api_rate_limits WHERE expires_at<now()-interval '1 hour' LIMIT 1000
  )`);
  return result.rowCount || 0;
}
