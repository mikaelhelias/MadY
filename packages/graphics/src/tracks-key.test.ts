// The timeline tracks' numeric-strip key (the small colour bar beside a strip): its size and its drag
// offset are the plot's own settings, reserved for in the right margin.
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const table: DataTable = {
  id: "tt", kind: "xy", name: "T",
  columns: [{ id: "t", name: "Week", role: "x" }, { id: "shan", name: "Shannon", role: "y" }, { id: "bac", name: "Bacteroides", role: "y" }],
  rows: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ id: `k${i}`, cells: { t: i, shan: i, bac: 20 + i * 3 } })),
};
const plotOf = (tracks?: NonNullable<Plot["tracks"]>): Plot => ({ id: "p", name: "P", source: "tt", status: "ok", styleOverrides: {}, kind: "tracks", ...(tracks ? { tracks } : {}) });
const build = (tracks?: NonNullable<Plot["tracks"]>) => buildPlotScene(table, plotOf(tracks), { width: 700, height: 420 });
const keys = (tracks?: NonNullable<Plot["tracks"]>) => build(tracks).tracks!.strips.filter((s) => s.colorbar).map((s) => ({ id: s.id, cb: s.colorbar! }));

describe("numeric-strip key", () => {
  it("every numeric strip has a key at the default size, thickness 12", () => {
    const k = keys();
    expect(k.length).toBe(2);
    for (const { cb } of k) expect(cb.w).toBe(12);
  });

  it("scales: a bigger key is thicker and the margin reserved grows with it", () => {
    const one = build();
    const two = build({ keyScale: 2 });
    expect(keys({ keyScale: 2 })[0]!.cb.w).toBe(24);
    expect(two.plot.width).toBeLessThan(one.plot.width);
  });

  it("scales down: a smaller key is thinner and shorter, centred on its strip", () => {
    const one = keys()[0]!.cb;
    const half = keys({ keyScale: 0.5 })[0]!.cb;
    expect(half.w).toBe(6);
    expect(half.h).toBeLessThan(one.h);
    expect(half.y + half.h / 2).toBeCloseTo(one.y + one.h / 2, 5);
  });

  it("keeps the size inside 0.5–2", () => {
    expect(keys({ keyScale: 9 })[0]!.cb.w).toBe(24);
    expect(keys({ keyScale: 0.01 })[0]!.cb.w).toBe(6);
  });

  it("each strip's key carries its own drag offset, keyed by the strip's column", () => {
    const k = keys({ keyOffsets: { bac: { dx: -20, dy: 14 } } });
    expect(k.find((x) => x.id === "bac")!.cb.offset).toEqual({ dx: -20, dy: 14 });
    expect(k.find((x) => x.id === "shan")!.cb.offset).toBeUndefined();
  });
});
