// DART CODE GUIDE | tests/sets-storefront-browser.js
// Browser regression: real products/cart pages + real Sets runtime with API-backed cart/set-group rehydration.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};

const models = [
  {
    id: 'model-shirt-101', modelId: 'SHIRT-101', name: 'Campus Shirt', category: 'Shirts', description: 'Soft cotton shirt',
    selling: 700, discount: 0, createdAt: '2026-10-03T00:00:00.000Z', active: true,
    sizeChart: { unit: 'cm', rows: [{ size: 'M', chest: '96', length: '70' }, { size: 'L', chest: '102', length: '72' }] },
    sizeOptions: [{ name: 'M', active: true }, { name: 'L', active: true }],
    colorOptions: [{ name: 'Black', active: true, images: [{ id: 'shirt-black', name: 'shirt.jpg', url: '/Photos/products/1.jpg' }] }],
  },
  {
    id: 'model-pants-202', modelId: 'PANTS-202', name: 'Campus Pants', category: 'Pants', description: 'Wide-leg campus pants',
    selling: 600, discount: 0, createdAt: '2026-10-02T00:00:00.000Z', active: true,
    sizeChart: [{ size: 'M', waist: '82', inseam: '76' }, { size: 'L', waist: '88', inseam: '78' }],
    sizeOptions: [{ name: 'M', active: true }, { name: 'L', active: true }],
    colorOptions: [{ name: 'Stone', active: true, images: [{ id: 'pants-stone', name: 'pants.jpg', url: '/Photos/products/2.jpg' }] }],
  },
];

const setFixture = {
  setId: 'SET-CAMPUS-1', name: 'Campus Starter Set', category: 'Sets', description: 'University-ready shirt and pants bundle',
  images: ['/Photos/products/1.jpg'], active: true, isArchived: false, pieceCount: 2,
  components: [
    { modelId: 'SHIRT-101', name: 'Campus Shirt', quantity: 1, sizes: [{ name: 'M', active: true }, { name: 'L', active: true }], colors: [{ name: 'Black', active: true }] },
    { modelId: 'PANTS-202', name: 'Campus Pants', quantity: 1, sizes: [{ name: 'M', active: true }, { name: 'L', active: true }], colors: [{ name: 'Stone', active: true }] },
  ],
  pricing: { componentsSellingTotalMinor: 130000, basePriceMinor: 110000, discountPercent: 10, finalMinor: 99000, savingVsSeparateMinor: 31000 },
};

