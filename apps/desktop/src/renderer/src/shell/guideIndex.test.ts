// @vitest-environment jsdom
/**
 * The function index is complete — default-deny, in the direction that rots.
 *
 * The manual's coverage tests (`guide.test.ts` and others) ask whether the prose
 * mentions a thing. That is a different question from the one this file asks: can a user find
 * the control. A command can be named in a paragraph about workflow and still be unfindable,
 * because nothing anywhere says which menu it is in.
 *
 * So: every command in `actions.ts`, every toolbar button, every table format, every analysis
 * method, every gallery chart, every transform group and every export format must have an index
 * entry carrying a route to it. Add a command without documenting it and this fails — which is
 * the whole point, because nothing else would.
 *
 * jsdom rather than node: the index reads the chart gallery, and a few cards measure text.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TRANSFORMS, tableFormatList } from "@mady/core";
import { actionCatalogue } from "./actions";
import { METHOD_GROUPS } from "./analysis";
import { EXPORT_FORMAT_LABEL, PLOT_EXPORT_FORMATS, TABLE_EXPORT_FORMATS } from "./exporters";
import { galleryItems } from "./gallery";
import { GUIDE } from "./guide";
import { ACTION_DOCS, AXIS_DOCS, INSPECTOR_DOCS, TOOLBAR_DOCS, guideIndex, whereLine, type GuideWhere } from "./guideIndex";
import { AXIS_GROUPS, INSPECTOR_SECTIONS, INSPECTOR_TABS, inspectorSectionId, tabForSection } from "./Inspector";
import { HOME_GROUP, type ToolbarItemId } from "./toolbar";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Source with its comments removed.
 *
 * Caution: a walker that greps source for a JSX pattern will also find that pattern quoted in a
 * doc comment — without this, the section walker below returns an extra section called "…",
 * from a comment in `Inspector.tsx` that quotes the very pattern being searched for.
 */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const INDEX = guideIndex();
const byId = new Map(INDEX.map((e) => [e.id, e]));
const SECTION_IDS = new Set(GUIDE.map((s) => s.id));

/** Everything an entry can be found by — name, what, keywords, and its where lines. */
const entryText = (id: string): string => {
  const e = byId.get(id);
  if (!e) return "";
  return [e.name, e.what, ...(e.keywords ?? []), ...e.where.map(whereLine)].join(" ").toLowerCase();
};

describe("the index is structurally sound", () => {
  it("is not vacuously green", () => {
    // Commands, toolbar buttons, table formats, analysis methods, the gallery, transform groups
    // and export formats together come to well over a hundred entries.
    expect(INDEX.length).toBeGreaterThan(120);
  });

  it("ids are unique", () => {
    const seen = new Map<string, number>();
    for (const e of INDEX) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    expect(dupes, `two entries share an id: ${dupes.join(", ")}`).toEqual([]);
  });

  it("every entry has a name, a sentence saying what it does, and at least one route to it", () => {
    for (const e of INDEX) {
      expect(e.name.trim(), `${e.id} has no name`).not.toBe("");
      expect(e.what.trim().length, `${e.id}'s description is a stub: “${e.what}”`).toBeGreaterThan(20);
      expect(e.where.length, `${e.id} says what it is but never where it is`).toBeGreaterThan(0);
    }
  });

  it("no two entries claim the same place", () => {
    // Guards against the same route appearing twice in the rendered "Where is everything"
    // chapter, as when a hand-written entry repeats a derived one. A reader
    // scanning a route column cannot tell which of the two to believe. One function, one entry,
    // all its doors — extra routes go on the derived entry (`EXTRA_WHERE`), never on a second.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const e of INDEX)
      for (const w of e.where) {
        // A section heading legitimately appears on several Inspector entries only when the
        // titles differ; the line is what a reader reads, so the line is what must be unique.
        const line = whereLine(w);
        const first = seen.get(line);
        if (first !== undefined && first !== e.id) clashes.push(`${line}  ←  ${first} and ${e.id}`);
        else seen.set(line, e.id);
      }
    expect(clashes, `two entries send the reader to the same control:\n  ${clashes.join("\n  ")}`).toEqual([]);
  });

  it("every entry points at a chapter that exists", () => {
    // A dangling section id is a dead link in the results list: the hit renders, the reader
    // clicks it, and nothing scrolls.
    const dangling = INDEX.filter((e) => !SECTION_IDS.has(e.section)).map((e) => `${e.id} → ${e.section}`);
    expect(dangling, `these entries name a chapter the manual does not have: ${dangling.join(", ")}`).toEqual([]);
  });

  it("every route renders a readable line", () => {
    // The `where` line is the whole answer to "where is it". A `via` the renderer does not
    // handle would come back empty and the hit would say nothing.
    for (const e of INDEX)
      for (const w of e.where)
        expect(whereLine(w).trim(), `${e.id}: a ${w.via} route renders as nothing`).not.toBe("");
  });

  it("whereLine handles every kind of place, not just the ones in use today", () => {
    const all: GuideWhere[] = [
      { via: "menu", path: "File ▸ Save…", shortcut: "Ctrl+S" },
      { via: "menu", path: "File ▸ Save…" },
      { via: "toolbar", button: "Save" },
      { via: "inspector", tab: "Axis", section: "Scale", row: "Log" },
      { via: "inspector", tab: "Axis", section: "Scale" },
      { via: "context", on: "a column header", item: "Insert column left" },
      { via: "figure", gesture: "double-click the title" },
      { via: "sheet", gesture: "select a block, then Ctrl+D" },
      { via: "dialog", name: "Export", control: "PNG" },
      { via: "dialog", name: "Export" },
      { via: "keys", keys: "Ctrl+K" },
    ];
    for (const w of all) expect(whereLine(w).length, `${w.via} renders as nothing`).toBeGreaterThan(3);
  });
});

