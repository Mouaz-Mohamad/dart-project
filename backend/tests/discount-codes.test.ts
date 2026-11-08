import { describe, expect, it } from "vitest";
import { allocateCodeDiscount, codeAllowsLine, distributeSaving, discountCodeInputSchema, type DiscountCode } from "../src/modules/promotions/discount-code.js";

const code: DiscountCode = {
  id:"test",code:"DART100",name:"Launch",kind:"amount",percent:0,amountMinor:10000,
  maxDiscountMinor:0,minOrderMinor:0,productScope:{mode:"all",values:[]},customerUserId:null,
  status:"Active",startsOn:null,endsOn:null,totalUsageLimit:0,perCustomerUsageLimit:1,version:1,
};
describe("discount codes: money and line priority", () => {
  it("deducts a fixed 100 EGP once per order, not once per item", () => {
    const result = allocateCodeDiscount(code,[{id:"a",baseMinor:20000},{id:"b",baseMinor:40000},{id:"c",baseMinor:40000}]);
    expect([...result.values()].reduce((a,b)=>a+b,0)).toBe(10000);
    expect(result.get("a")).toBe(2000);
    expect(result.get("b")).toBe(4000);
    expect(result.get("c")).toBe(4000);
  });
  it("never saves more than the eligible order total", () => {
    const result = allocateCodeDiscount({...code,amountMinor:200000},[{id:"a",baseMinor:4000},{id:"b",baseMinor:2000}]);
    expect(result.get("a")).toBe(4000);
    expect(result.get("b")).toBe(2000);
  });
  it("does not lose piastres when amounts cannot divide evenly", () => {
    const result = distributeSaving(100,[{id:"a",baseMinor:333},{id:"b",baseMinor:333},{id:"c",baseMinor:334}]);
    expect([...result.values()].reduce((a,b)=>a+b,0)).toBe(100);
  });
  it("supports percentage savings and an order-wide ceiling", () => {
    const result = allocateCodeDiscount({...code,kind:"percent",percent:20,maxDiscountMinor:5000},[
      {id:"a",baseMinor:20000},{id:"b",baseMinor:20000}]);
    expect([...result.values()].reduce((a,b)=>a+b,0)).toBe(5000);
  });
  it("excludes sets, pre-discounted pieces and out-of-scope models", () => {
    const scoped={...code,productScope:{mode:"models" as const,values:["DART-M1"]}};
    const line={id:"a",itemCode:"ITEM-1",modelId:"DART-M1",category:"Tops",sellingMinor:50000,modelDiscountPercent:0,isSet:false};
    expect(codeAllowsLine(scoped,line)).toBe(true);
    expect(codeAllowsLine(scoped,{...line,modelDiscountPercent:10})).toBe(false);
    expect(codeAllowsLine(scoped,{...line,isSet:true})).toBe(false);
    expect(codeAllowsLine(scoped,{...line,modelId:"OTHER"})).toBe(false);
  });
  it("rejects an invalid zero-valued code and reversed dates", () => {
    const input={name:"Offer",code:"DART100",status:"Active",kind:"amount",amountMinor:0,
      startsOn:"2026-11-10",endsOn:"2026-11-01",productScope:{mode:"all",values:[]}};
    expect(discountCodeInputSchema.safeParse(input).success).toBe(false);
  });
});
