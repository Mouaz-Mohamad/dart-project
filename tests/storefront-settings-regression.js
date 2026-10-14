// DART CODE GUIDE | tests/storefront-settings-regression.js
// الغرض: Regression browser test لأيقونات الـnavbar وفتح Product Modal وحفظ Site Settings بدون reload.
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
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

const seededSettings = {
  version: 1,
  heroDayImage: null,
  heroNightImage: null,
  founderImage: null,
  defaultMarkupPercent: 50,
  courierFeePerOrder: 100,
  birthdayDiscountPercent: 30,
  dartCardDiscountPercent: 40,
  refundCustomerFee: 100,
  repeatExchangeCustomerFee: 50,
  siteDiscount: { enabled: false, percent: 0, startsAt: "", endsAt: "" },
  waiting: {
    enabled: true,
    reservationHours: 4,
    alternativeColorsEnabled: true,
    emailNotificationEnabled: true,
    inSiteNotificationEnabled: true,
  },
  announcements: [],
  modelCards: {},
  typing: {
    typingSpeed: 70,
    deletingSpeed: 10,
    wordDelay: 100,
    nextSceneDelay: 400,
    scenes: [
      {
        hold: 2000,
        words: [
          { text: "Dart |", color: "#AB012B", size: 50, weight: 600 },
          { text: "For You", color: "#ffffff", size: 50, weight: 400 },
        ],
      },
    ],
  },
};

const seededModel = {
  modelId: "DT-TEST-1",
  name: "Regression Tee",
  category: "T-Shirts",
  description: "Regression product used by the browser smoke test.",
  selling: 600,
  discount: 0,
  active: true,
  isArchived: false,
  isDeleted: false,
  lowStockLimit: 2,
  createdAt: "2026-09-24T00:00:00.000Z",
  colorOptions: [
    {
      name: "Burgundy",
      active: true,
      images: [
        {
          id: "regression-image",
          name: "regression.svg",
          url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='400'%3E%3Crect width='300' height='400' fill='%23AB012B'/%3E%3C/svg%3E",
        },
      ],
    },
  ],
  sizeOptions: [{ name: "M", active: true }],
  sizeChart: {
    unit: "cm",
    rows: [{ size: "M", chest: "52", length: "70" }],
  },
};

let settingsVersion = 1;
let savedSettings = { ...seededSettings };
let settingsPutCount = 0;
let lastSettingsPut = null;
const uploadedAssets = new Map();
let assetPutCount = 0;

