// @vitest-environment node
/**
 * The worked examples tell the reader to press things that exist.
 *
 * The rest of the manual is arranged by surface and answers "what is this control". A walkthrough
 * answers "I have numbers and I need a figure", which means it names a sequence of real things —
 * and a sequence is exactly what rots: a menu item gets renamed, a dialog gains a page, and the
 * walkthrough sends someone looking for a button that is not there. That is worse than no
 * walkthrough, because they will believe they are the one who is wrong.
 *
 * So every "Menu ▸ Item" a step names is looked up in the command registry, and every dialog
 * button it quotes is looked for in that dialog's source.
 *
 * Default-deny, both ways: an unknown menu path fails, and a walkthrough with no steps fails.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { actionCatalogue } from "./actions";
import { GUIDE, type GuideSection, stepTexts } from "./guide";

const WALKTHROUGHS = GUIDE.filter((s) => s.group === "Worked examples");
const steps = (s: GuideSection): string[] => s.blocks.flatMap((b) => (b.kind === "steps" ? stepTexts(b) : []));
const prose = (s: GuideSection): string =>
  [s.summary, ...s.blocks.flatMap((b) =>
    b.kind === "p" || b.kind === "note" ? [b.text] : b.kind === "ul" ? b.items : b.kind === "steps" ? stepTexts(b) : [],
  )].join("  ");

/** Every menu path the program really has, e.g. "Analyze ▸ Common analyses ▸ Dose-response…". */
const MENU_PATHS = new Set(
  actionCatalogue().map((a) => (a.submenu ? `${a.menu} ▸ ${a.submenu} ▸ ${a.label}` : `${a.menu} ▸ ${a.label}`)),
);

describe("the manual has worked examples at all", () => {
  it("covers the jobs people open the program to do", () => {
    // The floor is what shipped. A walkthrough deleted rather than fixed should fail here.
    expect(WALKTHROUGHS.length, "the Worked examples group is empty or gone").toBeGreaterThanOrEqual(8);
    expect(MENU_PATHS.size, "no commands read — the walker is broken").toBeGreaterThan(50);
  });

  it("every walkthrough is a numbered sequence, not another description", () => {
    for (const t of WALKTHROUGHS) {
      const n = steps(t).length;
      expect(n, `“${t.title}” has no numbered steps — it is a description in a walkthrough's clothes`).toBeGreaterThanOrEqual(5);
      expect(n, `“${t.title}” has ${n} steps; past about a dozen it is a chapter again`).toBeLessThanOrEqual(12);
    }
  });

  it("every step is an instruction, not a paragraph", () => {
    for (const t of WALKTHROUGHS)
      for (const s of steps(t)) {
        expect(s.length, `a one-word step in “${t.title}”: ${s}`).toBeGreaterThan(30);
        expect(s.length, `this step in “${t.title}” is an essay, not a step: ${s.slice(0, 70)}…`).toBeLessThan(560);
      }
  });

  it("every menu path a step names is a command the program has", () => {
    // Matched against the known paths, not against a guess at where a path ends. A regex with a
    // lazy body and a lookahead cuts its own matches: it would report "Insert ▸ New table" as
    // missing (the real path has a third segment) and run "Design ▸ Significance thresholds &
    // labels…" on into the em dash after it — false failures. So: wherever a step says
    // "<Menu> ▸ ", a real path must start at exactly that point. Nothing has to know where it stops.
    const MENUS = ["File", "Edit", "Insert", "Data", "Analyze", "Graph", "Design", "View", "Help"];
    const bad: string[] = [];
    let found = 0;
    for (const t of WALKTHROUGHS)
      for (const s of steps(t))
        for (const menu of MENUS) {
          for (let i = s.indexOf(`${menu} ▸ `); i >= 0; i = s.indexOf(`${menu} ▸ `, i + 1)) {
            const from = s.slice(i);
            found++;
            if (![...MENU_PATHS].some((path) => from.startsWith(path))) {
              bad.push(`${t.id}: “${from.slice(0, 60)}…”`);
            }
          }
        }
    expect(found, "no menu paths found in any step — the walker matches nothing").toBeGreaterThan(10);
    expect(bad, `these steps send the reader to a menu item the program does not have:\n  ${bad.join("\n  ")}`).toEqual([]);
  });

  it("every dialog button a step quotes is really on that dialog", () => {
    // The words a reader will hunt for. Each is checked in the file that draws it, so renaming
    // the button breaks the walkthrough that names it rather than the reader's afternoon.
    const HERE = "apps/desktop/src/renderer/src/shell/";
    const BUTTONS: { label: string; src: string }[] = [
      { label: "Create graph", src: "NewGraphDialog.tsx" },
      { label: "Build / Arrange", src: "panes.tsx" },
      { label: "Auto-scale on include", src: "panes.tsx" },
      { label: "Add image", src: "panes.tsx" },
      { label: "Second row is units", src: "ImportDialog.tsx" },
      { label: "Keep linked to file", src: "ImportDialog.tsx" },
      { label: "Comment marker", src: "ImportDialog.tsx" },
      { label: "Decimal separator", src: "ImportDialog.tsx" },
      { label: "Print width", src: "ExportDialog.tsx" },
      { label: "Add to graph", src: "panes.tsx" },
      { label: "Significance brackets", src: "panes.tsx" },
      { label: "Letters (CLD)", src: "panes.tsx" },
      { label: "Survival curves", src: "panes.tsx" },
      { label: "Make default", src: "AnalyzeDialog.tsx" },
      { label: "Control group", src: "AnalyzeDialog.tsx" },
      { label: "Align all", src: "panes.tsx" },
      { label: "Renumber", src: "panes.tsx" },
      { label: "Shared axes", src: "panes.tsx" },
      { label: "One legend", src: "panes.tsx" },
      { label: "House style", src: "panes.tsx" },
      { label: "Free drag", src: "panes.tsx" },
      { label: "Row blocks from tree", src: "Inspector.tsx" },
      { label: "Apply to whole graph", src: "Inspector.tsx" },
    ];
    const missingFromApp: string[] = [];
    const unusedHere: string[] = [];
    const all = WALKTHROUGHS.map(prose).join("  ");
    for (const b of BUTTONS) {
      if (!readFileSync(HERE + b.src, "utf8").includes(b.label)) missingFromApp.push(`${b.label} (${b.src})`);
      // …and the other direction: a row kept here for a button none at all mentions any more is
      // a check that has quietly stopped checking the thing it was written for.
      if (!all.includes(b.label)) unusedHere.push(b.label);
    }
    expect(missingFromApp, `the walkthroughs name these, and the app does not have them: ${missingFromApp.join(", ")}`).toEqual([]);
    expect(unusedHere, `these rows guard buttons none at all mentions any more: ${unusedHere.join(", ")}`).toEqual([]);
  });

  it("every walkthrough hands the reader on somewhere", () => {
    // A walkthrough that ends at the last step leaves someone standing in the middle of the
    // program. Each one points at the chapters that go deeper.
    const titles = GUIDE.map((s) => s.title);
    for (const t of WALKTHROUGHS) {
      const body = prose(t);
      const links = titles.filter((x) => x !== t.title && body.includes(x));
      expect(links.length, `“${t.title}” never points at another chapter`).toBeGreaterThan(0);
    }
  });
});
