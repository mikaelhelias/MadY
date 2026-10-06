// @vitest-environment jsdom
/**
 * Clicking a text opens a panel that can size it. For each of these texts (the ones
 * `e2e/text-editable.spec.ts` checks in the browser) the click opens a Size control that writes
 * the text's own size field.
 *
 * Three parts, because any one alone can pass while the feature is broken:
 *  1. the click lands on the right panel (the selection PlotFigure emits);
 *  2. that panel shows a visible Size row, and it writes the field the text is drawn with;
 *  3. the builder / renderer really draw the text at that field.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());
// jsdom has no scrollIntoView; the axis panel scrolls its Fonts group into view on a `focus: "labels"` selection.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const SIZE = { width: 640, height: 460 };
const card = (title: string) => {
  const g = galleryItems().find((x) => x.title === title);
  if (!g) throw new Error(`no gallery card "${title}"`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const sceneOf = (c: ReturnType<typeof card>, plot: Plot = c.plot) => buildPlotScene(c.table, plot, { ...SIZE, tables: c.lk });

/** Render the figure the way the app does (select + edit + move handlers wired) and return the selection a click emits. */
function clickText(c: ReturnType<typeof card>, text: string, pick: (els: Element[]) => Element | undefined = (e) => e[0]): GraphSelection | null {
  const onSelect = vi.fn();
  const noop = () => {};
  const { container } = render(
    <PlotFigure scene={sceneOf(c)} selected={null} onSelect={onSelect} onEditText={noop as never} onMoveValueLabel={noop as never}
      onMoveTitle={noop} onMoveColorbar={noop as never} onMoveVennSetLabel={noop as never} onMoveUpsetSetLabel={noop as never} />,
  );
  const texts = [...container.querySelectorAll("svg text")].filter((t) => (t.textContent ?? "").trim() === text);
  const el = pick(texts);
  if (!el) throw new Error(`no drawn text "${text}"`);
  // A draggable label (g.gfx-dragtext) selects on pointer-UP; a value label on the click after an unmoved
  // press; the at-risk table on the group's click. Fire the whole real sequence at the text.
  const target = (el.closest("g.gfx-dragtext") as Element | null) ?? el;
  fireEvent.pointerDown(target, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
  fireEvent.pointerUp(target, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
  fireEvent.click(el, { clientX: 10, clientY: 10 });
  const calls = onSelect.mock.calls.map((a) => a[0]).filter(Boolean);
  return (calls[calls.length - 1] as GraphSelection | undefined) ?? null;
}

/** Render the Inspector for a selection; return every visible row whose label says "size", and a driver for one. */
function sizeRowsFor(c: { table: DataTable; plot: Plot }, selection: GraphSelection) {
  const calls: { handler: string; args: unknown[] }[] = [];
  const spy = (name: string) => (...args: unknown[]) => { calls.push({ handler: name, args }); };
  const h = {
    onSelect: vi.fn(), onSetAxis: spy("onSetAxis"), onSetAxisLength: vi.fn(), onSetAxisTitleFont: spy("onSetAxisTitleFont"),
    onSetSeriesStyle: spy("onSetSeriesStyle"), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: spy("onSetPointStyle"), onClearPointStyles: vi.fn(),
    onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
    onSetPlotOptions: spy("onSetPlotOptions"), onSetGraphTitle: vi.fn(), onSetPlotFont: spy("onSetPlotFont"), onHomogenizeFont: vi.fn(),
    onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(),
    onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
    annotationOps: { add: vi.fn(), update: spy("annotation.update"), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
  };
  const { container } = render(
    <Inspector activeSection="graphs" selection={selection as never} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null}
      wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
  );
  const visible = (el: Element): boolean => {
    for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).hidden || (n as HTMLElement).style?.display === "none") return false;
    return true;
  };
  const rows = [...container.querySelectorAll("label.frow")].filter((l) => /size/i.test(l.querySelector("span")?.textContent ?? "") && visible(l));
  const drive = (row: Element, value = "29"): typeof calls => {
    calls.length = 0;
    const input = row.querySelector("input")!;
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    return [...calls];
  };
  return { rows, drive, calls };
}
const anyRowWrites = (r: ReturnType<typeof sizeRowsFor>, ok: (c: { handler: string; args: unknown[] }) => boolean): boolean =>
  r.rows.some((row) => r.drive(row).some(ok));

