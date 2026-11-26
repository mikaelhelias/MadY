// @vitest-environment jsdom
/**
 * The manual's search answers "where is it".
 *
 * For example, typing "axis" must tell you where axis tuning is. That is a claim about ranking,
 * which a test can pin and a reading cannot: every one of these searches also returns something
 * under a plain substring filter.
 *
 * So the assertions are about what comes first, and about the words a reader types rather than
 * the words the program uses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GUIDE, stepTexts } from "./guide";
import { guideIndex, whereLine } from "./guideIndex";
import { searchGuide, snippetFor, terms, wordPrefix, SYNONYMS } from "./guideSearch";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const names = (q: string, n = 5): string[] => searchGuide(q).functions.slice(0, n).map((h) => h.entry.name);
const chapters = (q: string, n = 5): string[] => searchGuide(q).chapters.slice(0, n).map((h) => h.section.title);

describe("the matcher", () => {
  it("splits a query into terms and ignores extra spaces", () => {
    expect(terms("  export   PNG ")).toEqual(["export", "png"]);
    expect(terms("   ")).toEqual([]);
  });

  it("matches the start of a word, not any substring", () => {
    expect(wordPrefix("Categories and groups", "cat")).toBe(true);
    expect(wordPrefix("Duplicate datasheet", "cat"), "“cat” inside “duplicate” is noise").toBe(false);
    expect(wordPrefix("Error bar", "bar"), "a term must reach the second word too").toBe(true);
    expect(wordPrefix("Y = log₁₀(Y)", "log"), "a non-letter must count as a word boundary").toBe(true);
  });

  it("every synonym group is symmetric — either word finds the other", () => {
    // The table is only useful if it is bidirectional; a one-way entry helps whoever wrote it
    // and nobody else.
    for (const group of SYNONYMS)
      for (const word of group)
        expect(group.length, `"${word}" is in a group of one`).toBeGreaterThan(1);
  });
});

describe("“axis” answers where axis tuning is", () => {
  const res = searchGuide("axis");

  it("finds something at all", () => {
    expect(res.functions.length + res.chapters.length).toBeGreaterThan(0);
  });

  it("leads with the chapter on axes, not with the eight that mention one in passing", () => {
    expect(chapters("axis")[0]).toBe("Axes, scales and ticks");
  });

  it("every hit says where it is, in words", () => {
    // A function hit with no route gives the reader a name and nothing to do about it.
    for (const h of res.functions) expect(h.entry.where.length, `${h.entry.id} has no route`).toBeGreaterThan(0);
  });
});

describe("the reader's words find the program's", () => {
  it("“color” finds colours", () => {
    expect(chapters("color")).toContain("Colours, fills and symbols");
  });

  it("“spreadsheet” finds the datasheet chapters", () => {
    // Note: not pinned to one title. The datasheet material is spread over six chapters, and
    // the word a reader types is in none of their titles — it lives in their keywords instead.
    // What must hold is that the answers are about the datasheet.
    const hits = searchGuide("spreadsheet").chapters.slice(0, 3);
    expect(hits.length, "nothing found for “spreadsheet”").toBe(3);
    for (const h of hits)
      expect(h.section.group, `“${h.section.title}” leads the results for “spreadsheet”`).toBe("Your data");
    expect(hits.map((h) => h.section.title)).toContain("Editing cells");
  });

  it("“scale” reaches the axes, though the chapter title is “Axes, scales and ticks”", () => {
    expect(chapters("scale")[0]).toBe("Axes, scales and ticks");
  });

  it("“sem” finds the error-bar material", () => {
    const all = [...names("sem", 10), ...chapters("sem", 10)].join(" ").toLowerCase();
    expect(all).toMatch(/error|bar|colour|spread/);
  });
});

describe("functions are found by their own names", () => {
  // Timeout 20s, not the default 5s. This runs one search per index entry — about five hundred
  // of them — over a manual of more than fifty chapters, and it grows with the manual. On its own it takes
  // about 2s (≈4ms per search, which is what a user pays per keystroke); it only passes 5s when
  // the suite runs files in parallel.
  it("every entry in the index is findable by its name", () => {
    // The index is only worth building if searching for a thing returns that thing. This is the
    // default-deny half: an entry whose name tokenises to nothing (or collides so badly it
    // falls off the list) is an entry nobody will ever reach.
    const missed: string[] = [];
    for (const e of guideIndex()) {
      const hits = searchGuide(e.name).functions;
      if (!hits.some((h) => h.entry.id === e.id)) missed.push(`${e.id} ("${e.name}")`);
    }
    expect(missed, `these index entries cannot be found by searching their own name: ${missed.join(", ")}`).toEqual([]);
  }, 20000);

  it("a command is found by its menu label", () => {
    expect(names("sort rows")).toContain("Sort rows by column");
    expect(names("transpose")).toContain("Transpose rows and columns");
  });

  it("a command is found by a word only its keywords carry", () => {
    // "EC50" appears in no label anywhere; the whole point of keywords is that it still lands.
    expect(names("ec50", 10).join(" ").toLowerCase()).toContain("dose-response");
    expect(names("ods", 10).join(" ").toLowerCase()).toContain("import data");
  });
});

describe("all the terms must match, in any order", () => {
  it("“export png” finds the PNG format and not every export", () => {
    const hits = names("export png", 10);
    expect(hits.join(" ")).toContain("PNG");
  });

  it("word order does not matter", () => {
    expect(names("png export", 10)).toEqual(names("export png", 10));
  });

  it("a term that matches nothing empties the result, rather than being ignored", () => {
    // The failure this guards: an OR search that quietly drops the term the reader added to
    // narrow things down, and hands back the same long list.
    const wide = searchGuide("export");
    const narrow = searchGuide("export zzzzqqq");
    expect(wide.functions.length).toBeGreaterThan(0);
    expect(narrow.functions.length).toBe(0);
    expect(narrow.chapters.length).toBe(0);
  });
});

describe("ranking", () => {
  it("a hit on a name outranks a hit in a paragraph", () => {
    const res = searchGuide("gallery");
    const top = res.functions[0];
    expect(top, "nothing found for “gallery”").toBeTruthy();
    expect(top!.entry.name.toLowerCase()).toContain("gallery");
  });

  it("a chapter whose title matches outranks one that merely mentions the word", () => {
    const res = searchGuide("export");
    expect(res.chapters.length, 'nothing found for “export”').toBeGreaterThan(1);
    expect(res.chapters[0]!.section.title).toBe("Export and sharing");
  });

  it("scores are positive and sorted", () => {
    const res = searchGuide("colour");
    for (let i = 1; i < res.functions.length; i++)
      expect(res.functions[i - 1]!.score).toBeGreaterThanOrEqual(res.functions[i]!.score);
    for (let i = 1; i < res.chapters.length; i++)
      expect(res.chapters[i - 1]!.score).toBeGreaterThanOrEqual(res.chapters[i]!.score);
  });
});

describe("the empty query", () => {
  it("returns nothing, so the caller shows the contents list instead", () => {
    for (const q of ["", "   "]) {
      const res = searchGuide(q);
      expect(res.functions).toEqual([]);
      expect(res.chapters).toEqual([]);
    }
  });
});

describe("snippets", () => {
  it("quotes a sentence the query actually matched", () => {
    const section = GUIDE.find((s) => s.id === "export")!;
    const snip = snippetFor(section, ["export"]);
    expect(snip.length).toBeGreaterThan(10);
    expect(snip.toLowerCase()).toContain("export");
  });

  it("is empty rather than misleading when nothing in the body matched", () => {
    const section = GUIDE.find((s) => s.id === "export")!;
    expect(snippetFor(section, ["zzzzqqq"])).toBe("");
  });
});

/**
 * Searching for where a control is, with the Inspector in the index.
 *
 * A search for "axis" must say where axis tuning is. Without the Inspector's sections and the Axis
 * tab's groups in the index, "axis" leads with chart types that merely mention an axis in their
 * one-line note — a list of things you cannot press. These pin the answers, not the wording.
 */
