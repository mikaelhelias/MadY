// @vitest-environment jsdom
/**
 * Group dots sit side by side, not in a vertical line. On the gallery's p-bar and p-columnbar the points
 * spread slightly sideways, as on the violin, p-scatter and most graphs drawn from group data.
 *
 * Read off the drawing. Where the group has room (a column scatter, an estimation plot, a box / violin with its points),
 * no two dots overlap; over a bar, every dot stays inside its bar. Without the spread these fixtures have many
 * overlapping dots (p-scatter, p-columnbar, p-est, box / violin with points), so the checks can fail.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

function dots(plot: Plot, table: Parameters<typeof buildPlotScene>[0]) {
  const scene = buildPlotScene(table, plot, { width: 580, height: 380 });
  const { container } = render(<PlotFigure scene={scene} />);
  const d = [...container.querySelectorAll("svg.gfx-figure circle")]
    .filter((c) => (c.getAttribute("fill") ?? "transparent") !== "transparent" && !c.closest("[data-mady-legend-row]"))
    .map((c) => ({ x: +c.getAttribute("cx")!, y: +c.getAttribute("cy")!, r: +c.getAttribute("r")! }));
  let overlaps = 0;
  for (let i = 0; i < d.length; i++) for (let j = i + 1; j < d.length; j++) if (Math.hypot(d[i]!.x - d[j]!.x, d[i]!.y - d[j]!.y) < d[i]!.r + d[j]!.r - 1) overlaps++;
  return { scene, d, overlaps };
}
const card = (name: string) => galleryItems().find((g) => g.plot.name === name || g.plot.id === name)!;

describe("group dots are spread sideways", () => {
  for (const [name, extra] of [["p-scatter", {}], ["p-est", {}], ["p-box", { showBoxPoints: true }], ["p-violin", { showBoxPoints: true }]] as const) {
    it(`${name}${"showBoxPoints" in extra ? " (points on)" : ""}: no two dots overlap`, () => {
      const g = card(name);
      const { d, overlaps } = dots({ ...g.plot, ...extra } as Plot, g.table);
      expect(d.length, `${name} draws no dots — the fixture proves nothing`).toBeGreaterThan(10);
      expect(overlaps, `${name}: ${overlaps} overlapping pairs`).toBe(0);
    });
  }

  for (const name of ["p-bar", "p-columnbar"]) {
    it(`${name}: dots spread across their bar, and stay inside it`, () => {
      const g = card(name);
      const { scene, d } = dots(g.plot, g.table);
      expect(d.length).toBeGreaterThan(10);
      for (const s of scene.series) {
        for (const m of s.marks) {
          if (!m.bar || !m.points?.length) continue;
          for (const p of m.points) expect(p.cx, `${name}: a dot left its bar`).toBeGreaterThanOrEqual(m.bar.x - 1e-6);
          for (const p of m.points) expect(p.cx).toBeLessThanOrEqual(m.bar.x + m.bar.w + 1e-6);
          // Not all on the centre line (a single vertical line of dots).
          if (m.points.length >= 3) expect(new Set(m.points.map((p) => Math.round(p.cx))).size, `${name}: dots drawn in one column`).toBeGreaterThan(1);
        }
      }
    });
  }

  it("the layout is the same every time (no random jitter)", () => {
    const g = card("p-scatter");
    const a = buildPlotScene(g.table, g.plot, { width: 580, height: 380 });
    const b = buildPlotScene(g.table, g.plot, { width: 580, height: 380 });
    expect(JSON.stringify(a.series.map((s) => s.marks.map((m) => m.points)))).toBe(JSON.stringify(b.series.map((s) => s.marks.map((m) => m.points))));
  });
});
