// @vitest-environment jsdom
/**
 * A network's node names end before its right-hand legend begins (the legend stays on the right, with no
 * clashes). Guards against reserving room for the names on the right but drawing the legend at the plot's edge, on
 * top of that room, so a long name would run on under the legend's keys. Read off
 * the drawing, under every built-in preset: every node name at the legend's height ends left of the legend's first key.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MadyDocument, STYLE_PRESETS } from "@mady/core";
import type { Plot, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { applyPresetWithKindDefaults } from "./seedStyle";

afterEach(cleanup);

describe("network legend room", () => {
  for (const preset of STYLE_PRESETS) {
    it(`${preset.name}: no node name reaches the legend`, () => {
      const g = galleryItems().find((x) => x.plot.kind === "network")!;
      const p = JSON.parse(JSON.stringify(g.plot)) as Plot;
      const project = { schemaVersion: 4, tables: [g.table], plots: [p], analyses: [], log: [], workspace: { folders: [], loose: [] } } as unknown as Project;
      const doc = new MadyDocument(project);
      applyPresetWithKindDefaults(doc, p.id, "network", preset);
      const plot = doc.toJSON().plots[0]!;
      const scene = buildPlotScene(g.table, plot, { width: 580, height: 380, ...scenePaletteOpt(plot) });
      expect(scene.legendLayout.position, "the fixture must have a right-hand legend").toBe("right");
      const { container } = render(<PlotFigure scene={scene} />);
      const legend = container.querySelector(".gfx-legend")!;
      const keyXs = [...legend.querySelectorAll("circle, line, rect.gfx-legbar")].map((k) => Number(k.getAttribute("cx") ?? k.getAttribute("x1") ?? k.getAttribute("x"))).filter((x) => Number.isFinite(x) && x > 0);
      const legendLeft = Math.min(...keyXs) - 6;
      // Only a name at the legend's height can run into it; one below its last row is clear.
      const rowYs = [...legend.querySelectorAll("text")].map((k) => Number(k.getAttribute("y"))).filter(Number.isFinite);
      const legendTop = Math.min(...rowYs) - scene.fonts.legend.size * 1.2;
      const legendBottom = Math.max(...rowYs) + scene.fonts.legend.size * 0.5;
      const size = scene.network!.labelSize;
      const names = new Set(scene.network!.nodes.map((n) => n.label).filter((l) => l !== ""));
      const texts = [...container.querySelectorAll("svg.gfx-figure text")].filter((t) => !t.closest(".gfx-legend") && [...names].some((n) => (t.textContent ?? "").startsWith(n.slice(0, 4))));
      expect(texts.length, "no node names drawn — the fixture proves nothing").toBeGreaterThan(0);
      for (const t of texts) {
        const y = Number(t.getAttribute("y"));
        if (y - size > legendBottom || y < legendTop) continue;
        const x = Number(t.getAttribute("x"));
        const w = (t.textContent ?? "").length * size * 0.6;
        const right = t.getAttribute("text-anchor") === "end" ? x : t.getAttribute("text-anchor") === "middle" ? x + w / 2 : x + w;
        expect(right, `"${t.textContent}" ends at ${right.toFixed(1)}, the legend starts at ${legendLeft.toFixed(1)}`).toBeLessThanOrEqual(legendLeft);
      }
    });
  }
});
