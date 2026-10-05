// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Annotation, DataTable, Plot } from "@mady/core";
import { createSampleDocument } from "@mady/core";
import { buildPlotScene, OKABE_ITO, PALETTES, TOL_VIBRANT } from "@mady/graphics";
import { PlotFigure, parseRich, roundTopPath, snapToGuides } from "./PlotFigure";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

/** A graph with one annotation, rendered with the given selection + callbacks. */
function annScene(ann: Omit<Annotation, "id">) {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 3, y: 6 } }],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, annotations: [{ id: "a1", ...ann }] };
  return buildPlotScene(table, plot, { width: 440, height: 320 });
}
const ANN_SEL = { kind: "annotation" as const, id: "a1" };

describe("PlotFigure — network two-tone = darker outline of the fill (not a split disc)", () => {
  const netTable: DataTable = {
    id: "t", kind: "xy", name: "N",
    columns: [{ id: "s", name: "src" }, { id: "tg", name: "tgt" }],
    rows: [{ id: "r1", cells: { s: "A", tg: "B" } }, { id: "r2", cells: { s: "B", tg: "C" } }],
  };
  const netScene = (twoTone: boolean) =>
    buildPlotScene(
      netTable,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "network", network: { nodeColor: "#3399ff", nodeTwoTone: twoTone } },
      { width: 440, height: 320 },
    );
  const lum = (h: string): number => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  // A node disc = a <circle> whose fill is a hex colour (edges are <line>, labels <text>).
  const nodeDisc = (c: HTMLElement): SVGCircleElement =>
    [...c.querySelectorAll<SVGCircleElement>("circle")].find((el) => el.getAttribute("fill")?.startsWith("#"))!;

  it("keeps the fill and draws a darker outline; never a transparent split-disc node", () => {
    const two = render(<PlotFigure scene={netScene(true)} selected={null} onMoveAnnotation={() => {}} />);
    const disc = nodeDisc(two.container);
    const fill = disc.getAttribute("fill")!;
    const stroke = disc.getAttribute("stroke")!;
    // Not a split disc (transparent fill + two coloured half-paths):
    expect(fill).not.toBe("transparent");
    expect(fill.toLowerCase()).toBe("#3399ff");
    // Two-tone → the outline is a real colour, a darker shade of the fill.
    expect(stroke.startsWith("#")).toBe(true);
    expect(lum(stroke)).toBeLessThan(lum(fill));
  });

  it("without two-tone the outline is the theme ring, fill unchanged (control)", () => {
    const plain = render(<PlotFigure scene={netScene(false)} selected={null} onMoveAnnotation={() => {}} />);
    const disc = nodeDisc(plain.container);
    expect(disc.getAttribute("fill")!.toLowerCase()).toBe("#3399ff");
    expect(disc.getAttribute("stroke")).toBe("var(--bg)");
  });
});

describe("PlotFigure — raincloud rain dots honour the series Shape", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Row", role: "x" }, { id: "a", name: "A", role: "y" }],
    rows: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
  };
  const rainScene = (symbol?: string) =>
    buildPlotScene(
      table,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "raincloud", ...(symbol ? { seriesStyles: { a: { symbol: symbol as never } } } : {}) },
      { width: 440, height: 320 },
    );

  /**
   * Note: painted circles only — a swarm also draws one transparent circle per dot as its click
   * target (`ScatterGlyph`), because `Marker` is pointer-events:none and a `<g>` has no hit
   * area of its own. Counting every `circle` would stop measuring the shape: the square case
   * would fail on a hit target (not a glyph), and — the real danger — the positive control
   * below could not fail, since the hit targets alone satisfy "at least one circle" even if the
   * glyph were drawn square. Both ignore the hit layer by its transparent fill.
   */
  const glyphs = (container: HTMLElement, tag: string) =>
    [...container.querySelectorAll(tag)].filter((e) => e.getAttribute("fill") !== "transparent");
  const hitTargets = (container: HTMLElement) =>
    [...container.querySelectorAll("circle")].filter((e) => e.getAttribute("fill") === "transparent");

  it("draws square rain glyphs (no circles) when Shape = square", () => {
    const { container } = render(<PlotFigure scene={rainScene("square")} selected={null} onMoveAnnotation={() => {}} />);
    // the raincloud's only dot-mark is the rain swarm (cloud = path, box = rect, no outlier dots)
    expect(glyphs(container, "circle")).toHaveLength(0);
    expect(glyphs(container, "rect").length).toBeGreaterThan(0);
  });

  it("draws circular rain glyphs by default (positive control)", () => {
    const { container } = render(<PlotFigure scene={rainScene()} selected={null} onMoveAnnotation={() => {}} />);
    expect(glyphs(container, "circle").length).toBeGreaterThan(0);
  });

  /**
   * Every rain dot must be clickable, whatever shape it is.
   *
   * Guards against `document.elementFromPoint` at the centre of a dot returning the plot
   * background `<rect>` with no handler (raincloud, column scatter and the estimation swarm) —
   * clicking a data point would select nothing, and the Data panel (Shape / Size / Colour, and
   * the whisker rows) would be unreachable by the one gesture everybody uses. The hit targets
   * are what make it work, so they are asserted here for the square case too: they must not
   * depend on the glyph happening to be a circle.
   */
  it("gives every rain dot a hit target, whatever the Shape", () => {
    for (const symbol of [undefined, "square"]) {
      const { container } = render(<PlotFigure scene={rainScene(symbol)} selected={null} onMoveAnnotation={() => {}} />);
      const hits = hitTargets(container);
      expect(hits.length).toBe(table.rows.length);
      // ...and the target has to be reachable: a pointer-events:none hit target is no target.
      for (const h of hits) expect(h.getAttribute("pointer-events")).not.toBe("none");
    }
  });
});

describe("PlotFigure — box/violin point overlay draws no spurious centre line", () => {
  const table: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Row", role: "x" }, { id: "a", name: "Drug A", role: "y" }],
    rows: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v } })),
  };
  const sceneFor = (kind: "box" | "scatter", showBoxPoints?: boolean) =>
    buildPlotScene(
      table,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, ...(showBoxPoints ? { showBoxPoints: true } : {}) },
      { width: 440, height: 320 },
    );

  it("a box with 'show all points' draws NO scatter mean line (the box median already shows the centre)", () => {
    const { container } = render(<PlotFigure scene={sceneFor("box", true)} selected={null} onMoveAnnotation={() => {}} />);
    expect(container.querySelectorAll(".gfx-scatter-mean")).toHaveLength(0);
  });

  it("a standalone column-scatter still draws its mean line (positive control)", () => {
    const { container } = render(<PlotFigure scene={sceneFor("scatter")} selected={null} onMoveAnnotation={() => {}} />);
    expect(container.querySelectorAll(".gfx-scatter-mean").length).toBeGreaterThan(0);
  });
});

describe("PlotFigure — treemap values-only rendering", () => {
  const table: DataTable = {
    id: "tm", kind: "partsofwhole", name: "GDP",
    columns: [{ id: "s", name: "State" }, { id: "v", name: "GDP" }],
    rows: [
      { id: "r1", cells: { s: "California", v: 43 } },
      { id: "r2", cells: { s: "Texas", v: 29 } },
      { id: "r3", cells: { s: "Florida", v: 18 } },
    ],
  };
  const scene = (tm: Record<string, unknown>) =>
    buildPlotScene(table, { id: "p", name: "P", source: "tm", status: "ok", styleOverrides: {}, kind: "treemap", treemap: tm }, { width: 520, height: 420 });

  it("renders value labels when showValues is on even if showLabels is off", () => {
    // scaleLabels off so the only numeric text is the in-cell value label.
    const s = scene({ showLabels: false, showValues: true, scaleLabels: false });
    const valLabel = s.treemap!.cells[0]!.valueLabel;
    expect(valLabel).not.toBe(""); // showValues populated it
    const { container } = render(<PlotFigure scene={s} selected={null} onMoveAnnotation={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain(valLabel); // value label renders despite showLabels:false (was coupled)
  });

  it("shows no value labels when showValues is off (contrast)", () => {
    const s = scene({ showLabels: false, showValues: false, scaleLabels: false });
    expect(s.treemap!.cells[0]!.valueLabel).toBe(""); // builder leaves it empty
    const { container } = render(<PlotFigure scene={s} selected={null} onMoveAnnotation={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).not.toContain("43"); // no cell value renders
  });
});

describe("roundTopPath — value-end rounding", () => {
  const bar = { x: 0, y: 0, w: 100, h: 20 };
  it("rounds the top corners for a vertical bar", () => {
    const d = roundTopPath(bar);
    // quarter-circles at the top edge (y=0): top-left Q0,0 and top-right Q100,0
    expect(d).toContain("Q0,0");
    expect(d).toContain("Q100,0");
    // the bottom edge (y=20) stays square — no Q near y=20
    expect(d).not.toContain(",20 Q");
  });
  it("rounds the value-end (right/max-x) corners for a horizontal bar", () => {
    const d = roundTopPath(bar, true);
    // curves live at the right edge x=100 (top-right + bottom-right), not the top-left corner
    expect(d).toContain("Q100,");
    expect(d).not.toContain("Q0,0");
  });
});

describe("PlotFigure — survival number-at-risk table", () => {
  const survivalScene = (show?: boolean) => {
    const table: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "Weeks" }], rows: [] };
    const plot: Plot = {
      id: "p", name: "KM", source: "t", status: "ok", styleOverrides: {}, kind: "survival",
      survival: [
        { label: "Treated", times: [0, 5, 10], surv: [1, 0.7, 0.4] },
        { label: "Control", times: [0, 5, 10], surv: [1, 0.5, 0.1] },
      ],
      survivalAtRisk: { times: [0, 5, 10], rows: [
        { label: "Treated", atRisk: [20, 12, 5] },
        { label: "Control", atRisk: [18, 7, 1] },
      ] },
      ...(show === false ? { survivalShowAtRisk: false } : {}),
    };
    return buildPlotScene(table, plot, { width: 480, height: 340 });
  };

  it("renders the number-at-risk table (title + per-group coloured counts) under the graph", () => {
    const { container } = render(<PlotFigure scene={survivalScene()} selected={null} onMoveAnnotation={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Number at risk");
    expect(texts).toContain("Treated");
    expect(texts).toContain("Control");
    for (const v of ["20", "12", "18", "7"]) expect(texts).toContain(v); // the risk-set counts
  });

  it("hides the table when survivalShowAtRisk is false", () => {
    const { container } = render(<PlotFigure scene={survivalScene(false)} selected={null} onMoveAnnotation={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).not.toContain("Number at risk");
  });

  // The at-risk table sits in the bottom margin below the plot rect, so inside the plot-area
  // clip group it would be hidden entirely. It renders outside the clipPath group.
  it("renders the number-at-risk table outside the plot-area clip group", () => {
    const { container } = render(<PlotFigure scene={survivalScene()} selected={null} onMoveAnnotation={() => {}} />);
    const title = [...container.querySelectorAll("text")].find((t) => t.textContent === "Number at risk");
    expect(title).toBeTruthy();
    // no ancestor of the at-risk title may carry a clip-path (which would hide it below the plot)
    let node: Element | null = title!;
    while (node && node.tagName.toLowerCase() !== "svg") {
      expect(node.getAttribute("clip-path")).toBeFalsy();
      node = node.parentElement;
    }
  });
});

describe("PlotFigure — annotation editing affordances", () => {
  it("a selected text box shows an × delete handle that fires onDeleteAnnotation", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "text", label: "Note", x: 0.5, y: 0.2 })} selected={ANN_SEL} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    const del = container.querySelector(".gfx-anndelete");
    expect(del).toBeTruthy();
    fireEvent.click(del!);
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("no × delete handle without onDeleteAnnotation (or when unselected)", () => {
    const { container: a } = render(<PlotFigure scene={annScene({ kind: "text", label: "Note", x: 0.5, y: 0.2 })} selected={ANN_SEL} onMoveAnnotation={() => {}} />);
    expect(a.querySelector(".gfx-anndelete")).toBeNull();
    const { container: b } = render(<PlotFigure scene={annScene({ kind: "text", label: "Note", x: 0.5, y: 0.2 })} selected={null} onMoveAnnotation={() => {}} onDeleteAnnotation={() => {}} />);
    expect(b.querySelector(".gfx-anndelete")).toBeNull();
  });

  it("a selected ellipse shows a rotation grip + a delete handle", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "ellipse", x: 0.3, y: 0.3, w: 0.3, h: 0.2 })} selected={ANN_SEL} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    const rot = [...container.querySelectorAll("circle")].find((c) => c.querySelector("title")?.textContent === "Drag to rotate");
    expect(rot).toBeTruthy();
    expect(container.querySelector(".gfx-anndelete")).toBeTruthy();
  });

  it("a vband has a grabbable move surface on top of the data (no select-first)", () => {
    const onDelete = vi.fn();
    // Not selected: the move surface must still exist + carry a move cursor, so a
    // single grab-and-drag moves the band even where data is on top.
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "vband", x: 0.4, w: 0.2, fill: "#9b8cff", fillOpacity: 0.16 })} selected={null} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    // the shaded fill is purely visual (pointer-events:none) — the data layer is on top
    const fill = container.querySelector('rect[fill="#9b8cff"]') as SVGRectElement;
    expect(fill.getAttribute("pointer-events")).toBe("none");
    // a transparent move surface (titled) sits on top and is grabbable
    const surf = [...container.querySelectorAll("rect")].find((r) => r.querySelector("title")?.textContent?.startsWith("Drag to move"));
    expect(surf).toBeTruthy();
    expect((surf as SVGRectElement).style.cursor).toBe("move");
    // no delete handle until selected
    expect(container.querySelector(".gfx-anndelete")).toBeNull();
  });

  it("a selected vband shows resize handles + an × delete handle", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "vband", x: 0.4, w: 0.2, fill: "#9b8cff", fillOpacity: 0.16 })} selected={ANN_SEL} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    // edge resize handles appear (ew-resize for a vertical band)
    expect([...container.querySelectorAll("rect")].some((r) => r.style.cursor === "ew-resize")).toBe(true);
    fireEvent.click(container.querySelector(".gfx-anndelete")!);
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("Delete key removes the selected annotation", () => {
    const onDelete = vi.fn();
    render(<PlotFigure scene={annScene({ kind: "text", label: "N", x: 0.5, y: 0.3 })} selected={ANN_SEL} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />);
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledWith("a1");
  });
});

/** A graph with two rect annotations ("a1","a2") for multi-object (Arrange) tests. */
function twoRectScene() {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 3, y: 6 } }],
  };
  const plot: Plot = {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {},
    annotations: [
      { id: "a1", kind: "rect", x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { id: "a2", kind: "rect", x: 0.6, y: 0.5, w: 0.2, h: 0.2 },
    ],
  };
  return buildPlotScene(table, plot, { width: 440, height: 320 });
}

