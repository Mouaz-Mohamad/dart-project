const assert = require('node:assert/strict');
const { createGuard } = require('../server/public-route-guard.cjs');
const response = () => ({ headers:{}, setHeader(k,v){this.headers[k]=v;}, status(v){this.code=v;return this;}, send(v){this.body=v;return this;} });
(async () => {
  const fs = require('node:fs');
  const html=fs.readFileSync('Eye/Dart Eye.html','utf8');
  for (const item of JSON.parse(fs.readFileSync('scripts/external-browser-scripts.json','utf8'))) {
    assert(item.source.includes('@'+item.version+'/'));
    assert(html.includes('src="'+item.source+'" crossorigin="anonymous" integrity="'+item.integrity+'"'));
    assert(/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity));
  }
  let time=0, calls=0;
  const handle=createGuard({limit:2,windowMs:1000,now:()=>time})(async()=>{calls++;});
  await handle({},response()); await handle({},response());
  const denied=response(); await handle({},denied); assert.equal(denied.code,429); assert.equal(denied.headers["Cache-Control"],"no-store"); assert.equal(calls,2);
  time=1001; await handle({},response()); assert.equal(calls,3);
  const method=response(); await handle({method:'POST'},method); assert.equal(method.code,405);
  let release;
  const busy=createGuard({concurrency:1})(()=>new Promise(resolve=>{release=resolve;}));
  const running=busy({},response()); const concurrent=response(); await busy({},concurrent); assert.equal(concurrent.code,429);
  release(); await running;
  const errors=createGuard({concurrency:1})(async()=>{throw Error('synthetic');});
  await assert.rejects(errors({},response())); await assert.rejects(errors({},response()));
  console.log('PASS public route quotas, expiry, methods, concurrent admission and cleanup');
})().catch(e=>{console.error(e);process.exitCode=1;});
