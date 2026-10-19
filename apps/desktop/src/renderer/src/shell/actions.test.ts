// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildActions, eventCombo, isEditableTarget, matchShortcut } from "./actions";
import type { ActionHandlers, AppAction } from "./actions";
import { TOURS } from "./tour";

function handlers(over: Partial<ActionHandlers> = {}): ActionHandlers {
  return {
    openFile: vi.fn(),
    importData: vi.fn(),
    importGgplot: vi.fn(),
    pasteData: vi.fn(),
    save: vi.fn(),
    exportActive: vi.fn(),
    canExport: true,
    exportAll: vi.fn(),
    canExportAll: true,
    print: vi.fn(),
    canPrint: true,
    copyPicture: vi.fn(),
    copySvg: vi.fn(),
    canCopyPicture: true,
    exportScript: vi.fn(),
    exportRepro: vi.fn(),
    newProject: vi.fn(),
    newDataset: vi.fn(),
    newTable: vi.fn(),
    newLayout: vi.fn(),
    reshapeData: vi.fn(),
    excludeValues: vi.fn(),
    includeValues: vi.fn(),
    hasDataSelection: true,
    copyData: vi.fn(),
    cutData: vi.fn(),
    pasteCells: vi.fn(),
    canEditDataSelection: true,
    rowStats: vi.fn(),
    pruneData: vi.fn(),
    colMath: vi.fn(),
    transposeData: vi.fn(),
    extractData: vi.fn(),
    mergeData: vi.fn(),
    canMergeData: true,
    splitText: vi.fn(),
    findReplace: vi.fn(),
    canFindReplace: true,
    transformData: vi.fn(),
    frequencyData: vi.fn(),
    qqData: vi.fn(),
    simulateData: vi.fn(),
    powerCalc: vi.fn(),
    monteCarlo: vi.fn(),
    duplicateData: vi.fn(),
    sortData: vi.fn(),
    canSortData: true,
    newGraph: vi.fn(),
    cloneGraph: vi.fn(),
    splitGraph: vi.fn(),
    canSplitGraph: true,
    detachSmallGraph: vi.fn(),
    isSmallGraph: true,
    applyLook: vi.fn(),
    hasPlot: true,
    newGraphDialog: vi.fn(),
    openGallery: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: true,
    canRedo: true,
    canZoomIn: true,
    canZoomOut: true,
    analyze: vi.fn(),
    doseResponse: vi.fn(),
    enzymeKinetics: vi.fn(),
    binding: vi.fn(),
    interpolateCurve: vi.fn(),
    methodComparison: vi.fn(),
    meltingTemperature: vi.fn(),
    openCommandPalette: vi.fn(),
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    canNavigateBack: true,
    canNavigateForward: true,
    toggleTheme: vi.fn(),
    toggleGraphRuler: vi.fn(),
    graphRulerOn: false,
    toggleColorVision: vi.fn(),
    colorVisionOn: false,
    canPreviewColor: true,
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    setZoomLevel: vi.fn(),
    resetToolbar: vi.fn(),
    openLayouts: vi.fn(),
    resetLayout: vi.fn(),
    viewLineage: vi.fn(),
    openSettings: vi.fn(),
    reportBug: vi.fn(),
    openGuide: vi.fn(),
    saveManual: vi.fn(),
    openAbout: vi.fn(),
    openWelcome: vi.fn(),
    startTour: vi.fn(),
    canAnnotate: true,
    canBracket: true,
    hasPairwiseAnalysis: true,
    addAnnotation: vi.fn(),
    bracketsFromAnalysis: vi.fn(),
    lettersFromAnalysis: vi.fn(),
    openSignificanceOptions: vi.fn(),
    ...over,
  };
}

const ev = (over: Partial<KeyboardEvent>): KeyboardEvent =>
  ({ ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, key: "", target: null, ...over }) as KeyboardEvent;

