// @vitest-environment jsdom
// Guards for graphs and datasheets: measured dead-control registries, timeline
// tracks, bump-chart stage ticks and datasheet formats.
import { describe, expect, it } from "vitest";

/**
 * A 20s clock for the kind-by-kind test below — the same remedy, for the same reason, as
 * `AppShell.test.tsx`'s GALLERY_TIMEOUT and `GuidePane.test.tsx`'s GUIDE_TIMEOUT.
 *
 * The FRAME_DEAD_KINDS test renders every chart kind twice and takes about 1.4 s run alone.
 * The default 5000 ms clock is under four times that cost, so under the full suite, with
 * workers competing for the CPU, it can time out even though it passes when run on its own.
 *
 * Note: this changes the time allowed, not what is asserted. The bound is still real: at
 * 20s a hang fails, and so does a renderer that becomes ten times slower.
 */
const SWEEP_TIMEOUT = 20_000;
import { readFileSync } from "fs";
import { resolve } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { MadyDocument, TABLE_FORMATS, TABLE_FORMAT_ORDER, validateTable } from "@mady/core";
import type { DataTable, Plot, TableKind } from "@mady/core";
import { galleryItems, galleryLookup } from "./gallery";
import { FRAME_DEAD_KINDS, NO_MARKER_KINDS } from "./deadControls";
import { createNewGraph, hasInk, NEW_GRAPH_GENRES } from "./newGraph";
import { seedPlotStyle } from "./seedStyle";
import { methodFitsKind } from "./analyzeGoals";
import { GUIDE } from "./guide";

const SIZE = { width: 640, height: 460 };
const kinds = [...new Set(galleryItems().map((g) => g.plot.kind ?? "xy"))];
const firstCard = (kind: string) => galleryItems().find((g) => (g.plot.kind ?? "xy") === kind)!;
/** The scene's drawing, minus the text that a warning or an id would add. */
const ink = (t: DataTable, p: Plot, lookup?: (id: string) => DataTable | undefined): string => {
  // Note: the drawing, not the scene. A scene can carry a field (a series' symbol, say) that its
  // renderer never draws for this kind, and hashing the scene then reads "moved" for a control
  // that changes nothing on the page (the banded ridgeline is one such case).
  const s = buildPlotScene(t, p, { ...SIZE, ...(lookup ? { tables: lookup } : {}) });
  return renderToStaticMarkup(createElement(PlotFigure, { scene: s, zoom: 1 }));
};

// ── Dead Frame section / marker rows: the registries are measured ─────────────────────────────
describe("measured dead-control registries", () => {
  it("FRAME_DEAD_KINDS = exactly the kinds whose drawing ignores frame, tick direction/length and gridlines", () => {
    const dead: string[] = [];
    for (const kind of kinds) {
      const c = firstCard(kind);
      const t = c.table as DataTable, p = c.plot as Plot, lk = galleryLookup(c);
      const base = ink(t, p, lk);
      const moved =
        ink(t, { ...p, frame: (p.frame ?? "lshape") === "box" ? "none" : "box" } as Plot, lk) !== base ||
        ink(t, { ...p, tickDir: (p.tickDir ?? "out") === "in" ? "out" : "in" } as Plot, lk) !== base ||
        ink(t, { ...p, tickLen: (p.tickLen ?? 5) + 9 } as Plot, lk) !== base ||
        ink(t, { ...p, grid: { ...(p.grid ?? {}), show: !(p.grid?.show ?? false), minor: true } } as Plot, lk) !== base;
      if (!moved) dead.push(kind);
    }
    // heatmap is handled by its own matrix/hexbin switch in the Inspector, not by this registry.
    const measured = dead.filter((k) => k !== "heatmap").sort();
    expect(Object.keys(FRAME_DEAD_KINDS).sort(), `measured frame-dead kinds: ${measured.join(", ")}`).toEqual(measured);
  }, SWEEP_TIMEOUT);

  it("NO_MARKER_KINDS = exactly the kinds whose drawing ignores marker shape/size (among those the series panel falls through for)", () => {
    // Kinds with their own series-panel branch (bar, box, violin, xy, area …) are not measured
    // here: their rows are curated. The fallback branch is what this registry gates.
    //
    // Caution: this list is an escape hatch. A kind listed here without a series-panel branch
    // of its own is never measured, so dead marker rows on it go undetected. Add a kind only
    // together with the branch that curates it.
    // `dead-panel-sections.test.tsx` asks the same question of every kind, from the panel a
    // user can actually open, with no list to be absent from.
    const curated = new Set(["bar", "histogram", "box", "floatingbar", "violin", "raincloud", "scatter", "beforeafter", "area", "xy", "bubble", "volcano", "pie", "radar", "heatmap", "estimation", "pyramid", "forest", "lollipop", "paireddot", "rose", "network", "ternary", "pcascore", "pcaload", "pcabiplot", "scree", "manhattan", "qq", "funnel", "blandaltman"]);
    const dead: string[] = [];
    for (const kind of kinds) {
      if (curated.has(kind)) continue;
      const c = firstCard(kind);
      const t = c.table as DataTable, p = c.plot as Plot, lk = galleryLookup(c);
      const s = buildPlotScene(t, p, { ...SIZE, tables: lk });
      const id = s.series[0]?.id ?? t.columns[1]?.id ?? t.columns[0]!.id;
      // Note: compares two styled variants that differ only in the marker fields. Comparing
      // against the bare card measures the wrong thing: an unstyled series inherits its siblings'
      // house look, and the mere presence of a style entry re-resolves the whole series (fill,
      // outline, line width…), so a kind that ignores markers would still read as "moved" (the
      // banded ridgeline card is one such case).
      const withMarker = (symbol: "square" | "circle", symbolSize: number): Plot =>
        ({ ...p, seriesStyles: { ...(p.seriesStyles ?? {}), [id]: { ...(p.seriesStyles?.[id] ?? {}), symbol, symbolSize } } });
      if (ink(t, withMarker("square", 14), lk) === ink(t, withMarker("circle", 6), lk)) dead.push(kind);
    }
    expect(Object.keys(NO_MARKER_KINDS).sort(), `measured marker-less kinds: ${dead.sort().join(", ")}`).toEqual(dead.sort());
  });
});

