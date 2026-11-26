// @vitest-environment jsdom
// Funnel plot: the publication-bias companion to the forest plot. X = effect, Y = per-study
// standard error drawn inverted (0 on top), a dot per study, a pseudo-CI triangle around the
// pooled effect, optional zero-centred significance contours. Same data layout as the forest
// plot (Study · Estimate · Lower · Upper); pooling reuses core metaAnalysis, so no separate
// maths and no engine call.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { bracketGeometry, KIND_COLUMNS, metaAnalysis, REFERENCE_LINES, TABLE_FORMATS, trimAndFill, validateTable } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";
import { forestTable } from "./plot-fixtures";

afterEach(cleanup);

const funnelPlot = (over: Partial<NonNullable<Plot["funnel"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Funnel", source: "tf", status: "ok", styleOverrides: {}, kind: "funnel",
  funnel: { ...over }, ...plotOver,
});

describe("funnel — builder geometry", () => {
  it("draws one dot per finite study on an inverted standard-error axis", () => {
    const scene = buildPlotScene(forestTable, funnelPlot());
    expect(scene.kind).toBe("funnel");
    expect(scene.warnings).toEqual([]);
    // the SE axis: reversed by default (0 at the top) — measured on the drawn ticks
    const ticks = scene.y.ticks.filter((t) => !t.minor);
    const zero = ticks.find((t) => t.value === 0);
    const top = Math.max(...ticks.map((t) => t.value));
    const topTick = ticks.find((t) => t.value === top)!;
    expect(zero, "the SE axis must show a 0 tick").toBeTruthy();
    expect(zero!.pos, "SE 0 must sit above larger SEs (inverted axis)").toBeLessThan(topTick.pos);
    const marks = scene.series[0]?.marks ?? [];
    expect(marks.length).toBe(4);
  });

  it("pooled effect matches core metaAnalysis (fixed + random)", () => {
    const studies = forestTable.rows.map((r) => ({ est: r.cells["e"] as number, lo: r.cells["lo"] as number, hi: r.cells["hi"] as number }));
    for (const model of ["fixed", "random"] as const) {
      const scene = buildPlotScene(forestTable, funnelPlot({ model }));
      const expected = metaAnalysis(studies, { model, inputConf: 0.95, pooledConf: 0.95, log: false })!;
      expect(scene.funnel!.pooled).toBeCloseTo(expected.est, 8);
    }
  });

  it("the pseudo-CI region is a triangle: half-width 0 at SE 0, z·SEmax at the bottom", () => {
    const scene = buildPlotScene(forestTable, funnelPlot());
    const region = scene.funnel!.region!;
    // apex sits at the pooled effect; the base spreads by 1.96·SE
    expect(region.apexX).toBeCloseTo(scene.funnel!.pooled, 8);
    expect(region.halfWidthAtMaxSe).toBeCloseTo(1.96 * scene.funnel!.seMax, 2);
    expect(region.path.length).toBeGreaterThan(0);
  });

  it("contour mode emits the three zero-centred significance bands", () => {
    const scene = buildPlotScene(forestTable, funnelPlot({ contour: true }));
    expect(scene.funnel!.contours?.length).toBe(3);
  });

  it("a log effect axis pools in log space (ratio data)", () => {
    const scene = buildPlotScene(forestTable, funnelPlot({}, { xAxis: { scale: "log10" } }));
    const studies = forestTable.rows.map((r) => ({ est: r.cells["e"] as number, lo: r.cells["lo"] as number, hi: r.cells["hi"] as number }));
    const expected = metaAnalysis(studies, { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: true })!;
    expect(scene.funnel!.pooled).toBeCloseTo(expected.est, 8);
  });

  it("fewer than three value columns is refused with a warning", () => {
    const bad: DataTable = { ...forestTable, columns: forestTable.columns.slice(0, 2) };
    const scene = buildPlotScene(bad, funnelPlot());
    expect(scene.warnings.some((w) => /three value columns/i.test(w))).toBe(true);
  });

  it("the pooled line is a registered reference line (so it gets the style panel and label drag)", () => {
    expect(REFERENCE_LINES.some((r) => r.id === "funnel-pooled" && r.kinds.includes("funnel"))).toBe(true);
    const scene = buildPlotScene(forestTable, funnelPlot());
    expect(scene.annotations.some((a) => a.id === "funnel-pooled")).toBe(true);
    const off = buildPlotScene(forestTable, funnelPlot({ showPooled: false }));
    expect(off.annotations.some((a) => a.id === "funnel-pooled")).toBe(false);
  });

  it("colour-by-column reaches the study dots (data-driven family membership)", () => {
    const plot = funnelPlot();
    plot.seriesStyles = { e: { colorFromColumn: "lo", colorFromMode: "continuous" } };
    const scene = buildPlotScene(forestTable, plot);
    const colors = new Set((scene.series[0]?.marks ?? []).map((m) => m.symbolFillColor ?? scene.series[0]!.color));
    expect(colors.size, "colour-by-column must give the dots distinct colours").toBeGreaterThan(1);
  });

  it("hline/vline annotations place through the real axes", () => {
    const plot = funnelPlot();
    plot.annotations = [
      { id: "v1", kind: "vline", value: 1 },
      { id: "h1", kind: "hline", value: 0.1 },
    ];
    const scene = buildPlotScene(forestTable, plot);
    expect(scene.annotations.some((a) => a.id === "v1")).toBe(true);
    expect(scene.annotations.some((a) => a.id === "h1")).toBe(true);
  });
});

