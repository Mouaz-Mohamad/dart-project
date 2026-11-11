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
    ...(process.env.DART_GOOGLE_PROBE_PROXY ? {proxy:{server:process.env.DART_GOOGLE_PROBE_PROXY}} : {}),
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
    assert.equal(diagnostic.tilt,0,'navigation must remain flat');
    const verifyPaint=async()=>{
      // tilesloaded alone previously missed a partial gray viewport. Check actual rendered tile/canvas coverage.
      const sample=()=>{
        const host=document.getElementById('repNavigationMap'),box=host.getBoundingClientRect();
        const images=[...host.querySelectorAll('.gm-style img')].filter(img=>img.complete&&img.naturalWidth>=128&&img.naturalHeight>=128);
        const raster=host.dataset.mapRenderer==='RASTER';
        const surfaces=(raster ? images : [...host.querySelectorAll('canvas')].filter(canvas=>canvas.width>=128&&canvas.height>=128)).map(el=>el.getBoundingClientRect());
        let covered=0,total=0;
        for(let y=0;y<17;y++)for(let x=0;x<9;x++){
          const px=box.x+(x+.5)*box.width/9,py=box.y+(y+.5)*box.height/17;total++;
          if(surfaces.some(r=>px>=r.left&&px<r.right&&py>=r.top&&py<r.bottom))covered++;
        }
        const arrow=host.querySelector('.dart-google-map-follow-arrow'),a=arrow?.getBoundingClientRect();
        return {coverage:covered/total,surfaces:surfaces.length,width:box.width,height:box.height,
          centered:!!a&&Math.abs(a.x+a.width/2-box.x-box.width/2)<1&&Math.abs(a.y+a.height/2-box.y-box.height/2)<1};
      };
      // Wait on coverage rather than merely finding the diagnostic object.
      for(let attempt=0;attempt<40;attempt++){
        const value=await page.evaluate(sample);
        if(value.coverage>=.99&&value.centered)return value;
        await page.waitForTimeout(250);
      }
      const value=await page.evaluate(sample);assert(value.coverage>=.99&&value.centered,'streets must paint the whole viewport and the arrow must stay centered: '+JSON.stringify(value));
    };
    const firstPaint=await verifyPaint();
    for(let sample=1;sample<=8;sample++){
      await page.evaluate(sample=>window.DartGoogleMaps.updateRepresentativeLocation({lat:30.0444+sample*.00012,lng:31.2357,heading:45,speed:2,accuracy:5,updatedAt:new Date().toISOString()}),sample);
      await page.waitForTimeout(75);
    }
    await page.waitForFunction(()=>{const error=window.DartGoogleMaps.getRepresentativeDiagnostics()[0].centerErrorMetres;return typeof error==='number'&&error<=1},null,{timeout:15000});
    const afterMovement=await verifyPaint();
    await page.setViewportSize({width:844,height:390});
    const afterResize=await verifyPaint();
    await page.setViewportSize({width:390,height:844});
    await verifyPaint();
    console.log('PASS real Google full street coverage and fixed arrow: '+JSON.stringify({firstPaint,afterMovement,afterResize}));
    for(const mode of ['DRIVING','WALKING']){
      const result=await page.evaluate(async mode=>{
        try{const route=await Promise.race([window.DartGoogleMaps.computeRoute({lat:30.0444,lng:31.2357},{lat:30.0478,lng:31.2336},mode),new Promise((_,reject)=>setTimeout(()=>reject(Error('provider timeout')),25000))]);
          return {ok:true,points:route.geometry.length,steps:route.steps.length,metres:route.distanceMeters,instructions:route.steps.every(step=>Boolean(step.instruction))};
        }catch(error){return {ok:false,name:error.name};}
      },mode);
      assert(result.ok,`real Google ${mode} route must resolve`);assert(result.points>1&&result.steps>0&&result.metres>0&&result.instructions);
      console.log(`PASS real Google ${mode}: geometry, written directions and distance`);
    }
    if(process.env.DART_GOOGLE_PROBE_SCREENSHOT)await page.screenshot({path:process.env.DART_GOOGLE_PROBE_SCREENSHOT});
    console.log('PASS real Google mobile map: '+JSON.stringify(await page.evaluate(()=>window.DartGoogleMaps.getRepresentativeDiagnostics()[0])));
  }finally{await browser.close();}
})().catch(error=>{console.error('FAIL Google provider probe: '+String(error.message).replace(/AIza[\w-]+/g,'[redacted]').replace(/https?:\/\/\S+/g,'[url]').slice(0,450));process.exitCode=1;});
