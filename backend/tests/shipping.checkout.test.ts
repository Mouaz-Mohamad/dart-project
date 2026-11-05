import { describe, expect, it } from "vitest";
import { checkoutEligibleCompanies, checkoutShippingRegions, isInsideEgyptEnvelope, type CheckoutShippingCompany }
  from "../src/modules/commerce/shipping.checkout.js";
import { validateCompanyCoverage, isCompanyAddressCovered,
  EGYPT_COVERAGE_CATALOG, governorateFromText } from "../src/modules/commerce/shipping.coverage.js";
const carrier:CheckoutShippingCompany={
  id:"carrier-x",name:"Company X",trackingUrl:"https://example.com/track",
  active:true,checkoutEnabled:true,governorates:["Alexandria"],
  coverage:{Alexandria:{all:true,cities:{}}},
};
describe("Shipping checkout coverage (fail closed)",()=>{
  it("keeps existing Dart checkout within Cairo and Giza without new provider settings",()=>{
    expect(checkoutEligibleCompanies([],{governorate:"Cairo"}).map(c=>c.id)).toEqual(["dart"]);
    expect(checkoutEligibleCompanies([],{governorate:"Giza"}).map(c=>c.id)).toEqual(["dart"]);
    expect(checkoutEligibleCompanies([],{governorate:"Alexandria"})).toEqual([]);
  });
  it("needs explicit checkout enabled AND active AND structured coverage",()=>{
    expect(checkoutEligibleCompanies([{...carrier,checkoutEnabled:false}],{governorate:"Alexandria"})).toEqual([]);
    expect(checkoutEligibleCompanies([{...carrier,active:false}],{governorate:"Alexandria"})).toEqual([]);
    expect(checkoutEligibleCompanies([{...carrier,coverage:undefined}],{governorate:"Alexandria"})).toEqual([]);
    expect(checkoutEligibleCompanies([carrier],{governorate:"Alexandria"}).map(c=>c.id)).toEqual(["carrier-x"]);
  });
  it("disallows an unavailable city or area even in a covered governorate",()=>{
    const narrow:CheckoutShippingCompany={...carrier,
      coverage:{Alexandria:{all:false,cities:{montaza:{all:false,areas:["sidi-bishr"]}}}}};
    expect(checkoutEligibleCompanies([narrow],{governorate:"Alexandria"})).toEqual([]);
    expect(checkoutEligibleCompanies([narrow],{governorate:"Alexandria",city:"montaza"})).toEqual([]);
    expect(checkoutEligibleCompanies([narrow],{governorate:"Alexandria",city:"montaza",coverageArea:"sidi-bishr"})).toHaveLength(1);
    expect(checkoutEligibleCompanies([narrow],{governorate:"Alexandria",city:"montaza",coverageArea:"miami"})).toEqual([]);
  });
  it("gives a canonical Egyptian catalog with valid nested IDs",()=>{
    expect(EGYPT_COVERAGE_CATALOG).toHaveLength(27);
    expect(new Set(EGYPT_COVERAGE_CATALOG.map(g=>g.id)).size).toBe(27);
    expect(governorateFromText("محافظة الإسكندرية")).toBe("Alexandria");
    expect(checkoutShippingRegions([]).map(x=>x.id)).toEqual(["Cairo","Giza"]);
    expect(checkoutShippingRegions([carrier]).map(x=>x.id)).toContain("Alexandria");
    expect(()=>validateCompanyCoverage(carrier)).not.toThrow();
    expect(()=>validateCompanyCoverage({...carrier,governorates:["Alexandrria"]})).toThrow();
  });
  it("rejects delivery coordinates outside Egypt's safety envelope",()=>{
    expect(isInsideEgyptEnvelope(30.04,31.24)).toBe(true);
    expect(isInsideEgyptEnvelope("31.20","29.92")).toBe(true);
    expect(isInsideEgyptEnvelope(51.5,0.12)).toBe(false);
    expect(isInsideEgyptEnvelope("not-coordinates",31)).toBe(false);
  });
  it("preserves old saved shipping companies but rejects their unexpected checkout activation",()=>{
    const legacy:CheckoutShippingCompany={...carrier,coverage:undefined,governorates:[]};
    expect(isCompanyAddressCovered(legacy,"Suez")).toBe(true); // Old dispatch behavior only.
    expect(checkoutEligibleCompanies([legacy],{governorate:"Suez"})).toEqual([]);
  });
});
