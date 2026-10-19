// @vitest-environment jsdom
/**
 * A bar's value label rests just past the bar's end. When the bars carry their data points (the "points on bars"
 * overlay, which a one-value bar draws exactly at its end) the label must clear the dots: its own bar's, and those of
 * the neighbouring series in the same row, which sit only a bar's thickness away.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure, valueLabelPlace } from "./PlotFigure";

afterEach(cleanup);

const sceneOf = (placement?: "above" | "insideEnd" | "insideBase", horizontal = false, dy = 0) =>
  ({ barHorizontal: horizontal, valueLabels: { dy, placement }, fonts: { valueLabel: { size: 12 } } });
const vbar = { x: 100, y: 100, w: 40, h: 200 };
const hbar = { x: 100, y: 50, w: 200, h: 30 }; // its label sits at y ≈ 65
const R = 8;

describe("valueLabelPlace with dots drawn over the bars", () => {
  it("no dots: exactly where it was", () => {
    expect(valueLabelPlace(sceneOf(undefined), vbar, 5, "5")).toMatchObject({ baseX: 120, baseY: 96 });
    expect(valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5")).toMatchObject({ anchor: "start", baseX: 304 });
  });

  it("a dot at the bar's end (a one-value bar): the label starts past the dot's edge — horizontal", () => {
    const p = valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5", [{ cx: 300, cy: 65, r: R }]);
    expect(p.baseX).toBeGreaterThanOrEqual(300 + R + 2);
  });

  it("a dot at the bar's end: the label sits above the dot's top — vertical", () => {
    const p = valueLabelPlace(sceneOf(undefined), vbar, 5, "5", [{ cx: 120, cy: 100, r: R }]);
    expect(p.baseY).toBeLessThanOrEqual(100 - R - 2);
  });

  it("dots well inside the bar leave the label where it was", () => {
    expect(valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5", [{ cx: 200, cy: 65, r: R }]).baseX).toBe(304);
    expect(valueLabelPlace(sceneOf(undefined), vbar, 5, "5", [{ cx: 120, cy: 220, r: R }]).baseY).toBe(96);
  });

  it("replicate dots beyond the bar's end push the label past the furthest of them", () => {
    const p = valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5", [{ cx: 280, cy: 60, r: R }, { cx: 330, cy: 70, r: R }]);
    expect(p.baseX).toBeGreaterThanOrEqual(330 + R + 2);
  });

  it("a neighbouring series' dot in the same row, further out, is cleared too — horizontal", () => {
    // the next series' bar is 8 px lower; its dot (radius 8) reaches up into this label's line
    const p = valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5", [{ cx: 300, cy: 65, r: R }, { cx: 340, cy: 73, r: R }]);
    expect(p.baseX).toBeGreaterThanOrEqual(340 + R + 2);
  });

  it("a dot in another row, well away vertically, is not an obstacle", () => {
    expect(valueLabelPlace(sceneOf(undefined, true), hbar, 5, "5", [{ cx: 500, cy: 200, r: R }]).baseX).toBe(304);
    expect(valueLabelPlace(sceneOf(undefined), vbar, 5, "5", [{ cx: 400, cy: 60, r: R }]).baseY).toBe(96);
  });

  it("a neighbouring series' dot beside this label's text, higher up, is cleared — vertical", () => {
    const p = valueLabelPlace(sceneOf(undefined), vbar, 5, "5", [{ cx: 120, cy: 100, r: R }, { cx: 128, cy: 60, r: R }]);
    expect(p.baseY).toBeLessThanOrEqual(60 - R - 2);
  });

  it("the inside placements are unaffected by the dots", () => {
    expect(valueLabelPlace(sceneOf("insideEnd"), vbar, 5, "5", [{ cx: 120, cy: 100, r: R }]).baseY).toBe(100 + 12 + 2);
  });

  it("the user's nudge is still added on top", () => {
    const p = valueLabelPlace(sceneOf(undefined, false, 5), vbar, 5, "5", [{ cx: 120, cy: 100, r: R }]);
    expect(p.baseY).toBe(100 - R - 4 + 5);
  });
});

describe("a drawn grouped bar chart with points on its bars", () => {
  // Nine age bands, two series, bars a few px thick in a short figure — the look the Universal design preset gives —
  // and size-14 markers (dots of radius 8.4), far wider than the 4 px gap a label keeps from a bar's end.
  const table: DataTable = {
    id: "tb", kind: "grouped", name: "Age",
    columns: [{ id: "g", name: "Age band", role: "x" }, { id: "m", name: "Male", role: "y" }, { id: "f", name: "Female", role: "y" }],
    rows: [["0–9", 412, 389], ["10–19", 455, 431], ["20–29", 520, 548], ["30–39", 498, 512], ["40–49", 471, 480], ["50–59", 437, 466], ["60–69", 352, 401], ["70–79", 231, 318], ["80+", 104, 227]]
      .map(([g, m, f], i) => ({ id: `r${i}`, cells: { g: g as string, m: m as number, f: f as number } })),
  };
  const BIG = { symbolSize: 14 };
  const plotOf = (over: Partial<Plot>): Plot => ({ id: "p", name: "P", source: "tb", kind: "bar", showValues: true, showBarPoints: true, barWidth: 0.38, seriesStyles: { m: BIG, f: BIG }, ...over }) as Plot;
  const drawn = (over: Partial<Plot>) => {
    const scene = buildPlotScene(table, plotOf(over), { width: 620, height: 480 });
    const { container } = render(<PlotFigure scene={scene} zoom={1} />);
    // The visible dots only: each dot also has a transparent, larger click target.
    const dots = [...container.querySelectorAll<SVGCircleElement | SVGPathElement | SVGPolygonElement>("svg .gfx-series circle, svg .gfx-series polygon, svg .gfx-series path")]
      .map((e) => ({ e, b: e.tagName === "circle" ? { cx: Number(e.getAttribute("cx")), cy: Number(e.getAttribute("cy")), r: Number(e.getAttribute("r")) } : null }));
    const circles = dots.filter((d) => d.b && d.b.r > 0 && d.e.getAttribute("fill") !== "transparent").map((d) => d.b!);
    const labels = [...container.querySelectorAll<SVGTextElement>("svg .gfx-series text, svg .gfx-textlayer text")]
      .filter((t) => /^[0-9.]+$/.test((t.textContent ?? "").trim()) && Number(t.getAttribute("font-size")) > 0)
      .map((t) => ({ x: Number(t.getAttribute("x")), y: Number(t.getAttribute("y")), size: Number(t.getAttribute("font-size")), text: t.textContent ?? "" }));
    return { circles, labels };
  };

  it("horizontal bars: no value label starts inside any dot of its row, own series or neighbour", () => {
    const { circles, labels } = drawn({ barOrientation: "horizontal" });
    expect(circles.length).toBeGreaterThan(0);
    expect(labels.length).toBeGreaterThan(0);
    for (const l of labels) {
      const top = l.y - l.size * 0.8;
      const bottom = l.y + l.size * 0.2;
      for (const d of circles) {
        if (d.cy + d.r > top && d.cy - d.r < bottom) expect(l.x, `label "${l.text}" at x=${l.x} starts inside the dot at ${d.cx},${d.cy} (r ${d.r})`).toBeGreaterThanOrEqual(d.cx + d.r);
      }
    }
  });

  it("vertical bars: no value label sits on a dot beside it", () => {
    const { circles, labels } = drawn({});
    expect(circles.length).toBeGreaterThan(0);
    for (const l of labels) {
      const half = (l.text.length * l.size * 0.6) / 2;
      for (const d of circles) {
        if (d.cx + d.r > l.x - half && d.cx - d.r < l.x + half) expect(l.y, `label "${l.text}" baseline ${l.y} runs into the dot at ${d.cx},${d.cy} (r ${d.r})`).toBeLessThanOrEqual(d.cy - d.r);
      }
    }
  });
});
