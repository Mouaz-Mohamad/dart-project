const fs=require('fs'),vm=require('vm'),{webcrypto}=require('crypto');
class Storage{constructor(){this.data=new Map()}getItem(k){return this.data.has(k)?this.data.get(k):null}setItem(k,v){this.data.set(k,String(v))}removeItem(k){this.data.delete(k)}}
const localStorage=new Storage(),sessionStorage=new Storage(),callbacks={};
const document={addEventListener(type,callback){(callbacks[type]??=[]).push(callback)},getElementById(){return null},querySelector(){return null},hidden:false};
const window={addEventListener(){}};window.window=window;
const context=vm.createContext({window,document,localStorage,sessionStorage,crypto:webcrypto,TextEncoder,Image:class{},FileReader:class{},navigator:{},location:{},fetch:async()=>{},L:undefined,alert(){},confirm(){return true},prompt(){return null},setInterval(){},setTimeout(){},console,Date,Math,JSON,Object,Array,String,Number,Boolean,RegExp,Error,Set,Map});
async function sha(value){const digest=await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
function assert(ok,message){if(!ok)throw new Error(message)}
(async()=>{
  const activeHash=await sha('password1'),pendingHash=await sha('password2');
  localStorage.setItem('dart_representatives',JSON.stringify([{id:'R1',repId:'Rep-1',name:'Active Rep',nationalId:'29901011234567',email:'active@example.com',phone1:'01011112222',phone2:'-',passwordHash:activeHash,status:'Active',isArchived:false,isDeleted:false},{id:'R2',repId:'Rep-2',name:'Pending Rep',nationalId:'29901011234568',email:'pending@example.com',phone1:'01011112223',phone2:'-',passwordHash:pendingHash,status:'Pending Approval',isArchived:false,isDeleted:false}]));
  localStorage.setItem('dart_orders',JSON.stringify([{id:'O1',representativeId:'R1',status:'Out With Representative',finalAmount:700},{id:'O2',representativeId:'R1',status:'Representative On The Way',totalPrice:500,discount:20},{id:'O3',representativeId:'R2',status:'Out With Representative'}]));
  vm.runInContext(fs.readFileSync('Js/dart-rep.js','utf8'),context,{filename:'Js/dart-rep.js'});
  const portal=window.DartRepPortal,rep=await portal.login('Rep-1','password1');
  assert(rep.id==='R1','active Rep ID login failed');assert(portal.currentRep().id==='R1','representative session missing');
  assert(portal.repOrders(rep).length===2,'multiple assigned orders must be visible');assert(portal.orderTotal({totalPrice:500,discount:20})===400,'representative total must include discount');
  const near={latitude:30.0444,longitude:31.2357,courierLocation:{lat:30.045, lng:31.236, updatedAt:new Date().toISOString()}};
  const far={latitude:30.0444,longitude:31.2357,courierLocation:{lat:30.10, lng:31.30, updatedAt:new Date().toISOString()}};
  assert(portal.deliveryProximity(near).ok,'Delivered must be enabled within the 1 km radius');
  assert(!portal.deliveryProximity(far).ok,'Delivered must stay blocked outside the 1 km radius');
  assert(portal.googleMapsRoute({latitude:30.0444,longitude:31.2357}).includes('google.com/maps/dir'), 'Start delivery must build a Google Maps route');
  const orders=JSON.parse(localStorage.getItem('dart_orders'));
  orders.push({id:'OX',orderId:'K-X',clientId:'DA-1',clientName:'Customer',phone1:'01000000000',status:'Delivered',finalAmount:420,totalPrice:600,discount:30,orderLevelDiscountAmount:180,amountRefunded:0,items:['OLD-I'],priceSnapshot:[{itemId:'OLD-DB',itemCode:'OLD-I',modelCode:'M-1',color:'Black',size:'M',qty:1,originalUnitPrice:600,finalUnitPrice:600,costSnapshot:400}],activityLog:[]});
  localStorage.setItem('dart_orders',JSON.stringify(orders));
  localStorage.setItem('dart_items',JSON.stringify([
    {id:'OLD-DB',itemCode:'OLD-I',modelId:'M-1',color:'Black',size:'M',status:'Sold'},
    {id:'NEW-DB',itemCode:'NEW-I',modelId:'M-1',color:'Blue',size:'L',status:'Processing/Held'},
  ]));
  localStorage.setItem('dart_returns',JSON.stringify([{
    id:'RET-DB',returnId:'R-1',orderId:'K-X',clientId:'DA-1',clientName:'Customer',phone1:'01000000000',
    representativeId:'R1',representativeBusinessId:'Rep-1',requestType:'Exchange',status:'Representative Assigned',
    itemCode:'OLD-I',modelId:'M-1',replacementItemCode:'NEW-I',exchangeChainId:'OLD-I',originalNetAmount:420,
    brandCourierFee:50,customerCourierFee:0,isPostDeliveryReturn:true,latitude:30.0444,longitude:31.2357,
    originalLineSnapshot:{itemId:'OLD-DB',itemCode:'OLD-I',modelCode:'M-1',color:'Black',size:'M',qty:1,originalUnitPrice:600,finalUnitPrice:600,costSnapshot:400},
    replacementLineSnapshot:{itemId:'NEW-DB',itemCode:'NEW-I',modelCode:'M-1',color:'Blue',size:'L',qty:1,originalUnitPrice:600,finalUnitPrice:600,costSnapshot:400},
  }]));
  assert(portal.repReturns(rep).length===1,'assigned return pickups must be visible to the representative');
  portal.startReturnPickup('RET-DB');
  const startedReturns=JSON.parse(localStorage.getItem('dart_returns'));
  startedReturns[0].courierLocation={lat:30.0445,lng:31.2358,updatedAt:new Date().toISOString()};
  localStorage.setItem('dart_returns',JSON.stringify(startedReturns));
  portal.completeReturnPickup('RET-DB');
  const completedReturn=JSON.parse(localStorage.getItem('dart_returns'))[0];
  const completedOrder=JSON.parse(localStorage.getItem('dart_orders')).find(row=>row.id==='OX');
  const completedItems=JSON.parse(localStorage.getItem('dart_items'));
  assert(completedReturn.status==='Completed','representative pickup completion must close the operational return stage');
  assert(completedReturn.brandCourierFeeStatus==='Paid by Dart','first exchange courier fee must be paid by Dart at completed pickup');
  assert(completedOrder.amountRefunded===0,'exchange completion must not refund or reduce the order sale');
  assert(completedOrder.items[0]==='NEW-I','replacement physical code must replace the old order item');
  assert(completedOrder.priceSnapshot[0].finalUnitPrice===600,'replacement must inherit the immutable old line price');
  assert(completedItems.find(item=>item.itemCode==='OLD-I').status==='Return Inspection','old physical item must wait for admin inspection');
  assert(completedItems.find(item=>item.itemCode==='NEW-I').status==='Sold','replacement physical item must become sold');
  let pendingBlocked=false;try{await portal.login('29901011234568','password2')}catch(error){pendingBlocked=error.message.includes('approval')}
  assert(pendingBlocked,'pending representative must not log in');console.log('PASS representative auth and assignment unit tests');
})().catch(error=>{console.error(error.stack||error);process.exit(1)});
