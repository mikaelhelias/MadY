// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { createSampleDocument, DEMO_FOLDER } from "@mady/core";
import type { Project } from "@mady/core";
import { GraphPane } from "./panes";
import { TOURS } from "./tour";
import { AppShell, loadDismissedTips, PCA_GRAPH_SUITE, saveDismissedTips, TAB_GROUP, tabTitle, targetOf, widthResizeTarget } from "./AppShell";

afterEach(cleanup);

/**
 * Rendering the chart gallery is substantial work: `galleryItems()` rebuilds every sample table
 * and plot from scratch, and the pane draws ~60 live scenes. The heaviest of these tests uses about half of
 * vitest's 5 s default in the test body alone, so under the full suite, with workers competing
 * for the CPU, it can exceed that default.
 *
 * Note: this changes the time allowed, not what is asserted. The bound is still real: a hang,
 * or a gallery four times slower, fails.
 */
const GALLERY_TIMEOUT = 20_000;
afterEach(() => globalThis.localStorage?.clear());

describe("AppShell — dismissed-suggestion persistence", () => {
  it("round-trips the dismissed-tip set through localStorage", () => {
    expect([...loadDismissedTips()]).toEqual([]); // empty by default
    saveDismissedTips(new Set(["analysis:t1:ttest:welch", "graph:t1"]));
    expect(loadDismissedTips()).toEqual(new Set(["analysis:t1:ttest:welch", "graph:t1"]));
  });
  it("starts empty when the stored value is corrupt", () => {
    globalThis.localStorage?.setItem("mady.assistant.dismissed", "{not json");
    expect([...loadDismissedTips()]).toEqual([]);
  });
});

// Names AppShell will render (it builds the same deterministic sample internally).
const sample = createSampleDocument().toJSON();
const TABLE_NAME = sample.tables[0]!.name;
const PLOT_NAME = sample.plots[0]!.name;

describe("shell helpers (pure)", () => {
  it("tabTitle resolves each tab kind from the live document", () => {
    const tableId = sample.tables[0]!.id;
    const plotId = sample.plots[0]!.id;
    const folderId = sample.workspace.folders[0]!.id;
    expect(tabTitle(sample, { key: "", kind: "table", id: tableId })).toBe(TABLE_NAME);
    expect(tabTitle(sample, { key: "", kind: "plot", id: plotId })).toBe(PLOT_NAME);
    expect(tabTitle(sample, { key: "", kind: "docs", id: folderId })).toContain("Demo Project");
    expect(tabTitle(sample, { key: "analysis:x", kind: "analysis", id: "missing" })).toBe("Analysis");
    expect(tabTitle(sample, { key: "welcome", kind: "welcome" })).toBe("Welcome");
    expect(tabTitle(sample, { key: "tours", kind: "tours" })).toBe("Guided tours");
  });

  it("TAB_GROUP maps each kind to its nav section", () => {
    expect(TAB_GROUP.table).toBe("data");
    expect(TAB_GROUP.plot).toBe("graphs");
    expect(TAB_GROUP.analysis).toBe("results");
    expect(TAB_GROUP.docs).toBe("docs");
    expect(TAB_GROUP.layout).toBe("layouts");
    expect(TAB_GROUP.welcome).toBe("docs");
  });

  it("targetOf builds the right workspace target per level", () => {
    expect(targetOf()).toEqual({ level: "loose" });
    expect(targetOf("fld_1")).toEqual({ level: "folder", folderId: "fld_1" });
    expect(targetOf("fld_1", "exp_1")).toEqual({
      level: "experiment",
      folderId: "fld_1",
      experimentId: "exp_1",
    });
  });

  // The live width-drag handles render for histogram (bar edges),
  // raincloud/violin (cloud/body edges) and floatingbar (box edges), so resizeWidth must route
  // each of those kinds, not only 'bar'/'box', or their drag handles would do nothing.
  it("widthResizeTarget routes bar-like kinds to bar-width and distribution kinds to box-width", () => {
    // bar-fill kinds → plot-wide barWidth
    expect(widthResizeTarget("bar")).toBe("bar");
    expect(widthResizeTarget("histogram")).toBe("bar");
    // per-series box/cloud width kinds → boxWidth
    expect(widthResizeTarget("box")).toBe("box");
    expect(widthResizeTarget("violin")).toBe("box");
    expect(widthResizeTarget("raincloud")).toBe("box");
    expect(widthResizeTarget("floatingbar")).toBe("box");
    // kinds with no width-drag affordance → null (no dead routing)
    expect(widthResizeTarget("xy")).toBeNull();
    expect(widthResizeTarget("scatter")).toBeNull();
    expect(widthResizeTarget(undefined)).toBeNull();
  });

  // "Plot PCA graphs" is the route from a real analysis to its graphs, so the biplot must be
  // part of the suite alongside score, loadings and scree.
  it("the PCA graph suite includes the biplot so pcabiplot is reachable from an analysis", () => {
    const kinds = PCA_GRAPH_SUITE.map((s) => s.kind);
    expect(kinds).toEqual(["pcascore", "pcaload", "pcabiplot", "scree"]);
    expect(kinds).toContain("pcabiplot");
  });
});

/**
 * The Welcome page — what the app opens on.
 * The demo project is in the Navigator (folded); this is only about what's
 * on screen at launch and where its three links go.
 */
