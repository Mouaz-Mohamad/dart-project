// Synthetic API/DOM fixtures exercise the production dashboard renderers without production writes.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), {chromium} = require('playwright');
const root = path.resolve(__dirname,'..');
const dashboard = fs.readFileSync(path.join(root,'Eye/Dart Eye.html'),'utf8');
const newsMarkup = dashboard.match(/<!-- BEGIN News management:[\s\S]*?<!-- END News management\. -->/)[0];
const source = fs.readFileSync(path.join(root,'Eye/dart.js'),'utf8');
const orderRenderer = source.slice(source.indexOf('function dartRenderOrderGroups('),source.indexOf('// Prepare authorized Sets'));
const html = `<!doctype html><html><head><meta charset="utf-8">${['dart.css','dart-inventory.css','dart-news.css','dart-dashboard-ui.css'].map(name=>`<link rel="stylesheet" href="/Eye/${name}">`).join('')}</head><body>
<nav><ul><li><a data-target="news">News</a></li></ul></nav><main>
<section id="orders" class="dashboard-section active-section"><div class="cont-titel dart-orders-groups-view"><div id="orders-container"></div></div></section>
<section id="items" class="dashboard-section"><div class="first"></div><div class="second"><button class="delete-btn">Delete</button></div><div class="cont-titel"><div class="title-name"><input type="checkbox">${['Actions','Photo','Model','Item Code','Color','Size','Status','Date','Order','Client','Client Code','Phone','Phone 2','Email','Purchased'].map(s=>`<h2>${s}</h2>`).join('')}</div><div id="items-container"></div></div></section>
<section id="waiting" class="dashboard-section">${['waiting','reserved','converted','conversion'].map(key=>`<span id="waiting-kpi-${key}"></span>`).join('')}<button data-waiting-view="queue">Queue</button><button data-waiting-view="demand">Demand</button><div id="waiting-queue-view"><div id="waiting-table" class="dart-waiting-table-wrap"></div></div><div id="waiting-demand-view" hidden><div id="waiting-demand-table" class="dart-waiting-table-wrap"></div></div></section>
<section id="models" class="dashboard-section"><div class="first filter-bar"><div class="search-box"><input></div><select data-filter-key="category"><option value="all">All</option></select><select data-filter-key="status"><option value="">Any</option></select><select data-filter-key="priceRange"><option value="">Any</option></select><select data-filter-key="archive"><option value="active">Active</option></select><button class="add-btn">Add</button></div><div class="second"><button class="delete-btn">Delete</button></div><div class="cont-titel"><div class="title-name"><h2>Original Model Heading</h2></div><div id="models-container"></div></div></section>
${newsMarkup}</main>
<script src="/fixture-data.js"></script><script src="/Js/dart-groups.js"></script><script src="/Eye/dart-inventory.js"></script><script src="/Eye/dart-waiting.js"></script><script src="/Eye/dart-sets-admin.js"></script><script src="/Eye/dart-news-admin.js"></script><script src="/Eye/dart-dashboard-ui.js"></script>
<script>${orderRenderer}
DartInventory.setupModelModal();dartRenderOrderGroups(document.getElementById('orders-container'),ordersData);
</script></body></html>`;
const fixture = `
window.fixtureNow=Date.now();Date.now=()=>window.fixtureNow;
window.fixturePermissions=null;window.fixtureReads={news:0,sets:0};window.fixtureHold={news:false,sets:false};window.fixtureRelease={news:[],sets:[]};window.fixtureFailure={news:0,sets:0};
window.activate=id=>{document.querySelectorAll('.dashboard-section').forEach(node=>node.classList.toggle('active-section',node.id===id));dispatchEvent(new CustomEvent('dart:dashboard-section-activated'));};
window.DartAdminAccess={can:key=>!fixturePermissions||fixturePermissions.includes(key)};window.DartAdminHydration={ready:true};window.DartDialog={confirm:async()=>true,alert:async()=>{}};
const modelsData=[{modelId:'M-1',name:'Fixture Hoodie',category:'Hoodies'}];
const groupKey=JSON.stringify(['M-1','Black','M']);
const itemsData=[{id:'piece-1',itemCode:'PIECE-1',modelId:'M-1',color:'Black',size:'M',status:'In stock'}];
const ordersData=Array.from({length:65},(_,i)=>({id:'id-'+i,orderId:'ORD-'+i,status:i%2?'Preparing':'New',country:'Egypt',governorate:'Cairo',area:'Ramses',createdAt:'2026-10-22T01:00:00Z'}));
const getRowClass=()=> 'model-row';const dartApplyFilters=(_,rows)=>rows;
const dartEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
window.DartCatalog={norm:v=>String(v??'').trim().toLowerCase(),active:row=>!!row&&!row.isArchived,colors:()=>[],sizes:()=>[],cover:()=>'/Photos/products/1.jpg',groupKey:()=>groupKey,model:id=>modelsData.find(row=>row.modelId===id),groups:()=>[{key:groupKey,modelId:'M-1',name:'Fixture Hoodie',color:'Black',size:'M',image:'/Photos/products/1.jpg',total:36,stock:1,reserved:2,processing:3,withRep:4,sold:5,refused:6,damaged:15,limit:5}]};
window.DartNews={source:v=>v,clear:()=>{},open:async()=>{}};
const newsRows=['Alpha','Beta'].map((title,i)=>({newsId:'NEWS-'+i,title,status:'published',body:'Synthetic test',excerpt:'Synthetic test',imageUrl:'/Photos/products/1.jpg',version:1}));
async function request(url,options={}){
 if(url.startsWith('/api/v1/admin/waiting'))return {version:1,entries:[{id:'W-1',customerName:'Fixture Customer',clientCode:'DR-1',modelId:'M-1',modelName:'Fixture Hoodie',color:'Black',size:'M',status:'waiting',queuePosition:1}],demand:[{modelId:'M-1',color:'Black',size:'M',waiting:3,reserved:2,converted:1,conversionRate:25}]};
 const type=url==='/api/v1/admin/sets'?'sets':url.startsWith('/api/v1/admin/news?')?'news':null;
 if(!type)return {};
 fixtureReads[type]++;
 const q=new URL(url,location.origin).searchParams.get('q')||'';
 const news=newsRows.filter(row=>row.title.toLowerCase().includes(q.toLowerCase()));
 const payload=type==='news'?{news,total:news.length,nextOffset:null}:{sets:[{setId:'SET-1',name:'Fixture Set',active:true,pieceCount:2,version:1,components:[],images:[],pricing:{costTotalMinor:60000,finalMinor:80000}}]};
 if(fixtureHold[type])await new Promise(resolve=>fixtureRelease[type].push(resolve));
 if(fixtureFailure[type]){const error=new Error('private diagnostic');error.status=fixtureFailure[type];throw error;}
 return structuredClone(payload);
}
window.DartAdminApi={request};window.DartSets={request};
`;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://fixture');
 if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html);return;}
 if(url.pathname==='/fixture-data.js'){res.setHeader('Content-Type','text/javascript');res.end(fixture);return;}
 const file=path.resolve(root,decodeURIComponent(url.pathname).slice(1));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin);
  await page.waitForFunction(()=>document.querySelectorAll('.dart-news-row').length===2&&document.querySelectorAll('.dart-set-row').length===1);
  assert.deepEqual(await page.evaluate(()=>fixtureReads),{news:1,sets:1},'private lists prefetch before first activation');
  for(const width of [370,480,767,768,1440]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>activate('orders'));
   const card=page.locator('.dart-order-group-card');
   assert.equal(await card.locator('section').count(),0);
   assert.ok((await card.boundingBox()).height<400,'collapsed group must not inherit viewport section heights');
   if(width===370&&process.env.DART_DASHBOARD_SCREENSHOT_DIR){fs.mkdirSync(process.env.DART_DASHBOARD_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DART_DASHBOARD_SCREENSHOT_DIR,'order-groups-phone.png')});}
   await card.locator('summary').click();assert.equal(await card.locator('.dart-order-group-ref').count(),65);await card.locator('summary').click();
   await page.evaluate(()=>activate('items'));
   const groupImageStyle=await page.locator('#items .group-row .product-img').first().evaluate(node=>({height:getComputedStyle(node).height,fit:getComputedStyle(node).objectFit}));
   assert.deepEqual(groupImageStyle,{height:'70px',fit:'cover'},'group thumbnail keeps 70px crop at '+width+'px');
   assert.deepEqual(await page.locator('[data-inventory-metric]').evaluateAll(nodes=>nodes.map(node=>[node.querySelector('dt').textContent,node.querySelector('dd').textContent])),[['Total','36'],['In Stock','1'],['Reserved','2'],['Processing','3'],['With Rep','4'],['Sold','5'],['Refused / Inspection','6'],['Damaged / Repair','15']]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'groups must fit viewport '+width);
   await page.locator('.group-row').focus();await page.keyboard.press('Enter');
   await page.locator('#items-container .dart-record-open').waitFor();
   assert.equal(await page.locator('#items-container [data-id="piece-1"]').count(),1);
   assert.deepEqual(await page.locator('#items-container .dart-item-thumb').evaluate(node=>({width:getComputedStyle(node).width,height:getComputedStyle(node).height,fit:getComputedStyle(node).objectFit})),{width:'36px',height:'25px',fit:'cover'},'individual Item thumbnail must retain the reviewed compact size');
   await page.locator('#back-to-groups').click();
   await page.evaluate(()=>activate('waiting'));
   await page.locator('#waiting-table .dart-record-open').waitFor();
   assert.equal(await page.locator('#waiting thead').count(),0);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Waiting must fit viewport '+width);
   if(width===370&&process.env.DART_DASHBOARD_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.DART_DASHBOARD_SCREENSHOT_DIR,'waiting-phone.png')});
   await page.locator('#waiting-table .dart-record-open').click();
   const dialog=page.locator('#waiting .dart-record-dialog[open]');
   assert.equal(await dialog.locator('.dart-record-detail-field').count(),14);
   assert.ok((await dialog.innerText()).includes('Reservation expiry'));
   assert.ok(!(await dialog.innerText()).includes('Field '));
   assert.ok(await dialog.locator('[data-waiting-action]').count()>0,'original Waiting actions remain inside Details');
   await page.keyboard.press('Escape');
  }
  await page.locator('[data-waiting-view="demand"]').click();
  await page.locator('#waiting-demand-table .dart-record-open').click();
  assert.ok((await page.locator('#waiting-demand-table .dart-record-dialog[open]').innerText()).includes('Conversion'));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>activate('models'));await page.locator('button[data-model-set-view="sets"]').click();
  await page.locator('.dart-set-row .dart-record-open').click();
  const setDetails=await page.locator('.dart-set-row dialog[open]').innerText();
  assert.ok(setDetails.includes('Set Name')&&setDetails.includes('Cost')&&!setDetails.includes('Original Model Heading'),'Sets must use their own field labels');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{for(let i=0;i<10;i++){activate('news');activate('models');}activate('news');});
  assert.deepEqual(await page.evaluate(()=>fixtureReads),{news:1,sets:1},'fresh tab navigation must not reload lists');
  await page.locator('#news-search').fill('Beta');await page.waitForFunction(()=>document.querySelectorAll('.dart-news-row').length===1&&document.querySelector('.dart-news-row').textContent.includes('Beta'));
  await page.evaluate(()=>{activate('orders');activate('news');});assert.equal(await page.locator('#news-search').inputValue(),'Beta');
  await page.evaluate(()=>{fixtureHold.news=true;});await page.locator('#news-search').fill('Alpha');
  await page.waitForFunction(()=>fixtureRelease.news.length===1);await page.locator('#news-search').fill('Beta');await page.waitForFunction(()=>fixtureRelease.news.length===2);
  await page.evaluate(()=>fixtureRelease.news[1]());await page.waitForFunction(()=>document.querySelector('.dart-news-row')?.textContent.includes('Beta'));
  await page.evaluate(()=>fixtureRelease.news[0]());await page.waitForTimeout(50);assert.ok((await page.locator('#news-rows').innerText()).includes('Beta'),'old response cannot overwrite a newer search');
  await page.evaluate(()=>{fixtureHold.news=false;fixtureFailure.news=503;fixtureNow+=60001;activate('orders');activate('news');});
  await page.locator('#news-retry').waitFor();assert.equal(await page.locator('.dart-news-row').count(),1,'failed background refresh keeps previous rows');
  await page.evaluate(()=>fixtureFailure.news=0);await page.locator('#news-retry').click();await page.waitForFunction(()=>document.getElementById('news-message').textContent==='');
  await page.evaluate(()=>{fixtureNow+=60001;fixtureHold.news=fixtureHold.sets=true;activate('orders');activate('news');});
  await page.waitForFunction(()=>fixtureRelease.news.length===3);await page.evaluate(()=>activate('models'));
  await page.locator('button[data-model-set-view="sets"]').click();await page.waitForFunction(()=>fixtureRelease.sets.length===1&&fixtureRelease.news.length===3);
  await page.evaluate(()=>{fixturePermissions=[];document.body.classList.add('dart-admin-locked');dispatchEvent(new CustomEvent('dart:admin-logged-out'));});
  await page.waitForFunction(()=>document.querySelectorAll('.dart-news-row,.dart-set-row').length===0);
  await page.evaluate(()=>{fixtureRelease.sets[0]();fixtureRelease.news[2]();});await page.waitForTimeout(50);
  assert.equal(await page.locator('.dart-news-row,.dart-set-row').count(),0,'late private responses must stay discarded after logout');
  assert.deepEqual(errors,[]);
  if(process.env.DART_DASHBOARD_SCREENSHOT_DIR){fs.mkdirSync(process.env.DART_DASHBOARD_SCREENSHOT_DIR,{recursive:true});await page.evaluate(()=>{document.body.classList.remove('dart-admin-locked');activate('items');});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.DART_DASHBOARD_SCREENSHOT_DIR,'inventory-groups-phone.png')});}
  // Verify visible colors across every operational section, including in-place status updates.
  const palettePage=await browser.newPage();
  await palettePage.route('https://**/*',route=>route.fulfill({status:200,contentType:'text/css',body:''}));
  const paletteErrors=[];palettePage.on('pageerror',error=>paletteErrors.push(error.message));
  const cases={
    orders:[['New','info'],['Accepted','processing'],['Preparing','processing'],['Out With Representative','warning'],['Representative On The Way','warning'],['Delivered','success'],['Refused','danger'],['Cancelled','danger'],['Canceled','danger'],['Delivery Failed','danger'],['Failed Delivery','danger'],['Unsuccessful Delivery','danger'],['Not Delivered','danger'],['Needs Attention','danger']],
    items:[['In stock','neutral'],['Reserved','warning'],['Processing/Held','processing'],['Sold','success'],['Damaged','danger']],
    models:[['Available','success'],['Out of stock','danger']],
    customers:[['active','success'],['suspended','danger']],
    returns:[['Under Review','warning'],['Approved','success'],['Return Received','success'],['Completed','success'],['Refund Completed','success'],['Refunded','success'],['Rejected','danger'],['Return Rejected','danger']],
    damage:[['Damaged','danger'],['Destroyed','danger'],['Repaired','success']],
    review:[['Active','success'],['Hidden','neutral']],
    representative:[['Active','success'],['Pending Approval','warning'],['Suspended','danger']],
    card:[['Active','success'],['Used','success'],['Expired','danger'],['Exhausted','neutral']],
    news:[['published','success'],['draft','neutral']],
    waiting:[['waiting','warning'],['reserved','warning'],['converted','success'],['expired','danger']],
    finance:[['Paid','success'],['Unpaid','warning'],['Settled','success'],['Awaiting Settlement','warning'],['Partial','warning'],['Partially Paid · Overdue','danger'],['Refunded','success'],['Partially Refunded','warning'],['Void','neutral'],['Unknown status','neutral']]
  };
  const colors={success:'rgba(74, 222, 128, 0.25)',processing:'rgba(163, 230, 153, 0.25)',info:'rgba(96, 165, 250, 0.25)',warning:'rgba(250, 204, 21, 0.25)',danger:'rgba(248, 113, 113, 0.25)',neutral:'rgb(255, 255, 255)'};
  const badgeColors={success:'rgba(74, 222, 128, 0.05)',info:'rgba(96, 165, 250, 0.05)'};
  const sampleRows=(entries)=>entries.map(([status],index)=>`<div class="model-row" data-id="case-${index}" data-case="${index}"><span>ROW-${index}</span><span>Fixture record</span><span class="fixture-status">${status}</span></div>`).join('');
  await palettePage.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body><main>${Object.entries(cases).map(([section,entries])=>`<section id="${section}" class="dashboard-section"><div class="cont-titel"><div class="title-name"><h2>Code</h2><h2>Name</h2><h2>Status</h2></div>${sampleRows(entries)}</div></section>`).join('')}
  <section id="settings" class="dashboard-section"><article class="dart-settings-list-row" id="staff-active"><div class="dart-staff-badges"><span>Active</span></div><button>Details</button></article><article class="dart-settings-list-row" id="staff-disabled"><div class="dart-staff-badges"><span>Disabled</span></div></article><div class="dart-settings-list-row" data-allowance-id="invitation" id="staff-pending">Waiting for verification</div><div class="dart-settings-list-row" data-status="paused" id="campaign-paused">Paused campaign</div></section>
  <section id="live-operations" class="dashboard-section"><button class="dart-live-rep-card is-selected" id="live-online"><span class="dart-live-pill">Online</span></button><div class="dart-live-stop" id="live-delivery" data-status="Representative On The Way">On the way</div></section>
  <section id="status-groups" class="dashboard-section"><article class="dart-order-group-card" id="same-group"><header>Delivered group</header><article class="dart-order-group-block"><span class="dart-order-group-ref"><b>ORDER-1</b><span>Delivered</span></span></article></article><article class="dart-order-group-card" id="mixed-group"><span class="dart-order-group-ref" id="mixed-new"><b>ORDER-2</b><span>New</span></span><span class="dart-order-group-ref" id="mixed-refused"><b>ORDER-3</b><span>Refused</span></span><span class="dart-order-group-status"><b>1</b> New</span></article><article class="group-row" id="stock-group"><span class="stock-badge">Low Stock</span><div data-inventory-metric="sold"><dt>Sold</dt><dd>4</dd></div></article><article class="dart-goal-card" id="goal-done" data-status="Achieved">Achieved</article></section>
  <section id="cod-test" class="dashboard-section"><table class="dart-finance-table"><thead><tr><th>Order</th><th>Order Status</th><th>Settlement</th></tr></thead><tbody><tr id="cod-unpaid"><td>COD-1</td><td>Delivered</td><td><span class="dart-status-chip">Awaiting Settlement</span></td></tr></tbody></table></section>
  </main></body></html>`);
  await palettePage.addStyleTag({content:['dart.css','dart-inventory.css','dart-finance.css','dart-settings.css','dart-live-operations.css','dart-dashboard-ui.css'].map(name=>fs.readFileSync(path.join(root,'Eye',name),'utf8')).join('\n')});
  await palettePage.addScriptTag({content:fs.readFileSync(path.join(root,'Eye/dart-dashboard-ui.js'),'utf8')});
  const show=async section=>{await palettePage.evaluate(id=>{document.querySelectorAll('.dashboard-section').forEach(node=>node.classList.toggle('active-section',node.id===id));window.DartDashboardUI.refresh();},section);await palettePage.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
  const background=selector=>palettePage.locator(selector).evaluate(node=>{const style=getComputedStyle(node);return style.backgroundImage.match(/rgba?\([^)]+\)/)?.[0]||style.backgroundColor;});
  for(const width of [370,480,767,768,1440]){
    await palettePage.setViewportSize({width,height:900});
    for(const [section,entries] of Object.entries(cases)){
      await show(section);
      for(const [index,[status,tone]] of entries.entries()){
        assert.equal(await background(`#${section} [data-case="${index}"]`),section==='customers'||section==='items'&&status==='In stock'?'rgb(255, 255, 255)':colors[tone],`${section} / ${status} at ${width}px`);
        assert.equal(await palettePage.locator(`#${section} [data-case="${index}"]`).evaluate(node=>getComputedStyle(node).opacity),'1','status tint must not fade text or controls');
        assert.equal(await palettePage.locator(`#${section} [data-case="${index}"]`).evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)','a solid surface must prevent nested tint accumulation');
      }
      assert.equal(await palettePage.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`status rows fit ${section} at ${width}px`);
    }
  }
  await show('items');
  await palettePage.locator('#items [data-case="3"] .fixture-status').evaluate(node=>{node.textContent='In stock';});
  await palettePage.waitForFunction(()=>{const row=document.querySelector('#items [data-case="3"]');return row.dataset.dartLabel==='In stock'&&getComputedStyle(row).backgroundImage==='none';});
  assert.equal(await background('#items [data-case="3"] .dart-record-field[data-column="2"] strong'),'rgba(0, 0, 0, 0)','unsold status labels must also lose the sale tint');
  await palettePage.locator('#items [data-case="3"] .fixture-status').evaluate(node=>{node.textContent='Sold';});
  await palettePage.waitForFunction(()=>getComputedStyle(document.querySelector('#items [data-case="3"]')).backgroundImage.includes('rgba(74, 222, 128, 0.25)'));
  assert.equal(await background('#items [data-case="3"] .dart-record-field[data-column="2"] strong'),badgeColors.success,'the Sold label retains its existing 5% badge blend');
  await show('customers');
  await palettePage.locator('#customers [data-case="0"] .fixture-status').evaluate(node=>{node.textContent='Suspended';});
  await palettePage.waitForFunction(()=>document.querySelector('#customers [data-case="0"]').dataset.dartLabel==='Suspended');
  assert.equal(await background('#customers [data-case="0"]'),'rgb(255, 255, 255)','clients keep an untinted surface after status changes');
  assert.equal(await background('#customers [data-case="0"] .dart-record-field[data-column="2"] strong'),'rgba(0, 0, 0, 0)','client status labels have no background fill');
  await show('orders');
  assert.equal(await background('#orders [data-case="0"] .dart-record-field[data-column="2"] strong'),badgeColors.info,'status badge retains the previous 5% tint');
  await palettePage.locator('#orders [data-case="0"] .fixture-status').evaluate(node=>{node.textContent='Delivered';});
  await palettePage.waitForFunction(()=>document.querySelector('#orders [data-case="0"]').dataset.dartTone==='success');
  assert.equal(await background('#orders [data-case="0"]'),colors.success);
  assert.equal(await palettePage.locator('#orders [data-case="0"] .dart-record-field[data-column="2"] strong').textContent(),'Delivered','summary status must follow an in-place update');
  await palettePage.locator('#orders [data-case="0"]').evaluate(node=>node.classList.add('row-deleted'));
  await palettePage.waitForFunction(()=>document.querySelector('#orders [data-case="0"]').dataset.dartTone==='neutral');
  assert.equal(await background('#orders [data-case="0"]'),colors.neutral,'archive display overrides the previous lifecycle color');
  for(const [section,checks] of [['settings',[['#staff-active','success'],['#staff-disabled','danger'],['#staff-pending','warning'],['#campaign-paused','neutral']]],['live-operations',[['#live-online','success'],['#live-delivery','warning']]],['status-groups',[['#same-group','success'],['#mixed-group','neutral'],['#mixed-new','info'],['#mixed-refused','danger'],['#stock-group','warning'],['[data-inventory-metric="sold"]','success'],['#goal-done','success']]],['cod-test',[['#cod-unpaid','warning']]]]){
    await show(section);for(const [selector,tone] of checks)assert.equal(await background(selector),colors[tone],selector);
  }
  const nestedFills=await palettePage.locator('#same-group,#same-group .dart-order-group-ref,#mixed-group,#mixed-new,#mixed-refused').evaluateAll(nodes=>nodes.map(node=>({base:getComputedStyle(node).backgroundColor,tint:getComputedStyle(node).backgroundImage})));
  assert.ok(nestedFills.every((fill,i)=>fill.base==='rgb(255, 255, 255)'&&(i===2?fill.tint==='none':fill.tint.includes('0.25)'))),'nested group tints must each blend 25% onto their own solid base');
  await show('orders');await palettePage.setViewportSize({width:390,height:844});
  if(process.env.DART_DASHBOARD_SCREENSHOT_DIR)await palettePage.screenshot({path:path.join(process.env.DART_DASHBOARD_SCREENSHOT_DIR,'status-colors-phone.png'),fullPage:true});
  assert.deepEqual(paletteErrors,[]);await palettePage.close();
  console.log('PASS shared row status colors, 25% record backgrounds, original 5% badges, failure variants, neutral mixed groups, all operational sections, COD priority, responsive widths and live state changes.');
  console.log('PASS dashboard group sizes, labeled inventory, headerless Waiting/actions, Sets field ownership, private prefetch, tab reuse, stale reads, retry and logout isolation.');
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
