const { openStorefrontFixture } = require("./helpers/storefront-fixture.cjs");
// DART CODE GUIDE | tests/full-site-browser.js
// الغرض: اختبار Frontend/Contract يثبت أن الواجهة والعقود الأساسية ما زالت تعمل كما هو متوقع.
/* BEGIN Full-site smoke test — navigation, shared sections, controls and local requests. */
const fs = require("fs");
const path = require("path");
const http = require("http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
  if (pathname.startsWith("/api/")) {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    const payload =
      pathname === "/api/v1/health/live"
        ? {
            status: "ok",
            apiCompatibility: "dart-database-v1",
            capabilities: [
              "staff-onboarding-v1",
              "staff-google-auth-v1",
              "staff-email-access-v1",
              "dashboard-domain-state-v1",
              "bulk-domain-state-v1",
            ],
          }
        : pathname === "/api/v1/auth/social/providers"
          ? { providers: { google: false, facebook: false } }
        : pathname === "/api/v1/me"
          ? {
              user: { id: "owner", accountType: "staff", name: "CI Owner" },
              session: { mfaRequired: false, mfaSatisfied: true },
              permissions: [
                "settings.manage",
                "catalog.manage",
                "orders.read",
                "orders.manage",
                "dashboard_state.read",
                "finance.read",
                "staff.read",
                "staff.manage",
                "analytics.read",
              ],
            }
          : pathname.startsWith("/api/v1/admin/finance/summary")
            ? {
                summary: {
                  grossRevenue: 0, refunds: 0, netRevenue: 0,
                  grossCogs: 0, cogsReversal: 0, netCogs: 0,
                  operatingExpenses: 0, codFees: 0, damageLoss: 0,
                  damageValue: 0, returnCourierCosts: 0, deliveryCosts: 0,
                  totalOperatingExpenses: 0, totalCost: 0,
                  grossProfit: 0, netProfit: 0, physicalItemCost: 0,
                  incrementalDamage: 0, brandTotalCost: 0, brandNetProfit: 0,
                  margin: 0, grossMargin: 0, deliveredOrders: 0,
                  grossSoldUnits: 0, returnedUnits: 0, soldUnits: 0,
                  averageOrderValue: 0, uniqueCustomers: 0,
                  returningCustomers: 0, oneTimeCustomers: 0, repeatRate: 0,
                  cashIn: 0, cashOut: 0, netCashFlow: 0,
                  paidExpenseCashOut: 0, refundCashOut: 0,
                  marketing: {
                    spend: 0, revenue: 0, roas: 0, cac: 0, ctr: 0,
                    cpc: 0, conversion: 0, impressions: 0, clicks: 0, orders: 0,
                  },
                },
              }
          : pathname === "/api/v1/site-settings"
            ? { version: 1, settings: {} }
            : pathname === "/api/v1/admin/catalog-state"
              ? { version: 1, models: [], items: [] }
              : pathname === "/api/v1/admin/orders-state"
                ? { version: 1, orders: [] }
                : pathname === "/api/v1/admin/domain-state"
                  ? { domains: [] }
                  : pathname === "/api/v1/admin/audit"
                    ? { audit: [] }
                    : pathname === "/api/v1/admin/domain-state-versions"
                      ? { versions: {} }
                      : pathname === "/api/v1/catalog"
                        ? { version: 1, models: [], stock: {} }
                        : pathname === "/api/v1/reviews"
                          ? { reviews: [] }
                          : {};
    if (pathname === "/api/v1/admin/analytics/traffic") {
      const query = new URL(request.url, "http://test").searchParams;
      response.end(JSON.stringify({ start:query.get('start'),end:query.get('end'),group:query.get('group'),
        summary:{uniqueVisitors:1,visits:2},series:[],visitors:[{name:'visit-1',type:'Guest',visits:2,
          firstVisit:'2026-01-01T12:00:00Z',lastVisit:'2026-10-22T12:00:00Z'}] }));
      return;
    }
    if (pathname === "/api/v1/admin/finance/report") {
      const query = new URL(request.url, "http://test").searchParams;
      const current = { start: query.get("start"), end: query.get("end") };
      const previous = { start: query.get("previousStart"), end: query.get("previousEnd") };
      const ranges = [current, previous];
      const start = Date.parse(current.start), end = Date.parse(current.end);
      const step = Math.max(1, Math.ceil(((end - start) / 86400000 + 1) / 12));
      for (let day = start; day <= end; day += step * 86400000) ranges.push({
        start: new Date(day).toISOString().slice(0, 10), end: new Date(Math.min(end, day + (step - 1) * 86400000)).toISOString().slice(0, 10),
      });
      response.end(JSON.stringify({ allowedSections: ["revenue", "cost", "profit", "cashflow", "inventory", "marketing"],
        periods: ranges.map(range => ({ ...range, summary: { netRevenue: 0, brandTotalCost: 0, brandNetProfit: 0,
          orderFrequencyBuckets: {oneOrder:0,twoOrders:0,threeOrders:0,fourOrders:0,fivePlusOrders:0}, marketing: {} } })) }));
      return;
    }
    response.end(JSON.stringify(payload));
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.statusCode = 403;
    response.end();
    return;
  }
  try {
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    );
    response.end(openStorefrontFixture(filename, fs.readFileSync(filename)));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath =
    process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
  if (!fs.existsSync(executablePath))
    throw new Error("Install Chromium or set CHROMIUM_EXECUTABLE.");
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => {
    document.addEventListener('dart:sections-loaded', () => { window.__sectionsLoaded = true; });
  });
  const failures = [];
  await context.route("**/*", (route) =>
    route.request().url().startsWith(origin) ? route.continue() : route.abort(),
  );

  async function open(relativeUrl) {
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      failures.push(`${relativeUrl}: ${error.message}`),
    );
    page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) return;
      const source = String(message.location()?.url || "");
      if (!source.startsWith(origin)) return;
      failures.push(
        `${relativeUrl}: console ${message.type()} ${message.text()} (${source})`,
      );
    });
    page.on("requestfailed", (request) => {
      const errorText = request.failure()?.errorText || "unknown";
      // A real navigation/redirect is allowed to abort in-flight fragment requests.
      if (errorText.includes("ERR_ABORTED")) return;
      if (request.url().startsWith(origin)) {
        failures.push(
          `${relativeUrl}: request failed ${request.url()} (${errorText})`,
        );
      }
    });
    page.on("response", (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400)
        failures.push(`${relativeUrl}: ${response.status()} ${response.url()}`);
    });
    const response = await page.goto(`${origin}/${relativeUrl}`, {
      waitUntil: "domcontentloaded",
    });
    assert.equal(response.status(), 200, `${relativeUrl} must load`);
    return page;
  }

  const sharedPages = [
    "index.html",
    "products.html",
    "about.html",
    "Contact%20us.html",
    "cart-checkout.html",
    "policies.html",
  ];
  for (const relativeUrl of sharedPages) {
    const page = await open(relativeUrl);
    await page.waitForSelector("#header-container .hedar-nav");
    await page.waitForSelector("#footer .footer-continear");
    assert.equal(await page.locator("#header-container .hedar-nav").count(), 1);
    assert.equal(await page.locator("#header-container .dart-nav-icon").count(), 1);
    assert.equal(await page.locator("#header-container .icon-menu").count(), 1);
    assert.equal(await page.locator("#header-container .social-icons svg").count(), 5);
    assert.equal(await page.locator("#footer .footer-continear").count(), 1);
    if (relativeUrl === 'index.html') await page.waitForFunction(() => window.__sectionsLoaded);
    await page.close();
  }

  const home = await open("index.html");
  await home.waitForSelector("#header-container .icon-menu");
  await home.locator("#header-container .icon-menu").click();
  assert.equal(await home.locator("#header-container .side-menu").evaluate((node) => node.classList.contains("active")), true);
  await home.locator("main").click({ position: { x: 2, y: 2 } });
  assert.equal(await home.locator("#header-container .side-menu").evaluate((node) => node.classList.contains("active")), false);
  await home.waitForFunction(() => window.__sectionsLoaded);
  await home.close();

  const products = await open("products.html");
  const filterButton = products.locator("#toggleProductFilters");
  await filterButton.click();
  assert.equal(await filterButton.getAttribute("aria-expanded"), "true");
  assert.equal(await products.locator("#productFiltersPanel").isVisible(), true);
  await filterButton.click();
  assert.equal(await filterButton.getAttribute("aria-expanded"), "false");
  await products.close();

  const account = await open("Sign%20Up%20modern.html");
  assert.ok(
    (await account.locator(".dart-auth-icon").count()) >= 7,
    "customer auth controls must render local SVG icons",
  );
  await account.locator(".register-btn").click();
  assert.equal(await account.locator(".container").evaluate((node) => node.classList.contains("active")), true);
  await account.waitForFunction(() => {
    const input = document.querySelector('#registerForm input[name="password"]');
    return input?.getAttribute("minlength") === "6" && !input?.hasAttribute("pattern");
  });
  assert.equal(await account.locator('#registerForm input[name="password"]').getAttribute("minlength"), "6");
  assert.equal(await account.locator('#registerForm input[name="password"]').getAttribute("pattern"), null);
  assert.equal(await account.locator('#registerForm input[name="birthday"]').getAttribute("required"), "");
  assert.equal(await account.locator('[data-social-login="google"]').count(), 0);
  assert.equal(await account.locator('[data-social-login="facebook"]').count(), 2);
  await account.waitForSelector('script[data-dart-social-auth="1"]', { state: "attached" });
  assert.equal(await account.locator('#customerEmailVerificationForm').count(), 0);
  await account.locator(".login-btn").click();
  assert.equal(await account.locator(".container").evaluate((node) => node.classList.contains("active")), false);
  await account.close();

  const profile = await open("profile.html");
  await profile.waitForURL(/Sign%20Up%20modern\.html\?next=profile$/);
  await profile.close();

  const rep = await open("rep.html");
  await rep.locator("#repRegisterTab").click();
  assert.equal(await rep.locator("#repRegisterForm").isVisible(), true);
  await rep.locator("#repLoginTab").click();
  assert.equal(await rep.locator("#repLoginForm").isVisible(), true);
  await rep.close();

  const tracking = await open("track.html");
  assert.equal(
    await tracking.locator("#order-tracking-card-template").evaluate(
      (template) => template.content.querySelectorAll("[data-order-map-shell]").length,
    ),
    1,
  );
  await tracking.close();

  const dashboard = await open("Eye/Dart%20Eye.html");
  assert.equal(await dashboard.locator("#dart-admin-auth").count(), 1);
  assert.equal(
    await dashboard.locator(".menu").evaluate((node) => getComputedStyle(node).overflowY),
    "scroll",
    "dashboard sidebar must keep its scrollable navigation after CSS compatibility cleanup",
  );
  // Authentication has dedicated backend/frontend contract coverage. This smoke suite
  // verifies the dashboard DOM and navigation without depending on a seeded Owner account.
  await dashboard.evaluate(() => {
    document.body.classList.remove("dart-admin-locked");
    const gate = document.getElementById("dart-admin-auth");
    if (gate) gate.hidden = true;
  });
  assert.equal(await dashboard.locator(".dashboard-section.active-section").getAttribute("id"), "brand");
  assert.equal(
    await dashboard.locator('[data-sales-year-delta="-1"]').count(),
    1,
    "dashboard must render the previous-year control without inline handlers",
  );
  assert.equal(
    await dashboard.locator('[data-sales-year-delta="1"]').count(),
    1,
    "dashboard must render the next-year control without inline handlers",
  );
  assert.equal(await dashboard.locator("link[rel='manifest']").count(), 1);
  await dashboard.evaluate(() => {
    const control = [...document.querySelectorAll('a[data-target="settings"]')].find(Boolean);
    control?.click();
  });
  assert.equal(await dashboard.locator("#settings-content").getAttribute("data-active-settings-tab"), "general");
  await dashboard.locator('#settings-search').fill('Order verification policy');
  assert.equal(await dashboard.locator('#settings-cod-risk-card').isVisible(),true);
  assert.equal(await dashboard.locator('#settings-commerce-card').isVisible(),false);
  await dashboard.locator('#settings-search').fill('');
  await dashboard.locator('#settings-default-markup').fill('57');
  await dashboard.evaluate(()=>window.dispatchEvent(new CustomEvent('dart:site-settings-changed',{detail:window.DartSiteSettings.get()})));
  assert.equal(await dashboard.locator('#settings-default-markup').inputValue(),'57','background settings refresh preserves an unsaved field');
  await dashboard.locator('#settings-display-density').selectOption('compact');
  await dashboard.locator('#settings-display-form [type="submit"]').click();
  assert.equal(await dashboard.locator('body').getAttribute('data-dart-density'),'compact');
  assert.equal(await dashboard.evaluate(()=>window.DartDisplayPreferences.get().density),'compact');
  await dashboard.locator('#settings-display-reset').click();
  assert.equal(await dashboard.locator('body').getAttribute('data-dart-density'),'comfortable');
  await dashboard.evaluate(() => {
    document.querySelector('[data-settings-tab="hero"]')?.click();
  });
  assert.equal(await dashboard.locator("#settings-content").getAttribute("data-active-settings-tab"), "hero");
  assert.equal(await dashboard.locator("#settings-typing-card").isVisible(), true);
  assert.equal(await dashboard.locator("#settings-commerce-card").isVisible(), false);
  // Staff stays inside Settings; account details and permissions open only on selection.
  const staffFixture={canManageStaff:true,permissions:[{key:'orders.read',description:'View orders'},{key:'orders.manage',description:'Manage orders'},{key:'profile.read_own',description:'View own profile'}],staff:[
    {id:'staff-a',name:'Fixture A',email:'a@example.test',staffCode:'STA',status:'Active',permissions:['orders.read'],emailVerified:true},
    {id:'staff-b',name:'Fixture B',email:'b@example.test',staffCode:'STB',status:'Active',permissions:[],emailVerified:true},
    {id:'owner',name:'Protected Owner',email:'owner@example.test',staffCode:'OWNER',status:'Active',permissions:[],isOwner:true,emailVerified:true}
  ],invitations:[{id:'pending-a',email:'pending@example.test',role:'staff',accessMode:'email_otp',status:'pending'}]};
  let staffWrites=0;
  await dashboard.route('**/api/v1/admin/staff',route=>route.fulfill({contentType:'application/json',body:JSON.stringify(staffFixture)}));
  await dashboard.route('**/api/v1/admin/staff/staff-a/permissions',async route=>{
    staffWrites+=1;assert.equal(route.request().method(),'PUT');
    staffFixture.staff[0].permissions=route.request().postDataJSON().permissionKeys;
    await route.fulfill({contentType:'application/json',body:'{}'});
  });
  await dashboard.evaluate(()=>window.dispatchEvent(new Event('dart:admin-authenticated')));
  await dashboard.waitForFunction(()=>document.querySelectorAll('#settings-staff-list [data-staff-id]').length===3);
  await dashboard.locator('[data-settings-tab="staff"]').click();
  assert.equal(await dashboard.locator('.dart-staff-member-body').count(),0);
  assert.equal(await dashboard.locator('#settings-staff-invite-form').isVisible(),false);
  await dashboard.locator('[data-staff-id="staff-a"] [data-staff-action="view"]').click();
  assert.equal(await dashboard.locator('.dart-staff-member-body').count(),1);
  const staffA=dashboard.locator('[data-staff-id="staff-a"]');
  for(const action of ['permissions','toggle-access','revoke-sessions'])assert.equal(await staffA.locator(`[data-staff-action="${action}"]`).count(),1);
  await staffA.locator('.dart-staff-permission-group summary').first().click();
  await staffA.locator('input[value="orders.manage"]').check();
  await dashboard.locator('[data-staff-id="staff-b"] [data-staff-action="view"]').click();
  assert.equal(await dashboard.locator('.dart-staff-member-body').count(),1);
  await dashboard.locator('[data-staff-id="staff-a"] [data-staff-action="view"]').click();
  assert.equal(await staffA.locator('input[value="orders.manage"]').isChecked(),true,'employee drafts stay with the correct employee');
  await staffA.locator('[data-staff-action="permissions"]').click();
  await dashboard.waitForFunction(()=>document.querySelector('[data-staff-id="staff-a"]')?.getAttribute('aria-busy')==='false');
  assert.equal(staffWrites,1);assert.ok(staffFixture.staff[0].permissions.includes('orders.manage'));
  const staffChecks=path.join(root,'..','checks');fs.mkdirSync(staffChecks,{recursive:true});
  for(const width of [390,1366]){
    await dashboard.setViewportSize({width,height:900});
    await dashboard.locator('#settings-staff-access-card').scrollIntoViewIfNeeded();
    await dashboard.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await dashboard.screenshot({path:path.join(staffChecks,`dashboard-staff-${width}.png`)});
    assert.equal(await dashboard.locator('#settings-staff-access-card').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,`staff fits ${width}px`);
    if(width===390)assert.equal(await dashboard.locator('.nav-tow').evaluate(node=>Math.abs(node.getBoundingClientRect().bottom-window.innerHeight)<2),true,'mobile navigation stays at the viewport bottom');
  }
  await dashboard.locator('[data-staff-id="owner"] [data-staff-action="view"]').click();
  assert.equal(await dashboard.locator('[data-staff-id="owner"] [data-staff-permissions]').count(),0,'owner permissions stay protected');
  await dashboard.locator('#settings-staff-search').fill('Fixture B');
  assert.equal(await dashboard.locator('#settings-staff-list [data-staff-id]').count(),1);
  await dashboard.locator('#settings-staff-search').fill('');
  await dashboard.locator('[data-staff-directory="pending"]').click();
  assert.equal(await dashboard.locator('#settings-staff-invitations [data-remove-allowance]').isVisible(),true);
  await dashboard.locator('#settings-staff-add > summary').click();
  for(const id of ['settings-staff-email','settings-staff-role','settings-staff-invite-permissions'])assert.equal(await dashboard.locator(`#${id}`).isVisible(),true);
  await dashboard.locator('#settings-staff-add > summary').click();
  staffFixture.canManageStaff=false;
  await dashboard.evaluate(()=>window.dispatchEvent(new Event('dart:admin-authenticated')));
  await dashboard.waitForFunction(()=>document.getElementById('settings-staff-add').hidden);
  await dashboard.locator('[data-staff-directory]').first().click();
  await dashboard.locator('[data-staff-id="staff-a"] [data-staff-action="view"]').click();
  assert.equal(await dashboard.locator('[data-staff-action="permissions"]').count(),0,'a non-owner cannot manage staff even with staff.manage');
  assert.equal(staffWrites,1);
  await dashboard.locator('[data-settings-tab="hero"]').click();
  const dashboardTargets = await dashboard.locator("a[data-target]").evaluateAll((links) =>
    [...new Set(links.map((link) => link.dataset.target))],
  );
  for (const target of dashboardTargets) {
    const activated = await dashboard.evaluate((targetId) => {
      const control = [...document.querySelectorAll("a[data-target]")].find(
        (node) => node.dataset.target === targetId,
      );
      if (!control) return false;
      control.click();
      return document.getElementById(targetId)?.classList.contains("active-section") === true;
    }, target);
    assert.equal(
      activated,
      true,
      `dashboard navigation must activate ${target}`,
    );
    await dashboard.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const unreadable=await dashboard.evaluate(()=>{
      const rgb=value=>(value.match(/[\d.]+/g)||[]).map(Number),white=value=>value.length>=3&&value.slice(0,3).every(channel=>channel>=245);
      return [...document.querySelectorAll('.active-section *')].filter(node=>{
        if(![...node.childNodes].some(child=>child.nodeType===3&&child.textContent.trim())||!node.checkVisibility())return false;
        const style=getComputedStyle(node);if(!white(rgb(style.color)))return false;
        let background=[255,255,255];
        for(let parent=node;parent;parent=parent.parentElement){const css=getComputedStyle(parent);if(css.backgroundImage!=='none')return false;const color=rgb(css.backgroundColor);if(color.length===3||color[3]>=0.99){background=color;break;}}
        return white(background);
      }).map(node=>node.textContent.trim().slice(0,100));
    });
    assert.deepEqual(unreadable,[],`${target} must not display white text on a white background`);
  }
  // Real period controls and late-loaded analytics must agree for yearly/custom Hours.
  await dashboard.evaluate(()=>document.querySelector('a[data-target="brand"]').click());
  await dashboard.waitForSelector('#trafficVisitorDetailsTow tr');
  await dashboard.locator('[data-chart-period-tow="hourly"]').click();
  for (const preset of ['this_year','last_year']) {
    await dashboard.locator('#brand-period-preset').selectOption(preset);
    await dashboard.waitForFunction(()=>{
      const range=window.DartFinance.currentRangeSelection();
      const text=document.getElementById('trafficPeriodLabelTow').textContent;
      return text.includes(range.start+' → '+range.end)&&text.includes('hourly');
    });
    assert.equal(await dashboard.locator('#finance-period-preset').inputValue(),preset);
    assert.match(await dashboard.locator('#trafficVisitorDetailsTow').textContent(),/visit-1/);
  }
  await dashboard.locator('#brand-period-preset').selectOption('custom');
  await dashboard.locator('#brand-period-start').fill('2024-01-01');
  await dashboard.locator('#brand-period-end').fill('2026-10-22');
  await dashboard.waitForFunction(()=>document.getElementById('trafficPeriodLabelTow').textContent.includes('2024-01-01 → 2026-10-22'));
  assert.equal(await dashboard.locator('#trafficHourWindowTow').count(),0);
  for(const width of [390,1366]) {
    await dashboard.setViewportSize({width,height:900});
    await dashboard.locator('.chart-box-tow').scrollIntoViewIfNeeded();
    assert.equal(await dashboard.locator('.chart-box-tow').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,`traffic chart fits ${width}px`);
  }
  await dashboard.locator('#brand-period-preset').selectOption('this_month');
  // The order editor keeps every original field and permits phone/name-only client contact.
  await dashboard.evaluate(() => document.querySelector('a[data-target="orders"]').click());
  // Address calculations have their own suite; this fixture isolates editor submission state.
  await dashboard.evaluate(()=>{window.DartAddress={...window.DartAddress,create:()=>({validate:()=>({ok:true}),invalidate(){},clear(){}})};});
  await dashboard.locator('#openModalBtn').click();
  assert.equal(await dashboard.locator('#orderForm fieldset').count(), 5);
  for (const id of ['clientId','email','phone2']) assert.equal(await dashboard.locator(`#${id}`).evaluate(node=>node.required), false);
  for (const id of ['clientName','phone1']) assert.equal(await dashboard.locator(`#${id}`).evaluate(node=>node.required), true);
  for (const id of ['paymentMethod','paymentStatus','amountPaid','amountRefunded','deductions','customDiscount','orderSource','orderLatitude','orderLongitude','productsInputCode','autoAllocateProductBtn','addProductBtn']) assert.equal(await dashboard.locator(`#${id}`).count(), 1, `${id} must be preserved`);
  await dashboard.evaluate(() => { customersData=[{id:'client-test',clientId:'CI-1',clientName:'Synthetic Client',phone1:'01000000000',email:''}]; });
  await dashboard.locator('#orderSearchInput').fill('Synthetic');
  await dashboard.locator('#order-client-results button').click();
  assert.equal(await dashboard.locator('#clientId').inputValue(), 'CI-1');
  assert.equal(await dashboard.locator('#phone1').inputValue(), '01000000000');
  await dashboard.locator('.dart-order-contact-clear').click();
  assert.equal(await dashboard.locator('#clientId').inputValue(), '');
  await dashboard.locator('#clientName').fill('Phone Only');
  await dashboard.locator('#phone1').fill('01000000000');
  assert.equal(await dashboard.locator('#email').evaluate(node=>node.checkValidity()), true);
  const orderChecks=path.join(root,'..','checks'); fs.mkdirSync(orderChecks,{recursive:true});
  for(const width of [390,1366]) {
    await dashboard.setViewportSize({width,height:900});
    await dashboard.screenshot({path:path.join(orderChecks,`dashboard-order-form-${width}.png`)});
    assert.equal(await dashboard.locator('#orderModal .modal-content').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,`order form fits ${width}px`);
  }
  await dashboard.evaluate(()=>{
    modelsData=[{modelId:'TEST-M',name:'Fixture',selling:600,cost:400,discount:0}];
    itemsData=[{id:'item-test',itemCode:'TEST-I',modelId:'TEST-M',color:'Burgundy',size:'M',status:'In stock'}];
    window.__createCalls=0;window.__originalCreate=window.DartOrdersApi.createManual;
    window.DartOrdersApi.createManual=()=>{window.__createCalls+=1;return new Promise(resolve=>{window.__finishCreate=resolve;});};
  });
  await dashboard.locator('#productsInputCode').fill('TEST-I');await dashboard.locator('#addProductBtn').click();
  for(const id of ['orderArea','orderStreetName','orderBuildingNumber','orderFloor'])await dashboard.locator(`#${id}`).fill('1');
  await dashboard.locator('#governorate').selectOption('Cairo');
  await dashboard.evaluate(()=>{document.getElementById('orderForm').requestSubmit();document.getElementById('orderForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  const submissionDiagnostics=await dashboard.evaluate(()=>({invalid:[...document.querySelectorAll('#orderForm :invalid')].map(node=>({id:node.id,message:node.validationMessage})),selected:document.getElementById('selectedProductsList').textContent,dialog:document.querySelector('.dart-dialog-message')?.textContent}));
  assert.equal(await dashboard.evaluate(()=>window.__createCalls),1,JSON.stringify(submissionDiagnostics));
  assert.equal(await dashboard.locator('#orderForm').getAttribute('aria-busy'),'true');
  await dashboard.locator('#closeModalBtn').click();
  assert.equal(await dashboard.locator('#orderModal').isVisible(),true,'pending editor stays open');
  await dashboard.evaluate(()=>window.__finishCreate([]));
  await dashboard.waitForFunction(()=>!document.getElementById('orderModal').classList.contains('active'));
  assert.equal(await dashboard.locator('#clientName').isDisabled(),false,'confirmed save restores fields');
  await dashboard.evaluate(()=>{window.DartOrdersApi.createManual=window.__originalCreate;});
  // Real DOM regression: two independent order commands, pending rows and reversed responses.
  const orderFixture = [
    { id: "order-a", orderId: "TEST-A", status: "New", clientName: "Synthetic A", phone1: "", items: [], totalPrice: 600 },
    { id: "order-b", orderId: "TEST-B", status: "New", clientName: "Synthetic B", phone1: "", items: [], totalPrice: 600 },
  ];
  const pendingCommands = new Map();
  await dashboard.route("**/api/v1/admin/orders-state", (route) => route.fulfill({
    contentType: "application/json", body: JSON.stringify({ version: 2, orders: orderFixture }),
  }));
  await dashboard.route(/\/api\/v1\/admin\/orders\/[^/?]+\/workflow(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.searchParams.get("responseMode"), "delta");
    assert.equal(url.searchParams.get("baseVersion"), "2");
    pendingCommands.set(url.pathname.split("/").at(-2), route);
  });
  await dashboard.evaluate(async () => {
    document.querySelector('a[data-target="orders"]')?.click();
    dartOrdersView = "all";
    await window.DartOrdersApi.hydrate(true);
    window.__orderCommands = [
      window.DartOrdersApi.workflow("TEST-A", { expectedStatus: "New", target: "Accepted" }),
      window.DartOrdersApi.workflow("TEST-B", { expectedStatus: "New", target: "Accepted" }),
    ];
  });
  const rowA = dashboard.locator('#orders-container [data-id="order-a"]');
  const rowB = dashboard.locator('#orders-container [data-id="order-b"]');
  await dashboard.waitForFunction(() => document.querySelector('#orders-container [data-id="order-a"]')?.getAttribute("aria-busy") === "true");
  assert.equal(await rowA.locator(".dart-status-btn").isDisabled(), true);
  assert.equal(await rowA.locator(".dart-history-btn").isDisabled(), false);
  await dashboard.waitForFunction(() => window.DartOrdersApi.isBusy("TEST-B"));
  const commandDeadline = Date.now() + 5000;
  while (pendingCommands.size < 2 && Date.now() < commandDeadline) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(pendingCommands.size, 2);
  await pendingCommands.get("TEST-B").fulfill({ contentType: "application/json", body: JSON.stringify({
    version: 4, orders: orderFixture.map((row) => ({ ...row, status: "Accepted" })),
  }) });
  await dashboard.evaluate(() => window.__orderCommands[1]);
  assert.equal(await rowA.getAttribute("aria-busy"), "true");
  assert.equal(await rowB.getAttribute("aria-busy"), "false");
  assert.equal(await rowB.locator(".dart-status-btn").isDisabled(), false);
  await pendingCommands.get("TEST-A").fulfill({ contentType: "application/json", body: JSON.stringify({
    version: 3, orders: orderFixture.map((row) => row.orderId === "TEST-A" ? { ...row, status: "Accepted" } : row),
  }) });
  await dashboard.evaluate(() => window.__orderCommands[0]);
  assert.equal(await rowA.getAttribute("aria-busy"), "false");
  await dashboard.waitForFunction(() =>
    document.querySelector('#orders-container [data-id="order-b"] .status-pill')?.textContent === 'Accepted');
  assert.equal(await rowB.locator(".status-pill").textContent(), "Accepted");
  assert.equal(await dashboard.evaluate(() => window.DartOrdersApi.serverVersion()), 4);
  const filters=dashboard.locator('#orders .filter-bar');
  await filters.locator('select[data-filter-key="date"]').selectOption('today');
  await filters.locator('.search-box input').fill('no matching order');
  assert.equal(await dashboard.locator('#orders-container .model-row').count(),0);
  assert(await dashboard.locator('#orders .dart-filter-summary button').count()>=2);
  const beforeClear=dashboard.url();
  await filters.locator('.dart-clear-filters').click();
  assert.equal(dashboard.url(),beforeClear);
  assert.equal(await filters.locator('select[data-filter-key="date"]').inputValue(),'all');
  assert.equal(await filters.locator('.search-box input').inputValue(),'');
  await dashboard.waitForSelector('#orders-container [data-id="order-a"]');
  assert.equal(await dashboard.locator('#orders-container .model-row').count(),2);
  assert.equal(await dashboard.locator('#orders .dart-filter-summary button').count(),0);
  // Compact rendering retains every original action and field in the owning row.
  await dashboard.waitForSelector('#orders-container .dart-record-open');
  assert.equal(await rowA.locator('.btn-edit').count(), 1);
  assert.equal(await rowA.locator('.btn-delete').count(), 1);
  assert.equal(await rowA.locator('.btn-hard-delete').count(), 1);
  assert.equal(await rowA.locator('.dart-history-btn').count(), 1);
  await rowA.locator('.dart-record-open').click();
  assert.equal(await rowA.locator('dialog').evaluate(node => node.open), true);
  assert.equal(await rowA.locator('.btn-edit').isVisible(), true);
  assert.equal(await rowA.locator('.dart-history-btn').isVisible(), true);
  assert(await rowA.locator('.dart-record-detail-field').count() >= 25, 'all original order fields stay in Details');
  assert.equal(await rowA.locator('.order-final-amount').textContent(), '600 EGP');
  await dashboard.keyboard.press('Escape');
  assert.equal(await rowA.locator('dialog').evaluate(node => node.open), false);
  await dashboard.waitForFunction(()=>document.querySelector('#orders-container [data-id="order-a"] .dart-record-open')===document.activeElement);
  assert.equal(await rowA.locator('.dart-record-open').evaluate(node => node === document.activeElement), true);
  for (const width of [390, 1366]) {
    await dashboard.setViewportSize({width, height:900});
    await dashboard.waitForSelector('#orders-container [data-id="order-a"] .dart-record-fields', {state:'visible'});
    assert.match(await rowA.locator('.dart-record-fields').textContent(), /Accepted/);
    assert.equal(await dashboard.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no dashboard overflow at ${width}px`);
    const output = path.join(root, '..', 'checks');
    fs.mkdirSync(output, {recursive:true});
    await dashboard.screenshot({path:path.join(output, `dashboard-orders-${width}.png`), fullPage:true});
  }
  await dashboard.close();

  // Real browser checks for independently granted Staff access.
  for (const permissions of [['catalog.read'], ['inventory.manage'], ['orders.read']]) {
    const page = await context.newPage(), stockWrites = [];
    const model = {modelId:'M-PERM',name:'Permission fixture',category:'Hoodies',cost:100,selling:150,discount:0,
      active:true,isArchived:false,isDeleted:false,version:1,sizeOptions:[{name:'M',active:true}],colorOptions:[{name:'Black',active:true,images:[]}]};
    await page.route('**/api/v1/me',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({
      user:{id:'synthetic-staff',accountType:'staff'},session:{mfaRequired:false,mfaSatisfied:true},permissions})}));
    await page.route('**/api/v1/admin/catalog-state',async route=>{
      const write=route.request().method()!=='GET';
      const body=write?route.request().postDataJSON():null;
      if(write)stockWrites.push(body);
      await route.fulfill({contentType:'application/json',body:JSON.stringify(write
        ?{version:2,baseVersion:1,committedVersion:2,models:[],items:body.items.map(row=>({...row,version:1}))}
        :{version:1,models:[model],items:[]})});
    });
    await page.goto(`${origin}/Eye/Dart%20Eye.html`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.DartAdminHydration?.ready===true);
    const hidden = selector=>page.locator(selector).first().evaluate(node=>getComputedStyle(node).display==='none');
    assert.equal(await hidden('#models .add-btn'),true,'catalog read/inventory grants never edit models');
    assert.equal(await hidden('#orders #openModalBtn'),true,'reading orders never grants order creation');
    if(permissions.includes('inventory.manage')){
      await page.evaluate(()=>document.querySelector('a[data-target="items"]').click());
      assert.equal(await hidden('#items .add-btn'),false);
      await page.locator('#items .add-btn').click();
      await page.locator('#modal-item-model-id').fill('M-PERM');
      await page.locator('#modal-item-code-pic').fill('I-PERM-NEW');
      await page.locator('#modal-item-color').selectOption('Black');
      await page.locator('#modal-item-size').selectOption('M');
      await page.locator('#item-add-form').evaluate(form=>form.requestSubmit());
      await page.waitForFunction(()=>window.DartCatalog?.serverVersion()>=2);
      assert.equal(stockWrites.length,1);assert.deepEqual(stockWrites[0].models,[]);
      assert.equal(stockWrites[0].items[0].itemCode,'I-PERM-NEW');
      assert.equal(await page.evaluate(()=>window.DartCatalog.models()[0].selling),150);
    }else{
      assert.equal(await hidden('#items .add-btn'),true);
      await page.locator('#models .add-btn').evaluate(button=>button.click());
      assert.equal(await page.locator('#model-modal').evaluate(node=>node.classList.contains('active')),false);
      assert.equal(stockWrites.length,0);
    }
    if(permissions.includes('catalog.read'))assert.equal(await page.evaluate(()=>window.DartCatalog.models().length),1,'read-only catalogue data must hydrate');
    await page.close();
  }

  for (const domain of ['contacts','reviews']) {
    const page=await context.newPage(), writes=[];
    const row={id:`${domain}-fixture`,clientName:'Synthetic feedback',review:'Original message',email:'fixture@example.test',
      phone1:'01012345678',status:'Active',createdAt:'2026-10-21T12:00:00Z',
      ...(domain==='contacts'?{recordType:'contact',source:'Contact Us'}:{recordType:'review',rating:5})};
    await page.route('**/api/v1/me',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({
      user:{id:'synthetic-feedback-staff',accountType:'staff'},session:{mfaRequired:false,mfaSatisfied:true},permissions:[`${domain}.read`,`${domain}.manage`]})}));
    await page.route('**/api/v1/admin/domain-state',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({domains:[{domain,version:1,data:[row]}]})}));
    await page.route('**/api/v1/admin/domain-state/*',async route=>{
      const actual=new URL(route.request().url()).pathname.split('/').at(-1);
      assert.equal(actual,domain,'a limited feedback account must never save the other domain');
      if(route.request().method()==='PUT')writes.push(route.request().postDataJSON());
      await route.fulfill({contentType:'application/json',body:JSON.stringify({domain,version:2,data:writes.at(-1)?.data||[row]})});
    });
    await page.goto(`${origin}/Eye/Dart%20Eye.html`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.DartAdminHydration?.ready===true);
    await page.evaluate(()=>document.querySelector('a[data-target="review"]').click());
    const record=page.locator(`#review-container [data-id="${row.id}"]`);
    await record.locator('.dart-record-open').click();
    await record.locator('.btn-edit').click();
    assert.equal(await page.locator('#customer-review-form').getAttribute('data-permission-domain'),domain);
    await page.locator('#modal-cust-review').fill(`Updated ${domain} message`);
    await page.locator('#customer-review-form').evaluate(form=>form.requestSubmit());
    await page.waitForFunction(domain=>window.DartDomainState.version(domain)===2,domain);
    assert.equal(writes.length,1);
    assert.equal(writes[0].data[0].review,`Updated ${domain} message`);
    await page.close();
  }

  for (const endpoint of ["manifest.json", "sw.js", "sitemap.xml", "robots.txt"]) {
    const response = await context.request.get(`${origin}/${endpoint}`);
    assert.equal(response.status(), 200, `${endpoint} must load from the root`);
  }

  assert.deepEqual(failures, []);
  console.log("PASS full-site pages, shared sections, menu, filters, customer/social auth, tracking, dashboard navigation and root files");
  await context.close();
  await browser.close();
  server.close();
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
/* END Full-site smoke test. */
