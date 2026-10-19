// @vitest-environment jsdom
/**
 * Find & highlight. `SeriesStyle.highlightNames`: type or paste names; the points whose row carries
 * one (in `highlightColumn`, else the Label column, else the first column of text) are painted the highlight colour,
 * labelled with their name through the ordinary point-label drawing, and drawn on top. Names not found are listed in
 * the warning line.
 *
 * Checked on the drawing (the painted dots, the label text, the dots' drawing order), on the warning, and on the
 * control (typing into the box writes the names the builder reads).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene, HIGHLIGHT_DEFAULT, isNameColumn } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { splitNames } from "./SchemaForm";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };

/** Ten named samples: X, Y and a Gene column of text. */
const table = {
  id: "t-hl", kind: "xy", name: "Genes",
  columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }, { id: "g", name: "Gene", type: "text" }],
  rows: Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, cells: { x: i + 1, y: ((i * 7) % 10) + 1, g: `G${i}` } })),
} as unknown as DataTable;
const plotWith = (st: SeriesStyle | undefined): Plot =>
  ({ id: "p-hl", name: "Genes", source: table.id, status: "ok", styleOverrides: {}, kind: "xy", ...(st ? { seriesStyles: { y: st } } : {}) }) as unknown as Plot;

describe("splitNames", () => {
  it("one per line, or commas / semicolons / tabs; spaces dropped; repeats once (case ignored)", () => {
    expect(splitNames("TP53\nBRCA1\r\n  EGFR  ")).toEqual(["TP53", "BRCA1", "EGFR"]);
    expect(splitNames("a, b; c\td")).toEqual(["a", "b", "c", "d"]);
    expect(splitNames("MYC, myc,\n\n,Myc")).toEqual(["MYC"]);
    expect(splitNames("  \n , ")).toEqual([]);
  });
});

describe("a column of names is not a series (XY family)", () => {
  it("the name column draws no series and takes no legend row", () => {
    const scene = buildPlotScene(table, plotWith({ color: "#0072B2" }), SIZE);
    expect(scene.series.map((s) => s.id)).toEqual(["y"]);
    expect(scene.legend.map((e) => e.label)).not.toContain("Gene");
  });

  it("isNameColumn: names only → yes; one number among them, or a blank column → no", () => {
    const t = (cells: unknown[]) => ({ columns: [{ id: "c", name: "C" }], rows: cells.map((c, i) => ({ id: `r${i}`, cells: { c } })) }) as unknown as DataTable;
    const d = { id: "c", replicates: [] as string[] };
    expect(isNameColumn(t(["TP53", "EGFR", ""]), d)).toBe(true);
    expect(isNameColumn(t(["TP53", 4, "EGFR"]), d)).toBe(false);
    expect(isNameColumn(t(["TP53", "4.5"]), d)).toBe(false);
    expect(isNameColumn(t(["", null, undefined]), d)).toBe(false);
  });
});

