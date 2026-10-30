// Exercise real Brand handlers in a browser with synthetic server responses.
const fs = require('node:fs'), http = require('node:http'), path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const markup = fs.readFileSync(path.join(root, 'Eye/Dart Eye.html'), 'utf8');
const cards = markup.slice(markup.indexOf('<div id="dart-analytics-grid"'), markup.indexOf('<section id="dart-brand-insights"'));
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/Eye/dart-dashboard-ui.css"></head><body><main id="brand">
  <div class="sales-cont"><h4>Total Selling</h4><span class="sales">500 EGP</span></div><div class="cost-cont"><h4>Owner Total Cost</h4></div><div class="profit-cont"><h4>Total Profit</h4></div>${cards}</main>
  <script src="/fixture.js"></script><script src="/Eye/dart-brand-details.js"></script></body></html>`;
const fixture = `
window.fixture={permissions:null,offline:false,empty:false,hold:false,pending:[],requests:[],start:'2026-10-01'};
window.DartAdminAccess={can:key=>!fixture.permissions||fixture.permissions.includes(key)};
window.DartFinance={currentRangeSelection:()=>({start:fixture.start,end:'2026-10-30',label:'October 2026'})};
window.DartAdminApi={request:async url=>{
  fixture.requests.push(url);const metric=url.split('/').at(-1).split('?')[0],query=new URL(url,location.origin).searchParams;
  if(fixture.hold)await new Promise(resolve=>fixture.pending.push(resolve));
  if(fixture.offline)throw new Error('private server diagnostic');
  const row={key:'M1',name:'Hoodie <script>bad()</script>',total:10,stock:3,waiting:7,sold:5,returned:1,damaged:2,share:100,unitSellingMinor:45000,sellingMinor:135000,costMinor:90000,idleDays:16,lastSale:'2026-10-14'};
  if(metric==='overview')return {totals:{sellingMinor:135000,costMinor:90000,lowStock:1,deadStock:1},salesVisible:true,top:{models:row,colors:{...row,name:'Black'},sizes:{...row,name:'M'}}};
  const ledger=['sales','cost','profit','damage'].includes(metric);
  const rows=ledger?[{id:'order:1',reference:'O1',date:'2026-10-10',source:'Delivered order',amountMinor:50001,lane:'income',details:{order:'O1',pieces:1}},{id:'expense:1',reference:'E1',date:'2026-10-11',source:'Operating expense',amountMinor:10001,lane:'outgoing',details:{description:'Packaging'}}]:[row];
  return {metric,page:Number(query.get('page')),limit:100,total:fixture.empty?0:metric==='models'?101:rows.length,rows:fixture.empty?[]:rows,waitingVisible:true,salesVisible:true,
   totals:{amountMinor:40000,incomeMinor:50001,costMinor:90000,sellingMinor:135000,pieces:3,models:1}};
}};`;
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://fixture').pathname;
  if (name === '/') return res.setHeader('Content-Type', 'text/html'), res.end(html);
  if (name === '/fixture.js') return res.setHeader('Content-Type', 'text/javascript'), res.end(fixture);
  const file = path.resolve(root, name.slice(1));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', name.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404).end(); }
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE || chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
  try {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
    await page.goto(origin);
    const modal = page.locator('#dart-brand-details-dialog');
    await page.waitForFunction(() => document.getElementById('brand-in-stock-selling-value').textContent.includes('1,350'));
    assert.equal(await page.locator('[data-brand-drilldown]').count(), 11);
    for (const width of [370, 480, 767, 768, 1440]) {
      await page.setViewportSize({width,height:900});
      await page.locator('#brand-top-model-card').click();
      await modal.locator('table').waitFor();
      const bounds = await modal.boundingBox();
      assert.ok(Math.abs(bounds.width - width * .9) < 2);
      assert.ok(Math.abs(bounds.height - 810) < 2);
      assert.ok(Math.abs(bounds.x - width * .05) < 2);
      assert.ok(Math.abs(bounds.y - 45) < 2);
      assert.ok((await modal.textContent()).includes('Waiting pieces'));
      assert.equal(await modal.locator('tbody td').nth(2).textContent(), '7');
      assert.equal(await modal.locator('script').count(), 0, 'record labels must remain escaped');
      if (width === 1440) await page.screenshot({path:'/tmp/dart-brand-desktop.png'});
      if (width === 370) await page.screenshot({path:'/tmp/dart-brand-mobile.png'});
      await modal.locator('[data-brand-page="2"]').click();
      await page.waitForFunction(() => document.querySelector('.dart-brand-pagination').textContent.includes('Page 2'));
      await modal.locator('[data-brand-row]').click();
      await modal.locator('dl').waitFor();
      await page.goBack();
      await modal.locator('table').waitFor();
      await page.goBack();
      await modal.waitFor({state:'hidden'});
      assert.equal(await page.evaluate(() => document.activeElement.id), 'brand-top-model-card');
      await page.goForward();
      await modal.locator('table').waitFor();
      await page.keyboard.press('Escape');
      await modal.waitFor({state:'hidden'});
    }
    for (const metric of ['sales','profit','cost','stockSelling','stockCost','damage','colors','sizes','lowStock','deadStock']) {
      await page.locator(`[data-brand-drilldown="${metric}"]`).click();
      await modal.locator('table').first().waitFor();
      if (metric === 'profit') assert.equal(await modal.locator('.dart-brand-ledger-halves > section').count(), 2);
      await modal.locator('[data-brand-close]').click();
      await modal.waitFor({state:'hidden'});
    }
    await page.locator('#brand-top-model-card').focus();
    await page.keyboard.press('Enter');
    await modal.locator('table').waitFor();
    await page.evaluate(() => {fixture.offline=true;fixture.start='2026-10-02';window.dispatchEvent(new Event('dart:finance-period-changed'));});
    await modal.locator('[role="alert"]').waitFor();
    assert.ok(!(await modal.textContent()).includes('private server diagnostic'));
    await page.evaluate(() => {fixture.offline=false;fixture.empty=true;});
    await modal.locator('[data-brand-retry]').click();
    await modal.locator('.dart-brand-empty').waitFor();
    await page.keyboard.press('Escape');
    await modal.waitFor({state:'hidden'});
    await page.evaluate(() => {fixture.empty=false;fixture.hold=true;fixture.start='2026-10-03';});
    await page.locator('#brand-top-model-card').click();
    await modal.locator('[role="status"]').waitFor();
    await page.goBack();
    await page.evaluate(() => {fixture.hold=false;fixture.pending.splice(0).forEach(resolve=>resolve());});
    await modal.waitFor({state:'hidden'});
    await page.evaluate(() => {fixture.permissions=[];window.dispatchEvent(new Event('dart:admin-logged-out'));});
    await page.locator('#brand-top-model-card').click();
    assert.equal(await modal.isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('PASS Brand drilldowns: 11 cards, 5 widths, history/back/forward, nested records, pagination, keyboard, error/retry, empty, late responses and denied access');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode=1; });
