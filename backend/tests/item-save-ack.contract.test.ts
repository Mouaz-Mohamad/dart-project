import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inventory = readFileSync(new URL("../../src/dashboard/inventory.js",import.meta.url),"utf8");
const catalog = readFileSync(new URL("../../src/storefront/catalog.js",import.meta.url),"utf8");

describe("physical item save acknowledgement",()=>{
  it("keeps the editor busy until the server write and authoritative rehydration finish",()=>{
    const editor=inventory.slice(inventory.indexOf("function setupItemModal()"),inventory.indexOf("function populateItemOptions("));
    expect(editor).toContain('form.addEventListener("submit", async (e) =>');
    expect(editor).toContain('form.dataset.saving = "true"');
    expect(editor).toContain("await C.savePhysicalItem(candidate)");
    expect(editor).not.toContain("dartSaveAll()");
    expect(editor).toContain("await C.hydrate(true)");
    expect(editor.indexOf("await C.savePhysicalItem(candidate)")).toBeLessThan(editor.indexOf('closeModal($("item-add-modal"))'));
    expect(editor).toContain("const saved = itemsData.find(");
    expect(editor).toContain('form.removeAttribute("aria-busy")');
    expect(editor).toContain("saveButton.disabled = false");
    expect(catalog).toContain("async function savePhysicalItem(item)");
    expect(catalog).toContain('method: "PATCH"');
    expect(catalog).toContain("items: [row]");
    expect(catalog).toContain("recordVersions: { models: {}, items:");
    expect(catalog).toContain("await hydrateCatalog(true)");
  });
  it("does not report or close on an unconfirmed write and blocks duplicate submissions",()=>{
    const editor=inventory.slice(inventory.indexOf("function setupItemModal()"),inventory.indexOf("function populateItemOptions("));
    expect(editor).toContain('if (form.dataset.saving === "true") return');
    expect(editor).toContain('if (!C.isServerAuthoritative?.()');
    expect(editor).toContain("لم يتم تأكيد حفظ القطعة");
    expect(editor).toContain("await C.hydrate(true)");
    expect(editor).toContain("window.DartDialog?.alert?.(saveStatus.textContent)");
  });
});
