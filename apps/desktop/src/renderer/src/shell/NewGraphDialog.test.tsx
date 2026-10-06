// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { TableKind } from "@mady/core";
import { createSampleDocument } from "@mady/core";
import { clampPreviewZoom, NewGraphDialog, nextConfigHeight, previewSceneSize } from "./NewGraphDialog";
import { NEW_GRAPH_GENRES } from "./newGraph";
import { SUGGESTION_ORDER } from "./newGraph";

afterEach(cleanup);

function setup(currentTableKind?: TableKind) {
  const onCreate = vi.fn();
  const onCancel = vi.fn();
  const u = render(<NewGraphDialog currentTableKind={currentTableKind} onCreate={onCreate} onCancel={onCancel} />);
  // The dialog opens in data-first mode (the default); these graph-type tests
  // exercise the graph-first flow, so switch to it. The data-first test opts back in.
  fireEvent.click([...u.container.querySelectorAll(".ng-segbtn")].find((b) => /Graph.+datasheet/.test(b.textContent ?? "")) as HTMLButtonElement);
  const createBtn = () => u.container.querySelector(".btn") as HTMLButtonElement;
  const genre = (key: string) => fireEvent.click(u.container.querySelector(`[data-genre="${key}"]`) as HTMLButtonElement);
  const kind = (k: string) => fireEvent.click(u.container.querySelector(`[data-kind="${k}"]`) as HTMLButtonElement);
  const output = (label: RegExp) => fireEvent.click([...u.container.querySelectorAll(".ng-segbtn")].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement);
  const sel = (label: string) => u.container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement | null;
  const input = (label: string) => u.container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
  return { ...u, onCreate, onCancel, createBtn, genre, kind, output, sel, input };
}

describe("NewGraphDialog — the resizable divider between the graph grid and the options", () => {
  // (i) The graph-icon grid is roomy by default, and (ii) a real splitter re-splits the space.
  it("renders a draggable separator between the two sections", () => {
    const d = setup();
    const div = d.container.querySelector(".ng-divider");
    expect(div, "no divider between the graph grid and the options").toBeTruthy();
    expect(div!.getAttribute("role")).toBe("separator");
    // It sits between the scrolling grid and the options, so a drag re-splits exactly those two.
    expect(div!.previousElementSibling?.classList.contains("an-scroll")).toBe(true);
    expect(div!.nextElementSibling?.classList.contains("ng-config")).toBe(true);
  });

  it("previewSceneSize: builds the sample at the graph's real size, not a squished thumbnail", () => {
    // Guards against building at 280×175 — fonts/margins are fixed px, so the plot area would be
    // crushed. The real default (580×380) is a faithful miniature; CSS shrinks the SVG uniformly to fit.
    expect(previewSceneSize({})).toEqual({ width: 580, height: 380 });
    // A sample that carries its own figure size keeps it (its true proportions).
    expect(previewSceneSize({ figureWidth: 420, figureHeight: 360 })).toEqual({ width: 420, height: 360 });
  });

  it("clampPreviewZoom: keeps the inspect-zoom in a usable range (0.25×–4×)", () => {
    expect(clampPreviewZoom(1)).toBe(1);
    expect(clampPreviewZoom(9)).toBe(4);
    expect(clampPreviewZoom(0.01)).toBe(0.25);
  });

  it("the sample preview renders at real proportions with inspect controls when sample data is on", () => {
    const d = setup(); // graph-first, XY selected by default (XY ships a sample)
    const cb = d.container.querySelector('input[aria-label="Start with sample data"]') as HTMLInputElement | null;
    expect(cb, "no 'sample data' toggle for XY").toBeTruthy();
    fireEvent.click(cb!);
    const svg = d.container.querySelector(".ng-preview svg") as SVGSVGElement | null;
    expect(svg, "no sample preview rendered").toBeTruthy();
    // Guards against a 280px-wide build; real proportions are ≥500.
    const vbW = Number((svg!.getAttribute("viewBox") ?? "").split(/\s+/)[2]);
    expect(vbW).toBeGreaterThanOrEqual(500);
    expect(vbW).not.toBe(280);
    // …and it can be inspected: zoom out / in / fit.
    expect(d.container.querySelector('.ng-preview [aria-label="Zoom out"]'), "no zoom-out control").toBeTruthy();
    expect(d.container.querySelector('.ng-preview [aria-label="Fit zoom"]'), "no fit control").toBeTruthy();
  });

  it("nextConfigHeight: dragging up grows the options, down shrinks them, always clamped", () => {
    // Dragging up (dy<0) grows the options (more height); down (dy>0) shrinks them (more grid).
    expect(nextConfigHeight(200, -50, 600)).toBe(250);
    expect(nextConfigHeight(200, 50, 600)).toBe(150);
    // Clamp: never below the 72px floor, never so tall the grid + buttons lose their 220px.
    expect(nextConfigHeight(200, 1000, 600)).toBe(72);
    expect(nextConfigHeight(200, -1000, 600)).toBe(380); // 600 − 220
    // A tiny modal still leaves the options a usable floor (maxH floored at 120).
    expect(nextConfigHeight(100, -1000, 200)).toBe(120);
  });
});

