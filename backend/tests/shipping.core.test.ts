import { describe, expect, it } from "vitest";
import {
  DART_CARRIER, EGYPT_GOVERNORATES, dispatchShipment, normalizeTrackingNumber,
  selectShippingCompany, validTrackingPortal, type ShippingCompany,
} from "../src/modules/commerce/shipping.core.js";

const bosta: ShippingCompany = {
  id: "bosta", name: "Bosta", trackingUrl: "https://bosta.co/ar-eg/tracking-shipments",
  active: true, governorates: ["Alexandria"],
};

describe("Dart manual shipping core", () => {
  it("contains all Egyptian governorates without duplicates", () => {
    expect(EGYPT_GOVERNORATES).toHaveLength(27);
    expect(new Set(EGYPT_GOVERNORATES).size).toBe(27);
  });
  it("requires a representative for Dart delivery", () => {
    expect(() => dispatchShipment([DART_CARRIER], {
      companyId: "dart", governorate: "Cairo", now: "2026-11-04T12:00:00Z",
    })).toThrow(/representative/i);
    const shipment = dispatchShipment([DART_CARRIER], {
      companyId: "dart", representativeId: "rep-123", governorate: "Cairo",
      now: "2026-11-04T12:00:00Z",
    });
    expect(shipment.type).toBe("dart");
    expect(shipment.trackingNumber).toBeNull();
  });
  it("takes only a tracking number for external providers", () => {
    const shipment = dispatchShipment([DART_CARRIER,bosta], {
      companyId: "bosta", trackingNumber: " BST-12345 ",
      governorate: "Alexandria", now: "2026-11-04T12:00:00Z",
    });
    expect(shipment.type).toBe("external");
    expect(shipment.trackingNumber).toBe("BST-12345");
    expect(shipment.trackingUrl).toBe(bosta.trackingUrl);
    expect(shipment.status).toBe("Handed Over");
  });
  it("blocks unserviced governorates", () => {
    expect(() => selectShippingCompany([bosta],"bosta","Cairo")).toThrow(/cover/i);
    expect(() => selectShippingCompany([{...bosta,active:false}],"bosta","Alexandria")).toThrow(/inactive/i);
  });
  it("requires explicit staff verification before dispatching partial city/area coverage", () => {
    const scoped = { ...bosta, coverage: { Alexandria: { all: false, cities: { montaza: { all: true, areas: [] } } } } };
    const input = { companyId: "bosta", governorate: "Alexandria", city: "montaza", trackingNumber: "SHIP-123", now: "2026-11-05T12:00:00Z" };
    expect(() => dispatchShipment([scoped], input)).toThrow(/verify.*address/i);
    expect(dispatchShipment([scoped], { ...input, coverageConfirmed: true }).coverageConfirmedAt).toBe(input.now);
    expect(() => dispatchShipment([scoped], { ...input, city: "unknown", coverageConfirmed: true })).toThrow(/cover/i);
  });
  it("does not assign internal representative to an external shipment", () => {
    expect(() => dispatchShipment([bosta],{
      companyId:"bosta",representativeId:"rep-123",trackingNumber:"12345",
      governorate:"Alexandria",now:"2026-11-04T12:00:00Z",
    })).toThrow(/external/i);
  });
  it("rejects invalid tracking codes and dangerous portal schemes", () => {
    expect(() => normalizeTrackingNumber("<script>")).toThrow();
    expect(() => validTrackingPortal("javascript:alert(1)")).toThrow();
    expect(() => validTrackingPortal("http://bosta.co/track")).toThrow();
    expect(() => validTrackingPortal("https://user:pw@bosta.co/track")).toThrow();
  });
});