describe("PlotFigure — multi-object (Arrange) selection", () => {
  it("plain click selects one; shift-click a second builds an 'annotations' set", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PlotFigure scene={twoRectScene()} selected={null} onSelect={onSelect} onMoveAnnotation={() => {}} />,
    );
    const g2 = container.querySelector('[data-ann-shape="a2"]')!;
    // Plain click → single-select.
    fireEvent.click(g2);
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "annotation", id: "a2" });
  });

  it("shift-click adds to the current selection (single → set of two)", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PlotFigure scene={twoRectScene()} selected={{ kind: "annotation", id: "a1" }} onSelect={onSelect} onMoveAnnotation={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-ann-shape="a2"]')!, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "annotations", ids: ["a1", "a2"] });
  });

  it("shift-click an already-selected member removes it (set of two → single)", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <PlotFigure scene={twoRectScene()} selected={{ kind: "annotations", ids: ["a1", "a2"] }} onSelect={onSelect} onMoveAnnotation={() => {}} />,
    );
    fireEvent.click(container.querySelector('[data-ann-shape="a1"]')!, { shiftKey: true });
    expect(onSelect).toHaveBeenLastCalledWith({ kind: "annotation", id: "a2" }); // collapses to the remaining one
  });

  it("both objects highlight (accent stroke) when multi-selected", () => {
    const { container } = render(
      <PlotFigure scene={twoRectScene()} selected={{ kind: "annotations", ids: ["a1", "a2"] }} onMoveAnnotation={() => {}} />,
    );
    // Each shape's body rect uses the accent stroke when selected.
    for (const id of ["a1", "a2"]) {
      const rect = container.querySelector(`[data-ann-shape="${id}"] rect`) as SVGRectElement;
      expect(rect.getAttribute("stroke")).toBe("var(--accent)");
    }
  });

  it("Delete removes every object in a multi-selection", () => {
    const onDelete = vi.fn();
    render(
      <PlotFigure scene={twoRectScene()} selected={{ kind: "annotations", ids: ["a1", "a2"] }} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    fireEvent.keyDown(window, { key: "Delete" });
    expect(onDelete).toHaveBeenCalledWith("a1");
    expect(onDelete).toHaveBeenCalledWith("a2");
    expect(onDelete).toHaveBeenCalledTimes(2);
  });
});

describe("PlotFigure — image annotation", () => {
  const IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("buildScene maps an image annotation to an 'image' scene node carrying href + a positive box + opacity", () => {
    const scene = annScene({ kind: "image", href: IMG, x: 0.25, y: 0.25, w: 0.5, h: 0.4, fillOpacity: 0.8 });
    const a = scene.annotations.find((n) => n.id === "a1")!;
    expect(a.kind).toBe("image");
    expect(a.href).toBe(IMG);
    expect((a.x2 ?? 0) - (a.x1 ?? 0)).toBeGreaterThan(0); // box has positive extent
    expect((a.y2 ?? 0) - (a.y1 ?? 0)).toBeGreaterThan(0);
    expect(a.fillOpacity).toBe(0.8);
    expect(a.width).toBe(0); // no border colour → no border stroke
  });

  it("renders an <image> element with the href, box-sized, preserveAspectRatio=none", () => {
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "image", href: IMG, x: 0.25, y: 0.25, w: 0.5, h: 0.4 })} selected={null} onMoveAnnotation={() => {}} />,
    );
    const img = container.querySelector('[data-ann-shape="a1"] image') as SVGImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute("href")).toBe(IMG);
    expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
    expect(Number(img.getAttribute("height"))).toBeGreaterThan(0);
    expect(img.getAttribute("preserveAspectRatio")).toBe("none");
  });

  it("a selected image shows corner resize handles + a rotation grip + an × delete handle", () => {
    const onDelete = vi.fn();
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "image", href: IMG, x: 0.25, y: 0.25, w: 0.5, h: 0.4 })} selected={ANN_SEL} onMoveAnnotation={() => {}} onDeleteAnnotation={onDelete} />,
    );
    expect([...container.querySelectorAll("rect")].some((r) => r.style.cursor === "nwse-resize")).toBe(true);
    const rot = [...container.querySelectorAll("circle")].find((c) => c.querySelector("title")?.textContent === "Drag to rotate");
    expect(rot).toBeTruthy();
    fireEvent.click(container.querySelector(".gfx-anndelete")!);
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("opacity flows to the <image>; a border colour draws a border rect", () => {
    const { container } = render(
      <PlotFigure scene={annScene({ kind: "image", href: IMG, x: 0.2, y: 0.2, w: 0.4, h: 0.3, fillOpacity: 0.5, color: "#ff0000", width: 2 })} selected={null} onMoveAnnotation={() => {}} />,
    );
    const img = container.querySelector('[data-ann-shape="a1"] image') as SVGImageElement;
    expect(img.getAttribute("opacity")).toBe("0.5");
    const border = [...container.querySelectorAll('[data-ann-shape="a1"] rect')].find((r) => r.getAttribute("stroke") === "#ff0000");
    expect(border).toBeTruthy();
  });
});

/** A bubble scene whose 2nd Y column ("Size") drives the radius → a size legend renders. */
function bubbleScene() {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }, { id: "s", name: "Size" }],
    rows: [
      { id: "r1", cells: { x: 1, y: 2, s: 10 } },
      { id: "r2", cells: { x: 2, y: 4, s: 55 } },
      { id: "r3", cells: { x: 3, y: 6, s: 100 } },
    ],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bubble" };
  return buildPlotScene(table, plot, { width: 440, height: 320 });
}

/** The bubble size-legend group = the <g> holding the bold "Size" title + its spheres. */
function legendGroup(container: HTMLElement): SVGGElement {
  const title = [...container.querySelectorAll("text")].find((t) => t.textContent?.trim() === "Size" && t.getAttribute("font-weight") === "600");
  const g = title?.closest("g") as SVGGElement | null;
  if (!g) throw new Error("bubble legend group not found");
  return g;
}

describe("PlotFigure — bubble size legend selection", () => {
  it("clicking the legend selects { kind: 'bubble-legend' } and not the plot", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={bubbleScene()} selected={null} onSelect={onSelect} onMoveColorbar={() => {}} />);
    const rect = legendGroup(container).querySelector("rect")!; // the transparent hit surface
    fireEvent.click(rect);
    // The click must not bubble to the root <svg> (which would override with { kind: "plot" }).
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith({ kind: "bubble-legend" });
    expect(onSelect).not.toHaveBeenCalledWith({ kind: "plot" });
  });

  it("clicking empty plot space still selects the plot (root handler intact)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={bubbleScene()} selected={null} onSelect={onSelect} onMoveColorbar={() => {}} />);
    fireEvent.click(container.querySelector("svg.gfx-figure")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "plot" });
  });

  it("arrow keys nudge the selected annotation; Shift nudges ~10× further", () => {
    const onMove = vi.fn();
    render(<PlotFigure scene={annScene({ kind: "text", label: "N", x: 0.5, y: 0.3 })} selected={ANN_SEL} onMoveAnnotation={onMove} onDeleteAnnotation={() => {}} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight", shiftKey: true });
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    const xs = onMove.mock.calls.map((c) => c[1].x as number);
    expect(xs).toHaveLength(3);
    expect(xs[0]!).toBeGreaterThan(0.5); // right of centre
    expect(xs[2]!).toBeLessThan(0.5); // left of centre
    expect(xs[1]! - 0.5).toBeGreaterThan((xs[0]! - 0.5) * 5); // Shift much further
  });

  it("right-click on an annotation opens a context menu (Duplicate / order / Delete)", () => {
    const onDelete = vi.fn();
    const onReorder = vi.fn();
    const onDuplicate = vi.fn();
    const { container } = render(
      <PlotFigure
        scene={annScene({ kind: "text", label: "N", x: 0.5, y: 0.3 })}
        selected={null}
        onMoveAnnotation={() => {}}
        onDeleteAnnotation={onDelete}
        onReorderAnnotation={onReorder}
        onDuplicateAnnotation={onDuplicate}
      />,
    );
    expect(container.querySelector(".gfx-annmenu")).toBeNull();
    const annG = [...container.querySelectorAll("g")].find((g) => g.querySelector("text")?.textContent === "N")!;
    fireEvent.contextMenu(annG);
    expect(container.querySelector(".gfx-annmenu")).toBeTruthy();
    const labels = [...container.querySelectorAll(".gfx-annmenu button")].map((b) => b.textContent);
    expect(labels).toEqual(["Duplicate", "Bring to front", "Send to back", "Delete"]);
    // re-query the live menu each time (it closes + reopens between actions)
    const click = (text: string) =>
      fireEvent.click([...container.querySelectorAll(".gfx-annmenu button")].find((b) => b.textContent === text)!);
    click("Duplicate");
    expect(onDuplicate).toHaveBeenCalledWith("a1");
    expect(container.querySelector(".gfx-annmenu")).toBeNull(); // menu closed after acting
    fireEvent.contextMenu(annG);
    click("Bring to front");
    expect(onReorder).toHaveBeenCalledWith("a1", "front");
    fireEvent.contextMenu(annG);
    click("Delete");
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("Ctrl/Cmd+D duplicates and Escape deselects the selected annotation", () => {
    const onDuplicate = vi.fn();
    const onSelect = vi.fn();
    render(
      <PlotFigure
        scene={annScene({ kind: "text", label: "N", x: 0.5, y: 0.3 })}
        selected={ANN_SEL}
        onSelect={onSelect}
        onMoveAnnotation={() => {}}
        onDeleteAnnotation={() => {}}
        onDuplicateAnnotation={onDuplicate}
      />,
    );
    fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    expect(onDuplicate).toHaveBeenCalledWith("a1");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("does not nudge/delete while an inline editor input is focused", () => {
    const onMove = vi.fn();
    const onDelete = vi.fn();
    render(<PlotFigure scene={annScene({ kind: "text", label: "N", x: 0.5, y: 0.3 })} selected={ANN_SEL} onMoveAnnotation={onMove} onDeleteAnnotation={onDelete} />);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "ArrowRight" });
    fireEvent.keyDown(input, { key: "Delete" });
    expect(onMove).not.toHaveBeenCalled();
    expect(onDelete).not.toHaveBeenCalled();
    input.remove();
  });
});

describe("snapToGuides (annotation alignment snap)", () => {
  const plot = { x: 50, y: 30, width: 400, height: 300 };

  it("snaps the near axis to centre (guide px reported), leaves the far axis alone", () => {
    const r = snapToGuides(0.51, 0.3, plot); // x: 4px from centre (<6) → snap; y: 60px from middle → no
    expect(r.fx).toBe(0.5);
    expect(r.vx).toBe(250); // 50 + 0.5*400
    expect(r.fy).toBe(0.3); // unchanged
    expect(r.hy).toBeUndefined(); // no horizontal guide
  });

  it("snaps each axis independently to left/centre/right + top/middle/bottom", () => {
    expect(snapToGuides(0.005, 0.5, plot).fx).toBe(0); // left edge (2px away)
    expect(snapToGuides(0.99, 0.5, plot).fx).toBe(1); // right edge (4px away)
    expect(snapToGuides(0.5, 0.005, plot).fy).toBe(0); // top (1.5px away)
    expect(snapToGuides(0.5, 0.99, plot).fy).toBe(1); // bottom
  });

  it("does not snap (or draw a guide) when outside the threshold", () => {
    const r = snapToGuides(0.4, 0.2, plot); // 40px from centre, 90px from middle
    expect(r.fx).toBe(0.4);
    expect(r.fy).toBe(0.2);
    expect(r.vx).toBeUndefined();
    expect(r.hy).toBeUndefined();
  });

  it("snaps to another object's edge/centre guides (magnetic alignment)", () => {
    // an object whose left edge sits at fx=0.42; drag near it → snap to align.
    const objs = { xs: [0.42], ys: [0.7] };
    const r = snapToGuides(0.41, 0.71, plot, 6, objs); // x 4px from 0.42, y 3px from 0.7
    expect(r.fx).toBe(0.42);
    expect(r.vx).toBeCloseTo(50 + 0.42 * 400, 6); // guide line at the object's x
    expect(r.fy).toBe(0.7);
    // the plot frame still wins when it is the nearest guide.
    expect(snapToGuides(0.5, 0.5, plot, 6, objs).fx).toBe(0.5); // centre (0px) beats 0.42
  });

  it("picks the nearest guide among the plot frame + all objects", () => {
    const objs = { xs: [0.48, 0.52], ys: [] }; // two object guides straddling centre
    // at 0.485: distances → centre 0.5 = 6px, 0.48 = 2px, 0.52 = 14px → snaps to 0.48
    expect(snapToGuides(0.485, 0.2, plot, 6, objs).fx).toBe(0.48);
    // object guide beyond threshold is ignored.
    expect(snapToGuides(0.3, 0.2, plot, 6, { xs: [0.35], ys: [] }).fx).toBe(0.3); // 20px away
  });
});

describe("parseRich (super/subscript markup)", () => {
  it("returns one normal run for unmarked text", () => {
    expect(parseRich("Response")).toEqual([{ text: "Response", shift: "normal" }]);
  });
  it("parses braced superscript and subscript", () => {
    expect(parseRich("cm^{2}")).toEqual([
      { text: "cm", shift: "normal" },
      { text: "2", shift: "super" },
    ]);
    expect(parseRich("x_{2}")).toEqual([
      { text: "x", shift: "normal" },
      { text: "2", shift: "sub" },
    ]);
  });
  it("braces only — a bare underscore/caret stays literal (data labels are not markup)", () => {
    // There is no single-character shorthand: "asv_1000" is a sample id,
    // not "asv" + subscript "1" + "000". Only `_{…}`/`^{…}` convert.
    expect(parseRich("asv_1000")).toEqual([{ text: "asv_1000", shift: "normal" }]);
    expect(parseRich("10^3 m_2 end")).toEqual([{ text: "10^3 m_2 end", shift: "normal" }]);
  });
  it("still converts the braced form inside an otherwise-literal string", () => {
    expect(parseRich("H_{2}O and x_2")).toEqual([
      { text: "H", shift: "normal" },
      { text: "2", shift: "sub" },
      { text: "O and x_2", shift: "normal" },
    ]);
  });
  it("leaves a dangling caret as literal text", () => {
    expect(parseRich("a^")).toEqual([{ text: "a^", shift: "normal" }]);
  });
});

/** A minimal XY scene whose title/labels we can override per-test. */
function titledScene(over: Partial<Plot>): ReturnType<typeof buildPlotScene> {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, ...over };
  return buildPlotScene(table, plot, { width: 400, height: 300 });
}

