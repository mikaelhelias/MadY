// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dGet, dSet, hydrateUserLibrary, importUserLibrary, exportUserLibrary } from "./durableStore";

const UP = "mady.userPresets.v1";
const PROF = "mady.profile.presetName";

let writes: unknown[];
function installBridge(over: Partial<Record<string, unknown>> = {}): void {
  writes = [];
  (window as unknown as { mady: unknown }).mady = {
    userLibWrite: vi.fn((lib: unknown) => { writes.push(lib); return Promise.resolve({ ok: true }); }),
    userLibRead: vi.fn(() => Promise.resolve(null)),
    userLibImport: vi.fn(() => Promise.resolve({ ok: false, canceled: true })),
    userLibExport: vi.fn(() => Promise.resolve({ ok: true, path: "/x.json" })),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  installBridge();
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  delete (window as unknown as { mady?: unknown }).mady;
});

describe("dGet / dSet", () => {
  it("writes through to localStorage synchronously and mirrors to the file (debounced)", () => {
    dSet(UP, "[1,2]");
    expect(dGet(UP)).toBe("[1,2]"); // sync localStorage
    expect(writes.length).toBe(0); // not yet — debounced
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(1);
    expect((writes[0] as { data: Record<string, string> }).data[UP]).toBe("[1,2]");
  });

  it("coalesces a burst of writes into one mirror", () => {
    dSet(UP, "[1]");
    dSet(PROF, "\"Nature\"");
    vi.advanceTimersByTime(400);
    expect(writes.length).toBe(1);
    const data = (writes[0] as { data: Record<string, string> }).data;
    expect(data[UP]).toBe("[1]");
    expect(data[PROF]).toBe("\"Nature\"");
  });
});

describe("hydrateUserLibrary", () => {
  it("restores keys missing from localStorage from the file, then mirrors the union", async () => {
    installBridge({
      userLibRead: vi.fn(() => Promise.resolve({ v: 1, savedAt: 1, data: { [UP]: "[{\"id\":\"a\"}]", [PROF]: "\"Nature\"" } })),
    });
    await hydrateUserLibrary();
    expect(dGet(UP)).toBe("[{\"id\":\"a\"}]"); // restored
    expect(dGet(PROF)).toBe("\"Nature\"");
    expect(writes.length).toBe(1); // union mirrored back
  });

  it("does not clobber a value localStorage already has (live origin wins)", async () => {
    localStorage.setItem(UP, "[{\"id\":\"live\"}]");
    installBridge({
      userLibRead: vi.fn(() => Promise.resolve({ v: 1, savedAt: 1, data: { [UP]: "[{\"id\":\"stale\"}]" } })),
    });
    await hydrateUserLibrary();
    expect(dGet(UP)).toBe("[{\"id\":\"live\"}]"); // localStorage untouched
  });

  it("is a no-op with no bridge (browser preview)", async () => {
    delete (window as unknown as { mady?: unknown }).mady;
    await expect(hydrateUserLibrary()).resolves.toBeUndefined();
  });
});

describe("importUserLibrary", () => {
  it("merges arrays by id (union, incoming wins on clash) — never deletes", async () => {
    localStorage.setItem(UP, JSON.stringify([{ id: "a", name: "A" }, { id: "b", name: "B" }]));
    installBridge({
      userLibImport: vi.fn(() =>
        Promise.resolve({ ok: true, lib: { v: 1, savedAt: 1, data: { [UP]: JSON.stringify([{ id: "b", name: "B2" }, { id: "c", name: "C" }]) } } }),
      ),
    });
    const res = await importUserLibrary();
    expect(res.ok).toBe(true);
    const merged = JSON.parse(dGet(UP)!) as { id: string; name: string }[];
    expect(merged.map((p) => p.id).sort()).toEqual(["a", "b", "c"]); // union
    expect(merged.find((p) => p.id === "b")?.name).toBe("B2"); // incoming won
  });

  /**
   * An array whose items have no `id` keeps them on Import: a union that kept only items with a
   * string id from either side would turn the saved templates (`{name, kind, style}`) into `[]`
   * while the panel said "merged in". Id-less items are kept and appended.
   */
  it("keeps id-less items on both sides instead of wiping them", async () => {
    const TPL = "mady.templates.v1";
    localStorage.setItem(TPL, JSON.stringify([{ name: "Mine", kind: "bar", style: {} }]));
    installBridge({
      userLibImport: vi.fn(() =>
        Promise.resolve({ ok: true, lib: { v: 1, savedAt: 1, data: { [TPL]: JSON.stringify([{ name: "Theirs", kind: "xy", style: {} }]) } } }),
      ),
    });
    await importUserLibrary();
    const merged = JSON.parse(dGet(TPL)!) as { name: string }[];
    expect(merged.map((t) => t.name)).toEqual(["Mine", "Theirs"]);
  });

  it("keeps the existing scalar default (does not hijack it)", async () => {
    localStorage.setItem(PROF, "\"Mine\"");
    installBridge({
      userLibImport: vi.fn(() => Promise.resolve({ ok: true, lib: { v: 1, savedAt: 1, data: { [PROF]: "\"Theirs\"" } } })),
    });
    await importUserLibrary();
    expect(dGet(PROF)).toBe("\"Mine\"");
  });

  it("reports a cancelled import", async () => {
    const res = await importUserLibrary();
    expect(res).toEqual({ ok: false, canceled: true });
  });
});

describe("exportUserLibrary", () => {
  it("hands the current library snapshot to the bridge", async () => {
    localStorage.setItem(UP, "[9]");
    const res = await exportUserLibrary();
    expect(res.ok).toBe(true);
    const g = (window as unknown as { mady: { userLibExport: { mock: { calls: unknown[][] } } } }).mady;
    expect((g.userLibExport.mock.calls[0]![0] as { data: Record<string, string> }).data[UP]).toBe("[9]");
  });
});