describe("where is the control for…", () => {
  /** The top function hits, with the route each one gives. */
  const top = (q: string, n = 6): { name: string; where: string }[] =>
    searchGuide(q)
      .functions.slice(0, n)
      .map((h) => ({ name: h.entry.name, where: whereLine(h.entry.where[0]!) }));

  it("“axis” leads with controls that are in the Inspector's Axis tab", () => {
    const hits = top("axis", 4);
    expect(hits.length, "nothing found for “axis”").toBeGreaterThan(2);
    for (const h of hits)
      expect(h.where, `“${h.name}” leads the results for “axis” and is not an axis control`).toMatch(/Inspector ▸ Axis/);
  });

  it("“gridlines” leads with the controls that draw them, not with the ones that share a synonym", () => {
    // The bidirectional prefix: the reader's plural has to reach the singular in the heading.
    // Note: deliberately not pinned to one entry. Gridlines have two valid homes — the tickbox in
    // the graph toolbar and the Inspector section — and which of the two leads is a tie either
    // way round. What must not happen (and the direct-hit rule prevents) is Scale, Range and
    // Ticks, reached only through a shared synonym group, sitting above both of them.
    // The two direct hits lead; the synonym hits (Scale, Range, Ticks) come after them.
    const hits = top("gridlines", 2);
    for (const h of hits)
      expect(h.name, `“${h.name}” leads the results for “gridlines” and is not about gridlines`).toMatch(/^Grid/);
    expect(hits.map((h) => h.name)).toContain("Grid, frame & axes");
  });

  it("“font size” finds a place fonts are actually set, though no section is called that", () => {
    // Again two valid homes: the Text tab of the Inspector, and the Text group of the graph
    // toolbar. Either may lead; a chart type must not.
    const first = top("font size")[0]!;
    expect(first.name.toLowerCase(), `“${first.name}” leads the results for “font size”`).toMatch(/text|font/);
    expect(first.where, `“${first.name}” gives no route to a font control`).toMatch(/Inspector ▸ Text|Toolbar ▸ Text/);
  });

  it("the specific questions land on the specific control", () => {
    expect(top("second y axis")[0]!.name).toBe("Series on this axis");
    // "Label rotation" is the control itself, a better answer to "rotate labels" than the
    // "Category labels" group that contains it. The rule: a specific question must not land on
    // a chapter or a whole tab.
    expect(top("rotate labels")[0]!.name).toBe("Label rotation");
    expect(top("log scale")[0]!.name).toBe("Scale");
    expect(top("transparent background")[0]!.name).toBe("Background");
    expect(top("axis break")[0]!.name).toBe("Breaks (cuts)");
  });

  it("every Inspector hit says which tab and which section to open", () => {
    // A route that stops at "Inspector" has not answered the question.
    for (const h of searchGuide("colour").functions)
      for (const w of h.entry.where)
        if (w.via === "inspector") {
          expect(w.tab.length, `${h.entry.id}: no tab`).toBeGreaterThan(2);
          expect(w.section.length, `${h.entry.id}: no section`).toBeGreaterThan(2);
        }
  });
});