describe("NewGraphDialog", () => {
  it("renders a genre icon per graph type with XY selected by default, and creates it", () => {
    const d = setup();
    expect(d.container.querySelectorAll(".an-card").length).toBeGreaterThanOrEqual(20);
    expect(d.container.querySelector('[data-genre="xy"]')!.getAttribute("aria-pressed")).toBe("true");
    // Every graph type lives in one list — no separate "advanced" category.
    expect(d.container.querySelectorAll('[aria-label="Graph types"]').length).toBe(1);
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "xy", tableKind: "xy", entryMode: "replicates", replicates: 3, errorBars: "sd" });
  });

  it("data-first mode: pick a datasheet format → suggested graphs → creates sheet + graph", () => {
    const d = setup();
    d.output(/Datasheet → graph/);
    expect(d.container.querySelector(".modalh")!.textContent).toBe("New datasheet + graph");
    // The datasheet format is the primary pick; choose a column table.
    d.kind("column");
    // Only graphs compatible with a column table are suggested (bar yes; XY-only area no).
    expect(d.container.querySelector('[data-genre="bar"]')).toBeTruthy();
    expect(d.container.querySelector('[data-genre="area"]')).toBeNull();
    expect([...d.container.querySelectorAll(".an-group-h")].some((h) => /suggested graphs/i.test(h.textContent ?? ""))).toBe(true);
    // Pick a suggested graph and create → the spec carries both the format and the genre.
    d.genre("bar");
    expect(d.createBtn().textContent).toBe("Create datasheet + graph");
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "bar", tableKind: "column" }));
  });

  it("an analysis-fed genre (Kaplan-Meier) with no open sheet says it makes a datasheet, not a graph", () => {
    // Create makes only the datasheet — the curves come from Analyze ▸ Survival — so the button
    // must not promise "+ graph" and then deliver a sheet with no graph.
    const d = setup();
    d.output(/Datasheet → graph/);
    d.kind("survival");
    d.genre("survival");
    expect(d.createBtn().textContent).toBe("Create datasheet (graph via Analyze)");
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "survival", tableKind: "survival" }));
  });

  it("Settings → Default graph type still wins in data-first mode when no sheet is open", () => {
    // The remembered default is read from getAppDefaults(); with no stored settings it is XY,
    // the built-in default. With no table and a format without its own SUGGESTION_ORDER, a
    // compatible remembered default is kept, so the XY card is lit. Switching the format to
    // column (no order, and XY cannot draw it) falls to the first compatible graph (bar).
    const d = setup();
    d.output(/Datasheet → graph/);
    expect(d.container.querySelector('[data-genre="xy"]')!.getAttribute("aria-pressed")).toBe("true");
    d.kind("column");
    expect(d.container.querySelector('[data-genre="bar"]')!.getAttribute("aria-pressed")).toBe("true");
  });

  it("filters the format list to only the genre's compatible datasheet formats", () => {
    const d = setup();
    d.genre("bar");
    const fmt = d.sel("Datasheet format")!;
    expect([...fmt.options].map((o) => o.value)).toEqual(["column", "grouped"]);
    fireEvent.click(d.createBtn());
    // Column format carries the entry mode + count, like XY.
    // A Column datasheet has no replicate subcolumns (replicates are rows), so the wizard fixes
    // the count at 1 for column format — a fresh column bar never seeds Control·1/·2/·3 columns.
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "bar", tableKind: "column", entryMode: "replicates", replicates: 1, errorBars: "sd" });
  });

  it("flows the replicate count + error-bar choice into the spec for a replicate format", () => {
    const d = setup();
    d.genre("xy");
    fireEvent.change(d.input("Replicates")!, { target: { value: "4" } });
    fireEvent.change(d.sel("Error bars")!, { target: { value: "sem" } });
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "xy", tableKind: "xy", entryMode: "replicates", replicates: 4, errorBars: "sem" });
  });

  it("a summary entry mode hides the replicate count + error picker (the entry mode fixes the error type)", () => {
    const d = setup();
    d.genre("xy");
    fireEvent.change(d.sel("Data entry")!, { target: { value: "mean-sem-n" } });
    expect(d.input("Replicates")).toBeNull();
    expect(d.sel("Error bars")).toBeNull();
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "xy", tableKind: "xy", entryMode: "mean-sem-n", errorBars: "sd" });
  });

  it("a non-error genre (pie) shows no error or replicate controls", () => {
    const d = setup();
    d.genre("pie");
    expect(d.sel("Data entry")).toBeNull();
    expect(d.sel("Error bars")).toBeNull();
    expect(d.input("Replicates")).toBeNull();
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "pie", tableKind: "partsofwhole" });
  });

  it("badges the current table's format as 'your data' in the compatible list", () => {
    const d = setup("grouped");
    d.genre("bar");
    const opt = [...d.sel("Datasheet format")!.options].find((o) => o.value === "grouped")!;
    expect(opt.textContent).toMatch(/your data/i);
  });

  it("search filters the genre grid", () => {
    const d = setup();
    fireEvent.change(d.input("Search graph types")!, { target: { value: "violin" } });
    expect(d.container.querySelector('[data-genre="violin"]')).toBeTruthy();
    expect(d.container.querySelector('[data-genre="bar"]')).toBeNull();
  });

  it("'Datasheet only' hides the graph grid + error controls and creates a table (no genre)", () => {
    const d = setup();
    d.output(/datasheet only/i);
    // The genre grid + graph-type search disappear (table-first).
    expect(d.container.querySelector('[data-genre="xy"]')).toBeNull();
    expect(d.input("Search graph types")).toBeNull();
    expect(d.sel("Error bars")).toBeNull();
    // The 8 data-type cards remain to pick the format.
    expect(d.container.querySelector('[data-kind="grouped"]')).toBeTruthy();
    d.kind("grouped");
    fireEvent.click(d.createBtn());
    // Grouped is replicate-capable → default entry mode + 3 replicates, no plot, no genre.
    expect(d.onCreate).toHaveBeenCalledWith({ output: "table", tableKind: "grouped", entryMode: "replicates", replicates: 3 });
  });

  it("'By data type' filters the genre grid to compatible genres and re-selects an orphaned pick", () => {
    const d = setup();
    // XY is selected by default; filtering to Column data drops XY-only genres and keeps bar/box/…
    d.kind("column");
    expect(d.container.querySelector('[data-genre="bar"]')).toBeTruthy();
    expect(d.container.querySelector('[data-genre="xy"]')).toBeNull(); // XY genre needs an xy table
    // The orphaned XY pick auto-moves to the first compatible genre → creating yields a column table.
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ tableKind: "column" }));
    expect(d.onCreate.mock.calls[0]![0]).not.toHaveProperty("output"); // still a graph
  });

  it("offers the pre-computed summary entry formats and carries them in the spec", () => {
    const d = setup();
    d.genre("xy");
    // The extended data-entry menu includes the no-N + %CV + limits formats.
    const opts = [...d.sel("Data entry")!.options].map((o) => o.value);
    expect(opts).toEqual(expect.arrayContaining(["mean-sd", "mean-cv-n", "mean-err", "mean-limits"]));
    fireEvent.change(d.sel("Data entry")!, { target: { value: "mean-limits" } });
    // A summary mode fixes the error type → the error-bar picker is hidden.
    expect(d.sel("Error bars")).toBeNull();
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith({ genre: "xy", tableKind: "xy", entryMode: "mean-limits", errorBars: "sd" });
  });

  it("offers 'start with sample data' for a genre with an example and carries it in the spec", () => {
    const d = setup();
    d.genre("xy");
    const chk = d.input("Start with sample data");
    expect(chk).toBeTruthy();
    fireEvent.click(chk!);
    fireEvent.click(d.createBtn());
    const spec = d.onCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec.genre).toBe("xy");
    expect(spec.tableKind).toBe("xy");
    expect(spec.sampleData).toBe(true);
    /*
     * The entryMode/replicates controls apply to the example, so those fields travel in the
     * sample spec by design. What has to hold is that an untouched panel cannot restructure
     * the example: the values sent must be the sample's own shape, never a blank sheet's
     * defaults (which are "replicates" x3, while the XY sample has 1).
     */
    expect(spec.entryMode).toBe("replicates");
    expect(spec.replicates, "an untouched panel would bolt empty sub-columns onto the sample").toBe(1);
    expect(spec.xColumnType, "the sample path must not carry a blank-sheet X column type").toBeUndefined();
  });

  /**
   * The options about replicates, SD, etc. must stay reachable when the sample dataset tickbox
   * is ticked. The error bars and whiskers are graph choices about how to read that data, so
   * they stay on screen and travel in the spec.
   */
  it("keeps the error-bar choice reachable with sample data on, and carries it", () => {
    const d = setup();
    d.genre("groupedbar"); // its sample carries replicate values, so an error bar can be drawn
    fireEvent.click(d.input("Start with sample data")!);
    const sel = d.sel("Error bars");
    expect(sel, "the error-bar picker vanished when the sample preview came up").toBeTruthy();
    fireEvent.change(sel!, { target: { value: "sem" } });
    fireEvent.click(d.createBtn());
    expect((d.onCreate.mock.calls[0]![0] as Record<string, unknown>).errorBars).toBe("sem");
  });

  /**
   * The other half of the same rule, and the reason the gate asks the data and not the entry mode:
   * the XY sample holds one Y value per row, so no error bar can be computed from it. Offering the
   * picker there would be a control that silently does nothing. (tableEntryMode reports
   * "replicates" for it — that is its fallback, not a measurement — so this fixture is exactly the
   * one that catches a gate written against the entry mode.)
   */
  it("does not offer the error-bar choice on a sample whose data cannot draw one", () => {
    const d = setup();
    d.genre("xy");
    expect(d.sel("Error bars"), "the XY blank path should still offer it").toBeTruthy();
    fireEvent.click(d.input("Start with sample data")!);
    expect(d.sel("Error bars"), "the XY sample has no replicates — the picker would do nothing").toBeNull();
  });

  it("keeps the whisker choice reachable with sample data on, and carries it", () => {
    const d = setup();
    d.genre("box");
    fireEvent.click(d.input("Start with sample data")!);
    const sel = d.sel("Whiskers");
    expect(sel, "the whisker picker vanished when the sample preview came up").toBeTruthy();
    fireEvent.change(sel!, { target: { value: "minmax" } });
    fireEvent.click(d.createBtn());
    expect((d.onCreate.mock.calls[0]![0] as Record<string, unknown>).boxWhisker).toBe("minmax");
  });

  it("keeps Data entry and Replicates reachable with sample data on, seeded from the example", () => {
    const d2 = setup();
    d2.genre("xy");
    fireEvent.click(d2.input("Start with sample data")!);
    expect(d2.sel("Data entry"), "Data entry vanished when the sample box was ticked").toBeTruthy();
    const reps = d2.input("Replicates");
    expect(reps, "Replicates vanished when the sample box was ticked").toBeTruthy();
    // Seeded from the sample (1), not from a blank sheet's default (3) — otherwise ticking the box
    // would silently promise to bolt two empty sub-columns onto the worked example.
    expect(reps!.value, "the count shows a blank sheet's default, not the sample's real shape").toBe("1");
    fireEvent.change(reps!, { target: { value: "4" } });
    fireEvent.click(d2.createBtn());
    const spec = d2.onCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec.replicates).toBe(4);
    expect(spec.entryMode).toBe("replicates");
  });

  it("puts the sample preview last in the options panel, so no control sits under it", () => {
    const d = setup();
    d.genre("xy");
    fireEvent.click(d.input("Start with sample data")!);
    const cfg = d.container.querySelector(".ng-config")!;
    expect(cfg.querySelector(".ng-preview"), "no preview").toBeTruthy();
    expect(
      cfg.lastElementChild?.classList.contains("ng-preview"),
      "the preview is not last — the controls after it are pushed under the fold",
    ).toBe(true);
  });

  /**
   * The wizard is resizable (CSS `resize: both`), and a shrink-drag ends outside it — so the browser
   * fires the click on the overlay, the nearest common ancestor of the down and up targets. To keep
   * that from shutting the dialog in the middle of a resize, dismiss needs the press to have started
   * on the overlay. (The resize itself is layout, guarded in e2e/newgraph-resize.spec.ts.)
   */
  it("a click that began inside the dialog does not dismiss it, only one that began on the overlay", () => {
    const d = setup();
    const overlay = d.container.querySelector(".modalov") as HTMLElement;
    const dialog = d.container.querySelector(".modal-analyze") as HTMLElement;

    // A drag that starts on the dialog (the resize grip) and releases over the overlay.
    fireEvent.pointerDown(dialog);
    fireEvent.click(overlay, { target: overlay });
    expect(d.onCancel, "a resize drag released over the overlay closed the wizard").not.toHaveBeenCalled();

    // A genuine overlay click still dismisses.
    fireEvent.pointerDown(overlay);
    fireEvent.click(overlay);
    expect(d.onCancel, "clicking the overlay does not close the wizard").toHaveBeenCalled();
  });

  /**
   * "Graph + datasheet" mode exists to answer "what datasheet do I need for this graph?" — so the
   * format it will create has to be visible. Guards against the lit card falling back to the user's
   * own filter, which is null until they click one, leaving nothing highlighted.
   * A single-format genre has no format dropdown either, leaving the suggestion with no
   * representation on screen at all — which is why survival is the fixture here.
   */
  it("graph-first: the datasheet format the wizard will create is the highlighted card", () => {
    const d = setup(); // setup() already switches to "Graph + datasheet"
    const lit = (): (string | null)[] =>
      [...d.container.querySelectorAll("[data-kind]")]
        .filter((b) => b.classList.contains("is-active"))
        .map((b) => b.getAttribute("data-kind"));

    d.genre("box");
    expect(lit(), "the format a box plot needs is not highlighted").toEqual(["column"]);

    // Survival ships one format, so it has no dropdown — the card is the only thing that can say it.
    d.genre("survival");
    expect(d.sel("Datasheet format"), "survival gained a format dropdown; pick another fixture").toBeNull();
    expect(lit(), "a single-format genre shows its datasheet nowhere").toEqual(["survival"]);

    // And the highlight follows an explicit format choice, so it never disagrees with what is made.
    d.genre("heatmap");
    const sel = d.sel("Datasheet format")!;
    fireEvent.change(sel, { target: { value: "multivariable" } });
    expect(lit(), "the highlight ignored an explicit format choice").toEqual(["multivariable"]);
  });

  it("hides the sample-data checkbox for a genre without an example and in datasheet-only mode", () => {
    const d = setup();
    d.genre("contingency"); // contingency ships no gallery example (groupedbar has one)
    expect(d.input("Start with sample data")).toBeNull();
    d.output(/datasheet only/i);
    expect(d.input("Start with sample data")).toBeNull();
  });

  it("offers an X-axis type (numbers/dates/elapsed) for XY genres and carries it in the spec", () => {
    const d = setup();
    d.genre("xy");
    const sel = d.sel("X axis type");
    expect(sel).toBeTruthy();
    expect([...sel!.options].map((o) => o.value)).toEqual(["number", "date", "elapsed"]);
    fireEvent.change(sel!, { target: { value: "date" } });
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "xy", tableKind: "xy", xColumnType: "date" }));
  });

  it("hides the X-axis type picker for a categorical genre (bar → column data)", () => {
    const d = setup();
    d.genre("bar");
    expect(d.sel("X axis type")).toBeNull();
  });

  it("renders the live sample graph only when 'start with sample data' is on", () => {
    const d = setup();
    d.genre("xy");
    expect(d.container.querySelector('[aria-label="Sample graph preview"]')).toBeNull();
    fireEvent.click(d.input("Start with sample data")!);
    expect(d.container.querySelector('[aria-label="Sample graph preview"]')).toBeTruthy();
  });

  it("graph-first mode leads with the graph grid, data-structure filter below", () => {
    const d = setup(); // setup() switches to the "Graph + datasheet" (graph-first) tab
    const graphGrid = d.container.querySelector('[aria-label="Graph types"]')!;
    const dataGrid = d.container.querySelector('[aria-label="Data types"]')!;
    expect(graphGrid).toBeTruthy();
    expect(dataGrid).toBeTruthy();
    // Graph grid must come before the data-structure grid in document order.
    expect(graphGrid.compareDocumentPosition(dataGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("data-first mode leads with the datasheet, graph grid below", () => {
    const d = setup();
    d.output(/Datasheet → graph/);
    const dataGrid = d.container.querySelector('[aria-label="Data types"]')!;
    const graphGrid = d.container.querySelector('[aria-label="Graph types"]')!;
    // Data-structure grid comes before the graph grid in document order.
    expect(dataGrid.compareDocumentPosition(graphGrid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("bubble is error-capable: offers the error-bar picker and carries the chosen type", () => {
    const d = setup();
    d.genre("bubble");
    expect(d.sel("Error bars")).toBeTruthy();
    fireEvent.change(d.sel("Error bars")!, { target: { value: "sem" } });
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "bubble", tableKind: "xy", errorBars: "sem" }));
  });

  it("floating bar offers a 'Bar spans' definition (min→max default, no Tukey) and carries it", () => {
    const d = setup();
    d.genre("floatingbar");
    const spans = d.sel("Bar spans");
    expect(spans).toBeTruthy();
    expect(spans!.value).toBe("minmax"); // a floating bar spans min→max by default
    expect([...spans!.options].map((o) => o.value)).not.toContain("tukey"); // it draws no whiskers to fence
    // It is not mislabelled "Whiskers", and box still is (positive control).
    expect(d.sel("Whiskers")).toBeNull();
    fireEvent.change(spans!, { target: { value: "p10_90" } });
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "floatingbar", boxWhisker: "p10_90" }));
  });

  it("box keeps its 'Whiskers' definition (Tukey default), not 'Bar spans'", () => {
    const d = setup();
    d.genre("box");
    expect(d.sel("Whiskers")).toBeTruthy();
    expect(d.sel("Whiskers")!.value).toBe("tukey");
    expect(d.sel("Bar spans")).toBeNull();
  });

  it("lollipop error bars are opt-in: the picker offers 'None', defaults to it, and carries it", () => {
    const d = setup();
    d.genre("lollipop");
    const sel = d.sel("Error bars");
    expect(sel).toBeTruthy();
    expect(sel!.value).toBe("none"); // off by default — a whisker is unusual on a lollipop
    const opts = [...sel!.options].map((o) => o.value);
    expect(opts).toContain("none");
    expect(opts).toContain("sd"); // but SD/SEM/… are available to opt in
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "lollipop", errorBars: "none" }));
  });

  it("lollipop: choosing an error type carries it into the spec", () => {
    const d = setup();
    d.genre("lollipop");
    fireEvent.change(d.sel("Error bars")!, { target: { value: "sem" } });
    fireEvent.click(d.createBtn());
    expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "lollipop", errorBars: "sem" }));
  });

  it("cancels", () => {
    const d = setup();
    fireEvent.click(d.container.querySelector(".btn-ghost") as HTMLButtonElement);
    expect(d.onCancel).toHaveBeenCalled();
  });
  /**
   * Opened from a datasheet: the graph goes on that sheet by default. The wizard offers
   * "suggested graphs for this datasheet", badged "Your data", so Create must graph the open sheet
   * (here "Cell profiling (PCA demo)"), never build a new empty sheet and an empty graph instead.
   */
  describe("opened from a datasheet", () => {
    // The real demo sheet (columns + rows), because the grid is ranked by what draws it.
    const table = createSampleDocument().toJSON().tables.find((t) => t.name === "Cell profiling (PCA demo)")!;
    const setupWith = (t: typeof table | undefined) => {
      const onCreate = vi.fn();
      const u = render(<NewGraphDialog currentTableKind={t?.kind} currentTable={t} onCreate={onCreate} onCancel={vi.fn()} />);
      return { ...u, onCreate };
    };

    it("defaults to graphing the open sheet: the title names it, and Create emits sourceTableId — no new datasheet", () => {
      const d = setupWith(table);
      expect(d.container.querySelector(".modalh")!.textContent).toBe("New graph of “Cell profiling (PCA demo)”");
      const src = d.container.querySelector<HTMLSelectElement>('select[aria-label="Data source"]')!;
      expect(src.value).toBe("open");
      // Sheet-shaping rows are hidden — the data already has its shape.
      expect(d.container.querySelector('select[aria-label="Data entry"]')).toBeNull();
      expect(d.container.querySelector('select[aria-label="Add to project"]')).toBeNull();
      // The PCA format offers the PCA graphs only; the score plot is the default. It is analysis-fed,
      // so on the open sheet Create hands off to Analyze — the button reads "Open Analyze…".
      fireEvent.click(d.container.querySelector('[data-genre="pcascore"]') as HTMLButtonElement);
      expect(d.container.querySelector(".btn")!.textContent).toBe("Open Analyze…");
      fireEvent.click(d.container.querySelector(".btn") as HTMLButtonElement);
      expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "pcascore", sourceTableId: table.id }));
      expect(d.onCreate.mock.calls[0]![0]).not.toHaveProperty("dest");
    });

    it("'A new blank datasheet' makes a new sheet (no sourceTableId, sheet-shaping rows shown)", () => {
      const d = setupWith(table);
      fireEvent.change(d.container.querySelector('select[aria-label="Data source"]')!, { target: { value: "new" } });
      expect(d.container.querySelector(".modalh")!.textContent).toBe("New datasheet + graph");
      expect(d.container.querySelector('select[aria-label="Add to project"]')).not.toBeNull();
      fireEvent.click(d.container.querySelector(".btn") as HTMLButtonElement);
      expect(d.onCreate.mock.calls[0]![0]).not.toHaveProperty("sourceTableId");
    });

    it("picking a format the open sheet is not — the choice disappears and a new sheet is built", () => {
      const d = setupWith(table);
      fireEvent.click(d.container.querySelector('[data-kind="column"]') as HTMLButtonElement);
      expect(d.container.querySelector('select[aria-label="Data source"]')).toBeNull();
      fireEvent.click(d.container.querySelector(".btn") as HTMLButtonElement);
      expect(d.onCreate.mock.calls[0]![0]).not.toHaveProperty("sourceTableId");
      expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ tableKind: "column" }));
    });

    it("'Datasheet only' never offers the open sheet (there is no graph to put on it)", () => {
      const d = setupWith(table);
      fireEvent.click([...d.container.querySelectorAll(".ng-segbtn")].find((b) => /Datasheet only/.test(b.textContent ?? "")) as HTMLButtonElement);
      expect(d.container.querySelector('select[aria-label="Data source"]')).toBeNull();
    });

    it("the PCA / ordination format offers the PCA graphs only, score plot pre-selected — no heatmap / parallel / correlation matrix", () => {
      // A dedicated PCA-only format. New-graph on it leads with the PCA score
      // plot and offers just the four PCA graphs — never XY and never the wider multivariable set.
      const d = setupWith(table); // "Cell profiling (PCA demo)" is the PCA format
      const keys = [...d.container.querySelectorAll('[aria-label="Graph types"] [data-genre]')].map((b) => b.getAttribute("data-genre"));
      expect(keys).toEqual(["pcascore", "pcabiplot", "triplot", "pcaload", "scree"]);
      expect(keys).not.toContain("heatmap");
      expect(keys).not.toContain("parallel");
      expect(keys).not.toContain("xy");
      expect(SUGGESTION_ORDER.pca).toEqual(["pcascore", "pcabiplot", "triplot", "pcaload", "scree"]);
      expect(d.container.querySelector('[data-genre="pcascore"]')!.getAttribute("aria-pressed")).toBe("true");
      // …and the other formats keep catalogue order (column: bar is still first).
      fireEvent.click(d.container.querySelector('[data-kind="column"]') as HTMLButtonElement);
      const col = [...d.container.querySelectorAll('[aria-label="Graph types"] [data-genre]')].map((b) => b.getAttribute("data-genre"));
      expect(col[0]).toBe("bar");
    });

    it("a text-X xy sheet pre-selects the data-aware first card (heatmap / network), not the remembered XY default", () => {
      const tables = createSampleDocument().toJSON().tables;
      const gene = setupWith(tables.find((t) => t.name === "Gene expression")!);
      expect(gene.container.querySelector('[data-genre="heatmap"]')!.getAttribute("aria-pressed")).toBe("true");
      expect(gene.container.querySelector('[data-genre="xy"]')!.getAttribute("aria-pressed")).toBe("false");
      fireEvent.click(gene.container.querySelector(".btn") as HTMLButtonElement);
      expect(gene.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "heatmap", sourceTableId: tables.find((t) => t.name === "Gene expression")!.id }));
      cleanup();
      const net = setupWith(tables.find((t) => t.name === "Immune signaling")!);
      expect(net.container.querySelector('[data-genre="network"]')!.getAttribute("aria-pressed")).toBe("true");
      // …and a click still wins over the suggestion.
      fireEvent.click(net.container.querySelector('[data-genre="xy"]') as HTMLButtonElement);
      expect(net.container.querySelector('[data-genre="xy"]')!.getAttribute("aria-pressed")).toBe("true");
    });

    it("'Graph + datasheet' (graph-first) from a sheet keeps offering that sheet when the genre accepts its format", () => {
      const gene = createSampleDocument().toJSON().tables.find((t) => t.name === "Gene expression")!;
      const d = setupWith(gene);
      fireEvent.click([...d.container.querySelectorAll(".ng-segbtn")].find((b) => /Graph.+datasheet/.test(b.textContent ?? "")) as HTMLButtonElement);
      fireEvent.click(d.container.querySelector('[data-genre="heatmap"]') as HTMLButtonElement);
      // Heatmap's first format is grouped; the open sheet is xy and heatmap accepts xy → the sheet wins.
      expect(d.container.querySelector<HTMLSelectElement>('select[aria-label="Data source"]')?.value).toBe("open");
      fireEvent.click(d.container.querySelector(".btn") as HTMLButtonElement);
      expect(d.onCreate).toHaveBeenCalledWith(expect.objectContaining({ genre: "heatmap", sourceTableId: gene.id }));
    });

    it("an open summary sheet (Median+IQR) offers no error-bar picker it cannot honour", () => {
      const doc = createSampleDocument();
      const t = doc.toJSON().tables.find((x) => x.name === "Replicate readouts")!;
      doc.setEntryMode(t.id, "median-iqr");
      const sheet = doc.toJSON().tables.find((x) => x.id === t.id)!;
      const d = setupWith(sheet);
      expect(d.container.querySelector('[data-genre="bar"]')!.getAttribute("aria-pressed")).toBe("true");
      expect(d.container.querySelector('select[aria-label="Error bars"]'), "a Median+IQR sheet fixes the type — no picker").toBeNull();
      // …a replicate sheet still gets it.
      cleanup();
      const rep = setupWith(createSampleDocument().toJSON().tables.find((x) => x.name === "Replicate readouts")!);
      expect(rep.container.querySelector('select[aria-label="Error bars"]')).not.toBeNull();
    });

    /**
     * Every combination, not one example: for every sample sheet × every graph that can draw
     * its format × every format card the user might click first (e.g. the XY card, then Parallel
     * coordinates, on "Cell profiling"), in both graph modes, Create must put the graph on the
     * open sheet — never a new empty one.
     */
    // Hundreds of dialogs are mounted here. Without a pause after each one the loop never hands control
    // back, so nothing queued per dialog runs and the closed dialogs pile up in memory. One pause
    // per dialog.
    const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

    it("every sheet × every compatible graph × every format card × both modes → the open sheet, never a blank one", async () => {
      const tables = createSampleDocument().toJSON().tables;
      // Three representative format cards per sheet — its own, XY and Column — rather than all
      // eight: the rule under test does not depend on which other card is lit, and the full
      // cross over all eight cards is too slow for a loaded full-suite run.
      const cardsFor = (kind: TableKind): TableKind[] => [...new Set<TableKind>([kind, "xy", "column"])];
      const modes = [/Datasheet → graph/, /Graph.+datasheet/];
      let checked = 0;
      for (const t of tables) {
        for (const g of NEW_GRAPH_GENRES) {
          if (!g.formats.includes(t.kind)) continue;
          for (const f of cardsFor(t.kind)) {
            for (const mode of modes) {
              const d = setupWith(t);
              fireEvent.click([...d.container.querySelectorAll(".ng-segbtn")].find((b) => mode.test(b.textContent ?? "")) as HTMLButtonElement);
              const card = d.container.querySelector(`[data-kind="${f}"]`) as HTMLButtonElement | null;
              if (card) fireEvent.click(card);
              const gcard = d.container.querySelector(`[data-genre="${g.key}"]`) as HTMLButtonElement | null;
              if (!gcard) { cleanup(); await settle(); continue; } // this format filter hides the genre — nothing to create
              fireEvent.click(gcard);
              fireEvent.click(d.container.querySelector(".btn") as HTMLButtonElement);
              const spec = d.onCreate.mock.calls[0]?.[0] as { sourceTableId?: string; genre?: string } | undefined;
              expect(spec?.genre, `${t.name} · ${g.key} · card ${f}`).toBe(g.key);
              expect(spec?.sourceTableId, `${t.name} · ${g.key} · card ${f} · ${mode}: built a new sheet instead of graphing the open one`).toBe(t.id);
              checked++;
              cleanup();
              await settle();
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(100);
    // This test takes about 70 s run alone. A 120 s limit is under twice its own cost and
    // can be exceeded under a loaded full-suite run, so the limit is 240 s — still a real
    // bound, since a hang or a dialog that got three times slower fails, but not one a busy
    // machine can exceed. It already uses three format cards per sheet instead of eight;
    // trimming further would cost coverage.
    }, 240_000); // hundreds of dialog renders, not a unit test

    it("a graph that cannot draw the open sheet says so before Create (it builds a new sheet)", () => {
      const cells = createSampleDocument().toJSON().tables.find((t) => t.name.startsWith("Cell profiling"))!;
      const d = setupWith(cells);
      // Switch to the XY format card and pick XY — it cannot draw a PCA / ordination sheet.
      fireEvent.click(d.container.querySelector('[data-kind="xy"]') as HTMLButtonElement);
      fireEvent.click(d.container.querySelector('[data-genre="xy"]') as HTMLButtonElement);
      expect(d.container.querySelector('select[aria-label="Data source"]')).toBeNull();
      expect(d.container.textContent).toContain("cannot draw a PCA / ordination datasheet");
      // …while a compatible pick (back on the PCA format) keeps the open sheet.
      fireEvent.click(d.container.querySelector('[data-kind="pca"]') as HTMLButtonElement);
      fireEvent.click(d.container.querySelector('[data-genre="pcascore"]') as HTMLButtonElement);
      expect(d.container.querySelector<HTMLSelectElement>('select[aria-label="Data source"]')?.value).toBe("open");
      expect(d.container.textContent).not.toContain("cannot draw");
    });

    it("no open sheet → no choice: a new datasheet + graph", () => {
      const d = setupWith(undefined);
      expect(d.container.querySelector('select[aria-label="Data source"]')).toBeNull();
      expect(d.container.querySelector(".modalh")!.textContent).toBe("New datasheet + graph");
    });
  });
});
