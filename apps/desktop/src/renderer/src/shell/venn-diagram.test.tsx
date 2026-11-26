// @vitest-environment jsdom
// Venn / Euler diagram, drawn from its own table format: the "sets" membership
// table (row = item, one column per set, non-empty-and-non-zero cell = member). Classic
// equal circles by default; area-proportional on demand — 2 sets exact (the lens equation is
// recomputed independently here, in the test, from the returned geometry), 3 sets best-fit
// with a warning when circles cannot draw the counts faithfully. Zone counts are
// computed data; set colours ride the ordinary per-dataset series colour.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { KIND_COLUMNS, TABLE_FORMATS } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { BRACKET_KINDS, Inspector, NO_SERIES_LEGEND } from "./Inspector";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES } from "./newGraph";

afterEach(cleanup);

/** Membership fixture: |A|=8 · |B|=4 · |A∩B|=2 (rows carry 1/0, text, and blanks). */
function twoSets(): DataTable {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    const inA = i < 8; // 8 members of A
    const inB = i >= 6; // 4 members of B → overlap rows 6,7
    rows.push({ id: `r${i}`, cells: { item: `item${i}`, a: inA ? (i === 0 ? "x" : 1) : i === 9 ? 0 : "", b: inB ? 1 : "" } });
  }
  return {
    id: "ts", kind: "sets", name: "S",
    columns: [
      { id: "item", name: "Item", role: "x" },
      { id: "a", name: "Set A", role: "y" },
      { id: "b", name: "Set B", role: "y" },
    ],
    rows,
  };
}

function threeSets(extra: { abcRow?: boolean } = { abcRow: true }): DataTable {
  const mk = (id: string, a: 0 | 1, b: 0 | 1, c: 0 | 1) => ({ id, cells: { item: id, a, b, c } });
  const rows = [
    mk("x1", 1, 0, 0), mk("x2", 1, 0, 0), mk("x3", 0, 1, 0), mk("x4", 0, 1, 0),
    mk("x5", 0, 0, 1), mk("x6", 0, 0, 1), mk("x7", 1, 1, 0), mk("x8", 0, 1, 1), mk("x9", 1, 0, 1),
    ...(extra.abcRow ? [mk("x10", 1, 1, 1)] : []),
  ];
  return {
    id: "t3", kind: "sets", name: "S3",
    columns: [
      { id: "item", name: "Item", role: "x" },
      { id: "a", name: "Up in A", role: "y" },
      { id: "b", name: "Up in B", role: "y" },
      { id: "c", name: "Up in C", role: "y" },
    ],
    rows,
  };
}

const vennPlot = (over: Partial<NonNullable<Plot["venn"]>> = {}, plotOver: Partial<Plot> = {}): Plot => ({
  id: "p", name: "Overlap", source: "ts", status: "ok", styleOverrides: {}, kind: "venn",
  venn: { ...over }, ...plotOver,
});

/** Independent two-circle lens-area recomputation (the oracle for the exact 2-set layout). */
function lensArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a1 = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const a3 = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a1 + a2 - a3;
}

describe("the sets table format", () => {
  it("the \"sets\" table format is registered with the membership contract", () => {
    expect(TABLE_FORMATS.sets).toBeTruthy();
    expect(TABLE_FORMATS.sets.replicates).toBe(false);
    expect(KIND_COLUMNS.sets.lead).toBe("Item");
    expect(/member/i.test(TABLE_FORMATS.sets.description)).toBe(true);
  });
});

