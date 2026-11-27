'use strict';
const { randomUUID, createHash } = require('node:crypto');
// Per-instance admission control supplements the provider's distributed firewall.
// No cookies, request URLs, addresses, or raw provider errors are retained/logged.
function createGuard({ limit = 60, windowMs = 60000, concurrency = 8, maxKeys = 10000, now = Date.now } = {}) {
  const buckets = new Map();
  let active = 0;
  return function guard(handler) {
    return async (request, response) => {
      const requestId = randomUUID();
      response.setHeader('X-Request-Id', requestId);
      response.setHeader('Cache-Control', 'no-store');
      if (request.method && !['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return response.status(405).send('Method not allowed');
      }
      const ip = (process.env.VERCEL && request.headers?.['x-vercel-forwarded-for']) || request.socket?.remoteAddress || 'unknown';
      const key = createHash('sha256').update(String(ip).slice(0, 128)).digest('hex'), time = now();
      let bucket = buckets.get(key);
      if (!bucket || bucket.until <= time) {
        for (const [id, entry] of buckets) if (entry.until <= time) buckets.delete(id);
        if (buckets.size >= maxKeys && !buckets.has(key)) {
          response.setHeader('Retry-After', '60');
          return response.status(503).send('Temporarily busy');
        }
        bucket = { count: 0, until: time + windowMs }; buckets.set(key, bucket);
      }
      bucket.count++;
      if (bucket.count > limit || active >= concurrency) {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.until - time) / 1000))));
        return response.status(429).send('Too many requests');
      }
      active++;
      try { return await handler(request, response); }
      finally { active--; }
    };
  };
}
function logPublicFailure(route, response) {
  console.error(JSON.stringify({ event: 'public_page_failed', route,
    requestId: response.getHeader?.('X-Request-Id') || null, time: new Date().toISOString() }));
}
module.exports = { createGuard, logPublicFailure };
