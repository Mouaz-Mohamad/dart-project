const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.jfif':'image/jpeg',
  '.svg':'image/svg+xml', '.ico':'image/x-icon', '.xml':'application/xml; charset=utf-8'
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = path.resolve(root, relative);
  if (!target.startsWith(`${root}${path.sep}`) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, {'Content-Type':mime[path.extname(target).toLowerCase()] || 'application/octet-stream'});
  fs.createReadStream(target).pipe(response);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (!fs.existsSync(chromium.executablePath())) {
    server.close();
    console.log('SKIP browser interaction tests (Chromium runtime is not installed)');
    return;
  }
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.alert = () => {};
    window.confirm = () => true;
    window.prompt = () => '';
    window.ApexCharts = class { render() {} updateOptions() {} };
    window.Chart = class { constructor() { return {data:{datasets:[]}, update(){}, destroy(){}}; } };
  });

  await page.goto(`${origin}/products.html`, {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => /^\d+ product/.test(document.querySelector('#productResultsCount')?.textContent || ''));
  const initialCount = Number((await page.locator('#productResultsCount').textContent()).match(/\d+/)?.[0]);
  assert(initialCount >= 3, 'The products page should render the catalog');
  assert(await page.locator('#productFiltersPanel[hidden]').count() === 1, 'Product filters should start collapsed');
  await page.locator('#toggleProductFilters').click();
  assert(await page.locator('#productFiltersPanel:not([hidden])').count() === 1, 'Filter button should open the filter panel');
  assert(await page.locator('#productSizeFilter option').count() > 1, 'Size filter options should be populated');
  assert(await page.locator('#productColorFilter option').count() > 1, 'Color filter options should be populated');

  await page.locator('#productSearchInput').fill('DA-P785');
  await page.waitForFunction(() => document.querySelector('#productResultsCount')?.textContent?.startsWith('1 product'));
  assert(await page.locator('#productsPart1 .product-card[data-id]').count() === 1, 'Code search should return the matching product');
  await page.locator('#clearProductFilters').click();
  await page.waitForFunction(expected => document.querySelector('#productsPart1 .product-card[data-id]') && Number(document.querySelector('#productResultsCount')?.textContent.match(/\d+/)?.[0]) === expected, initialCount);

  await page.evaluate(() => {
    const models = JSON.parse(localStorage.getItem('dart_models') || '[]');
    const model = models.find(row => row.modelId === 'DA-P785');
    model.sizeChart = {unit:'cm', rows:[
      {size:'32',chest:100,waist:80,hip:102,length:108,shoulder:'',sleeve:'',inseam:78,notes:'Relaxed fit'},
      {size:'34',chest:104,waist:84,hip:106,length:109,shoulder:'',sleeve:'',inseam:79,notes:'Relaxed fit'}
    ]};
    localStorage.setItem('dart_models', JSON.stringify(models));
  });
  await page.locator('#productsPart1 .product-card[data-id="1"]').click();
  await page.locator('#productSizeChartBtn').click();
  assert(await page.locator('#productSizeChartPanel:not([hidden])').count() === 1, 'The shared product size-chart dialog should open');
  assert((await page.locator('.product-size-chart-table').textContent()).includes('Relaxed fit'), 'The product chart should read the selected model data');
  await page.locator('#productSizeChartPanel').click({position:{x:4,y:4}});
  assert(await page.locator('#productSizeChartPanel[hidden]').count() === 1, 'Clicking outside the size chart should close it');
  await page.locator('#SectionModel > .fa-x').click();

  await page.locator('#productSearchInput').fill('__no_such_product__');
  await page.waitForSelector('#productsPart1 .dart-ui-state-empty');
  assert((await page.locator('#productsPart1 .dart-ui-state-empty').textContent()).includes('No products match'), 'No-result state should be visible');
  await page.locator('#clearProductFilters').click();

  await page.goto(`${origin}/Eye/Dart%20Eye.html`, {waitUntil:'domcontentloaded'});
  await page.waitForSelector('#models-container .dart-size-chart-btn');
  const modelRows = await page.locator('#models-container .model-row').count();
  const chartButtons = await page.locator('#models-container .dart-size-chart-btn').count();
  assert(modelRows === chartButtons && modelRows >= 3, 'Every model row should have one size-chart action');
  await page.locator('#models-container .model-row').filter({hasText:'DA-P785'}).locator('.dart-size-chart-btn').click();
  await page.waitForSelector('#size-chart-modal.active');
  await page.locator('#dashboard-size-chart-body [data-size-field="chest"]').first().fill('101');
  await page.locator('#dashboard-size-chart-form button[type="submit"]').click();
  await page.waitForFunction(() => {
    const model = JSON.parse(localStorage.getItem('dart_models') || '[]').find(row => row.modelId === 'DA-P785');
    return Number(model?.sizeChart?.rows?.[0]?.chest) === 101;
  });

  await page.goto(`${origin}/products.html`, {waitUntil:'domcontentloaded'});
  await page.waitForSelector('#productsPart1 .product-card[data-id="1"]');
  await page.locator('#productsPart1 .product-card[data-id="1"]').click();
  await page.locator('#productSizeChartBtn').click();
  assert((await page.locator('.product-size-chart-table').textContent()).includes('101'), 'Dashboard chart edits should appear in the shared customer template');

  assert(!pageErrors.some(message => /ReferenceError|SyntaxError|TypeError/.test(message)), `Unexpected page error: ${pageErrors.join(' | ')}`);
  await browser.close();
  server.close();
  console.log('PASS product filters and shared size-chart browser tests');
})().catch(async error => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
