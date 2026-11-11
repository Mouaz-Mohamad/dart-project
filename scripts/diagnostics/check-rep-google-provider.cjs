// Bounded live integration probe: one map and two routes between public Cairo landmarks.
// No login, real couriers, customers, application API requests or business mutations.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '../..'), origin = 'https://www.dartofficial.com';
const configPath = '/Js/dart-google-maps-config.js';
const csp = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'))).headers
  .find(row=>row.source==='/(.*)').headers.find(row=>row.key==='Content-Security-Policy').value;
const html = fs.readFileSync(path.join(root,'rep.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('</body>', `<script src="${configPath}"></script><script src="/Js/dart-google-maps.js"></script><script src="/__map-probe.js"></script></body>`);
const boot = `document.getElementById('repNavigationDialog').showModal();document.body.classList.add('dart-rep-navigating');
const host=document.getElementById('repNavigationMap');host.dataset.repLiveMap='';host.dataset.orderId='public-landmark';
window.DartGoogleMaps.attachRepresentatives([{id:'public-landmark',latitude:30.0478,longitude:31.2336,
courierLocation:{lat:30.0444,lng:31.2357,heading:90,speed:1,updatedAt:new Date().toISOString()}}]);`;
(async()=>{
  const response=await fetch(origin+configPath,{signal:AbortSignal.timeout(20000)});
  assert(response.ok,'public browser map configuration must be reachable');
  const config=await response.text();assert(/AIza[\w-]{30,}/.test(config),'browser map key must be configured');
  const browser=await chromium.launch({headless:true,
    ...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}}), providerErrors=[];
    page.on('console',message=>{const match=message.text().match(/Google Maps JavaScript API error: ([A-Za-z]+)/);if(match)providerErrors.push(match[1]);});
    // Same approved referrer, current checkout source and real Google networking; never load Dart API/auth code.
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin){
        if(url.pathname==='/rep.html')return route.fulfill({body:html,contentType:'text/html; charset=utf-8',headers:{'Content-Security-Policy':csp}});
        if(url.pathname===configPath)return route.fulfill({body:config,contentType:'text/javascript'});
        if(url.pathname==='/__map-probe.js')return route.fulfill({body:boot,contentType:'text/javascript'});
        if(!/^\/(?:CSS|Js|Photos|Icons)\//.test(url.pathname))return route.abort();
        const file=path.join(root,url.pathname);
        if(fs.existsSync(file)&&fs.statSync(file).isFile())return route.fulfill({body:fs.readFileSync(file),contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream'});
        return route.abort();
      }
      if(/(?:^|\.)(?:googleapis\.com|gstatic\.com|google\.com)$/.test(url.hostname))return route.continue();
      return route.abort();
    });
    await page.goto(origin+'/rep.html?map-probe=public-landmark',{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>['ready','error'].includes(document.getElementById('repNavigationMap').dataset.mapState),null,{timeout:50000});
    assert.deepEqual(providerErrors,[],'Google must accept the current browser key and approved referrer');
    const diagnostic=await page.evaluate(()=>window.DartGoogleMaps.getRepresentativeDiagnostics()[0]);
    assert(diagnostic,'Google must create a real map');assert.equal(diagnostic.state,'ready');
    const size=await page.locator('#repNavigationMap .dart-google-map-overlay').boundingBox();
    assert(size.width>=385&&size.height>700,'Google surface must fill the mobile navigation viewport');
    for(const mode of ['DRIVING','WALKING']){
      const result=await page.evaluate(async mode=>{
        try{const route=await Promise.race([window.DartGoogleMaps.computeRoute({lat:30.0444,lng:31.2357},{lat:30.0478,lng:31.2336},mode),new Promise((_,reject)=>setTimeout(()=>reject(Error('provider timeout')),25000))]);
          return {ok:true,points:route.geometry.length,steps:route.steps.length,metres:route.distanceMeters,instructions:route.steps.every(step=>Boolean(step.instruction))};
        }catch(error){return {ok:false,name:error.name};}
      },mode);
      assert(result.ok,`real Google ${mode} route must resolve`);assert(result.points>1&&result.steps>0&&result.metres>0&&result.instructions);
      console.log(`PASS real Google ${mode}: geometry, written directions and distance`);
    }
    console.log('PASS real Google mobile map: '+JSON.stringify(diagnostic));
  }finally{await browser.close();}
})().catch(error=>{console.error('FAIL Google provider probe: '+String(error.message).replace(/AIza[\w-]+/g,'[redacted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,450));process.exitCode=1;});
