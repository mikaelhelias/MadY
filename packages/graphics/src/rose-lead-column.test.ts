/**
 * A rose reads its angles from the headings, however the sheet arrived.
 *
 * An imported "Heading, Ground speed" file carries no column roles, so its first column is the
 * sheet's implicit X — row labels to every other chart. Skipping it would bin the speeds
 * (2–24) as angles: one wedge pointing NNE, for birds flying SSW. An untagged first column that
 * holds only numbers is data here — the angle. A column of names, or one the user tagged X, is not.
 */
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

const headings = [200, 205, 210, 195, 215, 208, 202, 199, 211, 206, 190, 220];
const speeds = [10, 12, 9, 14, 11, 8, 13, 10, 12, 9, 15, 7];
const plot = { id: "p", name: "Rose", source: "t", kind: "rose", rose: { sectors: 12 } } as unknown as Plot;
const rose = (t: DataTable) => buildPlotScene(t, plot, { width: 520, height: 520 }).rose!;
/** The sector (0-based, 30° each) holding most observations, and whether speed bands were drawn. */
const fullest = (t: DataTable) => {
  const r = rose(t);
  const top = r.wedges.reduce((a, b) => (b.count > a.count ? b : a));
  return { sector: top.index, banded: r.wedges.some((w) => w.segments.length > 1 || w.segments.some((s) => s.band > 0)) };
};
const SSW = Math.floor(205 / 30); // sector 6: 180–210°

const sheet = (cols: Array<{ id: string; name: string; role?: string }>, rows: Array<Record<string, unknown>>) =>
  ({ id: "t", kind: "xy", name: "Birds", columns: cols, rows: rows.map((cells, i) => ({ id: `r${i}`, cells })) }) as unknown as DataTable;

describe("the rose reads the headings as its angles", () => {
  it("an imported file (no roles): headings first, speeds second", () => {
    const t = sheet([{ id: "h", name: "Heading (°)" }, { id: "s", name: "Ground speed (m/s)" }], headings.map((h, i) => ({ h, s: speeds[i] })));
    const f = fullest(t);
    expect(f.sector, "the speeds were binned as angles").toBe(SSW);
    expect(f.banded, "the speeds are the magnitude bands").toBe(true);
  });

  it("the Wedge colour still reaches the wedges (it is kept on the sheet's first value column)", () => {
    const t = sheet([{ id: "h", name: "Heading (°)" }, { id: "s", name: "Ground speed (m/s)" }], headings.map((h, i) => ({ h, s: speeds[i] })));
    const coloured = { ...plot, seriesStyles: { s: { color: "#ff0000" } } } as unknown as Plot;
    const plain = buildPlotScene(t, plot, { width: 520, height: 520 }).rose!.wedges.flatMap((w) => w.segments.map((g) => g.color));
    const red = buildPlotScene(t, coloured, { width: 520, height: 520 }).rose!.wedges.flatMap((w) => w.segments.map((g) => g.color));
    expect(red, "the Wedge colour control would be dead").not.toEqual(plain);
  });

  it("a first column of names stays labels: the angles come from the next column", () => {
    const t = sheet([{ id: "n", name: "Bird" }, { id: "h", name: "Heading (°)" }, { id: "s", name: "Speed" }], headings.map((h, i) => ({ n: `B${i + 1}`, h, s: speeds[i] })));
    expect(fullest(t).sector).toBe(SSW);
  });

  it("an untagged numeric first column followed by angle and speed is the sheet's X, not the angle", () => {
    // The app's own XY sheet for a rose: "X, Direction, Speed", X an observation number.
    const t = sheet([{ id: "x", name: "X" }, { id: "h", name: "Direction (°)" }, { id: "s", name: "Speed" }], headings.map((h, i) => ({ x: i + 1, h, s: speeds[i] })));
    const r = buildPlotScene(t, plot, { width: 520, height: 520 });
    expect(fullest(t)).toEqual({ sector: SSW, banded: true });
    expect(r.warnings.filter((w) => /not drawn/.test(w))).toEqual([]);
  });

  it("a first column the user tagged X stays X, even when it holds numbers", () => {
    const t = sheet([{ id: "d", name: "Day", role: "x" }, { id: "h", name: "Heading (°)" }, { id: "s", name: "Speed" }], headings.map((h, i) => ({ d: i + 1, h, s: speeds[i] })));
    expect(fullest(t).sector).toBe(SSW);
  });

  it("the gallery's sheet (both columns tagged data): headings are the angles, speeds the bands", () => {
    const t = sheet([{ id: "h", name: "Wind direction (°)", role: "y" }, { id: "s", name: "Speed (m/s)", role: "y" }], headings.map((h, i) => ({ h, s: speeds[i] })));
    expect(fullest(t)).toEqual({ sector: SSW, banded: true });
  });
});
