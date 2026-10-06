// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tableFormatList } from "@mady/core";
import { GUIDE, GUIDE_GROUPS, type GuideSection, stepTexts } from "./guide";

/**
 * Guards for the program's own documentation.
 *
 * Documentation rots differently from code: nothing breaks, it just quietly stops describing
 * the program. The check that earns its place here is coverage — every top-level menu the app
 * offers must be mentioned, so adding a menu without documenting it fails the build rather
 * than shipping a manual with a hole in it.
 */
const ACTIONS_SRC = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");

/** The MenuName union, read from the source so it cannot drift out of sync with this test. */
function menuNames(): string[] {
  const m = ACTIONS_SRC.match(/export type MenuName =([^;]+);/);
  if (!m) throw new Error("MenuName union not found — the walker needs updating, not deleting");
  return [...m[1]!.matchAll(/"([A-Za-z]+)"/g)].map((x) => x[1]!);
}

const bodyText = (s: GuideSection): string =>
  s.blocks
    .flatMap((b) =>
      b.kind === "p" || b.kind === "note" || b.kind === "goal" || b.kind === "h"
        ? [b.text]
        : b.kind === "ul"
          ? b.items
          : b.kind === "steps"
            ? stepTexts(b)
            : // A reference table is prose the reader reads; leaving it out would report a
              // control as undocumented while its row sat on the page.
              b.kind === "table"
              ? [...b.head, ...b.rows.flat()]
                : // "cite" is rendered from the running version, so it has no text here.
                  b.kind === "keys"
                  ? b.rows.map((r) => `${r.keys} ${r.what}`)
                  : [],
    )
    .join(" ");

const ALL_TEXT = GUIDE.map((s) => `${s.title} ${s.summary} ${bodyText(s)}`).join("\n");

