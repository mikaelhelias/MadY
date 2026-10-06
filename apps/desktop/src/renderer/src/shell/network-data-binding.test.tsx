// @vitest-environment jsdom
/**
 * Correlation / co-occurrence network: data-driven binding + legends.
 *
 * Besides hand-set override maps (per-node colours/sizes, per-link colours), a typical
 * correlation-network figure needs the channels driven by data:
 *
 *  • node colour from a category column (phylum)      → `network.groupColumn`  + a group legend
 *  • node size   from a numeric column (abundance)    → `network.sizeColumn`
 *  • edge colour from the weight's sign (+red / −blue)→ `network.edgeSignColors` + a sign legend
 *  • edge width  from the weight's magnitude          → |weight|
 *
 * Guards against:
 *  1. `buildGraph` coercing a weight ≤ 0 to 1 — a correlation edge list with rho = −0.8
 *     would lose both its sign (uncolourable) and its magnitude (drawn at width-for-1).
 *  2. Node colour and size following only one numeric ramp, with no group/size binding.
 *  3. A categorical grouping drawn without a key (only the value-ramp bar, no standard legend).
 *
 * The legends reuse the standard legend machinery (`resolveLegend` + the shared <Legend>),
 * so position/orientation/font/symbol-scale controls and legend dragging come for free —
 * rows target the "Network graph" section (the volcano/rose SECTION_ROWS rule).
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { MadyDocument, TABLE_FORMATS, validateTable } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { NEW_GRAPH_GENRES, createNewGraph } from "./newGraph";
import { rankGoals } from "./analyzeGoals";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

const SIZE = { width: 620, height: 420 };

/** A small co-occurrence edge list: signed rho, a phylum-style group column, an
 *  abundance column. Node F appears only as a target, so it carries no group and no
 *  abundance — the no-data cases. */
const corrT: DataTable = {
  id: "net", kind: "multivariable", name: "Co-occurrence",
  columns: [
    { id: "s", name: "Source" }, { id: "t2", name: "Target" },
    { id: "rho", name: "Rho" }, { id: "grp", name: "Phylum" }, { id: "ab", name: "Abundance" },
  ],
  rows: [
    { id: "r1", cells: { s: "A", t2: "B", rho: 0.7, grp: "Alpha", ab: 9 } },
    { id: "r2", cells: { s: "B", t2: "C", rho: 0.5, grp: "Alpha", ab: 6 } },
    { id: "r3", cells: { s: "C", t2: "A", rho: 0.4, grp: "Alpha", ab: 4 } },
    { id: "r4", cells: { s: "D", t2: "E", rho: 0.6, grp: "Beta", ab: 8 } },
    { id: "r5", cells: { s: "E", t2: "F", rho: -0.5, grp: "Beta", ab: 3 } },
    { id: "r6", cells: { s: "A", t2: "D", rho: -0.8, grp: "Alpha", ab: 9 } },
  ],
};

const mkPlot = (network?: Plot["network"]): Plot => ({
  id: "p", name: "P", source: "net", status: "ok", styleOverrides: {}, kind: "network",
  ...(network ? { network } : {}),
});