describe("find & highlight — the drawing", () => {
  it("the named points are painted, labelled with their name, and drawn last (on top)", () => {
    const scene = buildPlotScene(table, plotWith({ highlightNames: ["G3", " g7 "] }), SIZE);
    const s = scene.series[0]!;
    const hit = s.marks.filter((m) => m.fill === HIGHLIGHT_DEFAULT);
    expect(hit.map((m) => m.rowId).sort()).toEqual(["r3", "r7"]);
    expect(hit.map((m) => m.pointLabel).sort()).toEqual(["G3", "G7"]);
    expect(s.marks.slice(-2).map((m) => m.rowId).sort(), "the found points must be drawn last").toEqual(["r3", "r7"]);
    expect(s.marks.filter((m) => m.pointLabel).length, "only the found points are labelled").toBe(2);
    // On the drawing: the two names are written, in the highlight colour.
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("svg.gfx-figure text")].filter((t) => ["G3", "G7"].includes(t.textContent ?? ""));
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t.getAttribute("fill")).toBe(HIGHLIGHT_DEFAULT);
  });

  it("names not found are listed in the warning line", () => {
    const scene = buildPlotScene(table, plotWith({ highlightNames: ["G1", "NOPE", "zzz"] }), SIZE);
    expect(scene.warnings).toContain("Highlight: 2 names not found in “Gene”: NOPE, zzz.");
  });

  it("the colour and the labels are the user's to change", () => {
    const scene = buildPlotScene(table, plotWith({ highlightNames: ["G2"], highlightColor: "#123456", highlightLabels: false }), SIZE);
    const m = scene.series[0]!.marks.find((x) => x.rowId === "r2")!;
    expect(m.fill).toBe("#123456");
    expect(m.pointLabel).toBeUndefined();
  });

  it("no names = exactly the drawing without the feature", () => {
    const a = buildPlotScene(table, plotWith(undefined), SIZE);
    const b = buildPlotScene(table, plotWith({ highlightNames: [] }), SIZE);
    expect(JSON.stringify(b.series)).toBe(JSON.stringify(a.series));
  });

  it("a table with no column of text says so", () => {
    const numeric = { ...table, columns: table.columns.slice(0, 2) } as DataTable;
    const scene = buildPlotScene(numeric, plotWith({ highlightNames: ["G1"] }), SIZE);
    expect(scene.warnings.some((w) => w.includes("no column of names to search"))).toBe(true);
  });

  it("volcano: genes found by name are painted over their zone colour and labelled", () => {
    const g = galleryItems().find((x) => x.key === "volcano")!;
    const names = g.table.rows.map((r) => String(r.cells["gene"] ?? "")).filter((n) => n !== "").slice(0, 3);
    expect(names.length, "the volcano card has no named genes — the fixture proves nothing").toBe(3);
    const sid = buildPlotScene(g.table, g.plot, SIZE).series.find((s) => s.marks.length > 0)!.id;
    const plot = { ...g.plot, seriesStyles: { ...(g.plot.seriesStyles ?? {}), [sid]: { ...(g.plot.seriesStyles?.[sid] ?? {}), highlightNames: names } } } as Plot;
    const s = buildPlotScene(g.table, plot, SIZE).series.find((x) => x.id === sid)!;
    const hit = s.marks.filter((m) => m.fill === HIGHLIGHT_DEFAULT);
    expect(hit.map((m) => m.pointLabel).sort()).toEqual([...names].sort());
  });
});

const handlers = (onSetSeriesStyle: (id: string, p: object) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle, onSetSeriesStyleAll: (_ids: string[], p: object) => onSetSeriesStyle("*", p), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});
const panel = (plot: Plot, onSet: (id: string, p: object) => void = () => {}) =>
  render(
    <Inspector activeSection="graphs" selection={{ kind: "series", columnId: "y" } as never} plot={plot} table={table as never}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...handlers(onSet)} />,
  ).container;
const rowNamed = (c: HTMLElement, text: string) => [...c.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === text);

describe("find & highlight — the control", () => {
  it("a Find names box beside Point labels; leaving it writes the names the builder reads", () => {
    const writes: object[] = [];
    const c = panel(plotWith(undefined), (_id, p) => writes.push(p));
    const box = c.querySelector<HTMLTextAreaElement>('textarea[aria-label="Find names"]');
    expect(box, "no Find names box").not.toBeNull();
    expect(rowNamed(c, "In column"), "the column choice waits until there are names").toBeUndefined();
    fireEvent.change(box!, { target: { value: "G3, G7\nNOPE" } });
    expect(writes, "nothing is written while typing").toEqual([]);
    fireEvent.blur(box!);
    expect(writes).toContainEqual({ highlightNames: ["G3", "G7", "NOPE"] });
  });

  it("with names set, the column (defaulting to the column of text), colour and label switch appear", () => {
    const c = panel(plotWith({ highlightNames: ["G3"] }));
    const col = rowNamed(c, "In column")?.querySelector("select");
    expect(col, "no In column choice").toBeTruthy();
    expect(col!.value).toBe("g");
    expect(rowNamed(c, "Colour")).toBeTruthy();
    expect(rowNamed(c, "Label them")).toBeTruthy();
  });
});