describe("venn — zone counts from membership", () => {
  it("counts exclusive zones; text cells count as membership, 0 and blank do not", () => {
    const scene = buildPlotScene(twoSets(), vennPlot());
    expect(scene.kind).toBe("venn");
    expect(scene.warnings).toEqual([]);
    const zones = Object.fromEntries(scene.venn!.zones.map((z) => [z.key, z.count]));
    expect(zones).toEqual({ A: 6, B: 2, AB: 2 });
  });

  it("draws 3 circles and 7 zones for three sets", () => {
    const scene = buildPlotScene(threeSets(), vennPlot());
    expect(scene.venn!.circles.length).toBe(3);
    expect(scene.venn!.zones.length).toBe(7);
    const zones = Object.fromEntries(scene.venn!.zones.map((z) => [z.key, z.count]));
    expect(zones["ABC"]).toBe(1);
    expect(zones["AB"]).toBe(1);
  });

  it("a 4th set is refused with a warning that names it and points to the UpSet plot", () => {
    const t = threeSets();
    t.columns.push({ id: "d", name: "Set D", role: "y" });
    const scene = buildPlotScene(t, vennPlot());
    expect(scene.venn!.circles.length).toBe(3);
    expect(scene.warnings.some((w) => w.includes("Set D") && /upset/i.test(w))).toBe(true);
  });

  it("hiding a set column redraws without it (visibleDatasets honoured)", () => {
    const plot = vennPlot({}, { seriesStyles: { c: { hidden: true } } });
    const scene = buildPlotScene(threeSets(), plot);
    expect(scene.venn!.circles.length).toBe(2);
    expect(scene.venn!.zones.length).toBe(3);
  });
});

describe("venn — geometry", () => {
  it("classic mode: equal radii, every pair overlaps", () => {
    const s = buildPlotScene(threeSets(), vennPlot());
    const [c1, c2, c3] = s.venn!.circles;
    expect(c1!.r).toBeCloseTo(c2!.r, 5);
    expect(c2!.r).toBeCloseTo(c3!.r, 5);
    const d = (p: { cx: number; cy: number }, q: { cx: number; cy: number }) => Math.hypot(p.cx - q.cx, p.cy - q.cy);
    for (const [p, q] of [[c1!, c2!], [c1!, c3!], [c2!, c3!]] as const) {
      expect(d(p, q)).toBeLessThan(p.r + q.r); // overlap
      expect(d(p, q)).toBeGreaterThan(Math.abs(p.r - q.r)); // not nested
    }
  });

  it("proportional 2-set is exact: areas ∝ counts and the lens equals the intersection", () => {
    const s = buildPlotScene(twoSets(), vennPlot({ proportional: true }));
    const [a, b] = s.venn!.circles;
    // |A| = 8, |B| = 4 → area ratio 2, radius ratio √2
    expect((a!.r / b!.r) ** 2).toBeCloseTo(2, 3);
    const d = Math.hypot(a!.cx - b!.cx, a!.cy - b!.cy);
    const unitArea = (Math.PI * a!.r * a!.r) / 8; // area of one member
    expect(lensArea(a!.r, b!.r, d) / unitArea).toBeCloseTo(2, 2); // |A∩B| = 2, recomputed independently
  });

  it("proportional handles the Euler cases: a subset nests, disjoint sets separate", () => {
    const t = twoSets();
    // make B ⊂ A: drop B-membership from every row not in A (row 9 carries a = 0, not "")
    for (const r of t.rows) if (r.cells["b"] === 1 && (r.cells["a"] === "" || r.cells["a"] === 0)) r.cells["b"] = "";
    const nested = buildPlotScene(t, vennPlot({ proportional: true }));
    const [na, nb] = nested.venn!.circles;
    expect(Math.hypot(na!.cx - nb!.cx, na!.cy - nb!.cy) + nb!.r).toBeLessThanOrEqual(na!.r + 0.5);
    // disjoint: nobody in both
    const t2 = twoSets();
    for (const r of t2.rows) if (r.cells["a"] !== "" && r.cells["a"] !== 0) r.cells["b"] = "";
    const dis = buildPlotScene(t2, vennPlot({ proportional: true }));
    const [da, db] = dis.venn!.circles;
    expect(Math.hypot(da!.cx - db!.cx, da!.cy - db!.cy)).toBeGreaterThanOrEqual(da!.r + db!.r);
  });

  it("proportional 3-set warns when circles cannot draw the counts (the classic impossible case)", () => {
    // all three pairwise overlaps exist but no triple member — circles must still triple-overlap
    const s = buildPlotScene(threeSets({ abcRow: false }), vennPlot({ proportional: true }));
    expect(s.venn!.circles.length).toBe(3);
    expect(s.warnings.some((w) => /circle|approx/i.test(w)), `warnings: ${s.warnings.join(" | ")}`).toBe(true);
  });
});

