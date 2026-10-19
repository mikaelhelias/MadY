import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "./buildScene";
import { OKABE_ITO } from "./palette";

/**
 * An added column never wears a sibling's colour — lollipop and paired dot.
 *
 * Colours are saved per column when a graph is made (or a preset applied), counted over every column
 * of the sheet. These two builders count only the columns they draw — paired dot skips its section
 * text column, both skip a hidden series — so the palette slot of a column with no saved colour could
 * be a sibling's colour. These tests check that such a column does not repeat a drawn sibling's colour.
 */
const [BLUE, ORANGE, GREEN] = OKABE_ITO as [string, string, string];
const row = (id: string, cells: Record<string, string | number>) => ({ id, cells });
const plotOf = (kind: "lollipop" | "paireddot", seriesStyles: Plot["seriesStyles"]): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, seriesStyles });

describe("an added column's colour on lollipop and paired dot", () => {
  it("paired dot: colours saved counting the section column → the added column does not repeat one", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "trait", name: "Trait", role: "x" }, { id: "dom", name: "Domain", role: "y" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "new", name: "New", role: "y" }],
      rows: [row("r1", { trait: "T1", dom: "D1", a: 1, b: 2, new: 3 }), row("r2", { trait: "T2", dom: "D1", a: 2, b: 3, new: 4 })],
    };
    // As made: Domain took slot 0, so A = ORANGE, B = GREEN; the added column has nothing saved.
    const marks = buildPlotScene(table, plotOf("paireddot", { dom: { color: BLUE }, a: { color: ORANGE }, b: { color: GREEN } }), { width: 600, height: 400 }).paireddot!.rows[0]!.marks;
    const colours = marks.map((m) => m.color);
    expect(colours.slice(0, 2), "fixture: the saved colours must be drawn").toEqual([ORANGE, GREEN]);
    expect(new Set(colours).size, `two paired-dot series share a colour: ${colours.join(", ")}`).toBe(colours.length);
  });

  it("lollipop: a hidden series shifts the count → the added column does not repeat a visible sibling", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "cat", name: "Cat", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }, { id: "new", name: "New", role: "y" }],
      rows: [row("r1", { cat: "C1", a: 1, b: 2, new: 3 })],
    };
    const dots = buildPlotScene(table, plotOf("lollipop", { a: { color: BLUE, hidden: true }, b: { color: ORANGE } }), { width: 600, height: 400 }).lollipop!.rows[0]!.dots;
    const colours = dots.map((d) => d.color);
    expect(colours[0], "fixture: B keeps its saved colour").toBe(ORANGE);
    expect(new Set(colours).size, `two lollipop series share a colour: ${colours.join(", ")}`).toBe(colours.length);
  });
});
