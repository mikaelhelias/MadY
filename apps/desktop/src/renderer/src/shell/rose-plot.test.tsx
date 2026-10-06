// @vitest-environment jsdom
// Polar histogram / wind rose (a chart type of its own). One angle
// column binned into equal sectors (core histogram() over [0,360)), each sector's count a
// wedge from the centre; an optional magnitude column stacks the wedges into bands — the
// wind rose. Wedges are bins (chart-section clicks), never series marks.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { bracketGeometry, TABLE_FORMATS } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

/** 12 observations: 8 in the east quadrant (45–135°), 4 north-ish, one NaN row. */
const windTable: DataTable = {
  id: "tw", kind: "column", name: "Wind",
  columns: [
    { id: "o", name: "Observation", role: "x" },
    { id: "dir", name: "Direction (°)", role: "y" },
    { id: "spd", name: "Speed", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { o: "1", dir: 50, spd: 2 } },
    { id: "r2", cells: { o: "2", dir: 60, spd: 5 } },
    { id: "r3", cells: { o: "3", dir: 70, spd: 8 } },
    { id: "r4", cells: { o: "4", dir: 80, spd: 11 } },
    { id: "r5", cells: { o: "5", dir: 95, spd: 3 } },
    { id: "r6", cells: { o: "6", dir: 100, spd: 6 } },
    { id: "r7", cells: { o: "7", dir: 110, spd: 9 } },
    { id: "r8", cells: { o: "8", dir: 120, spd: 12 } },
    { id: "r9", cells: { o: "9", dir: 0, spd: 4 } },
    { id: "r10", cells: { o: "10", dir: 355, spd: 7 } },
    { id: "r11", cells: { o: "11", dir: -5, spd: 7 } }, // wraps to 355
    { id: "r12", cells: { o: "12", dir: "", spd: 9 } }, // no angle → dropped, counted
  ],
};

const rosePlot = (over: Partial<NonNullable<Plot["rose"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Rose", source: "tw", status: "ok", styleOverrides: {}, kind: "rose",
  rose: { ...over }, ...plotOver,
});

describe("rose — builder geometry", () => {
  it("bins the angles into sectors; counts match a hand count; wrap-around works", () => {
    // 8 sectors of 45°: sector 1 (45–90°) holds r1–r4; sector 2 (90–135°) holds r5–r8;
    // sector 0 (0–45°) holds r9; sector 7 (315–360°) holds r10 and the wrapped −5°.
    const scene = buildPlotScene(windTable, rosePlot({ sectors: 8 }));
    expect(scene.kind).toBe("rose");
    const counts = scene.rose!.wedges.map((w) => w.count);
    expect(counts[1]).toBe(4);
    expect(counts[2]).toBe(4);
    expect(counts[0]).toBe(1);
    expect(counts[7]).toBe(2);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(11); // the blank-angle row is out
    expect(scene.warnings.some((w) => /1 row has no usable angle/i.test(w))).toBe(true);
  });

  it("compass mode puts 0° (north) at the top, clockwise; math mode puts 0° right, ccw", () => {
    const compass = buildPlotScene(windTable, rosePlot({ sectors: 8 }));
    // Sector 0 (0–45°) in compass mode: its mid-angle 22.5° sits just east of north →
    // the wedge's centroid is above the centre and slightly right.
    const w0 = compass.rose!.wedges[0]!;
    expect(w0.midX).toBeGreaterThan(compass.rose!.cx);
    expect(w0.midY).toBeLessThan(compass.rose!.cy);
    const math = buildPlotScene(windTable, rosePlot({ sectors: 8, compass: false }));
    // Math mode: 22.5° sits just above east → right of centre and slightly up.
    const m0 = math.rose!.wedges[0]!;
    expect(m0.midX).toBeGreaterThan(math.rose!.cx);
    expect(m0.midY).toBeLessThan(math.rose!.cy);
    // …and the two conventions genuinely differ: compass labels start at N.
    expect(compass.rose!.directionLabels[0]!.text).toBe("N");
    expect(math.rose!.directionLabels[0]!.text).toBe("0°");
  });

  it("a magnitude column stacks each wedge into bands with a legend; radius grows with count", () => {
    const scene = buildPlotScene(windTable, rosePlot({ sectors: 8, bands: 3 }));
    const w1 = scene.rose!.wedges[1]!; // 4 observations, speeds 2/5/8/11 → all 3 bands hit
    expect(w1.segments.length).toBeGreaterThanOrEqual(2);
    expect(w1.segments.reduce((a, s) => a + s.count, 0)).toBe(4);
    expect(scene.legend.length, "magnitude bands earn a legend").toBeGreaterThanOrEqual(2);
    // Radius ∝ count: the 4-count wedge reaches further than the 1-count wedge.
    expect(w1.outerR).toBeGreaterThan(scene.rose!.wedges[0]!.outerR);
    // Without a magnitude the rose is single-band and legend-less.
    const plain: DataTable = { ...windTable, columns: windTable.columns.slice(0, 2) };
    const single = buildPlotScene(plain, rosePlot({ sectors: 8 }));
    expect(single.rose!.wedges[1]!.segments.length).toBe(1);
    expect(single.legend.length).toBe(0);
  });

  it("the ring ladder carries the count scale", () => {
    const scene = buildPlotScene(windTable, rosePlot({ sectors: 8 }));
    expect(scene.rose!.rings.length).toBeGreaterThanOrEqual(2);
    const top = scene.rose!.rings[scene.rose!.rings.length - 1]!;
    expect(top.count).toBeGreaterThanOrEqual(4); // must cover the fullest wedge
  });

  it("value-anchored lines are refused with a warning (no cartesian axes)", () => {
    const plot = rosePlot({ sectors: 8 });
    plot.annotations = [{ id: "h1", kind: "hline", value: 2 }];
    const scene = buildPlotScene(windTable, plot);
    expect(scene.annotations.some((a) => a.id === "h1")).toBe(false);
    expect(scene.warnings.length).toBeGreaterThan(0);
  });
});