describe("venn — the drawing + interactions", () => {
  it("circles are clickable set targets; counts draw; set labels are drag handles", () => {
    const scene = buildPlotScene(threeSets(), vennPlot());
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} onSelect={onSelect} />);
    const circles = container.querySelectorAll("circle.vennset");
    expect(circles.length).toBe(3);
    fireEvent.click(circles[0]!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "venn-set", datasetId: "a" });
    // 7 zone counts as text
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts.filter((t) => t === "1").length).toBeGreaterThanOrEqual(3);
    // the set labels render (draggable titles)
    expect(texts.some((t) => t?.includes("Up in A"))).toBe(true);
  });

  it("a stored set-label drag offset rides separately (labelOff), never baked into the base anchor", () => {
    // A baked-in offset breaks the second drag: DraggableTitle composes drags from its
    // `offset` prop, so if the builder moved the anchor instead, the next drag starts
    // from zero and the committed offset loses the first drag's displacement.
    const plain = buildPlotScene(threeSets(), vennPlot());
    const moved = buildPlotScene(threeSets(), vennPlot({ labelOffsets: { a: { dx: 25, dy: -10 } } }));
    const c0 = plain.venn!.circles.find((c) => c.setId === "a")!;
    const c1 = moved.venn!.circles.find((c) => c.setId === "a")!;
    expect(c1.labelOff).toEqual({ dx: 25, dy: -10 });
    expect([c1.labelX, c1.labelY]).toEqual([c0.labelX, c0.labelY]);
    // …and the figure passes it through: the label's own <text> carries the translate.
    const { container } = render(<PlotFigure scene={moved} selected={null} zoom={1} />);
    const lbl = [...container.querySelectorAll("text")].find((t) => t.textContent?.includes("Up in A"))!;
    expect(lbl.getAttribute("transform")).toContain("translate(25 -10)");
  });

  it("a text annotation renders on the diagram (fractional layer mounted, not silently lost)", () => {
    const plot = vennPlot({}, { annotations: [{ id: "note", kind: "text", label: "interesting overlap", x: 0.5, y: 0.9 }] });
    const scene = buildPlotScene(threeSets(), plot);
    expect(scene.annotations.some((a) => a.id === "note")).toBe(true);
    const { container } = render(<PlotFigure scene={scene} selected={null} zoom={1} />);
    expect([...container.querySelectorAll("text")].some((t) => t.textContent?.includes("interesting overlap"))).toBe(true);
  });

  it("percent mode adds the share of the union", () => {
    const scene = buildPlotScene(twoSets(), vennPlot({ showPercents: true }));
    const ab = scene.venn!.zones.find((z) => z.key === "AB")!;
    expect(ab.text).toMatch(/2\s*\(20%\)/); // 2 of 10 union members
  });
});

describe("venn — refusals + Inspector", () => {
  it("no brackets, no series legend (each stated in its own registry)", () => {
    expect(BRACKET_KINDS.has("venn")).toBe(false);
    expect(NO_SERIES_LEGEND.has("venn")).toBe(true);
  });

  it("the Venn section controls write plot.venn", () => {
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
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={vennPlot()} table={twoSets()}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} {...h} />,
    );
    const row = (label: string) => [...container.querySelectorAll("label")].find((l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === label);
    const prop = row("Area-proportional");
    expect(prop, "no Venn section").toBeTruthy();
    fireEvent.click(prop!.querySelector("input")!);
    expect((onSetPlotOptions.mock.calls.at(-1)![0] as Partial<Plot>).venn?.proportional).toBe(true);
    expect(row("Show counts")).toBeTruthy();
    expect(row("Percent of union")).toBeTruthy();
    expect(row("Overlap opacity")).toBeTruthy();
    expect(row("Outline")).toBeTruthy();
  });
});

describe("venn — new-graph wizard and gallery", () => {
  it("wizard genre + gallery card exist on the sets format, card builds warning-free", () => {
    const g = NEW_GRAPH_GENRES.find((x) => x.key === "venn");
    expect(g).toBeTruthy();
    expect(g!.formats[0]).toBe("sets");
    const card = galleryItems().find((x) => x.key === "venn");
    expect(card).toBeTruthy();
    const scene = buildPlotScene(card!.table, card!.plot);
    expect(scene.warnings).toEqual([]);
    expect(scene.venn!.circles.length).toBe(3);
  });
});