describe("every command in the registry is in the index", () => {
  const ACTIONS = actionCatalogue();
  /** The generated per-format rows: documented by their format entry, not one each. */
  const generated = new Set(tableFormatList().map((f) => `new-table-${f.kind}`));

  it("reads a real registry (a walker that matches nothing proves nothing)", () => {
    expect(ACTIONS.length, "buildActions came back empty").toBeGreaterThan(80);
    expect(ACTIONS.some((a) => a.id === "save")).toBe(true);
  });

  it("every command has a description and a chapter", () => {
    const undocumented = ACTIONS.filter((a) => !generated.has(a.id) && !ACTION_DOCS[a.id]).map((a) => a.id);
    expect(
      undocumented,
      "these commands exist in actions.ts and the manual's index says nothing about them — " +
        `add a row to ACTION_DOCS: ${undocumented.join(", ")}`,
    ).toEqual([]);
  });

  it("every command's entry carries its real menu path and its shortcut", () => {
    for (const a of ACTIONS) {
      if (generated.has(a.id)) continue;
      const e = byId.get(`action:${a.id}`);
      expect(e, `no index entry for the command "${a.id}"`).toBeTruthy();
      const menu = e!.where.find((w) => w.via === "menu");
      expect(menu, `${a.id}'s entry does not say which menu it is in`).toBeTruthy();
      expect(whereLine(menu!), `${a.id}'s menu path does not name its menu`).toContain(a.menu);
      expect(whereLine(menu!), `${a.id}'s menu path does not name its label`).toContain(a.label);
      if (a.submenu) expect(whereLine(menu!), `${a.id} is nested under "${a.submenu}" and the path hides it`).toContain(a.submenu);
      if (a.shortcut) expect(whereLine(menu!), `${a.id}'s shortcut ${a.shortcut} is not on its where-line`).toContain(a.shortcut);
    }
  });

  it("ACTION_DOCS has no row for a command that does not exist", () => {
    // The invisible half: a renamed command leaves a description nobody will ever see, and
    // the index quietly loses the real one.
    const ids = new Set(ACTIONS.map((a) => a.id));
    const orphans = Object.keys(ACTION_DOCS).filter((id) => !ids.has(id));
    expect(orphans, `these ACTION_DOCS rows describe commands that are gone: ${orphans.join(", ")}`).toEqual([]);
  });

  it("no command's description just repeats its label", () => {
    for (const [id, doc] of Object.entries(ACTION_DOCS)) {
      const a = ACTIONS.find((x) => x.id === id)!;
      expect(doc.what.toLowerCase().replace(/[.…]/g, "").trim(), `${id}: the description is the label again`).not.toBe(
        a.label.toLowerCase().replace(/[.…]/g, "").trim(),
      );
    }
  });
});