describe("a direct hit beats a synonym", () => {
  it("scores the word as typed above a word it was expanded to", () => {
    // Without this, five entries reached by synonym tie with the one that actually says the
    // word, and the tie falls to whichever name is shortest.
    const grid = searchGuide("gridlines").functions;
    const owner = grid.find((h) => h.entry.name === "Grid, frame & axes")!;
    const viaSynonym = grid.find((h) => h.entry.name === "Scale")!;
    expect(owner.score).toBeGreaterThan(viaSynonym.score);
  });

  it("matches a word in the text that starts the term, not only the other way round", () => {
    expect(wordPrefix("Grid, frame & axes", "gridlines"), "the reader's plural must reach the singular").toBe(true);
    expect(wordPrefix("Tick marks", "ticks")).toBe(true);
    // …but not from a short word: three letters would let "bar" claim "barometric".
    expect(wordPrefix("Bar chart", "barometric"), "a three-letter word must not claim every long word").toBe(false);
  });
});

/**
 * The datasheet questions.
 *
 * The datasheet material is split into one chapter per job, which only helps if each job is
 * findable on its own. These are the questions a reader arrives with, and the chapter each one
 * should land in.
 */
describe("the datasheet questions land in the right chapter", () => {
  const chapter = (q: string): string => searchGuide(q).chapters[0]?.section.title ?? "(nothing)";

  it("each job has its own answer, not one chapter for all six", () => {
    expect(chapter("outlier")).toBe("Excluding values");
    expect(chapter("fill down")).toBe("Selecting, copying and pasting");
    expect(chapter("highlight a cell")).toBe("Colouring cells");
    expect(chapter("insert a column")).toBe("Rows and columns");
    expect(chapter("freeze the table")).toBe("Sorting, freezing and printing");
    expect(chapter("new datasheet")).toBe("Making a new datasheet");
  });

  it("the six of them really are six different chapters", () => {
    // If two questions answer with one title, the chapters are not split where the reader
    // needs them.
    const titles = ["outlier", "fill down", "highlight a cell", "insert a column", "freeze the table"].map(chapter);
    expect(new Set(titles).size, `the datasheet questions collapse onto: ${titles.join(", ")}`).toBe(titles.length);
  });

  it("the import options are findable by the words the file uses", () => {
    // These are the settings someone hunts for when a file comes in wrong, and every one of them
    // is a word from the file rather than from MadY.
    for (const q of ["delimiter", "semicolon", "decimal comma", "thousands separator", "units row", "skip rows"])
      expect(
        [chapter(q), searchGuide(q).functions[0]?.entry.name ?? ""].join(" "),
        `“${q}” does not lead to the import material`,
      ).toMatch(/Getting data in|Import/i);
  });
});

