// @vitest-environment jsdom
/**
 * Import a ggplot script — the entry point, the report, and the graph it makes.
 *
 * The six canonical corpus scripts (53–58), each with a long datasheet of the shape the script
 * expects → the production create path (`applyGgplotImport`) → a built scene that draws, with
 * the kind and the options the script describes. Plus: the File menu offers the import, the
 * welcome page does not, the guide explains it, and the dialog refuses
 * to create anything until every named column is matched.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MadyDocument, bindGgplot, translateGgplot } from "@mady/core";
import type { DataTable, Project } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { GgplotImportDialog } from "./GgplotImportDialog";
import type { GgplotImportResult } from "./GgplotImportDialog";
import { applyGgplotImport } from "./ggplotApply";
import { buildActions } from "./actions";
import type { ActionHandlers } from "./actions";
import { GUIDE } from "./guide";
import { WelcomePane } from "./WelcomePane";
import { seedPlotStyle } from "./seedStyle";

afterEach(cleanup);

const CORPUS = join(__dirname, "..", "..", "..", "..", "..", "..", "docs", "ggplot-corpus");
const script = (n: number): string => {
  const f = readdirSync(CORPUS).find((x) => x.startsWith(String(n).padStart(2, "0") + "-"))!;
  return readFileSync(join(CORPUS, f), "utf8");
};
const long = (id: string, columns: string[], data: (string | number | null)[][]): DataTable => ({
  id, kind: "xy", name: id,
  columns: columns.map((n, i) => ({ id: `${id}c${i}`, name: n })),
  rows: data.map((r, i) => ({ id: `${id}r${i}`, cells: Object.fromEntries(columns.map((_, j) => [`${id}c${j}`, r[j] ?? null])) })),
});

// The long datasheets the six scripts point at.
const fourPL = (x: number, b: number, t: number, e: number, h: number): number => b + (t - b) / (1 + Math.pow(e / x, h));
const toothSummary = long("tg", ["supp", "dose", "len", "sd"], [["VC", 0.5, 7.98, 2.75], ["VC", 1, 16.77, 2.52], ["VC", 2, 26.14, 4.8], ["OJ", 0.5, 13.23, 4.46], ["OJ", 1, 22.7, 3.91], ["OJ", 2, 26.06, 2.66]]);
const doseResponse = long("dr", ["conc", "response", "compound"], [0.01, 0.1, 1, 10, 100, 1000].flatMap((c) => [["A", 4, 96, 2.8, 1.1], ["B", 6, 88, 41, 0.95]].flatMap(([n, b, t, e, h]) => [0, 1, 2].map((k) => [c, fourPL(c, b as number, t as number, e as number, h as number) + k - 1, `Compound ${n}`]))));
const expression = long("ex", ["group", "expression"], [21, 24, 19, 26, 22, 20].flatMap((v, i) => [["Control", v], ["Treated", v + 18 + i]]));
const zscores = long("hm", ["gene", "sample", "z"], ["TP53", "MYC", "EGFR", "KRAS"].flatMap((g, i) => ["S1", "S2", "S3"].map((s, j) => [g, s, Number((Math.sin(i * 1.3 + j) * 2.5).toFixed(2))])));
const effects = long("ef", ["term", "estimate"], [["Age", -0.8], ["Dose", 2.1], ["Sex", 0.4], ["BMI", -1.3]]);

function create(n: number, sheet: DataTable): { doc: MadyDocument; result: GgplotImportResult; plot: ReturnType<typeof applyGgplotImport>["plot"]; table: DataTable } {
  const t = translateGgplot(script(n));
  const b = bindGgplot(t, sheet);
  if (!b.ok || !b.table || !t.kind) throw new Error(`script ${n} did not bind: missing ${b.missing.join(", ")}`);
  const result: GgplotImportResult = { table: b.table, plot: t.plot, kind: t.kind, seriesStylesByName: b.seriesStylesByName, preset: t.preset, name: t.name, report: [...t.report, ...b.notes], sourceTableName: sheet.name };
  const project: Project = { schemaVersion: 4, tables: [sheet], plots: [], analyses: [], log: [], workspace: { folders: [], loose: [] } };
  const doc = new MadyDocument(project);
  const { table, plot } = applyGgplotImport(doc, result, seedPlotStyle);
  return { doc, result, plot, table };
}
const sceneOf = (c: ReturnType<typeof create>) => buildPlotScene(c.table, c.plot, { width: 620, height: 420 });
const hasInk = (s: ReturnType<typeof buildPlotScene>): boolean =>
  s.series.some((x) => x.marks.some((m) => Number.isFinite(m.cx))) || (s.heatmap?.cells.length ?? 0) > 0 || s.series.some((x) => x.linePath != null);

describe("the six canonical scripts become the graphs they describe, through the production path", () => {
  it("53 · dodged bars ± SD, black outline, manual fills, Scientific Journal", () => {
    const c = create(53, toothSummary);
    expect(c.plot.kind).toBe("bar");
    expect(c.plot.barLayout).toBe("grouped");
    expect(c.plot.showBarPoints).toBe(false);
    const vc = c.table.columns.find((x) => x.name === "VC")!;
    expect(c.plot.seriesStyles?.[vc.id]).toMatchObject({ color: "#56B4E9", borderColor: "black" });
    expect(c.table.columns.filter((x) => x.role === "sd")).toHaveLength(2);
    const s = sceneOf(c);
    expect(hasInk(s)).toBe(true);
    expect(s.series.map((x) => x.name)).toEqual(["VC", "OJ"]);
    expect(s.series[0]!.marks.some((m) => m.errHighCy != null || m.errLowCy != null), "no SD error bars drawn").toBe(true);
    expect(s.fonts.title.family).toContain("Helvetica"); // the preset landed
  });
  it("55 · log10 x, colour + shape per compound, legend on top, y linear", () => {
    const c = create(55, doseResponse);
    expect(c.plot.kind).toBe("xy");
    expect(c.plot.xAxis?.scale).toBe("log10");
    expect(c.plot.yAxis?.scale).toBe("linear");
    expect(c.plot.legend?.position).toBe("top");
    const s = sceneOf(c);
    expect(s.x.type).toBe("log10");
    expect(s.y.type).toBe("linear");
    expect(s.legendLayout.position).toBe("top");
    expect(s.series.map((x) => x.color)).toEqual(["#0072B2", "#E69F00"]);
    expect(s.series[0]!.marks.length).toBe(6);
  });
  it("56 · box with points, y 0–60, no legend", () => {
    const c = create(56, expression);
    expect(c.plot.kind).toBe("box");
    expect(c.table.kind).toBe("column");
    const s = sceneOf(c);
    expect(s.series.filter((x) => x.marks.some((m) => m.box)).length, "no boxes drawn").toBe(2);
    expect(s.series.map((x) => x.color)).toEqual(["#66C2A5", "#FC8D62"]); // Set2, bundled
    // The jittered points are drawn and visible (an absent alpha must not become opacity 0).
    expect(s.series.every((x) => (x.symbolOpacity ?? 1) > 0)).toBe(true);
    expect(s.series[0]!.marks[0]!.points?.length).toBeGreaterThan(0);
    expect(s.y.domain[0]).toBe(0);
    expect(s.y.domain[1]).toBe(60);
    expect(s.legend).toHaveLength(0);
  });
  it("57 · heatmap, diverging map pinned at 0 with ±3, white borders, labels at 45°", () => {
    const c = create(57, zscores);
    expect(c.plot.kind).toBe("heatmap");
    // The script's gradient survives the preset, because the preset is applied first.
    expect(c.plot.heatmap).toMatchObject({ colormap: "coolwarm", colorMidpoint: 0, valueMin: -3, valueMax: 3, cellBorderColor: "white", labelRotation: 45 });
    const s = sceneOf(c);
    expect(s.heatmap?.cells.length).toBe(12);
    expect(s.heatmap?.rowLabels.map((r) => r.label)).toEqual(["TP53", "MYC", "EGFR", "KRAS"]);
  });
  it("58 · horizontal bars sorted by value, a dashed zero line, a note", () => {
    const c = create(58, effects);
    expect(c.plot.kind).toBe("bar");
    expect(c.plot.barOrientation).toBe("horizontal");
    expect(c.table.rows.map((r) => r.cells[c.table.columns[0]!.id])).toEqual(["BMI", "Age", "Sex", "Dose"]);
    expect(c.plot.annotations?.map((a) => a.kind)).toEqual(["hline", "text"]);
    const s = sceneOf(c);
    expect(hasInk(s)).toBe(true);
    expect(s.annotations.some((a) => a.kind === "text" && a.label === "n = 42")).toBe(true);
  });
  it("54 · a summary datasheet with a mean and an sd column → error bars", () => {
    const c = create(54, toothSummary);
    expect(c.plot.kind).toBe("xy");
    expect(c.plot.yAxis).toMatchObject({ min: 0, max: 35, majorStep: 5 });
    const s = sceneOf(c);
    expect(s.y.domain).toEqual([0, 35]);
    expect(s.series[0]!.marks.some((m) => m.errHighCy != null)).toBe(true);
    // …and the line and the points: geom_line + geom_point with no size/alpha given must not
    // become width 0 / opacity 0 (`Number("")` is 0).
    expect(s.series[0]!.linePath).toBeTruthy();
    expect(s.series[0]!.lineWidth).toBeGreaterThan(0);
    expect(s.series[0]!.symbolOpacity ?? 1).toBeGreaterThan(0);
    expect(s.series.map((x) => x.color)).toEqual(["#CC79A7", "#0072B2"]);
  });
});

describe("the dialog", () => {
  it("shows the report and refuses to create until every named column is matched", () => {
    const onConfirm = vi.fn();
    const wrong = long("w", ["supp", "dose", "length", "sd"], [["VC", 0.5, 7.98, 2.75]]);
    const { container, unmount } = render(<GgplotImportDialog src={{ name: "tooth", text: script(53) }} tables={[wrong]} onConfirm={onConfirm} onCancel={() => {}} />);
    const rows = [...container.querySelectorAll("table[aria-label='Import report'] tbody tr")];
    expect(rows.length).toBeGreaterThan(5);
    expect(container.textContent).toContain("geom_errorbar(…)");
    expect(container.textContent).toContain("Scientific Journal");
    const create = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create graph") as HTMLButtonElement;
    expect(create.disabled, "Create was enabled although 'len' is missing").toBe(true);
    expect(container.textContent).toContain("len");
    expect(container.textContent).toContain("not in");
    unmount();
  });
  it("with a matching datasheet, Create hands back the wide table, the kind and the styles", () => {
    const onConfirm = vi.fn();
    const { container } = render(<GgplotImportDialog src={{ name: "tooth", text: script(53) }} tables={[toothSummary]} onConfirm={onConfirm} onCancel={() => {}} />);
    const create = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create graph") as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const r = onConfirm.mock.calls[0]![0] as GgplotImportResult;
    expect(r.kind).toBe("bar");
    expect(r.table.columns.map((c) => c.name)).toEqual(["dose", "VC", "SD", "OJ", "SD"]);
    expect(r.preset).toBe("Scientific Journal");
    expect(r.seriesStylesByName["OJ"]?.color).toBe("#009E73");
  });
  it("a script with no drawable geom says so and cannot create", () => {
    const { container } = render(<GgplotImportDialog src={{ name: "counts", text: script(20) }} tables={[toothSummary]} onConfirm={() => {}} onCancel={() => {}} />);
    expect(container.textContent).toContain("no geom MadY can draw");
    const create = [...container.querySelectorAll("button")].find((b) => b.textContent === "Create graph") as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });
});

describe("the doors", () => {
  it("File ▸ Import ggplot script… is a real, enabled action", () => {
    const run = vi.fn();
    const h = { importGgplot: run } as unknown as ActionHandlers;
    const a = buildActions(new Proxy(h, { get: (t, k) => (k in t ? t[k as keyof ActionHandlers] : vi.fn()) }) as ActionHandlers).find((x) => x.id === "import-ggplot")!;
    expect(a).toBeTruthy();
    expect(a.menu).toBe("File");
    expect(a.enabled ?? true).toBe(true);
    a.run();
    expect(run).toHaveBeenCalled();
  });
  it("the welcome page does not offer it — the entry point is the File menu only", () => {
    const { container } = render(<WelcomePane onOpenGallery={() => {}} onOpenGuide={() => {}} onStartNewGraph={() => {}} onNewProject={() => {}} onOpenTours={() => {}} />);
    const tiles = [...container.querySelectorAll(".welcome-action")];
    expect(tiles.some((b) => /ggplot/i.test(b.textContent ?? "")), "the Welcome page offers a ggplot tile").toBe(false);
    // Five tiles in a five-column row (Guided tours included); the grid is
    // `repeat(5, 1fr)` so nothing wraps.
    expect(tiles.length).toBe(5);
  });
  it("the guide explains it, in the 'Getting data in' section", () => {
    const s = GUIDE.find((x) => x.id === "import")!;
    const text = JSON.stringify(s.blocks);
    expect(text).toContain("Import ggplot script");
    expect(text).toContain("honoured");
    expect(text).toContain("refused");
  });
});