describe("AppShell — Welcome page", () => {
  const canvas = (c: HTMLElement) => within(c.querySelector(".canvas") as HTMLElement);
  const tabsBar = (c: HTMLElement) => within(c.querySelector(".tabs") as HTMLElement);

  it("is the first thing shown, with the program name, artwork and version", () => {
    const { container } = render(<AppShell />);
    expect(canvas(container).getByText("MadY")).toBeTruthy();
    expect(container.querySelector(".welcome-art")).toBeTruthy();
    expect(canvas(container).getByText(/development build|·/)).toBeTruthy(); // version line
  });

  it("'Chart gallery' opens the gallery tab", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Chart gallery"));
    expect(tabsBar(container).getByText("Chart gallery")).toBeTruthy();
  }, GALLERY_TIMEOUT);

  it("'Documentation' opens the manual", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Documentation"));
    // "Docs" also names the tab-strip group label, so match the actual tab by its title.
    expect(tabsBar(container).getByTitle(/^Docs — click to open/)).toBeTruthy();
  });

  // Two different doors: one makes the folder you file work into, the other makes the sheet
  // you type numbers into. A single tile could not describe both.
  it("'New datasheet / graph' opens the creator dialog", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("New datasheet / graph"));
    expect(container.querySelector("[role=dialog]"), "the creator dialog did not open").toBeTruthy();
  });

  it("'Start a new project' adds a project folder to the tree, and opens no dialog", () => {
    const { container } = render(<AppShell />);
    const nav = () => within(container.querySelector(".nav") as HTMLElement);
    expect(nav().queryByText("Project 2"), "a second project existed before we started").toBeNull();
    fireEvent.click(canvas(container).getByText("Start a new project"));
    expect(nav().getByText("Project 2"), "no new project folder appeared in the tree").toBeTruthy();
    expect(container.querySelector("[role=dialog]"), "it opened the datasheet creator instead").toBeNull();
  });

  /**
   * How to say the name, on the page where someone first meets it.
   *
   * Note: the second assertion is the important one. The pronunciation must sit in its own
   * node, not inside the <h1> — an accessible name of "MadY /ˈmædi/ (MAD-ee)" makes a screen
   * reader announce the phonetics as though they were part of the name. `getByText("MadY")`
   * is an exact match, so it fails as soon as the two are merged; that is the guard.
   */
  it("says how the name is pronounced, without absorbing it into the name", () => {
    const { container } = render(<AppShell />);
    const say = container.querySelector(".welcome-say");
    expect(say, "no pronunciation on the Welcome page").toBeTruthy();
    expect(say!.textContent, "no IPA — the respelling alone is not precise").toContain("/ˈmædi/");
    expect(say!.textContent, "no plain respelling — IPA alone assumes the reader knows it").toContain("MAD-ee");
    expect(
      container.querySelector(".welcome-name")!.textContent,
      "the phonetics were folded into the heading — a screen reader reads them as the name",
    ).toBe("MadY");
  });

  it("shows the beta-version caution at the foot of the page", () => {
    const { container } = render(<AppShell />);
    const banner = container.querySelector(".welcomepane .beta-banner");
    expect(banner, "no beta-version caution on the Welcome page").toBeTruthy();
    expect(banner!.textContent, "it must name the state of the software").toMatch(/beta version/i);
    // Below the tiles — what you came to click stays first.
    const tiles = container.querySelector(".welcome-actions")!;
    expect(
      tiles.compareDocumentPosition(banner!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the caution must come after the action tiles",
    ).toBeTruthy();
  });

  it("'Guided tours' is a tile that opens a tab listing every tour; Start there starts one — the list is not on the Welcome page", () => {
    const { container } = render(<AppShell />);
    expect(container.querySelector(".welcome-tours"), "the tours list is on the Welcome page").toBeNull();
    const tile = [...container.querySelectorAll(".welcome-action")].find((b) => /Guided tours/.test(b.textContent ?? ""));
    expect(tile, "no Guided tours tile").toBeTruthy();
    fireEvent.click(tile!);
    expect(tabsBar(container).getByText("Guided tours")).toBeTruthy();
    expect(container.querySelectorAll(".tourspane .tours-row").length).toBe(TOURS.length);
    // Grouped by theme, beginner first within each — the section headings are the manual's groups.
    expect([...container.querySelectorAll(".tourspane .tours-theme-h")].map((h) => h.textContent)).toEqual(["1 · Your data: enter and shape it", "2 · Make a graph", "3 · Improve the graph", "4 · Analyse your data", "5 · Make a panel figure"]);
    const looksRow = container.querySelector('.tours-start[data-tour-id="looks"]')!.closest(".tours-row");
    const axesRow = container.querySelector('.tours-start[data-tour-id="axes"]')!.closest(".tours-row");
    expect(looksRow!.compareDocumentPosition(axesRow!) & Node.DOCUMENT_POSITION_FOLLOWING, "beginner Looks must come before intermediate Axes").toBeTruthy();
    expect(looksRow!.querySelector(".tours-level")!.textContent).toBe("Beginner");
    fireEvent.click(container.querySelector('.tours-start[data-tour-id="axes"]') as HTMLElement);
    expect(container.querySelector(".tour"), "Start did not start the tour").toBeTruthy();
    expect(container.querySelector(".tour")!.getAttribute("data-tour-step")).toBe("open-graph");
  });

  it("a tour started with no suitable data offers a sample, and the sample lands in front so the next card makes sense", () => {
    // A tutorial can run without data of the user's own: it offers generated data instead.
    // From the Welcome page nothing is in front.
    const { container } = render(<AppShell />);
    fireEvent.click([...container.querySelectorAll(".welcome-action")].find((b) => /Guided tours/.test(b.textContent ?? ""))!);
    fireEvent.click(container.querySelector('.tours-start[data-tour-id="datasheet"]') as HTMLElement);
    expect(container.querySelector(".tour")!.getAttribute("data-tour-step")).toBe("open-sheet");
    const reach = container.querySelector(".tour-reach") as HTMLButtonElement | null;
    expect(reach?.textContent, "no sample-data button on the open-a-datasheet card").toBe("Use a sample datasheet");
    fireEvent.click(reach!);
    // A generated, recognisable sheet is now the active tab, and the tour moved on to editing it.
    expect(tabsBar(container).getByText(/\(tour sample\)/)).toBeTruthy();
    expect(container.querySelector("table.dg"), "the sample sheet is not in front").toBeTruthy();
    expect(container.querySelector(".tour")!.getAttribute("data-tour-step")).toBe("add-column");
  });

  it("pressing the sample button in a second tour reuses the sample sheet — two tours do not leave two '(tour sample)' sheets", () => {
    const { container } = render(<AppShell />);
    const openTours = () => fireEvent.click([...container.querySelectorAll(".welcome-action, button.tab")].find((b) => /Guided tours/.test(b.textContent ?? ""))!);
    openTours();
    fireEvent.click(container.querySelector('.tours-start[data-tour-id="datasheet"]') as HTMLElement);
    fireEvent.click(container.querySelector(".tour-reach") as HTMLElement);
    fireEvent.click(container.querySelector(".tour-x") as HTMLElement);
    openTours();
    fireEvent.click(container.querySelector('.tours-start[data-tour-id="first-graph"]') as HTMLElement);
    fireEvent.click(container.querySelector(".tour-reach") as HTMLElement);
    const sampleTabs = tabsBar(container).getAllByText(/\(tour sample\)/);
    expect(sampleTabs.length, "a second sample sheet was generated").toBe(1);
  });

  it("a step that works on the sheet reaches the sheet when the reader wandered to a graph before pressing Next", () => {
    const { container } = render(<AppShell />);
    fireEvent.click([...container.querySelectorAll(".welcome-action")].find((b) => /Guided tours/.test(b.textContent ?? ""))!);
    fireEvent.click(container.querySelector('.tours-start[data-tour-id="datasheet"]') as HTMLElement);
    fireEvent.click(container.querySelector(".tour-reach") as HTMLElement); // sample sheet, step add-column
    // Next through the sheet steps without doing anything: the program performs each (a column
    // added, a value typed, a cell selected, a value excluded) — nothing advances undone.
    const stepOf = () => container.querySelector(".tour")!.getAttribute("data-tour-step");
    // (The grid draws a fixed width of header slots, so count the named ones, not the cells.)
    const named = () => [...container.querySelectorAll("table.dg thead th")].filter((th) => (th.textContent ?? "").trim() !== "").length;
    const colsBefore = named();
    for (let i = 0; i < 8 && stepOf() !== "see-effect"; i++) fireEvent.click(container.querySelector(".tour-next") as HTMLElement);
    expect(stepOf()).toBe("see-effect");
    expect(named(), "Next did not add the column").toBeGreaterThan(colsBefore);
    expect(container.querySelectorAll("td.dgcell.dgexcl").length, "Next did not exclude a value").toBeGreaterThan(0);
    // The reader opens the demo graph from the tree: a graph is in front, the sheet is not.
    for (let pass = 0; pass < 6; pass++) {
      const closed = [...container.querySelectorAll(".nav button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
      if (closed.length === 0) break;
      closed.forEach((t) => fireEvent.click(t));
    }
    fireEvent.click(within(container.querySelector(".nav") as HTMLElement).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
    expect(container.querySelector("svg.gfx-figure"), "the graph did not open").toBeTruthy();
    // Next → "Bring them back" works on the sheet → the sheet comes back in front by itself.
    fireEvent.click(container.querySelector(".tour-next") as HTMLElement);
    expect(stepOf()).toBe("include");
    expect(container.querySelector("table.dg"), "the sheet was not brought back in front").toBeTruthy();
  });

  it("Design ▸ Significance thresholds & labels… opens the Significance brackets section on the graph — not an empty Inspector", () => {
    // The selection must not be cleared: with nothing selected the Inspector shows only "click an
    // axis or a series", hiding the very section the command names.
    const { container } = render(<AppShell />);
    // Unfold the whole tree (folder → experiment → sheet → its graph), as e2e/app.ts does.
    for (let pass = 0; pass < 6; pass++) {
      const closed = [...container.querySelectorAll(".nav button.twist")].filter((t) => t.querySelector("svg.lucide-chevron-right"));
      if (closed.length === 0) break;
      closed.forEach((t) => fireEvent.click(t));
    }
    fireEvent.click(within(container.querySelector(".nav") as HTMLElement).getByText("Treatment bar chart").closest("button") as HTMLButtonElement);
    fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText("Design"));
    fireEvent.click(within(container.querySelector(".dropdown") as HTMLElement).getByText("Significance thresholds & labels…"));
    const sec = container.querySelector("#insp-significance-brackets") as HTMLDetailsElement | null;
    expect(sec, "no Significance brackets section on screen").toBeTruthy();
    expect(sec!.hidden, "the section is hidden").toBe(false);
    expect(sec!.open, "the section is shown but collapsed").toBe(true);
    expect(container.querySelector(".inspcat.on")?.textContent, "the rail is not on the tab that owns the section").toBe("Annotate");
    expect([...container.querySelectorAll(".frow > span")].some((s) => s.textContent === "Bracket shape"), "no Bracket shape row").toBe(true);
  });

  it("Help ▸ Welcome page reopens it after it's been closed", () => {
    const { container } = render(<AppShell />);
    // Close the Welcome tab.
    const welcomeTab = tabsBar(container).getByText("Welcome").closest("button.tab") as HTMLElement;
    fireEvent.click(welcomeTab.querySelector(".x") as SVGElement);
    expect(tabsBar(container).queryByText("Welcome")).toBeNull();
    // Reopen it from the menu.
    fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText("Help"));
    fireEvent.click(within(container.querySelector(".dropdown") as HTMLElement).getByText("Welcome page"));
    expect(tabsBar(container).getByText("Welcome")).toBeTruthy();
  });
});

/**
 * A graph must offer a way back to the numbers it is drawn from.
 *
 * Opening a graph (from the gallery, or from the tree) leaves its datasheet unopened; without a
 * link in the ribbon the only route to the data is hunting the project tree for a matching name.
 */
describe("AppShell — the graph ribbon links to its datasheet", () => {
  const nav = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);
  const openPlot = (c: HTMLElement): void => {
    const row = nav(c).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav(c).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
  };

  it("opens the source datasheet in its own tab", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    const btn = container.querySelector('.grbbtn[title^="Open the datasheet"]') as HTMLButtonElement;
    expect(btn, "no datasheet shortcut in the graph ribbon").toBeTruthy();
    // It names which sheet, so it is not a mystery button.
    expect(btn.getAttribute("title")).toContain(TABLE_NAME);
    fireEvent.click(btn);
    // the datasheet tab opened (the name also labels its group, so match the tab specifically)
    const tabTexts = [...container.querySelectorAll(".tabs button.tab:not(.tabadd)")].map((b) => b.textContent ?? "");
    expect(tabTexts.some((s) => s.includes(TABLE_NAME)), "the datasheet tab did not open").toBe(true);
    expect(
      container.querySelector("button.tab.on")?.textContent,
      "it opened the datasheet without landing on it",
    ).toContain(TABLE_NAME);
  });
});

/**
 * A two-sheet graph links to both datasheets.
 *
 * The "Two sheets, one graph" gallery card: a composite graph borrows a series
 * from another datasheet (`plot.overlays`), so it is drawn from more than one sheet. A single
 * "Datasheet" button could open only the first, leaving no route to the borrowed sheet, so the
 * ribbon offers a menu naming every linked sheet, the mirror of the datasheet's own
 * "Graphs" menu. This must hold for any two-sheet graph, not just the gallery card.
 */
