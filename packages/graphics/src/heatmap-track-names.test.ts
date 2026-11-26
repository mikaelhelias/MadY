// @vitest-environment node
/**
 * Two strip names must not print through each other.
 *
 * A row strip is a vertical band about 16px wide. A name drawn horizontally, centred under that
 * band, is wider than the band once it is longer than ~3 characters, so two named row strips
 * overprint ("Depth" and "Tumour purity" would draw as "Deptbour purity").
 *
 * The names read bottom-to-top under their bands (`nameAngle: -90`), which costs the band's
 * width instead of the name's — and the bottom margin has to reserve the name's length, or the
 * rotated text simply runs off the figure instead of into its neighbour.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, HeatTrack, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const SIZE = { width: 700, height: 460 };
const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "g", name: "Gene" }, { id: "arm", name: "Arm" }, { id: "batch", name: "Batch" },
    { id: "c0", name: "S1" }, { id: "c1", name: "S2" }, { id: "c2", name: "S3" },
  ],
  rows: [0, 1, 2, 3].map((i) => ({
    id: `r${i}`,
    cells: { g: `G${i + 1}`, arm: i < 2 ? "Ctrl" : "Treated", batch: i % 2 ? "B1" : "B2", c0: i + 1, c1: i + 2, c2: i + 3 },
  })),
};
const build = (rowTracks: HeatTrack[], extra: Partial<NonNullable<Plot["heatmap"]>> = {}) =>
  buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { rowTracks, ...extra } }, SIZE);

/** Roughly what a name occupies along the axis it can collide on, from what the scene says. */
const footprint = (t: { name: string; nameX: number; nameY: number; nameAngle?: number | undefined }, fs: number) => {
  const w = t.name.length * fs * 0.5;
  // rotated: the glyph body hangs left of the baseline and runs down from the anchor
  if (t.nameAngle) return { x0: t.nameX - fs, x1: t.nameX, y0: t.nameY, y1: t.nameY + w };
  return { x0: t.nameX - w / 2, x1: t.nameX + w / 2, y0: t.nameY - fs, y1: t.nameY };
};
const overlaps = (a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>): boolean =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("row-strip names", () => {
  it("two named row strips do not overprint", () => {
    const s = build([{ column: "arm", name: "Tumour purity" }, { column: "batch", name: "Depth" }]);
    const tracks = s.heatmap!.tracks!;
    expect(tracks).toHaveLength(2);
    const fs = s.heatmap!.trackFont!.size;
    const [a, b] = tracks.map((t) => footprint(t, fs));
    expect(overlaps(a!, b!), `"${tracks[0]!.name}" and "${tracks[1]!.name}" print over each other`).toBe(false);
  });

  it("the fixture really can collide — the names are wider than their bands", () => {
    // Without this the case above passes for the wrong reason (short names in wide bands).
    const s = build([{ column: "arm", name: "Tumour purity" }, { column: "batch", name: "Depth" }]);
    const fs = s.heatmap!.trackFont!.size;
    const pitch = Math.abs(s.heatmap!.tracks![0]!.nameX - s.heatmap!.tracks![1]!.nameX);
    expect("Tumour purity".length * fs * 0.5).toBeGreaterThan(pitch);
  });

  it("a row name reads bottom-to-top, a column name stays level", () => {
    const s = build([{ column: "arm", name: "Arm" }], { colTracks: [{ name: "Batch", values: { c0: "A", c1: "B", c2: "B" } }] });
    const row = s.heatmap!.tracks!.find((t) => t.axis === "row")!;
    const col = s.heatmap!.tracks!.find((t) => t.axis === "col")!;
    expect(row.nameAngle).toBe(-90);
    expect(col.nameAngle ?? 0, "a column strip's name has a whole row to itself — leave it level").toBe(0);
  });

  it("the bottom margin reserves the name's length, so it cannot run off the figure", () => {
    const short = build([{ column: "arm", name: "A" }]);
    const long = build([{ column: "arm", name: "Tumour purity fraction, deconvolved" }]);
    expect(long.plot.height, "a long name takes no more room than a short one").toBeLessThan(short.plot.height);
    const t = long.heatmap!.tracks![0]!;
    const fs = long.heatmap!.trackFont!.size;
    expect(t.nameY + t.name.length * fs * 0.5, "the name runs off the bottom of the figure").toBeLessThanOrEqual(long.height);
  });

  it("an unnamed strip costs nothing at the bottom", () => {
    const named = build([{ column: "arm", name: "Arm" }]);
    const bare = build([{ column: "arm" }]);
    expect(bare.plot.height).toBeGreaterThan(named.plot.height);
  });
});
