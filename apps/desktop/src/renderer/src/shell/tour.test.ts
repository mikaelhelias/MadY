// @vitest-environment node
/**
 * The tours' done-checks detect the change they claim — and only that change.
 *
 * Each action step names a fact about the document that means "the reader has done this". Two
 * ways for such a check to be wrong, both silent in use: it fires on entry (a check written as
 * "at least one table" is true before the reader touches anything on a project with data), or
 * it never fires (a check reading a field nothing sets). So every step is driven with the state
 * it is entered in, then with the one change it waits for, and both answers are pinned.
 */
import type { Plot } from "@mady/core";
import { describe, expect, it } from "vitest";
import { needMet, REACH_LABEL, stepDone, TOUR_LEVELS, TOUR_SAMPLE_TSV, TOUR_THEMES, TOURS, tourById, toursByTheme, type TourNeed, type TourState, type TourStep } from "./tour";

const plot = (over: Partial<Plot> = {}): Plot =>
  ({ id: "p1", name: "Dose-response", source: "t1", seriesStyles: { c1: { color: "#123456", symbol: "circle", connect: "straight", lineWidth: 2 } }, ...over }) as Plot;

const withPlot = (p: Plot, title = p.title ?? p.name): TourState["activePlot"] => ({ title, fingerprint: JSON.stringify(p), plot: p });

const base: TourState = {
  tables: 3,
  plots: 2,
  analyses: 1,
  importOpen: false,
  newGraphOpen: false,
  exportOpen: false,
  analyzeOpen: false,
  selectionKind: null,
  workingTableKind: "xy",
  sigMarkers: 0,
  sheetInFront: false,
  sheet: null,
  dataSelection: false,
  activePlot: withPlot(plot()),
  figureOpen: false,
  figure: null,
};
const FIG = { id: "l1", panels: 0, fingerprint: "fig-a" };
const SHEET = { id: "t1", columns: 3, excluded: 0, fingerprint: "sheet-a" };

const step = (tour: string, id: string): TourStep => {
  const s = tourById(tour)?.steps.find((x) => x.id === id);
  if (!s) throw new Error(`no step ${tour}/${id}`);
  return s;
};

const ALL_STEPS = TOURS.flatMap((t) => t.steps.map((s) => ({ tour: t.id, step: s })));