/**
 * The styling questions.
 *
 * Selecting, dragging, resizing, zooming, text and the legend each have their own chapter; the
 * legend is one of the things readers look up most. Same test as for the datasheet chapters:
 * each job must be findable on its own.
 */
describe("the styling questions land in the right chapter", () => {
  const chapter = (q: string): string => searchGuide(q).chapters[0]?.section.title ?? "(nothing)";
  const fn = (q: string): string => searchGuide(q).functions[0]?.entry.name ?? "(nothing)";

  it("the legend has somewhere to send people", () => {
    expect(chapter("legend position")).toBe("The legend");
    expect(chapter("outside top")).toBe("The legend");
    // …and the control it names really is where it says.
    expect(fn("legend position")).toBe("Title & legend");
  });

  it("moving and zooming are their own chapter, not buried in styling", () => {
    expect(chapter("move the title")).toBe("Moving, resizing and zooming");
    expect(chapter("wheel zoom")).toBe("Moving, resizing and zooming");
  });

  it("the axis, text and annotation questions still land where they should", () => {
    expect(chapter("second y axis")).toBe("Axes, scales and ticks");
    expect(chapter("font")).toBe("Text, fonts and labels");
    expect(chapter("reference line")).toBe("Annotations and reference lines");
  });

  it("every control on the graph toolbar is named in the manual", () => {
    // Default-deny against the source: every toolbar control must be named in the chapter.
    // Each entry is a string the ribbon really renders.
    const panes = read("./panes.tsx");
    const CONTROLS: Array<{ shown: string; inCode: string }> = [
      { shown: "Grid", inCode: "/> Grid</label>" },
      { shown: "Minor", inCode: "/> Minor</label>" },
      { shown: "Wheel zoom", inCode: "wheelZoom.set(e.target.checked)" },
      { shown: "Ruler", inCode: "Show a measuring ruler around this graph" },
      { shown: "Legend", inCode: "/> Legend</label>" },
      { shown: "Summary", inCode: 'aria-label="Summary"' },
      { shown: "X log", inCode: "Log10 scale on the X axis" },
      { shown: "Values", inCode: "Show each bar's value as a label" },
      { shown: "Points", inCode: "Show every replicate as a dot" },
      { shown: "Frame", inCode: 'aria-label="Frame"' },
      { shown: "Insert", inCode: 'aria-label="Insert"' },
      { shown: "Caption", inCode: "onCaption" },
      { shown: "Datasheet", inCode: "<Table2 size={13} /> Datasheet" },
      { shown: "Export", inCode: 'className="grbbtn grbexport"' },
      { shown: "Reset view", inCode: "Reset view" },
    ];
    const ribbon = GUIDE.find((s) => s.id === "ribbon")!;
    // A reference table is prose the reader reads, so it counts. Without the table case, a
    // control listed in a two-column table row (Grid, Minor, Ruler, Legend, Frame, Caption,
    // Datasheet, Reset view) would be reported as never mentioned while its row sits on the
    // page. The table is read here rather than forbidden.
    const prose = [ribbon.summary, ...ribbon.blocks.flatMap((b) =>
      b.kind === "p" || b.kind === "note"
        ? [b.text]
        : b.kind === "ul"
          ? b.items
          : b.kind === "steps"
            ? stepTexts(b)
            : b.kind === "table"
              ? [...b.head, ...b.rows.flat()]
              : b.kind === "h" || b.kind === "goal"
                ? [b.text]
                : [],
    )].join(" ");
    const missing: string[] = [];
    for (const c of CONTROLS) {
      expect(
        panes.includes(c.inCode),
        `the walker does not find "${c.shown}" in the ribbon — update this row, do not delete it`,
      ).toBe(true);
      if (!prose.includes(c.shown)) missing.push(c.shown);
    }
    expect(missing, `these are on the graph toolbar and the chapter never mentions them: ${missing.join(", ")}`).toEqual([]);
  });
});

