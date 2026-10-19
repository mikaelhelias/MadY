// @vitest-environment jsdom
/**
 * Every chart type, redrawn with new data (different numbers of groups and replicates), is checked for faults such
 * as a mismatched legend or overlapping text.
 *
 * Every gallery card is drawn as it is and in each shape of `newDataVariants` (fewer / more groups, replicates and
 * rows; new numbers; long names), laid out with the app's real font widths, and each drawing is checked for:
 *   • it draws — no crash, and ink on the page;
 *   • legend keys match their marks (the shared legend check, `legendKeyCheck.ts`);
 *   • no two texts overlap, and no text runs past the figure's edge — measured in a real browser (`figureInspect.ts`).
 * A finding names the chart, the shape and what is wrong.
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPlotScene } from "@mady/graphics";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { scenePaletteOpt } from "./scenePalette";
import { hasInk } from "./newGraph";
import { checkLegendKeys } from "./legendKeyCheck";
import { newDataVariants } from "./newDataVariants";
import { openFigureInspector, type FigureInspector } from "./figureInspect";

const HERE = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(HERE, "../shell.css"), "utf8");
const ROOT_CSS = css.slice(0, css.indexOf("}") + 1);
let insp: FigureInspector;

beforeAll(async () => {
  insp = await openFigureInspector(JSON.stringify(galleryItems()) + "ΔΣΩαβγδεθλμπσχω×−±µ°²³·–—’“”…≤≥≈√∞→←↑↓");
}, 60_000);
// Closing the browser can take several seconds when every test worker is busy, hence the long timeout.
afterAll(async () => { await insp?.close(); }, 60_000);

interface Drawn { chart: string; shape: string; svg: string; findings: string[] }

it("every chart type, redrawn with new data, draws without anomalies", async () => {
  const drawn: Drawn[] = [];
  for (const g of galleryItems()) {
    const extra = (g as { extraTables?: DataTable[] }).extraTables ?? [];
    const kind = g.plot.kind ?? "xy";
    const shapes = [{ label: "as in the gallery", table: g.table, extraTables: extra }, ...newDataVariants(g.key, kind, g.table, extra)];
    for (const s of shapes) {
      const d: Drawn = { chart: `${g.key} (${g.title})`, shape: s.label, svg: "", findings: [] };
      drawn.push(d);
      const tables = [s.table, ...s.extraTables];
      let scene;
      try {
        scene = buildPlotScene(s.table, g.plot as Plot, { width: g.plot.figureWidth ?? 580, height: g.plot.figureHeight ?? 380, measure: insp.measure, tables: (id: string) => tables.find((t) => t.id === id), ...scenePaletteOpt(g.plot) });
      } catch (e) {
        d.findings.push(`does not draw: ${String(e).slice(0, 120)}`);
        continue;
      }
      if (!hasInk(scene)) d.findings.push(`draws nothing (warnings: ${scene.warnings.join(" | ") || "none"})`);
      const { container } = render(<PlotFigure scene={scene} />);
      const legend = checkLegendKeys(scene, container, "");
      d.findings.push(...legend.bad.map((b) => `legend key: ${b.replace(/^ \| /, "")}`), ...legend.misaligned.map((b) => `legend keys misaligned: ${b.replace(/^ \| /, "")}`));
      d.svg = container.querySelector("svg.gfx-figure")?.outerHTML ?? "";
      cleanup();
    }
  }
  const withSvg = drawn.filter((d) => d.svg);
  const text = await insp.inspect(withSvg.map((d) => d.svg), ROOT_CSS);
  withSvg.forEach((d, i) => d.findings.push(...text[i]!.map((f) => `${f.kind === "clash" ? "text clash" : "cut text"}: ${f.what}`)));

  expect(drawn.length, "almost nothing was drawn — the variant generator is broken").toBeGreaterThan(200);
  const report = drawn.flatMap((d) => d.findings.map((f) => `${d.chart} · ${d.shape} · ${f}`));
  expect(report, `anomalies:\n  - ${report.join("\n  - ")}\n`).toEqual([]);
}, 600_000);
