// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { DataTable, Plot } from "@mady/core";
import { figureCaption, figureTextBlock, multiPanelCaption } from "./figureCaption";

/** A realistic 2-series XY table (x + two y columns). */
const doseTable: DataTable = {
  id: "t1",
  kind: "xy",
  name: "Dose data",
  columns: [
    { id: "x", name: "Dose (nM)", role: "x" },
    { id: "y1", name: "Control", role: "y" },
    { id: "y2", name: "Treated", role: "y" },
  ],
  rows: [
    { id: "r1", cells: { x: 1, y1: 10, y2: 20 } },
    { id: "r2", cells: { x: 10, y1: 22, y2: 41 } },
    { id: "r3", cells: { x: 100, y1: 30, y2: 60 } },
  ],
} as unknown as DataTable;

const plot = (over: Partial<Plot> = {}): Plot =>
  ({ id: "p1", name: "Dose–response", source: "t1", ...over }) as unknown as Plot;

describe("figureCaption — axis-based kinds", () => {
  it("describes an XY plot with both axes, real data ranges and every series", () => {
    const t = figureCaption(plot({ kind: "xy", title: "Dose–response" }), doseTable, { index: 2 });
    expect(t.caption).toBe(
      "Figure 2. Dose–response. XY plot of the measured value versus Dose (nM) for Control and Treated.",
    );
    expect(t.altText).toBe(
      "XY plot titled “Dose–response”. Horizontal axis: Dose (nM), ranging from 1 to 100. " +
        "Vertical axis: value, ranging from 10 to 60. It shows 2 series: Control and Treated.",
    );
  });

  it("folds in a linked analysis's key statistic when given, and never invents one", () => {
    const withStat = figureCaption(plot({ kind: "xy" }), doseTable, { statLine: "p < 0.0001  ·  R² = 0.98" });
    // runs of whitespace are collapsed so the drafted prose is tidy
    expect(withStat.caption).toContain("p < 0.0001 · R² = 0.98.");
    expect(withStat.altText).toContain("Reported statistic: p < 0.0001 · R² = 0.98.");
    // no statLine → no invented statistic anywhere
    const without = figureCaption(plot({ kind: "xy" }), doseTable, {});
    expect(without.caption).not.toMatch(/p [=<]|R²/);
    expect(without.altText).not.toMatch(/Reported statistic/);
  });

  it("names a log axis as such", () => {
    const t = figureCaption(plot({ kind: "xy", xAxis: { scale: "log10" } as Plot["xAxis"] }), doseTable, {});
    expect(t.altText).toContain("Horizontal axis: Dose (nM) on a log scale");
  });

  it("uses the single series' name as the Y meaning when there is only one", () => {
    const oneSeries = {
      ...doseTable,
      columns: doseTable.columns.filter((c) => c.id !== "y2"),
    } as unknown as DataTable;
    const t = figureCaption(plot({ kind: "bar" }), oneSeries, {});
    // the plot's own name serves as the title when no explicit title is set
    expect(t.caption).toBe("Dose–response. Bar chart of Control versus Dose (nM).");
    // the lone series IS the Y meaning here, so it isn't echoed back
    expect(t.altText).toContain("It shows a single data series.");
    expect(t.altText).not.toContain("a single series (Control)");
  });

  it("still names a lone series when it adds information beyond the axis title", () => {
    const oneSeries = {
      ...doseTable,
      columns: doseTable.columns.filter((c) => c.id !== "y2"),
    } as unknown as DataTable;
    const t = figureCaption(plot({ kind: "xy", yAxis: { title: "Response (%)" } as Plot["yAxis"] }), oneSeries, {});
    expect(t.altText).toContain("a single series (Control)");
  });

  it("prefers an explicit axis title over the column name", () => {
    const t = figureCaption(
      plot({ kind: "xy", yAxis: { title: "Response (%)" } as Plot["yAxis"] }),
      doseTable,
      {},
    );
    expect(t.caption).toContain("XY plot of Response (%) versus Dose (nM)");
  });
});

