/**
 * The ggplot importer — parser, translator and binder, held against the corpus.
 *
 * `docs/ggplot-corpus/` is the fixture set (58 example scripts). For the six canonical
 * scientific scripts (53–58) the translator
 * must produce the kinds and options each script describes, and the binder must pivot a long
 * datasheet into the wide table MadY draws.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataTable } from "./model";
import { bindGgplot, extractChain, parseArgs, parseCall, splitTop, stripComments, translateGgplot } from "./ggplotImport";

const CORPUS = join(__dirname, "..", "..", "..", "docs", "ggplot-corpus");
const script = (n: number): string => {
  const f = readdirSync(CORPUS).find((x) => x.startsWith(String(n).padStart(2, "0") + "-") && x.endsWith(".R"));
  if (!f) throw new Error(`corpus script ${n} not found`);
  return readFileSync(join(CORPUS, f), "utf8");
};
const rows = (t: ReturnType<typeof translateGgplot>, verdict: "honoured" | "approximated" | "refused") => t.report.filter((r) => r.verdict === verdict).map((r) => r.call);

describe("R surface syntax", () => {
  it("splits at depth 0 only, through quotes and nested parentheses", () => {
    expect(splitTop("a, b(c, d), \"x, y\", e", ",")).toEqual(["a", "b(c, d)", "\"x, y\"", "e"]);
    expect(splitTop("geom_point() + geom_line(aes(group = g)) + labs(x = \"a + b\")", "+").length).toBe(3);
  });
  it("reads a call and its named / positional arguments", () => {
    const c = parseCall("geom_errorbar(aes(ymin = len - sd, ymax = len + sd), width = .2, position = position_dodge(.9))")!;
    expect(c.name).toBe("geom_errorbar");
    expect(c.args.map((a) => a.key)).toEqual([null, "width", "position"]);
    expect(parseArgs("x, y, colour = cyl")).toEqual([{ key: null, value: "x" }, { key: null, value: "y" }, { key: "colour", value: "cyl" }]);
    expect(parseCall("not a call")).toBeNull();
  });
  it("strips # comments but not # inside strings", () => {
    expect(stripComments("a <- 1 # note\nb <- \"#E69F00\" # colour")).toBe("a <- 1 \nb <- \"#E69F00\" ");
  });
});

describe("extractChain", () => {
  it("joins `p <- ggplot(…)` with the later `p + …` statements", () => {
    const { calls, dataArg } = extractChain(script(53));
    expect(dataArg).toBe("tg");
    expect(calls.map((c) => c.name)).toEqual(["ggplot", "geom_bar", "geom_errorbar", "scale_fill_manual", "labs", "theme_classic"]);
  });
  it("unwraps `data %>% ggplot(…)`", () => {
    const { calls, dataArg } = extractChain(script(51));
    expect(dataArg).toBe("data");
    expect(calls[0]!.name).toBe("ggplot");
    expect(calls.map((c) => c.name)).toContain("geom_jitter");
  });
  it("takes the last chain in a script and reads a multi-line one", () => {
    const { calls } = extractChain("g <- ggplot(mpg, aes(class))\ng + geom_bar()\nggplot(mpg, aes(displ, hwy)) +\n  geom_point() +\n  facet_wrap(~drv)\n");
    expect(calls.map((c) => c.name)).toEqual(["ggplot", "geom_point", "facet_wrap"]);
  });
  it("no chain → nothing, not a throw", () => {
    expect(extractChain("x <- 1\n").calls).toEqual([]);
    expect(translateGgplot("x <- 1").ok).toBe(false);
  });
});

describe("the six canonical scripts translate to the designs they describe", () => {
  it("53 · dodged bars ± sd with a black outline and manual fills, classic theme", () => {
    const t = translateGgplot(script(53));
    expect(t.ok).toBe(true);
    expect(t.kind).toBe("bar");
    expect(t.plot.barLayout).toBe("grouped");
    expect(t.plot.showBarPoints).toBe(false);
    expect(t.plot.barShape).toBe("square");
    expect(t.series.every.borderColor).toBe("black");
    expect(t.series.colours).toEqual(["#56B4E9", "#009E73"]);
    expect(t.aes).toMatchObject({ x: "dose", y: "len", group: "supp", err: "sd" });
    expect(t.preset).toBe("Scientific Journal");
    expect(t.plot.title).toBe("Odontoblast length by vitamin C dose");
    expect(t.plot.xAxis?.title).toBe("Vitamin C (mg/day)");
    expect(t.data.computed).toBe(true); // a helper function prepares the data
    expect(rows(t, "refused")).toEqual([]);
  });
  it("54 · line + points + error bars, y 0–35 by 5, legend bottom → top, minimal theme", () => {
    const t = translateGgplot(script(54));
    expect(t.kind).toBe("xy");
    expect(t.series.every.plotAs).toBeUndefined(); // line and points → the default look
    expect(t.plot.yAxis).toMatchObject({ min: 0, max: 35, majorStep: 5, scale: "linear" });
    expect(t.plot.legend?.position).toBe("top");
    expect(rows(t, "approximated")).toContain("theme(legend.position = …)");
    expect(t.preset).toBe("Editorial");
    expect(t.data.file).toBe("toothgrowth_summary.csv");
  });
  it("55 · log10 x scatter, colour + shape by compound, legend top, theme_bw, y pinned linear", () => {
    const t = translateGgplot(script(55));
    expect(t.kind).toBe("xy");
    expect(t.plot.xAxis?.scale).toBe("log10");
    expect(t.plot.yAxis?.scale).toBe("linear"); // rule 2: pinned, never left to the suggester
    // geom_point + stat_summary(geom = "line") → points and a mean line = MadY's default look.
    expect(t.series.every.plotAs).toBeUndefined();
    expect(t.aes.group).toBe("compound");
    expect(t.series.colours).toEqual(["#0072B2", "#E69F00"]);
    expect(t.plot.legend?.position).toBe("top");
    expect(t.plot.grid?.show).toBe(false);
    expect(t.preset).toBe("MadY default");
    expect(rows(t, "approximated")).toContain("stat_summary(…)");
  });
  it("56 · box + jitter + ggpubr p-value + Set2 + y 0–60 + no legend", () => {
    const t = translateGgplot(script(56));
    expect(t.kind).toBe("box");
    expect(t.shape).toBe("groups");
    expect(t.plot.showBoxPoints).toBe(true);
    expect(t.plot.yAxis).toMatchObject({ min: 0, max: 60 });
    expect(t.plot.legend?.position).toBe("none");
    expect(rows(t, "approximated")).toContain("stat_compare_means(…)");
    expect(rows(t, "honoured")).toContain("scale_fill_brewer(…)"); // Set2 is bundled
    expect(t.series.colours.slice(0, 2)).toEqual(["#66C2A5", "#FC8D62"]);
    // an absent alpha / shape / size must stay absent — Number("") is 0, which would draw invisible squares.
    expect(t.series.every.symbolOpacity).toBeUndefined();
    expect(t.series.every.symbol).toBeUndefined();
    expect(t.data.notes.join(" ")).toContain("ggpubr");
  });
  it("57 · tile heatmap, diverging gradient pinned at 0 with ±3, white borders, 45° labels, equal aspect", () => {
    const t = translateGgplot(script(57));
    expect(t.kind).toBe("heatmap");
    expect(t.shape).toBe("matrix");
    expect(t.aes).toMatchObject({ x: "sample", y: "gene", fill: "z" });
    expect(t.plot.heatmap).toMatchObject({ colormap: "coolwarm", colorMidpoint: 0, valueMin: -3, valueMax: 3, cellBorderColor: "white" });
    expect(t.plot.heatmap?.labelRotation).toBe(45); // a heatmap's column labels, not an X axis
    expect(t.plot.equalAspect).toBeUndefined(); // cells are square already; the flag would be refused
    expect(rows(t, "honoured")).toContain("coord_fixed(…)");
    expect(t.plot.grid?.show).toBe(false);
    expect(t.preset).toBe("Editorial");
  });
  it("58 · flipped bars sorted by value, dashed zero line, a text note, theme_bw", () => {
    const t = translateGgplot(script(58));
    expect(t.kind).toBe("bar");
    expect(t.plot.barOrientation).toBe("horizontal");
    expect(t.aes).toMatchObject({ x: "term", y: "estimate", sortBy: "estimate" });
    expect(t.plot.annotations?.map((a) => a.kind)).toEqual(["hline", "text"]);
    expect(t.plot.annotations?.[0]).toMatchObject({ value: 0, dash: "dashed" });
    expect(t.plot.annotations?.[1]?.label).toBe("n = 42");
    expect(t.series.every.color).toBe("steelblue");
    expect(t.plot.yAxis?.title).toBe("Effect size");
    expect(t.plot.xAxis?.title).toBe("");
  });
});

describe("refusals are reported, never silent", () => {
  it("facets, formulas, computed stats and unknown functions are named", () => {
    expect(rows(translateGgplot(script(11)), "refused")).toContain("facet_wrap(…)");
    expect(rows(translateGgplot(script(10)), "refused")).toContain("geom_smooth(…)");
    expect(rows(translateGgplot(script(12)), "refused")).toContain("binomial_smooth(…)");
    const bar = translateGgplot(script(20)); // geom_bar counts
    expect(bar.ok).toBe(false);
    expect(rows(bar, "refused")).toContain("geom_bar(…)");
    expect(rows(translateGgplot(script(21)), "refused").some((c) => c.startsWith("aes(weight"))).toBe(true);
    expect(rows(translateGgplot(script(19)), "refused").some((c) => c.startsWith("aes(lower"))).toBe(true);
  });
  it("a jitter over a box keeps the box as the kind and turns the points on", () => {
    const t = translateGgplot(script(16));
    expect(t.kind).toBe("box");
    expect(t.plot.showBoxPoints).toBe(true);
  });
  it("a layer with its own data= is refused", () => {
    expect(rows(translateGgplot(script(43)), "refused")).toContain("geom_point(…)");
  });
});

describe("the whole corpus translates without throwing", () => {
  const files = readdirSync(CORPUS).filter((f) => f.endsWith(".R"));
  it("58 scripts, every one reported, each with its expected graph kind", () => {
    expect(files.length).toBe(58);
    const kinds = new Map<string, string | undefined>();
    for (const f of files) {
      const t = translateGgplot(readFileSync(join(CORPUS, f), "utf8"));
      expect(t.report.length, `${f}: an empty report`).toBeGreaterThan(0);
      kinds.set(f, t.kind);
    }
    // The six with no drawable geom are explicit refusals: the count bars (20–23, computed in R),
    // the frequency polygon over after_stat(density) (29) and the 2-D bin stat (36).
    const undrawn = [...kinds].filter(([, k]) => !k).map(([f]) => f.slice(0, 2)).sort();
    expect(undrawn).toEqual(["20", "21", "22", "23", "29", "36"]);
    expect(kinds.get("13-box-basic.R")).toBe("box");
    expect(kinds.get("25-hist-binwidth.R")).toBe("histogram");
    expect(kinds.get("34-tile-heatmap.R")).toBe("heatmap");
    expect(kinds.get("31-violin-basic-jitter.R")).toBe("violin");
    expect(kinds.get("24-col-means.R")).toBe("bar");
  });
});

// ── binding ────────────────────────────────────────────────────────────────────────────────
const long = (columns: string[], data: (string | number | null)[][]): DataTable => ({
  id: "src", kind: "xy", name: "long",
  columns: columns.map((n, i) => ({ id: `c${i}`, name: n })),
  rows: data.map((r, i) => ({ id: `r${i}`, cells: Object.fromEntries(columns.map((_, j) => [`c${j}`, r[j] ?? null])) })),
});

describe("bindGgplot — the long datasheet becomes the wide one MadY draws", () => {
  it("summary rows (mean + sd) → one series per level with an SD subcolumn", () => {
    const t = translateGgplot(script(53));
    const src = long(["supp", "dose", "len", "sd"], [["VC", 0.5, 7.98, 2.75], ["VC", 1, 16.77, 2.52], ["VC", 2, 26.14, 4.8], ["OJ", 0.5, 13.23, 4.46], ["OJ", 1, 22.7, 3.91], ["OJ", 2, 26.06, 2.66]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(true);
    const tb = b.table!;
    expect(tb.columns.map((c) => [c.name, c.role, c.group ? "grouped" : ""])).toEqual([
      ["dose", "x", ""], ["VC", "y", ""], ["SD", "sd", "grouped"], ["OJ", "y", ""], ["SD", "sd", "grouped"],
    ]);
    expect(tb.rows.map((r) => r.cells[tb.columns[0]!.id])).toEqual([0.5, 1, 2]);
    expect(tb.rows[1]!.cells[tb.columns[3]!.id]).toBe(22.7);
    expect(tb.rows[1]!.cells[tb.columns[4]!.id]).toBe(3.91);
    expect(b.seriesStylesByName).toEqual({ VC: expect.objectContaining({ color: "#56B4E9", borderColor: "black" }), OJ: expect.objectContaining({ color: "#009E73" }) });
  });
  it("raw observations → replicate subcolumns, and the error column is then ignored (said so)", () => {
    const t = translateGgplot(script(54));
    const src = long(["supp", "dose", "len", "sd"], [["VC", 1, 15, 1], ["VC", 1, 17, 1], ["VC", 1, 18, 1], ["OJ", 1, 22, 1], ["OJ", 1, 23, 1]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(true);
    const tb = b.table!;
    expect(tb.columns.map((c) => c.name)).toEqual(["dose", "VC", "VC 2", "VC 3", "OJ", "OJ 2", "OJ 3"]);
    expect(tb.rows[0]!.cells[tb.columns[6]!.id]).toBeNull(); // OJ has two observations
    expect(b.notes.some((n) => n.call === "error bars" && n.verdict === "approximated")).toBe(true);
  });
  it("box: one column per group level, values down the rows", () => {
    const t = translateGgplot(script(56));
    const src = long(["group", "expression"], [["Control", 21], ["Treated", 34], ["Control", 24], ["Treated", 41], ["Control", 19]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(true);
    expect(b.table!.kind).toBe("column");
    expect(b.table!.columns.map((c) => c.name)).toEqual(["Control", "Treated"]);
    expect(b.table!.rows.map((r) => [r.cells["ggc1"], r.cells["ggc2"]])).toEqual([[21, 34], [24, 41], [19, null]]);
  });
  it("tile: rows = y levels, columns = x levels, cells = fill", () => {
    const t = translateGgplot(script(57));
    const src = long(["gene", "sample", "z"], [["TP53", "S1", 1.2], ["TP53", "S2", -0.4], ["MYC", "S1", 2.1], ["MYC", "S2", 0.3]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(true);
    expect(b.table!.columns.map((c) => c.name)).toEqual(["gene", "S1", "S2"]);
    expect(b.table!.rows.map((r) => [r.cells["ggc1"], r.cells["ggc2"], r.cells["ggc3"]])).toEqual([["TP53", 1.2, -0.4], ["MYC", 2.1, 0.3]]);
  });
  it("reorder(term, estimate) sorts the categories by value; a single series takes the fixed colour", () => {
    const t = translateGgplot(script(58));
    const src = long(["term", "estimate"], [["Age", -0.8], ["Dose", 2.1], ["Sex", 0.4]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(true);
    expect(b.table!.rows.map((r) => r.cells["ggc1"])).toEqual(["Age", "Sex", "Dose"]);
    expect(b.seriesStylesByName["estimate"]?.color).toBe("steelblue");
  });
  it("a column the script names but the sheet lacks is reported, never guessed", () => {
    const t = translateGgplot(script(53));
    const src = long(["supp", "dose", "length", "sd"], [["VC", 0.5, 7.98, 2.75]]);
    const b = bindGgplot(t, src);
    expect(b.ok).toBe(false);
    expect(b.missing).toEqual(["len"]);
    expect(b.table).toBeNull();
  });
  it("matches column names forgiving case, spaces and dots", () => {
    const t = translateGgplot(script(58));
    const src = long(["Term", "Estimate "], [["Age", -0.8]]);
    expect(bindGgplot(t, src).ok).toBe(true);
  });
  it("a named colour vector maps by level name, whatever the order", () => {
    const t = translateGgplot("ggplot(d, aes(x, y, colour = grp)) + geom_point() + scale_colour_manual(values = c(B = \"#0000ff\", A = \"#ff0000\"))");
    const b = bindGgplot(t, long(["x", "y", "grp"], [[1, 2, "A"], [1, 3, "B"]]));
    expect(b.seriesStylesByName).toEqual({ A: expect.objectContaining({ color: "#ff0000" }), B: expect.objectContaining({ color: "#0000ff" }) });
  });
});
