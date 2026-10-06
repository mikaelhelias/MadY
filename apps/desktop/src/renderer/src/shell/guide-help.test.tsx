// @vitest-environment jsdom
/**
 * The "?" buttons — the link from a control back to the manual.
 *
 * A "?" is a promise: press it and the manual will explain this specific thing. The promise can
 * be broken in two different ways, and this file refuses both.
 *
 *  1. A "?" whose target is not in the index opens the manual at nothing — the reader has been
 *     promised an answer and handed an empty search box. Every target named anywhere in the
 *     source must resolve to a real entry.
 *  2. A dialog with no "?" at all is a dead end for the same reader. Every dialog that renders
 *     a title must carry one, or be listed here as exempt with a reason.
 *
 * Read out of the source, not out of a hand-kept list, so a dialog added later fails
 * this test rather than quietly shipping without a way back to the manual.
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { GUIDE, stepTexts } from "./guide";
import { guideIndex } from "./guideIndex";
import { GUIDE_OPEN_EVENT, GuideHelp, requestGuide } from "./guideLink";
import { AXIS_GROUPS, INSPECTOR_SECTIONS, INSPECTOR_TABS } from "./Inspector";
import { axisEntryId, inspectorEntryId, inspectorTabEntryId } from "./guideIds";

afterEach(cleanup);

// Note: from the repo root, not from `import.meta.url`: this file needs jsdom to render the button,
// and in jsdom `import.meta.url` is not a file: URL, so `fileURLToPath` throws. vitest runs from
// the root, and the walker below asserts it actually found this directory.
const HERE = "apps/desktop/src/renderer/src/shell/";
const read = (f: string): string => readFileSync(HERE + f, "utf8");
const SOURCES = readdirSync(HERE).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));

describe("every “?” points at something the manual has", () => {
  it("reads real sources — a walker that matches nothing proves nothing", () => {
    expect(SOURCES.length).toBeGreaterThan(30);
    expect(SOURCES.filter((f) => read(f).includes("<GuideHelp")).length).toBeGreaterThan(20);
  });

  it("every literal target in the source is a real entry", () => {
    const ids = new Set(guideIndex().map((e) => e.id));
    const bad: string[] = [];
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(/entry:\s*"([^"]+)"/g)) {
        if (!ids.has(m[1]!)) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad, `these “?” buttons open the manual at nothing: ${bad.join(", ")}`).toEqual([]);
  });

  it("every Inspector heading's derived target is a real entry", () => {
    // The Inspector's buttons build their target from the heading, so the ids are never written
    // down anywhere — this is what checks them.
    const ids = new Set(guideIndex().map((e) => e.id));
    const missing = [
      ...INSPECTOR_SECTIONS.map(inspectorEntryId),
      ...AXIS_GROUPS.map(axisEntryId),
      ...INSPECTOR_TABS.map((t) => inspectorTabEntryId(t.id)),
    ].filter((id) => !ids.has(id));
    expect(missing, `these Inspector headings show a “?” that leads nowhere: ${missing.join(", ")}`).toEqual([]);
  });

  it("every literal section target is a real chapter", () => {
    const ids = new Set(GUIDE.map((s) => s.id));
    const bad: string[] = [];
    for (const f of SOURCES) {
      for (const m of read(f).matchAll(/section:\s*"([^"]+)"\s*\}/g)) {
        if (!/GuideHelp|requestGuide|target/.test(read(f).slice(Math.max(0, m.index! - 120), m.index!))) continue;
        if (!ids.has(m[1]!)) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad, `these “?” buttons name a chapter that does not exist: ${bad.join(", ")}`).toEqual([]);
  });
});

describe("every dialog offers a way back to the manual", () => {
  /**
   * The dialogs with no "?", and why. A reason, not a name — "it did not fit" is not one.
   * Adding a dialog and adding it here is a decision someone has to write down.
   */
  const EXEMPT: Record<string, string> = {
    "ModelSetup.tsx":
      "Only in a run started with MADY_LLM=1. The manual describes the installed program, which has no language model, so there is no chapter to open.",
  };

  const dialogs = SOURCES.filter((f) => /className="modalh"/.test(read(f)));

  it("finds the dialogs at all", () => {
    expect(dialogs.length, "no dialog titles found — update this walker, do not delete it").toBeGreaterThan(15);
  });

  it("every dialog with a title has a “?” on it, or a written reason not to", () => {
    const missing = dialogs.filter((f) => !read(f).includes("<GuideHelp") && !(f in EXEMPT));
    expect(missing, `these dialogs give the reader no way back to the manual: ${missing.join(", ")}`).toEqual([]);
  });

  it("no exemption is written for a dialog that no longer exists, or that has a “?” anyway", () => {
    const stale = Object.keys(EXEMPT).filter((f) => !dialogs.includes(f) || read(f).includes("<GuideHelp"));
    expect(stale, `these exemptions are out of date: ${stale.join(", ")}`).toEqual([]);
  });
});