describe("buildActions", () => {
  it("exposes the core file commands with shortcuts", () => {
    const a = buildActions(handlers());
    const byId = Object.fromEntries(a.map((x) => [x.id, x]));
    expect(byId["open"]?.combo).toBe("ctrl+o");
    expect(byId["import"]?.combo).toBe("ctrl+i");
    expect(byId["paste-data"]?.combo).toBe("ctrl+shift+v");
    expect(byId["save"]?.combo).toBe("ctrl+s");
    expect(byId["export"]?.combo).toBe("ctrl+e");
    expect(byId["command-palette"]?.combo).toBe("ctrl+k");
  });

  it("exposes zoom + reset-toolbar in the View menu", () => {
    const byId = Object.fromEntries(buildActions(handlers()).map((x) => [x.id, x]));
    expect(byId["zoom-in"]?.combo).toBe("ctrl+=");
    expect(byId["zoom-out"]?.combo).toBe("ctrl+-");
    expect(byId["zoom-reset"]?.combo).toBe("ctrl+0");
    expect(byId["reset-toolbar"]?.menu).toBe("View");
    expect(byId["layouts"]?.menu).toBe("View");
    expect(byId["reset-layout"]?.menu).toBe("View");
  });

  it("exposes New datasheet / graph… in the File menu, opening the same creator as Graph ▸ New graph", () => {
    // Deliberate redundancy: one dialog, two doors. Someone starting a
    // piece of work looks in File; someone who wants a picture looks in Graph. What this
    // pins is that they stay the same command — a second dialog wired up here later would
    // be the failure, not a missing entry.
    const run = vi.fn();
    const byId = Object.fromEntries(buildActions(handlers({ newGraphDialog: run })).map((x) => [x.id, x]));
    expect(byId["new-dataset-dialog"]?.menu).toBe("File");
    expect(byId["new-dataset-dialog"]?.label, "the File entry must name both outcomes").toBe("New datasheet / graph…");
    byId["new-dataset-dialog"]!.run();
    expect(run).toHaveBeenCalled();

    // …and it is the very same handler the Graph menu calls.
    run.mockClear();
    byId["new-graph-create"]!.run();
    expect(run, "the two doors have drifted onto different commands").toHaveBeenCalled();
  });

  it("exposes the New-graph creator + gallery in the Graph menu", () => {
    const run = vi.fn();
    const byId = Object.fromEntries(buildActions(handlers({ newGraphDialog: run })).map((x) => [x.id, x]));
    expect(byId["new-graph-create"]?.menu).toBe("Graph");
    byId["new-graph-create"]!.run();
    expect(run).toHaveBeenCalled();
    expect(byId["gallery"]?.menu).toBe("Graph");
  });

  it("exposes a first-class Dose-response command in the Analyze menu, wired to doseResponse", () => {
    const h = handlers();
    const byId = Object.fromEntries(buildActions(h).map((x) => [x.id, x]));
    expect(byId["doseresponse"]?.menu).toBe("Analyze");
    expect(byId["doseresponse"]?.label).toMatch(/dose-response/i);
    byId["doseresponse"]!.run();
    expect(h.doseResponse).toHaveBeenCalledOnce();
  });

  it("exposes the named curve-fit / analysis front doors in the Analyze menu, each wired", () => {
    const h = handlers();
    const byId = Object.fromEntries(buildActions(h).map((x) => [x.id, x]));
    for (const id of ["enzyme-kinetics", "binding", "interpolate-curve", "method-comparison", "melting-temperature"]) {
      expect(byId[id]?.menu, id).toBe("Analyze");
    }
    byId["enzyme-kinetics"]!.run();
    expect(h.enzymeKinetics).toHaveBeenCalledOnce();
    byId["binding"]!.run();
    expect(h.binding).toHaveBeenCalledOnce();
    byId["interpolate-curve"]!.run();
    expect(h.interpolateCurve).toHaveBeenCalledOnce();
    byId["method-comparison"]!.run();
    expect(h.methodComparison).toHaveBeenCalledOnce();
    byId["melting-temperature"]!.run();
    expect(h.meltingTemperature).toHaveBeenCalledOnce();
  });

  it("exposes a Settings command in the View menu, wired to openSettings", () => {
    const h = handlers();
    const byId = Object.fromEntries(buildActions(h).map((x) => [x.id, x]));
    expect(byId["settings"]?.menu).toBe("View");
    byId["settings"]!.run();
    expect(h.openSettings).toHaveBeenCalledOnce();
  });

  it("reflects undo/redo enablement", () => {
    const a = buildActions(handlers({ canUndo: false, canRedo: true }));
    expect(a.find((x) => x.id === "undo")?.enabled).toBe(false);
    expect(a.find((x) => x.id === "redo")?.enabled).toBe(true);
  });

  it("runs the wired handler", () => {
    const h = handlers();
    buildActions(h).find((x) => x.id === "export")!.run();
    expect(h.exportActive).toHaveBeenCalledOnce();
  });

  it("wires Print in the File menu on Ctrl+P, gated by canPrint", () => {
    const h = handlers();
    const print = buildActions(h).find((x) => x.id === "print");
    expect(print, "no Print action").toBeTruthy();
    expect(print!.menu).toBe("File");
    expect(print!.shortcut).toBe("Ctrl+P");
    expect(print!.combo).toBe("ctrl+p");
    print!.run();
    expect(h.print).toHaveBeenCalledOnce();
    // disabled when nothing printable is active
    expect(buildActions(handlers({ canPrint: false })).find((x) => x.id === "print")!.enabled).toBe(false);
  });

  // ── Menu layout. The Analyze menu is kept short (as one flat list its entries would
  // nearly fill a 720px window): data-table transforms live in their own "Data" menu;
  // the domain entry points nest under one "Common analyses" row; labels carry no
  // parentheticals (the detail is in `keywords`, so search keeps working).
  const topLevel = (a: AppAction[], menu: string): AppAction[] =>
    a.filter((x) => x.menu === menu && !x.submenu);

  it("keeps the Analyze menu to a scannable top level — statistics only, no table transforms", () => {
    const a = buildActions(handlers());
    // What a user sees when opening Analyze is a handful of rows.
    expect(topLevel(a, "Analyze").length).toBeLessThanOrEqual(5);
    // Data-shaping commands are not in Analyze at all.
    for (const id of ["transform", "frequency", "rowstats", "prune", "colmath", "transpose", "extract", "qqplot"]) {
      expect(a.find((x) => x.id === id)?.menu, id).toBe("Data");
    }
  });

  it("gathers every data-shaping command into the Data menu, including reshape and duplicate", () => {
    const h = handlers();
    const a = buildActions(h);
    // Reshape + Duplicate datasheet belong in Data with their siblings, not in Insert —
    // one class of operation, one menu.
    expect(a.find((x) => x.id === "reshape")?.menu).toBe("Data");
    expect(a.find((x) => x.id === "duplicate-data")?.menu).toBe("Data");
    expect(a.filter((x) => x.menu === "Insert").some((x) => x.id === "reshape" || x.id === "duplicate-data")).toBe(false);
    a.find((x) => x.id === "transpose")!.run();
    expect(h.transposeData).toHaveBeenCalledOnce();
  });

  it("nests the six domain front doors under one 'Common analyses' row, still in Analyze", () => {
    const a = buildActions(handlers());
    const doors = ["doseresponse", "enzyme-kinetics", "binding", "interpolate-curve", "method-comparison", "melting-temperature"];
    for (const id of doors) {
      const act = a.find((x) => x.id === id);
      expect(act?.menu, id).toBe("Analyze");
      expect(act?.submenu, id).toBe("Common analyses");
    }
    // …and they are not counted as top-level rows.
    expect(topLevel(a, "Analyze").map((x) => x.id)).not.toContain("doseresponse");
  });

  it("shortens the labels but keeps the jargon searchable via keywords", () => {
    const a = buildActions(handlers());
    const byId = Object.fromEntries(a.map((x) => [x.id, x]));
    // The front door to every method carries a plain label, not the name of one specific test.
    expect(byId["analyze"]?.label).toBe("Analyze…");
    // Terms a user would actually type must still match somewhere on the action.
    const searchText = (id: string): string => `${byId[id]?.menu} ${byId[id]?.label} ${byId[id]?.keywords ?? ""}`.toLowerCase();
    expect(searchText("analyze")).toContain("column statistics");
    expect(searchText("doseresponse")).toContain("ec50");
    expect(searchText("enzyme-kinetics")).toContain("michaelis");
    expect(searchText("method-comparison")).toContain("bland-altman");
    expect(searchText("frequency")).toContain("histogram");
    expect(searchText("rowstats")).toContain("sem");
  });

  it("keeps Insert to three rows — the per-format tables nest under one 'New table' parent", () => {
    const h = handlers();
    const a = buildActions(h);
    expect(topLevel(a, "Insert").map((x) => x.id)).toEqual(["new-dataset", "new-layout"]);
    const nested = a.filter((x) => x.menu === "Insert" && x.submenu === "New table");
    // Every non-XY format is present and still one click from a real handler.
    expect(nested.map((x) => x.id).sort()).toEqual(
      ["alterations", "association", "column", "contingency", "edgelist", "grouped", "meta", "multivariable", "nested", "partsofwhole", "pca", "sets", "survival", "timeline"].map((k) => `new-table-${k}`),
    );
    nested.find((x) => x.id === "new-table-survival")!.run();
    expect(h.newTable).toHaveBeenCalledWith("survival");
    // The XY quick-create keeps its top-level row — it is the common case.
    expect(a.find((x) => x.id === "new-dataset")?.submenu).toBeUndefined();
  });

  it("offers a New-table command for every non-XY format, wired to newTable", () => {
    const h = handlers();
    const a = buildActions(h);
    const ids = a.map((x) => x.id);
    for (const kind of ["column", "grouped", "contingency", "survival", "partsofwhole", "multivariable", "nested"]) {
      expect(ids).toContain(`new-table-${kind}`);
    }
    a.find((x) => x.id === "new-table-multivariable")!.run();
    expect(h.newTable).toHaveBeenCalledWith("multivariable");
  });
});

