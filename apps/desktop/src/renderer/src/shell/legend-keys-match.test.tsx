// @vitest-environment jsdom
/**
 * Every legend key looks like the mark it names — on every gallery card and every graph of the demo project. No
 * line in the legend when the graph draws none; two-tone dots get two-tone keys; the volcano's keys match its points.
 *
 * Read off the drawing. A row's marks are the elements whose hover text names the row, the visible mark centred on each
 * (hover text sits on invisible hit circles), everything in the same series group, a radar polygon's corner dots, and
 * the stems / connectors ending at its dots. Then: the key draws a line only if the marks do, a dot only if they do,
 * and the dot / block carries their fill, edge and (when the dots share one size) their size.
 * A row no mark names cannot be compared here; those chart types are listed in UNNAMED and checked one by one below.
 * It fails on, for example: solid keys beside two-tone dots (radar, lollipop, paired dot); a radar key larger than its
 * dots; a line through a point-only key; dot keys on the pyramid's bars and the treemap's cells.
 */
import { describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { createSampleDocument } from "@mady/core";
import type { DataTable, Plot } from "@mady/core";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import { checkLegendKeys, UNNAMED_LEGEND_KINDS } from "./legendKeyCheck";

const UNNAMED = UNNAMED_LEGEND_KINDS;

describe("every legend key looks like the marks it names (gallery + demo project)", () => {
it("sweep", { timeout: 60_000 }, () => {
  const cards: Array<{ src: string; title: string; table: DataTable; plot: Plot; tables?: DataTable[] }> = galleryItems().map((g) => ({ src: "gallery", title: g.title, table: g.table, plot: g.plot }));
  const demo = createSampleDocument().toJSON();
  for (const p of demo.plots) {
    const t = demo.tables.find((x) => x.id === p.source);
    if (t) cards.push({ src: "demo", title: p.name, table: t, plot: p, tables: demo.tables });
  }
  const bad: string[] = [];
  const misaligned: string[] = [];
  const unchecked = new Map<string, number>();
  let checked = 0;
  for (const c of cards) {
    let scene;
    try { scene = buildPlotScene(c.table, c.plot, { width: 580, height: 380, ...(c.tables ? { tables: (id: string) => c.tables!.find((t) => t.id === id) } : {}) }); } catch { continue; }
    const { container } = render(<PlotFigure scene={scene} />);
    const r = checkLegendKeys(scene, container, `${c.src} | ${c.title}`);
    bad.push(...r.bad);
    misaligned.push(...r.misaligned);
    checked += r.checked;
    if (r.unchecked > 0) unchecked.set(`${c.src}:${scene.kind}`, (unchecked.get(`${c.src}:${scene.kind}`) ?? 0) + r.unchecked);
    cleanup();
  }
  expect(checked, "the sweep compared almost nothing — the mark matching is broken").toBeGreaterThanOrEqual(55);
  expect(bad, `keys that do not match their marks:\n${bad.join("\n")}`).toEqual([]);
  expect(misaligned, `legends whose keys are not on one centre line:\n${misaligned.join("\n")}`).toEqual([]);
  // A chart type whose rows could not be compared must be one checked by name below — never a silent skip. (bar,
  // ternary, swimmer, roc, qq: one row each whose name is not in the marks' hover text; their other rows are compared.)
  const stray = [...unchecked.keys()].map((k) => k.split(":")[1]!).filter((k) => !UNNAMED.has(k) && !["bar", "ternary", "swimmer", "roc", "qq"].includes(k));
  expect(stray, "a chart type's keys went unchecked").toEqual([]);
});
});

describe("the chart types whose marks do not name their rows", () => {
  const scene = (kind: string) => {
    const g = galleryItems().find((x) => x.plot.kind === kind)!;
    const s = buildPlotScene(g.table, g.plot, { width: 580, height: 380 });
    return { s, container: render(<PlotFigure scene={s} />).container };
  };
  it("volcano: each zone's key is that zone's dot — two-tone, its size, no line", () => {
    const { s, container } = scene("volcano");
    const rows = [...container.querySelectorAll("[data-mady-legend-row]")];
    expect(rows.length).toBe(3);
    s.legend.forEach((e, i) => {
      const m = s.series.flatMap((x) => x.marks).find((k) => k.fill === e.color)!;
      const dot = rows[i]!.querySelector("circle")!;
      expect(rows[i]!.querySelector("line"), `${e.label}: a line the volcano never draws`).toBeNull();
      expect(dot.getAttribute("fill"), `${e.label}: fill`).toBe(m.symbolFillColor);
      expect(dot.getAttribute("stroke"), `${e.label}: edge`).toBe(m.symbolOutline);
      expect(Number(dot.getAttribute("r"))).toBeCloseTo(m.symbolSize ?? s.series[0]!.symbolSize);
    });
    cleanup();
  });
  for (const [kind, shape] of [["rose", "path"], ["sunburst", "path"], ["treemap", "rect"], ["ridgeline", "rect"], ["tracks", "rect"], ["oncoprint", "rect"]] as const) {
    it(`${kind}: filled marks, so each key is a filled ${shape === "path" ? "wedge" : "block"} — no line, no dot`, () => {
      const { s, container } = scene(kind);
      const rows = [...container.querySelectorAll("[data-mady-legend-row]")];
      expect(rows.length, `${kind} draws no legend`).toBeGreaterThan(0);
      rows.forEach((r, i) => {
        const k = r.querySelector(".gfx-legbar");
        expect(k?.tagName.toLowerCase(), `${kind} "${s.legend[i]!.label}": key`).toBe(shape);
        expect(r.querySelector("line, circle"), `${kind} "${s.legend[i]!.label}": a line or dot`).toBeNull();
      });
      cleanup();
    });
  }
  it("swimmer: Response is a band inside the bars, so its key is a filled block — no line, no dot", () => {
    const { s, container } = scene("swimmer");
    const i = s.legend.findIndex((e) => e.label === "Response");
    expect(i, "the swimmer card shows no Response band — the fixture proves nothing").toBeGreaterThanOrEqual(0);
    const row = container.querySelectorAll("[data-mady-legend-row]")[i]!;
    expect(row.querySelector(".gfx-legbar")?.tagName.toLowerCase()).toBe("rect");
    expect(row.querySelector("line, circle")).toBeNull();
    cleanup();
  });
  it("parallel coordinates: lines, no dots — each key is the line alone", () => {
    const { container } = scene("parallel");
    for (const r of container.querySelectorAll("[data-mady-legend-row]")) {
      expect(r.querySelector("line")).not.toBeNull();
      expect(r.querySelector("circle, polygon")).toBeNull();
    }
    cleanup();
  });
  it("network: node-colour keys are dots with no line; link keys are lines", () => {
    const { s, container } = scene("network");
    [...container.querySelectorAll("[data-mady-legend-row]")].forEach((r, i) => {
      const links = /links$/.test(s.legend[i]!.label);
      expect(!!r.querySelector("line"), `${s.legend[i]!.label}: line`).toBe(links);
      expect(!!r.querySelector("circle"), `${s.legend[i]!.label}: dot`).toBe(!links);
    });
    cleanup();
  });
});

describe("an area drawn without points keys as its filled block", () => {
  // A stream graph (or any area series with no point markers) draws a filled area under a thin
  // edge; a line-only key names only the edge, so its rows read as line series.
  const stream = galleryItems().find((g) => g.key === "stream")!;
  it("the stream graph's rows are filled blocks in the series' fill, without a line", () => {
    const scene = buildPlotScene(stream.table, stream.plot, { width: 760, height: 460 });
    const rows = scene.legend.filter((e) => e.select?.as === "series");
    expect(rows.length, "the fixture keys its series").toBeGreaterThan(2);
    for (const e of rows) {
      const s = scene.series.find((x) => x.id === e.select!.id)!;
      expect(s.areaPath, `${e.label}: the fixture draws an area`).toBeTruthy();
      expect(e.swatch, `${e.label}`).toBe("bar");
      expect(e.line).toBe(false);
    }
  });
  it("an area series that shows its points keeps its line-and-dot key", () => {
    const area = galleryItems().find((g) => g.key === "area")!;
    const scene = buildPlotScene(area.table, { ...area.plot, legend: { show: true } } as Plot, { width: 580, height: 380 });
    const s = scene.series[0]!;
    expect(s.areaPath && s.symbol !== "none", "the fixture draws an area with its points").toBeTruthy();
    const row = scene.legend.find((e) => e.select?.as === "series");
    if (row) expect(row.swatch).toBeUndefined();
  });
});