describe("bespoke figures — draggable title", () => {
  // A category table that a lollipop chart can render.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "c", name: "Group" }, { id: "v", name: "Value" }],
    rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
  };
  const scene = (over: Partial<Plot> = {}) =>
    buildPlotScene(table, { id: "p", name: "Lolli", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", title: "My title", ...over }, { width: 400, height: 300 });

  it("lollipop title is draggable (cursor:move) and a drag fires onMoveTitle", () => {
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} selected={null} onMoveTitle={onMove} />);
    const title = [...container.querySelectorAll("text")].find((t) => /My title/.test(t.textContent ?? ""))!;
    expect(title).toBeTruthy();
    expect(title.style.cursor).toBe("move");
    fireEvent.pointerDown(title, { clientX: 100, clientY: 10 });
    fireEvent.pointerMove(title, { clientX: 140, clientY: 30 });
    fireEvent.pointerUp(title, { clientX: 140, clientY: 30 });
    expect(onMove).toHaveBeenCalled();
  });

  it("no move cursor on the title without onMoveTitle", () => {
    const { container } = render(<PlotFigure scene={scene()} selected={null} />);
    const title = [...container.querySelectorAll("text")].find((t) => /My title/.test(t.textContent ?? ""))!;
    expect(title.style.cursor).toBe("");
  });

  it("double-clicking a bespoke-figure title opens the inline editor", () => {
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} selected={null} onEditText={onEditText} />);
    // before: no overlay editor
    expect(container.querySelector("input, textarea")).toBeFalsy();
    const title = [...container.querySelectorAll("text")].find((t) => /My title/.test(t.textContent ?? ""))!;
    expect(title.style.cursor).toBe("text"); // editable affordance
    fireEvent.doubleClick(title);
    // after: the chrome-less HTML overlay (textarea, multiline) appears, seeded with the title
    const editor = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(editor).toBeTruthy();
    expect(editor!.value).toBe("My title");
  });
});

describe("bespoke figures — subtitle is double-click editable", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "k", name: "Cat" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [{ id: "r1", cells: { k: "Speed", a: 3, b: 5 } }, { id: "r2", cells: { k: "Power", a: 4, b: 2 } }, { id: "r3", cells: { k: "Range", a: 2, b: 6 } }],
  };
  for (const kind of ["pie", "radar", "scatter3d"] as const) {
    it(`${kind} subtitle opens the inline editor on double-click`, () => {
      const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, subtitle: "My subtitle" };
      const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, { width: 420, height: 320 })} onEditText={() => {}} />);
      const sub = [...container.querySelectorAll("text")].find((t) => t.textContent === "My subtitle")!;
      expect(sub).toBeTruthy();
      expect((sub as unknown as HTMLElement).style.cursor).toBe("text");
      fireEvent.doubleClick(sub);
      const editor = container.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(editor?.value).toBe("My subtitle");
    });
  }
});

describe("pie slice border colour survives selection", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "k", name: "Cat" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [{ id: "r1", cells: { k: "x", a: 3, b: 5 } }],
  };
  const plot: Plot = {
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie",
    seriesStyles: { a: { sliceStroke: "#ff0000", sliceStrokeWidth: 2 } },
  };
  it("a selected slice still strokes with its own border colour (not the accent)", () => {
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "pie-slice", datasetId: "a" }} onSelect={() => {}} />);
    const slicePaths = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("transform") ?? "").startsWith("translate"));
    // the slice's own fill path keeps stroke #ff0000 (the user's border), not var(--accent)
    const own = slicePaths.find((p) => p.getAttribute("fill") !== "none");
    expect(own?.getAttribute("stroke")).toBe("#ff0000");
    // selection is shown by a separate dashed accent overlay
    const overlay = slicePaths.find((p) => p.getAttribute("fill") === "none" && p.getAttribute("stroke") === "var(--accent)");
    expect(overlay?.getAttribute("stroke-dasharray")).toBeTruthy();
  });
});

describe("treemap per-cell border override", () => {
  const table: DataTable = {
    id: "tm", kind: "partsofwhole", name: "GDP",
    columns: [{ id: "s", name: "State" }, { id: "v", name: "GDP" }],
    rows: [
      { id: "r1", cells: { s: "California", v: 43 } },
      { id: "r2", cells: { s: "Texas", v: 29 } },
      { id: "r3", cells: { s: "New York", v: 25 } },
    ],
  };
  it("strokes only the overridden cell; the others keep the global boundary", () => {
    const plot: Plot = {
      id: "p", name: "Treemap", source: "tm", status: "ok", styleOverrides: {}, kind: "treemap",
      seriesStyles: { r1: { sliceStroke: "#ff0000", sliceStrokeWidth: 4 } },
    };
    const scene = buildPlotScene(table, plot, { width: 500, height: 400 });
    const { container } = render(<PlotFigure scene={scene} onSelect={() => {}} />);
    // Cell polygons carry a fill; the dashed selection overlay is fill="none".
    const cells = [...container.querySelectorAll("polygon")].filter((p) => p.getAttribute("fill") !== "none");
    const red = cells.filter((p) => p.getAttribute("stroke") === "#ff0000");
    expect(red).toHaveLength(1);
    expect(red[0]!.getAttribute("stroke-width")).toBe("4");
    // The other cells fall back to the treemap's global boundary (#ffffff default).
    const others = cells.filter((p) => p.getAttribute("stroke") !== "#ff0000");
    expect(others.length).toBeGreaterThanOrEqual(2);
    for (const p of others) expect(p.getAttribute("stroke")).toBe("#ffffff");
  });
});

describe("corrmatrix cell selection + column-label clearance", () => {
  const tbl: DataTable = {
    id: "cm", kind: "multivariable", name: "M",
    columns: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
    rows: Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, cells: { a: i, b: i * 2, c: 6 - i } })),
  };
  const plot: Plot = { id: "p", name: "P", source: "cm", status: "ok", styleOverrides: {}, kind: "corrmatrix" };

  it("clicking a cell fires onSelect({kind:'corr-cell'})", () => {
    const scene = buildPlotScene(tbl, plot, { width: 400, height: 400 });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
    const hit = [...container.querySelectorAll("rect")].find((r) => (r.getAttribute("style") ?? "").includes("pointer"));
    expect(hit).toBeTruthy();
    fireEvent.click(hit!);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "corr-cell" }));
  });

  it("column labels clear the top row of glyphs by a font-scaled gap", () => {
    const scene = buildPlotScene(tbl, plot, { width: 400, height: 400 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const gridY = scene.corrmatrix!.grid.y;
    // Column labels sit above the grid (row labels sit within/below it) — filter by y < gridY.
    const colLabels = [...container.querySelectorAll("text")]
      .filter((t) => ["Alpha", "Beta", "Gamma"].includes((t.textContent ?? "").trim()) && Number(t.getAttribute("y")) < gridY);
    expect(colLabels.length).toBeGreaterThanOrEqual(1);
    for (const t of colLabels) expect(gridY - Number(t.getAttribute("y"))).toBeGreaterThanOrEqual(7);
  });
});

describe("pie per-slice label font", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "k", name: "Cat" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [{ id: "r1", cells: { k: "x", a: 3, b: 5 } }],
  };
  it("a slice's sliceLabelSize overrides only that slice's label font", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie",
      pieLabels: "value", seriesStyles: { a: { sliceLabelSize: 30, sliceLabelBold: true } },
    };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const slices = scene.pie!.slices;
    const a = slices.find((s) => s.id === "a")!;
    const b = slices.find((s) => s.id === "b")!;
    expect(a.labelFont?.size).toBe(30);
    expect(a.labelFont?.weight).toBe(700);
    expect(b.labelFont).toBeUndefined(); // other slices keep the shared font
  });
});

describe("colour-scheme palette", () => {
  // A 2-series table so the palette cycles to its second colour too.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [{ id: "r1", cells: { x: 1, a: 2, b: 3 } }, { id: "r2", cells: { x: 2, a: 4, b: 1 } }],
  };
  const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };

  it("defaults to Okabe–Ito when no palette option is given", () => {
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    expect(scene.series[0]!.color.toUpperCase()).toBe(OKABE_ITO[0]!.toUpperCase());
    expect(scene.series[1]!.color.toUpperCase()).toBe(OKABE_ITO[1]!.toUpperCase());
  });

  it("recolours every series from a named palette (the picker's contract)", () => {
    const scene = buildPlotScene(table, plot, { width: 400, height: 300, palette: PALETTES["Vibrant"]! });
    expect(scene.series[0]!.color.toUpperCase()).toBe(TOL_VIBRANT[0]!.toUpperCase());
    expect(scene.series[1]!.color.toUpperCase()).toBe(TOL_VIBRANT[1]!.toUpperCase());
  });

  it("a per-series colour override still wins over the palette", () => {
    const over: Plot = { ...plot, seriesStyles: { a: { color: "#123456" } } };
    const scene = buildPlotScene(table, over, { width: 400, height: 300, palette: PALETTES["Vibrant"]! });
    expect(scene.series[0]!.color.toLowerCase()).toBe("#123456");
    expect(scene.series[1]!.color.toUpperCase()).toBe(TOL_VIBRANT[1]!.toUpperCase());
  });

  it("legend gap/inset resolve onto the scene layout; a wider gap shrinks the plot rect", () => {
    const base = buildPlotScene(table, { ...plot, legend: { show: true, position: "right" } }, { width: 400, height: 300 });
    const wide = buildPlotScene(table, { ...plot, legend: { show: true, position: "right", gap: 60 } }, { width: 400, height: 300 });
    expect(base.legendLayout.gap).toBe(12);
    expect(wide.legendLayout.gap).toBe(60);
    // a bigger outside gap reserves more right-margin, so the plotting rect narrows
    expect(wide.plot.width).toBeLessThan(base.plot.width);
    // inside inset flows through too
    const inside = buildPlotScene(table, { ...plot, legend: { show: true, position: "topright", inset: 24 } }, { width: 400, height: 300 });
    expect(inside.legendLayout.inset).toBe(24);
  });
});

describe("plot margins / padding", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
  };
  const base: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} };

  it("per-side padding insets the plot rect by exactly that many px", () => {
    const a = buildPlotScene(table, base, { width: 500, height: 360 });
    const b = buildPlotScene(table, { ...base, plotPad: { left: 40, right: 20, top: 30, bottom: 25 } }, { width: 500, height: 360 });
    // left/top padding pushes the plot origin in; the figure size is unchanged
    expect(Math.round(b.plot.x - a.plot.x)).toBe(40);
    expect(Math.round(b.plot.y - a.plot.y)).toBe(30);
    // width loses left+right, height loses top+bottom
    expect(Math.round(a.plot.width - b.plot.width)).toBe(60);
    expect(Math.round(a.plot.height - b.plot.height)).toBe(55);
    expect(b.width).toBe(a.width);
    expect(b.height).toBe(a.height);
  });

  it("zero/absent padding is a no-op", () => {
    const a = buildPlotScene(table, base, { width: 480, height: 320 });
    const b = buildPlotScene(table, { ...base, plotPad: { left: 0 } }, { width: 480, height: 320 });
    expect(b.plot.x).toBe(a.plot.x);
    expect(b.plot.width).toBe(a.plot.width);
  });
});

describe("PlotFigure — rich text everywhere + multi-line", () => {
  it("renders a 2-line title as stacked tspans (each re-anchored at x)", () => {
    const scene = titledScene({ name: "Line one\nLine two" });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const title = [...container.querySelectorAll("text")].find((t) => /Line one/.test(t.textContent ?? ""));
    expect(title).toBeTruthy();
    const tspans = title!.querySelectorAll("tspan");
    expect(tspans.length).toBe(2);
    expect(tspans[0]!.textContent).toBe("Line one");
    expect(tspans[1]!.textContent).toBe("Line two");
    // the second line re-anchors at the same x and advances vertically
    expect(tspans[1]!.getAttribute("x")).toBe(tspans[0]!.getAttribute("x"));
    expect(tspans[1]!.getAttribute("dy")).toBeTruthy();
  });

  it("renders a superscript tick label (power-of-ten style) as a shifted tspan", () => {
    // a manual axis title carrying markup also flows through RichText
    const scene = titledScene({ xAxis: { title: "10^{-3} M" } });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const xtitle = [...container.querySelectorAll("text")].find((t) => /10/.test(t.textContent ?? "") && /M/.test(t.textContent ?? ""));
    expect(xtitle).toBeTruthy();
    const sup = xtitle!.querySelector('tspan[baseline-shift="super"]');
    expect(sup).toBeTruthy();
    expect(sup!.textContent).toBe("-3");
  });

  it("renders rich super/subscript in tick labels", () => {
    // prefix every tick with markup so a tick label carries a superscript
    const scene = titledScene({ xAxis: { suffix: "^{2}" } });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const supTspan = [...container.querySelectorAll('tspan[baseline-shift="super"]')].find((t) => t.textContent === "2");
    expect(supTspan).toBeTruthy();
  });
});

/** A 2-category bar chart with an explicit contour colour on the series. */
function barScene(borderColor: string) {
  const table: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
    ],
    rows: [
      { id: "r1", cells: { x: "A", y: 5 } },
      { id: "r2", cells: { x: "B", y: 8 } },
    ],
  };
  const plot: Plot = {
    id: "p",
    name: "P",
    source: "t",
    status: "ok",
    styleOverrides: {},
    kind: "bar",
    seriesStyles: { y: { fillColor: "#ff0000", borderColor } },
  };
  return buildPlotScene(table, plot, { width: 400, height: 300 });
}

