import { readFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");
const s=read("../src/modules/waiting/waiting.service.ts");
const r=read("../src/modules/waiting/waiting.routes.ts");
const m=read("../migrations/0083_manual_waiting_requests.sql");
const ui=read("../../Eye/dart-waiting-manual.js");
describe("manual waiting contract",()=>{
 it("uses protected API and required WhatsApp request",()=>{
   expect(r).toContain('requirePermission("waiting.create")');
   expect(r).toContain("consentConfirmed:z.literal(true)");
   expect(s).toContain("WHATSAPP_REQUEST_REQUIRED");
 });
 it("enforces out-of-stock exact variants without priority override or WhatsApp at sign-up",()=>{
   expect(s).toContain("STOCK_AVAILABLE");
   expect(s).toContain("false,'manual'");
   expect(s).toContain("dart_waitlist_try_allocate_entry");
   expect(s).toContain("WAITLIST_MANUAL_CREATED");
   expect(m).toContain("source IN ('website','manual')");
 });
 it("supports registered or new customers and a single item",()=>{
   expect(ui).toContain('id="manual-wait-new"');
   expect(ui).toContain('id="manual-wait-existing"');
   expect(ui).toContain("manual-wait-consent");
   expect(s).toContain("normalizeEgyptianPhone(rawPhone)");
 });
});
