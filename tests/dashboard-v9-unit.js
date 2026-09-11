const fs = require("fs");
const vm = require("vm");
const assert = require("node:assert/strict");

class Storage {
  constructor() {
    this.values = new Map();
  }
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }
  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

const source = fs.readFileSync("Eye/dart.js", "utf8");
const localStorage = new Storage();
const nodes = new Map();
function node(id) {
  if (!nodes.has(id))
    nodes.set(id, {
      id,
      classList: { toggle() {} },
      textContent: "",
      innerHTML: "",
      onclick: null,
    });
  return nodes.get(id);
}

const context = vm.createContext({
  console,
  Date,
  Intl,
  JSON,
  String,
  Number,
  Boolean,
  Object,
  Array,
  Set,
  Map,
  Math,
  localStorage,
  document: { getElementById: node },
  openModal() {},
  closeModal() {},
  dartEsc: (value) => String(value ?? ""),
  dartIsArchived: (row) => Boolean(row?.isArchived || row?.isDeleted),
  dartIsActive: (row) => !row?.isArchived && !row?.isDeleted,
  dartDateValue(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  },
  dartSyncUserCardFlags() {},
  dartAudit() {},
  dartSaveAll() {},
  dartRefreshAll() {},
});

function loadSegment(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Unable to find ${startMarker}`);
  vm.runInContext(source.slice(start, end), context, {
    filename: "Eye/dart.js",
  });
}

loadSegment("function dartCairoCalendar", "function renderTopClients");

context.customersData = [
  {
    id: "customer-db-1",
    clientId: "DR-1",
    clientName: "Moaz Mohamed Ahmed",
    birthday: "2-9-2008",
  },
  {
    id: "customer-db-2",
    clientId: "DR-2",
    clientName: "Second Customer Name",
    birthday: "2001-09-02",
  },
  {
    id: "customer-db-3",
    clientId: "DR-3",
    clientName: "Different Birthday",
    birthday: "2000-09-03",
  },
];

const afterEight = new Date("2026-09-01T20:30:00+03:00");
context.afterEight = afterEight;
let batch = vm.runInContext("dartBirthdayMessageBatch(afterEight)", context);
assert.equal(batch.open, true);
assert.equal(batch.key, "2026-09-02");
assert.deepEqual(
  Array.from(batch.rows, (row) => row.clientId),
  ["DR-1", "DR-2"],
  "8 PM queue must include only tomorrow's unsent birthdays",
);

localStorage.setItem(
  "dart_birthday_messages",
  JSON.stringify([
    {
      customerRecordId: "customer-db-1",
      clientId: "DR-1",
      birthdayDate: "2026-09-02",
    },
  ]),
);
batch = vm.runInContext("dartBirthdayMessageBatch(afterEight)", context);
assert.deepEqual(
  Array.from(batch.rows, (row) => row.clientId),
  ["DR-2"],
  "a queued customer must disappear while unsent customers remain",
);

context.beforeEight = new Date("2026-09-01T19:30:00+03:00");
batch = vm.runInContext("dartBirthdayMessageBatch(beforeEight)", context);
assert.equal(batch.open, false, "tomorrow queue must stay closed before 8 PM Cairo");

loadSegment("function dartDeleteImpact", "function dartCustomerStats");

function resetDeleteFixtures() {
  context.modelsData = [];
  context.itemsData = [
    { id: "item-db-1", itemCode: "PIC-1", orderId: "ORD-1" },
  ];
  context.customersData = [
    { id: "customer-db-1", clientId: "DR-1", clientName: "Moaz Mohamed" },
  ];
  context.ordersData = [
    {
      id: "order-db-1",
      orderId: "ORD-1",
      clientId: "DR-1",
      items: ["PIC-1"],
    },
  ];
  context.returnsData = [
    {
      id: "return-db-1",
      returnId: "RET-1",
      clientId: "DR-1",
      orderId: "ORD-1",
      itemCode: "PIC-1",
    },
  ];
  context.reviewsData = [{ id: "review-db-1", clientId: "DR-1" }];
  context.cardsData = [
    { id: "card-db-1", clientId: "DR-1", status: "Active" },
  ];
  context.representativeData = [];
  context.damageData = [
    { id: "damage-db-1", itemCode: "PIC-1", returnId: "RET-1" },
  ];
  context.sectionsMap = {
    customers: {
      get data() {
        return context.customersData;
      },
      set data(value) {
        context.customersData = value;
      },
    },
  };
  localStorage.setItem("dart_users", JSON.stringify([{ customerId: "DR-1" }]));
  localStorage.setItem(
    "dart_birthday_rewards",
    JSON.stringify([{ id: "reward-1", customerId: "DR-1" }]),
  );
  localStorage.setItem(
    "dart_birthday_messages",
    JSON.stringify([{ id: "message-1", clientId: "DR-1" }]),
  );
  localStorage.setItem(
    "dart_message_queue",
    JSON.stringify([{ id: "queue-1", customerId: "DR-1" }]),
  );
}

resetDeleteFixtures();
vm.runInContext('deletePermanently("customer-db-1", "customers")', context);
node("hard-delete-only").onclick();
assert.equal(context.customersData.length, 0, "record-only must delete the selected record");
assert.equal(context.ordersData.length, 1, "record-only must preserve linked orders");
assert.equal(JSON.parse(localStorage.getItem("dart_users")).length, 1, "record-only must preserve the linked login");

resetDeleteFixtures();
vm.runInContext('deletePermanently("customer-db-1", "customers")', context);
node("hard-delete-cascade").onclick();
for (const key of [
  "customersData",
  "ordersData",
  "itemsData",
  "returnsData",
  "reviewsData",
  "cardsData",
  "damageData",
]) assert.equal(context[key].length, 0, `cascade must clear linked ${key}`);
for (const key of [
  "dart_users",
  "dart_birthday_rewards",
  "dart_birthday_messages",
  "dart_message_queue",
]) assert.equal(JSON.parse(localStorage.getItem(key)).length, 0, `cascade must clear linked ${key}`);

console.log("PASS dashboard birthday queue and both hard-delete modes");
