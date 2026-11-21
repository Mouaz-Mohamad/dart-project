// Real dashboard markup/styles with no business scripts or production requests.
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'Eye/Dart Eye.html'),'utf8');
const styles=[...source.matchAll(/<link[^>]+href="([^"?]+\.css)(?:\?[^\"]*)?"[^>]*>/g)]
  .map(match=>match[1]).filter(file=>!file.startsWith('http'))
  .map(file=>fs.readFileSync(path.resolve(root,'Eye',file),'utf8').replace(/@import[^;]*;/g,''));
const html=source.replace(/<script\b[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE||chromium.executablePath(),args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const page=await browser.newPage();await page.route('**/*',route=>route.abort());
  await page.setContent(html);for(const content of styles)await page.addStyleTag({content});await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});
  for(const width of [1440,1024,768,767,480,370]){
   await page.setViewportSize({width,height:900});
   await page.evaluate(()=>{document.body.className='';document.querySelector('#items').classList.add('active-section');});
   const layout=await page.evaluate(()=>{
    const sidebar=document.querySelector('body > .cont-menu'),section=document.querySelector('#items');
    const s=getComputedStyle(sidebar),r=sidebar.getBoundingClientRect(),c=getComputedStyle(section);
    return {dir:getComputedStyle(document.documentElement).direction,right:r.right,left:r.left,marginRight:c.marginRight,marginLeft:c.marginLeft,hidden:s.visibility,transform:s.transform,sectionWidth:section.getBoundingClientRect().width};
   });
   assert.equal(layout.dir,'rtl');assert.equal(layout.marginLeft,'0px');
   if(width>768){
    assert.ok(Math.abs(layout.right-width)<2);assert.equal(layout.marginRight,'252px');
    const shipping=await page.locator('#shipping').evaluate(el=>{el.style.display='block';const r=el.getBoundingClientRect();return {left:r.left,right:r.right};});
    assert.ok(shipping.left>=-1&&shipping.right<=width-251,'shipping uses the sidebar width');
    await page.evaluate(()=>document.body.classList.add('dart-sidebar-collapsed'));
    assert.equal(await page.locator('#items').evaluate(el=>getComputedStyle(el).marginRight),'72px');
   }else{
    assert.equal(layout.marginRight,'0px');assert.equal(layout.hidden,'hidden');
    await page.evaluate(()=>document.body.classList.add('dart-sidebar-mobile-open'));
    const drawer=await page.locator('body > .cont-menu').evaluate(el=>({right:el.getBoundingClientRect().right,visible:getComputedStyle(el).visibility}));
    assert.equal(drawer.visible,'visible');assert.ok(Math.abs(drawer.right-width)<2);
   }
   await page.evaluate(()=>{document.body.className='';const modal=document.getElementById('item-add-modal');modal.classList.add('active');});
   const modal=await page.locator('#item-add-modal .modal-content').boundingBox();
   assert.ok(modal.x>=-1&&modal.x+modal.width<=width+1,'modal stays within viewport at '+width);
   assert.equal(await page.locator('#modal-item-code-pic').evaluate(el=>getComputedStyle(el).direction),'ltr');
   await page.evaluate(()=>document.getElementById('item-add-modal').classList.remove('active'));
  }
  console.log('PASS RTL dashboard: right sidebar, collapsed offset, mobile drawer, centered modal and isolated item codes at six widths');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