describe("the tours", () => {
  it("are the ones the Help menu, the Welcome card and the manual name, each with a title, a summary and real steps", () => {
    expect(TOURS.map((t) => t.id)).toEqual(["first-graph", "datasheet", "axes", "looks", "series", "annotate", "compare", "dose-response", "figure"]);
    expect(new Set(TOURS.map((t) => t.title)).size).toBe(TOURS.length);
    // The menu/palette/index name is short and prefixed, so a tour never out-ranks the control
    // whose words would otherwise be in its name (see `Tour.label`).
    expect(new Set(TOURS.map((t) => t.label)).size).toBe(TOURS.length);
    for (const t of TOURS) expect(t.label, `${t.id}'s menu label is not prefixed`).toMatch(/^Tour: [a-z]/);
    for (const t of TOURS) {
      expect(t.summary.length, `${t.id} has no summary`).toBeGreaterThan(30);
      expect(t.steps.length, `${t.id} is too short to teach anything`).toBeGreaterThanOrEqual(5);
      expect(t.steps.length, `${t.id} is a chapter, not a tour`).toBeLessThanOrEqual(12);
      expect(new Set(t.steps.map((s) => s.id)).size, `${t.id} repeats a step id`).toBe(t.steps.length);
      expect(t.steps[t.steps.length - 1]!.mode, `${t.id} does not end on a card the reader can Finish`).toBe("look");
    }
  });

  it("first-graph is the manual's seven steps, split where a dialog intervenes", () => {
    expect(tourById("first-graph")!.steps.map((s) => s.id)).toEqual([
      "copy", "paste", "import", "format", "newgraph", "create", "select", "colour", "title", "export", "exportgo", "finished",
    ]);
  });

  it("every step has a title and an instruction; an action step has a check, a look step has none", () => {
    for (const { tour, step: s } of ALL_STEPS) {
      expect(s.title.trim(), `${tour}/${s.id} has no title`).not.toBe("");
      expect(s.text.length, `${tour}/${s.id}'s text is a label, not an instruction`).toBeGreaterThan(40);
      if (s.mode === "action") expect(s.done, `action step ${tour}/${s.id} has no done-check — it could never advance`).toBeTypeOf("function");
      else expect(s.done, `look step ${tour}/${s.id} carries a done-check nothing will call`).toBeUndefined();
    }
  });

  it("no action step completes on the state it is entered in", () => {
    // The overlay evaluates every check once on entry with now === start. A check that is true
    // there skips its step before the reader has read the card.
    const states: TourState[] = [
      base,
      { ...base, importOpen: true, newGraphOpen: true, exportOpen: true, analyzeOpen: true, selectionKind: "series", sigMarkers: 3, workingTableKind: "column", sheetInFront: true, sheet: { ...SHEET, excluded: 2 }, dataSelection: true, figureOpen: true, figure: { ...FIG, panels: 2 } },
      { ...base, tables: 0, plots: 0, analyses: 0, activePlot: null, workingTableKind: null },
      { ...base, selectionKind: "axis", activePlot: withPlot(plot({ yAxis: { min: 0, max: 10, majorStep: 2, minorCount: 4, breaks: [{ from: 3, to: 5 }] }, grid: { show: true }, frame: "box", background: "#fff", significance: { width: 3 } } as Partial<Plot>)) },
    ];
    for (const { tour, step: s } of ALL_STEPS)
      for (const st of states) expect(stepDone(s, st, st), `${tour}/${s.id} completes on entry`).toBe(false);
  });

  it("a look step never completes by itself — the card's Next button is its only way on", () => {
    for (const { step: s } of ALL_STEPS.filter((x) => x.step.mode === "look"))
      expect(stepDone(s, { ...base, tables: 99, plots: 99, analyses: 99, selectionKind: "series", importOpen: true, sigMarkers: 9 }, base)).toBe(false);
  });

  it("every anchor is a selector the program can carry: a css selector, or `css :: label` naming a control by its words", () => {
    for (const { tour, step: s } of ALL_STEPS)
      for (const a of s.anchors) {
        const at = a.indexOf(" :: ");
        const css = at < 0 ? a : a.slice(0, at);
        expect(css, `${tour}/${s.id}: ${a}`).toMatch(/^(\[data-(tour|goal)="[A-Za-z:-]+"\]|[a-z]+\.[a-z-]+|\.[a-z0-9-]+(\[title\^="[^"]+"\])?( > [a-z]+| \.[a-z-]+| [a-z]+\.[a-z-]+)?)$/);
        if (at >= 0) expect(a.slice(at + 4).trim(), `${tour}/${s.id}: empty label in ${a}`).not.toBe("");
      }
  });

  it("an Inspector row anchor is followed by a way in: its group or section heading, or its tab", () => {
    // A closed group has no laid-out rows and another tab has no laid-out groups; a row named
    // alone would leave the light with nowhere to go. The light must always have a fallback.
    for (const { tour, step: s } of ALL_STEPS) {
      const [first, ...rest] = s.anchors;
      if (first?.startsWith(".frow :: ")) expect(rest.some((a) => a.startsWith(".inspcat :: ")), `${tour}/${s.id} names a row with no tab to fall back to`).toBe(true);
    }
  });

  it("every step that works on a sheet or a graph says so, so the tour can reach that view before the card shows", () => {
    // Clicking Next while not on the spreadsheet must not show a card about the sheet anyway, where
    // it would make no sense. A step's card must never describe a view that is not in front.
    const worksOnSheet = new Set(["add-column", "type-values", "select-cells", "exclude", "include"]);
    for (const { tour, step: st } of ALL_STEPS) {
      if (worksOnSheet.has(st.id)) expect(st.needs, `${tour}/${st.id} edits the sheet but declares no need`).toBe("sheet");
      // Every Inspector-row or figure step works on the graph in front.
      const onGraph = st.anchors.some((a) => a.startsWith(".frow :: ") || a.startsWith(".graphzoom") || a.startsWith(".grb") || a.startsWith(".insp"));
      if (onGraph) expect(st.needs, `${tour}/${st.id} works on the graph but declares no need`).toMatch(/graph/);
      if (st.choose) expect(st.needs, `${tour}/${st.id} lets the reader choose but names nothing to reach`).toBeTruthy();
    }
    // The first step of every tour is a choice: own data or a sample (the first-graph tour too — a
    // clipboard button alone would leave a reader with no data and no way in).
    for (const t of TOURS) expect(t.steps[0]!.choose, `${t.id} starts without offering sample data`).toBe(true);
    for (const t of TOURS) expect(t.steps[0]!.needs, `${t.id}'s first card names nothing to supply`).toBeTruthy();
    // The first-graph steps that show the sheet (the chip, the "+" tab) must bring the sheet in front.
    for (const id of ["format", "newgraph"]) expect(step("first-graph", id).needs, `first-graph/${id} shows the sheet but declares no need`).toBe("sheet");
    for (const need of ["sheet", "graph", "column-sheet", "column-graph", "figure"] as TourNeed[]) expect(REACH_LABEL[need].length).toBeGreaterThan(8);
  });

  it("first-graph: with a sheet already in front, paste and import skip themselves; with the import preview open, import still shows", () => {
    const sheet = { ...base, sheetInFront: true, sheet: SHEET, activePlot: null };
    expect(step("first-graph", "paste").skipIf!(sheet)).toBe(true);
    expect(step("first-graph", "paste").skipIf!(base), "no sheet in front: the reader must paste").toBe(false);
    expect(step("first-graph", "import").skipIf!(sheet)).toBe(true);
    expect(step("first-graph", "import").skipIf!({ ...sheet, importOpen: true }), "the preview is up: Import is the next press").toBe(false);
    expect(step("first-graph", "import").skipIf!(base)).toBe(false);
  });

  it("needMet reads the view in front: a sheet, a graph, and the Column-format variants", () => {
    const sheet = { ...base, sheetInFront: true, sheet: SHEET, activePlot: null, workingTableKind: "xy" };
    expect(needMet("sheet", sheet)).toBe(true);
    expect(needMet("sheet", base)).toBe(false); // a graph is in front, not its sheet
    expect(needMet("graph", base)).toBe(true);
    expect(needMet("graph", sheet)).toBe(false);
    expect(needMet("column-sheet", sheet)).toBe(false); // an XY sheet
    expect(needMet("column-sheet", { ...sheet, workingTableKind: "column" })).toBe(true);
    expect(needMet("column-graph", base)).toBe(false); // an XY graph
    expect(needMet("column-graph", { ...base, workingTableKind: "column" })).toBe(true);
  });

  it("every tour has a theme from the manual's groups and a level; toursByTheme lists each once, beginner first", () => {
    const grouped = toursByTheme();
    expect(grouped.flatMap((g) => g.tours.map((t) => t.id)).sort()).toEqual(TOURS.map((t) => t.id).sort());
    for (const g of grouped) {
      expect(TOUR_THEMES).toContain(g.theme);
      const ranks = g.tours.map((t) => TOUR_LEVELS.indexOf(t.level));
      expect(ranks, `${g.theme} is not beginner → advanced`).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(grouped[0]!.theme, "the list opens where the work starts: the data").toBe("1 · Your data: enter and shape it");
    // The stages are the order of work, and every stage a tour claims is one of them.
    expect([...TOUR_THEMES]).toEqual(["1 · Your data: enter and shape it", "2 · Make a graph", "3 · Improve the graph", "4 · Analyse your data", "5 · Make a panel figure"]);
  });

  it("a step that may already be satisfied on entry says so, and its skip agrees with its check", () => {
    const og = step("axes", "open-graph");
    expect(og.skipIf!(base)).toBe(true); // a graph is in front: skip
    expect(og.skipIf!({ ...base, activePlot: null })).toBe(false);
    expect(stepDone(og, base, { ...base, activePlot: null })).toBe(true); // a graph appeared
    expect(stepDone(og, { ...base, activePlot: withPlot(plot({ id: "p2" })) }, base)).toBe(true); // a different graph
    const sp = step("looks", "select-plot");
    expect(sp.skipIf!({ ...base, selectionKind: "series" })).toBe(true); // something is selected already
    expect(sp.skipIf!(base)).toBe(false);
    const oc = step("compare", "open-column");
    expect(oc.skipIf!({ ...base, workingTableKind: "column" })).toBe(true);
    expect(oc.skipIf!(base)).toBe(false);
    expect(stepDone(oc, { ...base, workingTableKind: "column" }, base)).toBe(true);
    expect(stepDone(oc, { ...base, workingTableKind: "grouped" }, base)).toBe(false);
  });

  describe("each action step fires on exactly its change", () => {
    const P = plot();
    const y = (over: Record<string, unknown>) => withPlot(plot({ yAxis: { ...over } } as Partial<Plot>));
    const style = (over: Record<string, unknown>) => withPlot(plot({ seriesStyles: { c1: { ...P.seriesStyles!.c1, ...over } } } as Partial<Plot>));
    const cases: { tour: string; id: string; change: Partial<TourState>; notThis: Partial<TourState> }[] = [
      { tour: "first-graph", id: "paste", change: { importOpen: true }, notThis: { newGraphOpen: true, exportOpen: true } },
      { tour: "first-graph", id: "import", change: { tables: 4, importOpen: false }, notThis: { importOpen: false, plots: 3 } },
      { tour: "first-graph", id: "newgraph", change: { newGraphOpen: true }, notThis: { importOpen: true } },
      { tour: "first-graph", id: "create", change: { plots: 3, newGraphOpen: false }, notThis: { newGraphOpen: false, tables: 4 } },
      { tour: "first-graph", id: "select", change: { selectionKind: "series" }, notThis: { plots: 3 } },
      { tour: "first-graph", id: "colour", change: { activePlot: withPlot(plot({ background: "#eee" })) }, notThis: { selectionKind: "series" } },
      { tour: "first-graph", id: "title", change: { activePlot: withPlot(plot(), "Response to dose") }, notThis: { activePlot: withPlot(plot({ background: "#eee" })) } },
      { tour: "first-graph", id: "export", change: { exportOpen: true }, notThis: { importOpen: true } },
      { tour: "datasheet", id: "add-column", change: { sheet: { ...SHEET, columns: 4 } }, notThis: { sheet: { ...SHEET, excluded: 1 } } },
      { tour: "datasheet", id: "type-values", change: { sheet: { ...SHEET, fingerprint: "sheet-b" } }, notThis: { dataSelection: true } },
      { tour: "datasheet", id: "select-cells", change: { dataSelection: true }, notThis: { sheet: { ...SHEET, fingerprint: "sheet-b" } } },
      { tour: "datasheet", id: "exclude", change: { sheet: { ...SHEET, excluded: 2 } }, notThis: { sheet: { ...SHEET, columns: 4 } } },
      { tour: "axes", id: "select-axis", change: { selectionKind: "axis" }, notThis: { selectionKind: "series" } },
      { tour: "axes", id: "range", change: { activePlot: y({ min: 0 }) }, notThis: { activePlot: y({ majorStep: 2 }) } },
      { tour: "axes", id: "ticks", change: { activePlot: y({ majorStep: 2 }) }, notThis: { activePlot: y({ min: 0 }) } },
      { tour: "axes", id: "minor", change: { activePlot: y({ minorCount: 4 }) }, notThis: { activePlot: y({ majorStep: 2 }) } },
      { tour: "axes", id: "break", change: { activePlot: y({ breaks: [{ from: 3, to: 5 }] }) }, notThis: { activePlot: y({ minorCount: 4 }) } },
      { tour: "looks", id: "grid", change: { activePlot: withPlot(plot({ grid: { show: true } } as Partial<Plot>)) }, notThis: { activePlot: withPlot(plot({ frame: "box" } as Partial<Plot>)) } },
      { tour: "looks", id: "frame", change: { activePlot: withPlot(plot({ frame: "box" } as Partial<Plot>)) }, notThis: { activePlot: withPlot(plot({ grid: { show: true } } as Partial<Plot>)) } },
      { tour: "looks", id: "select-plot", change: { selectionKind: "plot" }, notThis: { plots: 3 } },
      { tour: "looks", id: "background", change: { activePlot: withPlot(plot({ background: "#fafafa" })) }, notThis: { activePlot: withPlot(plot({ frame: "box" } as Partial<Plot>)) } },
      { tour: "looks", id: "preset", change: { activePlot: withPlot(plot({ frame: "box" } as Partial<Plot>)) }, notThis: { selectionKind: "series" } },
      { tour: "series", id: "select-series", change: { selectionKind: "series" }, notThis: { selectionKind: "axis" } },
      { tour: "series", id: "colour", change: { activePlot: style({ color: "#ff0000" }) }, notThis: { activePlot: style({ symbol: "square" }) } },
      { tour: "series", id: "shape", change: { activePlot: style({ symbol: "square" }) }, notThis: { activePlot: style({ color: "#ff0000" }) } },
      { tour: "series", id: "connect", change: { activePlot: style({ connect: "smooth" }) }, notThis: { activePlot: style({ lineWidth: 4 }) } },
      { tour: "series", id: "thickness", change: { activePlot: style({ lineWidth: 4 }) }, notThis: { activePlot: style({ connect: "smooth" }) } },
      { tour: "series", id: "analyze", change: { analyzeOpen: true }, notThis: { exportOpen: true } },
      { tour: "series", id: "fit-run", change: { analyses: 2, analyzeOpen: false }, notThis: { analyzeOpen: true } },
      { tour: "compare", id: "compare-run", change: { analyses: 2 }, notThis: { sigMarkers: 2 } },
      { tour: "annotate", id: "add-text", change: { activePlot: withPlot(plot({ annotations: [{ id: "a1", kind: "text", x: 0.5, y: 0.1 }] } as Partial<Plot>)) }, notThis: { activePlot: withPlot(plot({ background: "#eee" })) } },
      { tour: "dose-response", id: "dose-door", change: { analyzeOpen: true }, notThis: { exportOpen: true } },
      { tour: "dose-response", id: "run-fit", change: { analyses: 2 }, notThis: { analyzeOpen: true } },
      { tour: "figure", id: "new-figure", change: { figureOpen: true, figure: FIG }, notThis: { exportOpen: true } },
      { tour: "figure", id: "export-figure", change: { exportOpen: true }, notThis: { analyzeOpen: true } },
      { tour: "compare", id: "markers", change: { sigMarkers: 2 }, notThis: { analyses: 2 } },
      { tour: "compare", id: "sig-style", change: { activePlot: withPlot(plot({ significance: { width: 3 } } as Partial<Plot>)) }, notThis: { sigMarkers: 2 } },
    ];
    for (const c of cases)
      it(`${c.tour}/${c.id}`, () => {
        const s = step(c.tour, c.id);
        // The datasheet steps are entered with a sheet in front; the others with a graph.
        const from: TourState = c.tour === "datasheet" ? { ...base, sheetInFront: true, sheet: SHEET, activePlot: null } : base;
        expect(stepDone(s, { ...from, ...c.change }, from), `${c.id} did not fire on its change`).toBe(true);
        expect(stepDone(s, { ...from, ...c.notThis }, from), `${c.id} fired on an unrelated change`).toBe(false);
      });

    it("datasheet: include waits for the excluded count to fall; open-sheet skips when a sheet is in front and fires when one appears", () => {
      const on = { ...base, sheetInFront: true, sheet: { ...SHEET, excluded: 2 } };
      expect(stepDone(step("datasheet", "include"), { ...on, sheet: { ...SHEET, excluded: 0 } }, on)).toBe(true);
      expect(stepDone(step("datasheet", "include"), { ...on, sheet: { ...SHEET, excluded: 3 } }, on), "more excluded is not 'included'").toBe(false);
      const sc = step("datasheet", "select-cells");
      expect(sc.skipIf!({ ...base, dataSelection: true }), "cells already selected (typing leaves one selected) → skip").toBe(true);
      expect(sc.skipIf!(base)).toBe(false);
      const os = step("datasheet", "open-sheet");
      expect(os.skipIf!(on)).toBe(true);
      expect(os.skipIf!(base)).toBe(false);
      expect(stepDone(os, { ...base, sheetInFront: true, sheet: SHEET }, base)).toBe(true);
      expect(stepDone(os, { ...on, sheet: { ...SHEET, id: "t2" } }, on), "a different sheet counts").toBe(true);
    });

    it("figure: picking needs two panels and more than at entry; arranging is any change to the figure; both dead without a figure in front", () => {
      const inFig = (panels: number, fp = "fig-a"): TourState => ({ ...base, figureOpen: true, figure: { ...FIG, panels, fingerprint: fp } });
      const pick = step("figure", "pick-graphs");
      expect(stepDone(pick, inFig(2), inFig(0))).toBe(true);
      expect(stepDone(pick, inFig(1), inFig(0)), "one panel is not a figure yet").toBe(false);
      expect(stepDone(pick, inFig(2), inFig(2)), "already two at entry: the reader added nothing").toBe(false);
      expect(stepDone(pick, inFig(3), inFig(2))).toBe(true);
      const arr = step("figure", "arrange");
      expect(stepDone(arr, inFig(2, "fig-b"), inFig(2))).toBe(true);
      expect(stepDone(arr, { ...base, figureOpen: false, figure: null }, inFig(2)), "no figure in front").toBe(false);
      for (const id of ["pick-graphs", "arrange", "export-figure"]) expect(step("figure", id).needs, `figure/${id} works in the builder but declares no need`).toBe("figure");
    });

    it("annotate: each step counts annotations on the graph in front and never fires without one", () => {
      const withAnn = (n: number) => withPlot(plot({ annotations: Array.from({ length: n }, (_, i) => ({ id: `a${i}`, kind: "text", x: 0.5, y: 0.1 })) } as Partial<Plot>));
      for (const id of ["add-text", "add-arrow", "add-band"]) {
        const st = step("annotate", id);
        expect(stepDone(st, { ...base, activePlot: withAnn(1) }, { ...base, activePlot: withAnn(0) })).toBe(true);
        expect(stepDone(st, { ...base, activePlot: withAnn(1) }, { ...base, activePlot: null }), `${id} fired when a graph merely appeared`).toBe(false);
        expect(stepDone(st, { ...base, activePlot: null }, { ...base, activePlot: withAnn(1) })).toBe(false);
      }
    });

    it("exportgo waits for the dialog to close after having been open — cancelling counts, never-opened does not", () => {
      const s = step("first-graph", "exportgo");
      const open = { ...base, exportOpen: true };
      expect(stepDone(s, open, open)).toBe(false); // still open
      expect(stepDone(s, base, open)).toBe(true); // was open, now closed
      expect(stepDone(s, base, base)).toBe(false); // never opened
    });

    it("a graph-reading step does nothing while no graph is in front (the reader clicked away to a sheet)", () => {
      const gone = { ...base, activePlot: null };
      for (const [tour, id] of [["first-graph", "colour"], ["first-graph", "title"], ["axes", "range"], ["axes", "break"], ["looks", "grid"], ["series", "colour"], ["compare", "sig-style"]] as const) {
        expect(stepDone(step(tour, id), gone, base), `${tour}/${id} fired with no graph`).toBe(false);
        expect(stepDone(step(tour, id), base, gone), `${tour}/${id} fired when a graph merely appeared`).toBe(false);
      }
    });

    it("a change on the X axis counts as much as one on Y — the reader may have clicked either", () => {
      const s = step("axes", "ticks");
      expect(stepDone(s, { ...base, activePlot: withPlot(plot({ xAxis: { majorStep: 5 } } as Partial<Plot>)) }, base)).toBe(true);
    });

    it("a colour set on one point counts — clicking a point selects the point, and the Inspector writes there", () => {
      const s = step("series", "colour");
      const dotted = plot({ pointStyles: { r1: { color: "#f00" } } } as Partial<Plot>);
      expect(stepDone(s, { ...base, activePlot: withPlot(dotted) }, base)).toBe(true);
      expect(stepDone(step("series", "shape"), { ...base, activePlot: withPlot(dotted) }, base)).toBe(false);
    });

    it("a second series changing counts too — the check looks at every series, not the first", () => {
      const s = step("series", "colour");
      const two = plot({ seriesStyles: { ...plot().seriesStyles, c2: { color: "#000" } } } as Partial<Plot>);
      const twoChanged = plot({ seriesStyles: { ...plot().seriesStyles, c2: { color: "#0f0" } } } as Partial<Plot>);
      expect(stepDone(s, { ...base, activePlot: withPlot(twoChanged) }, { ...base, activePlot: withPlot(two) })).toBe(true);
    });
  });

  it("the sample block is what a spreadsheet copy produces: a heading row, tabs, three numeric columns", () => {
    const rows = TOUR_SAMPLE_TSV.split("\n");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows[0]).toBe("Dose\tControl\tTreated");
    for (const r of rows.slice(1)) {
      const cells = r.split("\t");
      expect(cells.length).toBe(3);
      for (const c of cells) expect(Number.isFinite(Number(c)), `not a number: ${c}`).toBe(true);
    }
  });
});