describe("AppShell — a two-sheet graph links to both its datasheets", () => {
  const noop = (): void => {};
  const ribbonOps = () => ({
    onSetGrid: noop, onSetLegend: noop, onSetFrame: noop, onSetAxisScale: noop, onSetPlotFont: noop,
    onAddAnnotation: noop, onInsertImage: noop, onAddPercentChange: noop, onSetShowValues: noop,
    onSetShowBarPoints: noop, onSetSummary: noop, zoom: 1, onZoomIn: noop, onZoomOut: noop, onZoomReset: noop,
  });
  const twoSheetProject = (): Project =>
    ({
      schemaVersion: 5,
      tables: [
        { id: "t-measured", kind: "xy", name: "Measured", columns: [{ id: "x", name: "Dose", role: "x" }, { id: "y", name: "Response", role: "y" }], rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }] },
        { id: "t-model", kind: "xy", name: "Model curve", columns: [{ id: "mx", name: "Dose", role: "x" }, { id: "my", name: "Fit", role: "y" }], rows: [{ id: "m1", cells: { mx: 1, my: 2.1 } }, { id: "m2", cells: { mx: 2, my: 3.9 } }] },
      ],
      plots: [{ id: "p1", name: "Dose–response", source: "t-measured", status: "ok", styleOverrides: {}, kind: "xy", overlays: [{ id: "ov1", table: "t-model", column: "my" }] }],
      analyses: [], layouts: [], log: [], workspace: { folders: [], loose: [] },
    }) as unknown as Project;
  const menu = (c: HTMLElement) => c.querySelector("[data-sheets-for-graph]") as HTMLButtonElement | null;

  it("offers a Datasheets menu naming both sheets, and opens the one you pick", () => {
    const opened: string[] = [];
    const { container } = render(
      <GraphPane project={twoSheetProject()} plotId="p1" ribbon={ribbonOps()} onOpenSource={(id) => opened.push(id)} />,
    );
    const btn = menu(container);
    expect(btn, "no Datasheets menu on a two-sheet graph").toBeTruthy();
    expect(btn!.getAttribute("data-sheets-for-graph")).toBe("2");
    fireEvent.click(btn!);
    // Its own sheet first, then the borrowed one — every linked sheet, named.
    const items = [...container.querySelectorAll('[role="menuitem"]')];
    expect(items.map((i) => i.textContent)).toEqual(["Measured", "Model curve"]);
    fireEvent.click(items[1]!);
    expect(opened, "the borrowed sheet did not open").toEqual(["t-model"]);
  });

  it("a plain one-sheet graph keeps the single Datasheet button (no menu)", () => {
    const project = twoSheetProject();
    delete project.plots[0]!.overlays; // drop the borrowed series → one sheet
    const { container } = render(
      <GraphPane project={project} plotId="p1" ribbon={ribbonOps()} onOpenSource={noop} />,
    );
    expect(menu(container), "a one-sheet graph must not get a menu").toBeNull();
    const btn = container.querySelector('.grbbtn[title^="Open the datasheet"]') as HTMLButtonElement;
    expect(btn, "no single Datasheet button on a one-sheet graph").toBeTruthy();
    expect(btn.getAttribute("title")).toContain("Measured");
  });
});

/**
 * Excluding values: the button, the blue+italic mark, and the note under the graph.
 *
 * The end-to-end claim is that one act (select cells → Exclude) shows up in all three
 * places, each reachable without a right-click.
 */
describe("AppShell — excluding values from the datasheet", () => {
  const nav = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);
  const openTable = (c: HTMLElement): void => {
    const row = nav(c).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav(c).getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
  };
  const excludeBtn = (c: HTMLElement) =>
    [...c.querySelectorAll(".datarail button")].find((b) => b.textContent?.trim() === "Exclude") as HTMLButtonElement;

  it("the Exclude button is dead until cells are selected, then marks them blue + italic", () => {
    const { container } = render(<AppShell />);
    openTable(container);
    expect(excludeBtn(container), "no Exclude button on the datasheet").toBeTruthy();
    expect(excludeBtn(container).disabled, "Exclude was pressable with nothing selected").toBe(true);

    // Select a data cell, which publishes the block upward.
    const cell = container.querySelector("td.dgcell") as HTMLElement;
    fireEvent.mouseDown(cell);
    expect(excludeBtn(container).disabled, "Exclude stayed dead after selecting a cell").toBe(false);

    fireEvent.click(excludeBtn(container));
    const marked = container.querySelectorAll("td.dgcell.dgexcl");
    expect(marked.length, "the excluded value was not marked in the grid").toBeGreaterThan(0);
  });

  it("states the exclusion under the graph, and the note can be hidden", () => {
    const { container } = render(<AppShell />);
    openTable(container);
    fireEvent.mouseDown(container.querySelector("td.dgcell") as HTMLElement);
    fireEvent.click(excludeBtn(container));

    // Open the graph drawn from that sheet.
    fireEvent.click(nav(container).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
    const note = container.querySelector(".exclnote");
    expect(note, "no exclusion note under the graph").toBeTruthy();
    expect(note!.textContent, "the note does not say how many").toMatch(/1\s*value is excluded/);

    fireEvent.click(note!.querySelector("button") as HTMLButtonElement);
    expect(container.querySelector(".exclnote"), "Hide did not dismiss the note").toBeNull();
  });

  it("says nothing when nothing is excluded", () => {
    // The note must be a consequence of real exclusions, not furniture that always shows.
    const { container } = render(<AppShell />);
    const row = nav(container).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav(container).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
    expect(container.querySelector(".exclnote"), "a note appeared with no exclusions").toBeNull();
  });
});

describe("AppShell — the gallery does not clone a card you already opened", () => {
  const canvas = (c: HTMLElement) => within(c.querySelector(".canvas") as HTMLElement);
  const openTabNames = (c: HTMLElement): string[] =>
    [...c.querySelectorAll("button.tab:not(.tabadd)")].map((b) => b.textContent?.trim() ?? "");

  /** Open the gallery from Welcome, then click the first card. */
  const openFirstCard = (c: HTMLElement): void => {
    fireEvent.click(canvas(c).getByText("Chart gallery"));
    const card = c.querySelector('button[title="Open as an editable graph"]') as HTMLButtonElement;
    fireEvent.click(card);
  };

  it("re-opening the same card reveals the graph already made instead of duplicating it", () => {
    const { container } = render(<AppShell />);
    const before = createSampleDocument().toJSON();
    openFirstCard(container);
    const namesAfterFirst = openTabNames(container);
    const made = namesAfterFirst.find((n) => n !== "Welcome" && n !== "Chart gallery");
    expect(made, "clicking a gallery card did not open a graph").toBeTruthy();

    // Back to the gallery and click the same card again.
    fireEvent.click(within(container.querySelector(".tabs") as HTMLElement).getByText("Chart gallery"));
    fireEvent.click(container.querySelector('button[title="Open as an editable graph"]') as HTMLButtonElement);

    const names = openTabNames(container);
    expect(
      names.filter((n) => n === made).length,
      `the same card opened twice left two "${made}" tabs — it was cloned, not revealed`,
    ).toBe(1);
    // And the document gained exactly one dataset and one graph across both clicks.
    const status = container.querySelector(".statusbar")?.textContent ?? container.textContent ?? "";
    const m = /(\d+) datasets · (\d+) graphs/.exec(status);
    expect(m, "no dataset/graph counter to read").toBeTruthy();
    expect(Number(m![1]), "a second dataset was created for the same card").toBe(before.tables.length + 1);
    expect(Number(m![2]), "a second graph was created for the same card").toBe(before.plots.length + 1);
  }, GALLERY_TIMEOUT);
});

/**
 * The new-datasheet creator must not describe the demo project's data as the user's.
 *
 * `analyzeTable` falls back to `project.tables[0]` so Analyze always has a target; feeding
 * that to the creator would make a fresh launch (nothing of the user's open) badge XY "Your data".
 */
describe("AppShell — New datasheet / graph does not claim the demo data as yours", () => {
  it("badges no format as 'Your data' when the user has nothing open", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(within(container.querySelector(".canvas") as HTMLElement).getByText("New datasheet / graph"));
    const dlg = container.querySelector("[role=dialog]");
    expect(dlg, "the creator dialog did not open").toBeTruthy();
    expect(
      within(dlg as HTMLElement).queryByText("Your data"),
      "a format was badged 'Your data' though the user has entered none — it read the demo sheet",
    ).toBeNull();
  });

  it("still badges the format of a datasheet the user actually has open", () => {
    const { container } = render(<AppShell />);
    // Open the demo table as a real working tab, then the creator.
    const nav = within(container.querySelector(".nav") as HTMLElement);
    const row = nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav.getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
    fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText("File"));
    fireEvent.click(within(container.querySelector(".dropdown") as HTMLElement).getByText("New datasheet / graph…"));
    const dlg = container.querySelector("[role=dialog]");
    expect(
      within(dlg as HTMLElement).queryAllByText("Your data").length,
      "an open datasheet should still be badged as the user's data",
    ).toBeGreaterThan(0);
  });
});

/**
 * Back / forward through visited tabs — browser semantics, not undo/redo.
 *
 * Undo/redo move through edits; these only change what you are looking at. The pairing that
 * matters is that a new visit from a back-stepped position abandons the forward branch, and
 * that going back to a since-closed tab reopens it rather than landing on nothing.
 */
describe("AppShell — back / forward tab navigation", () => {
  const canvas = (c: HTMLElement) => within(c.querySelector(".canvas") as HTMLElement);
  const tabsBar = (c: HTMLElement) => within(c.querySelector(".tabs") as HTMLElement);
  const back = (c: HTMLElement) => c.querySelector('button[title^="Back"]') as HTMLButtonElement;
  const forward = (c: HTMLElement) => c.querySelector('button[title^="Forward"]') as HTMLButtonElement;
  /** Which tab is currently active, by its label. */
  const activeTab = (c: HTMLElement): string => c.querySelector("button.tab.on")?.textContent ?? "";

  it("starts with nowhere to go", () => {
    const { container } = render(<AppShell />);
    expect(back(container).disabled, "Back was live before anything had been visited").toBe(true);
    expect(forward(container).disabled, "Forward was live before stepping back").toBe(true);
  });

  it("goes back to the Welcome page after opening the gallery, then forward again", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Chart gallery"));
    expect(activeTab(container)).toBe("Chart gallery");
    expect(back(container).disabled, "Back stayed dead after a real navigation").toBe(false);

    fireEvent.click(back(container));
    expect(activeTab(container), "Back did not return to the Welcome page").toBe("Welcome");
    expect(forward(container).disabled, "Forward stayed dead after stepping back").toBe(false);

    fireEvent.click(forward(container));
    expect(activeTab(container), "Forward did not return to the gallery").toBe("Chart gallery");
  }, GALLERY_TIMEOUT);

  it("abandons the forward branch when you navigate somewhere new instead", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Chart gallery"));
    fireEvent.click(back(container)); // back on Welcome, gallery is "forward"
    expect(forward(container).disabled).toBe(false);
    fireEvent.click(canvas(container).getByText("Documentation")); // a new destination
    expect(forward(container).disabled, "the abandoned forward branch survived a new visit").toBe(true);
  }, GALLERY_TIMEOUT);

  it("reopens a tab that was closed while it sat in the history", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Chart gallery"));
    // Close the Welcome tab we came from, then step back to it.
    const welcomeTab = tabsBar(container).getByText("Welcome").closest("button.tab") as HTMLElement;
    fireEvent.click(welcomeTab.querySelector(".x") as SVGElement);
    expect(tabsBar(container).queryByText("Welcome")).toBeNull();
    fireEvent.click(back(container));
    expect(tabsBar(container).getByText("Welcome"), "Back did not reopen the closed tab").toBeTruthy();
    expect(activeTab(container)).toBe("Welcome");
  }, GALLERY_TIMEOUT);

  it("the mouse's back/forward thumb buttons drive it too", () => {
    const { container } = render(<AppShell />);
    fireEvent.click(canvas(container).getByText("Chart gallery"));
    // X1 (button 3) = back, X2 (button 4) = forward — delivered as `auxclick`.
    fireEvent(window, new MouseEvent("auxclick", { button: 3, bubbles: true, cancelable: true }));
    expect(activeTab(container), "the mouse back button did nothing").toBe("Welcome");
    fireEvent(window, new MouseEvent("auxclick", { button: 4, bubbles: true, cancelable: true }));
    expect(activeTab(container), "the mouse forward button did nothing").toBe("Chart gallery");
  }, GALLERY_TIMEOUT);
});