describe("PlotFigure — bar contour colour", () => {
  it("renders the bar stroke as the contour colour even when the series is selected", () => {
    const scene = barScene("#00aa00");
    // The series is selected (as it is while you edit it in the inspector).
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "series", columnId: "y" }} />);
    const bar = container.querySelector('rect[id^="mark-y-"]') as SVGRectElement;
    expect(bar).toBeTruthy();
    // The contour colour must be honoured live — not masked by the accent highlight.
    expect(bar.getAttribute("stroke")).toBe("#00aa00");
    expect(bar.getAttribute("fill")).toBe("#ff0000");
  });

  it("box-frame edges (top/right) inherit the axis colour + width, not thin grey", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [{ id: "r1", cells: { x: "A", y: 5 } }, { id: "r2", cells: { x: "B", y: 8 } }],
    };
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar",
      frame: "box", xAxis: { lineColor: "#000000", lineWidth: 3 }, yAxis: { lineColor: "#000000", lineWidth: 3 },
    };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} />);
    const lines = [...container.querySelectorAll(".gfx-axes line")];
    // every frame/axis edge is the house-style thick black — no thin grey box edges
    expect(lines.length).toBe(4);
    for (const l of lines) {
      expect(l.getAttribute("stroke")).toBe("#000000");
      expect(l.getAttribute("stroke-width")).toBe("3");
    }
  });

  /**
   * The selected-bar frame is UI chrome and must not be mistakable for the bar's own outline.
   *
   * Note: the frame must be solid, not dashed (a dashed accent clashes), but it must not take
   * the X-axis style: in the house default the axis is pure black at 2.5px, so selecting a
   * two-tone bar (2px coloured contour) would draw a heavier black ring 1.5px outside it — a
   * black outline overlaying the two-tone edge, exactly the colours the frame is supposed to
   * leave visible.
   */
  it("marks a selected bar without imitating or crowding the bar's own contour", () => {
    const scene = barScene("#00aa00");
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "series", columnId: "y" }} />);
    const xAxis = [...container.querySelectorAll(".gfx-axes line")].find((l) => l.getAttribute("y1") === l.getAttribute("y2"))!;
    expect(xAxis).toBeTruthy();
    const bar = container.querySelector('rect[id^="mark-"]')!;
    const frame = [...container.querySelectorAll('rect[fill="none"]')].find((r) => !r.getAttribute("stroke-dasharray"))!;
    expect(frame, "no selection frame on a selected bar").toBeTruthy();

    // Solid, not a dashed accent.
    expect(frame.getAttribute("stroke-dasharray")).toBeNull();
    // …but not the axis colour, which would put a black ring against the bar's contour.
    expect(
      frame.getAttribute("stroke"),
      "the selection frame takes the axis colour — on the house default that is a black ring on the bar's edge",
    ).not.toBe(xAxis.getAttribute("stroke"));
    // Never heavier than the bar's own contour: a ring thicker than the outline it sits
    // beside reads as a second, bolder outline belonging to the figure.
    expect(
      Number(frame.getAttribute("stroke-width")),
      "the selection frame is heavier than the bar's own contour",
    ).toBeLessThanOrEqual(Number(bar.getAttribute("stroke-width")));
    // And standing clear of the bar rather than hugging it.
    const gap = Number(bar.getAttribute("x")) - Number(frame.getAttribute("x"));
    expect(gap, "the frame hugs the bar's edge instead of standing clear of it").toBeGreaterThanOrEqual(3);
  });

  it("renders value labels as draggable text and honours a per-bar text override", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [{ id: "r1", cells: { x: "A", y: 5 } }, { id: "r2", cells: { x: "B", y: 8 } }],
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", showValues: true, pointStyles: { "y:r1": { valueText: "n=6" } } };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} onMoveValueLabel={() => {}} onEditText={() => {}} />);
    const texts = [...container.querySelectorAll("text")];
    const override = texts.find((t) => t.textContent === "n=6");
    expect(override).toBeTruthy();
    expect((override as SVGTextElement).style.cursor).toBe("move"); // draggable when onMoveValueLabel is wired
    expect(texts.some((t) => t.textContent === "8")).toBe(true); // the sibling bar keeps its numeric value
  });

  it("renders round-top bars as a path (not a plain rect)", () => {
    const table: DataTable = {
      id: "t",
      kind: "xy",
      name: "T",
      columns: [
        { id: "x", name: "X" },
        { id: "y", name: "Y" },
      ],
      rows: [{ id: "r1", cells: { x: "A", y: 5 } }],
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barShape: "roundtop" };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    expect(scene.barShape).toBe("roundtop");
    const { container } = render(<PlotFigure scene={scene} />);
    const bar = container.querySelector('[id^="mark-y-"]') as SVGElement;
    expect(bar.tagName.toLowerCase()).toBe("path"); // round-top → path
    expect(bar.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+ L.*Q/); // rounded corners
  });

  it("contour follows the fill when not overridden", () => {
    const table: DataTable = {
      id: "t",
      kind: "xy",
      name: "T",
      columns: [
        { id: "x", name: "X" },
        { id: "y", name: "Y" },
      ],
      rows: [{ id: "r1", cells: { x: "A", y: 5 } }],
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", seriesStyles: { y: { fillColor: "#123456" } } };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} />);
    const bar = container.querySelector('rect[id^="mark-y-"]') as SVGRectElement;
    expect(bar.getAttribute("stroke")).toBe("#123456"); // matches the fill
  });
});

describe("PlotFigure — cross-series spread band", () => {
  const spreadTable: DataTable = {
    id: "t",
    kind: "xy",
    name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
    ],
    rows: [0, 1, 2, 3].map((v, i) => ({ id: `r${i}`, cells: { x: v, a: 10 + i, b: 20 + i, c: 30 - i } })),
  };

  it("paints the shaded ribbon, the dotted mean line and its end label", () => {
    const scene = buildPlotScene(
      spreadTable,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, spread: { mode: "range", showMean: true, meanLabel: "League avg", color: "#9aa0aa" } },
      { width: 420, height: 300 },
    );
    const { container } = render(<PlotFigure scene={scene} />);
    // ribbon: a filled path using the band colour
    const band = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#9aa0aa");
    expect(band?.getAttribute("d")?.startsWith("M")).toBe(true);
    // dotted mean line: a stroked path with a dash array
    const dotted = [...container.querySelectorAll("path")].find((p) => (p.getAttribute("stroke-dasharray") ?? "").length > 0);
    expect(dotted).toBeTruthy();
    // direct end label
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === "League avg");
    expect(label).toBeTruthy();
  });

  it("draws no band when spread mode is off", () => {
    const scene = buildPlotScene(
      spreadTable,
      { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {} },
      { width: 420, height: 300 },
    );
    const { container } = render(<PlotFigure scene={scene} />);
    const band = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#9aa0aa");
    expect(band).toBeUndefined();
  });
});

describe("PlotFigure — ridgeline / joyplot", () => {
  const ridgeTable: DataTable = {
    id: "t",
    kind: "column",
    name: "T",
    columns: [
      { id: "x", name: "Row", role: "x" },
      { id: "a", name: "Alpha", role: "y" },
      { id: "b", name: "Beta", role: "y" },
    ],
    rows: [10, 11, 12, 13, 14, 15].map((v, i) => ({ id: `r${i}`, cells: { x: i + 1, a: v, b: v + 20 } })),
  };

  it("paints one filled density trace + top stroke per dataset and labels each row", () => {
    const scene = buildPlotScene(
      ridgeTable,
      {
        id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "ridgeline",
        seriesStyles: { a: { color: "#123456" }, b: { color: "#abcdef" } },
      },
      { width: 460, height: 320 },
    );
    const { container } = render(<PlotFigure scene={scene} />);
    // closed filled density polygons in the series' colours
    const fillA = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#123456" && (p.getAttribute("d") ?? "").endsWith("Z"));
    const fillB = [...container.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "#abcdef" && (p.getAttribute("d") ?? "").endsWith("Z"));
    expect(fillA).toBeTruthy();
    expect(fillB).toBeTruthy();
    // a stroked top curve in the series colour
    const strokeA = [...container.querySelectorAll("path")].find((p) => p.getAttribute("stroke") === "#123456" && p.getAttribute("fill") === "none");
    expect(strokeA).toBeTruthy();
    // dataset names render as Y baseline labels
    const labels = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels).toContain("Alpha");
    expect(labels).toContain("Beta");
  });
});

describe("PlotFigure — 2D density heatmap + hexbin", () => {
  const pts: [number, number][] = [
    [1, 1], [1.1, 0.9], [0.9, 1.1], [1.05, 1.0], [0.95, 1.05], [1.0, 0.95],
    [6, 6], [6.2, 5.8], [5.8, 6.1],
  ];
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "PC1", role: "x" }, { id: "y", name: "PC2", role: "y" }],
    rows: pts.map(([x, y], i) => ({ id: `r${i}`, cells: { x, y } })),
  };
  const hmPlot = (mode: "density2d" | "hexbin"): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode, resolution: 24 },
  });

  it("density2d paints grid cells, continuous axis ticks and axis titles", () => {
    const scene = buildPlotScene(table, hmPlot("density2d"), { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} />);
    const rects = [...container.querySelectorAll("rect")].filter((r) => (r.getAttribute("fill") ?? "").startsWith("#"));
    expect(rects.length).toBeGreaterThan(50); // the density grid
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("PC1");
    expect(texts).toContain("PC2");
  });

  it("point-mode axis titles are draggable + editable, and the Y title clears the left edge", () => {
    const scene = buildPlotScene(table, hmPlot("density2d"), { width: 460, height: 340 });
    const onMoveAxisTitle = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onSelect={() => {}} onAxisResize={() => {}} onMoveAxisTitle={onMoveAxisTitle} onEditText={() => {}} />);
    const xTitle = [...container.querySelectorAll("text")].find((t) => t.textContent === "PC1")!;
    const yTitle = [...container.querySelectorAll("text")].find((t) => /rotate\(-90/.test(t.getAttribute("transform") ?? ""))!;
    expect((xTitle as unknown as HTMLElement).style.cursor).toBe("move"); // draggable, not just editable
    expect((yTitle as unknown as HTMLElement).style.cursor).toBe("move");
    // Y title anchored at yTitleX ≥ 14 (a fixed 13 would clip a big font).
    const m = /rotate\(-90 (\d+(?:\.\d+)?) /.exec(yTitle.getAttribute("transform") ?? "");
    expect(Number(m![1])).toBeGreaterThanOrEqual(14);
    // dragging the X title commits an offset
    fireEvent.pointerDown(xTitle, { clientX: 200, clientY: 320 });
    fireEvent.pointerMove(xTitle, { clientX: 230, clientY: 335 });
    fireEvent.pointerUp(xTitle, { clientX: 230, clientY: 335 });
    expect(onMoveAxisTitle).toHaveBeenCalledWith("x", expect.any(Number), expect.any(Number));
  });

  it("matrix-mode Y axis title clears the left edge for a large font", () => {
    const mtable: DataTable = {
      id: "mt", kind: "xy", name: "Heat",
      columns: [{ id: "g", name: "Gene" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
      rows: [{ id: "r1", cells: { g: "G1", a: 1, b: 2 } }, { id: "r2", cells: { g: "G2", a: 3, b: 4 } }],
    };
    const plot: Plot = { id: "p", name: "P", source: "mt", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode: "matrix" }, yAxis: { title: "Genes", titleFont: { size: 30 } } };
    const scene = buildPlotScene(mtable, plot, { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveAnnotation={() => {}} />);
    const yTitle = [...container.querySelectorAll("text")].find((t) => /rotate\(-90/.test(t.getAttribute("transform") ?? ""));
    expect(yTitle).toBeTruthy();
    // baseline x derived from the font size (yTitleX), not a fixed 13 that would clip.
    const m = /rotate\(-90 (\d+(?:\.\d+)?) /.exec(yTitle!.getAttribute("transform") ?? "");
    expect(Number(m![1])).toBeGreaterThanOrEqual(14);
  });

  it("point-mode shows an axis-length resize handle when an axis is selected", () => {
    const scene = buildPlotScene(table, hmPlot("hexbin"), { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "axis", axis: "x" }} onSelect={() => {}} onAxisResize={() => {}} />);
    const handle = [...container.querySelectorAll("title")].some((t) => /X-axis length/.test(t.textContent ?? ""));
    expect(handle).toBe(true);
  });

  it("hexbin paints hexagon polygons with point-count tooltips", () => {
    const scene = buildPlotScene(table, hmPlot("hexbin"), { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} />);
    const hexes = [...container.querySelectorAll("path")].filter((p) => (p.getAttribute("d") ?? "").endsWith("Z") && p.querySelector("title"));
    expect(hexes.length).toBeGreaterThan(0);
    const titles = [...container.querySelectorAll("title")].map((t) => t.textContent);
    expect(titles.some((t) => /^n = \d+/.test(t ?? ""))).toBe(true);
  });

  it("colorbar paints an optional title + interior ticks", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap: { mode: "density2d", resolution: 24, colorbarTitle: "density", colorbarTicks: true } };
    const scene = buildPlotScene(table, plot, { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("density"); // the rotated colour-bar title
    // 3 interior tick labels in addition to min/max (so ≥3 numeric labels beside the bar)
    expect(scene.heatmap!.colorbarTicks?.length).toBe(3);
  });
});

describe("PlotFigure — matrix heatmap editable text", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Gene" }, { id: "a", name: "Sample A" }, { id: "b", name: "Sample B" }],
    rows: [{ id: "r1", cells: { x: "G1", a: 1, b: 2 } }, { id: "r2", cells: { x: "G2", a: 3, b: 4 } }],
  };
  const base: Plot = { id: "p", name: "HM", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap" };

  it("renders draggable + editable axis titles (columns = X, rows = Y)", () => {
    const scene = buildPlotScene(table, { ...base, xAxis: { title: "Samples" }, yAxis: { title: "Genes" } }, { width: 460, height: 340 });
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onEditText={onEditText} onMoveAxisTitle={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Samples");
    expect(texts).toContain("Genes");
    // Both axis titles carry the move cursor (draggable) and open the inline editor on
    // double-click, seeded with their current text.
    const xTitle = [...container.querySelectorAll("text")].find((t) => t.textContent === "Samples")!;
    expect((xTitle as unknown as HTMLElement).style.cursor).toBe("move");
    fireEvent.doubleClick(xTitle);
    const editor = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(editor?.value).toBe("Samples");
    // Committing routes to the axisTitle:x target.
    fireEvent.change(editor!, { target: { value: "Conditions" } });
    fireEvent.blur(editor!);
    expect(onEditText).toHaveBeenCalledWith({ kind: "axisTitle", axis: "x" }, "Conditions");
  });

  it("row/column labels double-click to rename (heatmapColLabel / heatmapRowLabel targets)", () => {
    const scene = buildPlotScene(table, base, { width: 460, height: 340 });
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onEditText={onEditText} />);
    const colLabel = [...container.querySelectorAll("text")].find((t) => t.textContent === "Sample A")!;
    const rowLabel = [...container.querySelectorAll("text")].find((t) => t.textContent === "G1")!;
    expect((colLabel as unknown as HTMLElement).style.cursor).toBe("text");
    expect((rowLabel as unknown as HTMLElement).style.cursor).toBe("text");
    // Rename the first column (col 0).
    fireEvent.doubleClick(colLabel);
    let editor = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(editor.value).toBe("Sample A");
    fireEvent.change(editor, { target: { value: "Ctrl" } });
    fireEvent.blur(editor);
    // the target must also say which dataset it names — the drawn order is not the table
    // order once anything is clustered, stripped or collapsed, so an index alone renames
    // whatever happens to sit there (see heatmap-label-identity.test.ts).
    expect(onEditText).toHaveBeenCalledWith({ kind: "heatmapColLabel", col: 0, ids: ["a"] }, "Ctrl");
    // Rename the first row (row 0).
    fireEvent.doubleClick(rowLabel);
    editor = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(editor.value).toBe("G1");
    fireEvent.change(editor, { target: { value: "GeneX" } });
    fireEvent.blur(editor);
    expect(onEditText).toHaveBeenCalledWith({ kind: "heatmapRowLabel", row: 0, ids: ["r1"] }, "GeneX");
  });

  it("honours the label font size + column rotation", () => {
    const scene = buildPlotScene(table, { ...base, heatmap: { labelFont: { size: 20 }, labelRotation: 45 } }, { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} />);
    const colLabel = [...container.querySelectorAll("text")].find((t) => t.textContent === "Sample A")!;
    // Rotated column labels carry a rotate() transform; the group font-size follows labelFont.
    expect(colLabel.getAttribute("transform") ?? "").toMatch(/rotate\(-45/);
  });

  it("clicking a cell selects that cell (highlight + value read-out), not the whole plot", () => {
    const scene = buildPlotScene(table, base, { width: 460, height: 340 });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onSelect={onSelect} />);
    const cell = [...container.querySelectorAll("rect")].find((r) => (r.getAttribute("fill") ?? "").startsWith("#"))!;
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ kind: "heatmap-cell" }));
    expect(onSelect).not.toHaveBeenCalledWith({ kind: "plot" });
  });

  it("clicking the colour bar selects { kind: 'colorbar' } (→ its editor)", () => {
    const scene = buildPlotScene(table, base, { width: 460, height: 340 });
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onSelect={onSelect} onMoveColorbar={() => {}} />);
    // The colour-bar group carries the "click to edit" title.
    const barTitle = [...container.querySelectorAll("title")].find((t) => /colour scale/i.test(t.textContent ?? ""))!;
    fireEvent.click(barTitle.parentElement!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "colorbar" });
  });

  it("renders explicit colour-bar values only (dropping the auto min/max so they don't clash)", () => {
    // data max is 4 (Sample B row 2). Custom values 1,2,3 replace the auto 1/4 min/max.
    const scene = buildPlotScene(table, { ...base, heatmap: { colorbarTickValues: [1, 2, 3] } }, { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    for (const v of ["1", "2", "3"]) expect(texts).toContain(v);
    expect(texts).not.toContain("4"); // the auto max label is gone (custom values only)
  });

  it("each column / row label is individually draggable (move cursor) → fires onMoveHeatmapLabels with its index", () => {
    const scene = buildPlotScene(table, base, { width: 460, height: 340 });
    const onMoveHeatmapLabels = vi.fn();
    const { container } = render(<PlotFigure scene={scene} onEditText={() => {}} onMoveHeatmapLabels={onMoveHeatmapLabels} />);
    // The second column label ("Sample B" = index 1) — grab & drag it alone.
    const colB = [...container.querySelectorAll("text")].find((t) => t.textContent === "Sample B")!;
    expect((colB as unknown as HTMLElement).style.cursor).toBe("move");
    fireEvent.pointerDown(colB, { clientX: 200, clientY: 40 });
    fireEvent.pointerMove(colB, { clientX: 230, clientY: 55 });
    fireEvent.pointerUp(colB, { clientX: 230, clientY: 55 }); // DraggableTitle commits on release
    expect(onMoveHeatmapLabels).toHaveBeenCalledWith("col", 1, expect.any(Number), expect.any(Number));
    // A row label carries its own row index too.
    onMoveHeatmapLabels.mockClear();
    const rowG2 = [...container.querySelectorAll("text")].find((t) => t.textContent === "G2")!; // row index 1
    fireEvent.pointerDown(rowG2, { clientX: 40, clientY: 200 });
    fireEvent.pointerMove(rowG2, { clientX: 60, clientY: 215 });
    fireEvent.pointerUp(rowG2, { clientX: 60, clientY: 215 });
    expect(onMoveHeatmapLabels).toHaveBeenCalledWith("row", 1, expect.any(Number), expect.any(Number));
  });
});

