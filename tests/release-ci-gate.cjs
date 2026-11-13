const assert=require('node:assert/strict');
(async()=>{
  const {assessReleaseRuns,verifyReleaseCI}=await import('../scripts/verify-release-ci.mjs');
  const sha='a'.repeat(40),run=(name,extra={})=>({id:1,name,head_sha:sha,head_branch:'main',event:'push',status:'completed',conclusion:'success',...extra});
  const passing=[run('CI'),run('Production checks'),run('Frontend CI')];
  assert.deepEqual(assessReleaseRuns(passing,sha,'storefront'),[]);
  assert.deepEqual(assessReleaseRuns(passing.slice(0,2),sha,'api'),[]);
  assert.deepEqual(assessReleaseRuns(passing.slice(0,2),sha,'storefront'),['Frontend CI']);
  assert.throws(()=>assessReleaseRuns([...passing,run('Frontend CI',{id:2,conclusion:'failure'})],sha,'api'),/Release blocked/);
  assert.deepEqual(assessReleaseRuns([...passing,run('CI',{id:2,status:'queued',conclusion:null})],sha,'storefront'),['CI']);
  assert.deepEqual(assessReleaseRuns(passing.map(r=>({...r,head_sha:'b'.repeat(40)})),sha,'storefront'),['CI','Production checks','Frontend CI']);
  assert.deepEqual(assessReleaseRuns([...passing,run('Encrypted database backup',{conclusion:'failure'})],sha,'storefront'),[]);
  const env={VERCEL:'1',VERCEL_ENV:'production',VERCEL_GIT_COMMIT_SHA:sha,VERCEL_GIT_COMMIT_REF:'main'};
  let calls=0,waits=0;
  await verifyReleaseCI('storefront',{env,log(){},wait:async()=>{waits++;},fetchImpl:async(url,options)=>{
    assert(url.includes('head_sha='+sha));assert.equal(options.cache,'no-store');assert(!options.headers.Authorization);
    return{ok:true,json:async()=>({workflow_runs:++calls===1?passing.slice(0,2):passing})};
  }});
  assert.equal(calls,2);assert.equal(waits,1);
  await assert.rejects(verifyReleaseCI('api',{env:{...env,VERCEL_GIT_COMMIT_SHA:''},log(){}}),/metadata/);
  await assert.rejects(verifyReleaseCI('api',{env,log(){},fetchImpl:async()=>({ok:false,status:403})}),/unavailable/);
  await assert.rejects(verifyReleaseCI('api',{env,log(){},timeoutMs:0}),/release window/);
  await verifyReleaseCI('storefront',{env:{},log(){},fetchImpl:async()=>{throw Error('Local builds must not call GitHub');}});
  const {equivalentFrontendCheck,unchangedStorefront}=await import('../scripts/verified-frontend-ci.mjs');
  const ancestor='b'.repeat(40), candidate={...run('Frontend CI'),head_sha:ancestor};
  const coverage = files => equivalentFrontendCheck(sha,async url=>({ok:true,json:async()=>url.includes('/compare/')
    ? {status:'ahead',base_commit:{sha:ancestor},merge_base_commit:{sha:ancestor},files}
    : {workflow_runs:[candidate]}}));
  assert.equal(await coverage([{filename:'backend/src/server.ts'},{filename:'.github/workflows/database-backup.yml'}]),true);
  assert.equal(await coverage([{filename:'index.html'}]),false);
  assert.equal(await coverage([{filename:'docs/index.html',previous_filename:'index.html'}]),false);
  assert.equal(unchangedStorefront(Array.from({length:300},()=>({filename:'docs/a.md'}))),false);
  assert.equal(await equivalentFrontendCheck(sha,async()=>({ok:false})),false);
  assert.deepEqual(assessReleaseRuns(passing.slice(0,2),sha,'storefront',true),[]);
  assert.throws(()=>assessReleaseRuns([...passing.slice(0,2),run('Frontend CI',{conclusion:'failure'})],sha,'storefront',true),/blocked/);
  const {waitForProduction}=await import('../scripts/wait-production-release.mjs');
  let probes=0,pauses=0;
  await waitForProduction(sha,{wait:async()=>{pauses++},fetchImpl:async()=>({ok:true,json:async()=>({sha:++probes===1?'b'.repeat(40):sha})})});
  assert.equal(probes,2);assert.equal(pauses,1);
  await assert.rejects(waitForProduction(sha,{once:true,fetchImpl:async()=>({ok:true,json:async()=>({sha:'b'.repeat(40)})})}),/expected commit/);
  await assert.rejects(waitForProduction('invalid'),/SHA/);
  await assert.rejects(waitForProduction(sha,{timeoutMs:0,fetchImpl:async()=>{throw Error('offline')}}),/expected commit/);
  console.log('PASS release CI gate: exact commit, required workflows, applicable API checks, latest reruns, failure, unavailable status, missing metadata, timeout and local isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
