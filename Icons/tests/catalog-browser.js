/* BEGIN V7 acceptance tests — real UI flows, isolated browser-only test data. */
const fs=require('fs'),path=require('path'),http=require('http');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((q,r)=>{
 const filename=path.join(root,decodeURIComponent(new URL(q.url,'http://test').pathname));
 if(!filename.startsWith(root+path.sep)){r.statusCode=403;r.end();return;}
 try{r.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.jpg':'image/jpeg','.svg':'image/svg+xml'})[path.extname(filename)]||'application/octet-stream');r.end(fs.readFileSync(filename));}catch{r.statusCode=404;r.end();}
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const executablePath=process.env.CHROMIUM_EXECUTABLE||chromium.executablePath();
 if(!fs.existsSync(executablePath))throw Error('Install Playwright Chromium or set CHROMIUM_EXECUTABLE.');
 const browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
 // External services are isolated; real address parsing is tested by address-unit.js.
 await context.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
 const page=await context.newPage();page.on('dialog',d=>d.accept());
 await page.goto(origin+'/Eye/Dart%20Eye.html');
 assert.equal(await page.evaluate(()=>modelsData.length+itemsData.length+ordersData.length+customersData.length),0);
 assert.equal(await page.locator('.dashboard-section.active-section').getAttribute('id'),'brand');
 await page.evaluate(()=>{window.firstRef=document.querySelector('#items .first');window.secondRef=document.querySelector('#items .second');});
 await page.locator('[data-target="models"]').first().click();await page.locator('#models .add-btn').click();
 await page.locator('#modal-id').fill('#1');await page.locator('#modal-name').fill('Dart Hoodie');await page.locator('#modal-category').selectOption('hoodies');await page.locator('#modal-description').fill('Cotton hoodie');await page.locator('#modal-cost').fill('400');
 assert.equal(Number(await page.locator('#modal-selling').inputValue()),600);
 await page.locator('#modal-selling').fill('700');await page.locator('#modal-discount').fill('20');
 assert.equal(await page.locator('#modal-final-price').textContent(),'560 EGP');
 for(const size of ['M','L']){await page.locator('#new-model-size').fill(size);await page.locator('#add-model-size').click();}
 for(const color of ['White','Black','Beige']){await page.locator('#new-model-color').fill(color);await page.locator('#add-model-color').click();}
 await page.locator('[data-upload-color="0"]').setInputFiles([path.join(root,'Photos/products/1.jpg'),path.join(root,'Photos/products/7.jpg')]);
 await page.waitForFunction(()=>document.querySelectorAll('#model-color-editors figure').length===2);
 await page.locator('[data-upload-color="1"]').setInputFiles(path.join(root,'Photos/products/2.jpg'));
 await page.waitForFunction(()=>document.querySelectorAll('#model-color-editors figure').length===3);
 await page.locator('#btn-submit-modal').click();
 assert.equal(await page.evaluate(()=>modelsData.length),1);
 assert.equal(await page.locator('.dart-size-chart-btn').count(),1);
 await page.locator('[data-target="items"]').first().click();
 async function addItem(code,color,size){await page.locator('#items .add-btn').click();await page.locator('#modal-item-model-id').fill('#1');await page.locator('#modal-item-code-pic').fill(code);await page.locator('#modal-item-color').selectOption(color);await page.locator('#modal-item-size').selectOption(size);await page.locator('#item-add-form button[type="submit"]').click();}
 await addItem('I-1','White','M');await addItem('I-2','White','M');await addItem('I-3','Black','L');await addItem('I-4','Beige','M');
 assert.equal(await page.locator('.group-row').count(),3);
 assert.equal(await page.locator('#groups-view input[type="checkbox"]').count(),0);
 assert.equal(await page.locator('#groups-view .action-btn').count(),0);
 await page.locator('.group-row').filter({hasText:'White'}).click();
 assert.equal(await page.locator('#items-groups-view .model-row').count(),2);
 await page.locator('#items-groups-view .title-name input').check();
 assert.deepEqual(await page.evaluate(()=>itemsData.filter(i=>i.isChecked).map(i=>i.itemCode).sort()),['I-1','I-2']);
 await page.locator('#items .second .delete-btn').click();
 assert.deepEqual(await page.evaluate(()=>itemsData.filter(i=>i.isArchived).map(i=>i.itemCode).sort()),['I-1','I-2']);
 await page.evaluate(()=>{itemsData.forEach(i=>{i.isArchived=false;i.isDeleted=false;i.isChecked=false;});dartSaveAll();dartRefreshAll();});
 await page.locator('#back-to-groups').click();await page.locator('[data-item-view="all"]').click();
 assert.equal(await page.locator('#all-items-view .model-row').count(),4);
 await page.locator('#items [data-filter-key="color"]').selectOption('Black');assert.equal(await page.locator('#all-items-view .model-row').count(),1);
 await page.locator('[data-item-view="groups"]').click();assert.equal(await page.locator('.group-row').count(),1);
 await page.locator('#items [data-filter-key="color"]').selectOption('all');
 assert.equal(await page.evaluate(()=>firstRef===document.querySelector('#items .first')&&secondRef===document.querySelector('#items .second')),true);
 assert.equal(await page.evaluate(()=>itemsData.some(i=>i.img)),false);
 // A reload preserves added data and rehydrates shared image blobs.
 await page.reload();assert.equal(await page.evaluate(()=>modelsData.length),1);assert.equal(await page.evaluate(()=>itemsData.length),4);
 await page.setViewportSize({width:390,height:844});await page.locator('[data-target="items"]').last().click();
 await page.waitForFunction(()=>[...document.querySelectorAll('#groups-view img')].every(i=>i.complete&&i.naturalWidth>0));
 await page.screenshot({path:path.join(root,'tests/dashboard-mobile.png')});
 const shop=await context.newPage();shop.on('dialog',d=>d.accept());await shop.goto(origin+'/products.html');
 const cards=shop.locator('#productsPart1 .product-card[data-id],#productsPart2 .product-card[data-id]');
 await shop.waitForFunction(()=>document.getElementById('productResultsCount')?.textContent==='2 products');assert.equal(await cards.count(),2);
 assert.equal(await shop.locator('#productsPart1 .product-card[data-color="Beige"]').count(),0);
 await shop.locator('#productsPart1 .product-card[data-color="White"]').click();
 await shop.waitForFunction(()=>selectedColor==='White' && document.getElementById('SectionModel').style.display==='flex');
 assert.equal(await shop.evaluate(()=>selectedColor),'White');assert.equal(await shop.locator('#carouselTrack .carousel-slide').count(),3);
 assert.equal(await shop.evaluate(()=>document.querySelector('.colors-container').compareDocumentPosition(document.querySelector('.sizes-container')) & Node.DOCUMENT_POSITION_FOLLOWING),4);
 await shop.locator('#carouselNext').click();assert.equal(await shop.evaluate(()=>selectedColor),'White');
 await shop.locator('#carouselNext').click();assert.equal(await shop.evaluate(()=>selectedColor),'Black');
 assert.equal(await shop.locator('.size-btn[data-size="M"]').isDisabled(),true);
 await shop.locator('.size-btn[data-size="L"]').click();await shop.locator('.color-btn[data-color="White"]').click();assert.equal(await shop.evaluate(()=>selectedSize),null);
 await shop.locator('.color-btn[data-color="Beige"]').click();assert.equal(await shop.evaluate(()=>selectedColor),'Beige');assert.equal(await shop.locator('#color-image-note').isVisible(),true);
 await shop.locator('.size-btn[data-size="M"]').click();assert.equal(await shop.locator('#modalBuyBtn').isDisabled(),false);
 await shop.locator('#modalBuyBtn').click();assert.equal(await shop.evaluate(()=>cartData[0].color),'Beige');
 const until=await shop.evaluate(()=>cartData[0].reservationUntil);await shop.reload();assert.equal(await shop.evaluate(()=>cartData[0].reservationUntil),until);
 // Checkout with a verified address fixture; no live geocoder request in this test.
 await shop.goto(origin+'/cart-checkout.html');
 await shop.evaluate(()=>{window.dartCheckoutAddress={validate:()=>({ok:true,zone:'cairo-giza',source:'map'})};});
 const order=await shop.evaluate(async()=>{
   const fields={customer_name:'Test Buyer',phone1:'01012345678',email:'test@example.com',country:'Egypt',governorate:'Cairo',area:'Nasr City',street:'Test',building:'12',floor:'2',latitude:'30.05',longitude:'31.30',full_address:'12 Test, Cairo'};
   return DartPlatform.checkout({elements:{namedItem:n=>({value:fields[n]||''})},dataset:{}});
 });
 assert.equal(order.priceSnapshot[0].finalUnitPrice,560);assert.equal(order.priceSnapshot[0].costSnapshot,400);
 assert.equal(await shop.evaluate(()=>JSON.parse(localStorage.getItem('dart_cart')).length),0);
 // Changing the model affects future prices, never the saved order.
 await page.reload();await page.locator('[data-target="models"]').last().click();await page.locator('#models-container .btn-edit').click();await page.locator('#modal-selling').fill('800');await page.locator('#modal-discount').fill('10');await page.locator('#btn-submit-modal').click();
 assert.equal(await page.evaluate(()=>ordersData[0].priceSnapshot[0].finalUnitPrice),560);
 // An edit of an existing order must calculate from that saved snapshot.
 await page.evaluate(()=>openEditModal(ordersData[0].id,'orders'));
 assert.equal(await page.locator('#subtotalVal').textContent(),'560 EGP');await page.evaluate(()=>closeModal(document.getElementById('orderModal')));
 // Linked colors archive instead of disappearing from historical records.
 await page.locator('#models-container .btn-edit').click();await page.locator('[data-kind="colors"][data-index="1"][data-option-action="remove"]').click();await page.locator('#btn-submit-modal').click();assert.equal(await page.evaluate(()=>modelsData[0].colorOptions.find(c=>c.name==='Black').active),false);
 await page.locator('#models-container .btn-edit').click();await page.locator('[data-kind="colors"][data-index="1"][data-option-action="toggle"]').click();await page.locator('#btn-submit-modal').click();
 // Sold-out cards remain present; archiving the model hides every card.
 await page.evaluate(()=>{itemsData.forEach(i=>i.status='Sold');dartSaveAll();dartRefreshAll();});
 await shop.goto(origin+'/products.html');await shop.waitForFunction(()=>document.getElementById('productResultsCount')?.textContent==='2 products');assert.equal(await shop.locator('#productsPart1 .out-of-stock-badge').count(),2);
 await shop.locator('#productsPart1 .product-card[data-id]').first().click();await shop.waitForFunction(()=>document.getElementById('SectionModel').style.display==='flex');assert.equal(await shop.locator('#modalBuyBtn').isDisabled(),true);
 await shop.setViewportSize({width:390,height:844});await shop.screenshot({path:path.join(root,'tests/product-mobile.png')});
 await page.evaluate(()=>dartArchiveRecord('models',modelsData[0].id));await shop.reload();await shop.waitForFunction(()=>document.getElementById('productResultsCount')?.textContent==='0 products');
 assert.deepEqual(errors,[]);
 console.log('PASS V7 browser acceptance: empty reset, forms, uploads, groups, selection scope, filters, persistence, color/gallery sync, missing-image purchase, reservation, checkout snapshot, old order edit, Sold Out, model archive; mobile 390px.');
 await context.close();await browser.close();server.close();
})().catch(e=>{console.error(e);server.close();process.exit(1);});
/* END V7 acceptance tests */