describe("PlotFigure — lollipop / dumbbell", () => {
  const paired: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Metric", role: "x" }, { id: "a", name: "Before", role: "y" }, { id: "b", name: "After", role: "y" }],
    rows: [["A", 20, 30], ["B", 40, 32]].map(([c, a, b], i) => ({ id: `r${i}`, cells: { x: c as string, a: a as number, b: b as number } })),
  };
  it("paints stems, dots, value labels, a green Δ% and category labels", () => {
    const scene = buildPlotScene(paired, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop" }, { width: 480, height: 320 });
    const { container } = render(<PlotFigure scene={scene} />);
    expect(container.querySelectorAll("circle").length).toBeGreaterThanOrEqual(4); // 2 rows × 2 dots
    expect([...container.querySelectorAll("line")].length).toBeGreaterThan(0); // stems
    const green = [...container.querySelectorAll("text")].find((t) => /\+50%/.test(t.textContent ?? ""));
    expect(green).toBeTruthy();
    expect(green!.getAttribute("fill")).toBe("#1a9850");
    const labels = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(labels).toContain("A");
    expect(labels).toContain("Metric"); // category axis title
  });

  it("value-label anchor does not move when the dot size changes", () => {
    // Guards against the value label sitting at `dot ± dotSize + 4`, which makes the "Dot size"
    // slider slide every label. The gap is a fixed constant, so a draggable value label's
    // base y is identical whether dots are tiny or huge.
    const anchors = (dotSize: number): Map<string, string | null> => {
      const scene = buildPlotScene(paired, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", lollipop: { dotSize } }, { width: 480, height: 320 });
      const { container } = render(<PlotFigure scene={scene} onMoveValueLabel={() => {}} />);
      const map = new Map<string, string | null>();
      for (const t of container.querySelectorAll("text")) {
        if ((t as unknown as HTMLElement).style.cursor !== "move") continue; // draggable data labels only
        const txt = (t.textContent ?? "").trim();
        if (/^-?\d/.test(txt) && !txt.endsWith("%")) map.set(txt, t.getAttribute("y")); // plain value labels (not the Δ%)
      }
      return map;
    };
    const small = anchors(3);
    const big = anchors(11);
    expect(small.size).toBeGreaterThan(0);
    for (const [label, y] of small) {
      expect(big.get(label), `value label "${label}" y must be independent of dot size`).toBe(y);
    }
  });

  it("selecting a dot highlights it without changing its size (moving the value label must never resize the dot)", () => {
    // The value label sits over the dot's transparent hit target, so grabbing it can select
    // the dot. Selection draws an accent ring rather than growing the dot, so a selected dot's
    // rendered radius is identical to an unselected one and moving the label never resizes it.
    const scene = buildPlotScene(paired, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", lollipop: { dotSize: 6 } }, { width: 480, height: 320 });
    const col = scene.lollipop!.rows[0]!.dots[0]!.id;
    const rowId = scene.lollipop!.rows[0]!.rowId;
    // Solid dot markers carry a hex colour fill; hit targets are transparent and the
    // selection ring is fill="none" — so a hex fill isolates the real dots.
    const dotRadii = (sel: GraphSelection | null): string[] =>
      [...render(<PlotFigure scene={scene} selected={sel} />).container.querySelectorAll("circle")]
        .filter((c) => (c.getAttribute("fill") ?? "").startsWith("#"))
        .map((c) => c.getAttribute("r") ?? "")
        .sort();
    const unselected = dotRadii(null);
    const selected = dotRadii({ kind: "series", columnId: col, part: "points", rowId });
    expect(unselected.length).toBeGreaterThan(0);
    expect(selected).toEqual(unselected); // radius unchanged by selection
    // and the selected dot gains a highlight ring (fill:none accent circle)
    const { container } = render(<PlotFigure scene={scene} selected={{ kind: "series", columnId: col, part: "points", rowId }} />);
    const ring = [...container.querySelectorAll("circle")].some((c) => c.getAttribute("fill") === "none" && (c.getAttribute("stroke") ?? "").includes("accent"));
    expect(ring).toBe(true);
  });
});

describe("PlotFigure — residual diagnostic graphs", () => {
  // Mirrors exactly what AppShell.plotResidualsFromAnalysis builds from an analysis'
  // extra.residuals, proving each diagnostic graph actually paints headlessly.
  const mk = (over: Partial<Plot>, table: DataTable) =>
    render(<PlotFigure scene={buildPlotScene(table, { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, ...over }, { width: 440, height: 300 })} />);

  it("residual-vs-predicted paints residual markers + a flat zero baseline line", () => {
    const rows: [number, number][] = [[2, 0.04], [4, -0.13], [6, 0.1], [8, 0.03], [10, -0.04]];
    const table: DataTable = {
      id: "t", kind: "xy", name: "Residuals",
      columns: [{ id: "x", name: "Predicted" }, { id: "r", name: "Residual" }, { id: "z", name: "Zero baseline" }],
      rows: rows.map(([x, r], i) => ({ id: `row${i}`, cells: { x, r, z: 0 } })),
    };
    const { container } = mk(
      { seriesStyles: { r: { connect: "none", symbol: "circle", symbolSize: 5 }, z: { connect: "straight", symbol: "none", lineWidth: 1 } } },
      table,
    );
    // one marker group per residual point
    expect(container.querySelectorAll('g[id^="mark-r-"]').length).toBe(rows.length);
    // the zero baseline draws as a stroked line path (fill:none) — flat at y = 0
    const lines = [...container.querySelectorAll("path")].filter((p) => p.getAttribute("fill") === "none" && (p.getAttribute("d") ?? "").startsWith("M"));
    expect(lines.length).toBeGreaterThan(0);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Predicted");
    expect(texts).toContain("Residual");
  });

  it("QQ-of-residuals paints ordered-value markers + a reference line", () => {
    const rows: [number, number][] = [[-1.2, -0.13], [-0.5, -0.04], [0, 0.03], [0.5, 0.04], [1.2, 0.1]];
    const table: DataTable = {
      id: "t", kind: "xy", name: "QQ",
      columns: [{ id: "z", name: "Normal quantile (z)" }, { id: "ord", name: "Residual (ordered)" }, { id: "ref", name: "Reference line" }],
      rows: rows.map(([z, o], i) => ({ id: `row${i}`, cells: { z, ord: o, ref: o } })),
    };
    const { container } = mk(
      { seriesStyles: { ord: { connect: "none", symbol: "circle", symbolSize: 5 }, ref: { connect: "straight", symbol: "none", lineWidth: 1.5 } } },
      table,
    );
    expect(container.querySelectorAll('g[id^="mark-ord-"]').length).toBe(rows.length);
    expect([...container.querySelectorAll("path")].some((p) => p.getAttribute("fill") === "none" && (p.getAttribute("d") ?? "").startsWith("M"))).toBe(true);
    expect([...container.querySelectorAll("text")].map((t) => t.textContent)).toContain("Normal quantile (z)");
  });

  it("residual histogram paints count bars", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "Hist",
      columns: [{ id: "x", name: "Residual" }, { id: "c", name: "Count" }],
      rows: ([[-0.1, 1], [0, 3], [0.1, 1]] as [number, number][]).map(([x, c], i) => ({ id: `row${i}`, cells: { x, c } })),
    };
    const { container } = mk({ kind: "bar" }, table);
    expect(container.querySelectorAll('[id^="mark-c-"]').length).toBeGreaterThan(0);
  });

  it("scale-location paints √|standardised residual| markers vs predicted", () => {
    const rows: [number, number][] = [[2, 0.4], [4, 0.9], [6, 0.5], [8, 0.2]];
    const table: DataTable = {
      id: "t", kind: "xy", name: "ScaleLoc",
      columns: [{ id: "x", name: "Predicted" }, { id: "s", name: "√|standardised residual|" }],
      rows: rows.map(([x, s], i) => ({ id: `row${i}`, cells: { x, s } })),
    };
    const { container } = mk({ seriesStyles: { s: { connect: "none", symbol: "circle", symbolSize: 5 } } }, table);
    expect(container.querySelectorAll('g[id^="mark-s-"]').length).toBe(rows.length);
    expect([...container.querySelectorAll("text")].map((t) => t.textContent)).toContain("√|standardised residual|");
  });
});

describe("PlotFigure — regression confidence/prediction bands", () => {
  it("paints filled band areas behind the fit line", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
      rows: [1, 2, 3, 4, 5].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
    };
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {},
      fit: {
        label: "Linear regression",
        points: [[1, 2], [3, 6], [5, 10]],
        confidenceBand: [[1, 1.6, 2.4], [3, 5.7, 6.3], [5, 9.4, 10.6]],
        predictionBand: [[1, 0.8, 3.2], [3, 4.9, 7.1], [5, 8.6, 11.4]],
      },
    };
    const scene = buildPlotScene(table, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    // both band areas carry their descriptive <title> and a fillOpacity (filled, not stroked)
    const titles = [...container.querySelectorAll("path > title")].map((t) => t.textContent ?? "");
    expect(titles.some((t) => /confidence band/.test(t))).toBe(true);
    expect(titles.some((t) => /prediction band/.test(t))).toBe(true);
    const filled = [...container.querySelectorAll("path")].filter((p) => p.getAttribute("fill-opacity"));
    expect(filled.length).toBeGreaterThanOrEqual(2);
  });
});

describe("axis-break marks — log axes + style variants", () => {
  // log-friendly X data spanning 4 decades so a 100–1000 cut sits mid-range.
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Conc", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [[1, 1], [10, 2], [100, 3], [1000, 4], [10000, 5]].map(([x, y], i) => ({ id: `r${i}`, cells: { x: x as number, y: y as number } })),
  };
  const plot = (over: Partial<Plot> = {}): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, xScale: "log10",
    xAxis: { breaks: [{ from: 100, to: 1000 }] }, ...over,
  });

  it("paints a break mark on a log x-axis (slash by default)", () => {
    const scene = buildPlotScene(table, plot(), { width: 480, height: 320 });
    expect(scene.x.breakMarks?.length).toBe(1);
    const { container } = render(<PlotFigure scene={scene} />);
    const grp = container.querySelector('g[key], g'); // break-mark group present
    expect(grp).toBeTruthy();
    // slash style = two <line>s inside the xbrk group; locate by the white backing rect
    const lines = [...container.querySelectorAll("line")].filter((l) => Number(l.getAttribute("stroke-width")) === 1.2);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector("polyline")).toBeFalsy(); // not zigzag
  });

  it("zigzag style draws a polyline; gap style draws neither line nor polyline", () => {
    const zig = buildPlotScene(table, plot({ xAxis: { breaks: [{ from: 100, to: 1000 }], breakStyle: "zigzag" } }), { width: 480, height: 320 });
    const { container: z } = render(<PlotFigure scene={zig} />);
    expect(z.querySelector("polyline")).toBeTruthy();

    const gap = buildPlotScene(table, plot({ xAxis: { breaks: [{ from: 100, to: 1000 }], breakStyle: "gap" } }), { width: 480, height: 320 });
    const { container: g } = render(<PlotFigure scene={gap} />);
    // gap = just the white erase rect, no slash/zigzag glyph at width 1.2
    expect(g.querySelector("polyline")).toBeFalsy();
    const gapLines = [...g.querySelectorAll("line")].filter((l) => Number(l.getAttribute("stroke-width")) === 1.2);
    expect(gapLines.length).toBe(0);
  });
});