describe("every toolbar button is in the index", () => {
  const IDS = Object.keys(HOME_GROUP) as ToolbarItemId[];

  it("reads the real toolbar", () => {
    expect(IDS.length).toBe(12);
  });

  it("every button has an entry naming it", () => {
    for (const id of IDS) {
      const e = byId.get(`tool:${id}`);
      expect(e, `the toolbar button "${id}" is not in the index`).toBeTruthy();
      expect(e!.where.some((w) => w.via === "toolbar"), `${id}'s entry does not put it on the toolbar`).toBe(true);
      expect(TOOLBAR_DOCS[id].name.trim(), `${id} has no reader-facing name`).not.toBe("");
    }
  });
});

describe("every table format is in the index", () => {
  it("has an entry per format, reachable from all three of its doors", () => {
    for (const f of tableFormatList()) {
      const e = byId.get(`format:${f.kind}`);
      expect(e, `the "${f.label}" table format is not in the index`).toBeTruthy();
      expect(e!.name, `${f.kind}'s entry does not use the app's own label`).toContain(f.label);
      const vias = new Set(e!.where.map((w) => w.via));
      expect(vias.has("menu"), `${f.kind}: no menu route`).toBe(true);
      expect(vias.has("dialog"), `${f.kind}: no route through the creator`).toBe(true);
      expect(vias.has("sheet"), `${f.kind}: no route through the format chip`).toBe(true);
    }
  });
});

describe("every analysis method is in the index", () => {
  const METHODS = METHOD_GROUPS.flatMap((g) => g.methods);

  it("reads the real method list", () => {
    expect(METHODS.length).toBeGreaterThan(40);
  });

  it("every method has an entry, named the way the Analyze dialog names it", () => {
    for (const m of METHODS) {
      const e = byId.get(`method:${m}`);
      expect(e, `the analysis "${m}" is not in the index — it has no METHOD_INFO entry`).toBeTruthy();
      // The id is not a name. "ttest" in the index would fail a reader searching "t test".
      expect(e!.name, `the analysis "${m}" is indexed under its identifier, not its label`).not.toBe(m);
      expect(e!.where.some((w) => w.via === "dialog"), `${m} is not reachable from a dialog`).toBe(true);
    }
  });
});

describe("every chart type is in the index", () => {
  const CARDS = galleryItems();

  it("reads the real gallery", () => {
    expect(CARDS.length).toBeGreaterThan(40);
  });

  it("every gallery card has an entry with its title and its when-to-use note", () => {
    for (const c of CARDS) {
      const e = byId.get(`chart:${c.key}`);
      expect(e, `the "${c.title}" chart card is not in the index`).toBeTruthy();
      expect(e!.name).toBe(c.title);
      expect(e!.what).toBe(c.note);
      expect(entryText(e!.id), `${c.key}'s entry does not carry its chart kind as a search term`).toContain(
        (c.plot.kind ?? "xy").toLowerCase(),
      );
    }
  });
});

