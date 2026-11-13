// DART CODE GUIDE | scripts/verified-frontend-ci.mjs
// Reuse checks only for a proven identical storefront across immutable commits.
const api = 'https://api.github.com/repos/Mouaz-Mohamad/dart-project';
const excluded = /^(?:backend\/|tests\/|docs\/|\.github\/|AGENTS\.md$|scripts\/vercel-ignore-frontend\.sh$)/;
export function unchangedStorefront(files) {
  return Array.isArray(files) && files.length < 300 && files.every(file =>
    typeof file.filename === 'string' && [file.filename,file.previous_filename].filter(Boolean).every(path => excluded.test(path)));
}
export async function equivalentFrontendCheck(sha, fetchImpl = fetch) {
  const options = {headers:{Accept:'application/vnd.github+json','User-Agent':'Dart-Release-Check'},cache:'no-store',signal:AbortSignal.timeout(20000)};
  const response = await fetchImpl(api + '/actions/workflows/frontend-ci.yml/runs?branch=main&event=push&status=success&per_page=10',options);
  if (!response.ok) return false;
  const payload = await response.json();
  if (!Array.isArray(payload.workflow_runs)) return false;
  for (const run of payload.workflow_runs.slice(0,10)) {
    if (run.name !== 'Frontend CI' || run.head_branch !== 'main' || run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success' || !/^[a-f0-9]{40}$/i.test(run.head_sha || '')) continue;
    if (run.head_sha === sha) return true;
    const compared = await fetchImpl(api + '/compare/' + run.head_sha + '...' + sha,{...options,signal:AbortSignal.timeout(20000)});
    if (!compared.ok) continue;
    const comparison = await compared.json();
    if (comparison.base_commit?.sha === run.head_sha && comparison.merge_base_commit?.sha === run.head_sha &&
        comparison.status === 'ahead' && unchangedStorefront(comparison.files)) return true;
  }
  return false;
}