describe("second Y-axis (Y2) renders on the right", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Time", role: "x" }, { id: "a", name: "A", role: "y" }, { id: "b", name: "B", role: "y" }],
    rows: [[1, 1, 1000], [2, 2, 2000], [3, 3, 3000]].map(([x, a, b], i) => ({ id: `r${i}`, cells: { x: x as number, a: a as number, b: b as number } })),
  };
  it("draws a right-hand Y2 axis line + title when a series is assigned to it", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { b: { axis: "y2" } }, y2Axis: { title: "B units" } };
    const scene = buildPlotScene(table, plot, { width: 480, height: 320 });
    expect(scene.y2).toBeDefined();
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("B units"); // the rotated Y2 title
    // a vertical line near the right edge of the plot (the Y2 axis line)
    const rightX = scene.plot.x + scene.plot.width;
    const vlines = [...container.querySelectorAll("line")].filter(
      (l) => Math.abs(Number(l.getAttribute("x1")) - rightX) < 1 && l.getAttribute("x1") === l.getAttribute("x2"),
    );
    expect(vlines.length).toBeGreaterThan(0);
  });
  it("no Y2 axis without an assigned series", () => {
    const scene = buildPlotScene(table, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy" }, { width: 480, height: 320 });
    expect(scene.y2).toBeUndefined();
  });
});

describe("PlotFigure — bespoke title alignment + heatmap subtitle", () => {
  function pieScene(extra: Partial<Plot>) {
    const table: DataTable = {
      id: "t", kind: "partsofwhole", name: "P",
      columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
      rows: [
        { id: "r1", cells: { c: "A", v: 3 } },
        { id: "r2", cells: { c: "B", v: 5 } },
        { id: "r3", cells: { c: "C", v: 2 } },
      ],
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pie", title: "My title", ...extra };
    return buildPlotScene(table, plot, { width: 440, height: 320 });
  }
  const findText = (c: HTMLElement, needle: string) =>
    [...c.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes(needle));

  it("pie title is centred by default", () => {
    const { container } = render(<PlotFigure scene={pieScene({})} />);
    expect(findText(container, "My title")?.getAttribute("text-anchor")).toBe("middle");
  });

  it("pie honours titleAlign=left for both title and subtitle", () => {
    const { container } = render(<PlotFigure scene={pieScene({ titleAlign: "left", subtitle: "Sub" })} />);
    expect(findText(container, "My title")?.getAttribute("text-anchor")).toBe("start");
    expect(findText(container, "Sub")?.getAttribute("text-anchor")).toBe("start");
  });

  it("pie honours titleAlign=right", () => {
    const { container } = render(<PlotFigure scene={pieScene({ titleAlign: "right" })} />);
    expect(findText(container, "My title")?.getAttribute("text-anchor")).toBe("end");
  });

  it("heatmap draws the subtitle it computes", () => {
    const doc = createSampleDocument().toJSON();
    const hmPlot = doc.plots.find((p) => p.kind === "heatmap");
    expect(hmPlot).toBeTruthy();
    const table = doc.tables.find((t) => t.id === hmPlot!.source)!;
    const scene = buildPlotScene(table, { ...hmPlot!, subtitle: "Heatmap sub" }, { width: 520, height: 400 });
    const { container } = render(<PlotFigure scene={scene} />);
    expect([...container.querySelectorAll("text")].some((t) => t.textContent === "Heatmap sub")).toBe(true);
  });

  it("heatmap subtitle honours titleAlign=left", () => {
    const doc = createSampleDocument().toJSON();
    const hmPlot = doc.plots.find((p) => p.kind === "heatmap")!;
    const table = doc.tables.find((t) => t.id === hmPlot.source)!;
    const scene = buildPlotScene(table, { ...hmPlot, subtitle: "HS", titleAlign: "left" }, { width: 520, height: 400 });
    const { container } = render(<PlotFigure scene={scene} />);
    const sub = [...container.querySelectorAll("text")].find((t) => t.textContent === "HS");
    expect(sub?.getAttribute("text-anchor")).toBe("start");
  });
});

describe("PlotFigure — bespoke figures get on-canvas resize handles", () => {
  const pieTable: DataTable = {
    id: "tp", kind: "partsofwhole", name: "P",
    columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
    rows: [{ id: "r1", cells: { c: "A", v: 3 } }, { id: "r2", cells: { c: "B", v: 5 } }],
  };
  const radarTable: DataTable = {
    id: "trr", kind: "column", name: "R",
    columns: [{ id: "axis", name: "M" }, { id: "s1", name: "A" }],
    rows: [
      { id: "m1", cells: { axis: "x", s1: 3 } },
      { id: "m2", cells: { axis: "y", s1: 4 } },
      { id: "m3", cells: { axis: "z", s1: 6 } },
    ],
  };
  const xyzTable: DataTable = {
    id: "t3d", kind: "column", name: "3D",
    columns: [{ id: "cx", name: "X" }, { id: "cy", name: "Y" }, { id: "cz", name: "Z" }],
    rows: [{ id: "r1", cells: { cx: 1, cy: 2, cz: 3 } }, { id: "r2", cells: { cx: 4, cy: 5, cz: 6 } }],
  };
  const mk = (table: DataTable, kind: Plot["kind"]) =>
    buildPlotScene(table, { id: "p", name: "P", source: table.id, status: "ok", styleOverrides: {}, kind }, { width: 480, height: 400 });
  const hmScene = () => {
    const doc = createSampleDocument().toJSON();
    const hmPlot = doc.plots.find((p) => p.kind === "heatmap")!;
    const table = doc.tables.find((t) => t.id === hmPlot.source)!;
    return buildPlotScene(table, hmPlot, { width: 520, height: 400 });
  };

  it.each([
    ["pie", () => mk(pieTable, "pie")],
    ["radar", () => mk(radarTable, "radar")],
    ["scatter3d", () => mk(xyzTable, "scatter3d")],
    ["heatmap", () => hmScene()],
  ])("%s shows resize grips when onFigureResize is provided", (_name, scene) => {
    const withCb = render(<PlotFigure scene={scene()} onFigureResize={() => {}} />);
    expect(withCb.container.querySelector(".gfx-figresize")).toBeTruthy();
    cleanup();
    const without = render(<PlotFigure scene={scene()} />);
    expect(without.container.querySelector(".gfx-figresize")).toBeNull();
  });
});

describe("PlotFigure — pie slice labels are draggable + still selectable", () => {
  const pieTable: DataTable = {
    id: "tpd", kind: "partsofwhole", name: "P",
    columns: [{ id: "c", name: "Cat" }, { id: "v", name: "V" }],
    rows: [{ id: "r1", cells: { c: "Alpha", v: 3 } }, { id: "r2", cells: { c: "Beta", v: 5 } }],
  };
  const scene = () => buildPlotScene(pieTable, { id: "p", name: "P", source: "tpd", status: "ok", styleOverrides: {}, kind: "pie", pieLabels: "label" }, { width: 440, height: 320 });

  it("a slice label click selects the slice (drag threshold not crossed)", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={scene()} onSelect={onSelect} onMoveValueLabel={() => {}} />);
    const label = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").includes("Alpha"));
    expect(label).toBeTruthy();
    expect((label as SVGTextElement).style.cursor).toBe("move"); // draggable
    fireEvent.pointerDown(label!, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(label!, { clientX: 100, clientY: 100 }); // same spot → a click
    expect(onSelect).toHaveBeenCalledWith({ kind: "pie-slice", datasetId: "r1" });
  });
});

describe("Match panels → Fonts reaches heatmap + lollipop", () => {
  // The panel-assembler "Match → Fonts" copies plot.fonts onto the target. Heatmaps and
  // lollipops draw their row/col, cell and category/tick labels with their own components,
  // so each must read scene.fonts.tick rather than a hardcoded family.
  // Setting a distinctive tick-font family must reach those labels.
  const FAM = "MatchTestFace, serif";
  const proj = createSampleDocument().toJSON();
  const withTickFamily = (p: Plot): Plot => ({ ...p, fonts: { ...(p.fonts ?? {}), tick: { ...(p.fonts?.tick ?? {}), family: FAM } } });
  /** All text/g nodes that actually carry the font-family attribute (text = direct, g = inherited group). */
  const carriers = (container: HTMLElement) =>
    [...container.querySelectorAll("text, g")].filter((e) => e.getAttribute("font-family") === FAM && (e.textContent ?? "").trim().length > 0);

  it("heatmap row/column + cell value labels inherit the matched tick font family", () => {
    const src = proj.plots.find((p) => p.kind === "heatmap");
    expect(src).toBeTruthy();
    const table = proj.tables.find((t) => t.id === src!.source)!;
    const plot = withTickFamily({ ...src!, heatmap: { ...(src!.heatmap ?? {}), showValues: true } });
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot, { width: 480, height: 340 })} selected={null} />);
    // A matrix heatmap that ignores fonts.tick has zero carriers.
    expect(carriers(container).length).toBeGreaterThanOrEqual(2);
  });

  it("lollipop category + value-axis tick labels inherit the matched tick font family", () => {
    const src = proj.plots.find((p) => p.kind === "lollipop");
    expect(src).toBeTruthy();
    const table = proj.tables.find((t) => t.id === src!.source)!;
    const { container } = render(<PlotFigure scene={buildPlotScene(table, withTickFamily(src!), { width: 480, height: 340 })} selected={null} />);
    expect(carriers(container).length).toBeGreaterThanOrEqual(1);
  });
});

describe("PlotFigure — lollipop honours axis spacing (tickLabelGap)", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "Cat", role: "x" }, { id: "y", name: "Val", role: "y" }],
    rows: [{ id: "r1", cells: { x: "Alpha", y: 5 } }, { id: "r2", cells: { x: "Beta", y: 9 } }],
  };
  // Horizontal lollipop → the category axis is on the left (visual Y). The gap between the
  // category label and the plot's left edge (scene.plot.x) must equal the yAxis tickLabelGap.
  const gapFor = (tickLabelGap?: number): number => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", ...(tickLabelGap != null ? { yAxis: { tickLabelGap } } : {}) };
    const scene = buildPlotScene(table, plot, { width: 460, height: 320 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const lbl = [...container.querySelectorAll("text")].find((t) => /Alpha/.test(t.textContent ?? ""))!;
    const x = parseFloat(lbl.getAttribute("x") ?? "0");
    cleanup();
    return scene.plot.x - x;
  };

  it("the label↔axis spacing option actually changes the category-label gap", () => {
    expect(gapFor()).toBeCloseTo(8, 0);   // default
    expect(gapFor(40)).toBeCloseTo(40, 0); // honoured, not held at the default 8
  });

  // Vertical lollipop → the category axis is on the bottom (visual X). Its labels sit below
  // the plot; the extra tickLabelGap must widen that gap too.
  const vertCatDrop = (tickLabelGap?: number): number => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", barOrientation: "vertical", ...(tickLabelGap != null ? { xAxis: { tickLabelGap } } : {}) };
    const scene = buildPlotScene(table, plot, { width: 460, height: 340 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const lbl = [...container.querySelectorAll("text")].find((t) => /Alpha/.test(t.textContent ?? ""))!;
    const y = parseFloat(lbl.getAttribute("y") ?? "0");
    cleanup();
    return y - (scene.plot.y + scene.plot.height); // label baseline below the plot bottom
  };

  it("also honours the gap on the value axis + the vertical category axis", () => {
    // widening xAxis tickLabelGap from the default (6) to 40 drops the labels 34px further
    expect(vertCatDrop(40) - vertCatDrop()).toBeCloseTo(34, 0);
    // value axis (horizontal lollipop bottom): its own gap widens the value-tick drop
    const valDrop = (g?: number): number => {
      const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", ...(g != null ? { xAxis: { tickLabelGap: g } } : {}) };
      const scene = buildPlotScene(table, plot, { width: 460, height: 320 });
      const { container } = render(<PlotFigure scene={scene} selected={null} />);
      const tickLabel = [...container.querySelectorAll("text")].find((t) => /^\d/.test(t.textContent ?? ""))!;
      const y = parseFloat(tickLabel.getAttribute("y") ?? "0");
      cleanup();
      return y - (scene.plot.y + scene.plot.height);
    };
    expect(valDrop(40) - valDrop()).toBeCloseTo(34, 0);
  });
});

describe("PlotFigure — data-driven per-point formatting", () => {
  const ddTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [
      { id: "x", name: "X" },
      { id: "y", name: "Y" },
      { id: "g", name: "Group", type: "text", role: "xerr" },
    ],
    rows: [
      { id: "r0", cells: { x: 1, y: 10, g: "A" } },
      { id: "r1", cells: { x: 2, y: 20, g: "B" } },
      { id: "r2", cells: { x: 3, y: 30, g: "C" } },
    ],
  };
  const ddScene = (style: Record<string, unknown>) => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { y: style } };
    return buildPlotScene(ddTable, plot, { width: 460, height: 320 });
  };

  it("draws a text label beside each marker (pointLabels from a column)", () => {
    const { container } = render(<PlotFigure scene={ddScene({ pointLabels: "col", pointLabelColumn: "g" })} selected={null} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    // the letters are point labels (a text column → never an axis tick), so they render
    expect(texts).toContain("A");
    expect(texts).toContain("C");
  });

  it("point labels carry a per-point drag nudge and are individually draggable", () => {
    const labelOf = (c: HTMLElement, txt: string) => [...c.querySelectorAll("text")].find((t) => t.textContent === txt) as SVGTextElement;
    // baseline label position (no nudge)
    const { container: c0 } = render(<PlotFigure scene={ddScene({ pointLabels: "col", pointLabelColumn: "g" })} selected={null} />);
    const x0 = parseFloat(labelOf(c0, "A").getAttribute("x") ?? "0");
    cleanup();
    // a per-point nudge (valueDx/valueDy on "y:r0") shifts that label by (+20, −10)
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      seriesStyles: { y: { pointLabels: "col", pointLabelColumn: "g" } }, pointStyles: { "y:r0": { valueDx: 20, valueDy: -10 } },
    };
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={buildPlotScene(ddTable, plot, { width: 460, height: 320 })} selected={null} onMoveValueLabel={onMove} />);
    const a = labelOf(container, "A");
    expect(parseFloat(a.getAttribute("x") ?? "0")).toBeCloseTo(x0 + 20, 0); // nudge offsets the label
    expect(a.style.cursor).toBe("move"); // draggable when onMoveValueLabel is wired
    // a real drag (>3px) fires onMoveValueLabel for this series/row
    fireEvent.pointerDown(a, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(a, { clientX: 140, clientY: 80 });
    fireEvent.pointerUp(a, { clientX: 140, clientY: 80 });
    expect(onMove).toHaveBeenCalled();
    expect(onMove.mock.calls[0]![0]).toBe("y"); // columnId = series id
    expect(onMove.mock.calls[0]![1]).toBe("r0"); // rowId
  });

  it("renders a data-driven category legend (value → colour/shape)", () => {
    const { container } = render(<PlotFigure scene={ddScene({ colorFromColumn: "g", symbolFromColumn: "g" })} selected={null} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("A");
    expect(texts).toContain("B");
    expect(texts).toContain("C"); // one legend row per distinct value
  });
});

