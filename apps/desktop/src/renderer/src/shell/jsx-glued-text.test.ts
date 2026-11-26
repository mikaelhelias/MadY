/**
 * JSX glued text — the whitespace rule that silently welds two words together.
 *
 * JSX joins text on separate lines with a space, but when a line ends with an element and
 * the next line starts with text, the newline is dropped entirely and nothing replaces it:
 *
 *     <b>double-click to reset</b>
 *     the axes.                       →  "double-click to resetthe axes."
 *
 * It type-checks, it renders, and it reads as a typo the user notices rather than a bug the
 * author sees. The fix is `{" "}` at the end
 * of the element line (React's own idiom), which this file requires.
 *
 * Static, deliberately: the alternative is rendering every pane in every state and diffing
 * prose, which no test suite does. Scanning the source finds the whole class at once.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) {
      out.push(...sources(p));
    } else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e)) {
      out.push(p);
    }
  }
  return out;
}

/** Inline elements whose closing tag is followed by prose often enough to matter. */
const INLINE = /<\/(b|strong|em|i|code|kbd|a|span)>\s*$/;
/** The next line continues a sentence: it starts with a lowercase word or punctuation that
 *  cannot begin one. A line starting with `<`, `{`, an uppercase word or a JSX attribute is
 *  either markup or a new sentence, and neither is the bug. */
const CONTINUES = /^\s*[a-z(,.;:]/;

describe("JSX text is not glued to the element before it", () => {
  const files = sources(ROOT);

  it("finds the renderer sources (guards the scanner itself)", () => {
    // A scanner that reads nothing passes every check below vacuously.
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((f) => /panes\.tsx$/.test(f))).toBe(true);
  });

  it("no line ends with an inline element while the next line continues the sentence", () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length - 1; i++) {
        const here = lines[i]!;
        const next = lines[i + 1]!;
        if (!INLINE.test(here) || !CONTINUES.test(next)) continue;
        // `{" "}` at the end is the explicit space — the fix, not the bug.
        if (/\{" "\}\s*$/.test(here)) continue;
        hits.push(`${relative(ROOT, f)}:${i + 1}\n      ${here.trim()}\n      ${next.trim()}`);
      }
    }
    expect(
      hits,
      "These lines render with the two words welded together (\"…resetthe axes\"). End the "
        + "element line with {\" \"} — or put the whole sentence on one line:\n  - "
        + hits.join("\n  - ")
        + "\n",
    ).toEqual([]);
  });
});

/**
 * The quiet line under a graph telling the user the figure is theirs.
 *
 * Source-level rather than a render test: the graph pane needs a table, a plot and a built
 * scene to mount, and this claim is a promise — what matters is that the words are still in
 * the program, not which DOM node holds them. A promise deleted in a tidy-up is exactly the
 * kind of loss nobody notices.
 */
describe("the 'your work is yours' reassurance stays under the graph", () => {
  const panes = readFileSync(join(ROOT, "shell/panes.tsx"), "utf8");

  it("is present, in the hint row under the figure", () => {
    expect(panes, "the 'your work is yours' line is gone from the graph pane").toMatch(
      /viewhints-quiet[\s\S]{0,120}You own your work/,
    );
  });

  it("says the work is the user's, unconditionally", () => {
    // What is checked is the claim itself — that the work is the user's, with no qualifier
    // attached (not an explanation of the mechanism such as "the licence covers MadY, not
    // your work").
    const line = /You own your work[^<]*/.exec(panes)?.[0] ?? "";
    expect(line, "the 'your work' line lost its subject").toMatch(/your work/i);
    expect(line, "the reassurance carries a qualifier — it must be unconditional").toMatch(/always/i);
  });
});