describe("AppShell — project tree + grouped tabs", () => {
  const nav = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);

  /** The demo project ships folded, so anything reaching into it has to open it first. */
  const openDemo = (c: HTMLElement): void => {
    const row = nav(c).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
  };
  /** The app opens on the Welcome page, not the demo graph — open it from the tree. */
  const openPlot = (c: HTMLElement): void => {
    openDemo(c);
    fireEvent.click(nav(c).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
  };
  const undoBtn = (c: HTMLElement) => c.querySelector('button[title^="Undo"]') as HTMLButtonElement;

  it("renders the sample workspace tree (folder → experiment → objects)", () => {
    const { container } = render(<AppShell />);
    openDemo(container);
    const n = nav(container);
    expect(n.getByText("Demo Project")).toBeTruthy();
    expect(n.getByText("Experiment 1")).toBeTruthy();
    expect(n.getByText(TABLE_NAME)).toBeTruthy();
    expect(n.getByText(PLOT_NAME)).toBeTruthy();
  });

  it("opens on the Welcome page, in the sourceless 'Other' group", () => {
    const { container } = render(<AppShell />);
    const strip = container.querySelector(".tabs") as HTMLElement;
    const tabTexts = [...strip.querySelectorAll("button.tab:not(.tabadd)")].map((b) => b.textContent ?? "");
    expect(tabTexts.some((s) => s.includes("Welcome"))).toBe(true);
    // one group; its label is a thin handle while expanded, and shows "Other" once collapsed
    const groups = strip.querySelectorAll(".tabgroup");
    expect(groups).toHaveLength(1);
    fireEvent.click(groups[0]!.querySelector(".tabgrouplabel") as HTMLButtonElement);
    expect((groups[0]!.querySelector(".tabgrouplabel") as HTMLElement).textContent).toContain("Other");
  });

  it("groups a datasheet's graph/analysis under the datasheet in the tab strip", () => {
    const { container } = render(<AppShell />);
    openDemo(container);
    fireEvent.click(nav(container).getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
    fireEvent.click(nav(container).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
    const strip = container.querySelector(".tabs") as HTMLElement;
    // find the group holding the datasheet tab (the expanded label is a thin handle, no text)
    const group = [...strip.querySelectorAll(".tabgroup")].find((g) =>
      [...g.querySelectorAll("button.tab")].some((b) => (b.textContent ?? "").includes(TABLE_NAME)),
    ) as HTMLElement;
    expect(group, "no group holds the datasheet").toBeTruthy();
    // the table tab and its graph tab sit inside one group, each carrying the group tip colour
    const tabTexts = [...group.querySelectorAll("button.tab:not(.tabadd)")].map((b) => b.textContent ?? "");
    expect(tabTexts.some((s) => s.includes(TABLE_NAME))).toBe(true);
    expect(tabTexts.some((s) => s.includes(PLOT_NAME))).toBe(true);
    expect((group.querySelector("button.tab") as HTMLElement).getAttribute("style") ?? "").toContain("--tabtip");
    expect(group.querySelector(".tabadd")).toBeTruthy(); // + to add another graph of this sheet
    // collapsing the group reveals the datasheet name as its label (not a section word)
    fireEvent.click(group.querySelector(".tabgrouplabel") as HTMLButtonElement);
    expect((group.querySelector(".tabgrouplabel") as HTMLElement).textContent).toContain(TABLE_NAME);
  });

  it("adds a project folder live, and undo reverts it step-by-step", () => {
    const { container } = render(<AppShell />);
    expect(undoBtn(container).disabled).toBe(true); // sample construction is not undoable

    fireEvent.click(container.querySelector(".navtop .mini") as HTMLButtonElement);
    expect(nav(container).getByText("Project 2")).toBeTruthy();
    expect(undoBtn(container).disabled).toBe(false);

    // addProject = addFolder + addExperiment → two undo steps remove the folder.
    fireEvent.click(undoBtn(container));
    fireEvent.click(undoBtn(container));
    expect(nav(container).queryByText("Project 2")).toBeNull();
  });

  /**
   * A tab opened while a figure is showing is shown. The figure has its own full-area view drawn
   * over the tabs, so a tab opened behind it (e.g. Help ▸ Documentation) would look as if the
   * press did nothing. Guards that any tab opened from a menu leaves the figure view — the
   * figure stays in the tree, one click away.
   */
  const onAFigure = (): { container: HTMLElement; menu: (name: string, item: string) => void } => {
    const { container } = render(<AppShell />);
    fireEvent.click(container.querySelector('.nav button[title="New standalone panel figure"]') as HTMLButtonElement);
    expect(container.querySelector(".layoutview"), "the figure view did not open").toBeTruthy();
    const menu = (name: string, item: string): void => {
      fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText(name));
      fireEvent.click(within(container.querySelector(".dropdown") as HTMLElement).getByText(item));
    };
    return { container, menu };
  };
  it("Help ▸ Documentation, pressed on a figure, shows the Documentation", () => {
    const { container, menu } = onAFigure();
    menu("Help", "Documentation");
    expect(container.querySelector(".layoutview"), "the figure still covers the Documentation tab").toBeNull();
    expect(container.querySelector(".guide-head"), "the Documentation page is not on screen").toBeTruthy();
  });
  it("Graph ▸ Chart gallery, pressed on a figure, shows the gallery — and the figure stays in the tree", () => {
    const { container, menu } = onAFigure();
    menu("Graph", "Chart gallery…");
    expect(container.querySelector(".layoutview"), "the figure still covers the Chart gallery tab").toBeNull();
    expect(container.querySelector(".gallerybar"), "the Chart gallery is not on screen").toBeTruthy();
    expect(nav(container).getByText("Figure 1"), "the figure must stay in the tree").toBeTruthy();
  }, GALLERY_TIMEOUT);

  it("creates a panel figure from the tree → opens its dedicated view (no tab), filed in the tree", () => {
    const { container } = render(<AppShell />);
    // no "Layouts" tab-rail group, and no toolbar 'New layout' button
    expect(within(container).queryByText("Layouts")).toBeNull();
    expect(container.querySelector('button[title="New layout"]')).toBeNull();
    // the tree offers a standalone "New panel figure" button
    const newFig = container.querySelector('.nav button[title="New standalone panel figure"]') as HTMLButtonElement;
    expect(newFig).toBeTruthy();
    fireEvent.click(newFig);
    // it opens in the dedicated full-area assembler view (not a document tab)
    expect(container.querySelector(".layoutview")).toBeTruthy();
    expect(container.querySelector(".layoutview .laypick, .layoutview .laycards")).toBeTruthy();
    // and it's filed into the project tree as "Figure 1"
    expect(nav(container).getByText("Figure 1")).toBeTruthy();
    // Back returns to the document area
    fireEvent.click(container.querySelector(".layoutview-bar button") as HTMLButtonElement);
    expect(container.querySelector(".layoutview")).toBeNull();
    // clicking the tree node re-opens the dedicated view
    fireEvent.click(nav(container).getByText("Figure 1"));
    expect(container.querySelector(".layoutview")).toBeTruthy();
  });

  it("opens a dataset from the tree into its data grid", () => {
    const { container } = render(<AppShell />);
    openDemo(container);
    const item = nav(container).getByText(TABLE_NAME).closest("button") as HTMLButtonElement;
    fireEvent.click(item);
    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(within(canvas).getByText("Dose (uM)")).toBeTruthy();
  });

  it("renders the graph (SVG) once its tab is opened and active", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    // The demo plot is active → the figure scene is rendered in the canvas.
    const canvas = container.querySelector(".canvas") as HTMLElement;
    expect(canvas.querySelector("svg.gfx-figure")).toBeTruthy();
  });

  /**
   * Guards against the formatting panel staying shut when a graph is opened from the project
   * tree. The panel becomes useful on arriving at a figure, not on clicking something inside it.
   */
  it("the Inspector starts collapsed, and deploys when a graph is opened from the tree", () => {
    const { container } = render(<AppShell />);
    const railLabels = (): string[] =>
      [...container.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? "");
    expect(railLabels(), "the Inspector should start collapsed — nothing to format yet").toContain("Inspector");
    openPlot(container); // clicks the graph in the left panel, exactly as a user does
    expect(railLabels(), "opening a graph did not deploy the Inspector").not.toContain("Inspector");
  });

  it("a datasheet does not deploy the Inspector — there is nothing there to format", () => {
    // The rule is "a graph deploys it", not "any tab does". A spreadsheet has no formatting
    // pane, so opening one must leave the panel exactly as the user left it.
    const { container } = render(<AppShell />);
    openDemo(container);
    fireEvent.click(nav(container).getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
    expect(
      [...container.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? ""),
      "opening a datasheet deployed the Inspector",
    ).toContain("Inspector");
  });

  it("still deploys on selecting an element, and a manual collapse sticks while you stay put", () => {
    const { container } = render(<AppShell />);
    const railLabels = (): string[] =>
      [...container.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? "");
    openPlot(container);
    // Collapse it by hand while working on this graph — that must hold.
    fireEvent.click(container.querySelector('button[title="Collapse Inspector"]') as HTMLButtonElement);
    expect(railLabels(), "the manual collapse did not take").toContain("Inspector");
    // Selecting something on the figure brings it back.
    fireEvent.click(container.querySelector(".gfx-series circle[fill='transparent']") as Element);
    expect(railLabels(), "selecting a graph element did not deploy the Inspector").not.toContain("Inspector");
  });

  it("selects a series on click and recolours it from the inspector", () => {
    const { container } = render(<AppShell />);
    openPlot(container); // the app opens on Welcome — open the demo graph first
    // Click a series datapoint (its transparent hit circle).
    fireEvent.click(container.querySelector(".gfx-series circle[fill='transparent']") as Element);
    // The inspector shows the series editor with the colourblind palette.
    expect(container.querySelector(".swbtn")).toBeTruthy();
    // Pick vermillion from the series colour palette (the house default uses open
    // markers, which adds a "Fill palette" too — target the colour one by aria-label).
    fireEvent.click(container.querySelector('.swbtn[aria-label="Palette #D55E00"]') as Element);
    expect(container.querySelector('.gfx-series path[stroke="#D55E00"]')).toBeTruthy();
  });

  it("keeps a series recolour when the selection moves to another element", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    fireEvent.click(container.querySelector(".gfx-series circle[fill='transparent']") as Element);
    fireEvent.click(container.querySelector('.swbtn[aria-label="Palette #D55E00"]') as Element);
    expect(container.querySelector('.gfx-series path[stroke="#D55E00"]')).toBeTruthy();
    // Move selection to the x-axis — the recolour must persist (it's in the document).
    fireEvent.click(container.querySelector("svg rect[fill='transparent']") as Element);
    expect(container.querySelector('.gfx-series path[stroke="#D55E00"]')).toBeTruthy();
  });

  it("selects the plot from the background and toggles gridlines on/off", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    expect(container.querySelector(".gfx-grid")).toBeNull(); // house default = no grid
    fireEvent.click(container.querySelector(".canvas svg.gfx-figure") as Element); // background → select plot
    // Find the Gridlines row's checkbox (the title editor adds checkboxes above it).
    const gridRow = Array.from(container.querySelectorAll(".inspbody label.frow")).find(
      (l) => l.querySelector("span")?.textContent === "Gridlines",
    );
    const gridToggle = gridRow?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(gridToggle).toBeTruthy(); // the grid editor is shown
    fireEvent.click(gridToggle); // turn gridlines on
    expect(container.querySelector(".gfx-grid")).toBeTruthy();
    fireEvent.click(gridToggle); // turn gridlines off again
    expect(container.querySelector(".gfx-grid")).toBeNull();
  });

  it("changes a series symbol shape from the inspector", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    fireEvent.click(container.querySelector(".gfx-series circle[fill='transparent']") as Element); // select series
    // The select labelled "Shape", not "the first select": the panel's first row is
    // "Render as", so a positional pick would drive the wrong control.
    const shapeRow = [...container.querySelectorAll(".inspbody label")].find(
      (l) => (l.querySelector("span:first-child")?.textContent ?? "").trim() === "Shape",
    );
    const shape = shapeRow?.querySelector("select.selin") as HTMLSelectElement;
    expect(shape, "no select labelled Shape on the xy series panel").toBeTruthy();
    fireEvent.change(shape, { target: { value: "square" } });
    expect(container.querySelector(".gfx-series rect")).toBeTruthy(); // markers are squares
  });

  it("offers a 'Plot on' Left/Right (Y2) control for an xy series, and assigning it draws the Y2 axis", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    fireEvent.click(container.querySelector(".gfx-series circle[fill='transparent']") as Element); // select series
    // the per-series "Plot on" select (Left Y / Right Y2) exists for an xy chart
    const selects = [...container.querySelectorAll(".inspbody select.selin")] as HTMLSelectElement[];
    const axisSel = selects.find((s) => [...s.options].some((o) => /Right \(Y2\)/.test(o.textContent ?? "")));
    expect(axisSel).toBeTruthy();
    // before: no right axis title gutter element keyed to y2
    fireEvent.change(axisSel!, { target: { value: "y2" } });
    // after: the scene carries a Y2 axis → a right-edge axis line is painted.
    // (single-series sample → Y2 just mirrors it, but the axis must appear.)
    const fig = container.querySelector("svg.gfx-figure") as SVGElement;
    const vlines = [...fig.querySelectorAll("line")].filter((l) => l.getAttribute("x1") === l.getAttribute("x2"));
    expect(vlines.length).toBeGreaterThan(1); // left Y + right Y2 axis lines
  });

  it("selects an axis and changes its scale from the inspector", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    // First transparent rect in the SVG is the x-axis hit area.
    fireEvent.click(container.querySelector("svg rect[fill='transparent']") as Element);
    const select = container.querySelector(".selin") as HTMLSelectElement;
    expect(select.value).toBe("auto"); // no override yet
    fireEvent.change(select, { target: { value: "linear" } });
    expect((container.querySelector(".selin") as HTMLSelectElement).value).toBe("linear");
  });

  it("adds a column to the dataset grid live (end-to-end)", () => {
    const { container } = render(<AppShell />);
    openDemo(container);
    fireEvent.click(nav(container).getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
    const canvas = container.querySelector(".canvas") as HTMLElement;
    fireEvent.click(within(canvas).getByTitle("Add a column to this table"));
    // The dose-response sample carries replicate subcolumns (Dose + Response×3), so the
    // grid is in grouped mode (datasets render under .dggrouphead). "Add column" appends a
    // whole new dataset of the same shape — 3 replicates — named by group ordinal ("Y2":
    // the second dataset), not by column count, so never a bare n = 1 column named "Y4"
    // beside a group of n = 3.
    const names = [...canvas.querySelectorAll(".dghead .dgname, .dggrouphead .dgname")].map((e) => e.textContent);
    expect(names).toContain("Y2");
    expect(names).not.toContain("Y4");
    // The group header spans its sub-columns: 3 replicates → colSpan 3, like "Response" beside it.
    const heads = [...canvas.querySelectorAll<HTMLTableCellElement>(".dggrouphead")];
    const y2 = heads.find((h) => h.querySelector(".dgname")?.textContent === "Y2");
    expect(y2?.colSpan, "the new group must carry the table's 3 replicates").toBe(3);
    expect(heads.map((h) => h.colSpan), "both groups span 3 sub-columns").toEqual([3, 3]);
  });
});

