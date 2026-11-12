const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const {openStorefrontFixture} = require('./helpers/storefront-fixture.cjs');
const source = fs.readFileSync('Js/dart-birthday-welcome.js','utf8');
const key = 'dart_birthday_welcome_dismissed_v1';
async function scenario({user=null, failed=false, seen=false}={}) {
  const storage = new Map(seen ? [[key,'1']] : []), events={}, listeners={}, buttons={};
  const dialog = {open:false, shows:0,
    showModal(){this.open=true;this.shows++;}, close(){this.open=false;listeners.close?.();},
    addEventListener(name,fn){listeners[name]=fn;},getBoundingClientRect(){return {left:10,right:100,top:10,bottom:100};},
    querySelector(selector){return buttons[selector] ||= {addEventListener(name,fn){this[name]=fn;},focus(){}};}};
  const context={document:{readyState:'complete',getElementById:()=>dialog},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    window:{DartPlatform:{hydrateApiSession:async()=>{if(failed)throw Error('offline');return user;},currentUser:()=>user},addEventListener:(name,fn)=>events[name]=fn}};
  vm.runInNewContext(source,context);await new Promise(resolve=>setImmediate(resolve));
  return {dialog,buttons,events,listeners,storage};
}
(async()=>{
  const guest=await scenario();assert.equal(guest.dialog.open,true);assert.equal(guest.dialog.shows,1);
  guest.buttons['[data-dart-birthday-welcome-close]'].click();
  assert.equal(guest.dialog.open,false);assert.equal(guest.storage.get(key),'1');
  assert.equal((await scenario({seen:true})).dialog.shows,0);
  assert.equal((await scenario({user:{id:'synthetic'}})).dialog.shows,0);
  assert.equal((await scenario({failed:true})).dialog.shows,0);
  const signedIn=await scenario();signedIn.events['dart:customer-session-changed']({detail:{user:{id:'synthetic'}}});assert.equal(signedIn.dialog.open,false);
  const backdrop=await scenario();backdrop.listeners.click({target:backdrop.dialog,clientX:0,clientY:0});assert.equal(backdrop.dialog.open,false);
  const cta=await scenario();cta.buttons['[data-dart-birthday-welcome-cta]'].click();assert.equal(cta.storage.get(key),'1');
  const raw=fs.readFileSync('index.html','utf8'),open=openStorefrontFixture('index.html',raw);
  assert.match(raw,/src="Js\/dart-birthday-welcome\.js"/);
  assert.doesNotMatch(open,/src="Js\/dart-birthday-welcome\.js/);
  assert.match(open,/id="dart-birthday-welcome-popup"/);
  assert.equal(openStorefrontFixture('products.html',raw),raw);
  console.log('PASS birthday welcome: guest session, authenticated/offline suppression, dismissal, CTA, backdrop, sign-in close and isolated business fixtures');
})().catch(error=>{console.error(error);process.exitCode=1;});