describe("funnel — trim-and-fill overlay (Duval-Tweedie)", () => {
  // Three precise studies at 0 (SE ≈ 0.1) + two imprecise high ones (SE ≈ 1) — the classic
  // one-sided funnel; core trimAndFill's own tests hand-derive k0 = 1 on this shape.
  const skewedTable: DataTable = {
    ...forestTable,
    rows: [
      { id: "r1", cells: { s: "P1", e: 0, lo: -0.196, hi: 0.196 } },
      { id: "r2", cells: { s: "P2", e: 0, lo: -0.196, hi: 0.196 } },
      { id: "r3", cells: { s: "P3", e: 0, lo: -0.196, hi: 0.196 } },
      { id: "r4", cells: { s: "S1", e: 1, lo: -0.96, hi: 2.96 } },
      { id: "r5", cells: { s: "S2", e: 2, lo: 0.04, hi: 3.96 } },
    ],
  };
  const studiesOf = (t: DataTable) => t.rows.map((r) => ({ est: r.cells["e"] as number, lo: r.cells["lo"] as number, hi: r.cells["hi"] as number }));

  it("imputed studies + the adjusted centre line match core trimAndFill", () => {
    const scene = buildPlotScene(skewedTable, funnelPlot({ trimFill: true }));
    const expected = trimAndFill(studiesOf(skewedTable), { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!;
    expect(expected.k0, "fixture must be able to exhibit imputation").toBeGreaterThan(0);
    const imp = scene.funnel!.imputed!;
    expect(imp.length).toBe(expected.k0);
    expect(imp[0]!.est).toBeCloseTo(expected.imputed[0]!.est, 8);
    expect(scene.funnel!.trimFill!.k0).toBe(expected.k0);
    expect(scene.funnel!.trimFill!.adjusted).toBeCloseTo(expected.adjusted.est, 8);
    // The adjusted line is a registered reference line, like the pooled one.
    expect(REFERENCE_LINES.some((r) => r.id === "funnel-adjusted" && r.kinds.includes("funnel"))).toBe(true);
    expect(scene.annotations.some((a) => a.id === "funnel-adjusted")).toBe(true);
    // The mirrored study extends the effect axis — it must sit inside the domain, not clipped off.
    const [d0, d1] = scene.x.domain;
    expect(Math.min(d0!, d1!)).toBeLessThanOrEqual(imp[0]!.est);
  });

  it("the hollow dots are actually painted (checked on the drawing, not on the stored option)", () => {
    const scene = buildPlotScene(skewedTable, funnelPlot({ trimFill: true }), { width: 640, height: 480 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const dots = container.querySelectorAll(".gfx-tfimputed circle");
    expect(dots.length).toBe(scene.funnel!.imputed!.length);
    expect((dots[0] as SVGCircleElement).getAttribute("fill")).toBe("none");
  });

  it("a symmetric funnel imputes nothing and says so in a warning", () => {
    const sym: DataTable = {
      ...forestTable,
      rows: [
        { id: "r1", cells: { s: "A", e: -1, lo: -2.96, hi: 0.96 } },
        { id: "r2", cells: { s: "B", e: 0, lo: -0.98, hi: 0.98 } },
        { id: "r3", cells: { s: "C", e: 1, lo: -0.96, hi: 2.96 } },
      ],
    };
    expect(trimAndFill(studiesOf(sym), { model: "fixed", inputConf: 0.95, pooledConf: 0.95, log: false })!.k0).toBe(0);
    const scene = buildPlotScene(sym, funnelPlot({ trimFill: true }));
    expect(scene.funnel!.imputed ?? []).toHaveLength(0);
    expect(scene.annotations.some((a) => a.id === "funnel-adjusted")).toBe(false);
    expect(scene.warnings.some((w) => /trim-and-fill.*no missing/i.test(w))).toBe(true);
  });

  it("off by default: no imputed dots, no adjusted line, no warning", () => {
    const scene = buildPlotScene(skewedTable, funnelPlot());
    expect(scene.funnel!.imputed).toBeUndefined();
    expect(scene.funnel!.trimFill).toBeUndefined();
    expect(scene.annotations.some((a) => a.id === "funnel-adjusted")).toBe(false);
  });
});

describe("funnel — brackets refused by geometry (not silence)", () => {
  it("is not a bracket kind and its planner endpoints are none", () => {
    expect(BRACKET_KINDS.has("funnel")).toBe(false);
    // "data-x" = the continuous-axis family (volcano/blandaltman/...) — no category endpoints
    expect(bracketGeometry({ kind: "funnel" }).endpoints).toBe("data-x");
  });
});

describe("funnel — Inspector section (Chart tab, standard placement)", () => {
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
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={forestTable}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    return { container, onSetPlotOptions };
  }
  const row = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);

  it("Model / Region level / Contour / Pooled line / Size by precision all write plot.funnel", () => {
    const { container, onSetPlotOptions } = renderInspector(funnelPlot());
    const model = row(container, "Model");
    expect(model, "no Funnel plot section").toBeTruthy();
    fireEvent.change(model!.querySelector("select")!, { target: { value: "random" } });
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { funnel: { model?: string } }).funnel.model).toBe("random");
    const contour = row(container, "Contours");
    expect(contour).toBeTruthy();
    fireEvent.click(contour!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { funnel: { contour?: boolean } }).funnel.contour).toBe(true);
    expect(row(container, "Region level")).toBeTruthy();
    expect(row(container, "Pooled line")).toBeTruthy();
    expect(row(container, "Size by precision")).toBeTruthy();
  });

  it("Trim-and-fill tickbox writes plot.funnel.trimFill (the overlay's one control)", () => {
    const { container, onSetPlotOptions } = renderInspector(funnelPlot());
    const tf = row(container, "Trim-and-fill");
    expect(tf, "no Trim-and-fill row in the Funnel section").toBeTruthy();
    fireEvent.click(tf!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as { funnel: { trimFill?: boolean } }).funnel.trimFill).toBe(true);
  });
});

