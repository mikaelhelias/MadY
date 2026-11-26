// @vitest-environment jsdom
/**
 * Axis panels offer the rows their axis draws.
 *
 * An UpSet plot's X axis is the intersection columns over the membership matrix: the matrix is its labelling, so the
 * builder draws no title, no tick marks and no category labels there. The panel offers only what reaches the drawing
 * (axis line colour and thickness, length, spacing, fonts) and withholds Title, the tick-mark rows, Label rotation and
 * Hide axis, which a bar chart's category axis keeps.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const handlers = () => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: {} as never,
});
const rows = (kind: string, axis: "x" | "y" | "y2" = "x"): string[] => {
  const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "axis", axis }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};
const WITHHELD = ["Title", "Link ticks to axis", "Tick thickness", "Show ticks", "Tick length", "Label rotation", "Hide axis"];

/**
 * A Manhattan plot's X axis is a genome ruler: its labels are the chromosome names at each chromosome's midpoint, never
 * numbers, so number formatting, tick interval and minor ticks change nothing there. Its range (a window on the
 * genome) and label rotation do, and stay.
 */
describe("Manhattan X axis panel", () => {
  it("withholds the number rows and keeps the range and label rotation", () => {
    const r = rows("manhattan");
    for (const w of ["Tick interval", "Minor ticks", "Format", "Decimals", "Prefix", "Suffix", "Thousands"]) expect(r, w).not.toContain(w);
    expect(r).toContain("Label rotation");
    expect(r.some((x) => /^Min/.test(x))).toBe(true);
  });
  it("an XY X axis keeps them", () => {
    const r = rows("xy");
    for (const w of ["Tick interval", "Minor ticks", "Format", "Decimals"]) expect(r, w).toContain(w);
  });
});

/**
 * An estimation plot's difference axis (Y2) shares the left axis's pixel scale: its range is the left range minus the
 * control mean and its direction is the left axis's. Reversed and Min / Max there cannot move it; they belong to Y.
 */
describe("estimation difference axis panel", () => {
  it("withholds Reversed and Min / Max", () => {
    const r = rows("estimation", "y2");
    expect(r).not.toContain("Reversed");
    expect(r).not.toContain("Min / Max");
    // …and Scale ▸ Type: the axis is the left one shifted, drawn linear like it, as a bar chart's Y2 is.
    expect(r).not.toContain("Type");
    expect(r).toContain("Title");
  });
  it("the estimation Y axis keeps them", () => {
    const r = rows("estimation", "y");
    expect(r).toContain("Reversed");
    expect(r).toContain("Min / Max");
  });
});

/**
 * "Nothing is on the right axis yet — tick a series below" is true only where the panel lists series to tick. An
 * estimation plot draws its difference on Y2 itself and lists no series there, so the note would deny what is drawn.
 */
describe("empty second-axis note", () => {
  const note = (kind: string): boolean => {
    const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
    const u = render(<Inspector activeSection="graphs" selection={{ kind: "axis", axis: "y2" }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...handlers()} />);
    const shown = (u.container.textContent ?? "").includes("axis yet");
    cleanup();
    return shown;
  };
  it("is not shown on the estimation difference axis", () => {
    expect(note("estimation")).toBe(false);
  });
  it("is shown on an XY graph with nothing on Y2", () => {
    expect(note("xy")).toBe(true);
  });
});

/**
 * A funnel plot draws its standard-error axis reversed by default (SE 0, the apex, at the top). The Reversed box shows
 * what is drawn, and unticking it writes an explicit "not reversed" - clearing the setting would bring back the
 * default, so the axis could never be turned the other way.
 */
describe("funnel standard-error axis: Reversed", () => {
  it("shows ticked on the default drawing and unticking turns the axis round", () => {
    const item = (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === "funnel")!;
    const h = handlers();
    const u = render(<Inspector activeSection="graphs" selection={{ kind: "axis", axis: "y" }} plot={item.plot} table={item.table} userPresets={[]} profileDefault={null} {...h} />);
    const box = [...u.container.querySelectorAll("label.frow")].find((l) => l.querySelector(":scope > span")?.textContent?.trim() === "Reversed")!.querySelector("input")!;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(h.onSetAxis).toHaveBeenLastCalledWith("y", { reversed: false });
  });
});

describe("UpSet X axis panel", () => {
  it("withholds the rows the matrix-labelled axis does not draw", () => {
    const r = rows("upset");
    for (const w of WITHHELD) expect(r, w).not.toContain(w);
    expect(r).toContain("Thickness");
  });
  it("a bar chart's category axis keeps them", () => {
    const r = rows("bar");
    for (const w of WITHHELD) expect(r, w).toContain(w);
  });
});
