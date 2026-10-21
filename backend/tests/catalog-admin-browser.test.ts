import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

interface State { version: number; models: Record<string, unknown>[]; items: Record<string, unknown>[] }
interface Adapter {
  capture(state: State): void;
  reset(): void;
  merge(rows: Record<string, unknown>[], changes: Record<string, unknown>[], key: string): Record<string, unknown>[];
  flush(persist: () => Promise<void>, dirty: () => boolean): Promise<void>;
  save(api: (path: string, options: Record<string, unknown>) => Promise<State>, state: State, current: () => boolean): Promise<State & { partial: boolean }>;
}
function adapter(permissions?: string[]): Adapter {
  const window: { DartCatalogAdmin?: Adapter; DartAdminAccess?: { can(key: string): boolean } } = permissions
    ? { DartAdminAccess: { can: key => permissions.includes(key) } } : {};
  runInNewContext(readFileSync(new URL("../../scripts/catalog-admin.source.js", import.meta.url), "utf8"), { window });
  return window.DartCatalogAdmin!;
}
const baseline = (): State => ({ version: 1, models: [{ modelId: "M-1", version: 1 }],
  items: [{ id: "I-1", modelId: "M-1", version: 1, regDate: "old" }, { id: "I-2", modelId: "M-1", version: 1 }] });

describe("in-memory changed-record catalogue editor", () => {
  it("sends large inventory-only edits as versioned record patches without models", async () => {
    const editor = adapter(["inventory.manage"]), state = baseline(); editor.capture(state);
    const items = Array.from({ length: 1001 }, (_, index) => ({ id: `new-${index}`, modelId: "M-1" }));
    const api = vi.fn().mockResolvedValue({ version: 2, models: [], items });
    const result = await editor.save(api, { ...state, items: [...state.items, ...items] }, () => true);
    expect(api.mock.calls[0]![1]).toMatchObject({ method: "PUT", body: { models: [], items, recordVersions: { models: {} } } });
    expect(result.partial).toBe(true);
  });
  it("refuses model edits for inventory-only access before sending a write", async () => {
    const editor = adapter(["inventory.manage"]), state = baseline(); editor.capture(state);
    const api = vi.fn();
    await expect(editor.save(api, { ...state, models: [{ ...state.models[0], selling: 1 }] }, () => true)).rejects.toMatchObject({ status: 403 });
    expect(api).not.toHaveBeenCalled();
  });
  it("ignores selection-only changes and sends one physical item with its stored version", async () => {
    const editor = adapter(), state = baseline(); editor.capture(state);
    const api = vi.fn().mockResolvedValue({ version: 2, models: [], items: [{ ...state.items[0], version: 2 }] });
    await editor.save(api, { ...state, items: state.items.map((row) => ({ ...row, isChecked: true })) }, () => true);
    expect(api).not.toHaveBeenCalled();
    await editor.save(api, { ...state, items: [{ ...state.items[0], regDate: "new" }, state.items[1]!] }, () => true);
    expect(api).toHaveBeenCalledWith("/api/v1/admin/catalog-state", { method: "PATCH", body: {
      expectedVersion: 1, models: [], items: [{ ...state.items[0], regDate: "new" }], recordVersions: { models: {}, items: { "I-1": 1 } } } });
  });
  it("preserves unrelated rows and local selections when merging a partial response", () => {
    const editor = adapter();
    const rows = editor.merge([{ id: "I-1", isChecked: true }, { id: "I-2", regDate: "untouched" }], [{ id: "I-1", version: 2 }], "id");
    expect(rows).toEqual([{ id: "I-1", version: 2, isChecked: true }, { id: "I-2", regDate: "untouched" }]);
  });
  it("does not replace the entire catalogue after a conflict, network error or server failure", async () => {
    for (const status of [409, 500, undefined]) {
      const editor = adapter(), state = baseline(); editor.capture(state);
      const error = Object.assign(new Error("failure"), { status });
      const api = vi.fn().mockRejectedValue(error);
      await expect(editor.save(api, { ...state, items: [{ ...state.items[0], regDate: "new" }] }, () => true)).rejects.toBe(error);
      expect(api).toHaveBeenCalledOnce();
    }
  });
  it("falls back to the existing full endpoint only when PATCH is unsupported", async () => {
    for (const status of [404, 405]) {
      const editor = adapter(), state = baseline(); editor.capture(state);
      const api = vi.fn().mockRejectedValueOnce(Object.assign(new Error("unsupported"), { status })).mockResolvedValue(state);
      expect((await editor.save(api, { ...state, items: [{ ...state.items[0], regDate: "new" }] }, () => true)).partial).toBe(false);
      expect(api.mock.calls[1]?.[1].method).toBe("PUT");
    }
  });
  it("coalesces concurrent flushes and continues when an edit arrives during a save", async () => {
    const editor = adapter(); let resolve!: () => void, dirty = true;
    const first = new Promise<void>((done) => { resolve = done; });
    const persist = vi.fn().mockImplementationOnce(() => first).mockImplementation(async () => { dirty = false; });
    const flight = editor.flush(persist, () => dirty);
    expect(editor.flush(persist, () => dirty)).toBe(flight);
    resolve(); await flight; expect(persist).toHaveBeenCalledTimes(2);
  });
  it("does not repeatedly resend an already deleted inactive tombstone", async () => {
    const editor = adapter(), state = baseline();
    state.items[1] = { ...state.items[1], isDeleted: true, active: false };
    editor.capture(state); const api = vi.fn();
    await editor.save(api, { ...state, items: [state.items[0]!] }, () => true);
    expect(api).not.toHaveBeenCalled();
  });
});
