// Synthetic inventory only: production editor and persistence functions, no live writes.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const inventory = fs.readFileSync('src/dashboard/inventory.js', 'utf8');
const catalog = fs.readFileSync('src/storefront/catalog.js', 'utf8');
const admin = fs.readFileSync('src/dashboard/item-batch.js', 'utf8');
const dashboard = fs.readFileSync('Eye/Dart Eye.html', 'utf8');
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(), headless: true, args:['--no-sandbox','--no-process-singleton','--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage();
    const modal = dashboard.slice(dashboard.indexOf('<form id="item-add-form"'), dashboard.indexOf('</form>', dashboard.indexOf('<form id="item-add-form"')) + 7);
    assert.ok(modal.includes('dart-item-code-add'));
    await page.setContent('<div id="items"><button class="add-btn">Add</button></div><div id="item-add-modal">'+modal+'</div>');
    await page.addStyleTag({path:'Eye/dart-inventory.css'});
    await page.addScriptTag({content:`
      const $=id=>document.getElementById(id); let itemsData=[];
      const modelsData=[{modelId:'M1',cost:100}];
      const esc=String; const stamp=()=>new Date().toISOString();
      let uid=0; window.calls=[]; window.alerts=[]; window.closed=false; window.fail=false;
      window.DartDialog={alert:message=>alerts.push(message)};
      const dartAudit=()=>{}, dartRefreshAll=()=>{}, refreshFilters=()=>{};
      const closeModal=()=>{closed=true}, openEditor=()=>{};
      const IS_ADMIN=true, canReadAdmin=()=>true, serverVersion=1, catalogDirty=false;
      const norm=value=>String(value).trim().toLowerCase(), items=()=>itemsData;
      const hydrateCatalog=async()=>{}, syncAdminState=async()=>{};
      const api=async(path,options)=>{ calls.push(options.body); await new Promise(r=>setTimeout(r,30)); if(fail)throw new Error('synthetic failure'); itemsData=options.body.items; return {items:itemsData}; };
      ${admin}

      ${catalog.slice(catalog.indexOf('  async function savePhysicalItem('),catalog.indexOf('  async function persistAdminState('))}
      const C={norm,uid:()=> 'ID'+(++uid),active:row=>!!row,colors:()=>[{name:'Black'}],sizes:()=>[{name:'L'}],isServerAuthoritative:()=>true,savePhysicalItem,savePhysicalItems,items,hydrate:hydrateCatalog};
      ${inventory.slice(inventory.indexOf('  function setupItemModal()'),inventory.indexOf('  function openEditor('))}
      setupItemModal();
    `});
    await page.fill('#modal-item-model-id','M1');
    await page.selectOption('#modal-item-color','Black'); await page.selectOption('#modal-item-size','L');
    await page.fill('#modal-item-code-pic','P1'); await page.click('#dart-item-code-add');
    await page.fill('#dart-item-extra-codes input','p1');
    await page.locator('button[type=submit]').click();
    assert.equal(await page.evaluate(()=>calls.length),0);
    await page.fill('#dart-item-extra-codes input','P2');
    await page.click('#dart-item-code-add'); await page.fill('#dart-item-extra-codes .dart-item-code-row:last-child input','P3');
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(()=>closed);
    const rows = await page.evaluate(()=>calls[0].items);
    assert.equal(rows.length,3); assert.equal(new Set(rows.map(x=>x.id)).size,3);
    assert.ok(rows.every(x=>x.modelId==='M1'&&x.color==='Black'&&x.size==='L'));
    assert.deepEqual(rows.map(x=>x.itemCode),['P1','P2','P3']);
    await page.evaluate(()=>{ closed=false; fail=true; itemsData=[]; });
    await page.locator('button[type=submit]').click();
    await page.waitForFunction(()=>!document.getElementById('item-add-form').dataset.saving);
    assert.equal(await page.evaluate(()=>closed),false);
    assert.ok(await page.locator('#dart-item-save-status').textContent());
    await page.locator('#dart-item-extra-codes button').first().click();
    assert.equal(await page.locator('#dart-item-extra-codes input').count(),1);
    console.log('PASS batch editor: plus/remove, duplicate codes, shared variant, one acknowledged request, failed save stays open');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
