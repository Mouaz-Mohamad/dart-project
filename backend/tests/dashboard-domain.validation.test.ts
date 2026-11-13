// DART CODE GUIDE | backend/tests/dashboard-domain.validation.test.ts
// Preserve valid manual benefits while rejecting impossible durable values.
import { describe, expect, it } from "vitest";
import { validateDashboardDomainData } from "../src/modules/dashboard/dashboard-domain.validation.js";

describe("dashboard domain validation", () => {
  const card={id:"CARD-1",clientId:"CL-1",purchasedItems:"2",reservedItems:1,itemLimit:10,discountPercent:40};
  it("preserves compatible manual benefit payloads",()=>{
    expect(validateDashboardDomainData("cards",[{...card,requestedProducts:["I-1"]}])).toEqual([{...card,requestedProducts:["I-1"]}]);
  });
  it("rejects invalid usage, limits, percentages and primitive records",()=>{
    for(const patch of [{purchasedItems:-1},{purchasedItems:0.5},{purchasedItems:10,reservedItems:1},{itemLimit:100},{discountPercent:101}]) {
      expect(()=>validateDashboardDomainData("cards",[{...card,...patch}])).toThrow();
    }
    expect(()=>validateDashboardDomainData("damage",[null])).toThrow();
    expect(()=>validateDashboardDomainData("birthday_rewards",[{discountPercent:999}])).toThrow();
  });
});