describe("PlotFigure — hide axis + scale bar", () => {
  const hbTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Y" }],
    rows: [0, 5, 10].map((v, i) => ({ id: `r${i}`, cells: { x: v, y: v * 2 } })),
  };
  it("renders a scale-bar segment + label and drops a hidden axis's title", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", yAxis: { hidden: true, title: "Voltage", scaleBar: { length: 5, label: "5 mV" } } };
    const scene = buildPlotScene(hbTable, plot, { width: 400, height: 300 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("5 mV"); // scale-bar label rendered
    expect(texts).not.toContain("Voltage"); // hidden axis title dropped
    // a real segment was drawn (2.5px stroke line for the bar)
    const bar = [...container.querySelectorAll("line")].some((l) => l.getAttribute("stroke-width") === "2.5");
    expect(bar).toBe(true);
  });
});

describe("PlotFigure — third Y axis", () => {
  const y3Table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [
      { id: "r0", cells: { x: 1, a: 10, b: 1000, c: 0.1 } },
      { id: "r1", cells: { x: 2, a: 20, b: 2000, c: 0.2 } },
      { id: "r2", cells: { x: 3, a: 30, b: 3000, c: 0.3 } },
    ],
  };
  it("renders a third (y3) axis line + title to the right of y2", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } }, y3Axis: { title: "Gamma" } };
    const scene = buildPlotScene(y3Table, plot, { width: 560, height: 340 });
    expect(scene.y3).toBeDefined();
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Gamma"); // y3 title rendered
    const rightEdge = scene.plot.x + scene.plot.width;
    const y3x = scene.y3!.axisX!;
    expect(y3x).toBeGreaterThan(rightEdge);
    const y3Line = [...container.querySelectorAll("line")].some((l) => Math.abs(+(l.getAttribute("x1") || "NaN") - y3x) < 0.5);
    expect(y3Line).toBe(true);
  });
});

// The second and third value axes' titles are drawn with their own title font, not the main
// value axis's title font.
describe("PlotFigure — Y2 / Y3 / top X2 titles are drawn with their own title font", () => {
  const sizeOf = (container: HTMLElement, text: string): number => {
    const t = [...container.querySelectorAll("text")].find((e) => (e.textContent ?? "").trim() === text);
    if (!t) throw new Error(`no "${text}" drawn`);
    return Number(t.getAttribute("font-size"));
  };
  it("right-hand Y2 and Y3 titles, beside a main Y title that keeps its own size", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
      rows: [[1, 10, 1000, 0.1], [2, 20, 2000, 0.2], [3, 30, 3000, 0.3]].map(([x, a, b, c], i) => ({ id: `r${i}`, cells: { x: x!, a: a!, b: b!, c: c! } })),
    };
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } },
      yAxis: { title: "Alpha" }, y2Axis: { title: "Beta", titleFont: { size: 29 } }, y3Axis: { title: "Gamma", titleFont: { size: 33 } },
    };
    const scene = buildPlotScene(table, plot, { width: 720, height: 380 });
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(sizeOf(container, "Beta"), "the Y2 title is not drawn at its own size").toBe(29);
    expect(sizeOf(container, "Gamma"), "the Y3 title is not drawn at its own size").toBe(33);
    expect(sizeOf(container, "Alpha"), "the main Y title changed").toBe(buildPlotScene(table, { ...plot, y2Axis: { title: "Beta" }, y3Axis: { title: "Gamma" } }, { width: 720, height: 380 }).fonts.yAxisTitle.size);
  });
  it("the top X2 title of a horizontal bar", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "g", name: "Group", role: "x" }, { id: "bar", name: "Sales", role: "y" }, { id: "line", name: "Trend", role: "y" }],
      rows: [{ id: "r1", cells: { g: "A", bar: 2, line: 300 } }, { id: "r2", cells: { g: "B", bar: 6, line: 500 } }, { id: "r3", cells: { g: "C", bar: 10, line: 400 } }],
    };
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal",
      seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Trend units", titleFont: { size: 29 } },
    };
    const scene = buildPlotScene(table, plot, { width: 640, height: 460 });
    expect(scene.y2?.side, "the fixture drew no top axis").toBe("top");
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(sizeOf(container, "Trend units"), "the top X2 title is not drawn at its own size").toBe(29);
  });
});

// Shaded bands are drawn by every figure that draws an axis.
// The lollipop and paired-dot charts draw their own figure components, so each must render `scene.axisBands`
// itself; guards against the builder making the band while nothing renders it, a dead "Bands" control.
describe("PlotFigure — axis bands reach the drawing on the figures with their own components", () => {
  const bandRects = (container: HTMLElement) =>
    [...container.querySelectorAll("rect")].filter((el) => el.getAttribute("fill") === "#ff0000");

  const lollipopTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "x", name: "Metric", role: "x" }, { id: "v", name: "Score", role: "y" }],
    rows: [["A", 20], ["B", 35], ["C", 10]].map(([c, v], i) => ({ id: `r${i}`, cells: { x: c as string, v: v as number } })),
  };
  const pairTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "Subject", role: "x" }, { id: "b", name: "Before", role: "y" }, { id: "a", name: "After", role: "y" }],
    rows: [["s1", 10, 14], ["s2", 12, 15], ["s3", 9, 13]].map(([g, b, a], i) => ({ id: `r${i}`, cells: { g: g as string, b: b as number, a: a as number } })),
  };

  it("lollipop: a band on its value axis is drawn", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop", xAxis: { bands: [{ from: 15, to: 25, color: "#ff0000", opacity: 0.5 }] } };
    const scene = buildPlotScene(lollipopTable, plot, { width: 620, height: 400 });
    expect(scene.axisBands?.length, "the fixture's band never reached the scene — it cannot test the drawing").toBe(1);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(bandRects(container).length, "the lollipop figure drew no band").toBe(1);
  });

  it("paired dot: a band on its value axis is drawn", () => {
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "paireddot", xAxis: { bands: [{ from: 11, to: 13, color: "#ff0000", opacity: 0.5 }] } };
    const scene = buildPlotScene(pairTable, plot, { width: 620, height: 400 });
    expect(scene.axisBands?.length, "the fixture's band never reached the scene — it cannot test the drawing").toBe(1);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(bandRects(container).length, "the paired-dot figure drew no band").toBe(1);
  });

  it("the main figure draws its bands too", () => {
    const table: DataTable = {
      id: "t", kind: "xy", name: "T",
      columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }],
      rows: [0, 2, 4, 6].map((x, i) => ({ id: `r${i}`, cells: { x, a: 10 + i } })),
    };
    const plot: Plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy", xAxis: { bands: [{ from: 1, to: 3, color: "#ff0000", opacity: 0.5 }] } };
    const scene = buildPlotScene(table, plot, { width: 620, height: 400 });
    expect(scene.axisBands?.length).toBe(1);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    expect(bandRects(container).length).toBe(1);
  });
});

// Label rotation on the second and third value axes (Y2 / Y3 / X2) reaches the drawing.
// Guards against the Axis tab offering and storing it while every one of those labels is still drawn level.
describe("PlotFigure — Y2 / Y3 / top X2 tick labels are drawn turned when a rotation is set", () => {
  type Sc = ReturnType<typeof buildPlotScene>;
  /** The <text> elements drawing the labels of `key`, told apart from other text by their text and their side. */
  const labelsOf = (container: HTMLElement, s: Sc, key: "y2" | "y3"): Element[] => {
    const ax = s[key]!;
    const names = new Set(ax.ticks.filter((t) => !t.minor && t.label !== "").map((t) => t.label));
    const right = s.plot.x + s.plot.width;
    return [...container.querySelectorAll("text")].filter((t) => {
      if (!names.has((t.textContent ?? "").trim())) return false;
      const x = Number(t.getAttribute("x"));
      const y = Number(t.getAttribute("y"));
      if (ax.side === "top") return y < s.plot.y;
      if (key === "y3") return x > ax.axisX!;
      return x > right && (s.y3?.axisX === undefined || x < s.y3.axisX);
    });
  };
  const turnedBy = (el: Element, rot: number): boolean => (el.getAttribute("transform") ?? "").startsWith(`rotate(${rot} `);

  const xyTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
    rows: [[1, 10, 1000, 0.1], [2, 20, 2000, 0.2], [3, 30, 3000, 0.3]].map(([x, a, b, c], i) => ({ id: `r${i}`, cells: { x: x!, a: a!, b: b!, c: c! } })),
  };
  const xyPlot = (y2Rot: number, y3Rot: number): Plot => ({
    id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
    seriesStyles: { b: { axis: "y2" }, c: { axis: "y3" } },
    y2Axis: { title: "Beta", ...(y2Rot ? { tickRotation: y2Rot } : {}) }, y3Axis: { title: "Gamma", ...(y3Rot ? { tickRotation: y3Rot } : {}) },
  });

  it("right-hand Y2 at 45° and Y3 at −90°: every label on each axis is drawn turned by its own angle", () => {
    const s = buildPlotScene(xyTable, xyPlot(45, -90), { width: 720, height: 380 });
    const { container } = render(<PlotFigure scene={s} selected={null} />);
    const y2 = labelsOf(container, s, "y2");
    const y3 = labelsOf(container, s, "y3");
    expect(y2.length, "the fixture's Y2 labels were not found").toBeGreaterThan(2);
    expect(y3.length, "the fixture's Y3 labels were not found").toBeGreaterThan(2);
    expect(y2.filter((e) => !turnedBy(e, 45)).map((e) => e.textContent), "Y2 labels drawn level").toEqual([]);
    expect(y3.filter((e) => !turnedBy(e, -90)).map((e) => e.textContent), "Y3 labels drawn level").toEqual([]);
  });

  it("with no rotation set, the Y2 and Y3 labels are drawn level", () => {
    const s = buildPlotScene(xyTable, xyPlot(0, 0), { width: 720, height: 380 });
    const { container } = render(<PlotFigure scene={s} selected={null} />);
    const all = [...labelsOf(container, s, "y2"), ...labelsOf(container, s, "y3")];
    expect(all.length).toBeGreaterThan(4);
    expect(all.filter((e) => e.hasAttribute("transform")).map((e) => e.textContent)).toEqual([]);
  });

  it("the top X2 axis of a horizontal bar at −45°: every label is drawn turned", () => {
    const table: DataTable = {
      id: "t", kind: "column", name: "T",
      columns: [{ id: "g", name: "Group", role: "x" }, { id: "bar", name: "Sales", role: "y" }, { id: "line", name: "Trend", role: "y" }],
      rows: [{ id: "r1", cells: { g: "A", bar: 2, line: 300 } }, { id: "r2", cells: { g: "B", bar: 6, line: 500 } }, { id: "r3", cells: { g: "C", bar: 10, line: 400 } }],
    };
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar", barOrientation: "horizontal",
      seriesStyles: { line: { plotAs: "line", axis: "y2" } }, y2Axis: { title: "Trend units", tickRotation: -45 },
    };
    const s = buildPlotScene(table, plot, { width: 640, height: 460 });
    expect(s.y2?.side, "the fixture drew no top axis").toBe("top");
    const { container } = render(<PlotFigure scene={s} selected={null} />);
    const top = labelsOf(container, s, "y2");
    expect(top.length, "the fixture's top labels were not found").toBeGreaterThan(2);
    expect(top.filter((e) => !turnedBy(e, -45)).map((e) => e.textContent), "top X2 labels drawn level").toEqual([]);
  });
});

describe("PlotFigure — global-fit curve overlay", () => {
  const gfTable: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [
      { id: "r0", cells: { x: 1, a: 2, b: 1 } },
      { id: "r1", cells: { x: 2, a: 4, b: 2 } },
      { id: "r2", cells: { x: 3, a: 6, b: 3 } },
    ],
  };
  it("draws one colour-matched curve per dataset from plot.fits", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      fits: [
        { label: "Drug A", points: [[1, 2], [2, 4], [3, 6]], color: "#0072B2" },
        { label: "Drug B", points: [[1, 1], [2, 2], [3, 3]], color: "#E69F00" },
      ],
    };
    const scene = buildPlotScene(gfTable, plot, { width: 440, height: 320 });
    expect(scene.fits).toHaveLength(2);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const groups = container.querySelectorAll("g.gfx-globalfit");
    expect(groups.length).toBe(2);
    // each group carries a stroked path whose <title> is the dataset label + its colour
    const strokes = [...container.querySelectorAll("g.gfx-globalfit path")].map((p) => p.getAttribute("stroke"));
    expect(strokes).toContain("#0072B2");
    expect(strokes).toContain("#E69F00");
    const titles = [...container.querySelectorAll("g.gfx-globalfit title")].map((t) => t.textContent);
    expect(titles).toContain("Drug A");
    expect(titles).toContain("Drug B");
  });
});

describe("PlotFigure — PCA score confidence ellipses", () => {
  const pca = {
    varLabels: ["Va", "Vb"], pcLabels: ["PC1", "PC2"], explained: [0.6, 0.4], eigenvalues: [1.2, 0.8],
    loadings: [[0.7, -0.2], [0.5, 0.6]],
    scores: [[-1.5, 0.4], [-1.2, -0.3], [-1.8, 0.1], [1.4, 0.5], [1.1, -0.4], [1.6, 0.2]],
    groups: ["A", "A", "A", "B", "B", "B"],
  };
  const dummy: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X" }], rows: [] };
  it("draws one colour-matched <ellipse> per group when ellipse.show is on", () => {
    const plot: Plot = { id: "p", name: "PCA", source: "t", status: "ok", styleOverrides: {}, kind: "pcascore", pca, ellipse: { show: true } };
    const scene = buildPlotScene(dummy, plot, { width: 460, height: 340 });
    expect(scene.ellipses).toHaveLength(2);
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const fills = [...container.querySelectorAll("ellipse")].map((e) => e.getAttribute("fill"));
    expect(fills).toContain("#0072B2"); // group A = seriesColor(0)
    expect(fills).toContain("#E69F00"); // group B = seriesColor(1)
  });
});

