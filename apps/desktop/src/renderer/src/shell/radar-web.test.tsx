// @vitest-environment jsdom
/**
 * The spider web — selectable, and styleable beyond colour + thickness.
 *
 * The radar's edge labels have a font of their own, with the option shown on clicking them;
 * the spider grid is selectable too, and the side panel shows its colour, thickness,
 * dashes and tick marks.
 *
 * Guards against the web falling through to the figure background: if every drawn element
 * except the data polygons emits `{kind:"plot"}`, clicking a ring, spoke or edge label selects
 * the whole graph and lands on whichever Inspector tab was last open. It also guards the edge
 * labels' own font (the plot-wide tick font has no other use on a radar and no panel on this
 * chart exposes it) and the dash and tick-mark options.
 *
 * A ring is not an independent object — the rings are one family, styled together — so a
 * click opens the section that owns them, the same answer a treemap region gets. The click
 * must never do nothing at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };
const item = () => galleryItems().find((g) => (g.plot.kind ?? "xy") === "radar")!;
const build = (radar: Record<string, unknown> = {}) => {
  const g = item();
  return buildPlotScene(g.table, { ...g.plot, radar: { ...(g.plot.radar ?? {}), ...radar } } as Plot, SIZE);
};

describe("guarding the guard", () => {
  it("the fixture really draws a web — rings, spokes and labels", () => {
    const r = build().radar!;
    expect(r.rings.length).toBeGreaterThan(2);
    expect(r.spokes.length).toBeGreaterThan(2);
    expect(r.spokes.every((s) => s.label)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Every part of the web is selectable.
// ─────────────────────────────────────────────────────────────────────────────
describe("clicking the web", () => {
  /** Click one element and report what it selected. */
  const pick = (sel: string, nth = 0): GraphSelection | "none" => {
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={build({ showTicks: true })} zoom={1} onSelect={(s) => picks.push(s)} />);
    const els = [...container.querySelectorAll(sel)];
    expect(els.length, `nothing matched ${sel} — the check is measuring nothing`).toBeGreaterThan(nth);
    fireEvent.click(els[nth]!);
    cleanup();
    return picks[0] ?? "none";
  };

  const WANT = { kind: "chart-section", title: "Radar chart" };

  it("a grid ring opens the radar section", () => {
    expect(pick("polygon[fill='none']")).toEqual(WANT);
  });

  it("a spoke opens it", () => {
    expect(pick("line")).toEqual(WANT);
  });

  it("a tick mark opens it", () => {
    /*
     * Note: found by its geometry — a horizontal segment exactly `tickLen` long. "The last
     * <line> in the figure" would be a legend swatch stub (the legend draws last), which
     * selects a series and would fail for the test's reason rather than the app's.
     */
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={build({ showTicks: true, tickLen: 7 })} zoom={1} onSelect={(s) => picks.push(s)} />);
    const tick = [...container.querySelectorAll("line")].find(
      (l) => Number(l.getAttribute("y1")) === Number(l.getAttribute("y2")) && Math.abs(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1"))) === 7,
    );
    expect(tick, "no tick mark in the drawing").toBeDefined();
    fireEvent.click(tick!);
    expect(picks[0]).toEqual(WANT);
  });

  it("an edge label opens it", () => {
    const picks: GraphSelection[] = [];
    const scene = build();
    // With text editing wired, as in the app, and the gesture a mouse makes (press · release · click).
    // A read-only figure and a bare click would pass even if, in the app, the label's inline editor
    // took the click and the section never opened.
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} onEditText={() => {}} />);
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === scene.radar!.spokes[0]!.label);
    expect(label, "the first spoke's label is not in the drawing").toBeDefined();
    const g = label!.closest("g.gfx-dragtext") ?? label!;
    fireEvent.pointerDown(g, { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.pointerUp(g, { clientX: 5, clientY: 5, pointerId: 1, button: 0 });
    fireEvent.click(label!);
    expect(picks[0]).toEqual(WANT);
  });

  it("a ring value label opens it", () => {
    const scene = build();
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    const names = new Set(scene.radar!.spokes.map((s) => s.label));
    const value = [...container.querySelectorAll("text")].find((t) => t.textContent && !names.has(t.textContent) && /^[\d.]+$/.test(t.textContent));
    expect(value, "no ring value label in the drawing").toBeDefined();
    fireEvent.click(value!);
    expect(picks[0]).toEqual(WANT);
  });

  it("the data polygon selects its series — the web's click handling does not swallow it", () => {
    // The control case: a click on the data must still select the series, not the web's section.
    const scene = build();
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={(s) => picks.push(s)} />);
    const poly = [...container.querySelectorAll("polygon")].find((p) => (p.getAttribute("fill") ?? "none") !== "none");
    expect(poly, "no filled series polygon").toBeDefined();
    fireEvent.click(poly!);
    expect((picks[0] as { kind: string }).kind).toBe("series");
  });

  it("a read-only render offers no web click at all", () => {
    const { container } = render(<PlotFigure scene={build()} zoom={1} />);
    const ring = container.querySelector<SVGPolygonElement>("polygon[fill='none']")!;
    expect(ring.style.cursor).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Dashes, tick marks and the fonts reach the drawing.
// ─────────────────────────────────────────────────────────────────────────────
describe("the web's styling", () => {
  it("is unchanged by default — solid, no ticks, tick font", () => {
    const r = build().radar!;
    expect(r.gridDash).toBeNull();
    expect(r.spokeDash).toBeNull();
    expect(r.ticks).toBeUndefined();
    expect(r.labelFont).toBeUndefined();
  });

  it("grid + spoke dashes reach the scene and the drawing, scaled by their own widths", () => {
    const scene = build({ gridDash: "dashed", gridWidth: 2, spokeDash: "dotted", spokeWidth: 3 });
    expect(scene.radar!.gridDash).toBe("12.0,8.0"); // dashed x2
    expect(scene.radar!.spokeDash).toBe("3.0,9.0"); // dotted x3
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    expect(container.querySelector("polygon[fill='none']")!.getAttribute("stroke-dasharray")).toBe("12.0,8.0");
    expect(container.querySelector("line")!.getAttribute("stroke-dasharray")).toBe("3.0,9.0");
  });

  it("tick marks appear, one per labelled ring, at the length asked for", () => {
    const scene = build({ showTicks: true, tickLen: 7 });
    const r = scene.radar!;
    const labelled = r.rings.filter((x) => x.labelled !== false).length;
    expect(r.ticks).toHaveLength(labelled);
    // Note: checked against the ring's own radius, not a hardcoded y: the tick has to sit on the ring.
    for (const t of r.ticks!) {
      expect(t.x2 - t.x1).toBeCloseTo(7, 6);
      expect(r.rings.some((rg) => Math.abs(r.cy - rg.radius - t.y1) < 1e-6), "a tick is not on any ring").toBe(true);
    }
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    // Count tick lines specifically (by class) — the radar demo also draws error whiskers,
    // whose horizontal caps happen to span 7px too, so a length-only filter would over-count.
    const drawn = [...container.querySelectorAll("line.radartick")];
    expect(drawn.length, "the ticks never reached the drawing").toBe(labelled);
    for (const l of drawn) expect(Math.abs(Number(l.getAttribute("x2")) - Number(l.getAttribute("x1")))).toBeCloseTo(7, 6);
  });

  it("the edge-label font reaches the drawing", () => {
    const scene = build({ labelFont: { size: 24, bold: true } });
    expect(scene.radar!.labelFont!.size).toBe(24);
    const { container } = render(<PlotFigure scene={scene} zoom={1} onSelect={vi.fn()} />);
    const label = [...container.querySelectorAll("text")].find((t) => t.textContent === scene.radar!.spokes[0]!.label)!;
    // The font sits on the text or on the group the draggable wrapper puts it in.
    const size = label.getAttribute("font-size") ?? label.closest("[font-size]")?.getAttribute("font-size");
    expect(size).toBe("24");
  });

  it("the ring value font is separate, and falls back to the edge font when unset", () => {
    expect(build({ labelFont: { size: 20 } }).radar!.ringFont!.size).toBe(20);
    expect(build({ labelFont: { size: 20 }, ringFont: { size: 9 } }).radar!.ringFont!.size).toBe(9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. The controls exist and write what the builder reads.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = (onSetPlotOptions: (p: Partial<Plot>) => void) => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions, onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function panel(over: Record<string, unknown> = {}) {
  const g = item();
  const patches: Partial<Plot>[] = [];
  const plot = { ...g.plot, radar: { ...(g.plot.radar ?? {}), ...over } } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "chart-section", title: "Radar chart" }} plot={plot} table={g.table}
      userPresets={[]} profileDefault={null} {...handlers((p) => patches.push(p))} />,
  );
  return { container, patches, plot };
}

const control = <T extends HTMLElement = HTMLElement>(c: HTMLElement, label: string): T | undefined => {
  for (const row of c.querySelectorAll<HTMLElement>(".frow")) {
    if ((row.querySelector(":scope > span")?.textContent ?? "").trim() !== label) continue;
    for (let n: HTMLElement | null = row; n; n = n.parentElement) if (n.hidden) return undefined;
    const el = row.querySelector<T>("select, input");
    if (el) return el;
  }
  return undefined;
};

describe("the Radar chart section", () => {
  it("is what a web click opens, and it is not empty", () => {
    const { container } = panel();
    const sec = [...container.querySelectorAll<HTMLElement>("details.inspsec")]
      .filter((s) => (s.querySelector(":scope > summary")?.textContent ?? "").includes("Radar chart"))
      .filter((s) => !s.hidden);
    expect(sec.length, "clicking the web would open a blank panel").toBe(1);
    expect(sec[0]!.querySelectorAll("input, select").length).toBeGreaterThan(6);
  });

  for (const label of ["Grid dashes", "Spoke dashes", "Tick marks"]) {
    it(`offers "${label}"`, () => {
      expect(control(panel().container, label)).toBeDefined();
    });
  }

  it("tick length + colour appear only once ticks are on", () => {
    expect(control(panel().container, "Tick length")).toBeUndefined();
    cleanup();
    expect(control(panel({ showTicks: true }).container, "Tick length")).toBeDefined();
  });

  it("the dash control writes what the builder reads", () => {
    const { container, patches, plot } = panel();
    fireEvent.change(control<HTMLSelectElement>(container, "Grid dashes")!, { target: { value: "dashdot" } });
    expect(patches).toHaveLength(1);
    const after = buildPlotScene(item().table, { ...plot, ...patches[0] } as Plot, SIZE);
    expect(after.radar!.gridDash).toBe("6.0,3.0,1.0,3.0");
  });

  it("offers an edge label font, separate from the ring values", () => {
    const { container } = panel();
    const labels = [...container.querySelectorAll(".frow > span:first-child, .inspsub")].map((e) => (e.textContent ?? "").trim());
    expect(labels).toContain("Edge label font");
    expect(labels).toContain("Ring value font");
  });
});