describe("the documentation is structurally sound", () => {
  it("has sections, each with a title, a summary and real content", () => {
    expect(GUIDE.length).toBeGreaterThan(5);
    for (const s of GUIDE) {
      expect(s.title.trim(), `section ${s.id} has no title`).not.toBe("");
      expect(s.summary.trim(), `section ${s.id} has no summary`).not.toBe("");
      expect(s.blocks.length, `section ${s.id} has no content`).toBeGreaterThan(0);
      expect(bodyText(s).length, `section ${s.id} is a stub`).toBeGreaterThan(120);
    }
  });

  it("section ids are unique and usable as anchors", () => {
    const ids = GUIDE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("every section is filed under a real group, and every group has sections", () => {
    // A group with nothing in it renders an empty heading in the contents list; a section
    // filed under a name that is not a group vanishes from the contents list entirely
    // while still rendering on the page. Both are silent, so both are pinned.
    for (const s of GUIDE)
      expect(GUIDE_GROUPS as readonly string[], `section ${s.id} is filed under "${s.group}"`).toContain(s.group);
    for (const g of GUIDE_GROUPS)
      expect(GUIDE.some((s) => s.group === g), `no section is filed under "${g}"`).toBe(true);
  });

  it("sections run in group order, with each group contiguous", () => {
    // The contents list is rendered group by group; the page is rendered in array order.
    // If a section is filed out of order the two disagree — the reader clicks the last
    // link of "Your data" and lands in the middle of the statistics. Non-decreasing group
    // index is exactly the property that keeps them in step.
    const order = GUIDE.map((s) => GUIDE_GROUPS.indexOf(s.group));
    for (let i = 1; i < order.length; i++)
      expect(
        order[i]! >= order[i - 1]!,
        `“${GUIDE[i]!.title}” (${GUIDE[i]!.group}) comes after “${GUIDE[i - 1]!.title}” (${GUIDE[i - 1]!.group}), ` +
          `but its group is listed earlier — move the section, or re-order GUIDE_GROUPS`,
      ).toBe(true);
  });

  it("no list or step is left empty", () => {
    for (const s of GUIDE)
      for (const b of s.blocks) {
        if (b.kind === "ul" || b.kind === "steps") {
          const items = b.kind === "ul" ? b.items : stepTexts(b);
          expect(items.length, `empty list in ${s.id}`).toBeGreaterThan(0);
          for (const t of items) expect(t.trim(), `blank item in ${s.id}`).not.toBe("");
        }
        if (b.kind === "keys") expect(b.rows.length).toBeGreaterThan(0);
        // A table with no rows is a heading promising a list and delivering nothing.
        if (b.kind === "table") expect(b.rows.length, `empty table in ${s.id}`).toBeGreaterThan(0);
      }
  });
});

describe("the documentation covers the program", () => {
  it("reads MenuName from actions.ts (a walker that matches nothing proves nothing)", () => {
    const names = menuNames();
    expect(names.length).toBeGreaterThan(4);
    expect(names).toContain("Help");
  });

  it("mentions every top-level menu", () => {
    const missing = menuNames().filter((name) => !ALL_TEXT.includes(name));
    expect(
      missing,
      `these menus exist in the app but are not mentioned anywhere in the documentation: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("names every table format", () => {
    // The format is what unlocks a table's analyses and chart types, so a format the manual
    // never names is a capability the user cannot find. Same default-deny shape as the menu
    // check above: add a format, document it, or the build fails.
    const missing = tableFormatList()
      .map((f) => f.label)
      .filter((label) => !ALL_TEXT.includes(label));
    expect(
      missing,
      `these table formats exist but are not named anywhere in the documentation: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("carries the beta-version caution where a reader meets the statistics", () => {
    // The overview alone is not enough: nobody reads a manual front to back, and someone who
    // searches "ANOVA" lands straight in the statistics section. Each of these is a place a
    // user arrives holding a number they are about to believe.
    for (const id of ["overview", "analysis", "results", "curvefit"]) {
      const section = GUIDE.find((s) => s.id === id);
      expect(section, `the ${id} section is gone`).toBeTruthy();
      const text = bodyText(section!).toLowerCase();
      expect(text, `the ${id} section does not say the software is a beta version`).toContain("beta version");
      expect(
        text,
        `the ${id} section warns without saying the numbers themselves may be wrong`,
      ).toMatch(/inaccurac/);
    }
  });

  it("does not claim to watch how the user works", () => {
    // The reproducibility tools are offered, never enforced — MadY does not record how the
    // user analyses, and a manual that says otherwise contradicts both the program and the
    // privacy claim in the overview. Guards against a dropped "not" turning
    // the sentence into "MadY does watch how you analyse".
    expect(ALL_TEXT).not.toMatch(/MadY does watch/i);
    const repro = GUIDE.find((s) => s.id === "reproducibility");
    expect(bodyText(repro!), "the never-watches promise is gone").toMatch(/does not nag/i);
  });

  it("documents the promises the program makes about privacy and undo", () => {
    // These are the claims a user is most damaged by not knowing, and the ones most likely
    // to be quietly dropped in an edit. Each lives in its own chapter (Edit, Saving, Help)
    // rather than in one summary table, so the words are matched as stems ("autosave" also
    // matches "autosaved").
    for (const claim of ["undoable", "autosave", "uploaded"]) {
      expect(ALL_TEXT.toLowerCase(), `the documentation does not mention "${claim}"`).toContain(claim);
    }
  });

  it("tells the user how to report a bug and what leaves their machine", () => {
    const help = GUIDE.find((s) => s.id === "help");
    expect(help, "the help section is gone").toBeTruthy();
    const text = bodyText(help!).toLowerCase();
    expect(text).toContain("copy report");
    expect(text).toContain("nothing is ever uploaded");
  });
});

describe("the documentation states what the licence does not reach", () => {
  const licence = GUIDE.find((s) => s.id === "licence");

  it("has a licence section at all", () => {
    expect(licence, "no licence section in the manual").toBeTruthy();
  });

  it("says the user's own figures carry no obligations", () => {
    // The claim a free licence makes people doubt, and the one most expensive to get wrong:
    // if a scientist believes the GPL touches their published figure, they use another tool.
    const t = bodyText(licence!).toLowerCase();
    expect(t, "the manual does not name the licence").toContain("general public license");
    expect(t, "it does not say the output is the user's").toMatch(/yours/);
    expect(t, "it does not explain why (output is not a derivative work)").toContain("derivative work");
    expect(t, "it does not mention publishing").toContain("publish");
  });

  it("asks for a citation without pretending it is a condition", () => {
    const t = bodyText(licence!).toLowerCase();
    expect(t).toContain("citation");
    expect(t, "a citation must be described as a request, not a licence term").toMatch(/request|appreciated/);
  });
});

/**
 * How to say the name.
 *
 * "MadY" is not self-evidently pronounced — it can be read MAD-why, MAD-yee or MAD-ee, and
 * only one is right. The name refers in part to MAD, the median absolute deviation, a reading
 * that is lost entirely if the reader says it another way. So the pronunciation is
 * documentation, not decoration, and it belongs in the manual's opening section where someone
 * meets the program rather than buried where only a determined reader would find it.
 *
 * Note: IPA is matched by its exact glyphs. `/ˈmædi/` carries a stress mark (U+02C8) and an ash
 * (U+00E6); an edit to plain ASCII would keep the sentence readable and silently destroy the
 * only precise part of it.
 */
describe("the documentation says how to pronounce the name", () => {
  const overview = GUIDE.find((s) => s.id === "overview");

  it("gives the IPA and a plain respelling, in the first section", () => {
    expect(overview, "the overview section is gone").toBeTruthy();
    const t = bodyText(overview!);
    expect(t, "no IPA transcription — 'MAD-ee' alone is not precise").toContain("/ˈmædi/");
    expect(t, "no plain respelling — IPA alone assumes the reader knows it").toContain("MAD-ee");
  });

  it("explains what MAD refers to, or the name loses its point", () => {
    const t = bodyText(overview!).toLowerCase();
    expect(t, "the median-absolute-deviation reading is not stated").toContain("median absolute deviation");
  });
});

/**
 * Where the numbers come from — and the manual must not misattribute them.
 *
 * A reader will cite this section. Naming a package that no longer computes anything, or
 * quietly adding a dependency the manual never mentions, both put a wrong method statement
 * into someone's paper. So this reads `engine.py` from disk and checks the section against
 * what the engine actually imports, in both directions:
 *
 *   • every package the section credits is really imported;
 *   • every third-party package the engine imports is really documented.
 *
 * The second half is the default-deny one. Adding, say, scikit-learn to the engine without
 * a line in the manual fails here rather than shipping an undocumented method.
 */
describe("the documentation attributes the statistics correctly", () => {
  const ENGINE_SRC = readFileSync(
    fileURLToPath(new URL("../../../../../../engines/py/engine.py", import.meta.url)),
    "utf8",
  );
  const section = GUIDE.find((s) => s.id === "stats-engine");
  const text = () => bodyText(section!);

  /** Third-party packages the engine imports (stdlib and the engine's own modules excluded). */
  const STDLIB = new Set([
    "json", "sys", "math", "os", "time", "traceback", "struct", "typing", "dataclasses",
    "itertools", "warnings", "re", "base64", "io", "statistics", "collections", "random",
    "csv", "datetime", "hashlib", "logging", "threading", "queue", "functools", "copy",
    "textwrap", "signal", "platform", "argparse", "contextlib", "enum", "abc", "decimal",
    // Windows-only stdlib: the engine sets its stdio to binary mode so the framed protocol
    // is not corrupted by newline translation. Not a statistics package.
    "msvcrt",
    "fractions", "bisect", "heapq", "operator", "pathlib", "subprocess", "uuid", "zlib",
  ]);
  // A real `from X` line continues with ` import ` — without requiring it, prose in a
  // docstring ("…from both the original start…") reads as an import of "both".
  const imported = new Set(
    [...ENGINE_SRC.matchAll(/^\s*(?:from\s+([A-Za-z_][A-Za-z0-9_]*)[A-Za-z0-9_.]*\s+import\s|import\s+([A-Za-z_][A-Za-z0-9_]*))/gm)]
      .map((m) => (m[1] ?? m[2])!)
      .filter((p) => !STDLIB.has(p) && p !== "engine"),
  );

  it("exists in the Reference group and is findable", () => {
    expect(section, "the statistics-provenance section is gone").toBeTruthy();
    expect(section!.group).toBe("Reference");
  });

  it("credits every package the engine actually imports — and no phantom ones", () => {
    expect(imported.size, "no third-party imports found — the parse is broken, not the engine").toBeGreaterThan(0);
    const t = text().toLowerCase();
    const undocumented = [...imported].filter((p) => !t.includes(p.toLowerCase()));
    expect(
      undocumented,
      "the engine imports these, but the manual never mentions them — a reader would cite the wrong method",
    ).toEqual([]);
    // …and the other way: don't credit a package that isn't there.
    for (const claimed of ["numpy", "scipy", "statsmodels"]) {
      expect(imported.has(claimed), `the manual credits ${claimed}, which the engine does not import`).toBe(true);
    }
  });

  it("carries a resolvable DOI for each package", () => {
    const t = text();
    expect(t, "no NumPy DOI").toContain("10.1038/s41586-020-2649-2");
    expect(t, "no SciPy DOI").toContain("10.1038/s41592-019-0686-2");
    expect(t, "no statsmodels DOI").toContain("10.25080/Majora-92bf1922-011");
  });

  it("admits which methods are MadY's own code, not a package's", () => {
    // The other half of accurate attribution. Kaplan-Meier, the log-rank tests, k-means and the
    // resampling routines are implemented here; a reader must not be led to assume a library
    // computed them.
    const t = text().toLowerCase();
    for (const own of ["kaplan-meier", "log-rank", "k-means"]) {
      expect(t, `the manual does not say ${own} is our own implementation`).toContain(own);
    }
  });
});


/**
 * Every keyboard shortcut the program declares is in the manual's key table.
 *
 * Shortcuts such as Alt+Left / Alt+Right (back and forward through tabs) and the exclude /
 * re-include pair can exist unlisted even while the manual describes the feature at length.
 * A shortcut nobody can find is the same as one that does not exist.
 *
 * Default-deny: a new `shortcut:` in `actions.ts` fails here until the key table names it.
 *
 * Caution: the block is located by `kind: "keys",` with the trailing comma. `kind: "keys"`
 * alone matches the GuideBlock type union at the top of guide.ts, and a probe aimed there
 * finds zero rows and reports every shortcut as missing; the assertion on the row count
 * below catches that.
 */
describe("the documentation lists every keyboard shortcut", () => {
  const ACTIONS = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");
  const GUIDE_SRC = readFileSync(fileURLToPath(new URL("./guide.ts", import.meta.url)), "utf8");

  /**
   * The manual's key table, as raw source (rows are `{ keys, what }`).
   *
   * This reads to the block's real end, not a fixed window past its start: a fixed window
   * stops measuring once the table outgrows it — every row after the cut would read as missing
   * while the ones before it appear to prove the check still works. The row count below is the
   * tripwire.
   */
  const keyTable = (): string => {
    const i = GUIDE_SRC.indexOf('kind: "keys",');
    expect(i, "the key table is gone from the manual").toBeGreaterThan(-1);
    const end = GUIDE_SRC.indexOf("\n        ],", i);
    expect(end, "the key table's rows array does not close where expected").toBeGreaterThan(i);
    return GUIDE_SRC.slice(i, end);
  };

  /** `Ctrl++` is written `Ctrl+=` in the manual - the same physical key, and the clearer
   *  spelling for a reader. The only alias, and it is deliberate. */
  const ALIASES: Record<string, string> = { "Ctrl++": "Ctrl+=" };

  it("names every declared shortcut", () => {
    const table = keyTable();
    const rows = table.match(/keys: "/g) ?? [];
    expect(rows.length, "no rows parsed - the parse is aimed at the type union, not the data").toBeGreaterThan(8);
    // The tripwire for a short read. There is exactly one keys block in the manual, so the
    // last `keys:` in the whole file is that block's last row — and a walker that stops early
    // will not contain it. Without this check, a walker that stops early passes while the
    // table is short and then reports every row past its cut as undocumented.
    const lastKeys = /keys: "((?:[^"\\]|\\.)+)"/.exec(GUIDE_SRC.slice(GUIDE_SRC.lastIndexOf('keys: "')))![1]!;
    expect(table, `the walker stops before the table's last row (${lastKeys}) - it is cutting the block off`).toContain(
      lastKeys,
    );

    const declared = [...new Set([...ACTIONS.matchAll(/shortcut: "([^"]+)"/g)].map((m) => m[1]!))];
    expect(declared.length, "no shortcuts found in actions.ts - the parse is broken").toBeGreaterThan(8);

    // Matched against the rendered rows, not the source text. Reading guide.ts as text asks
    // "is this sequence of characters in the file", which is not the question — the question is
    // what a reader sees. Written as `"Ctrl+\ / Ctrl+Shift+\\"`, Ctrl+\ would render as
    // "Ctrl+ / Ctrl+Shift+\" (`\<space>` is an identity escape) — the key missing from the
    // shortcut — while the source still holds the characters `Ctrl+\`. The source walker above
    // serves only the stops-early tripwire; the coverage claim is made against the strings the
    // manual actually renders.
    const shown = GUIDE.flatMap((s) => s.blocks)
      .flatMap((b) => (b.kind === "keys" ? b.rows.map((r) => r.keys) : []))
      .join("  ");
    expect(shown.length, "no rendered key rows — the import is broken").toBeGreaterThan(80);
    const missing = declared.filter((s) => {
      // actions.ts writes a backslash shortcut as an escaped pair; collapse it before matching.
      const lit = s.replace(/\\\\/g, "\\");
      const alias = ALIASES[lit];
      return !shown.includes(lit) && !(alias !== undefined && shown.includes(alias));
    });
    expect(missing, "these shortcuts exist but the manual's key table does not list them").toEqual([]);
  });

  /**
   * The keys that are not in the registry.
   *
   * `actions.ts` holds the global shortcuts, and the check above covers them. But three
   * components handle keys themselves, on their own element or on `window`, and none of those
   * keys appears in any registry: the spreadsheet (fill down, transpose a block, type-to-edit,
   * extend the selection), the figure (duplicate an object, deselect, nudge) and the panel
   * assembler (nudge a figure object). Those are exactly the gestures a user cannot discover by
   * looking at a menu, which makes documenting them worth more than documenting Ctrl+S.
   *
   * So: read the handlers, and require the table to name what they answer to.
   */
  it("names the keys the spreadsheet, the figure and the assembler handle themselves", () => {
    const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    const grid = read("./DataGrid.tsx");
    const figure = read("./PlotFigure.tsx");
    const panes = read("./panes.tsx");

    // Each row: the handler must really contain the trigger (so a key that is removed stops
    // being required), and the manual must name it.
    const local: Array<{ src: string; inCode: RegExp; inTable: RegExp; what: string }> = [
      { src: grid, inCode: /k\.toLowerCase\(\) === "d"/, inTable: /Ctrl\+D/, what: "fill down in the spreadsheet" },
      { src: grid, inCode: /e\.shiftKey && k\.toLowerCase\(\) === "t"/, inTable: /Ctrl\+Shift\+T/, what: "transpose a block in place" },
      { src: grid, inCode: /k === "Enter" \|\| k === "F2"/, inTable: /Enter \/ F2/, what: "edit the selected cell" },
      { src: grid, inCode: /k === "Delete" \|\| k === "Backspace"/, inTable: /Delete \/ Backspace/, what: "clear the selected cells" },
      { src: grid, inCode: /setSel\(e\.shiftKey/, inTable: /Shift\+arrows/, what: "extend the spreadsheet selection" },
      { src: grid, inCode: /setEditSeed\(k\)/, inTable: /any letter or digit/, what: "type-to-edit a cell" },
      { src: figure, inCode: /onDuplicateAnnotation\)/, inTable: /Ctrl\+D/, what: "duplicate the selected object" },
      { src: figure, inCode: /e\.key === "Escape" && !annMenu/, inTable: /Esc/, what: "deselect on a figure" },
      { src: figure, inCode: /const step = e\.shiftKey \? 10 : 1;/, inTable: /Arrows \/ Shift\+arrows \(on a figure\)/, what: "nudge the selected object" },
      { src: panes, inCode: /const d = e\.shiftKey \? 10 : 1;/, inTable: /Arrows \/ Shift\+arrows \(on a figure\)/, what: "nudge a figure object in the assembler" },
      { src: panes, inCode: /if \(k === "a"\) \{ if \(selectAllRef\.current\(\)\)/, inTable: /Ctrl\+A/, what: "select every panel in the assembler" },
      { src: panes, inCode: /if \(k === "d"\) \{ if \(duplicateRef\.current\(\)\)/, inTable: /Ctrl\+D/, what: "duplicate the selected panels in the assembler" },
    ];

    const table = keyTable();
    const missing: string[] = [];
    for (const row of local) {
      expect(
        row.inCode.test(row.src),
        `the walker does not find the handler for "${row.what}" — update this row, do not delete it`,
      ).toBe(true);
      if (!row.inTable.test(table)) missing.push(row.what);
    }
    expect(
      missing,
      "these keys work in the program and the manual's key table does not mention them: " + missing.join(", "),
    ).toEqual([]);
  });
});
