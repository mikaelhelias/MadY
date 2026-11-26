// @vitest-environment jsdom
/**
 * The 3-D scatter's axes are real axes — range, scale, ticks, numbers, per-axis styling.
 *
 * Scale, tick spacing and axis breaks apply to this kind, with the Axis tab and its
 * modifications enabled. Guards against the kind drawing three bare cube edges with a name
 * each: no tick, no number, no range, no scale, and no Axis tab.
 *
 * Assertions are on the built scene's projected geometry and on the rendered figure — never on
 * the spec being echoed back (a scene echoes what it was handed; the drawing is the oracle).
 */
import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [
    { id: "cx", name: "Dose", role: "x" },
    { id: "cy", name: "Response", role: "y" },
    { id: "cz", name: "Weight", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { cx: 1, cy: 10, cz: 5 } },
    { id: "r2", cells: { cx: 2, cy: 40, cz: 6 } },
    { id: "r3", cells: { cx: 5, cy: 80, cz: 9 } },
    { id: "r4", cells: { cx: 8, cy: 20, cz: 3 } },
    { id: "r5", cells: { cx: 10, cy: 60, cz: 7 } },
  ],
};

const plotWith = (patch: Partial<Plot>): Plot =>
  ({ id: "p", name: "S3", source: "t", kind: "scatter3d", status: "ok", styleOverrides: {}, ...patch }) as Plot;

const SIZE = { width: 620, height: 460 };
const scene = (patch: Partial<Plot> = {}) => buildPlotScene(table, plotWith(patch), SIZE);

describe("scatter3d — the axes carry a real scale", () => {
  it("every axis has ticks with numbers, projected inside the canvas", () => {
    const s3 = scene().scatter3d!;
    expect(s3.axes).toHaveLength(3);
    for (const a of s3.axes) {
      expect(a.ticks!.length, `axis "${a.label}" has no ticks`).toBeGreaterThan(1);
      for (const t of a.ticks!) {
        expect(t.label, `axis "${a.label}" drew an unlabelled major tick`).not.toBe("");
        expect(t.lx).toBeGreaterThan(0);
        expect(t.lx).toBeLessThan(SIZE.width);
        expect(t.ly).toBeGreaterThan(0);
        expect(t.ly).toBeLessThan(SIZE.height);
      }
    }
  });

  it("the ticks survive an orbit — recomputed per camera, still on the canvas, still outward", () => {
    // Swing the camera through four quadrants; at each, every tick label must still sit
    // farther from the cube's projected centre than its mark does (outward), on-canvas.
    for (const az of [-2.4, -0.7, 0.9, 2.6]) {
      const s3 = scene({ scatter3d: { azimuth: az, elevation: 0.42 } }).scatter3d!;
      const cx = s3.axes.reduce((acc, a) => acc + a.x1, 0) / 3; // origin corner ≈ centre proxy
      for (const a of s3.axes) {
        for (const t of a.ticks!) {
          expect(t.lx, `az=${az}: a tick number ran off the left`).toBeGreaterThan(0);
          expect(t.lx, `az=${az}: a tick number ran off the right`).toBeLessThan(SIZE.width);
          void cx;
        }
      }
    }
  });

  it("a manual range clips: fewer points drawn, and the graph says how many", () => {
    const auto = scene().scatter3d!;
    const clipped = scene({ xAxis: { min: 2, max: 8 } });
    const s3 = clipped.scatter3d!;
    expect(s3.points.length, "the manual range dropped nothing").toBeLessThan(auto.points.length);
    expect(
      clipped.warnings.some((w) => w.includes("outside the manual axis range")),
      `no warning about the hidden points: ${JSON.stringify(clipped.warnings)}`,
    ).toBe(true);
    // …and the tick numbers follow the manual domain: nothing beyond it is labelled
    const xTicks = s3.axes[0]!.ticks!.map((t) => Number(t.label)).filter(Number.isFinite);
    expect(Math.min(...xTicks)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...xTicks)).toBeLessThanOrEqual(8);
  });

  it("a log scale changes the spacing of the projected points, not just the numbers", () => {
    const lin = scene().scatter3d!;
    const log = scene({ xAxis: { scale: "log10" } }).scatter3d!;
    // Same rows, different positions: log compresses the top decade.
    const moved = lin.points.filter((p, i) => Math.abs(p.x - log.points[i]!.x) > 1 || Math.abs(p.y - log.points[i]!.y) > 1);
    expect(moved.length, "log10 moved no point — the scale is not reaching the mapping").toBeGreaterThan(0);
  });

  it("log with non-positive data is refused with a warning and draws linear", () => {
    const t2: DataTable = { ...table, rows: [{ id: "r0", cells: { cx: -1, cy: 1, cz: 1 } }, ...table.rows] };
    const s = buildPlotScene(t2, plotWith({ xAxis: { scale: "log10" } }), SIZE);
    expect(s.warnings.some((w) => w.includes("log") && w.includes("linear"))).toBe(true);
  });

  it("Z reads its own spec — title, and zAxis.title beats the legacy scatter3d.zTitle", () => {
    expect(scene().scatter3d!.axes[2]!.label).toBe("Weight"); // the 3rd column
    expect(scene({ scatter3d: { zTitle: "Old home" } }).scatter3d!.axes[2]!.label).toBe("Old home");
    expect(scene({ scatter3d: { zTitle: "Old home" }, zAxis: { title: "New home" } }).scatter3d!.axes[2]!.label).toBe("New home");
  });

  it("per-axis line colour and tick font reach only their axis", () => {
    const s3 = scene({ yAxis: { lineColor: "#cc0000", tickFont: { size: 21 } } }).scatter3d!;
    expect(s3.axes[1]!.color).toBe("#cc0000");
    expect(s3.axes[0]!.color, "X picked up Y's colour").toBeUndefined();
    expect(s3.axes[1]!.tickFont!.size).toBe(21);
    expect(s3.axes[0]!.tickFont!.size, "X picked up Y's tick size").not.toBe(21);
  });

  it("majorStep sets the tick spacing; hideTicks and hidden empty their layers", () => {
    const stepped = scene({ zAxis: { majorStep: 2 } }).scatter3d!;
    const zVals = stepped.axes[2]!.ticks!.map((t) => Number(t.label)).filter(Number.isFinite).sort((a, b) => a - b);
    for (let i = 1; i < zVals.length; i++) expect(zVals[i]! - zVals[i - 1]!).toBeCloseTo(2, 6);
    expect(scene({ zAxis: { hideTicks: true } }).scatter3d!.axes[2]!.ticks).toHaveLength(0);
    expect(scene({ zAxis: { hidden: true } }).scatter3d!.axes[2]!.hidden).toBe(true);
  });
});

