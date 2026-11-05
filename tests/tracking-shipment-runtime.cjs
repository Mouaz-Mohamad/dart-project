"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
class Node {
  constructor() { this.children = new Map(); this.style = {}; this.classList = { toggle() {} }; }
  querySelector(selector) { if (!this.children.has(selector)) this.children.set(selector, new Node()); return this.children.get(selector); }
  querySelectorAll() { return []; }
  addEventListener() {}
  replaceChildren() { this.lastElementChild = null; }
  remove() { this.removed = true; }
  appendChild(fragment) { this.lastElementChild = fragment.querySelector("[data-order-tracking-card]"); }
}
const list = new Node(), fragments = [];
const document = { hidden: false, addEventListener() {}, getElementById(id) {
  if (id === "orderTrackingList") return list;
  if (["order-tracking-card-template", "order-tracking-unit-template", "order-tracking-line-template"].includes(id)) return { content: { cloneNode() {
    const node = new Node(); fragments.push({ id, node }); return node;
  } } };
  return null;
} };
let order;
const window = { addEventListener() {}, DartState: { read: key => key === "dart_orders" ? [order] : [], formatMoney: String },
  DartPlatform: { currentUser: () => ({ customerId: "customer" }) } };
const context = { window, document, location: { search: "?order=K-1" }, sessionStorage: { getItem() {} },
  URLSearchParams, URL, setInterval() {}, setTimeout() {}, console };
vm.runInNewContext(fs.readFileSync("Js/dart-tracking.js", "utf8"), context);
for (const [status, shipmentStatus, expected] of [
  ["Out With Representative", "Handed Over", "Shipped"],
  ["Out With Representative", "Returned to Sender", "Returned to Sender"],
  ["Delivered", "Handed Over", "Delivered"],
  ["Refused", "Returned to Sender", "Refused"],
]) {
  order = { id: "order", orderId: "K-1", clientId: "customer", status, priceSnapshot: [],
    deliveryShipment: { type: "external", status: shipmentStatus, trackingNumber: "TEST1", companyName: "Test Carrier", trackingUrl: "https://carrier.example/TEST1" } };
  fragments.length = 0;
  window.DartTracking.render();
  if (["Delivered", "Refused"].includes(status)) {
    assert.equal(list.lastElementChild, null, "terminal orders leave active shipment tracking");
    continue;
  }
  const card = list.lastElementChild, box = card.querySelector("[data-external-shipping]");
  assert.equal(card.querySelector("[data-order-eta]").textContent, expected);
  assert.equal(box.querySelector("h3").textContent, expected === "Shipped" ? "Your Order Has Been Shipped!" : expected);
  const unit = fragments.find(row => row.id === "order-tracking-unit-template").node.querySelector("[data-order-unit]");
  assert.equal(unit.querySelector('[data-order-unit-field="status"]').textContent, expected === "Shipped" ? status : expected);
  assert.equal(card.querySelector("[data-order-map-shell]").removed, true);
  assert.equal(box.querySelector("[data-shipping-link]").href, "https://carrier.example/TEST1");
}
console.log("PASS external shipment tracking: handed over, returned, delivered and refused labels, item status and map isolation");