describe("1+2. the click lands on a panel whose Size row writes the text's font", () => {
  it("Venn set name → Text ▸ Title & legend ▸ Legend font", () => {
    const c = card("Venn diagram");
    const sel = clickText(c, "Up in drug A");
    expect(sel).toEqual({ kind: "chart-section", title: "Title & legend" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetPlotFont" && x.args[0] === "legend")).toBe(true);
  });

  it("UpSet set name → the X axis's category label font", () => {
    const c = card("UpSet plot");
    const sel = clickText(c, "Drug A");
    expect(sel).toEqual({ kind: "axis", axis: "x", focus: "labels" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetAxis" && x.args[0] === "x" && JSON.stringify(x.args[1]).includes("tickFont"))).toBe(true);
  });

  it.each([
    ["UpSet plot", "6", (e: Element[]) => e[e.length - 1]],
    ["Swimmer plot", "36", (e: Element[]) => e[0]],
    ["Ranked dots vs a reference", "95", (e: Element[]) => e[0]],
  ])("%s value label %s → Text ▸ Title & legend ▸ Value label font", (title, text, pick) => {
    const c = card(title);
    const sel = clickText(c, text, pick);
    expect(sel).toEqual({ kind: "chart-section", title: "Title & legend" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetPlotFont" && x.args[0] === "valueLabel")).toBe(true);
  });

  it("a direct series name ('Treated') → Text ▸ Title & legend ▸ Legend font, like a legend label", () => {
    const c = card("Time course + bands, window, limit");
    const sel = clickText(c, "Treated");
    expect(sel).toEqual({ kind: "chart-section", title: "Title & legend" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetPlotFont" && x.args[0] === "legend")).toBe(true);
  });

  it("radar spoke name → Chart ▸ Radar chart ▸ Edge label font (not the inline editor alone)", () => {
    const c = card("Radar / spider");
    const sel = clickText(c, "Speed");
    expect(sel).toEqual({ kind: "chart-section", title: "Radar chart" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetPlotOptions" && JSON.stringify(x.args[0]).includes("labelFont"))).toBe(true);
  });

  it("ternary edge name → Chart type ▸ Edge name font (its own X-axis title font)", () => {
    const c = card("Ternary plot");
    const sel = clickText(c, "Sand");
    expect(sel).toEqual({ kind: "chart-section", title: "Chart type" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetAxisTitleFont" && x.args[0] === "x")).toBe(true);
  });

  it("survival 'Number at risk' heading and row name → Survival ▸ Number-at-risk font; a count still selects its curve", () => {
    const c = card("Survival (Kaplan-Meier)");
    const heading = clickText(c, "Number at risk");
    expect(heading).toEqual({ kind: "chart-section", title: "Survival (Kaplan-Meier)" });
    const rowName = clickText(c, "Placebo", (e) => e.find((t) => t.hasAttribute("data-atrisk-name")));
    expect(rowName).toEqual({ kind: "chart-section", title: "Survival (Kaplan-Meier)" });
    const count = clickText(c, "48", (e) => e.find((t) => t.closest("g")?.querySelector("[data-atrisk-name]")));
    expect((count as { kind: string } | null)?.kind).toBe("series");
    expect(anyRowWrites(sizeRowsFor(c, heading!), (x) => x.handler === "onSetPlotOptions" && JSON.stringify(x.args[0]).includes("survivalAtRiskFont"))).toBe(true);
  });

  it("EC50 label → its reference-line panel, which carries the label's own font", () => {
    const c = card("XY (points + fitted curve)");
    const sel = clickText(c, "EC50 = 2.8 µM");
    expect(sel).toEqual({ kind: "refline", id: "fit-marker" });
    expect(anyRowWrites(sizeRowsFor(c, sel!), (x) => x.handler === "onSetPlotOptions" && JSON.stringify(x.args[0]).includes("refLineLabelFonts"))).toBe(true);
  });

  it.each([
    ["Time course + bands, window, limit", "vband"],
    ["Time course + bands, window, limit", "hline"],
    ["Waterfall (response)", "hband"],
    ["Stream graph + event markers", "vline"],
  ])("%s %s caption → its annotation panel has a Label size that writes the annotation's size", (title, kind) => {
    const c = card(title);
    const a = (c.plot.annotations ?? []).find((x) => x.kind === kind && x.label);
    expect(a, `the ${title} card has no labelled ${kind}`).toBeDefined();
    const r = sizeRowsFor(c, { kind: "annotation", id: a!.id } as GraphSelection);
    expect(anyRowWrites(r, (x) => x.handler === "annotation.update" && x.args[0] === a!.id && JSON.stringify(x.args[1]) === JSON.stringify({ size: 29 }))).toBe(true);
  });
});

describe("a series name is not printed on a guide line or its caption", () => {
  // Guards against the time-course card drawing "Treated" on the dashed LOD line beside "LOD", where a click on the
  // name lands on the line. The direct-label placer keeps clear of lines and their captions, like point labels do.
  it("time course: 'Treated' clears the LOD line and the 'LOD' caption", () => {
    const c = card("Time course + bands, window, limit");
    // At the card's own figure size (700 × 440). A name placed without regard to the line lands with its baseline
    // just above it (inside the line's clearance), not across its centre — so the check uses the clearance.
    const s = buildPlotScene(c.table, c.plot, { width: c.plot.figureWidth ?? 700, height: c.plot.figureHeight ?? 440, tables: c.lk });
    const lod = s.annotations.find((a) => a.kind === "line" && a.label === "LOD")!;
    expect(lod, "the card has no LOD line — this proves nothing").toBeDefined();
    const named = s.series.find((x) => x.directLabel?.text === "Treated");
    expect(named, "the card draws no 'Treated' direct label").toBeDefined();
    const dl = named!.directLabel!;
    const px = s.fonts.legend.size;
    const w = dl.text.length * px * 0.55;
    const x1 = dl.anchor === "end" ? dl.x - w : dl.anchor === "middle" ? dl.x - w / 2 : dl.x;
    const box = { x1, x2: x1 + w, y1: dl.y - px, y2: dl.y + px * 0.25 };
    // The line is horizontal at y = lod.y1 across the plot; its caption sits at (labelX, labelY) anchored end.
    // The same clearance the placer keeps around a guide line (`segmentObstacles` pad, ≥ 3 px).
    const PAD = 3;
    const crossesLine = box.y1 - PAD < lod.y1! && box.y2 + PAD > lod.y1! && box.x2 > Math.min(lod.x1!, lod.x2!) && box.x1 < Math.max(lod.x1!, lod.x2!);
    expect(crossesLine, `"Treated" (${Math.round(box.x1)},${Math.round(box.y1)})–(${Math.round(box.x2)},${Math.round(box.y2)}) is printed across the LOD line at y=${Math.round(lod.y1!)}`).toBe(false);
  });
});

describe("3. the drawing honours the sizes set", () => {
  it("an annotation's size reaches its band / line caption, on every kind of band and line", () => {
    for (const [title, kind] of [["Time course + bands, window, limit", "vband"], ["Time course + bands, window, limit", "hline"], ["Waterfall (response)", "hband"], ["Stream graph + event markers", "vline"]] as const) {
      const c = card(title);
      const a = (c.plot.annotations ?? []).find((x) => x.kind === kind && x.label)!;
      const plot = { ...c.plot, annotations: (c.plot.annotations ?? []).map((x) => (x.id === a.id ? { ...x, size: 27 } : x)) } as Plot;
      const drawn = sceneOf(c, plot).annotations.find((x) => x.id === a.id);
      expect(drawn?.fontSize, `${title} ${kind}`).toBe(27);
    }
  });

  it("the number-at-risk table takes its own font — heading, rows and the row height", () => {
    const c = card("Survival (Kaplan-Meier)");
    const before = sceneOf(c).atRisk!;
    const after = sceneOf(c, { ...c.plot, survivalAtRiskFont: { size: 22 } } as Plot).atRisk!;
    expect(before.font).toBeUndefined(); // a saved graph's scene is unchanged
    expect(after.font?.size).toBe(22);
    expect(after.rowH).toBe(22 + 7);
  });

  it("the EC50 label takes its own font, and the axis numbers do not move", () => {
    const c = card("XY (points + fitted curve)");
    const before = sceneOf(c);
    const after = sceneOf(c, { ...c.plot, refLineLabelFonts: { "fit-marker": { size: 25 } } } as Plot);
    const marker = after.fit?.marker ?? after.fits?.find((f) => f.marker)?.marker;
    expect(marker?.labelFont?.size).toBe(25);
    expect(after.fonts.xTick).toEqual(before.fonts.xTick);
    expect(after.fonts.yTick).toEqual(before.fonts.yTick);
  });
});