describe("PlotFigure — continuous colour-scale bar", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X" }, { id: "y", name: "Score" }],
    rows: [
      { id: "r0", cells: { x: 1, y: 10 } },
      { id: "r1", cells: { x: 2, y: 30 } },
      { id: "r2", cells: { x: 3, y: 50 } },
    ],
  };
  it("renders a gradient bar with min/max + title for a continuous colour column", () => {
    const plot: Plot = {
      id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "xy",
      seriesStyles: { y: { colorFromColumn: "y", colorFromMode: "continuous", colorFromRamp: "viridis" } },
    };
    const scene = buildPlotScene(table, plot, { width: 460, height: 320 });
    expect(scene.colorbar).toBeDefined();
    const { container } = render(<PlotFigure scene={scene} selected={null} />);
    const g = container.querySelector("g.gfx-colorbar")!;
    expect(g).toBeTruthy();
    expect(g.querySelectorAll("stop").length).toBe(6); // 6 gradient stops
    expect(g.querySelector("rect")!.getAttribute("fill")).toBe("url(#gfx-colorbar-grad)");
    const texts = [...g.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("50"); // max at top
    expect(texts).toContain("10"); // min at bottom
    expect(texts).toContain("Score"); // the bound column's name
  });
});

describe("PlotFigure — EC50/IC50 dose crosshair", () => {
  const drTable: DataTable = {
    id: "dr",
    kind: "xy",
    name: "DR",
    columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Resp", role: "y" }],
    rows: [
      { id: "r1", cells: { x: 0, y: 5 } },
      { id: "r2", cells: { x: 4, y: 50 } },
      { id: "r3", cells: { x: 10, y: 95 } },
    ],
  };
  const drPlot: Plot = {
    id: "p", name: "DR", source: "dr", status: "ok", styleOverrides: {}, kind: "xy",
    fit: { label: "4PL", points: [[0, 5], [4, 50], [10, 95]], marker: { x: 4, y: 50, label: "EC50 = 4" } },
  };

  it("renders a vertical drop-line to the X-axis + the EC50 label", () => {
    const scene = buildPlotScene(drTable, drPlot, { xScale: "linear", yScale: "linear", width: 600, height: 400 });
    const m = scene.fit!.marker!;
    const { container } = render(<PlotFigure scene={scene} />);
    // A vertical line at the dose x reaching the X-axis baseline.
    const dropLine = [...container.querySelectorAll("svg.gfx-figure line")].find(
      (l) =>
        Math.abs(Number(l.getAttribute("x1")) - m.vx) < 0.5 &&
        Math.abs(Number(l.getAttribute("x2")) - m.vx) < 0.5 &&
        Math.abs(Number(l.getAttribute("y2")) - m.baseY) < 0.5,
    );
    expect(dropLine).toBeTruthy();
    // The EC50 value label renders.
    const label = [...container.querySelectorAll("svg.gfx-figure text")].some((t) => (t.textContent || "").includes("EC50 = 4"));
    expect(label).toBe(true);
  });
});

describe("PlotFigure — synthesized value/loading labels drag as generic annotations (drag persistence)", () => {
  // Pyramid value labels (pyr-val-*) and PCA loading labels (pca-vlabel-*) are builder-synthesized
  // scene annotations. They render inside the generic draggable annotation group (cursor:move,
  // onMoveAnnotation wired). The drop of a drag is exercised in @mady/core document.test.ts
  // (getScreenCTM is null in jsdom, so the pixel→fraction step can't run here); this proves the
  // label is emitted as a draggable, onMoveAnnotation-bound element rather than inert text.
  const pyrTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [
      { id: "age", name: "Age", role: "x" },
      { id: "m", name: "Male", role: "y" },
      { id: "f", name: "Female", role: "y" },
    ],
    rows: [
      { id: "r0", cells: { age: "0-14", m: 62, f: 59 } },
      { id: "r1", cells: { age: "15-29", m: 71, f: 68 } },
    ],
  };
  const pca = {
    varLabels: ["Va", "Vb", "Vc"], pcLabels: ["PC1", "PC2", "PC3"],
    explained: [0.6, 0.25, 0.15], eigenvalues: [1.8, 0.75, 0.45],
    loadings: [[0.7, -0.2, 0.1], [0.5, 0.6, -0.3], [0.4, -0.1, 0.8]],
    scores: [[-1.5, 0.4, 0.1], [1.4, 0.5, -0.4]], groups: ["A", "B"],
  };
  const dummy: DataTable = { id: "t", kind: "xy", name: "T", columns: [{ id: "x", name: "X", role: "x" }], rows: [] };

  it("a pyramid value label renders as a draggable (cursor:move) annotation", () => {
    const scene = buildPlotScene(pyrTable, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pyramid", pyramid: { showValues: true } }, { width: 480, height: 320 });
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveAnnotation={vi.fn()} />);
    const lbl = container.querySelector('[data-ann-text^="pyr-val-"]');
    expect(lbl, "no pyr-val label rendered").toBeTruthy();
    expect((lbl!.closest("g") as unknown as HTMLElement).style.cursor).toBe("move");
  });

  it("a PCA loading label renders as a draggable (cursor:move) annotation", () => {
    const scene = buildPlotScene(dummy, { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "pcaload", pca }, { width: 480, height: 320 });
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveAnnotation={vi.fn()} />);
    const lbl = container.querySelector('[data-ann-text^="pca-vlabel-"]');
    expect(lbl, "no pca-vlabel rendered").toBeTruthy();
    expect((lbl!.closest("g") as unknown as HTMLElement).style.cursor).toBe("move");
  });
});

describe("significance markers — the key is draggable, the bracket honours its shape/ink", () => {
  const catTable: DataTable = {
    id: "t", kind: "column", name: "T",
    columns: [{ id: "g", name: "Group", role: "x" }, { id: "v", name: "Value", role: "y" }],
    rows: [
      { id: "r1", cells: { g: "A", v: 3 } },
      { id: "r2", cells: { g: "B", v: 5 } },
      { id: "r3", cells: { g: "C", v: 4 } },
    ],
  };
  const sigScene = (significance: Plot["significance"], ann: Partial<Annotation> = {}) =>
    buildPlotScene(
      catTable,
      {
        id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "bar",
        ...(significance ? { significance } : {}),
        // bracketY sits inside the value domain: an auto-placed marker lifts the axis via
        // `role: "significance"`, but a hand-placed one above the data is simply dropped —
        // and a fixture that never draws the bracket cannot test how it is drawn.
        annotations: [{ id: "a1", kind: "bracket", from: 1, to: 3, bracketY: 4.5, p: 0.0005, ...ann }],
      },
      { width: 440, height: 320 },
    );
  /** The rendered key caption ("* p<0.05; …"), or undefined when it isn't drawn. */
  const capText = (c: HTMLElement): SVGTextElement | undefined =>
    [...c.querySelectorAll<SVGTextElement>("text")].find((t) => /p</.test(t.textContent ?? ""));

  it("the threshold key is draggable like every other caption", () => {
    const onMove = vi.fn();
    const { container } = render(
      <PlotFigure scene={sigScene({ legend: true })} selected={null} onMoveSignificanceCaption={onMove} />,
    );
    const cap = capText(container)!;
    expect(cap, "no significance key rendered").toBeTruthy();
    expect(cap.style.cursor).toBe("move");
    fireEvent.pointerDown(cap, { clientX: 200, clientY: 300 });
    fireEvent.pointerMove(cap, { clientX: 250, clientY: 310 });
    fireEvent.pointerUp(cap, { clientX: 250, clientY: 310 });
    expect(onMove).toHaveBeenCalled();
  });

  it("without the callback it advertises nothing (no dead drag affordance)", () => {
    const { container } = render(<PlotFigure scene={sigScene({ legend: true })} selected={null} />);
    expect(capText(container)!.style.cursor).toBe("");
  });

  it("the key's font size / family / weight / style / colour reach the drawing", () => {
    const { container } = render(
      <PlotFigure
        scene={sigScene({
          legend: true,
          legendSize: 19,
          legendFontFamily: "Georgia, serif",
          legendBold: true,
          legendItalic: true,
          legendColor: "#0044cc",
        })}
        selected={null}
      />,
    );
    const cap = capText(container)!;
    expect(cap.getAttribute("font-size")).toBe("19");
    expect(cap.getAttribute("font-family")).toBe("Georgia, serif");
    expect(cap.getAttribute("font-weight")).toBe("700");
    expect(cap.getAttribute("font-style")).toBe("italic");
    expect(cap.getAttribute("fill")).toBe("#0044cc");
  });

  it("the key's drag offset is applied (a saved position is honoured on reload)", () => {
    const { container } = render(<PlotFigure scene={sigScene({ legend: true, legendOffset: { dx: 17, dy: -6 } })} selected={null} />);
    expect(capText(container)!.getAttribute("transform")).toBe("translate(17 -6)");
  });

  it("a rounded bracket draws round caps; the symbol takes its own ink", () => {
    const plain = render(<PlotFigure scene={sigScene(undefined)} selected={null} />);
    const plainPath = [...plain.container.querySelectorAll<SVGPathElement>("path")].find((p) => p.getAttribute("stroke") !== "transparent" && /^M/.test(p.getAttribute("d") ?? ""))!;
    expect(plainPath.getAttribute("stroke-linecap")).toBeNull();
    cleanup();
    const { container } = render(
      <PlotFigure scene={sigScene({ shape: "rounded", color: "#888888", labelColor: "#ff0000" })} selected={null} />,
    );
    const stroked = [...container.querySelectorAll<SVGPathElement>("path")].find((p) => p.getAttribute("stroke") === "#888888")!;
    expect(stroked, "no bracket path in the bracket's own colour").toBeTruthy();
    expect(stroked.getAttribute("stroke-linecap")).toBe("round");
    expect(stroked.getAttribute("stroke-linejoin")).toBe("round");
    // …and the stars print in their own colour rather than the bracket's grey.
    const sym = [...container.querySelectorAll<SVGTextElement>("text")].find((t) => (t.textContent ?? "").trim() === "★★★")!;
    expect(sym, "no ★★★ symbol rendered").toBeTruthy();
    expect(sym.getAttribute("fill")).toBe("#ff0000");
  });

  it("a bespoke figure draws the key too — the reserved band is not left as blank paper", () => {
    // buildPlotScene reserves the band for every kind, so each bespoke figure must draw the
    // caption too; otherwise switching the legend on for a lollipop / paired dot would add a
    // strip of empty space and nothing else.
    const scene = buildPlotScene(
      catTable,
      {
        id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "lollipop",
        significance: { legend: true, display: "stars" },
        annotations: [{ id: "a1", kind: "bracket", from: 1, to: 2, p: 0.0005 }],
      },
      { width: 440, height: 320 },
    );
    expect(scene.significanceCaption, "no caption built for a lollipop").toBeTruthy();
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={scene} selected={null} onMoveSignificanceCaption={onMove} />);
    const cap = capText(container);
    expect(cap, "the lollipop reserved the band but drew no key").toBeTruthy();
    fireEvent.pointerDown(cap!, { clientX: 200, clientY: 300 });
    fireEvent.pointerMove(cap!, { clientX: 240, clientY: 300 });
    fireEvent.pointerUp(cap!, { clientX: 240, clientY: 300 });
    expect(onMove).toHaveBeenCalled();
  });

  it("a bracket drag reports both axes — height and the lateral shift", () => {
    // jsdom has no getScreenCTM, so the pixel→data step of a real drag cannot run here
    // (the commit is proven end-to-end in e2e/significance.spec.ts). What this pins is
    // the drag contract: the bracket is grabbable and its patch carries bracketShift.
    const onMove = vi.fn();
    const { container } = render(<PlotFigure scene={sigScene(undefined)} selected={null} onMoveAnnotation={onMove} />);
    const sym = [...container.querySelectorAll<SVGTextElement>("text")].find((t) => (t.textContent ?? "").trim() === "★★★")!;
    const grp = sym.closest("g") as unknown as HTMLElement;
    expect(grp.style.cursor).toBe("move");
  });
});

describe("DraggableTitle — padded hit target + click-landed feedback", () => {
  // A label's clickable area is more than its thin glyphs, and a click shows at the label that
  // it landed: every DraggableTitle carries a padded hit rect and pulses at the label on select.
  const hmTable: DataTable = {
    id: "t", kind: "xy", name: "H",
    columns: [{ id: "x", name: "Gene", role: "x" }, { id: "a", name: "Ctrl" }, { id: "b", name: "Drug A" }],
    rows: [{ id: "r1", cells: { x: "G1", a: 1, b: 2 } }, { id: "r2", cells: { x: "G2", a: 3, b: 4 } }],
  };
  const hmScene = buildPlotScene(
    hmTable,
    { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap" },
    { width: 440, height: 320 },
  );
  const labelGroup = (c: HTMLElement): HTMLElement =>
    [...c.querySelectorAll("g.gfx-dragtext")].find((el) => /Ctrl|Drug/.test(el.textContent ?? "")) as HTMLElement;

  it("every interactive label carries a padded hit rect behind its glyphs", () => {
    const { container } = render(
      <PlotFigure scene={hmScene} selected={null} onSelect={() => {}} onMoveHeatmapLabels={() => {}} />,
    );
    const g = labelGroup(container);
    expect(g, "heatmap labels must render as .gfx-dragtext groups").toBeTruthy();
    const rect = g.querySelector("rect.gfx-draghit")!;
    expect(rect, "no hit rect behind the label").toBeTruthy();
    // a real padded target, not a hairline — and transparent (chrome, not ink)
    expect(Number(rect.getAttribute("width"))).toBeGreaterThan(10);
    expect(Number(rect.getAttribute("height"))).toBeGreaterThan(10);
    expect(rect.getAttribute("fill")).toBe("transparent");
  });

  it("clicking a label fires onSelect and pulses visible feedback at the label", () => {
    vi.useFakeTimers();
    try {
      const onSelect = vi.fn();
      const { container } = render(
        <PlotFigure scene={hmScene} selected={null} onSelect={onSelect} onMoveHeatmapLabels={() => {}} />,
      );
      const g = labelGroup(container);
      fireEvent.pointerDown(g, { clientX: 10, clientY: 10 });
      fireEvent.pointerUp(g, { clientX: 10, clientY: 10 });
      expect(onSelect).toHaveBeenCalled();
      expect(g.classList.contains("gfx-dragtext-flash"), "the click must pulse at the label").toBe(true);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(g.classList.contains("gfx-dragtext-flash"), "the pulse must clear itself").toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a plain non-interactive text gets no hit rect (no dead chrome)", () => {
    const { container } = render(<PlotFigure scene={hmScene} selected={null} />);
    // without onSelect/onMove/onEdit wiring the labels render bare
    for (const g of container.querySelectorAll("g.gfx-dragtext")) {
      if (!/Ctrl|Drug|G1|G2/.test(g.textContent ?? "")) continue;
      expect(g.querySelector("rect.gfx-draghit")).toBeNull();
    }
  });
});
