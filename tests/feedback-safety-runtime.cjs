const assert = require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('src/dashboard/core/shared-state.js','utf8');
const writes=[];
const context={window:{},saveDataToStorage:(key,data)=>writes.push({key,data})};
for(const key of ['modelsData','itemsData','customersData','ordersData','returnsData','reviewsData','cardsData','representativeData','damageData','notificationData','auditData'])context[key]=[];
context.reviewsData=[{id:'original',review:'Original review'}];
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function dartSaveAll('),source.indexOf('function getRowClass(')),context);
assert.throws(()=>context.dartSaveAll(),/explicit affected sections/);
context.dartSaveAll(["models", "audit"]);
assert.deepEqual(writes.map(row=>row.key),["dart_models","dart_audit"]);
assert.equal(writes.some(row=>["dart_customers","dart_returns","dart_cards","dart_notifications"].includes(row.key)),false);
assert.equal(writes.some(row=>['dart_reviews','dart_contact_messages'].includes(row.key)),false,'unrelated Save All must never write a feedback list');
(async()=>{
 const calls=[],review={id:'r1',review:'Original'},contact={id:'c1',recordType:'contact',source:'Contact Us',review:'Message'};
 context.reviewsData=[review,contact];
 context.window.DartDomainState={writeAndSync:async(key,data)=>calls.push({key,data})};
 assert.equal(await context.dartSaveFeedback(review),true);
 assert.equal(calls[0].key,'dart_reviews');assert.deepEqual(calls[0].data,[review]);
 assert.equal(await context.dartSaveFeedback(contact),true);
 assert.equal(calls[1].key,'dart_contact_messages');assert.deepEqual(calls[1].data,[contact]);
 let hydrated=false,alerted=false;
 context.window.DartDomainState.writeAndSync=async()=>{throw new Error('Synthetic save failure')};
 context.window.DartDomainState.hydrateDomain=async(domain)=>{hydrated=domain==='reviews'};
 context.window.DartDialog={alert:()=>{alerted=true}};
 assert.equal(await context.dartSaveFeedback(review),false);assert.equal(hydrated,true);assert.equal(alerted,true);
 const memory=new Map(),requests=[],listeners=new Map();
 const f={window:{DartState:{read:(key,fallback)=>memory.get(key)??fallback,write:(key,data)=>memory.set(key,data)},addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent(){},setInterval(){}},
  document:{cookie:'',hidden:false,addEventListener(){}},location:{origin:'https://dart.test'},console,structuredClone,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},setTimeout:()=>1,clearTimeout(){},
  fetch:async(url,options)=>{requests.push({url,options});let payload;
   if(url.endsWith('/admin/domain-state'))payload={domains:[{domain:'reviews',version:7,data:[review,{id:'r2'}]},{domain:'contacts',version:2,data:[contact]}]};
   else if(url.includes('/admin/audit?'))payload={audit:[]};
   else if(url.endsWith('/domain-state/reviews'))payload={domain:'reviews',version:7,data:[review,{id:'r2'}]};
   else if(url.endsWith('/feedback/reviews/r1')){assert.equal(options.method,'DELETE');assert.deepEqual(JSON.parse(options.body),{expectedVersion:7});payload={domain:'reviews',version:8,data:[{id:'r2'}],relatedVersions:{reviews:8,contacts:3}};}
   else throw Error('Unexpected request '+url);
   return{ok:true,json:async()=>payload};}
 };
 vm.runInNewContext(fs.readFileSync('Eye/dart-domain-state.js','utf8'),f);
 await f.window.DartDomainState.hydrateAll();
 await f.window.DartDomainState.removeFeedback('reviews','r1');
 assert.equal(requests.filter(x=>x.options.method==='DELETE').length,1);
 assert.deepEqual(memory.get('dart_reviews'),[{id:'r2'}]);assert.deepEqual(memory.get('dart_contact_messages'),[contact]);
 assert.equal(f.window.DartDomainState.version('reviews'),8);
 console.log('PASS feedback safety: unrelated saves, isolated review/contact edits, failed-save recovery and explicit one-record deletion');
})().catch(error=>{console.error(error);process.exitCode=1});