// ── Timeline tracks ──────────────────────────────────────────────────────────────────────────
describe("timeline tracks", () => {
  const c = firstCard("tracks");
  const scene = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
  it("two stacked colour bars leave a label's height between them", () => {
    const bars = scene.tracks!.strips.filter((s) => s.colorbar).map((s) => s.colorbar!);
    expect(bars.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < bars.length; i++) {
      const gap = bars[i]!.y - (bars[i - 1]!.y + bars[i - 1]!.h);
      expect(gap, `bars ${i - 1}/${i} are ${gap}px apart — their end labels collide`).toBeGreaterThanOrEqual(scene.fonts.legend.size);
    }
  });
  it("the time axis opens at the first tile's edge, not a nice-rounded negative week", () => {
    expect(scene.x.domain[0]).toBeGreaterThanOrEqual(-0.5 - 1e-9);
    expect(scene.x.domain[0]).toBeLessThan(0);
  });
  it("a categorical track's key is a fill block, like a bar's", () => {
    expect(scene.legend.length).toBeGreaterThan(0);
    for (const e of scene.legend) expect(e.swatch).toBe("bar");
  });
});

// ── Bump chart stage ticks ───────────────────────────────────────────────────────────────────
describe("bump chart", () => {
  it("integer stages tick on whole numbers only", () => {
    const c = galleryItems().find((g) => (g.plot as Plot).plotRanks)!;
    const scene = buildPlotScene(c.table as DataTable, c.plot as Plot, SIZE);
    const majors = scene.x.ticks.filter((t) => !t.minor).map((t) => t.value);
    expect(majors.length).toBeGreaterThanOrEqual(3);
    for (const v of majors) expect(Number.isInteger(v), `stage tick at ${v}`).toBe(true);
  });
});