/**
 * The questions the Statistics, Finishing and Reference chapters must answer.
 *
 * Same rule as the block above: a chapter only helps if the question a reader actually types
 * lands on it. These are the questions those chapters exist for.
 */
describe("the statistics and figure questions land in the right place", () => {
  const chapters = (q: string, n = 3): string[] => searchGuide(q).chapters.slice(0, n).map((h) => h.section.title);
  const fn = (q: string): string => searchGuide(q).functions[0]?.entry.name ?? "(nothing)";
  const fns = (q: string, n = 2): string[] => searchGuide(q).functions.slice(0, n).map((h) => h.entry.name);

  it("the save-and-recover questions reach the chapter that answers them", () => {
    expect(fn("autosave")).toBe("Recover unsaved work");
    // Note: not pinned to one chapter. "autosave" ties three ways at the chapter level, because
    // Settings holds the switch, Saving explains it, and "Getting data in" carries the keyword
    // "auto-update" for linked files — which the bidirectional word-prefix reaches from "auto".
    // What must hold is that the chapter that explains it is among them.
    expect(chapters("autosave")).toContain("Saving and opening projects");
    expect(chapters("recover unsaved work")[0]).toBe("Saving and opening projects");
    expect(fn("save one graph")).toBe("Save part of a project");
  });

  it("a Settings row is found by the words on it, not by the word “settings”", () => {
    // Note: "date format" is an exact tie, and correctly so: a column's own date format is set
    // on the column, and how a typed date is read is set in Settings. Both must lead; pinning
    // either one would be pinning a coin toss.
    expect(fns("date format").sort()).toEqual(["Column type and decimals", "Settings ▸ New-graph defaults"]);
    expect(fn("date entry format")).toBe("Settings ▸ New-graph defaults");
    // The rest are not ties — these rows exist nowhere else.
    expect(fn("missing values")).toBe("Settings ▸ New-graph defaults");
    expect(fn("round results")).toBe("Settings ▸ Analysis defaults");
    // "dark mode" leads with the command that toggles it (View ▸ Toggle light/dark), which is
    // the better answer — the Settings row is second, and that is the right order.
    expect(fns("dark mode")).toEqual(["Toggle light/dark", "Settings ▸ Application"]);
  });

  it("“which test” and the result questions reach the Statistics chapters", () => {
    // Another valid tie: "which test should I use" is answered by the chooser and by the list.
    expect(["Choosing an analysis", "The statistics on offer"]).toContain(chapters("which test")[0]);
    expect(chapters("methods text")[0]).toBe("Reading a result");
  });

  it("the assembler's own controls are findable by name", () => {
    expect(fn("shared axes")).toBe("Shared axes");
    expect(fn("keep proportions")).toBe("Graph titles, Card titles, Keep proportions");
    expect(fn("lock panel")).toBe("Lock a panel");
  });

  it("“dpi” reaches the export size controls", () => {
    expect(fn("dpi")).toBe("Export size (DPI, journal width, pixels)");
  });
});