describe("every transform group is in the index", () => {
  it("has an entry per group, and every one of the 52 functions is findable in it", () => {
    const groups = [...new Set(TRANSFORMS.map((t) => t.group))];
    expect(groups.length).toBeGreaterThan(5);
    for (const g of groups) {
      const e = INDEX.find((x) => x.id.startsWith("transform:") && x.name.startsWith(g));
      expect(e, `the "${g}" transform group is not in the index`).toBeTruthy();
    }
    // Default-deny the other way: a new transform must land in some group's keyword list, or
    // nobody searching for it finds anything.
    const all = INDEX.filter((x) => x.id.startsWith("transform:")).flatMap((x) => x.keywords ?? []);
    const missing = TRANSFORMS.filter((t) => !all.includes(t.label)).map((t) => t.label);
    expect(missing, `these transforms are in no group's index entry: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("every export format is in the index", () => {
  it("has an entry per format, named as the dropdown names it", () => {
    for (const f of [...PLOT_EXPORT_FORMATS, ...TABLE_EXPORT_FORMATS]) {
      const e = byId.get(`export:${f}`);
      expect(e, `the "${f}" export format is not in the index`).toBeTruthy();
      expect(e!.name).toBe(EXPORT_FORMAT_LABEL[f]);
    }
  });
});

describe("every file type the app can open is findable", () => {
  /**
   * The extensions live in the main process (`main/index.ts`), which the renderer cannot
   * import — so this reads them from the source. A user with a `.ods` file searches "ods";
   * if no entry carries the word, the manual has nothing to say to them.
   */
  const extensions = (): string[] => {
    const src = read("../../../main/index.ts");
    const lists = ["TEXT_EXTENSIONS", "EXCEL_EXTENSIONS", "LEGACY_SHEET_EXTENSIONS", "PZFX_EXTENSIONS"];
    const out: string[] = [];
    for (const name of lists) {
      const m = src.match(new RegExp(`const ${name} = \\[([^\\]]*)\\]`));
      if (!m) throw new Error(`${name} not found in main/index.ts — update this walker, do not delete it`);
      out.push(...[...m[1]!.matchAll(/"([a-z0-9]+)"/g)].map((x) => x[1]!));
    }
    return out;
  };

  it("reads the real list", () => {
    const ext = extensions();
    expect(ext.length).toBeGreaterThan(10);
    expect(ext).toContain("csv");
    expect(ext).toContain("pzfx");
  });

  it("every importable extension is a search term on the import entry", () => {
    const text = entryText("action:import");
    const missing = extensions().filter((x) => !text.includes(x));
    expect(
      missing,
      `MadY can import these file types but nothing in the index mentions them: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

/**
 * The DOM handles the index aims at.
 *
 * A route in the index is a promise about the running program. Two of them are addressable
 * rather than descriptive — the toolbar button and the Inspector section — because the
 * call-out capture (`scripts/gen-guide-shots.mjs`) draws its numbered boxes at whatever these
 * selectors resolve to, and an unresolved target fails that run rather than shipping a picture
 * with a box over nothing.
 *
 * Reading the source, not a render: mounting the Inspector needs a scene, a plot and a
 * selection, and this is a claim about the markup, not about any one graph.
 */
describe("the handles a call-out can point at", () => {
  it("every toolbar button carries its own id on the element", () => {
    const chrome = read("./chrome.tsx");
    expect(chrome, "toolbar buttons do not carry data-tool — the capture cannot aim at them").toMatch(
      /data-tool=\{id\}/,
    );
  });

  it("every Inspector section carries a DOM id derived from its title", () => {
    const inspector = read("./Inspector.tsx");
    expect(inspector, "Inspector sections lost their id").toMatch(/id=\{inspectorSectionId\(title\)\}/);
    // The slug is shared with the persisted open/closed state, so the two cannot disagree.
    // Note: the title reaching `Section` is the decoded one: `<Section title="Title &amp; legend">`
    // hands React "Title & legend", because JSX resolves entities in attribute values. The
    // slug is therefore computed from the ampersand, never from the entity.
    expect(inspectorSectionId("Title & legend")).toBe("insp-title-legend");
    expect(inspectorSectionId("Grid, frame & axes")).toBe("insp-grid-frame-axes");
    expect(inspectorSectionId("Survival (Kaplan-Meier)")).toBe("insp-survival-kaplan-meier-");
  });

  it("the manual is on F1", () => {
    const guide = actionCatalogue().find((a) => a.id === "guide")!;
    expect(guide.shortcut, "Help ▸ Documentation has no shortcut").toBe("F1");
    expect(guide.combo, "F1 is shown but not matched — the key would do nothing").toBe("f1");
  });
});

/**
 * The Inspector is indexed per section.
 *
 * Without this the manual has no way to point at the Inspector: hundreds of control rows behind
 * its tabs and collapsible headings, none of them otherwise named where a search can reach.
 * The rule is one entry per section, with the rows named in the chapter's prose.
 *
 * Default-deny from the source, in both directions — a section added to the JSX and not to the
 * list is a control the manual cannot point at, and a list entry for a section that is gone
 * sends a reader to a heading that does not exist.
 */
describe("every Inspector section is in the index", () => {
  const INSPECTOR = stripComments(read("./Inspector.tsx"));
  /** Every `<Section title>` in the graph panel, entities decoded the way JSX decodes them. */
  const sectionTitles = (): string[] => [
    ...new Set([...INSPECTOR.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"))),
  ];
  /** Every `<SubSection title="…">` inside the axis editor — the Axis tab has no Sections. */
  const axisGroups = (): string[] => {
    const at = INSPECTOR.indexOf("function AxisPanel");
    expect(at, "AxisPanel is gone — update this walker, do not delete it").toBeGreaterThan(-1);
    // `title` wherever it sits among the attributes: a `key` ahead of it (Numbering and Fonts re-mount open when their
    // text is clicked) would otherwise hide the group from this walker.
    return [...new Set([...INSPECTOR.slice(at).matchAll(/<SubSection\b(?:\s+(?!title=)[a-zA-Z]+=(?:"[^"]*"|\{[^{}]*\}))*\s+title="([^"]+)"/g)].map((m) => m[1]!))];
  };

  it("reads real headings out of Inspector.tsx (a walker that matches nothing proves nothing)", () => {
    expect(sectionTitles().length, "no <Section> titles found").toBeGreaterThan(25);
    expect(sectionTitles()).toContain("Chart type");
    expect(axisGroups().length, "no axis groups found").toBeGreaterThan(8);
    expect(axisGroups()).toContain("Range");
  });

  it("the hand-kept lists match the headings the app actually renders", () => {
    const inJsx = sectionTitles().sort();
    const listed = [...INSPECTOR_SECTIONS].sort();
    expect(listed, "INSPECTOR_SECTIONS and the <Section> titles in Inspector.tsx disagree").toEqual(inJsx);
    const axisInJsx = axisGroups().sort();
    const axisListed = [...AXIS_GROUPS].sort();
    expect(axisListed, "AXIS_GROUPS and the axis editor's <SubSection> titles disagree").toEqual(axisInJsx);
  });

  it("every section has a description, and an entry that names its tab", () => {
    const undocumented = INSPECTOR_SECTIONS.filter((t) => !INSPECTOR_DOCS[t]);
    expect(undocumented, `these Inspector sections say nothing in the index: ${undocumented.join(", ")}`).toEqual([]);
    for (const title of INSPECTOR_SECTIONS) {
      const e = INDEX.find((x) => x.name === title && x.id.startsWith("insp:"));
      expect(e, `no index entry for the Inspector section "${title}"`).toBeTruthy();
      const w = e!.where.find((x) => x.via === "inspector");
      expect(w, `${title}'s entry does not put it in the Inspector`).toBeTruthy();
      // The tab must be the one the app itself would open — `tabForSection` is that routing.
      const expected = INSPECTOR_TABS.find((t) => t.id === tabForSection(title))!.label;
      expect((w as { tab: string }).tab, `the index sends "${title}" to the wrong tab`).toBe(expected);
    }
  });

  it("every group in the Axis tab has a description and an entry", () => {
    const undocumented = AXIS_GROUPS.filter((t) => !AXIS_DOCS[t]);
    expect(undocumented, `these Axis groups say nothing in the index: ${undocumented.join(", ")}`).toEqual([]);
    for (const title of AXIS_GROUPS) {
      const e = INDEX.find((x) => x.id === `axis:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}`);
      expect(e, `no index entry for the Axis group "${title}"`).toBeTruthy();
      expect(e!.where.some((w) => w.via === "inspector" && w.tab === "Axis"), `${title} is not on the Axis tab`).toBe(true);
    }
  });

  it("every rail tab is in the index, named as the reader sees it", () => {
    for (const t of INSPECTOR_TABS) {
      const e = byId.get(`insptab:${t.id}`);
      expect(e, `the Inspector's "${t.label}" tab is not in the index`).toBeTruthy();
      expect(e!.what, `${t.label}'s description is not the hint the user is shown`).toBe(t.hint);
    }
  });

  it("no description is written for a heading that does not exist", () => {
    const sections = new Set(INSPECTOR_SECTIONS);
    const orphans = Object.keys(INSPECTOR_DOCS).filter((t) => !sections.has(t));
    expect(orphans, `these describe Inspector sections that do not exist: ${orphans.join(", ")}`).toEqual([]);
    const groups = new Set(AXIS_GROUPS);
    const axisOrphans = Object.keys(AXIS_DOCS).filter((t) => !groups.has(t));
    expect(axisOrphans, `these describe Axis groups that do not exist: ${axisOrphans.join(", ")}`).toEqual([]);
  });
});

/**
 * The hand-written entries — the gestures and ribbon controls no registry holds.
 *
 * These are the ones a user is least likely to find on their own (nothing in a menu tells you
 * that a printable keystroke starts editing a cell), and no registry checks them. So each one is
 * held to a string the program actually contains, in the source that implements it.
 *
 * Two absent features are checked explicitly: the manual must never claim a find/replace
 * keystroke in the datasheet grid (Find & replace is a Data-menu command) or middle-button
 * zoom. Neither exists.
 */
describe("the hand-written entries describe the program that exists", () => {
  const grid = read("./DataGrid.tsx");
  const panes = read("./panes.tsx");
  const figure = read("./PlotFigure.tsx");

  /** Every entry that is not derived from a registry. */
  const hand = INDEX.filter((e) => /^(sheet|figure|ribbon|figurebar|dialog):/.test(e.id));

  it("there are hand-written entries at all", () => {
    expect(hand.length).toBeGreaterThan(25);
  });

  /**
   * Each row: the entry, and a string that must appear in the source that implements it. A
   * control that is renamed or removed breaks this before the manual can describe a ghost.
   */
  const ANCHORS: Array<{ id: string; src: string; needle: string }> = [
    { id: "sheet:type-to-edit", src: grid, needle: "setEditSeed(k)" },
    { id: "sheet:fill-down", src: grid, needle: "onFillDown" },
    { id: "sheet:transpose-block", src: grid, needle: "onTranspose" },
    { id: "sheet:paste-transposed", src: grid, needle: "Paste transposed" },
    { id: "sheet:insert-column", src: grid, needle: "Insert column left" },
    { id: "sheet:insert-row", src: grid, needle: "Insert row above" },
    { id: "sheet:column-type", src: grid, needle: "onSetColumnType" },
    { id: "sheet:column-formula", src: grid, needle: "Column formula" },
    { id: "sheet:x-column", src: grid, needle: "Use as X axis" },
    { id: "sheet:format-chip", src: panes, needle: 'aria-label="Table format"' },
    { id: "sheet:add-column", src: panes, needle: "Add a column to this table" },
    { id: "sheet:entry-mode", src: panes, needle: 'aria-label="Data entry mode"' },
    { id: "sheet:replicates", src: panes, needle: 'aria-label="More replicates"' },
    { id: "sheet:x-error", src: panes, needle: "X-error subcolumn" },
    { id: "sheet:survival-dates", src: panes, needle: 'aria-label="Survival time entry"' },
    { id: "sheet:freeze", src: panes, needle: "make it read-only" },
    { id: "sheet:linked-file", src: panes, needle: "Re-read the linked file now" },
    { id: "figure:select-axis", src: read("./Inspector.tsx"), needle: 'selection?.kind === "axis" ? "axis"' },
    { id: "figure:nudge", src: figure, needle: "nudgePatch" },
    { id: "figure:delete-annotation", src: figure, needle: "onDuplicateAnnotation" },
    { id: "figure:axis-length", src: figure, needle: "axis-length drag" },
    { id: "ribbon:reset-view", src: panes, needle: "Reset view" },
    { id: "ribbon:grid", src: panes, needle: "Wheel zoom" },
    { id: "ribbon:legend", src: panes, needle: "ops.onSetLegend({ show:" },
    { id: "ribbon:log", src: panes, needle: "Log10 scale on the X axis" },
    { id: "ribbon:values", src: panes, needle: "Show each bar's value as a label" },
    { id: "ribbon:points", src: panes, needle: "Show every replicate as a dot" },
    { id: "ribbon:frame", src: panes, needle: "L-shape" },
    { id: "ribbon:insert", src: panes, needle: "Insert an image (PNG / JPG / SVG)" },
    { id: "ribbon:text", src: panes, needle: "Greek letter or maths symbol" },
    { id: "ribbon:datasheet", src: panes, needle: "<Table2 size={13} /> Datasheet" },
    { id: "figurebar:columns", src: panes, needle: "How many columns to tile the panels into" },
    { id: "figurebar:align", src: panes, needle: "Align horizontal centres" },
    { id: "figurebar:arrange", src: panes, needle: "Dissolve the group" },
    { id: "figurebar:free-drag", src: panes, needle: "Free drag" },
    { id: "figurebar:layout", src: panes, needle: "Pick a figure layout" },
    { id: "figurebar:shared-axes", src: panes, needle: "Shared axes: label only" },
    { id: "figurebar:one-legend", src: panes, needle: "One legend for the whole figure" },
    { id: "figurebar:guides", src: panes, needle: "Show an alignment grid behind the panels" },
    { id: "figurebar:labels", src: panes, needle: "Panel-label scheme" },
    { id: "figurebar:panels", src: panes, needle: "Keep proportions" },
    { id: "figurebar:insert", src: panes, needle: "Text box on the figure canvas" },
    { id: "figurebar:object", src: panes, needle: "Object colour (line / text)" },
    { id: "figurebar:lock", src: panes, needle: "Lock the selected panel(s) in place" },
    { id: "figurebar:preset", src: panes, needle: "Restyle every graph in this figure" },
    { id: "figurebar:house", src: panes, needle: "Save this figure's arrangement" },
    { id: "figurebar:match", src: panes, needle: "Choose which panel the others copy from" },
    { id: "figurebar:linked", src: panes, needle: "Independent copy" },
    // Dialogs. Each one is a whole surface, so the anchor is the sentence the dialog itself
    // prints — rename it and the manual's description of it stops being true.
    { id: "dialog:save-parts", src: read("./SaveDialog.tsx"), needle: "untick to save just one project folder" },
    { id: "dialog:recovery", src: read("./RecoveryDialog.tsx"), needle: "Recover unsaved work?" },
    { id: "dialog:export-size", src: read("./ExportDialog.tsx"), needle: "Size the figure to a physical width for print" },
    { id: "dialog:settings-newgraph", src: read("./SettingsDialog.tsx"), needle: "New-graph defaults" },
    { id: "dialog:settings-analysis", src: read("./SettingsDialog.tsx"), needle: "Analysis defaults" },
    { id: "dialog:settings-app", src: read("./SettingsDialog.tsx"), needle: "Fit graphs to the window at startup" },
  ];

  it("every anchored entry exists, and the control it describes is still in the source", () => {
    for (const a of ANCHORS) {
      expect(byId.get(a.id), `the index has no entry "${a.id}"`).toBeTruthy();
      expect(
        a.src.includes(a.needle),
        `the manual describes "${a.id}" but the source does not contain ${JSON.stringify(a.needle)} — ` +
          "the control was renamed or removed, so the entry describes a control that is not there",
      ).toBe(true);
    }
  });

  it("every hand-written entry is anchored to something", () => {
    // Default-deny: adding a gesture to the index without proving it exists is exactly how a
    // manual comes to describe software that does not.
    const anchored = new Set(ANCHORS.map((a) => a.id));
    // These describe a gesture rather than a named control, and the key-table gate in
    // `guide.test.ts` already holds their handlers — anchoring them twice would only duplicate it.
    const byKeys = new Set(["sheet:select", "sheet:cell-colour", "figure:select", "figure:edit-text", "figure:drag", "figure:resize", "figure:zoom"]);
    const loose = hand.filter((e) => !anchored.has(e.id) && !byKeys.has(e.id)).map((e) => e.id);
    expect(loose, `these hand-written entries prove nothing about the program: ${loose.join(", ")}`).toEqual([]);
  });

  it("does not claim two things the program does not have", () => {
    // The datasheet grid has no find/replace of its own (Find & replace is the Data-menu
    // command, indexed under that name), and the middle mouse button does not zoom (wheel zoom is an opt-in tickbox; Ctrl+wheel magnifies).
    const all = INDEX.map((e) => `${e.name} ${e.what} ${(e.keywords ?? []).join(" ")}`).join(" ").toLowerCase();
    expect(all, "the index offers a find/replace in the datasheet grid, which has none (Find & replace is on the Data menu)").not.toMatch(/find and replace|find\/replace|replace all/);
    expect(all, "the index claims middle-button zoom, which does not work").not.toMatch(/middle button|middle-button|middle mouse/);
  });
});