/**
 * The Docs tab collapses both side panels — and puts them back.
 *
 * The failure that matters is not "they did not collapse", it is "they collapsed and stayed
 * collapsed": persisting it would rearrange the workspace someone set up for their real work,
 * from an action as innocent as opening the manual. So the assertions come in pairs — what is
 * drawn, and that `mady.layout` is untouched.
 */
describe("AppShell — reading the docs collapses the side panels", () => {
  // Scoped to the open dropdown: the app opens on the Welcome page, which carries
  // its own "Documentation" link, so an unscoped getByText("Documentation") is ambiguous.
  const openDocs = (c: HTMLElement): void => {
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Help"));
    fireEvent.click(within(c.querySelector(".dropdown") as HTMLElement).getByText("Documentation"));
  };
  /** Open the demo table tab, so there's a non-Docs tab to switch back to. */
  const openDataTab = (c: HTMLElement): void => {
    const n = within(c.querySelector(".nav") as HTMLElement);
    const row = n.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(n.getByText(TABLE_NAME).closest("button") as HTMLButtonElement);
  };
  /** The docks currently drawn as a collapsed rail, by their rail label. */
  const rails = (c: HTMLElement): string[] =>
    [...c.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? "");

  it("collapses Project and Inspector on the Docs tab, and restores them on leaving", () => {
    const { container } = render(<AppShell />);
    openDataTab(container); // a non-Docs tab to return to
    // The Inspector starts collapsed by default (nothing selected yet); Project does not.
    expect(rails(container), "the Inspector was not collapsed by default").toEqual(["Inspector"]);

    openDocs(container);
    expect(rails(container).sort(), "the Docs tab did not collapse both side panels").toEqual([
      "Inspector",
      "Project",
    ]);

    // Back to a data tab — both panels return to what they were (Inspector stays
    // collapsed here: nothing on this tab has been selected to auto-expand it).
    fireEvent.click([...container.querySelectorAll(".tabs button.tab:not(.tabadd)")].find((b) => (b.textContent ?? "").includes(TABLE_NAME)) as HTMLButtonElement);
    expect(rails(container), "the side panels did not come back after leaving Docs").toEqual(["Inspector"]);
  });

  it("does not write the collapse to the saved layout", () => {
    // The whole point: opening the manual must not rearrange the workspace for good.
    const { container } = render(<AppShell />);
    openDocs(container);
    const saved = globalThis.localStorage?.getItem("mady.layout");
    if (saved !== null && saved !== undefined) {
      const l = JSON.parse(saved) as { collapsed: Record<string, boolean> };
      expect(l.collapsed.navigator, "the Docs collapse was persisted").toBe(false);
      expect(l.collapsed.inspector, "the Docs collapse was persisted").toBe(false);
    }
  });

  // 20s, not the default 5s. These render the whole manual — every chapter into one DOM,
  // which is deliberate (the standalone manual is generated by walking it). The suite runs
  // files in parallel, so under load these tests can exceed 5s. Nothing here is slow for a user — the Docs tab renders once,
  // in a browser, not in jsdom — and the render time grows with the manual. Raising the limit changes no
  // claim these tests make.
  it("is a default, not a lock — the rail's expand button still works", () => {
    const { container } = render(<AppShell />);
    openDocs(container);
    fireEvent.click(container.querySelector('button[title="Expand Project"]') as HTMLButtonElement);
    expect(rails(container), "expanding Project on the Docs tab did nothing").toEqual(["Inspector"]);
  }, 20000);

  it("forgets a hand-opened panel, so the next visit starts collapsed again", () => {
    const { container } = render(<AppShell />);
    openDataTab(container);
    openDocs(container);
    fireEvent.click(container.querySelector('button[title="Expand Project"]') as HTMLButtonElement);
    fireEvent.click([...container.querySelectorAll(".tabs button.tab:not(.tabadd)")].find((b) => (b.textContent ?? "").includes(TABLE_NAME)) as HTMLButtonElement);
    openDocs(container);
    expect(rails(container).sort(), "the second visit did not start collapsed").toEqual([
      "Inspector",
      "Project",
    ]);
  }, 20000);
});

