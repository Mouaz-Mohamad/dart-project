import { describe, expect, it } from "vitest";
import {
  resolveExchangeChain,
  resolveReturnCourierPolicy,
} from "../src/modules/commerce/customer-interaction.service.js";

describe("return courier policy snapshots", () => {
  it("reads the current refund fee from site settings", () => {
    expect(resolveReturnCourierPolicy({ refundCustomerFee: 125 }, "Refund", 0))
      .toEqual({ customerFee: 125, brandFee: 0, payer: "Customer" });
  });

  it("keeps the first completed exchange as a fixed Dart-paid 50 EGP benefit", () => {
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 75 }, "Exchange", 0))
      .toEqual({ customerFee: 0, brandFee: 50, payer: "Brand" });
  });

  it("uses the configured customer fee for later exchanges", () => {
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 75 }, "Exchange", 1))
      .toEqual({ customerFee: 75, brandFee: 0, payer: "Customer" });
  });

  it("treats an explicitly configured zero as valid rather than falling back", () => {
    expect(resolveReturnCourierPolicy({ refundCustomerFee: 0 }, "Refund", 0).customerFee).toBe(0);
    expect(resolveReturnCourierPolicy({ repeatExchangeCustomerFee: 0 }, "Exchange", 2).customerFee).toBe(0);
  });

  it("keeps one exchange chain when the physical Item Code changes", () => {
    const first = {
      id: "RET-1",
      requestType: "Exchange",
      status: "Completed",
      itemCode: "ITEM-OLD",
      replacementItemCode: "ITEM-NEW",
      exchangeChainId: "ITEM-OLD",
    };
    expect(resolveExchangeChain([first], "ITEM-NEW")).toEqual({
      exchangeChainId: "ITEM-OLD",
      completedExchangesBeforeRequest: 1,
    });

    const second = {
      id: "RET-2",
      requestType: "Exchange",
      status: "Good",
      itemCode: "ITEM-NEW",
      replacementItemCode: "ITEM-NEW-2",
      exchangeChainId: "ITEM-OLD",
    };
    expect(resolveExchangeChain([first, second], "ITEM-NEW-2")).toEqual({
      exchangeChainId: "ITEM-OLD",
      completedExchangesBeforeRequest: 2,
    });
  });

  it("does not consume the free exchange for pending or rejected requests", () => {
    const rows = [
      {
        requestType: "Exchange",
        status: "Rejected",
        itemCode: "ITEM-OLD",
        replacementItemCode: "ITEM-NEW",
        exchangeChainId: "ITEM-OLD",
      },
      {
        requestType: "Exchange",
        status: "Pending Request",
        itemCode: "ITEM-OLD",
        replacementItemCode: "ITEM-NEW",
        exchangeChainId: "ITEM-OLD",
      },
    ];
    expect(resolveExchangeChain(rows, "ITEM-NEW")).toEqual({
      exchangeChainId: "ITEM-NEW",
      completedExchangesBeforeRequest: 0,
    });
  });
});
