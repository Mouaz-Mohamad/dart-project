// Synthetic customer data only; exercises the maintained UI and navigation code.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'src/dashboard/dashboard-ui.js'), 'utf8');
const fixture = `
window.calls=[];window.permissionDenied=false;window.owner=true;window.fail=false;window.hold=false;window.release=[];
window.DartAdminAccess={can:()=>!permissionDenied};window.DartDialog={confirm:async()=>true};
window.ordersData=[{id:'ORDER-UUID',orderId:'ORD-51'}];window.dartFilterState={orders:{status:'New',search:'wrong'}};window.dartOrdersView='groups';
window.loadAllDataFromStorage=()=>{};
window.dartNavigateSection=id=>{document.querySelectorAll('.dashboard-section').forEach(node=>node.classList.toggle('active-section',node.id===id));window.dispatchEvent(new CustomEvent('dart:dashboard-section-activated',{detail:{id}}));};
window.dartRenderSection=()=>{document.querySelector('#orders .cont-titel').insertAdjacentHTML('beforeend','<div class="model-row" data-id="ORDER-UUID"><span>ORD-51</span><span>Fixture order</span><span>Delivered</span></div>');DartDashboardUI.refresh();};
window.DartAdminApi={request:async (url,options={})=>{
 calls.push([url,options]);if(hold)await new Promise(resolve=>release.push(resolve));if(fail)throw new Error('private internal failure');
 if(options.method)return {id:options.body.id,version:1};
 const section=url.match(/details\\/(\\w+)/)[1];
 if(section==='orders')return {rows:[{id:'ORDER-UUID',orderId:'ORD-51',finalMinor:89999,status:'Delivered',date:'2026-10-01',items:[{itemCode:'PIECE-1',name:'Hoodie',color:'Black',size:'M',finalMinor:89999}]}],nextOffset:url.includes('offset=50')?null:50};
 if(section==='reviews')return {rows:[{rating:5,title:'<script>bad()</script>',review:'Nice hoodie',date:'2026-10-01',status:'Pending'}],nextOffset:null};
 if(section==='waiting')return {rows:[{name:'Hoodie',modelId:'M1',color:'Black',size:'M',date:'2026-10-01',status:'waiting'}],pieces:3,nextOffset:null};
 if(section==='returns')return {rows:[{itemCode:'I1',orderId:'ORD-3',requestType:'Exchange',replacementItemCode:'I2',status:'Completed',reason:'Size'}],nextOffset:null};
 return {rows:[{id:'existing-grant',name:'Personal gift',kind:'amount',value:10000,pieceLimit:3,startsOn:'2026-01-01',endsOn:'2099-01-01',status:'Active',version:1}],benefits:[{type:'Dart Card',name:'DC1',discountPercent:40,remaining:7,expiresAt:'2099-01-01'}],campaigns:[],canManageManual:owner,nextOffset:null};
}};
`;
const customerRow = id => `<div class="model-row" data-id="${id}"><span>Fixture Customer</span><span>DR-1</span><span>01000000001</span><span><button class="fixture-edit">Edit</button></span></div>`;
(async () => {
 const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
 try {
  const page=await browser.newPage(), errors=[];page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
  // localhost gives the synthetic page a secure context for crypto.randomUUID().
  await page.route('http://localhost/**',route=>route.request().url().includes('dart-customer-details.js')?route.fulfill({contentType:'text/javascript; charset=utf-8',body:fs.readFileSync(path.join(root,'src/dashboard/customer-details.js'),'utf8')}):route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"></head><body><main><section id="customers" class="dashboard-section active-section"><div class="cont-titel"><div class="title-name"><h2>Client Name</h2><h2>ID Clinte</h2><h2>Phone Number</h2><h2>Actions</h2></div><div id="customer-rows">${customerRow('CLIENT-1')}${customerRow('CLIENT-2')}</div></div></section><section id="orders" class="dashboard-section"><div class="cont-titel"><div class="title-name"><h2>ID Order</h2><h2>Name</h2><h2>Status</h2></div></div></section></main></body></html>`}));
  await page.goto('http://localhost/');
  await page.addStyleTag({content:fs.readFileSync(path.join(root,'Eye/dart-dashboard-ui.css'),'utf8')+'\n*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}.dashboard-section{display:none}.active-section{display:block}'});
  await page.addScriptTag({content:fixture});await page.addScriptTag({content:ui});
  assert.equal(await page.evaluate(()=>Boolean(window.DartCustomerDetails)),false,'customer history code must remain lazy');
  await page.locator('#customers .dart-record-open').first().click();
  const dialog=page.locator('#customers dialog[open]');
  await dialog.locator('[data-client-panel=discounts]').waitFor({state:'attached'});
  assert.equal(await dialog.locator('[data-client-panel]').count(),6);
  assert.deepEqual(await dialog.locator('[data-client-panel][open]').evaluateAll(nodes=>nodes.map(node=>node.dataset.clientPanel)),['general']);
  assert.equal(await page.evaluate(()=>calls.length),0,'collapsed sections should not load');
  assert.equal(await dialog.locator('.fixture-edit').count(),1,'existing general actions preserved');
  await dialog.locator('[data-client-panel=orders] > summary').click();
  await dialog.locator('[data-client-order]').waitFor();
  assert.ok((await dialog.innerText()).includes('899.99 EGP'));
  await dialog.getByRole('button',{name:'Load more',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-client-order]').length===2);
  await dialog.locator('[data-client-panel=reviews] > summary').click();await dialog.getByText('Nice hoodie').waitFor();
  assert.equal(await dialog.locator('script').count(),0,'review content remains text');
  await dialog.locator('[data-client-panel=waiting] > summary').click();await dialog.getByText('Waiting · 3 pieces',{exact:true}).waitFor();
  await dialog.locator('[data-client-panel=returns] > summary').click();await dialog.getByText('I2',{exact:true}).waitFor();
  await dialog.locator('[data-client-panel=discounts] > summary').click();await dialog.getByRole('button',{name:'Add manual discount'}).click();
  const form=dialog.locator('form');
  await form.locator('[name=name]').fill('Loyal customer');await form.locator('[name=kind]').selectOption('amount');await form.locator('[name=value]').fill('100');
  await form.locator('[name=startsOn]').fill('2026-10-01');await form.locator('[name=endsOn]').fill('2026-11-30');await form.locator('[name=pieceLimit]').fill('3');
  assert.equal(await dialog.count(),1,'form interactions do not close customer details');
  await form.getByRole('button',{name:'Save discount'}).click();await page.waitForFunction(()=>calls.some(([,options])=>options.method==='POST'));
  assert.deepEqual(await page.evaluate(()=>calls.find(([,o])=>o.method==='POST')[1].body.discount),{name:'Loyal customer',kind:'amount',value:10000,startsOn:'2026-10-01',endsOn:'2026-11-30',pieceLimit:3});
  await dialog.locator('.dart-client-discount-form').waitFor({state:'detached'});
  await dialog.getByRole('button',{name:'Cancel discount',exact:true}).click();
  await page.locator('.dart-client-confirm[open]').getByRole('button',{name:'Keep discount'}).click();
  assert.equal(await dialog.count(),1,'discount cancellation confirmation remains above customer details');
  assert.equal(await page.evaluate(()=>calls.filter(([,options])=>options.method==='PUT').length),0,'dismissed cancellation must not write');
  for(const width of [370,480,767,768,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow at '+width);
    const bounds=await dialog.boundingBox();assert.ok(bounds.width<=width,'dialog fits width '+width);
  }
  if(process.env.DART_DASHBOARD_SCREENSHOT_DIR){fs.mkdirSync(process.env.DART_DASHBOARD_SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(process.env.DART_DASHBOARD_SCREENSHOT_DIR,'customer-details-desktop.png')});}
  await dialog.locator('[data-client-order]').first().click();await page.locator('#orders dialog[open]').waitFor();
  assert.equal(await page.evaluate(()=>dartFilterState.orders.search),'ord-51');assert.equal(await page.evaluate(()=>dartOrdersView),'all');
  await page.keyboard.press('Escape');await page.evaluate(()=>dartNavigateSection('customers'));
  await page.locator('#customers .dart-record-open').nth(1).click();
  const second=page.locator('#customers dialog[open]');await page.evaluate(()=>{owner=false;fail=true});
  await second.locator('[data-client-panel=discounts] > summary').click();await second.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.ok(!(await second.innerText()).includes('private internal'));
  await page.evaluate(()=>fail=false);await second.getByRole('button',{name:'Retry',exact:true}).click();await second.getByText('Personal gift',{exact:true}).waitFor();
  assert.equal(await second.getByRole('button',{name:'Add manual discount'}).count(),0,'non-owner does not receive grant controls');
  await page.evaluate(()=>{hold=true});await second.locator('[data-client-panel=orders] > summary').click();await page.waitForFunction(()=>release.length>0);
  await page.evaluate(()=>{document.body.classList.add('dart-admin-locked');dispatchEvent(new Event('dart:admin-logged-out'));release.forEach(resolve=>resolve())});
  await page.waitForTimeout(30);assert.equal(await page.locator('.dart-client-panel-body [data-client-order]').count(),0,'late responses cannot restore private data after logout');
  assert.deepEqual(errors,[]);console.log('PASS customer accordions, lazy history, pagination, order navigation, owner form, responsive layout, retry and logout isolation');
 } finally {await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
