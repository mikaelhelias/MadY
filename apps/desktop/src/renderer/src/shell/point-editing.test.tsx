// @vitest-environment jsdom
/**
 * Point editing on two chart kinds.
 *
 * 1. Raincloud rain points are styled like data points. Besides Shape, Size, Opacity and Marker
 *    fill, the Rain points group needs its own colour: otherwise the rain takes the series
 *    colour, which is the violin body sitting beside it, so the dots cannot be made to read
 *    against the cloud at all.
 *
 * 2. Clicking a 3-D scatter point opens its data panel. `startOrbit` lives on the <svg>, and a
 *    3px move sets its drag flag; the point's own onClick must still select the point, because
 *    every real click jitters a pixel or two.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { tableDatasets } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };
const card = (kind: string) => galleryItems().find((x) => (x.plot.kind ?? "xy") === kind)!;

/**
 * Every colour drawn in the figure — fill **and** stroke.
 *
 * Note: both are needed: the house rain is an open marker, whose fill is the page colour and
 * whose hue lives entirely on the stroke. Reading `fill` alone would report that pointColor never
 * reached the drawing while it does, and the test would fail on a correct drawing.
 */
function fills(kind: string, patch: Partial<Plot>): string[] {
  const g = card(kind);
  const s = buildPlotScene(g.table, { ...g.plot, ...patch } as Plot, SIZE);
  const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={vi.fn()} />);
  const out = [...container.querySelectorAll("[fill], [stroke]")].flatMap((e) => [e.getAttribute("fill") ?? "", e.getAttribute("stroke") ?? ""]);
  cleanup();
  return out;
}

describe("raincloud rain points are editable like a data point", () => {
  const RAIN = "#ff00ff";
  const withRain = (): Partial<Plot> => {
    const g = card("raincloud");
    const a1 = tableDatasets(g.table)[0]!.id; // the card's first group, whatever its column id
    return { seriesStyles: { ...(g.plot.seriesStyles ?? {}), [a1]: { ...(g.plot.seriesStyles?.[a1] ?? {}), pointColor: RAIN } } };
  };

  it("the fixture can exhibit it — the raincloud draws a rain swarm", () => {
    const g = card("raincloud");
    const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
    const pts = s.series.reduce((n, x) => n + x.marks.reduce((m, k) => m + (k.points?.length ?? 0), 0), 0);
    expect(pts, "no rain points in the scene — nothing to colour").toBeGreaterThan(10);
  });

  it("a rain colour reaches the drawing, and colours only the rain", () => {
    const before = fills("raincloud", {});
    const after = fills("raincloud", withRain());
    expect(before, "the rain colour was already in the figure — the test proves nothing").not.toContain(RAIN);
    expect(after, "pointColor never reached the drawing").toContain(RAIN);
    // …and it does not repaint the violin: the cloud is drawn as <path>, the rain as markers,
    // so the paths must be byte-identical before and after.
    const paths = (patch: Partial<Plot>): string => {
      const g = card("raincloud");
      const sc = buildPlotScene(g.table, { ...g.plot, ...patch } as Plot, SIZE);
      const { container } = render(<PlotFigure scene={sc} zoom={1} onSelect={vi.fn()} />);
      const out = [...container.querySelectorAll("path")].map((e) => `${e.getAttribute("fill")}/${e.getAttribute("stroke")}`).join(",");
      cleanup();
      return out;
    };
    expect(paths(withRain()), "the rain colour leaked into the cloud").toBe(paths({}));
  });

  it("the series colour still drives the rain when no rain colour is set", () => {
    // Note: not `toContain(BLUE)`: the house rain is a two-tone marker, so the raw hue is never
    // painted — the fill is a light tint of it and the stroke a dark one. Compare the drawing.
    const g = card("raincloud");
    const a1 = tableDatasets(g.table)[0]!.id;
    const s = { seriesStyles: { ...(g.plot.seriesStyles ?? {}), [a1]: { ...(g.plot.seriesStyles?.[a1] ?? {}), color: "#0000ff" } } };
    expect(fills("raincloud", s).join(","), "changing the series colour stopped reaching the rain")
      .not.toBe(fills("raincloud", {}).join(","));
  });
});

describe("3-D scatter: clicking a point opens its data panel", () => {
  const clickPoint = (movePx: number): GraphSelection[] => {
    const g = card("scatter3d");
    const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
    const got: GraphSelection[] = [];
    const { container } = render(
      <PlotFigure scene={s} zoom={1} onSelect={(x) => got.push(x)} onCamera3D={vi.fn()} />,
    );
    const dot = container.querySelectorAll("circle")[0]!;
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(dot, { clientX: 100, clientY: 100 });
    if (movePx) fireEvent.pointerMove(svg, { clientX: 100 + movePx, clientY: 100 });
    fireEvent.pointerUp(svg, { clientX: 100 + movePx, clientY: 100 });
    fireEvent.click(dot, { clientX: 100 + movePx, clientY: 100 });
    cleanup();
    return got;
  };

  it("the fixture can exhibit it — the 3-D card draws clickable points", () => {
    const g = card("scatter3d");
    const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
    expect(s.scatter3d?.points.length, "no 3-D points").toBeGreaterThan(2);
    expect(s.scatter3d?.seriesId, "no series id — the click has nothing to select").toBeTruthy();
  });

  /** 3 and 8 px: an ordinary human click, which sets the orbit's drag flag. */
  for (const move of [0, 3, 8]) {
    it(`selects the point when the mouse moves ${move}px during the click`, () => {
      const got = clickPoint(move);
      expect(got.filter((x) => x?.kind === "series"), `a ${move}px click selected ${JSON.stringify(got)}`).toHaveLength(1);
      expect(got.find((x) => x?.kind === "series")).toMatchObject({ kind: "series", part: "points" });
    });
  }

  it("…and dragging the background still orbits instead of selecting a point", () => {
    const g = card("scatter3d");
    const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
    const cam = vi.fn();
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={vi.fn()} onCamera3D={cam} />);
    const svg = container.querySelector("svg")!;
    fireEvent.pointerDown(svg, { clientX: 20, clientY: 20 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(svg, { clientX: 60, clientY: 40 });
    expect(cam, "the orbit gesture stopped working").toHaveBeenCalled();
  });
});
