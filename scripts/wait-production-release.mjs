// DART CODE GUIDE | scripts/wait-production-release.mjs
// Regression-safe data and release boundaries.
import { pathToFileURL } from 'node:url';
export async function waitForProduction(sha, {
  fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now, timeoutMs = 12 * 60_000, once = false,
} = {}) {
  if (!/^[a-f0-9]{40}$/i.test(sha || '')) throw new Error('Expected production SHA is required');
  const deadline = now() + timeoutMs;
  do {
    try {
      const response = await fetchImpl('https://www.dartofficial.com/release.json?expected=' + sha, {
        cache: 'no-store', signal: AbortSignal.timeout(15000),
      });
      if (response.ok && (await response.json()).sha === sha) return;
    } catch { /* Deployment propagation may briefly return a non-JSON error. */ }
    if (once || now() >= deadline) break;
    await wait(Math.min(15000, Math.max(0, deadline - now())));
  } while (now() <= deadline);
  throw new Error('Production does not serve the expected commit; refusing to attribute Lighthouse results');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await waitForProduction(process.env.DART_EXPECTED_RELEASE_SHA, { once: process.argv.includes('--once') });
  console.log('Verified exact production commit');
}
