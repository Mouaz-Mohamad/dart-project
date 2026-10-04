// DART CODE GUIDE | tests/sets-admin-browser.js
// Focused Chromium regression for the shared Models / Sets dashboard controls.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const html = `<!doctype html><html><head><link rel="stylesheet" href="/Eye/dart.css"></head><body>
<section id="models" class="dashboard-section active-section">
  <div class="first filter-bar" data-test-original-filter>
    <div class="search-box"><input type="text" placeholder="search returns"><i class="bx bx-search"></i></div>
    <div class="select-box"><select data-filter-key="category"><option value="all">All Categories</option><option value="Overshirts">Overshirts</option><option value="Jeans">Jeans</option></select></div>
    <div class="select-box"><select data-filter-key="status"><option value="" selected>Status</option><option value="active">Active</option><option value="out-of-stock">Out of stock</option></select></div>
    <div class="select-box"><select data-filter-key="priceRange"><option value="" selected>Price Range</option><option value="0-500">0 - 500 EGP</option><option value="500-1000">500 - 1000 EGP</option><option value="1000+">1000+ EGP</option></select></div>
    <div class="select-box"><select data-filter-key="archive"><option value="active" selected>Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
    <button type="button" class="add-btn"><span>+</span> Add Product</button>
  </div>
  <div class="second"><button type="button" class="delete-btn"><span>Delete</span></button></div>
  <div class="cont-titel" data-model-table><div class="title-name"><input type="checkbox"><h2>Action</h2></div><div id="models-container"></div></div>