describe("eventCombo", () => {
  it("normalizes modifiers (ctrl/cmd → ctrl) + key", () => {
    expect(eventCombo(ev({ ctrlKey: true, key: "O" }))).toBe("ctrl+o");
    expect(eventCombo(ev({ metaKey: true, key: "s" }))).toBe("ctrl+s");
    expect(eventCombo(ev({ ctrlKey: true, shiftKey: true, key: "Z" }))).toBe("ctrl+shift+z");
  });
});

describe("isEditableTarget", () => {
  it("detects inputs / textareas / contentEditable", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("matchShortcut", () => {
  const actions = buildActions(handlers());

  it("resolves Ctrl+O → open", () => {
    expect(matchShortcut(actions, ev({ ctrlKey: true, key: "o" }))?.id).toBe("open");
  });

  it("treats Ctrl+Shift+Z as redo", () => {
    expect(matchShortcut(actions, ev({ ctrlKey: true, shiftKey: true, key: "z" }))?.id).toBe("redo");
  });

  it("skips undo/redo while editing a text field", () => {
    const inInput = ev({ ctrlKey: true, key: "z", target: { tagName: "INPUT" } as unknown as EventTarget });
    expect(matchShortcut(actions, inInput)).toBeUndefined();
    // but Save still fires inside an input
    const save = ev({ ctrlKey: true, key: "s", target: { tagName: "INPUT" } as unknown as EventTarget });
    expect(matchShortcut(actions, save)?.id).toBe("save");
  });

  it("ignores a disabled action's shortcut", () => {
    const noUndo = buildActions(handlers({ canUndo: false }));
    expect(matchShortcut(noUndo, ev({ ctrlKey: true, key: "z" }))).toBeUndefined();
  });
});

describe("the Edit-menu clipboard + Data sort (menu routes for grid ops)", () => {
  const byId = (a: AppAction[]) => Object.fromEntries(a.map((x) => [x.id, x] as const));

  it("Copy/Cut/Paste sit in Edit, show a shortcut hint, but bind NO global combo", () => {
    const a = buildActions(handlers());
    const m = byId(a);
    for (const id of ["copy-cells", "cut-cells", "paste-cells"]) {
      expect(m[id], id).toBeTruthy();
      expect(m[id]!.menu).toBe("Edit");
      expect(m[id]!.shortcut, `${id} shows a shortcut hint`).toBeTruthy();
      // Note: the grid owns Ctrl+C/X/V via ClipboardEvent. A global combo here would fire a second
      // copy/clear/paste on every keystroke — so these must declare no combo.
      expect(m[id]!.combo, `${id} must not bind a global combo`).toBeUndefined();
    }
    // Proof of the above at the resolver: Ctrl+C / Ctrl+X / Ctrl+V resolve to nothing globally.
    expect(matchShortcut(a, ev({ ctrlKey: true, key: "c" }))).toBeUndefined();
    expect(matchShortcut(a, ev({ ctrlKey: true, key: "x" }))).toBeUndefined();
    expect(matchShortcut(a, ev({ ctrlKey: true, key: "v" }))).toBeUndefined();
  });

  it("Copy needs a selection; Cut/Paste additionally need an editable (non-frozen) table", () => {
    const en = (a: AppAction[], id: string) => a.find((x) => x.id === id)!.enabled;
    const none = buildActions(handlers({ hasDataSelection: false, canEditDataSelection: false }));
    expect(en(none, "copy-cells")).toBe(false);
    expect(en(none, "cut-cells")).toBe(false);
    expect(en(none, "paste-cells")).toBe(false);
    // frozen table: a block is selected but not editable → Copy on, Cut/Paste off.
    const frozen = buildActions(handlers({ hasDataSelection: true, canEditDataSelection: false }));
    expect(en(frozen, "copy-cells")).toBe(true);
    expect(en(frozen, "cut-cells")).toBe(false);
    expect(en(frozen, "paste-cells")).toBe(false);
    const editable = buildActions(handlers({ hasDataSelection: true, canEditDataSelection: true }));
    expect(en(editable, "cut-cells")).toBe(true);
    expect(en(editable, "paste-cells")).toBe(true);
  });

  it("Data ▸ Sort is wired to a handler and gated on canSortData", () => {
    const run = vi.fn();
    const on = buildActions(handlers({ sortData: run, canSortData: true }));
    const sort = on.find((x) => x.id === "sort-data")!;
    expect(sort.menu).toBe("Data");
    sort.run();
    expect(run).toHaveBeenCalled();
    expect(buildActions(handlers({ canSortData: false })).find((x) => x.id === "sort-data")!.enabled).toBe(false);
  });
});

describe("the Design menu", () => {
  it("every Design menu command is wired to a handler and can be disabled", () => {
    // Complements toolbar.no-dead-buttons.test.ts: a button that opens a menu of items that do nothing
    // promises a feature it cannot deliver, one level down. Enumerated from the registry, so a new Design item is
    // enrolled automatically.
    const off = buildActions(handlers({ canAnnotate: false, canBracket: false, hasPairwiseAnalysis: false }));
    const on = buildActions(handlers({ canAnnotate: true, canBracket: true, hasPairwiseAnalysis: true }));
    const design = on.filter((a) => a.menu === "Design");
    expect(design.length, "the Design menu is empty").toBeGreaterThan(4);
    for (const a of design) expect(typeof a.run, `${a.id} has no handler`).toBe("function");
    for (const a of off.filter((x) => x.menu === "Design")) {
      expect(a.enabled, `${a.id} stays enabled with no annotatable graph`).toBe(false);
    }
  });
});

describe("the Help menu", () => {
  const help = (): AppAction[] => buildActions(handlers()).filter((a) => a.menu === "Help");

  it("answers six questions, with About last as every desktop app files it", () => {
    // Order is the assertion. A menu that files About anywhere but the end costs a read
    // of the whole list. Welcome leads (it's where the app itself starts you), the tours
    // follow the manual they are drawn from and nest under one "Guided tours" row, and
    // About trails.
    expect(help().map((a) => a.label)).toEqual([
      "Welcome page",
      "Documentation",
      ...TOURS.map((t) => t.label),
      "Save the manual…",
      "Report a bug…",
      "About MadY",
    ]);
    const tours = help().filter((a) => a.id.startsWith("tour-"));
    expect(tours.length).toBe(TOURS.length);
    for (const a of tours) expect(a.submenu, `${a.id} is loose in the Help menu`).toBe("Guided tours");
  });

  it("each opens its own thing", () => {
    const h = { openWelcome: vi.fn(), openGuide: vi.fn(), startTour: vi.fn(), reportBug: vi.fn(), openAbout: vi.fn() };
    for (const a of buildActions(handlers(h)).filter((x) => x.menu === "Help")) a.run();
    expect(h.openWelcome).toHaveBeenCalledOnce();
    expect(h.openGuide).toHaveBeenCalledOnce();
    expect(h.startTour).toHaveBeenCalledTimes(TOURS.length);
    expect(h.startTour.mock.calls.map((c) => c[0])).toEqual(TOURS.map((t) => t.id));
    expect(h.reportBug).toHaveBeenCalledOnce();
    expect(h.openAbout).toHaveBeenCalledOnce();
  });

  it("finds About by the words someone would actually type", () => {
    // The label says "About MadY"; nobody searches that when they want the version.
    const about = help().find((a) => a.id === "about")!;
    for (const word of ["version", "licence", "copyright", "cite"])
      expect(about.keywords, `the palette cannot find About by "${word}"`).toContain(word);
  });
});