describe("rose — the figure paints and wedges click to the section", () => {
  it("wedge paths render; clicking one selects the chart-section", () => {
    const scene = buildPlotScene(windTable, rosePlot({ sectors: 8 }), { width: 640, height: 560 });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
    const wedges = container.querySelectorAll(".gfx-rose path.rosewedge");
    expect(wedges.length, "the wedges must paint").toBeGreaterThan(3);
    fireEvent.click(wedges[0]!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "chart-section" }));
    expect(container.querySelectorAll(".gfx-rose circle.rosering").length).toBeGreaterThanOrEqual(2);
  });
});

describe("rose — brackets refused by geometry (not silence)", () => {
  it("is not a bracket kind and its planner endpoints are none", () => {
    expect(BRACKET_KINDS.has("rose")).toBe(false);
    expect(bracketGeometry({ kind: "rose" }).endpoints).toBe("none");
  });
});

describe("rose — Inspector section (Chart tab, standard placement)", () => {
  function renderInspector(plot: Plot) {
    const onSetPlotOptions = vi.fn();
    const h = {
      onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
      onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
      onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
      onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
      onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
      onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
      annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
    };
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={windTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { container, onSetPlotOptions };
  }
  const row = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);

  it("Sectors / Bands / Compass all write plot.rose", () => {
    const { container, onSetPlotOptions } = renderInspector(rosePlot());
    const sectors = row(container, "Sectors");
    expect(sectors, "no Polar histogram section").toBeTruthy();
    fireEvent.change(sectors!.querySelector("select")!, { target: { value: "12" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { rose: { sectors?: number } }).rose.sectors).toBe(12);
    const bands = row(container, "Bands");
    expect(bands).toBeTruthy();
    fireEvent.change(bands!.querySelector("select")!, { target: { value: "6" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { rose: { bands?: number } }).rose.bands).toBe(6);
    const compass = row(container, "Compass (N up)");
    expect(compass).toBeTruthy();
    fireEvent.click(compass!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { rose: { compass?: boolean } }).rose.compass).toBe(false);
  });
});

describe("rose — from the datasheet", () => {
  it("column format advertises it; the genre + gallery card exist and agree", () => {
    expect(TABLE_FORMATS.column.graphs).toContain("Polar histogram");
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "rose");
    expect(g, "no rose genre").toBeTruthy();
    expect(g!.formats).toContain("column");
    expect(g!.formats).toContain("xy");
    const card = galleryItems().find((x) => x.key === "rose");
    expect(card, "no rose gallery card").toBeTruthy();
    expect((card!.plot.kind ?? "xy")).toBe("rose");
  });
});
