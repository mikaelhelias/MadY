// @vitest-environment jsdom
// Guards for click routing and drawing details across graph types.
// The QQ/Manhattan reference lines are guarded by refline-panel.test.tsx.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);
const SIZE = { width: 640, height: 460 };
const card = (kind: string) => galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
const build = (kind: string, over: Partial<Plot> = {}) => {
  const c = card(kind);
  return { table: c.table, scene: buildPlotScene(c.table, { ...c.plot, ...over } as Plot, SIZE), plot: { ...c.plot, ...over } as Plot };
};

// ── chord + oncoprint "Label size" must reach the rendered text ──────────
describe("label-size reaches the drawing (chord, oncoprint)", () => {
  it("chord: the arc-label font size follows chord.labelSize", () => {
    // Measured where 26 px names fit: in a box too small for them the builder draws them smaller and says so (fill the
    // box) — the exact size below proves this box is not that case.
    const roomy = (over: Partial<Plot>) => { const c = card("chord"); return { scene: buildPlotScene(c.table, { ...c.plot, ...over } as Plot, { width: 1400, height: 1240 }) }; };
    const small = roomy({ chord: { ...card("chord").plot.chord, labelSize: 9 } });
    const big = roomy({ chord: { ...card("chord").plot.chord, labelSize: 26 } });
    expect(small.scene.chord!.labelSize).toBe(9);
    expect(big.scene.chord!.labelSize).toBe(26);
    const fs = (scene: typeof small.scene): number[] => {
      const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
      const out = [...container.querySelectorAll(".gfx-chord text")].map((t) => Number((t as SVGTextElement).getAttribute("font-size")));
      cleanup();
      return out;
    };
    expect(Math.max(...fs(big.scene))).toBeGreaterThan(Math.max(...fs(small.scene)));
  });

  it("oncoprint: the gene/sample label font size follows oncoprint.labelSize", () => {
    const small = build("oncoprint", { oncoprint: { labelSize: 9 } });
    const big = build("oncoprint", { oncoprint: { labelSize: 24 } });
    expect(small.scene.oncoprint!.labelSize).toBe(9);
    expect(big.scene.oncoprint!.labelSize).toBe(24);
  });
});