describe("figureCaption — non-axis kinds are described by composition, not axes", () => {
  it("a pie chart gets no axis sentences", () => {
    const t = figureCaption(plot({ kind: "pie", title: "Market share" }), doseTable, {});
    expect(t.altText).toContain("Pie chart titled “Market share”");
    expect(t.altText).not.toContain("Horizontal axis");
    expect(t.caption).toBe("Pie chart of Market share showing 2 series: Control and Treated.");
  });

  it("names specialised kinds correctly", () => {
    expect(figureCaption(plot({ kind: "survival" }), doseTable, {}).caption).toContain("Kaplan–Meier survival plot");
    expect(figureCaption(plot({ kind: "blandaltman" }), doseTable, {}).caption).toContain("Bland–Altman plot");
    expect(figureCaption(plot({ kind: "network" }), doseTable, {}).altText).toContain("Network graph");
  });
});

describe("figureCaption — degrades accurately", () => {
  it("omits data ranges rather than guessing them when the source table is unresolved", () => {
    const t = figureCaption(plot({ kind: "xy", title: "Orphan" }), undefined, {});
    expect(t.altText).toContain("Horizontal axis: X.");
    expect(t.altText).not.toContain("ranging from");
    expect(t.caption).toContain("XY plot of the measured value versus the independent variable.");
  });

  it("falls back to a generic noun for an unknown kind", () => {
    expect(figureCaption(plot({ kind: "somethingNew" as Plot["kind"] }), doseTable, {}).caption).toContain("Graph of");
  });

  it("figureTextBlock labels both sections for copying", () => {
    expect(figureTextBlock({ caption: "C.", altText: "A." })).toBe("Caption\nC.\n\nAlt text\nA.");
  });
});

describe("multiPanelCaption — whole-figure draft (the assembler's Caption button)", () => {
  const barTable: DataTable = {
    id: "t2",
    kind: "column",
    name: "Groups",
    columns: [
      { id: "g", name: "Group", role: "x" },
      { id: "m", name: "Mean", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { g: "Ctrl", m: 5 } },
      { id: "r2", cells: { g: "Drug", m: 9 } },
    ],
  } as unknown as DataTable;
  const barPlot = { id: "p2", name: "Treatment", source: "t2", kind: "bar" } as unknown as Plot;

  it("stitches one lettered clause per panel, in panel order", () => {
    const t = multiPanelCaption("Figure 1", [
      { plot: plot({ kind: "xy", title: "Dose-response" }), table: doseTable, letter: "A" },
      { plot: barPlot, table: barTable, letter: "B" },
    ], { index: 1 });
    expect(t.caption).toBe(
      "Figure 1. (A) Dose-response. XY plot of the measured value versus Dose (nM) for Control and Treated. " +
      "(B) Treatment. Bar chart of Mean versus Group.",
    );
    // the placeholder figure name does not duplicate the "Figure 1." lead
    expect(t.caption).not.toContain("Figure 1. Figure 1");
  });

  it("leads with a real figure name but suppresses a bare placeholder", () => {
    const named = multiPanelCaption("Immune signalling response", [
      { plot: barPlot, table: barTable, letter: "A" },
    ], { index: 3 });
    expect(named.caption).toBe("Figure 3. Immune signalling response. (A) Treatment. Bar chart of Mean versus Group.");
    const placeholder = multiPanelCaption("Figure 4", [{ plot: barPlot, table: barTable, letter: "A" }], {});
    expect(placeholder.caption).toBe("(A) Treatment. Bar chart of Mean versus Group.");
  });

  it("uses the letter the panel actually shows, including a custom one", () => {
    const t = multiPanelCaption("F", [
      { plot: barPlot, table: barTable, letter: "(a)" },
      { plot: barPlot, table: barTable, letter: "S1" },
    ], {});
    // already bracketed by the user → cited as-is, not double-wrapped into "((a))"
    expect(t.caption).toContain("(a) Treatment. Bar chart");
    expect(t.caption).not.toContain("((a))");
    expect(t.caption).toContain("(S1) Treatment. Bar chart"); // bare label gets the parens
  });

  it("does not double-wrap a square-bracketed label either", () => {
    const t = multiPanelCaption("F", [{ plot: barPlot, table: barTable, letter: "[i]" }], {});
    expect(t.caption).toContain("[i] Treatment. Bar chart");
    expect(t.caption).not.toContain("([i])");
  });

  it("omits the tag entirely for an unlettered panel", () => {
    const t = multiPanelCaption("F", [{ plot: barPlot, table: barTable, letter: "" }], {});
    expect(t.caption).toBe("F. Treatment. Bar chart of Mean versus Group.");
    expect(t.altText).not.toContain("()");
  });

  it("alt-text announces the panel count then describes each panel", () => {
    const t = multiPanelCaption("Panel figure", [
      { plot: plot({ kind: "xy", title: "D" }), table: doseTable, letter: "A" },
      { plot: barPlot, table: barTable, letter: "B" },
    ], {});
    expect(t.altText).toMatch(/^Multi-panel figure with 2 panels, Panel figure\./);
    expect(t.altText).toContain("(A) XY plot titled");
    expect(t.altText).toContain("(B) Bar chart");
  });

  it("folds in only statistics it was given — never invents one", () => {
    const withStat = multiPanelCaption("F", [
      { plot: barPlot, table: barTable, letter: "A", statLine: "p = 0.003" },
      { plot: barPlot, table: barTable, letter: "B" },
    ], {});
    expect(withStat.caption).toContain("(A) Treatment. Bar chart of Mean versus Group. p = 0.003.");
    expect(withStat.caption.match(/p = 0\.003/g)).toHaveLength(1); // not smeared onto panel B
  });

  it("handles an empty figure without inventing panels", () => {
    const t = multiPanelCaption("Figure 1", [], {});
    expect(t.altText).toBe("Empty figure — no panels.");
    expect(t.caption).toBe("");
  });
});