describe("the button itself", () => {
  it("asks the shell to open the manual, and says what it is about", () => {
    const heard: unknown[] = [];
    const listener = (e: Event): void => void heard.push((e as CustomEvent).detail);
    window.addEventListener(GUIDE_OPEN_EVENT, listener);
    const { container } = render(<GuideHelp target={{ entry: "action:export" }} what="Export" />);
    const btn = container.querySelector("button")!;
    expect(btn.getAttribute("aria-label"), "a bare “?” is unreadable in a screen reader").toBe("Help: Export");
    expect(btn.getAttribute("title")).toContain("Export");
    fireEvent.click(btn);
    window.removeEventListener(GUIDE_OPEN_EVENT, listener);
    expect(heard).toEqual([{ entry: "action:export" }]);
  });

  it("does not toggle the <details> it sits in", () => {
    // Half of these live inside a `<summary>`, where a click opens or closes the section.
    // Without preventDefault + stopPropagation, asking for help would collapse the panel.
    const onToggle = vi.fn();
    const { container } = render(
      <details open onToggle={onToggle}>
        <summary>
          Series
          <GuideHelp target={{ entry: "insp:series" }} what="Series" />
        </summary>
        <p>body</p>
      </details>,
    );
    fireEvent.click(container.querySelector("button")!);
    expect((container.querySelector("details") as HTMLDetailsElement).open, "the section closed under the reader").toBe(true);
  });

  it("requestGuide carries the target through the window event", () => {
    const heard: unknown[] = [];
    const listener = (e: Event): void => void heard.push((e as CustomEvent).detail);
    window.addEventListener(GUIDE_OPEN_EVENT, listener);
    requestGuide({ section: "axes" });
    window.removeEventListener(GUIDE_OPEN_EVENT, listener);
    expect(heard).toEqual([{ section: "axes" }]);
  });
});

describe("the manual says these two doors exist", () => {
  /**
   * A feature nobody is told about is a feature nobody uses. Both of these are quiet by
   * design — a 15-px "?" and a group below the fold of Ctrl+K — which is exactly why the manual
   * has to name them. Matched on what the reader would look for, not on an identifier.
   */
  const PROSE = GUIDE.map((s) =>
    [s.title, s.summary, ...s.blocks.flatMap((b) =>
      b.kind === "p" || b.kind === "note" ? [b.text]
        : b.kind === "ul" ? b.items : b.kind === "steps" ? stepTexts(b)
        : b.kind === "keys" ? b.rows.map((r) => `${r.keys} ${r.what}`)
        : [],
    )].join(" "),
  ).join("\n").toLowerCase();

  it("tells the reader the “?” opens the manual at that control", () => {
    expect(PROSE, "the “?” buttons are documented nowhere").toMatch(/“\?”/);
    expect(PROSE).toMatch(/inspector[^.]*“\?”|“\?”[^.]*inspector/);
  });

  it("tells the reader Ctrl+K also searches the manual", () => {
    expect(PROSE, "the palette's manual group is documented nowhere").toContain("in the manual");
  });
});

describe("the “?” is actually drawn", () => {
  /**
   * The one thing jsdom cannot see. `shell.css` is never loaded in these tests, so every
   * assertion above would still pass if the glyph vanished — the button would be a 15-px
   * invisible circle, and the checks would keep passing while the feature disappeared. The
   * glyph is CSS content (it cannot be text: a
   * button's text becomes part of the `<summary>` and `<h3>` it sits in), so the stylesheet is
   * where it has to be checked.
   */
  const CSS = readFileSync("apps/desktop/src/renderer/src/shell.css", "utf8");

  it("the stylesheet really is the one the app ships", () => {
    expect(CSS.length).toBeGreaterThan(10_000);
    expect(CSS).toContain(".guidehelp {");
  });

  it("draws the question mark, and gives the button a size to draw it in", () => {
    expect(CSS, "the “?” glyph is gone — every button is now an empty circle").toMatch(
      /\.guidehelp::before\s*\{[^}]*content:\s*"\?"/,
    );
    expect(CSS).toMatch(/\.guidehelp\s*\{[^}]*width:\s*\d/);
  });
});
