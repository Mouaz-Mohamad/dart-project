import {describe,expect,it} from "vitest";
import {EGYPT_COVERAGE_CATALOG,normalizeCoverageSearch,governorateFromText,
  validateCompanyCoverage,isCompanyAddressCovered,type CompanyCoverage} from "../src/modules/commerce/shipping.coverage.js";

const scoped:CompanyCoverage={
  Giza:{all:false,cities:{
    "sheikh-zayed":{all:false,areas:["district-1"]},
    "sixth-october":{all:true,areas:[]},
  }},
};
describe("canonical Egyptian delivery coverage",()=>{
  it("offers all 27 governorates and unique canonical IDs",()=>{
    expect(EGYPT_COVERAGE_CATALOG.length).toBe(27);
    expect(new Set(EGYPT_COVERAGE_CATALOG.map(g=>g.id)).size).toBe(27);
  });
  it("normalizes Arabic language and searches across languages",()=>{
    expect(governorateFromText("محافظة الجيزة")).toBe("Giza");
    expect(governorateFromText("Cairo Governorate")).toBe("Cairo");
    expect(governorateFromText("Cario")).toBeNull();
    expect(normalizeCoverageSearch("  إِسكندرية ")).toBe(normalizeCoverageSearch("اسكندرية"));
  });
  it("rejects unknown governorates instead of storing a typo",()=>{
    expect(()=>validateCompanyCoverage({governorates:["Cario"]})).toThrow();
    expect(()=>validateCompanyCoverage({governorates:["Giza"],coverage:{Cario:{all:true,cities:{}}}})).toThrow();
  });
  it("requires actual city and area selections for partial coverage",()=>{
    expect(()=>validateCompanyCoverage({governorates:["Giza"],coverage:scoped})).not.toThrow();
    expect(()=>validateCompanyCoverage({governorates:["Giza"],coverage:{
      Giza:{all:false,cities:{}},
    }})).toThrow();
    expect(()=>validateCompanyCoverage({governorates:["Giza"],coverage:{
      Giza:{all:false,cities:{"sheikh-zayed":{all:false,areas:["unknown-area"]}}},
    }})).toThrow();
  });
  it("enforces city and neighborhood restrictions and legacy modes",()=>{
    const company={governorates:["Giza"],coverage:scoped};
    expect(isCompanyAddressCovered(company,"Giza","Sheikh Zayed","First District")).toBe(true);
    expect(isCompanyAddressCovered(company,"Giza","Sheikh Zayed","Second District")).toBe(false);
    expect(isCompanyAddressCovered(company,"Giza","6 October","unknown area")).toBe(true);
    expect(isCompanyAddressCovered(company,"Giza","Haram","Talbiya")).toBe(false);
    expect(isCompanyAddressCovered(company,"Cairo","Sheikh Zayed","First District")).toBe(false);
    expect(isCompanyAddressCovered(company,"Giza","", "First District")).toBe(false);
    expect(isCompanyAddressCovered({governorates:["Giza"]},"Giza")).toBe(true);
    expect(isCompanyAddressCovered({governorates:[]},"Cairo")).toBe(true);
  });
});
