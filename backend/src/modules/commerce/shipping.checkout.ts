// DART | Public checkout shipping eligibility.
// Checkout sees only enabled, active external companies; legacy company records are NOT checkout-enabled.
// Dart's internal courier retains its current Cairo/Giza coverage until separately configured.
import { governorateFromText, isCompanyAddressCovered,
  EGYPT_COVERAGE_CATALOG } from "./shipping.coverage.js";
import type { ShippingCompany } from "./shipping.core.js";

export interface CheckoutShippingAddress {
  governorate: string;
  city?: string | undefined;
  coverageArea?: string | undefined;
  area?: string | undefined;
}
export interface CheckoutShippingCompany extends ShippingCompany {
  checkoutEnabled?: boolean | undefined;
}
const LOCAL_GOVERNORATES = new Set(["Cairo", "Giza"]);
// Coarse country envelope is a defense-in-depth check, not a substitute for geocoded
// administrative boundaries. The client still verifies the specific map pin.
export function isInsideEgyptEnvelope(latitude:unknown, longitude:unknown):boolean {
  const lat=Number(latitude),lng=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&
    lat>=21.5&&lat<=32.1&&lng>=24.5&&lng<=36.2;
}
export function checkoutEligibleCompanies(companies: readonly CheckoutShippingCompany[],
  address:CheckoutShippingAddress, blockedGovernorates: readonly string[] = []): CheckoutShippingCompany[] {
  const governorate=governorateFromText(address.governorate);
  if(!governorate || blockedGovernorates.some(g=>governorateFromText(g)===governorate))return [];
  const result:CheckoutShippingCompany[]=[];
  // Dart delivery is a distinct internal path, not a public configurable provider.
  if(LOCAL_GOVERNORATES.has(governorate)) {
    result.push({id:"dart",name:"Dart Delivery",trackingUrl:"",
      governorates:["Cairo","Giza"],active:true,checkoutEnabled:true});
  }
  for(const company of companies){
    if(company.id==="dart"||company.active!==true||company.checkoutEnabled!==true)continue;
    // Legacy companies (without owner-chosen structured coverage) cannot silently open nationwide checkout.
    if(!company.coverage)continue;
    if(isCompanyAddressCovered(company,governorate,address.city,
      address.coverageArea||address.area)) result.push(company);
  }
  return result;
}
export function checkoutShippingRegions(companies: readonly CheckoutShippingCompany[], blockedGovernorates: readonly string[] = []) {
  return EGYPT_COVERAGE_CATALOG.map(g=>({
    id:g.id,ar:g.ar,en:g.en,
    cities:g.cities.map(c=>({id:c.id,ar:c.ar,en:c.en,
      areas:c.areas.map(a=>({id:a.id,ar:a.ar,en:a.en}))})),
    carriers:checkoutEligibleCompanies(companies,{governorate:g.id},blockedGovernorates).map(c=>c.id),
    // Area-specific scopes need the city/area chosen; province is still selectable if some region is enabled.
    blocked:blockedGovernorates.includes(g.id),
    available:!blockedGovernorates.includes(g.id) && (g.id==="Cairo"||g.id==="Giza"||companies.some(company=>company.active&&company.checkoutEnabled&&company.coverage?.[g.id])),
  }));
}