describe("the meta-analysis data sheet", () => {
  it("forest + funnel live on their own format — no statistics, no group-comparison nudges", () => {
    // A Study·Estimate·Lower·Upper sheet is not a Column sheet: t tests / ANOVA over a study's
    // own confidence limits would be meaningless, and the assistant would suggest them. One
    // shared format, two graphs — as with sets.
    expect(TABLE_FORMATS.meta).toBeTruthy();
    expect(TABLE_FORMATS.meta.replicates).toBe(false);
    expect(TABLE_FORMATS.meta.analyses).toEqual(["Meta-analysis (pool studies)", "Publication bias (Egger + trim-and-fill)"]); // the sheet's statistics (meta-analysis-method / publication-bias-method tests)
    expect(TABLE_FORMATS.meta.graphs).toEqual(["Forest plot", "Funnel plot"]);
    expect(KIND_COLUMNS.meta.lead).toBe("Study");
    for (const key of ["forest", "funnel"] as const) {
      const g = NEW_GRAPH_GENRES.find((x) => x.key === key);
      expect(g, `no ${key} genre`).toBeTruthy();
      expect(g!.formats[0]).toBe("meta"); // the wizard's default sheet
      expect(g!.formats).toContain("column"); // existing Column sheets still offer it
      expect(galleryItems().find((x) => x.key === key)!.table.kind).toBe("meta");
    }
  });

  it("a backwards confidence interval is flagged on the sheet, non-blocking", () => {
    const bad: DataTable = {
      ...forestTable,
      kind: "meta",
      rows: [
        { id: "r1", cells: { s: "A", e: 1.1, lo: 0.9, hi: 1.4 } },
        { id: "r2", cells: { s: "B", e: 0.8, lo: 1.2, hi: 0.6 } }, // lower above upper
      ],
    };
    expect(validateTable(bad).some((w) => /lower.*upper/i.test(w))).toBe(true);
    const fine: DataTable = { ...bad, rows: [bad.rows[0]!] };
    expect(validateTable(fine)).toEqual([]);
  });
});