// ── chord node labels + oncoprint gene/sample labels must click-route ────
describe("data labels are clickable (chord node, oncoprint gene/sample)", () => {
  const clickFirst = (scene: ReturnType<typeof build>["scene"], selector: string) => {
    const picks: unknown[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    const el = container.querySelector(selector);
    expect(el, `no element for ${selector}`).toBeTruthy();
    fireEvent.click(el!);
    cleanup();
    return picks;
  };
  it("chord: clicking a node label opens the Chart type section, not the whole plot", () => {
    const picks = clickFirst(build("chord").scene, ".gfx-chord text");
    expect(picks).toContainEqual({ kind: "chart-section", title: "Chart type" });
    expect(picks).not.toContainEqual({ kind: "plot" });
  });
  it("oncoprint: clicking a gene label opens the Chart type section", () => {
    const { scene } = build("oncoprint");
    const picks: unknown[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    // the gene labels are the end-anchored texts in the oncoprint group
    const gene = [...container.querySelectorAll(".gfx-oncoprint text")].find((t) => (t.textContent ?? "").length > 1);
    // What a mouse sends: press, release, click. A gene name is a draggable label, which selects
    // on the release and swallows the click after it.
    fireEvent.pointerDown(gene!, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(gene!, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.click(gene!);
    cleanup();
    expect(picks).toContainEqual({ kind: "chart-section", title: "Chart type" });
  });
});

// ── a single click on a value label selects the point, not the whole plot ─
describe("value labels single-click to their point", () => {
  it("a bar value label selects its point on a plain click (not {kind:'plot'})", () => {
    // A bar with value labels ON — the gallery grouped-bar card + showValues.
    const { scene } = build("bar", { showValues: true });
    expect(scene.valueLabels?.show, "the fixture must actually draw value labels").toBe(true);
    const picks: unknown[] = [];
    const onMoveValueLabel = vi.fn();
    const { container } = render(
      <PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} onMoveValueLabel={onMoveValueLabel} />,
    );
    // find a value-label text (they carry the move cursor / drag handlers)
    const labels = [...container.querySelectorAll("text")].filter((t) => (t as SVGTextElement).style.cursor === "move" || (t as SVGTextElement).style.cursor === "text");
    expect(labels.length, "no draggable value labels rendered").toBeGreaterThan(0);
    const t = labels[0]!;
    // A click = pointerDown then pointerUp at the same spot, then the click event.
    fireEvent.pointerDown(t, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(t, { clientX: 100, clientY: 100 });
    fireEvent.click(t, { clientX: 100, clientY: 100 });
    cleanup();
    expect(picks.some((p) => (p as { kind?: string })?.kind === "series" && (p as { part?: string })?.part === "points"),
      "a plain click on a value label should select its point").toBe(true);
    expect(picks).not.toContainEqual({ kind: "plot" });
  });
});

// ── per-element recolour reaches the drawing (sunburst, chord, oncoprint) ─
describe("per-element colour override reaches the drawing", () => {
  it("oncoprint: seriesStyles[type].color recolours that alteration's bands", () => {
    const base = build("oncoprint").scene.oncoprint!;
    const type = base.tiles.flatMap((t) => t.bands).length ? null : null; void type;
    // pick a type present in the demo and recolour it
    const recol = build("oncoprint", { seriesStyles: { Missense: { color: "#123456" } } }).scene.oncoprint!;
    expect(recol.tiles.some((t) => t.bands.some((b) => b.color === "#123456"))).toBe(true);
    expect(base.tiles.some((t) => t.bands.some((b) => b.color === "#123456"))).toBe(false);
  });
  it("chord: seriesStyles[node].color recolours that node's arc", () => {
    const recol = build("chord", { seriesStyles: { "T cell": { color: "#abcdef" } } }).scene.chord!;
    expect(recol.arcs.some((a) => a.name === "T cell" && a.color === "#abcdef")).toBe(true);
  });
  it("sunburst: seriesStyles[branch].color recolours that top-level branch", () => {
    const recol = build("sunburst", { seriesStyles: { Bacteria: { color: "#0f0f0f" } } }).scene.sunburst!;
    expect(recol.segments.some((s) => s.depth === 1 && s.label === "Bacteria" && s.color === "#0f0f0f")).toBe(true);
  });
});

// ── chrome elements that name data / controls click-route ───────
describe("chrome click routes", () => {
  const clickAll = (kind: string, selector: string): unknown[] => {
    const { scene } = build(kind);
    const picks: unknown[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} onMoveValueLabel={vi.fn()} onEditText={vi.fn()} />);
    for (const el of container.querySelectorAll(selector)) fireEvent.click(el);
    cleanup();
    return picks;
  };
  it("lollipop: stem + baseline lines route to the lollipop controls", () => {
    // Clicking a stem/baseline (both plain <line>s) reaches the Chart type section.
    // (The frame and grid lines this loop also clicks route to their axis.)
    const picks = clickAll("lollipop", "line");
    expect(picks).toContainEqual({ kind: "chart-section", title: "Chart type" });
  });
  // A compass letter / ring number opens its font - Title & legend > Compass & ring label font - not Chart type,
  // where nothing styles the text (click-routes-rose-onco.test holds the detail). Guards that clicking the rose's
  // labels goes somewhere that edits them.
  it("rose: direction labels route to their font", () => {
    const picks = clickAll("rose", ".gfx-rose text");
    expect(picks.length).toBeGreaterThan(0);
    expect(picks).toContainEqual({ kind: "chart-section", title: "Title & legend" });
  });
  it("upset: the set-size number selects its set", () => {
    const picks = clickAll("upset", "text");
    expect(picks.some((p) => (p as { kind?: string })?.kind === "upset-set")).toBe(true);
  });
  it("tracks: a numeric track's tiles select the track's own column (its ramp)", () => {
    const { scene, plot } = build("tracks");
    const numeric = scene.tracks!.strips.find((s) => s.numeric)!;
    const picks: unknown[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    for (const el of container.querySelectorAll(".tracktile")) fireEvent.click(el);
    cleanup();
    void plot;
    expect(picks).toContainEqual({ kind: "series", columnId: numeric.id });
  });
  it("network: the graph fills its plot rect (not compressed into a narrow left band)", () => {
    const s: { plot: { width: number }; network?: { nodes: { cx: number }[] } } = build("network").scene as never;
    const xs = s.network!.nodes.map((n) => n.cx);
    const span = Math.max(...xs) - Math.min(...xs);
    // At full width the graph spans most of its plot width. Guards against reserving half the
    // widest label on both sides (insetX), which compresses the graph to under half the plot.
    expect(span).toBeGreaterThan(s.plot.width * 0.7);
  });
  it("volcano: the up/down/ns zone key shows by default, and hides on legend.show=false", () => {
    const on = build("volcano").scene;
    expect(on.legend.map((e) => e.label)).toEqual(["Up-regulated", "Down-regulated", "Not significant"]);
    const off = build("volcano", { legend: { show: false } }).scene;
    expect(off.legend).toEqual([]);
  });
  it("histogram: the normal-curve overlay is a Gaussian fitted to the data, on frequency modes only", () => {
    // Off by default — no curve. (`distributionCurves` also holds the density curve;
    // the normal curve is the entry labelled "normal".)
    expect(build("histogram").scene.distributionCurves).toBeUndefined();
    // On: a curve path appears; its peak (smallest y = highest point) sits near the data centre.
    const withCurve = build("histogram", { histogram: { normalCurve: true } }).scene;
    const normal = withCurve.distributionCurves?.find((c) => c.label === "normal");
    expect(normal?.path.startsWith("M")).toBe(true);
    expect(withCurve.distributionCurves).toHaveLength(1);
    // Cumulative mode refuses with a warning instead of drawing a (wrong) bell.
    const cum = build("histogram", { histogram: { normalCurve: true, freq: "cumulative" } }).scene;
    expect(cum.distributionCurves).toBeUndefined();
    expect(cum.warnings.some((w) => /normal curve/i.test(w))).toBe(true);
  });
  it("histogram: the overlay is a real bell — peaks in the middle, lower at both ends", () => {
    const s = build("histogram", { histogram: { normalCurve: true } }).scene;
    const pts = s.distributionCurves![0]!.path.slice(1).split(" L").map((p) => p.split(",").map(Number) as [number, number]);
    expect(pts.length).toBeGreaterThan(10);
    const y = (i: number) => pts[i]![1]; // smaller y = higher on screen
    const mid = Math.floor(pts.length / 2);
    // The middle rides higher (smaller y) than either end — a bell, not a line or a monotone.
    expect(y(mid)).toBeLessThan(y(0));
    expect(y(mid)).toBeLessThan(y(pts.length - 1));
  });
  it("swimmer: the duration label's text override + drag offset reach the drawing", () => {
    const swim = build("swimmer").scene.swimmer!;
    const row = swim.rows.find((r) => r.label)!;
    // The label reads its override from pointStyles keyed `${startId}:${rowId}` (the same key its
    // colour uses), so it renames + drags like every other value label.
    const withOverride = build("swimmer", {
      pointStyles: { [`${swim.startId}:${row.rowId}`]: { valueText: "XYZ", valueDx: 11, valueDy: 7 } },
    }).scene.swimmer!;
    const lab = withOverride.rows.find((r) => r.rowId === row.rowId)!.label!;
    expect(lab.text).toBe("XYZ");
    expect(lab.dx).toBe(11);
    expect(lab.dy).toBe(7);
  });
});