function json(response, status, payload) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://test");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    if (request.method === "PUT" && pathname === "/api/v1/admin/catalog/assets") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || "{}");
      assert.match(body.assetId, /^[0-9a-f-]{36}$/i);
      assert.equal(body.contentType, "image/webp");
      const bytes = Buffer.from(body.base64, "base64");
      assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
      assert.equal(bytes.toString("ascii", 8, 12), "WEBP");
      uploadedAssets.set(body.assetId, { bytes, contentType: body.contentType });
      assetPutCount += 1;
      return json(response, 200, { urlPath: `/api/v1/catalog/assets/${body.assetId}` });
    }

    if (pathname.startsWith("/api/v1/catalog/assets/")) {
      const asset = uploadedAssets.get(pathname.split("/").pop());
      if (!asset) return json(response, 404, { error: { code: "ASSET_NOT_FOUND" } });
      response.setHeader("Content-Type", asset.contentType);
      return response.end(asset.bytes);
    }

    if (request.method === "PUT" && pathname === "/api/v1/admin/site-settings") {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || "{}");
      settingsPutCount += 1;
      lastSettingsPut = body;
      settingsVersion += 1;
      savedSettings = body.settings || savedSettings;
      return json(response, 200, {
        version: settingsVersion,
        settings: savedSettings,
      });
    }

    if (pathname === "/api/v1/site-settings" || pathname === "/api/v1/admin/site-settings") {
      return json(response, 200, {
        version: settingsVersion,
        settings: savedSettings,
      });
    }

    if (pathname === "/api/v1/catalog") {
      return json(response, 200, {
        version: 1,
        models: [seededModel],
        stock: { '["DT-TEST-1","Burgundy","M"]': 2 },
      });
    }

    if (pathname === "/api/v1/catalog/version") {
      return json(response, 200, { version: 1 });
    }

    if (pathname === "/api/v1/admin/catalog-state") {
      return json(response, 200, { version: 1, models: [seededModel], items: [] });
    }

    if (pathname === "/api/v1/admin/orders-state") {
      return json(response, 200, { version: 1, orders: [] });
    }

    if (pathname === "/api/v1/admin/orders-version") {
      return json(response, 200, { version: 1 });
    }

    if (pathname === "/api/v1/me") {
      return json(response, 200, {
        user: { accountType: "staff", name: "CI Owner" },
        session: { mfaRequired: false, mfaSatisfied: true },
        permissions: [
          "settings.manage",
          "catalog.manage",
          "orders.read",
          "dashboard_state.read",
          "finance.read",
        ],
      });
    }

    if (pathname === "/api/v1/health/live") {
      return json(response, 200, {
        status: "ok",
        apiCompatibility: "dart-database-v1",
        capabilities: ["staff-email-access-v1", "dashboard-domain-state-v1", "bulk-domain-state-v1"],
      });
    }

    if (pathname === "/api/v1/auth/social/providers") {
      return json(response, 200, { providers: { google: false, facebook: false } });
    }

    if (pathname === "/api/v1/admin/domain-state") {
      return json(response, 200, { domains: [] });
    }

    if (pathname === "/api/v1/admin/domain-state-versions") {
      return json(response, 200, { versions: {} });
    }

    if (pathname === "/api/v1/admin/audit") {
      return json(response, 200, { audit: [] });
    }

    if (pathname.startsWith("/api/v1/admin/finance/summary")) {
      return json(response, 200, { summary: {} });
    }

    if (pathname === "/api/v1/reviews") {
      return json(response, 200, { reviews: [] });
    }

    return json(response, 200, {});
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(root + path.sep)) {
    response.statusCode = 403;
    return response.end();
  }
  try {
    response.setHeader(
      "Content-Type",
      contentTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
    );
    response.end(fs.readFileSync(filename));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });

  const products = await context.newPage();
  await products.goto(`${origin}/products.html`, { waitUntil: "domcontentloaded" });
  await products.waitForSelector("#header-container .icon-menu");
  assert.equal(await products.locator("#header-container .icon-menu").count(), 1);
  assert.equal(await products.locator("#header-container .fa-cart-shopping").count(), 1);

  await products.waitForSelector('.product-card[data-id="DT-TEST-1"]');
  await products.locator('.product-card[data-id="DT-TEST-1"]').first().click();
  await products.waitForFunction(
    () => document.getElementById("SectionModel")?.style.display === "flex",
  );
  assert.equal(await products.locator("#SectionModel .color-btn").count(), 1);
  assert.equal(await products.locator("#SectionModel .size-btn").count(), 1);
  assert.equal(await products.locator("#SectionModel .carousel-slide").count(), 1);
  await products.locator('#SectionModel .size-btn[data-size="M"]').click();
  assert.equal(await products.locator("#modalBuyBtn").isDisabled(), false);
  await products.close();

  const dashboard = await context.newPage();
  await dashboard.goto(`${origin}/Eye/Dart%20Eye.html`, { waitUntil: "domcontentloaded" });
  await dashboard.evaluate(() => {
    document.body.classList.remove("dart-admin-locked");
    const gate = document.getElementById("dart-admin-auth");
    if (gate) gate.hidden = true;
    const settingsLink = [...document.querySelectorAll('a[data-target="settings"]')].find(Boolean);
    settingsLink?.click();
  });

  await dashboard.waitForSelector("#settings-commerce-form");
  const initialUrl = dashboard.url();
  await dashboard.locator("#settings-birthday-discount").fill("31");
  await dashboard.locator("#settings-card-discount").fill("41");
  await dashboard.locator("#settings-default-markup").fill("55");
  await dashboard.locator('#settings-commerce-form button[type="submit"]').click();
  await dashboard.waitForFunction(() => {
    const status = document.getElementById("settings-reset-status");
    return status && !status.hidden && /تم حفظ الإعدادات/.test(status.textContent || "");
  });

  assert.equal(dashboard.url(), initialUrl, "settings save must not reload/navigate the dashboard");
  assert.equal(settingsPutCount, 1, "settings form must issue exactly one PUT");
  assert.equal(lastSettingsPut.settings.birthdayDiscountPercent, 31);
  assert.equal(lastSettingsPut.settings.dartCardDiscountPercent, 41);
  assert.equal(lastSettingsPut.settings.defaultMarkupPercent, 55);

  // Use the real upload/compression form and a fresh About page. A null-only
  // settings fixture cannot detect the historical PNG-locking observer.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7aUAAAAASUVORK5CYII=", "base64");
  async function uploadFounder(name, expectedPuts) {
    await dashboard.locator("#settings-founder-image").setInputFiles({ name, mimeType: "image/png", buffer: png });
    await dashboard.locator('#settings-media-form button[type="submit"]').click();
    await dashboard.waitForFunction(({ name, version }) =>
      window.DartSiteSettings.serverVersion() === version && window.DartSiteSettings.get().founderImage?.name === name,
    { name, version: expectedPuts + 1 });
    await dashboard.waitForFunction(() => {
      const preview = document.getElementById("settings-founder-preview");
      return preview?.complete && preview.naturalWidth > 0;
    });
    assert.equal(settingsPutCount, expectedPuts, "founder save must issue exactly one settings PUT");
    assert.equal(lastSettingsPut.settings.founderImage.name, name);
    assert.equal(dashboard.url(), initialUrl, "founder upload must not navigate the dashboard");
    return lastSettingsPut.settings.founderImage.id;
  }
  const firstFounder = await uploadFounder("founder-first.png", 2);
  assert.equal(assetPutCount, 1);
  const about = await context.newPage();
  await about.goto(`${origin}/about.html`, { waitUntil: "domcontentloaded" });
  async function expectFounder(id) {
    await about.waitForFunction((path) => {
      const image = document.getElementById("dart-founder-image");
      return image && new URL(image.src).pathname === path && image.complete && image.naturalWidth > 0;
    }, id ? `/api/v1/catalog/assets/${id}` : "/Photos/me.png");
  }
  await expectFounder(firstFounder);
  await about.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new CustomEvent("dart:sections-loaded"));
  });
  await expectFounder(firstFounder);

  const secondFounder = await uploadFounder("founder-second.png", 3);
  assert.notEqual(secondFounder, firstFounder);
  assert.equal(assetPutCount, 2);
  await about.evaluate(() => window.DartSiteSettings.hydrate(true));
  await expectFounder(secondFounder);
  await about.reload({ waitUntil: "domcontentloaded" });
  await expectFounder(secondFounder);

  // Re-injected historical <picture> markup must not shadow saved Settings.
  await about.evaluate(() => {
    const current = document.getElementById("dart-founder-image");
    const picture = document.createElement("picture");
    const alternative = document.createElement("source");
    alternative.srcset = "/Photos/me.webp";
    const replacement = document.createElement("img");
    replacement.id = "dart-founder-image";
    replacement.src = "/Photos/me.webp";
    replacement.srcset = "/Photos/me.webp 2x";
    picture.append(alternative, replacement);
    current.replaceWith(picture);
    document.dispatchEvent(new CustomEvent("dart:section-loaded"));
  });
  await expectFounder(secondFounder);
  assert.equal(await about.locator("#dart-founder-image").evaluate((image) => image.closest("picture").querySelectorAll("source").length), 0);
  assert.equal(await about.locator("#dart-founder-image").getAttribute("srcset"), null);

  await dashboard.locator("#clear-media-settings").click();
  await dashboard.waitForFunction(() => window.DartSiteSettings.serverVersion() === 5 && window.DartSiteSettings.get().founderImage === null);
  assert.equal(settingsPutCount, 4);
  assert.equal(lastSettingsPut.settings.founderImage, null);
  await about.evaluate(() => window.DartSiteSettings.hydrate(true));
  await expectFounder(null);
  await about.reload({ waitUntil: "domcontentloaded" });
  await expectFounder(null);

  await about.close();
  await dashboard.close();
  await context.close();
  await browser.close();
  server.close();
  console.log("PASS navbar/icons, product modal, settings PUT, founder PNG upload/compression/save/preview, About refresh/reload, legacy picture and reset to original");
})().catch((error) => {
  console.error(error.stack || error);
  server.close();
  process.exit(1);
});
