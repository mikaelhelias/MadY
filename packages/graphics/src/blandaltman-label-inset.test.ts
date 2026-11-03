import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";

/**
 * The words on the bias and limits-of-agreement lines end at the right edge of the plot. A heavy frame
 * (3 px stroke, half of it inside the plot) touched them when they stood only 2 px in; they now stand 6 px in.
 */
const table: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [
    { id: "s", name: "Subject", role: "x" },
    { id: "a", name: "Method A", role: "y" },
    { id: "b", name: "Method B", role: "y" },
  ],
  rows: [
    { id: "r0", cells: { s: 1, a: 10, b: 10.6 } },
    { id: "r1", cells: { s: 2, a: 12, b: 11.4 } },
    { id: "r2", cells: { s: 3, a: 8, b: 8.2 } },
    { id: "r3", cells: { s: 4, a: 14, b: 13.8 } },
  ],
};
const base = { id: "p", name: "BA", source: "t", status: "ok", styleOverrides: {}, kind: "blandaltman" } as unknown as Plot;

describe("Bland-Altman line captions", () => {
  it("stand 6 px inside the right edge of the plot, so a heavy frame does not touch them", () => {
    const s = buildPlotScene(table, base, { width: 560, height: 360 });
    const right = s.plot.x + s.plot.width;
    const captions = s.annotations.filter((a) => a.id.startsWith("ba-") && a.label);
    expect(captions.map((a) => a.id).sort()).toEqual(["ba-bias", "ba-loa-hi", "ba-loa-lo"]);
    for (const a of captions) {
      expect(a.labelAnchor).toBe("end");
      expect(right - a.labelX!, `${a.id} caption distance from the plot edge`).toBeGreaterThanOrEqual(6);
    }
  });
});