let cartState = null;
let setGroupsState = [];
let attachCount = 0;
let reservationWriteCount = 0;
const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = '';
    request.on('data', (chunk) => { raw += chunk; });
    request.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://test');
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith('/api/')) {
    try {
      if (pathname === '/api/v1/catalog') return json(response, 200, {
        version: 7,
        models,
        stock: {
          '["SHIRT-101","Black","M"]': 3, '["SHIRT-101","Black","L"]': 2,
          '["PANTS-202","Stone","M"]': 3,
        },
      });
      if (pathname === '/api/v1/catalog/version') return json(response, 200, { version: 7 });
      if (pathname === '/api/v1/site-settings') return json(response, 200, { version: 1, settings: {} });
      if (pathname === '/api/v1/reviews') return json(response, 200, { reviews: [] });
      if (pathname === '/api/v1/leaderboard') return json(response, 200, { rows: [], period: '2026-10' });
      if (pathname === '/api/v1/sets') return json(response, 200, { sets: [setFixture] });
      if (pathname === '/api/v1/sets/settings') return json(response, 200, { settings: { birthdayPercent: 10, dartCardPercent: 10, version: 1 } });

      if (pathname === '/api/v1/cart/reservation' && request.method === 'PUT') {
        const body = await readBody(request);
        await new Promise((resolve) => setTimeout(resolve, 150));
        reservationWriteCount += 1;
        cartState = { reservationId: String(body.reservationId), expiresAt, lines: Array.isArray(body.lines) ? body.lines : [] };
        return json(response, 200, cartState);
      }
      if (/^\/api\/v1\/cart\/reservation\/[A-Za-z0-9_-]+$/.test(pathname) && request.method === 'GET') {
        return json(response, 200, { cart: cartState });
      }
      if (/^\/api\/v1\/cart\/reservation\/[A-Za-z0-9_-]+$/.test(pathname) && request.method === 'DELETE') {
        cartState = null; setGroupsState = [];
        return json(response, 200, { released: true });
      }
      if (pathname === '/api/v1/cart/set-groups' && request.method === 'PUT') {
        const body = await readBody(request);
        attachCount += 1;
        setGroupsState = (body.groups || []).map((group, groupIndex) => ({
          id: `GROUP-SERVER-${groupIndex + 1}`,
          ...group,
          setName: setFixture.name,
          image: setFixture.images[0],
          basePriceMinor: setFixture.pricing.basePriceMinor,
          finalMinor: setFixture.pricing.finalMinor,
          discountSource: 'Set',
          discountPercent: setFixture.pricing.discountPercent,
          selections: (group.selections || []).map((selection, componentIndex) => ({
            ...selection,
            cartComponentId: `CART-COMPONENT-${groupIndex + 1}-${componentIndex + 1}`,
            componentId: `COMPONENT-${groupIndex + 1}-${componentIndex + 1}`,
            componentUnitIndex: componentIndex + 1,
          })),
        }));
        if (cartState?.lines) {
          const used = new Set();
          for (const group of setGroupsState) {
            for (const selection of group.selections) {
              const index = cartState.lines.findIndex((line, lineIndex) =>
                !used.has(lineIndex) &&
                String(line.modelId) === String(selection.modelId) &&
                String(line.color) === String(selection.color) &&
                String(line.size) === String(selection.size),
              );
              if (index < 0) continue;
              used.add(index);
              cartState.lines[index] = {
                ...cartState.lines[index],
                setGroupId: group.id,
                setId: group.setId,
                setUnitIndex: group.unitIndex,
                setCartComponentId: selection.cartComponentId,
                setComponentId: selection.componentId,
                setComponentUnitIndex: selection.componentUnitIndex,
              };
            }
          }
        }
        return json(response, 200, { reservationId: body.reservationId, groups: setGroupsState });
      }
      if (/^\/api\/v1\/cart\/set-groups\/[A-Za-z0-9_-]+$/.test(pathname) && request.method === 'GET') {
        return json(response, 200, { reservationId: pathname.split('/').pop(), groups: setGroupsState });
      }
      return json(response, 200, {});
    } catch (error) {
      return json(response, 500, { error: { message: error.message } });
    }
  }

  if (pathname === '/__test/state') {
    return json(response, 200, { cartState, setGroupsState, attachCount, reservationWriteCount });
  }

  const canonicalStaticRoutes = { '/products': 'products.html', '/cart-checkout': 'cart-checkout.html', '/profile': 'profile.html' };
  let relative = pathname === '/' ? 'index.html' : (canonicalStaticRoutes[pathname] || pathname.replace(/^\//, ''));
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.statusCode = 403; response.end(); return;
  }
  try {
    response.setHeader('Content-Type', contentTypes[path.extname(filename).toLowerCase()] || 'application/octet-stream');
    response.end(fs.readFileSync(filename));
  } catch {
    response.statusCode = 404; response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath)) throw new Error('Install Chromium or set CHROMIUM_EXECUTABLE.');
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
  await context.route('**/*', (route) => route.request().url().startsWith(origin) ? route.continue() : route.abort());

  const failures = [];
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().startsWith(origin) && response.status() >= 400) failures.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('console', (message) => {
    if (message.type() !== 'error' || message.text().startsWith('Failed to load resource:')) return;
    if (String(message.location()?.url || '').startsWith(origin)) failures.push(`console: ${message.text()}`);
  });

  await page.goto(`${origin}/products`, { waitUntil: 'domcontentloaded' });
  await page.locator('#toggleProductFilters').click();
  await page.locator('#filterContainer .filter-btn[data-category="Sets"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelectorAll('[data-dart-set-card="1"]').length === 1);
  await page.waitForFunction(() => document.getElementById('productResultsCount')?.textContent === '3 products');
  assert.equal(await page.locator('#productsPart1 .product-card[data-id="SHIRT-101"], #productsPart1 .product-card[data-id="PANTS-202"]').count(), 2, 'Models remain in the primary Products grid');
  assert.equal(await page.locator('#productsPart1 [data-dart-set-card="1"][data-dart-set-id="SET-CAMPUS-1"]').count(), 1, 'Set must be listed beside normal products, not deferred to productsPart2');

  // Normal product filters still belong to Models and continue to work.
  await page.locator('#productSearchInput').fill('Campus Shirt');
  await page.waitForFunction(() => document.getElementById('productResultsCount')?.textContent === '1 product');
  assert.equal(await page.locator('#productsPart1 .product-card[data-id]:visible, #productsPart2 .product-card[data-id]:visible').count(), 1);
  assert.equal(await page.locator('[data-dart-set-card="1"]:visible').count(), 0, 'Set must respect search while normal Models filter remains functional');
  await page.locator('#clearProductFilters').click();
  await page.waitForFunction(() => document.getElementById('productResultsCount')?.textContent === '3 products');

  // Sort order is shared across Models and Sets, not one order per product kind.
  await page.locator('#productSortSelect').selectOption('price-high');
  await page.waitForFunction(() => document.querySelector('#productsPart1 > .product-card:not(#productTemplate)')?.dataset.dartSetId === 'SET-CAMPUS-1');
  assert.equal((await page.locator('#productsPart1 > .product-card:not(#productTemplate)').first().locator('.product-title').textContent()).trim(), 'Campus Starter Set');
  await page.locator('#productSortSelect').selectOption('price-low');
  await page.waitForFunction(() => document.querySelector('#productsPart1 > .product-card:not(#productTemplate)')?.dataset.id === 'PANTS-202');

  // Price facets include Set prices as first-class catalogue prices (Set is 990 EGP after its own 10% discount, Models top out at 700 EGP).
  const setPriceRange = await page.locator('#productPriceFilter option').evaluateAll((options) => {
    const setPrice = 990;
    return options.map((option) => option.value).find((value) => {
      const match = value.match(/^range:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
      return match && setPrice >= Number(match[1]) && setPrice <= Number(match[2]);
    }) || '';
  });
  assert.ok(setPriceRange, 'Shared price filter must include a range that covers the Set price');
  await page.locator('#productPriceFilter').selectOption(setPriceRange);
  await page.waitForFunction(() => document.querySelector('[data-dart-set-id="SET-CAMPUS-1"]')?.offsetParent !== null);
  await page.locator('#clearProductFilters').click();
  await page.waitForFunction(() => document.getElementById('productResultsCount')?.textContent === '3 products');

  // Sets is a normal category inside the same filter pipeline.
  await page.locator('#filterContainer .filter-btn[data-category="Sets"]').click();
  await page.waitForFunction(() => document.getElementById('productResultsCount')?.textContent === '1 product');
  assert.equal(await page.locator('#productsPart1 .product-card[data-id]:visible, #productsPart2 .product-card[data-id]:visible').count(), 0);
  const setCard = page.locator('[data-dart-set-card="1"][data-dart-set-id="SET-CAMPUS-1"]');
  await setCard.waitFor({ state: 'visible' });
  assert.notEqual((await setCard.locator('.stock-badge').textContent()).trim(), 'Sold Out', 'An unavailable offered size must not hide a purchasable Set');

  // Whole-card interaction opens the real Set modal; every physical component has its own variant selectors.
  await setCard.locator('.product-title').click();
  await page.locator('#dartSetModal:not([hidden])').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#dartSetModal .dart-set-component').count(), 2);
  assert.equal(await page.locator('#dartSetModal [data-set-color]').count(), 2);
  assert.equal(await page.locator('#dartSetModal [data-set-size]').count(), 2);
  assert.match(await page.locator('#dartSetModal [data-set-status]').textContent(), /2 pieces ready to add together/);
  assert.equal(await page.locator('#dartSetModal [data-set-wait]').count(), 0, 'Sets must not expose Waiting');
  assert.equal(await page.locator('#dartSetModal .dart-set-piece-code').count(), 2, 'Each model code must sit below its piece image');
  assert.deepEqual(await page.locator('#dartSetModal .dart-set-details').evaluate((details) => {
    const children = [...details.children];
    return {
      codeBeforeCategory: children.indexOf(details.querySelector('[data-set-code]')) < children.indexOf(details.querySelector('.dart-set-category')),
      pricingBeforeComponents: children.indexOf(details.querySelector('.dart-set-pricing')) < children.indexOf(details.querySelector('[data-set-components]')),
      componentsBeforeDescription: children.indexOf(details.querySelector('[data-set-components]')) < children.indexOf(details.querySelector('[data-set-description]')),
      descriptionBeforeButton: children.indexOf(details.querySelector('[data-set-description]')) < children.indexOf(details.querySelector('[data-set-add]')),
    };
  }), { codeBeforeCategory: true, pricingBeforeComponents: true, componentsBeforeDescription: true, descriptionBeforeButton: true });
  assert.equal((await page.locator('#dartSetModal [data-set-price]').textContent()).trim(), '990 EGP');
  assert.equal((await page.locator('#dartSetModal [data-set-old-price]').textContent()).trim(), 'Pieces separately: 1,300 EGP');
  assert.equal(await page.locator('#dartSetModal [data-set-old-price]').isVisible(), true);
  assert.equal(await page.locator('#dartSetModal .dart-set-close').evaluate((node) => getComputedStyle(node).width), '40px');
  assert.equal(await page.locator('#dartSetModal .dart-set-carousel').evaluate((node) => getComputedStyle(node).aspectRatio), '3 / 4');
  assert.equal(await page.locator('#dartSetModal .dart-set-piece-image img').first().evaluate((node) => getComputedStyle(node).aspectRatio), '9 / 16');
  assert.equal(await page.locator('#dartSetModal .dart-set-option-label').count(), 0, 'Color and Size headings must not consume space');
  assert.equal(await page.locator('#dartSetModal [data-set-size-chart-trigger]').count(), 2, 'Every Set model has its own chart action');
  await page.locator('#dartSetModal [data-set-size-chart-trigger]').first().click();
  assert.match(await page.locator('#dartSetSizeChartPanel [data-set-size-chart-title]').textContent(), /Campus Shirt/);
  assert.deepEqual(await page.locator('#dartSetSizeChartPanel thead th').allTextContents(), ['Size', 'Chest (cm)', 'Length (cm)']);
  assert.deepEqual(await page.locator('#dartSetSizeChartPanel tbody tr').first().locator('td').allTextContents(), ['M', '96', '70']);
  await page.locator('#dartSetSizeChartPanel [data-set-size-chart-close]').click();
  assert.equal(await page.locator('#dartSetSizeChartPanel').isHidden(), true);
  await page.locator('#dartSetModal [data-set-size-chart-trigger]').last().click();
  assert.match(await page.locator('#dartSetSizeChartPanel [data-set-size-chart-title]').textContent(), /Campus Pants/);
  assert.deepEqual(await page.locator('#dartSetSizeChartPanel thead th').allTextContents(), ['Size', 'Waist (cm)', 'Inseam (cm)']);
  assert.deepEqual(await page.locator('#dartSetSizeChartPanel tbody tr').first().locator('td').allTextContents(), ['M', '82', '76']);
  await page.locator('#dartSetSizeChartPanel [data-set-size-chart-close]').press('Escape');
  assert.equal(await page.locator('#dartSetSizeChartPanel').isHidden(), true);

  // Add-to-cart reserves both physical pieces, then attaches one commercial Set group to that same reservation.
  await page.evaluate(() => {
    const button = document.querySelector('#dartSetModal [data-set-add]');
    button.click();
    button.click();
  });
  await page.waitForFunction(() => {
    const button = document.querySelector('#dartSetModal [data-set-add]');
    return button?.disabled && button.getAttribute('aria-busy') === 'true';
  });
  assert.equal(await page.locator('.cart-count, #cartCount').first().textContent(), '1', 'One commercial Set must appear in the cart count before the reservation response');
  await page.waitForFunction(() => document.getElementById('dartSetModal')?.hidden === true);
  await page.waitForFunction(() => (window.DartState?.read?.('dart_cart', []) || []).length === 2);
  const clientCart = await page.evaluate(() => ({
    lines: window.DartState.read('dart_cart', []).map((line) => ({ id: line.id, color: line.color, size: line.size, key: line.dartSetKey })),
    groups: window.DartSets.readDrafts(),
    reservationId: window.DartSets.currentReservationId(),
  }));
  assert.equal(clientCart.lines.length, 2);
  assert.equal(new Set(clientCart.lines.map((line) => line.key)).size, 1);
  assert.equal(clientCart.groups.length, 1);
  assert.equal(clientCart.groups[0].selections.length, 2);

  const serverAfterAdd = await (await fetch(`${origin}/__test/state`)).json();
  assert.equal(serverAfterAdd.cartState.lines.length, 2, 'Server reservation must contain both physical pieces');
  assert.equal(serverAfterAdd.setGroupsState.length, 1, 'Server must persist one Set commercial group');
  assert.equal(serverAfterAdd.setGroupsState[0].selections.length, 2);
  assert.equal(serverAfterAdd.attachCount, 1);
  assert.equal(serverAfterAdd.reservationWriteCount, 1, 'A double click must create only one Set reservation write');

  // Prove reload/cross-page recovery comes from server group identity, not only the local Set draft.
  await page.evaluate(() => sessionStorage.removeItem('dart_cart_set_groups_v1'));
  await page.goto(`${origin}/cart-checkout.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.DartPlatform?.__dartSetsReserveWrapped === true);
  await page.waitForFunction(() => document.querySelectorAll('#cartItemsContainer [data-dart-set-cart-card="1"]').length === 1);
  await page.waitForTimeout(250);
  const groupedCart = await page.evaluate(() => ({
    groupedCards: document.querySelectorAll('#cartItemsContainer [data-dart-set-cart-card="1"]').length,
    visibleBaseCards: [...document.querySelectorAll('#cartItemsContainer .cart-product-card:not(#cartItemTemplate):not([data-dart-set-cart-card="1"])')]
      .filter((node) => getComputedStyle(node).display !== 'none').length,
    draftGroups: window.DartSets.readDrafts().length,
    cartLines: (window.DartState.read('dart_cart', []) || []).length,
    title: document.querySelector('#cartItemsContainer [data-dart-set-cart-card="1"] .cart-product-title')?.textContent?.trim(),
    specs: document.querySelector('#cartItemsContainer [data-dart-set-cart-card="1"] .dart-set-cart-specs')?.textContent || '',
  }));
  assert.deepEqual(groupedCart, {
    groupedCards: 1,
    visibleBaseCards: 0,
    draftGroups: 1,
    cartLines: 2,
    title: 'Campus Starter Set',
    specs: 'SHIRT-101: Black / M · PANTS-202: Stone / M',
  }, 'Set cart grouping must rehydrate from server after local Set draft loss');

  // A delayed generic cart rerender must not split the Set or let a 40% Dart Card override the Set's own 10% price.
  await page.evaluate(() => {
    const customer = { customerId: 'DR-SET-TEST' };
    window.DartPlatform.currentUser = () => customer;
    window.DartPlatform.activeBirthdayReward = () => null;
    window.DartPlatform.activeDartCard = () => ({
      cardId: 'CARD-40', clientId: customer.customerId, status: 'Active',
      discountPercent: 40, itemLimit: 10, purchasedItems: 0,
    });
    window.setTimeout(() => window.renderCart(), 50);
  });
  await page.waitForTimeout(180);
  const delayedRender = await page.evaluate(() => ({
    groupedCards: document.querySelectorAll('#cartItemsContainer [data-dart-set-cart-card="1"]').length,
    visibleBaseCards: [...document.querySelectorAll('#cartItemsContainer .cart-product-card:not(#cartItemTemplate):not([data-dart-set-cart-card="1"])')]
      .filter((node) => getComputedStyle(node).display !== 'none').length,
    subtotal: document.getElementById('subtotalVal')?.textContent?.trim(),
    discount: document.getElementById('discountVal')?.textContent?.trim(),
    total: document.getElementById('totalVal')?.textContent?.trim(),
    discountInput: document.getElementById('discountInput')?.value,
    appliedPromotion: window.dartAppliedPromotion?.type || null,
  }));
  assert.deepEqual(delayedRender, {
    groupedCards: 1,
    visibleBaseCards: 0,
    subtotal: '1100 EGP',
    discount: '110 EGP',
    total: '990 EGP',
    discountInput: 'SET 10% — AUTO',
    appliedPromotion: null,
  }, 'Delayed cart renders must preserve Set identity and Set discount priority over Dart Card');

  // A real page reload remains grouped and must not attach duplicate Set groups.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelectorAll('#cartItemsContainer [data-dart-set-cart-card="1"]').length === 1);
  const serverAfterReload = await (await fetch(`${origin}/__test/state`)).json();
  assert.equal(serverAfterReload.setGroupsState.length, 1);
  assert.equal(serverAfterReload.attachCount, 1, 'Read-only rehydration must not duplicate/reattach Set groups');

  assert.deepEqual(failures, []);
  console.log('PASS Sets storefront browser: unified Products listing/filter/sort, Set category, full-card modal, atomic two-piece cart reservation, Set discount priority through delayed rerenders, server Set-group snapshot and reload rehydration.');
  await context.close(); await browser.close(); server.close();
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