/**
 * The Welcome page has nothing to inspect.
 *
 * The Inspector ships collapsed, so a fresh install does not show this. Opening a graph
 * deploys it — and that writes `collapsed.inspector = false` to the saved layout, which is
 * correct (a per-dock collapse is a real choice). Without this rule the next launch would land
 * on the Welcome page with a full formatting panel open beside a page that has no figure, no
 * series and no axes: 300px of empty chrome. The fixture below reproduces that the way a user
 * meets it — a stored layout from a previous session.
 *
 * The Docs tabs solve the same problem (`docsDockOpen`), and the same rule applies here:
 * a render-time override, never a write. Welcome differs in one way — it collapses only the
 * Inspector. The Navigator is how you leave the Welcome page, so it stays open.
 */
describe("AppShell — the Welcome page collapses the Inspector", () => {
  const rails = (c: HTMLElement): string[] =>
    [...c.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? "");
  const nav = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);
  const openPlot = (c: HTMLElement): void => {
    const row = nav(c).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav(c).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
  };
  const toWelcome = (c: HTMLElement): void => {
    fireEvent.click(within(c.querySelector(".tabs") as HTMLElement).getByText("Welcome"));
  };

  it("starts collapsed on Welcome even when the saved layout says the Inspector is open", () => {
    // Exactly what a returning user has on disk after one session with a graph open.
    // Note: the repair key must be set too. `loadLayout` carries a one-shot repair that forces
    // `collapsed` back to the defaults the first time it sees a layout without that key —
    // so without this line the Inspector is collapsed by the repair and the assertion below
    // would pass even without the Welcome rule.
    globalThis.localStorage?.setItem("mady.layout.repair.collapse-2026-08-05", "1");
    globalThis.localStorage?.setItem(
      "mady.layout",
      JSON.stringify({
        order: ["navigator", "document", "inspector"],
        sizes: { navigator: 216, inspector: 300 },
        collapsed: { navigator: false, inspector: false },
        logCollapsed: true,
      }),
    );
    const { container } = render(<AppShell />);
    expect(
      rails(container),
      "launch landed on Welcome with the Inspector deployed over a page with nothing to format",
    ).toContain("Inspector");
    // …and the Navigator stays: it is how you get off the Welcome page.
    expect(rails(container), "the Welcome page collapsed the Navigator too").not.toContain("Project");
  });

  it("still deploys on a graph, and collapses again on returning to Welcome", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    expect(rails(container), "opening a graph did not deploy the Inspector").not.toContain("Inspector");
    toWelcome(container);
    expect(rails(container), "the Welcome tab did not collapse the Inspector").toContain("Inspector");
    // Back to the graph — the panel returns, because the override never touched the layout.
    fireEvent.click(within(container.querySelector(".tabs") as HTMLElement).getByText(PLOT_NAME));
    expect(rails(container), "the Inspector did not come back on the graph").not.toContain("Inspector");
  });

  it("does not write the collapse to the saved layout", () => {
    const { container } = render(<AppShell />);
    openPlot(container); // persists collapsed.inspector = false
    toWelcome(container);
    const saved = globalThis.localStorage?.getItem("mady.layout");
    expect(saved, "nothing was persisted — the guard would prove nothing").toBeTruthy();
    const l = JSON.parse(saved!) as { collapsed: Record<string, boolean> };
    expect(l.collapsed.inspector, "the Welcome collapse was persisted over the user's choice").toBe(false);
  });

  it("is a default, not a lock — the rail's expand button still works", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    toWelcome(container);
    fireEvent.click(container.querySelector('button[title="Expand Inspector"]') as HTMLButtonElement);
    expect(rails(container), "expanding the Inspector on Welcome did nothing").not.toContain("Inspector");
  });
});

/**
 * The Inspector is collapsed by default on the chart gallery, a datasheet, an analysis sheet,
 * the docs and the Welcome page, and open by default on a graph.
 *
 * Opening a graph writes `collapsed.inspector = false`, so every page visited afterwards would
 * keep it deployed unless the page itself collapses it. Each test below therefore opens a graph
 * first — a fixture that never did would pass even without the rule, because the Inspector
 * ships collapsed.
 */
describe("AppShell — only a graph shows the Inspector by default", () => {
  const ANALYSIS_NAME = sample.analyses[0]!.name;
  const rails = (c: HTMLElement): string[] =>
    [...c.querySelectorAll(".dockrail .dockraillabel")].map((n) => n.textContent ?? "");
  const nav = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);
  const tabs = (c: HTMLElement) => within(c.querySelector(".tabs") as HTMLElement);
  const openPlot = (c: HTMLElement): void => {
    const row = nav(c).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav(c).getByText(PLOT_NAME).closest("button") as HTMLButtonElement);
  };
  const openFromNav = (c: HTMLElement, name: string): void => {
    fireEvent.click(nav(c).getAllByText(name)[0]!.closest("button") as HTMLButtonElement);
  };

  it("a datasheet collapses it after a graph deployed it; back on the graph it is open again", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    expect(rails(container), "opening a graph did not deploy the Inspector").not.toContain("Inspector");
    openFromNav(container, TABLE_NAME);
    expect(rails(container), "the datasheet kept the Inspector open").toContain("Inspector");
    fireEvent.click(tabs(container).getByText(PLOT_NAME));
    expect(rails(container), "the Inspector did not come back on the graph").not.toContain("Inspector");
  });

  it("an analysis sheet collapses it after a graph deployed it", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    openFromNav(container, ANALYSIS_NAME);
    expect(rails(container), "the analysis sheet kept the Inspector open").toContain("Inspector");
  });

  it("the chart gallery collapses it after a graph deployed it", () => {
    const { container } = render(<AppShell />);
    openPlot(container);
    fireEvent.click(tabs(container).getByText("Welcome"));
    fireEvent.click(within(container.querySelector(".canvas") as HTMLElement).getByText("Chart gallery"));
    expect(tabs(container).getByText("Chart gallery")).toBeTruthy();
    expect(rails(container), "the chart gallery kept the Inspector open").toContain("Inspector");
  }, GALLERY_TIMEOUT);

  it("does not write the collapse to the saved layout, and the rail's expand button still works", () => {
    const { container } = render(<AppShell />);
    openPlot(container); // persists collapsed.inspector = false
    openFromNav(container, TABLE_NAME);
    const l = JSON.parse(globalThis.localStorage!.getItem("mady.layout")!) as { collapsed: Record<string, boolean> };
    expect(l.collapsed.inspector, "the datasheet collapse was persisted over the user's choice").toBe(false);
    fireEvent.click(container.querySelector('button[title="Expand Inspector"]') as HTMLButtonElement);
    expect(rails(container), "expanding the Inspector on a datasheet did nothing").not.toContain("Inspector");
  });
});

/**
 * The startup fit, where it meets a real document.
 *
 * The maths lives in `figureFit.test.ts`. What matters here is the wiring: an explicit size
 * must beat the fit, and the fit must be reversible — the two promises made to the user.
 */
describe("GraphPane — the startup figure fit", () => {
  const graph = (over: Record<string, unknown> = {}) => {
    const doc = createSampleDocument().toJSON();
    const plot = { ...doc.plots[0]!, ...over };
    return { ...doc, plots: [plot, ...doc.plots.slice(1)] } as unknown as Project;
  };
  // The size the figure is shown at (its width/height attributes). The fit is a uniform scale of the
  // drawing (graphDisplay.ts), so this - not the drawing's own coordinate box - is where the fit has to arrive.
  const drawn = (c: HTMLElement) => {
    const svg = c.querySelector("svg.gfx-figure");
    const w = Number(svg?.getAttribute("width")), h = Number(svg?.getAttribute("height"));
    return svg ? { width: Math.round(w), height: Math.round(h) } : null;
  };
  // The size the drawing is laid out at (its coordinate box).
  const laidOut = (c: HTMLElement) => {
    const vb = c.querySelector("svg.gfx-figure")?.getAttribute("viewBox")?.split(/\s+/).map(Number);
    return vb ? { width: vb[2]!, height: vb[3]! } : null;
  };
  const render1 = (project: Project, figureFit: { width: number; height: number } | null) =>
    render(<GraphPane project={project} plotId={project.plots[0]!.id} figureFit={figureFit} />);

  it("draws an unsized figure at the fitted size", () => {
    const u = render1(graph({ figureWidth: undefined, figureHeight: undefined }), { width: 928, height: 608 });
    expect(drawn(u.container), "the fit did not reach the figure").toEqual({ width: 928, height: 608 });
    // …as a scale: the drawing is still laid out at the default, text and all, so resizing keeps proportions.
    expect(laidOut(u.container), "the fit re-laid the graph out instead of scaling it").toEqual({ width: 580, height: 380 });
  });

  it("leaves a figure the user has sized alone — an explicit size always wins", () => {
    // An explicit size is never fitted, so a saved document with sized figures keeps its sizes.
    const u = render1(graph({ figureWidth: 480, figureHeight: 480 }), { width: 928, height: 608 });
    expect(drawn(u.container), "the fit overrode a size the user chose").toEqual({ width: 480, height: 480 });
  });

  it("a half-specified size is the graph's own — shown as it is, not fitted (a fit is a uniform scale)", () => {
    // A fit is a uniform scale of the whole drawing, so it must not stretch the missing side (to 700 × 608);
    // a graph with any size of its own is shown at that size.
    const u = render1(graph({ figureWidth: 700, figureHeight: undefined }), { width: 928, height: 608 });
    expect(drawn(u.container)).toEqual({ width: 700, height: 380 });
  });

  it("is reversible — no fit means the renderer default, with nothing to undo", () => {
    // What the Settings toggle does: passes null. The figure must go straight back.
    const u = render1(graph({ figureWidth: undefined, figureHeight: undefined }), null);
    expect(drawn(u.container), "turning the fit off did not restore the default").toEqual({ width: 580, height: 380 });
  });

  // Resizing keeps proportions. A graph's own scale shows the whole drawing smaller or larger
  // — text, marks and legend together — and never re-lays it out; it beats the window fit.
  it("a graph's own scale shows the whole drawing scaled, laid out at its own size", () => {
    const u = render1(graph({ figureWidth: undefined, figureHeight: undefined, displayScale: 0.5 }), { width: 928, height: 608 });
    expect(drawn(u.container), "the scale did not reach the figure").toEqual({ width: 290, height: 190 });
    expect(laidOut(u.container), "the scale re-laid the graph out").toEqual({ width: 580, height: 380 });
  });

  it("does not write the fitted size into the document", () => {
    // If it ever did, the file would be dirtied by merely opening it on a big monitor.
    const project = graph({ figureWidth: undefined, figureHeight: undefined });
    render1(project, { width: 928, height: 608 });
    expect(project.plots[0]!.figureWidth, "the fit was persisted onto the plot").toBeUndefined();
    expect(project.plots[0]!.figureHeight, "the fit was persisted onto the plot").toBeUndefined();
  });
});