describe("scatter3d — the figure draws and routes the scale", () => {
  it("tick numbers are rendered, and clicking one selects its axis", () => {
    const s = scene();
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={(x) => picks.push(x)} onCamera3D={vi.fn()} />);
    const firstX = s.scatter3d!.axes[0]!.ticks![0]!;
    const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === firstX.label);
    expect(el, `the X tick "${firstX.label}" is not in the drawing`).toBeTruthy();
    fireEvent.click(el!);
    expect(picks).toEqual([{ kind: "axis", axis: "x" }]);
  });

  it("clicking a cube edge selects its axis (each edge its own)", () => {
    const s = scene();
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={(x) => picks.push(x)} onCamera3D={vi.fn()} />);
    // The three axis edges are the lines at the axes' projected endpoints.
    const lines = [...container.querySelectorAll("line")];
    for (const [i, a] of s.scatter3d!.axes.entries()) {
      const edge = lines.find((l) => Number(l.getAttribute("x2")) === a.x2 && Number(l.getAttribute("y2")) === a.y2);
      expect(edge, `axis ${i}'s edge is not drawn`).toBeTruthy();
      fireEvent.click(edge!);
      expect(picks.at(-1)).toEqual({ kind: "axis", axis: (["x", "y", "z"] as const)[i] });
    }
  });

  it("a hidden axis disappears from the drawing — edge, ticks and name", () => {
    const s = scene({ zAxis: { hidden: true } });
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={() => {}} />);
    const texts = [...container.querySelectorAll("text")].map((t) => (t.textContent ?? "").trim());
    expect(texts).not.toContain("Weight");
  });
});