// ── Datasheet formats ────────────────────────────────────────────────────────────────────────
describe("datasheet formats", () => {
  // The first occurrence per id is the METHODS catalogue entry (later ones are tiles / variants).
  const METHOD_LABELS: Record<string, string> = {};
  for (const m of readFileSync(resolve(process.cwd(), "apps/desktop/src/renderer/src/shell/AnalyzeDialog.tsx"), "utf8").matchAll(/id: "([a-z0-9-]+)", label: "([^"]+)"/g)) {
    if (!(m[1]! in METHOD_LABELS)) METHOD_LABELS[m[1]!] = m[2]!;
  }
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

  it("every method a format's badge names is a real method that Analyze ranks as suited to that format", () => {
    // Suitedness the way Analyze decides it (`methodFitsKind`), so a format that suits through
    // another card's methods (pca ← multivariable) is judged the same way the dialog judges it.
    for (const k of TABLE_FORMAT_ORDER) {
      const suited = Object.entries(METHOD_LABELS).filter(([id]) => methodFitsKind(id, k)).map(([, l]) => norm(l));
      for (const phrase of TABLE_FORMATS[k].analyses) {
        const p = norm(phrase);
        const hit = suited.some((l) => l.includes(p) || p.includes(l));
        expect(hit, `${k}: the badge names "${phrase}" but no suited method's label matches (suited: ${suited.join(" | ") || "none"})`).toBe(true);
      }
      if (suited.length === 0) expect(TABLE_FORMATS[k].analyses, `${k} advertises analyses although Analyze suits none`).toEqual([]);
    }
  });

  it("every genre draws with ink and no warning on every format it lists, once four rows are typed", () => {
    const failures: string[] = [];
    for (const g of NEW_GRAPH_GENRES) {
      if (g.analysis) continue; // analysis-fed: the graph appears when the analysis runs
      for (const fmt of g.formats) {
        const doc = new MadyDocument();
        const { table, plot } = createNewGraph(doc, { genre: g.key, tableKind: fmt as TableKind });
        if (!plot) continue;
        seedPlotStyle(doc, plot.id, plot.kind);
        const t0 = doc.toJSON().tables.find((x) => x.id === table.id)!;
        // Typed rows: a text label in the lead column of the category formats; numbers
        // everywhere else (an XY / survival sheet's X is numeric).
        const explicitLead = t0.columns.findIndex((c) => c.role === "x");
        const numericLead = fmt === "xy" || fmt === "survival";
        const lead = explicitLead >= 0 ? explicitLead : (["multivariable", "pca", "column"].includes(fmt) ? -1 : 0);
        for (let i = 0; i < 4; i++) {
          // Plausible numbers by column name: a P-value in (0, 1), a fold change around 0 — so a
          // kind's own guide lines (volcano thresholds) fall inside the axis, as with real data.
          const num = (name: string, v: number): number =>
            /log10 ?p/i.test(name) ? [0.5, 1.4, 3.3, 0.7][i]!
            : /p[-_ ]?val|^p$|p-value/i.test(name) ? [0.3, 0.04, 0.0005, 0.2][i]!
            : /fold|log2/i.test(name) ? [-2.5, 0.4, 3.1, -0.8][i]!
            : /change/i.test(name) ? [-45, -10, 25, 60][i]!
            : v;
          doc.addRow(table.id, t0.columns.map((c, j) => (j === lead && !numericLead ? `S${i + 1}` : c.type === "text" ? `T${(i + j) % 3}` : num(c.name, j === lead ? i + 1 : 10 + i * 7 + j * 3))) as never);
        }
        const json = doc.toJSON();
        const t = json.tables.find((x) => x.id === table.id)!;
        const p = json.plots.find((x) => x.id === plot.id)!;
        const s = buildPlotScene(t, p, { ...SIZE, tables: (id) => json.tables.find((x) => x.id === id) });
        // Four typed rows is few for a box (< 5) or a violin (< 10), and the builder states those limits in a warning
        // ("“A” has 4 values — too few for a box plot …"). That warning reports the data correctly and is not a format
        // failure; it is allowed only when it is true (the count it names is below the limit it names).
        // Every other warning still fails here.
        const smallGroup = /^“.+” has (\d+) values? — too few for .+ \((\d+) or more (?:recommended|needed)\)\.(?: This concerns the drawing only; statistics on these values are not affected\.)?$/;
        const other = s.warnings.filter((w) => {
          const m = smallGroup.exec(w);
          return !m || !(Number(m[1]) < Number(m[2]));
        });
        if (!hasInk(s) || other.length) failures.push(`${g.key}/${fmt}: ink=${hasInk(s)} warnings=${other.join(" | ") || "none"}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("sets and association sheets are validated", () => {
    const sets: DataTable = { id: "s", kind: "sets", name: "S", columns: [{ id: "i", name: "Item" }, { id: "a", name: "A" }], rows: [{ id: "r", cells: { i: "g1", a: "maybe" } }] };
    expect(validateTable(sets).some((w) => /neither in nor out/i.test(w))).toBe(true);
    const assoc: DataTable = {
      id: "a", kind: "association", name: "A",
      columns: [{ id: "m", name: "Marker", role: "x" }, { id: "c", name: "Chromosome" }, { id: "p", name: "Position" }, { id: "v", name: "P-value" }],
      rows: [{ id: "r1", cells: { m: "rs1", c: 1, p: -5, v: 1.7 } }, { id: "r2", cells: { m: "rs2", c: 1, p: 100, v: 0.01 } }],
    };
    const w = validateTable(assoc);
    expect(w.some((x) => /P-value/.test(x) && /0–1/.test(x))).toBe(true);
    expect(w.some((x) => /position/i.test(x) && /negative/.test(x))).toBe(true);
    expect(validateTable({ ...assoc, rows: [assoc.rows[1]!] })).toEqual([]);
  });

  it("the guide states the real number of datasheet formats", () => {
    const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
    const prose = GUIDE.map((s) => `${s.title} ${s.summary} ${JSON.stringify(s)}`).join("\n").toLowerCase();
    expect(prose).toContain(`${words[TABLE_FORMAT_ORDER.length]} shapes of datasheet`);
    expect(prose).not.toMatch(/\beight shapes\b/);
    expect(prose).not.toMatch(/and five more\)/);
  });
});
