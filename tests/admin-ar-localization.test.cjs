// Arabic dashboard/courier UI contract: translate presentation only, never business values.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "Js/dart-admin-ar.js"), "utf8");
const dictionary = JSON.parse(fs.readFileSync(path.join(root, "Js/dart-admin-ar.json"), "utf8"));
assert.ok(dictionary.length >= 1200, "Arabic dictionary should include all admin labels");
assert.ok(dictionary.some(([key, value]) => key === "Order verification policy" && value === "سياسة التحقق من الأوردرات"));
assert.ok(dictionary.some(([key, value]) => key === "Code PIC" && value === "كود القطعة"));
assert.match(source, /fetch\("\/Js\/dart-admin-ar\.json\?/);
const dashboard = fs.readFileSync(path.join(root, "Eye/Dart Eye.html"), "utf8");
const courier = fs.readFileSync(path.join(root, "rep.html"), "utf8");
const css = fs.readFileSync(path.join(root, "CSS/dart-internal-ar.css"), "utf8");

function text(value) {
  return { nodeType: 3, nodeValue: value, parentElement: null };
}
function element(tag, attributes = {}, childNodes = []) {
  const node = {
    nodeType: 1, tagName: tag.toUpperCase(), childNodes,
    attributes: { ...attributes }, parentElement: null,
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); },
    getAttribute(name) { return this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    get value() {
      return this.hasAttribute("value") ? this.getAttribute("value")
        : this.childNodes.filter(child => child.nodeType === 3).map(child => child.nodeValue).join("").trim();
    },
    set value(value) { this.setAttribute("value", String(value)); },
    closest(selector) {
      if (this.tagName === "CODE") return this;
      if (selector.includes(".dart-typing-preview") && this.attributes.class?.split(/\s+/).includes("dart-typing-preview")) return this;
      return this.parentElement?.closest(selector) || null;
    },
    contains(target) {
      return this.childNodes.some((child) => child === target || child.contains?.(target));
    }
  };
  for (const child of childNodes) child.parentElement = node;
  return node;
}

const title = element("h2", {}, [text("Total Inflow")]);
const input = element("input", { placeholder: "Code PIC", name: "itemCode", value: "ABC-001" });
const area = element("textarea", { placeholder: "Full address written on the ID", value: "Cairo, 10 Street" });
const action = element("button", { "aria-label": "Confirm Dispatch" }, [text("Confirm Dispatch")]);
const retained = element("strong", {}, [text("Dart Card")]);
const preview = element("span", { class: "dart-typing-preview" }, [text("Today")]);
const code = element("code", {}, [text("Code Model")]);
const statusOption = element("option", {}, [text("Active")]);
const explicitOption = element("option", { value: "Accepted" }, [text("Accepted")]);
const body = element("body", {}, [title, input, area, action, retained, code, preview, statusOption, explicitOption]);
let observerCallback;
let observerOptions;
const document = {
  body, documentElement: { lang: "en" }, readyState: "complete",
  createTreeWalker(node) {
    const nodes = [];
    function collect(parent) {
      for (const child of parent.childNodes || []) {
        nodes.push(child);
        collect(child);
      }
    }
    collect(node);
    let current = -1;
    return {
      nextNode() { current += 1; return current < nodes.length; },
      get currentNode() { return nodes[current]; }
    };
  }
};
class MutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe(_node, options) { observerOptions = options; }
}
vm.runInNewContext(source, {
  document, MutationObserver,
  NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
  queueMicrotask(callback) { callback(); },
}, { filename: "dart-admin-ar.js", timeout: 3000 });

assert.equal(document.documentElement.lang, "ar");
assert.equal(title.childNodes[0].nodeValue, "إجمالي الوارد");
assert.equal(input.getAttribute("placeholder"), "كود القطعة");
assert.equal(input.getAttribute("name"), "itemCode");
assert.equal(input.getAttribute("value"), "ABC-001");
assert.equal(area.getAttribute("placeholder"), "العنوان كامل زي البطاقة");
assert.equal(area.getAttribute("value"), "Cairo, 10 Street");
assert.equal(action.getAttribute("aria-label"), "تأكيد خروج الأوردر للتوصيل");
assert.equal(action.childNodes[0].nodeValue, "تأكيد خروج الأوردر للتوصيل");
assert.equal(retained.childNodes[0].nodeValue, "Dart Card");
assert.equal(code.childNodes[0].nodeValue, "Code Model");
assert.equal(statusOption.childNodes[0].nodeValue, "نشط", "Select option label should be Arabic");
assert.equal(statusOption.value, "Active", "Implicit select value must remain the backend identifier");
assert.equal(explicitOption.childNodes[0].nodeValue, "مقبول");
assert.equal(explicitOption.value, "Accepted", "Explicit select value must be unchanged");
assert.equal(preview.childNodes[0].nodeValue, "Today", "Merchant-authored text must remain exactly as entered");
assert.ok(observerOptions.characterData && observerOptions.childList);
const appended = element("span", {}, [text("3 selected")]);
appended.parentElement = body;
body.childNodes.push(appended);
observerCallback([{ type: "childList", addedNodes: [appended] }]);
assert.equal(appended.childNodes[0].nodeValue, "3 محدد");
const changed = text("Code Model");
changed.parentElement = appended;
appended.childNodes[0] = changed;
observerCallback([{ type: "characterData", target: changed }]);
assert.equal(changed.nodeValue, "كود الموديل");
const dynamicOption = element("option", {}, [text("New")]);
dynamicOption.parentElement = body;
body.childNodes.push(dynamicOption);
observerCallback([{ type: "childList", addedNodes: [dynamicOption] }]);
assert.equal(dynamicOption.childNodes[0].nodeValue, "جديد");
assert.equal(dynamicOption.value, "New", "Dynamic option value must be preserved");
const changedPreview = text("Today");
changedPreview.parentElement = preview;
preview.childNodes[0] = changedPreview;
observerCallback([{ type: "characterData", target: changedPreview }]);
assert.equal(changedPreview.nodeValue, "Today", "Dynamic merchant text must remain untouched");
for (const [name, html] of [["dashboard", dashboard], ["courier", courier]]) {
  assert.match(html, /<html lang="ar"/, name + " must declare Arabic");
  assert.match(html, /dart-admin-ar\.js/, name + " must load Arabic labels");
  assert.match(html, /dart-internal-ar\.css/, name + " must load Arabic typography");
}
assert.ok(css.includes("direction: rtl"));
assert.match(dashboard, /<html lang="ar" dir="rtl">/);
const styles = fs.readdirSync(path.join(root, "Eye")).filter(file => file.endsWith(".css"));
for (const file of styles) {
  const text = fs.readFileSync(path.join(root, "Eye", file), "utf8");
  assert.doesNotMatch(text, /(?:margin|padding|border)-(?:left|right)\s*:/, file + " must use logical spacing");
  assert.doesNotMatch(text, /text-align:\s*(?:left|right)\b/, file + " must align with reading direction");
}
assert.match(fs.readFileSync(path.join(root,"Eye/dart-sidebar.css"),"utf8"), /html\[dir="rtl"\].*dart-sidebar-mobile-open/);
console.log("PASS Arabic UI labels: dashboard, courier, dynamic content and unchanged business identifiers");