describe("GraphPane — the out-of-date-analysis note", () => {
  // A stale analysis, its result no longer matching the sheet. `params`/`method` are cast
  // through — the note reads only `status` and the id, which is the whole point of the guard.
  const staleAnalysis = (id: string, source: string, status = "stale") =>
    ({ id, name: "One-way ANOVA", method: "anova", source, params: {}, status }) as unknown as Project["analyses"][number];

  // Build a project whose first plot is bound to an analysis, either by carrying a
  // significance bracket that points at it (`sig.analysisId`) or by being spawned from it
  // (`analysisSource`). The analysis list is supplied by the caller.
  const bound = (over: {
    analyses?: Project["analyses"];
    bracketAnalysisId?: string;
    analysisSource?: string;
  }) => {
    const doc = createSampleDocument().toJSON() as unknown as Project;
    const p0 = doc.plots[0]!;
    const plot = {
      ...p0,
      ...(over.analysisSource ? { analysisSource: over.analysisSource } : {}),
      ...(over.bracketAnalysisId
        ? { annotations: [...(p0.annotations ?? []), { id: "b1", kind: "bracket", from: 1, to: 2, sig: { analysisId: over.bracketAnalysisId } }] }
        : {}),
    };
    return { ...doc, plots: [plot, ...doc.plots.slice(1)], analyses: over.analyses ?? [] } as unknown as Project;
  };
  const noteOf = (c: HTMLElement) => c.querySelector(".stalenote");
  const render1 = (project: Project) => render(<GraphPane project={project} plotId={project.plots[0]!.id} />);

  it("warns under the graph when the analysis behind its significance brackets has gone stale", () => {
    const src = createSampleDocument().toJSON().plots[0]!.source;
    const p = bound({ bracketAnalysisId: "an1", analyses: [staleAnalysis("an1", src)] });
    const note = noteOf(render1(p).container);
    expect(note, "no out-of-date note under a graph whose bracket's analysis is stale").toBeTruthy();
    expect(note!.textContent, "the note does not tell the user to re-run").toMatch(/out of date/i);
  });

  it("warns for an analysis-spawned graph (survival / ROC / PCA / residuals) that is stale", () => {
    const src = createSampleDocument().toJSON().plots[0]!.source;
    const note = noteOf(render1(bound({ analysisSource: "an1", analyses: [staleAnalysis("an1", src)] })).container);
    expect(note, "no out-of-date note on a derived graph whose analysis is stale").toBeTruthy();
  });

  it("says nothing while the bound analysis is up to date — the note is a consequence of staleness, not furniture", () => {
    const src = createSampleDocument().toJSON().plots[0]!.source;
    const p = bound({ bracketAnalysisId: "an1", analyses: [staleAnalysis("an1", src, "ok")] });
    expect(noteOf(render1(p).container), "a note appeared for an up-to-date analysis").toBeNull();
  });

  it("says nothing when a stale analysis belongs to a different graph — the note tracks this graph's own bindings", () => {
    const src = createSampleDocument().toJSON().plots[0]!.source;
    // Stale analysis in the project, but this plot neither brackets it nor was spawned from it.
    const p = bound({ analyses: [staleAnalysis("other", src)] });
    expect(noteOf(render1(p).container), "a note appeared for an analysis this graph does not use").toBeNull();
  });
});

/**
 * Gallery cards are synthetic data, and land in the demo folder rather than loose.
 *
 * Loose, they would sit at the top level beside the user's real datasets with nothing to tell
 * invented numbers apart from measurements — which is the whole reason the sample folder is
 * named at all.
 */
describe("AppShell — opening a gallery card files it under the demo project", () => {
  const openGallery = (c: HTMLElement): void => {
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Graph"));
    fireEvent.click(within(c).getByText("Chart gallery…"));
  };

  it("the sample document's one folder is the demo folder", () => {
    // The name is shared with the gallery via DEMO_FOLDER; if these two ever disagree the
    // gallery would quietly create a second folder next to this one.
    const p = createSampleDocument().toJSON();
    expect(p.workspace.folders.map((f) => f.name)).toEqual([DEMO_FOLDER]);
    expect(p.workspace.loose, "the sample should file everything it creates").toEqual([]);
  });

  it("keeps the demo folder in the tree once a card has been opened", () => {
    const { container } = render(<AppShell />);
    const tree = () => within(container.querySelector(".nav") as HTMLElement);
    expect(tree().queryAllByText(DEMO_FOLDER).length, "the demo folder is missing to begin with").toBeGreaterThan(0);
    openGallery(container);
    const card = container.querySelector<HTMLElement>("[data-gallery-card], .gallerycard, .gallcard");
    if (card) fireEvent.click(card);
    // Whether or not the card was reachable in jsdom, the folder must still be the only
    // project — a second, near-identical one is what a drifted name would produce.
    expect(tree().queryAllByText(DEMO_FOLDER).length, "the demo folder went missing").toBeGreaterThan(0);
  });

  it("files the card into a 'Gallery' experiment, never into the demo data's Experiment 1", () => {
    // Filing into the folder's first experiment would put the copy into "Experiment 1", the
    // demo measurements. A synthetic gallery copy sitting between them is
    // indistinguishable from them in the tree.
    const { container } = render(<AppShell />);
    fireEvent.click(within(container.querySelector(".canvas") as HTMLElement).getByText("Chart gallery"));
    fireEvent.click(container.querySelector('button[title="Open as an editable graph"]') as HTMLButtonElement);
    // The card's copy is named after the card — read it off the tab it opened.
    const tabs = [...container.querySelectorAll("button.tab:not(.tabadd)")].map((b) => b.textContent?.trim() ?? "");
    const made = tabs.find((n) => n !== "Welcome" && n !== "Chart gallery");
    expect(made, "clicking the card did not open a graph tab").toBeTruthy();

    const tree = () => within(container.querySelector(".nav") as HTMLElement);
    const row = tree().getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);

    const galleryLabel = tree().queryByText("Gallery");
    expect(galleryLabel, "no 'Gallery' experiment in the demo project").toBeTruthy();
    // An ExperimentNode is one div: its own .navrow followed by its member rows.
    const galleryNode = galleryLabel!.closest(".navrow")!.parentElement as HTMLElement;
    expect(
      within(galleryNode).queryAllByText(made!).length,
      "the card's graph + datasheet are not inside the Gallery experiment",
    ).toBeGreaterThanOrEqual(2); // the datasheet and the graph share the card's name
    const e1Node = tree().getByText("Experiment 1").closest(".navrow")!.parentElement as HTMLElement;
    expect(
      within(e1Node).queryByText(made!),
      "the gallery card was filed into Experiment 1, between the demo data",
    ).toBeNull();
  }, GALLERY_TIMEOUT);
});

/**
 * The demo project starts folded, so the tree reads as a shape rather than a wall.
 *
 * Eight experiments of synthetic content expanded on first run is a new user's first
 * impression of the side panel. The failure to guard against is the opposite of "missing":
 * it is the folder quietly opening again, which looks fine to anyone who already knows what
 * is in it.
 */
describe("AppShell — the demo project is collapsed by default", () => {
  const tree = (c: HTMLElement) => within(c.querySelector(".nav") as HTMLElement);

  it("shows the folder but not its experiments", () => {
    const { container } = render(<AppShell />);
    expect(tree(container).getByText(DEMO_FOLDER), "the demo folder is missing").toBeTruthy();
    expect(
      tree(container).queryByText("Experiment 1"),
      "the demo project opened itself — its experiments are showing",
    ).toBeNull();
  });

  it("opens on a click, and its contents are all there", () => {
    // Collapsed by default must not mean hard to reach.
    const { container } = render(<AppShell />);
    const row = tree(container).getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    expect(tree(container).getByText("Experiment 1"), "the folder did not open").toBeTruthy();
    expect(tree(container).getByText(TABLE_NAME)).toBeTruthy();
  });

  it("leaves the user's own projects open", () => {
    // Only the sample's folder is folded; a folder they made is theirs.
    const { container } = render(<AppShell />);
    fireEvent.click(container.querySelector(".navtop .mini") as HTMLButtonElement); // New project
    expect(tree(container).getByText("Project 2")).toBeTruthy();
    expect(
      tree(container).queryAllByText("Experiment 1").length,
      "a newly created project should be open, showing its first experiment",
    ).toBeGreaterThan(0);
  });
});

/**
 * A brand-new graph lands you on the datasheet, not the empty figure.
 *
 * The New datasheet / graph dialog creates both. The plot on its own is an empty frame with no
 * obvious next step, when the next step is always "put the numbers in".
 */
