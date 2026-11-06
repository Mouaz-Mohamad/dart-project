import { describe, it, expect } from "vitest";
import { isDartCardEnabled, extendedDartCardExpiry } from "../src/modules/settings/dart-card-switch.js";
import { siteSettingsSchema, publicSiteSettings } from "../src/modules/settings/site-settings.schema.js";
describe("Dart Card owner toggle",()=>{
  it("is OFF by default, ON only when explicitly enabled",()=>{
    expect(isDartCardEnabled(undefined)).toBe(false);
    expect(isDartCardEnabled({dartCardEnabled:false})).toBe(false);
    expect(isDartCardEnabled({dartCardEnabled:true})).toBe(true);
  });
  it("publishes the flag but keeps the pause clock internal",()=>{
    const settings=siteSettingsSchema.parse({dartCardEnabled:false,dartCardPausedAt:"2026-11-07T00:00:00.000Z"});
    expect(publicSiteSettings(settings).dartCardEnabled).toBe(false);
    expect(publicSiteSettings(settings).dartCardPausedAt).toBeUndefined();
  });
  it("extends dates for disabled days",()=>{
    expect(extendedDartCardExpiry("2026-11-30",3)).toBe("2026-12-03");
    expect(extendedDartCardExpiry("bad",3)).toBe(null);
    expect(extendedDartCardExpiry("2026-11-30",0)).toBe(null);
  });
});