describe("figureCaption — image panels are described by their alt text", () => {
  const img = (over: Record<string, unknown> = {}): Plot =>
    ({ id: "i", name: "western-blot", source: "t", kind: "image", image: { src: "data:image/png;base64,x", ...over } }) as unknown as Plot;

  it("uses the alt text, because the drafter cannot see the picture", () => {
    const t = figureCaption(img({ alt: "Immunoblot for STAT1 at 0, 6 and 24 h." }), undefined, { index: 2 });
    expect(t.caption).toBe("Figure 2. western-blot. Immunoblot for STAT1 at 0, 6 and 24 h.");
    expect(t.altText).toBe("Immunoblot for STAT1 at 0, 6 and 24 h.");
  });

  it("does NOT stutter when the alt text is still the panel name", () => {
    // both seed from the file name, so leading with the title would repeat it
    const t = figureCaption(img({ alt: "western-blot" }), undefined, {});
    expect(t.caption).toBe("western-blot");
    expect(t.caption).not.toMatch(/western-blot.*western-blot/);
  });

  it("invents nothing when there is no alt text — it cannot see the image", () => {
    const t = figureCaption(img(), undefined, {});
    expect(t.caption).toBe("Image: western-blot.");
    expect(t.altText).toBe("Image: western-blot.");
  });

  it("describes no axes or series for an image", () => {
    const t = figureCaption(img({ alt: "A blot." }), undefined, {});
    expect(t.altText).not.toContain("axis");
    expect(t.altText).not.toContain("series");
  });
});

describe("figureCaption — numbers are typeset for a manuscript", () => {
  // Captions are copied straight into papers, where "5e-8" reads as unfinished. The data
  // range is the only place a caption prints raw numbers, so it is where this shows up.
  const tiny: DataTable = {
    id: "t3", kind: "xy", name: "Tiny",
    columns: [
      { id: "x", name: "Concentration (M)", role: "x" },
      { id: "y", name: "Signal", role: "y" },
    ],
    rows: [
      { id: "r1", cells: { x: 0.00000005, y: 1 } },
      { id: "r2", cells: { x: 0.0000012, y: 2 } },
    ],
  } as unknown as DataTable;

  it("writes tiny axis ranges as ×10ⁿ, never as e-notation", () => {
    const t = figureCaption({ id: "p", name: "P", source: "t3", kind: "xy" } as unknown as Plot, tiny, {});
    expect(t.altText).toContain("5 × 10⁻⁸");
    expect(t.altText).toContain("1.2 × 10⁻⁶");
    expect(t.altText).not.toMatch(/e[+-]\d/);
  });

  it("leaves ordinary ranges as plain decimals", () => {
    const t = figureCaption(plot({ kind: "xy" }), doseTable, {});
    expect(t.altText).toContain("ranging from 1 to 100");
    expect(t.altText).not.toContain("×");
  });
});