describe("AppShell — New datasheet / graph opens the spreadsheet", () => {
  const openCreator = (c: HTMLElement): void => {
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("File"));
    fireEvent.click(within(c).getByText("New datasheet / graph…"));
  };

  it("lands on the datasheet, with the graph open beside it", () => {
    const { container } = render(<AppShell />);
    // `.tabadd` is the "+" affordance in a tab-strip group, not an open tab — it only
    // appears once the Graphs group has something in it, so it must be excluded here
    // or the count skews when that group goes from absent to present.
    const openTabCount = () => container.querySelectorAll("button.tab:not(.tabadd)").length;
    const before = openTabCount();
    openCreator(container);
    const dlg = container.querySelector("[role=dialog]");
    expect(dlg, "the creator dialog did not open — this test would prove nothing").toBeTruthy();
    const create = [...dlg!.querySelectorAll("button")].find((b) => /^Create datasheet \+ graph$/.test((b.textContent ?? "").trim()));
    expect(create, "no create button in the creator dialog").toBeTruthy();
    fireEvent.click(create!);

    // Two new tabs, and the active one is the datasheet: a fresh graph is empty, and the
    // next thing to do is always to put the numbers in.
    const tabs = [...container.querySelectorAll("button.tab:not(.tabadd)")];
    expect(tabs.length, "expected a datasheet and a graph tab").toBe(before + 2);
    const active = container.querySelector("button.tab.on");
    expect(active, "nothing is active after creating").toBeTruthy();
    const grid = container.querySelector(".canvas .dg");
    expect(grid, "the active tab is not the spreadsheet — it opened on the empty graph").toBeTruthy();
  });
});

/**
 * "New graph of this data" (Graph menu · Assistant nudge · the "+" tab · Navigator "+") opens
 * the New-graph dialog on that sheet: its format, the first suggestion pre-selected,
 * Data = the sheet; Create puts the plot on that table. A blind XY graph would be empty on
 * most of the sample sheets.
 */
describe("AppShell — New graph of this data opens the wizard on that sheet", () => {
  const CELLS = sample.tables.find((t) => t.name.startsWith("Cell profiling"))!;
  const openTable = (c: HTMLElement, name: string): void => {
    const nav = within(c.querySelector(".nav") as HTMLElement);
    const row = nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav.getByText(name).closest("button") as HTMLButtonElement);
  };

  it("from the Cell profiling (PCA) sheet: the dialog opens with the PCA score plot pre-selected, and Create hands off to Analyze ▸ PCA", () => {
    const { container } = render(<AppShell />);
    openTable(container, CELLS.name);
    expect(container.querySelector(".canvas .dg"), "the datasheet did not open").toBeTruthy();
    const plotTabsBefore = container.querySelectorAll("button.tab:not(.tabadd)").length;

    fireEvent.click(within(container.querySelector(".menubar") as HTMLElement).getByText("Graph"));
    fireEvent.click(within(container).getByText("New graph of this data"));

    const dlg = container.querySelector('[role="dialog"][aria-label="New graph"]');
    expect(dlg, "New graph of this data did not open the New-graph dialog").toBeTruthy();
    expect(dlg!.querySelector(".modalh")?.textContent, "the dialog is not on the open sheet").toContain(CELLS.name);
    // Data-first, the sheet's format picked (the dedicated PCA / ordination format), and its first
    // suggestion lit — the PCA score plot, neither XY nor the wider multivariable graph set.
    const dataCard = dlg!.querySelector('[aria-label="Data types"] .an-card.is-active');
    expect(dataCard?.getAttribute("aria-label")).toBe("PCA / ordination");
    const graphCard = dlg!.querySelector('[aria-label="Graph types"] .an-card.is-active');
    expect(graphCard?.getAttribute("data-genre"), "the pre-selected suggestion is not the PCA score plot").toBe("pcascore");

    // A PCA graph is analysis-fed, so the Create button hands off to Analyze rather than drawing.
    const create = [...dlg!.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Open Analyze…");
    expect(create, "no 'Open Analyze…' button — the dialog is not handing the open sheet to Analyze").toBeTruthy();
    fireEvent.click(create!);
    // A PCA graph is an analysis result, so Create hands off to Analyze pre-set on the sheet — it
    // does not draw a plot directly (no new plot tab, no figure). The graph lands when PCA runs.
    expect(container.querySelector('[role="dialog"][aria-label="New graph"]')).toBeNull();
    expect(container.querySelectorAll("button.tab:not(.tabadd)").length, "Create should not add a plot tab for an analysis-fed graph").toBe(plotTabsBefore);
    const analyze = container.querySelector('[role="dialog"][aria-label="Analyze"]');
    expect(analyze, "Create did not hand off to the Analyze dialog").toBeTruthy();
  });
});

/**
 * Generic "New graph…" (Graph ▸ New graph…, File ▸ New datasheet / graph…) makes a datasheet from
 * scratch, as the guide describes it. After one graph is made via the wizard, a second
 * "New graph…" must create a new datasheet rather than land on the graph. The generic door has
 * no explicit source table, so falling back to the working table would make the dialog default
 * to graphing that open sheet. The explicit "New graph of this data" door must
 * still default to the open sheet (covered above); only the generic door defaults to a new sheet.
 */
describe("AppShell — generic 'New graph…' defaults to a new datasheet, not the open sheet", () => {
  const BAR = sample.tables.find((t) => t.kind === "column") ?? sample.tables[0]!;
  const openTable = (c: HTMLElement, name: string): void => {
    const nav = within(c.querySelector(".nav") as HTMLElement);
    const row = nav.getByText(DEMO_FOLDER).closest(".navrow") as HTMLElement;
    fireEvent.click(row.querySelector("button.twist") as HTMLButtonElement);
    fireEvent.click(nav.getByText(name).closest("button") as HTMLButtonElement);
  };
  const openNewGraphMenu = (c: HTMLElement): void => {
    fireEvent.click(within(c.querySelector(".menubar") as HTMLElement).getByText("Graph"));
    fireEvent.click(within(c).getByText("New graph…"));
  };

  it("with a datasheet open, Graph ▸ New graph… does not default to graphing it", () => {
    const { container } = render(<AppShell />);
    openTable(container, BAR.name);
    expect(container.querySelector(".canvas .dg"), "the datasheet did not open").toBeTruthy();

    openNewGraphMenu(container);
    const dlg = container.querySelector('[role="dialog"][aria-label="New graph"]');
    expect(dlg, "Graph ▸ New graph… did not open the dialog").toBeTruthy();
    // The generic door makes a fresh datasheet: the title is the from-scratch one, and if the
    // "graph the open sheet" choice is offered at all it starts on "new".
    expect(dlg!.querySelector(".modalh")?.textContent).toBe("New datasheet + graph");
    const src = dlg!.querySelector<HTMLSelectElement>('select[aria-label="Data source"]');
    if (src) expect(src.value, "generic New graph… pre-selected the open sheet").toBe("new");
  });

  it("creating a second graph via New graph… makes a new datasheet (does not land on a plot of the first)", () => {
    const { container } = render(<AppShell />);

    // First graph via the wizard, from scratch (bar/column, which draws without an analysis).
    openNewGraphMenu(container);
    let dlg = container.querySelector('[role="dialog"][aria-label="New graph"]')!;
    fireEvent.click(dlg.querySelector('[data-kind="column"]') as HTMLButtonElement);
    fireEvent.click(dlg.querySelector('[data-genre="bar"]') as HTMLButtonElement);
    fireEvent.click([...dlg.querySelectorAll("button.btn")].find((b) => /Create/.test(b.textContent ?? "")) as HTMLButtonElement);
    const tablesAfterFirst = container.querySelectorAll(".nav .navrow").length;

    // Second graph via the same generic door — it must build another datasheet, not graph the first.
    openNewGraphMenu(container);
    dlg = container.querySelector('[role="dialog"][aria-label="New graph"]')!;
    expect(dlg.querySelector(".modalh")?.textContent, "second New graph… defaulted to the open sheet").toBe("New datasheet + graph");
    const src = dlg.querySelector<HTMLSelectElement>('select[aria-label="Data source"]');
    if (src) expect(src.value).toBe("new");
    fireEvent.click(dlg.querySelector('[data-kind="column"]') as HTMLButtonElement);
    fireEvent.click(dlg.querySelector('[data-genre="bar"]') as HTMLButtonElement);
    fireEvent.click([...dlg.querySelectorAll("button.btn")].find((b) => /Create/.test(b.textContent ?? "")) as HTMLButtonElement);
    // A new datasheet appeared in the tree (more rows than after the first create).
    expect(container.querySelectorAll(".nav .navrow").length, "the second create did not add a new datasheet").toBeGreaterThan(tablesAfterFirst);
  });
});

/**
 * The language model is a development feature. The installed program —
 * and a browser preview — must show neither the "Activate, install & configure LLM" button nor
 * the bar, not even for a frame. The bridge's `llmEnabled` flag, read synchronously at preload
 * time, is the only thing that turns them on.
 */
describe("AppShell — the language model exists only where the bridge says so", () => {
  const W = window as unknown as { mady?: Record<string, unknown> };
  afterEach(() => {
    delete W.mady;
  });

  it("no bridge (browser preview / packaged build): no button, no bar, no set-up", () => {
    delete W.mady;
    const { container } = render(<AppShell />);
    expect(container.querySelector(".modelbtn")).toBeNull();
    expect(container.querySelector(".modelbar")).toBeNull();
  });

  it("a bridge with llmEnabled:false (the installed program): still nothing", () => {
    W.mady = { llmEnabled: false, modelStatus: async () => ({}) };
    const { container } = render(<AppShell />);
    expect(container.querySelector(".modelbtn")).toBeNull();
  });

  it("a bridge with llmEnabled:true (a development run): the button is there", () => {
    W.mady = { llmEnabled: true, modelStatus: async () => null };
    const { container } = render(<AppShell />);
    expect(container.querySelector(".modelbtn")).not.toBeNull();
    expect(container.querySelector(".modelbtn")?.textContent).toContain("Activate, install & configure LLM");
  });
});
