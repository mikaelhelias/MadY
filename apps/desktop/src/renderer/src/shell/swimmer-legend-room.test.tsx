// @vitest-environment jsdom
/**
 * The swimmer's legend starts past the bar-end numbers and arrows. The builder reserves room for them in its right
 * margin, so a legend placed at the plot's edge would sit on top of that room (e.g. the top bar's "36" and its arrow
 * under "Death"). Read off the drawing: every duration label's right end and every arrow tip lies left of the legend's
 * first key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

describe("swimmer legend room", () => {
  for (const size of [{ width: 580, height: 380 }, { width: 720, height: 540 }]) {
    it(`at ${size.width}×${size.height}: the legend clears every bar-end number and arrow`, () => {
      const g = galleryItems().find((x) => x.plot.kind === "swimmer")!;
      const scene = buildPlotScene(g.table, g.plot, size);
      const { container } = render(<PlotFigure scene={scene} />);
      const legend = container.querySelector(".gfx-legend")!;
      const keyXs = [...legend.querySelectorAll("circle, rect.gfx-legbar, polygon, rect")].map((k) => Number(k.getAttribute("cx") ?? k.getAttribute("x"))).filter((x) => Number.isFinite(x) && x > 0);
      const legendLeft = Math.min(...keyXs) - 8; // the key's half-width, generously
      // Only numbers at the legend's HEIGHT can collide with it (the X-axis numbers run along the bottom).
      const keyYs = [...legend.querySelectorAll("text")].map((k) => Number(k.getAttribute("y"))).filter(Number.isFinite);
      const top = Math.min(...keyYs) - scene.fonts.legend.size * 1.2;
      const bottom = Math.max(...keyYs) + scene.fonts.legend.size * 0.5;
      const labels = [...container.querySelectorAll("svg.gfx-figure text")].filter((t) => !t.closest(".gfx-legend") && /^\d+(\.\d+)?$/.test((t.textContent ?? "").trim()) && Number(t.getAttribute("x")) > scene.plot.x + scene.plot.width * 0.5 && Number(t.getAttribute("y")) >= top && Number(t.getAttribute("y")) <= bottom);
      expect(labels.length, "no bar-end numbers beside the legend — the fixture proves nothing").toBeGreaterThan(0);
      const size_ = scene.fonts.valueLabel.size;
      for (const t of labels) {
        const right = Number(t.getAttribute("x")) + (t.textContent ?? "").trim().length * size_ * 0.6;
        expect(right, `bar-end "${t.textContent}" ends at ${right.toFixed(1)}, the legend starts at ${legendLeft.toFixed(1)}`).toBeLessThanOrEqual(legendLeft);
      }
    });
  }
});