const scene = (network?: Plot["network"]) => buildPlotScene(corrT, mkPlot(network), SIZE);
const edge = (s: ReturnType<typeof scene>, id: string) => s.network!.edges.find((e) => e.id === id)!;
const node = (s: ReturnType<typeof scene>, id: string) => s.network!.nodes.find((n) => n.id === id)!;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Signed weights: magnitude drives width, sign drives colour (opt-in).
// ─────────────────────────────────────────────────────────────────────────────
describe("network — signed edge weights", () => {
  it("a negative weight keeps its magnitude: |−0.8| draws wider than |−0.5| and wider than +0.7", () => {
    // Guards against both negative edges being coerced to weight 1 and drawn at the width
    // for 1 — i.e. wider than the +0.7 edge and equal to each other.
    const s = scene();
    const wide = edge(s, "A→D"); // rho −0.8, the strongest link in the table
    const mid = edge(s, "A→B"); // rho +0.7
    const thin = edge(s, "E→F"); // rho −0.5
    expect(wide.width).toBeGreaterThan(mid.width);
    expect(mid.width).toBeGreaterThan(thin.width);
  });

  it("sign colouring off (the default): every edge keeps the shared colour — no saved figure changes", () => {
    const s = scene();
    const colors = new Set(s.network!.edges.map((e) => e.color));
    expect([...colors]).toEqual(["#5b6470"]);
  });

  it("sign colouring on: positive edges red, negative edges blue, per-link override still wins", () => {
    const s = scene({ edgeSignColors: true, edgeColors: { "B→C": "#00ff00" } });
    expect(edge(s, "A→B").color).toBe("#c0392b"); // +0.7 → positive default
    expect(edge(s, "A→D").color).toBe("#3b6fb0"); // −0.8 → negative default
    expect(edge(s, "B→C").color).toBe("#00ff00"); // hand-set beats the sign
  });

  it("the sign colours are tunable", () => {
    const s = scene({ edgeSignColors: true, edgePositiveColor: "#111111", edgeNegativeColor: "#222222" });
    expect(edge(s, "A→B").color).toBe("#111111");
    expect(edge(s, "A→D").color).toBe("#222222");
  });

  it("an unweighted edge list with sign colouring on stays the shared colour (sign unknown ≠ positive)", () => {
    const bare: DataTable = {
      ...corrT,
      columns: corrT.columns.slice(0, 2),
      rows: corrT.rows.map((r) => ({ ...r, cells: { s: r.cells.s!, t2: r.cells.t2! } })),
    };
    const s = buildPlotScene(bare, mkPlot({ edgeSignColors: true }), SIZE);
    expect(new Set(s.network!.edges.map((e) => e.color)).size).toBe(1);
    expect(s.network!.edges[0]!.color).toBe("#5b6470");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Node groups: categorical colour from a column.
// ─────────────────────────────────────────────────────────────────────────────
describe("network — node groups from a column", () => {
  it("nodes of one group share a palette colour; groups differ; an ungrouped node goes no-data grey", () => {
    const s = scene({ groupColumn: "grp" });
    const a = node(s, "A"); const b = node(s, "B"); const c = node(s, "C");
    const d = node(s, "D"); const e = node(s, "E"); const f = node(s, "F");
    expect(a.color).toBe(b.color);
    expect(b.color).toBe(c.color);
    expect(d.color).toBe(e.color);
    expect(a.color).not.toBe(d.color);
    // F never leads a row → no group → the same no-data grey the value ramp uses.
    expect(f.color).toBe("#cfd3d8");
  });

  it("a hand-recoloured node still wins over its group colour", () => {
    const s = scene({ groupColumn: "grp", nodeColors: { A: "#123456" } });
    expect(node(s, "A").color).toBe("#123456");
    expect(node(s, "B").color).not.toBe("#123456");
  });

  it("binding groups suppresses the value-ramp legend (colour no longer encodes the value)", () => {
    expect(scene().network!.valueLegend, "control: the ramp legend exists when unbound").toBeTruthy();
    expect(scene({ groupColumn: "grp" }).network!.valueLegend).toBeUndefined();
  });

  it("a stale group-column id is refused with a warning and the binding ignored", () => {
    const s = scene({ groupColumn: "gone" });
    expect(s.warnings.join(" ")).toMatch(/group column/i);
    // colours fall back to the value ramp — A (ab 9, max) ≠ E (ab 3)
    expect(node(s, "A").color).not.toBe(node(s, "E").color);
    expect(s.network!.valueLegend).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Node size from a metric column.
// ─────────────────────────────────────────────────────────────────────────────
describe("network — node size from a column", () => {
  it("size follows the metric, not the degree: D (abundance 8) outranks B (abundance 6) though degrees tie", () => {
    const s = scene({ sizeColumn: "ab" });
    const d = node(s, "D"); const b = node(s, "B");
    expect(d.degree, "fixture: D and B must tie on degree or this proves nothing").toBe(b.degree);
    expect(d.r).toBeGreaterThan(b.r);
    expect(node(s, "A").r).toBeGreaterThan(d.r); // abundance 9 = the biggest
  });

  it("a node with no metric draws at the range floor; a hand-set radius still wins", () => {
    const s = scene({ sizeColumn: "ab", nodeSizes: { A: 3 } });
    const rs = s.network!.nodes.map((n) => n.r);
    expect(node(s, "F").r).toBe(Math.min(...rs.filter((_r, i) => s.network!.nodes[i]!.id !== "A")));
    expect(node(s, "A").r).toBe(3);
  });

  it("a size column with no numeric values is refused with a warning and degree sizing returns", () => {
    const s = scene({ sizeColumn: "grp" });
    expect(s.warnings.join(" ")).toMatch(/size column/i);
    // degree sizing back in force: A (deg 3) bigger than B (deg 2)
    expect(node(s, "A").r).toBeGreaterThan(node(s, "B").r);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. The legends — standard machinery, drawn, clickable, room reserved.
// ─────────────────────────────────────────────────────────────────────────────
describe("network — group + sign legends", () => {
  const bound: Plot["network"] = { groupColumn: "grp", edgeSignColors: true };

  it("legend rows = the groups (dot swatch) + the signs that exist (line swatch), all targeting the Network graph section", () => {
    const s = scene(bound);
    expect(s.legend.map((e) => e.label)).toEqual(["Alpha", "Beta", "Positive links", "Negative links"]);
    const [alpha, beta, pos, neg] = s.legend;
    expect(alpha!.color).toBe(node(s, "A").color);
    expect(beta!.color).toBe(node(s, "D").color);
    expect(pos!.color).toBe("#c0392b");
    expect(neg!.color).toBe("#3b6fb0");
    for (const row of s.legend) expect(row.select).toEqual({ as: "section", id: "Network graph" });
    // groups read as nodes (a filled dot), signs as links (a line-only stub)
    expect(alpha!.symbol).toBe("circle");
    expect(pos!.symbol).toBeUndefined();
    expect(pos!.marker).toBe(false);
  });

  it("only the signs that exist get a row — an all-positive graph shows no 'Negative links'", () => {
    const posOnly: DataTable = { ...corrT, rows: corrT.rows.filter((r) => Number(r.cells.rho) > 0) };
    // One row alone auto-hides (resolveLegend's ≥2 convention) — force the legend on so
    // the claim under test is the rows, not the auto-show threshold.
    const s = buildPlotScene(posOnly, { ...mkPlot({ edgeSignColors: true }), legend: { show: true } }, SIZE);
    expect(s.legend.map((e) => e.label)).toEqual(["Positive links"]);
  });

  it("an unbound network still resolves no legend — nothing changes for saved figures", () => {
    const s = buildPlotScene(corrT, { ...mkPlot(), legend: { show: true } }, SIZE);
    expect(s.legend).toEqual([]);
  });

  it("the legend reserves outside-right room (the plot narrows) and is drawn with clickable rows", () => {
    const s = scene(bound);
    expect(s.legend.length, "auto-show: ≥2 entries").toBeGreaterThan(1);
    expect(s.plot.width).toBeLessThan(scene().plot.width);
    const picks: GraphSelection[] = [];
    const { container } = render(<PlotFigure scene={s} zoom={1} onSelect={(sel) => picks.push(sel)} />);
    const text = container.textContent ?? "";
    for (const e of s.legend) expect(text.includes(e.label), `legend row "${e.label}" never reached the figure`).toBe(true);
    const row = container.querySelector("g.gfx-legend [data-mady-legend-row]");
    expect(row, "no legend row in the drawing").not.toBeNull();
    fireEvent.click(row!);
    expect(picks).toEqual([{ kind: "chart-section", title: "Network graph" }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. The Inspector — controls exist, in the Network graph section; the Legend section
//    offers its controls only when a binding gives the legend rows, and otherwise explains
//    how to get a legend.
// ─────────────────────────────────────────────────────────────────────────────
const handlers = () => ({
  onSelect: vi.fn(), onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

function renderInspector(network?: Plot["network"], selection: GraphSelection = { kind: "plot" }) {
  const h = handlers();
  return { ...render(<Inspector activeSection="graphs" selection={selection} plot={mkPlot(network)} table={corrT} userPresets={[]} profileDefault={null} {...h} />), h };
}

const labelTexts = (container: HTMLElement): string[] =>
  [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")].map((e) => (e.textContent ?? "").trim()).filter(Boolean);

describe("network — Inspector controls for the bindings", () => {
  it("the Network graph section offers the three binding controls", () => {
    const { container } = renderInspector();
    const l = labelTexts(container);
    expect(l).toContain("Colour nodes by");
    expect(l).toContain("Size nodes by");
    expect(l).toContain("Colour links by sign");
  });

  it("the column selects offer the data columns but never the two endpoints", () => {
    const { container } = renderInspector();
    const sel = [...container.querySelectorAll<HTMLSelectElement>("select")].find((s) =>
      [...s.options].some((o) => o.textContent === "Phylum"));
    expect(sel, "no select offers the Phylum column").toBeTruthy();
    const names = [...sel!.options].map((o) => o.textContent);
    expect(names).toContain("Abundance");
    expect(names).not.toContain("Source");
    expect(names).not.toContain("Target");
  });

  it("the sign-colour pickers appear only once sign colouring is on — no dead controls", () => {
    expect(labelTexts(renderInspector().container)).not.toContain("Link + / −");
    expect(labelTexts(renderInspector({ edgeSignColors: true }).container)).toContain("Link + / −");
  });

  it("Size by degree hides while a size column owns the channel (it would be a misleading control)", () => {
    expect(labelTexts(renderInspector().container)).toContain("Size by degree");
    expect(labelTexts(renderInspector({ sizeColumn: "ab" }).container)).not.toContain("Size by degree");
  });

  it("the Legend section offers its controls only when a binding gives it rows, the explanation otherwise", () => {
    const off = renderInspector().container;
    expect(labelTexts(off)).not.toContain("Position");
    const heading = [...off.querySelectorAll(".inspsub")].find((e) => (e.textContent ?? "").trim() === "Legend");
    const hint = heading?.nextElementSibling?.classList.contains("hint") ? heading.nextElementSibling.textContent ?? "" : "";
    expect(hint).toMatch(/group|sign/i); // the sentence tells the user how to get a legend
    cleanup();
    const on = renderInspector({ groupColumn: "grp" }).container;
    expect(labelTexts(on)).toContain("Position");
  });

  it("the section the legend rows target exists and has controls (a legend row must not open an empty panel)", () => {
    const { container } = renderInspector({ groupColumn: "grp" }, { kind: "chart-section", title: "Network graph" });
    const secs = [...container.querySelectorAll<HTMLElement>("details.inspsec")]
      .filter((s) => (s.querySelector(":scope > summary")?.textContent ?? "").includes("Network graph"));
    expect(secs.length).toBeGreaterThan(0);
    expect(secs.flatMap((s) => [...s.querySelectorAll("input, select, button.swbtn")]).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. The "edgelist" table format — the network's own datasheet. An edge list's
//    rows are links, not cases: on the Multiple-variables format the Analyze door
//    would offer correlation matrix / PCA / regression over (weight, node-attribute)
//    columns — meaningless analyses, the same reason the swimmer plot has its own
//    format rather than the Column format.
// ─────────────────────────────────────────────────────────────────────────────
describe("network — the edgelist table format", () => {
  it("the format exists: accurate label, no statistics, the network as its graph", () => {
    const f = TABLE_FORMATS.edgelist;
    expect(f, "no 'edgelist' entry in TABLE_FORMATS").toBeTruthy();
    expect(f.label).toBe("Network (edge list)");
    expect(f.analyses).toEqual([]);
    // The same edge list draws the network graph and the chord/circos diagram.
    expect(f.graphs).toEqual(["Network graph", "Chord diagram"]);
    expect(f.seedColumns.slice(0, 2)).toEqual(["Source", "Target"]);
  });

  it("the Analyze door offers no applicable goal on an edgelist sheet — a drawing format", () => {
    expect(rankGoals("edgelist", []).filter((g) => g.applies)).toEqual([]);
  });

  it("the network genre's default sheet is edgelist; multivariable + xy sheets can still draw a network", () => {
    const genre = NEW_GRAPH_GENRES.find((g) => g.key === "network")!;
    expect(genre.formats[0]).toBe("edgelist");
    expect(genre.formats).toContain("multivariable");
    expect(genre.formats).toContain("xy");
  });

  it("the Multiple-variables format does not advertise the network — edgelist owns it", () => {
    expect(TABLE_FORMATS.multivariable.graphs).not.toContain("Network");
  });

  it("the gallery card uses the edge-list format and validates cleanly", () => {
    const card = galleryItems().find((g) => (g.plot.kind ?? "xy") === "network")!;
    expect(card.table.kind).toBe("edgelist");
    expect(validateTable(card.table)).toEqual([]);
  });

  it("validateTable explains the shape when the endpoints are missing (structural, non-blocking)", () => {
    const bare: DataTable = {
      id: "e1", kind: "edgelist", name: "E",
      columns: [{ id: "s", name: "Source" }],
      rows: [{ id: "r", cells: { s: "A" } }],
    };
    expect(validateTable(bare).join(" ")).toMatch(/source.*target/i);
  });

  it("a fresh 'New graph' network seeds an edgelist sheet with Source · Target · Weight", () => {
    const doc = new MadyDocument();
    const { table, plot } = createNewGraph(doc, { genre: "network", tableKind: "edgelist" });
    expect(table.kind).toBe("edgelist");
    expect(table.columns.map((c) => c.name).slice(0, 3)).toEqual(["Source", "Target", "Weight"]);
    expect(plot?.kind).toBe("network");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. The seed path: inserting the gallery card remaps the bindings to the fresh ids.
// ─────────────────────────────────────────────────────────────────────────────
describe("network — gallery card + insertGraph remap", () => {
  it("the gallery network card demos the full look (groups + sizes + sign edges)", () => {
    const card = galleryItems().find((g) => (g.plot.kind ?? "xy") === "network")!;
    expect(card.plot.network?.groupColumn).toBeTruthy();
    expect(card.plot.network?.sizeColumn).toBeTruthy();
    expect(card.plot.network?.edgeSignColors).toBe(true);
    const s = buildPlotScene(card.table, card.plot, SIZE);
    expect(s.warnings, "the card must not warn").toEqual([]);
    expect(s.legend.length, "the card draws its legend").toBeGreaterThan(2);
    expect(s.network!.edges.some((e) => e.color === "#3b6fb0"), "the card demos a negative link").toBe(true);
  });

  it("insertGraph rewrites groupColumn/sizeColumn to the new table's ids — a seeded graph must not warn", () => {
    const doc = new MadyDocument();
    const r = doc.insertGraph(corrT, mkPlot({ groupColumn: "grp", sizeColumn: "ab", edgeSignColors: true }));
    const grp = r.table.columns[3]!; const ab = r.table.columns[4]!;
    expect(grp.id).not.toBe("grp");
    expect(r.plot.network?.groupColumn).toBe(grp.id);
    expect(r.plot.network?.sizeColumn).toBe(ab.id);
    const s = buildPlotScene(r.table, r.plot, SIZE);
    expect(s.warnings).toEqual([]);
  });
});
