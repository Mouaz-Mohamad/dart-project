const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm");
const read = name => fs.readFileSync(name, "utf8");
const calls = [], dialogs = [], fields = new Map();
const field = id => {
  if (!fields.has(id)) fields.set(id, { value: "", innerHTML: "", replaceChildren() {}, append() {} });
  return fields.get(id);
};
let accept = true, hydrated = 0;
const c = {
  console, dartNowISO: () => new Date().toISOString(), dartIsArchived: order => !!order.isArchived, dartFindRepById: () => ({ id: "REP" }), dartRefreshAll() {},
  representativeData: [{id:"REP",name:"Courier",repId:"Rep-1",status:"Active"}], dartIsActive: () => true,
  dartEsc: String, openModal() { calls.push("assignment-modal"); },
  document: { getElementById: field, createElement: () => ({}) },
  window: {
    DartOrdersApi: { isBusy: () => false, hydrate: async () => { hydrated++; },
      workflow: async (id, body) => { calls.push({ id, body }); },
      bulkWorkflow: async body => { calls.push({ bulk: body }); return { result: { succeeded: body.orderRefs.map(orderRef => ({orderRef})), failed: [] } }; } },
    DartShipping: { loadCompanies: async () => {}, companies: () => [{id:"dart",name:"Dart Delivery",active:true}] },
    DartDialog: { confirm: async text => { dialogs.push(text); return accept; }, alert() {} },
  },
};
vm.createContext(c);
vm.runInContext(read("src/dashboard/core/shared-state.js").match(/const DART_ORDER_FLOW = \[[\s\S]*?\];/)[0], c);
for (const name of ["order-workflow", "operations-modals"]) vm.runInContext(read(`src/dashboard/core/${name}.js`), c);
(async () => {
  const preparing = { id:"A",orderId:"ORDER-A",status:"Preparing",version:1 };
  await c.dartRequestOrderTransition([preparing], "Ready for Dispatch");
  assert.deepEqual(calls.splice(0), ["assignment-modal"], "planning only opens assignment; no workflow confirmation yet");
  assert.equal(dialogs.length, 0);
  assert.equal((await c.dartApplyTransition(preparing,"Out With Representative")).ok, false, "cannot skip ready step");
  const ready = { ...preparing,status:"Ready for Dispatch",version:4,pendingDispatch:{companyId:"dart",representativeId:"REP"} };
  accept = false; await c.dartRequestOrderTransition([ready],"Out With Representative"); assert.equal(calls.length,0);
  accept = true; await c.dartRequestOrderTransition([ready],"Out With Representative");
  assert.equal(calls[0].body.expectedVersion,4); assert.equal(calls[0].body.target,"Out With Representative");
  assert.equal(calls[0].body.representativeId,undefined, "confirmation uses saved server assignment"); calls.length=0;
  await c.dartRequestOrderTransition([ready,{...ready,id:"B",orderId:"ORDER-B",version:7}],"Out With Representative");
  assert.equal(calls[0].bulk.expectedVersions["ORDER-A"],4); assert.equal(calls[0].bulk.expectedVersions["ORDER-B"],7); calls.length=0;
  await c.dartRequestOrderTransition([ready],"Ready for Dispatch"); assert.equal(calls[0],"assignment-modal");
  assert.equal(field("rep-assignment-select").value,"REP", "editing reopens planned assignment");
  assert.equal(c.dartCanTransition({...ready,status:"Out With Representative"},"Ready for Dispatch"),false);
  assert.equal(c.dartCanTransition({...ready,status:"Out With Representative"},"Cancelled"),false);
  assert.equal(c.dartCanTransition(ready,"Preparing"),false, "back uses its explicit rollback path");
  c.window.DartOrdersApi.workflow = async () => { throw Object.assign(Error("Assignment changed"),{code:"ORDER_STATE_STALE"}); };
  assert.equal((await c.dartApplyTransition(ready,"Out With Representative")).ok,false); assert.equal(hydrated,1);
  const html=read("Eye/Dart Eye.html"); assert.match(html,/data-bulk-order-status="Ready for Dispatch"/);
  assert.match(html,/data-bulk-order-status="Out With Representative">Confirm Dispatch/);
  assert.match(html,/id="confirm-rep-assignment">Save Assignment/);
  console.log("PASS dispatch preparation, explicit confirmation, versions, bulk, assignment editing and stale recovery");
})().catch(error => { console.error(error); process.exitCode=1; });