</section>
<section id="model-modal" hidden></section>
<script>
const fixtureSets = [
  {setId:"SET-CAMPUS",name:"Campus Look",description:"Overshirt campus set",category:"Sets",active:true,isArchived:false,version:1,createdAt:"2026-10-01T00:00:00.000Z",pieceCount:2,images:[],components:[{modelId:"M-OVER",name:"Overshirt",quantity:2}],pricing:{costTotalMinor:60000,componentsSellingTotalMinor:100000,basePriceMinor:80000,discountPercent:0,finalMinor:80000,marginVsCostMinor:20000}},
  {setId:"SET-DENIM",name:"Denim Box",description:"Jeans set",category:"Sets",active:true,isArchived:false,version:1,createdAt:"2026-10-02T00:00:00.000Z",pieceCount:1,images:[],components:[{modelId:"M-JEAN",name:"Jeans",quantity:1}],pricing:{costTotalMinor:50000,componentsSellingTotalMinor:120000,basePriceMinor:120000,discountPercent:0,finalMinor:120000,marginVsCostMinor:70000}}
];
const models = {
  "M-OVER": {modelId:"M-OVER",name:"Overshirt",category:"Overshirts",cost:300,selling:500,colorOptions:[{name:"Black",active:true,images:[]}],sizeOptions:[{name:"M",active:true}]},
  "M-JEAN": {modelId:"M-JEAN",name:"Jeans",category:"Jeans",cost:500,selling:1200,colorOptions:[{name:"Blue",active:true,images:[]}],sizeOptions:[{name:"32",active:true}]}
};
const items = [
  {modelId:"M-OVER",status:"In stock",isArchived:false,isDeleted:false},
  {modelId:"M-OVER",status:"In stock",isArchived:false,isDeleted:false}
];
window.__stateCalls=[];
window.DartAdminAccess={can:()=>true};
window.DartCatalog={
  norm:(v)=>String(v??"").trim().toLowerCase(),
  model:(id)=>models[id]||null,
  items:()=>items,
  active:(row)=>row && row.active!==false && !row.isArchived && !row.isDeleted,
  colors:(m)=>m?.colorOptions||[],
  cover:()=>"/placeholder.png",
  saveImage:async()=>({url:"/saved.webp"})
};
async function request(path,options={}){
  if(path==="/api/v1/admin/sets") return {sets:structuredClone(fixtureSets)};
  if(path.includes("/state")){
    const setId=decodeURIComponent(path.split("/admin/sets/")[1].split("/state")[0]);
    const row=fixtureSets.find(item=>item.setId===setId);
    window.__stateCalls.push({setId,body:options.body});
    if(row){row.isArchived=options.body?.action==="archive";row.version+=1;}
    return {set:structuredClone(row)};
  }
  if(path==="/api/v1/admin/sets/settings") return {settings:{birthdayPercent:10,dartCardPercent:10,version:1}};
  return {};
}
window.DartSets={request}; window.DartAdminApi={request}; window.DartAdminHydration={ready:true};
window.DartDialog={confirm:async()=>true,alert:async()=>{},prompt:async()=>""};
document.querySelector("#models .add-btn").addEventListener("click",()=>{document.getElementById("model-modal").hidden=false;});
</script>
<script src="/Eye/dart-sets-admin.js"></script>
</body></html>`;

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://test").pathname);
  if (pathname === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
    return;
  }
  const file = path.resolve(root, pathname.replace(/^\//, ""));
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.statusCode = 403;
    response.end();
    return;
  }
  try {
    const ext = path.extname(file);
    response.setHeader("Content-Type", ext === ".js" ? "text/javascript; charset=utf-8" : ext === ".css" ? "text/css; charset=utf-8" : "application/octet-stream");
    response.end(fs.readFileSync(file));
  } catch {
    response.statusCode = 404;
    response.end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
  const browser = await chromium.launch({headless:true, executablePath, args:["--no-sandbox","--disable-dev-shm-usage","--disable-gpu"]});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  try {
    await page.goto(origin + "/");
    await page.waitForSelector('[data-model-set-view="sets"]');

    assert.equal(await page.locator("#models > .first.filter-bar").count(), 1, "shared filter bar must remain a single original toolbar");
    assert.deepEqual(await page.locator("#models > .second > button").allTextContents(), ["Models", "Sets", "Delete"]);
    assert.equal(await page.locator('[data-model-table]').isVisible(), true);
    assert.equal(await page.locator('[data-sets-admin-panel]').isVisible(), false);

    await page.locator('[data-model-set-view="sets"]').click();
    await page.waitForFunction(() => document.querySelectorAll("[data-set-rows] .dart-set-row").length === 2);
    assert.equal(await page.locator('[data-model-table]').isVisible(), false);
    assert.equal(await page.locator('[data-sets-admin-panel]').isVisible(), true);
    assert.equal(await page.locator("#models > .first.filter-bar").isVisible(), true);
    const setRowStyle = await page.locator("[data-set-rows] .dart-set-row").first().evaluate((node) => {
      const style = getComputedStyle(node);
      return { display: style.display, fontSize: style.fontSize, borderStyle: style.borderTopStyle };
    });
    assert.deepEqual(setRowStyle, { display: "flex", fontSize: "14px", borderStyle: "solid" }, "Sets rows must inherit the Models row visual structure");

    await page.locator("#models .add-btn").click();
    assert.equal(await page.locator("#dartSetAdminModal").isVisible(), true, "shared Add Product must open Set editor in Sets view");
    assert.equal(await page.locator("#model-modal").isVisible(), false, "Model editor must not open in Sets view");
    await page.locator("#dartSetAdminModal [data-set-close]").first().click();

    const search = page.locator("#models .search-box input");
    await search.fill("campus");
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").count(), 1);
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").first().getAttribute("data-set-id"), "SET-CAMPUS");
    await search.fill("");

    await page.locator('#models select[data-filter-key="category"]').selectOption("Jeans");
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").count(), 1);
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").first().getAttribute("data-set-id"), "SET-DENIM");
    await page.locator('#models select[data-filter-key="category"]').selectOption("all");

    await page.locator('#models select[data-filter-key="status"]').selectOption("out-of-stock");
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").count(), 1);
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").first().getAttribute("data-set-id"), "SET-DENIM");
    await page.locator('#models select[data-filter-key="status"]').selectOption("");

    await page.locator('#models select[data-filter-key="priceRange"]').selectOption("1000+");
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").count(), 1);
    assert.equal(await page.locator("[data-set-rows] .dart-set-row").first().getAttribute("data-set-id"), "SET-DENIM");
    await page.locator('#models select[data-filter-key="priceRange"]').selectOption("");

    await page.locator('[data-set-rows] .dart-set-row[data-set-id="SET-CAMPUS"] [data-set-select]').check();
    await page.locator("#models > .second .delete-btn").click();
    await page.waitForFunction(() => window.__stateCalls.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__stateCalls[0]), {setId:"SET-CAMPUS",body:{action:"archive",expectedVersion:1}});

    await page.locator('[data-model-set-view="models"]').click();
    await page.locator("#models .add-btn").click();
    assert.equal(await page.evaluate(() => !document.getElementById("model-modal").hidden), true, "shared Add Product must keep the existing Model editor in Models view");
    assert.equal(await page.locator('[data-model-table]').isVisible(), true);
    assert.equal(await page.locator('[data-sets-admin-panel]').isVisible(), false);

    console.log("PASS Models / Sets shared toolbar, filters, add and delete behavior");
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
