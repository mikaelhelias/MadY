// @vitest-environment jsdom
/**
 * The Documentation tab.
 *
 * The About card's own assertions — the four things GPL-3 §0 needs, the artwork, the
 * citation, the dead-update-link check — live in `AboutPane.test.tsx`, next to the component.
 * This file checks that the card is also present here: it is rendered on both tabs, and this
 * guards against it being dropped from this one.
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AboutPane } from "./AboutPane";
import { GUIDE, stepShots } from "./guide";
import { GUIDE_MARKS, GuidePane } from "./GuidePane";
import { guideIndex } from "./guideIndex";
import { HOW_TO_SHOTS } from "./howTo";

/**
 * A 20 s time limit for the two heaviest tests in this file, for the same reason as
 * `AppShell.test.tsx`'s `GALLERY_TIMEOUT`.
 *
 * Run alone, both tests finish under the default 5000 ms limit but within a small factor of it
 * (the flash test includes a deliberate 1700 ms wait for the pulse to end), so under the full
 * suite, with workers competing for the CPU, the lightbox test can exceed it while passing on
 * its own.
 *
 * The limit affects only the time allowed; the assertions are the same. At 20 s a hang still
 * fails, and so does a GuidePane that is ten times slower than usual.
 */
const GUIDE_TIMEOUT = 20_000;

/**
 * Every picture the manual puts on the page, in the order it puts them there.
 *
 * This includes more than the `shot` blocks. The how-to pages show a capture at the head of each
 * run of controls, so counting only `shot` blocks under-counts the rendered images. Counting all
 * of them also guards the case where one group spans two captures and the renderer drops the
 * second.
 */
const pictureFiles = (): string[] => [
  ...GUIDE.flatMap((s) => s.blocks.filter((b) => b.kind === "shot")).map((b) => (b as { file: string }).file),
  ...HOW_TO_SHOTS.map((s) => s.file),
  // …and one per numbered step that carries its own figure.
  ...stepShots().map((s) => s.file),
];

afterEach(cleanup);

/**
 * Is the element actually on screen for a reader?
 *
 * Caution: a truthy `querySelector(...)` does not answer this question — it stays truthy when
 * the element is hidden with a `hidden` attribute. jsdom applies the UA stylesheet, so
 * `[hidden]` and an inline `display: none` both come back as `display: none` here and are
 * caught. What jsdom cannot see is `shell.css` (no stylesheet is loaded), so a rule that hides
 * the element through a class would still pass; the e2e tests cover that.
 */
function shown(el: Element | null): boolean {
  if (!el) return false;
  for (let n: Element | null = el; n && n !== document.documentElement; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
  }
  return true;
}

/** Type into the manual's search box the way React sees a real keystroke. */
function search(container: HTMLElement, text: string): void {
  const box = container.querySelector(".guide-search") as HTMLInputElement;
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  set.call(box, text);
  fireEvent.input(box);
}

describe("GuidePane", () => {
  it("renders the manual", () => {
    const { container } = render(<GuidePane version="1" />);
    expect(container.querySelector(".guide-head")).toBeTruthy();
    expect(container.querySelectorAll(".guide-sec").length).toBeGreaterThan(3);
    expect(container.querySelector(".guide-toc"), "no contents list").toBeTruthy();
  });

  it("renders every snapshot as a real image with its alt text", () => {
    // The shot ↔ asset contract lives in guide-shots.test.ts; this test covers the rendering:
    // a "shot" block must become an <img> a reader actually sees, not fall through the switch.
    const { container } = render(<GuidePane version="1" />);
    const imgs = [...container.querySelectorAll(".guide-shot img")];
    expect(imgs.length).toBe(pictureFiles().length);
    for (const img of imgs) {
      expect((img.getAttribute("alt") ?? "").length, "an image without alt text").toBeGreaterThan(0);
      expect((img.getAttribute("src") ?? "").length, "an image without a source").toBeGreaterThan(0);
    }
  });

  it("a snapshot enlarges on click, and closes on Escape or a click", () => {
    const { container } = render(<GuidePane version="1" />);
    expect(container.querySelector(".guide-lightbox"), "lightbox open before any click").toBeNull();
    const btn = container.querySelector("button.guide-shot-zoom")!;
    fireEvent.click(btn);
    const box = container.querySelector(".guide-lightbox");
    expect(box, "clicking a snapshot did not open the lightbox").toBeTruthy();
    // The same image, full size — not a copy that could drift from the thumbnail.
    expect(box!.querySelector("img")?.getAttribute("src")).toBe(btn.querySelector("img")!.getAttribute("src"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(container.querySelector(".guide-lightbox"), "Escape did not close the lightbox").toBeNull();
    fireEvent.click(container.querySelector("button.guide-shot-zoom")!);
    // Reading must never close it: clicks inside the card (the image, the caption) stay open —
    // only the backdrop, the Close button or Escape dismiss.
    fireEvent.click(container.querySelector(".guide-lightbox-card img")!);
    expect(container.querySelector(".guide-lightbox"), "clicking the image closed the popup").toBeTruthy();
    fireEvent.click(container.querySelector(".guide-lightbox")!);
    expect(container.querySelector(".guide-lightbox"), "clicking the backdrop did not close it").toBeNull();
    fireEvent.click(container.querySelector("button.guide-shot-zoom")!);
    fireEvent.click(container.querySelector(".guide-lightbox-close")!);
    expect(container.querySelector(".guide-lightbox"), "the Close button did not close it").toBeNull();
  }, GUIDE_TIMEOUT);

  it("heads the manual with the About card — it belongs on both tabs", () => {
    // About has its own Help item as a direct route, but it also stays on the tab a reader is
    // already looking things up on. Guards against removing it from this tab.
    const { container } = render(<GuidePane version="0.0.0+2026-08-05" />);
    const card = container.querySelector(".about");
    expect(card, "the About card is gone from the Docs tab").toBeTruthy();
    expect(card!.textContent, "the card is here but not showing the version").toContain("0.0.0+2026-08-05");
    expect(card!.querySelector(".about-art"), "the card is here but not its artwork").toBeTruthy();
  });

  it("puts the beta-version warning before the card, not after it", () => {
    // Below the card it is read fourth — after the version, the licence and the citation, by
    // someone who has already decided to trust the numbers.
    const { container } = render(<GuidePane version="1" />);
    const banner = container.querySelector(".beta-banner");
    const card = container.querySelector(".about");
    expect(banner, "no beta-version warning on the Docs tab").toBeTruthy();
    expect(
      banner!.compareDocumentPosition(card!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the beta-version warning must come before the About card",
    ).toBeTruthy();
    const text = banner!.textContent ?? "";
    expect(text, "it must name the state of the software").toMatch(/beta version/i);
    expect(text, "it must say results may be wrong, not just that the app is unfinished").toMatch(/inaccurac/i);
    expect(text, "it must ask the reader to assess results critically").toMatch(/critically/i);
    expect(text, "the warning must name a remedy: checking results against an established package").toMatch(/established statistics package/i);
  });

  it("prints one citation on the card and one in the licence section, from one source", () => {
    // Three renderings of the same string across two components — the card here, the licence
    // section here, and the card on the About tab. All come from `citation()`, so what matters
    // is that they are identical; nothing else would notice them drifting.
    const v = "v3.2.1 · deadbee · 08-05 12:00";
    const guide = render(<GuidePane version={v} />);
    const cites = [...guide.container.querySelectorAll(".about-cite")].map((n) => n.textContent);
    expect(cites.length, "expected the card's citation and the licence section's").toBe(2);
    expect(new Set(cites).size, "the two citations on this tab disagree").toBe(1);

    const licence = guide.container.querySelector("#guide-licence");
    expect(licence, "no licence section").toBeTruthy();
    expect(licence!.querySelector(".about-cite"), "the citation is not IN the licence section").toBeTruthy();

    cleanup();
    const about = render(<AboutPane version={v} />);
    const onAboutTab = about.container.querySelector(".about-cite")?.textContent;
    expect(onAboutTab, "the About tab has no citation").toBeTruthy();
    expect(cites[0], "the Docs tab and the About tab disagree about the citation").toBe(onAboutTab);
    expect(onAboutTab).toBe("Elias, M. (2026). MadY (version 3.2.1).");
  });
});

/**
 * The search results — the half of the guide that answers "where is it".
 *
 * These are DOM checks about ranking and routes, not about wording: `guideSearch.test.ts`
 * already pins what the ranking returns. What can only fail here is the rendering — a hit
 * that lists no route, a contents list that disappears, an anchor that scrolls to nothing.
 */
/**
 * The results are a popup under the search box. In the built app at 1500×950 the search box
 * sits at about y=900 (the About card and the "why" paragraph are above it), so results placed
 * after the ~850px contents list would start off the screen. The results therefore open in a
 * card anchored to the box, and opening scrolls the box to the top of the pane so the card has
 * room. jsdom cannot lay out; these tests check the structure and the scroll request.
 */
describe("the manual's search results open as a popup under the box", () => {
  it("the results render inside the header, anchored to the search box — not below the contents list", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "axis");
    const pop = container.querySelector(".guide-head .guide-searchpop");
    expect(pop, "no popup inside the header").toBeTruthy();
    expect(pop!.querySelector(".guide-results"), "the results are not in the popup").toBeTruthy();
    expect(container.querySelector(".guide-toc .guide-results, .guide-toc ~ .guide-results"), "results still sit after the contents list").toBeNull();
  });

  it("the no-match note is in the popup too", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "zzqxv");
    expect(container.querySelector(".guide-searchpop .guide-empty")).toBeTruthy();
  });

  it("opening the popup scrolls the search box to the top of the pane, instantly", () => {
    const scrolled: { id: string; behavior: unknown }[] = [];
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ id: this.className, behavior: (arg as { behavior?: unknown } | undefined)?.behavior });
    };
    const { container } = render(<GuidePane version="1" />);
    search(container, "axis");
    const head = scrolled.find((s) => /guide-head/.test(s.id));
    expect(head, "the header was not scrolled into view when the popup opened").toBeTruthy();
    expect(head!.behavior).toBe("auto");
  });

  it("Escape closes the popup and keeps the query; typing reopens it; choosing a chapter closes it", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "axis");
    const box = container.querySelector(".guide-search") as HTMLInputElement;
    fireEvent.keyDown(box, { key: "Escape" });
    expect(container.querySelector(".guide-searchpop"), "Escape did not close the popup").toBeNull();
    expect(box.value, "Escape wiped the query").toBe("axis");
    search(container, "axis ");
    expect(container.querySelector(".guide-searchpop"), "typing did not reopen the popup").toBeTruthy();
    fireEvent.click(container.querySelector(".guide-hit-chapter .guide-hitname")!);
    expect(container.querySelector(".guide-searchpop"), "choosing a chapter left the popup open").toBeNull();
  });
});

describe("the manual's search results", () => {
  it("keeps the contents list on screen while you type", () => {
    // Guards against the list vanishing as soon as a query exists, which would remove the map
    // of the manual at the moment a reader has failed to find something.
    const { container } = render(<GuidePane version="1" />);
    expect(shown(container.querySelector(".guide-toc")), "no contents list before typing").toBe(true);
    search(container, "axis");
    expect(shown(container.querySelector(".guide-toc")), "the contents list vanished while searching").toBe(true);
  });

  it("keeps every chapter rendered, so a result can never scroll to nothing", () => {
    // Guards against filtering non-matching sections out of the DOM, which would leave a hit's
    // anchor pointing at an element that is not there.
    const { container } = render(<GuidePane version="1" />);
    const all = container.querySelectorAll(".guide-sec").length;
    expect(all).toBe(GUIDE.length);
    search(container, "axis");
    expect(container.querySelectorAll(".guide-sec").length, "searching removed chapters from the page").toBe(all);
    for (const a of container.querySelectorAll<HTMLAnchorElement>(".guide-hitchapter, .guide-hit-chapter .guide-hitname")) {
      const id = a.getAttribute("href")!.slice(1);
      expect(container.querySelector(`#${id}`), `a result links to #${id}, which is not on the page`).toBeTruthy();
    }
  });

  it("shows functions before chapters", () => {
    // The question is "where is axis tuning", not "read about axes". A results list that
    // leads with prose answers the other question.
    const { container } = render(<GuidePane version="1" />);
    search(container, "export");
    const groups = [...container.querySelectorAll(".guide-resgroup")].map((g) => g.getAttribute("aria-label"));
    expect(groups[0], "the first results group is not Functions").toBe("Functions");
    expect(groups).toContain("Chapters");
  });

  it("every function hit carries at least one route, in words", () => {
    // Guards against a function name listed with nothing saying where to press it.
    const { container } = render(<GuidePane version="1" />);
    search(container, "export");
    const hits = [...container.querySelectorAll(".guide-hit:not(.guide-hit-chapter)")];
    expect(hits.length, "no function hits for “export”").toBeGreaterThan(0);
    for (const h of hits) {
      const wheres = [...h.querySelectorAll(".guide-where")];
      expect(wheres.length, `“${h.querySelector(".guide-hitname")?.textContent}” lists no route`).toBeGreaterThan(0);
      for (const w of wheres) {
        expect(shown(w), "a route line is in the markup but not on screen").toBe(true);
        expect((w.textContent ?? "").trim().length, "a blank route line").toBeGreaterThan(3);
      }
    }
  });

  it("“axis” puts the Axis controls and the axes chapter in front of the reader", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "axis");
    const chapterNames = [...container.querySelectorAll(".guide-hit-chapter .guide-hitname")].map((n) => n.textContent);
    expect(chapterNames[0], "the axes chapter is not the first chapter hit").toBe("Axes, scales and ticks");
    const text = container.querySelector(".guide-results")!.textContent ?? "";
    expect(text, "the results never say where to go").toMatch(/▸/);
  });

  it("a function hit links into the chapter that explains it", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "transpose");
    const link = container.querySelector(".guide-hitchapter");
    expect(link, "a function hit with no chapter link").toBeTruthy();
    expect(link!.textContent).toMatch(/^Read: /);
  });

  it("a chapter hit quotes the sentence it matched", () => {
    const { container } = render(<GuidePane version="1" />);
    search(container, "autosave");
    const snippet = container.querySelector(".guide-snippet");
    expect(snippet, "no snippet under a chapter hit").toBeTruthy();
    expect((snippet!.textContent ?? "").length).toBeGreaterThan(20);
  });
});

describe("opening the manual at a destination", () => {
  it("a section target scrolls to that chapter and flashes it", () => {
    // jsdom has no scrollIntoView; stubbing it is also how we prove the scroll was asked for.
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    const { container } = render(<GuidePane version="1" target={{ section: "axes" }} />);
    expect(scrolled, "opening at a chapter did not scroll to it").toContain("guide-axes");
    expect(container.querySelector("#guide-axes")!.classList.contains("guide-pulse"), "it scrolled but did not flash").toBe(true);
  });

  /**
   * An entry target lands in the chapter prose, not in the search view: typing the function's
   * name into the search box would show a results list where the reader expects the
   * explanation. Every entry point lands in the prose. The most specific anchor wins: a how-to
   * row, else the group's heading, else the chapter top.
   */
  it("an entry target lands in the chapter's prose and flashes the place, with no search view", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    // A command has no how-to row of its own: the chapter that explains it.
    const transpose = guideIndex().find((e) => e.id === "action:transpose")!;
    const { container } = render(<GuidePane version="1" target={{ entry: "action:transpose" }} />);
    const box = container.querySelector(".guide-search") as HTMLInputElement;
    expect(box.value, "the search box must stay empty — this is not the search view").toBe("");
    expect(container.querySelector(".guide-hit"), "a results list was shown").toBeNull();
    expect(scrolled).toEqual([`guide-${transpose.section}`]);
    expect(container.querySelector(`#guide-${transpose.section}`)!.classList.contains("guide-pulse")).toBe(true);
  });

  it("an entry with its own how-to group lands on that group's heading, not the chapter top", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    const { container } = render(<GuidePane version="1" target={{ entry: "axis:breaks-cuts" }} />);
    expect(scrolled).toEqual(["howto-group-breaks-cuts"]);
    expect(container.querySelector("#howto-group-breaks-cuts")!.classList.contains("guide-pulse")).toBe(true);
  });

  it("a target naming nothing leaves the manual alone rather than throwing", () => {
    const { container } = render(<GuidePane version="1" target={{ entry: "action:no-such-command" }} />);
    expect(container.querySelector(".guide-toc"), "the manual did not render at all").toBeTruthy();
    expect((container.querySelector(".guide-search") as HTMLInputElement).value).toBe("");
  });

  it("the flash is removed again, so the chapter does not stay highlighted", async () => {
    Element.prototype.scrollIntoView = function () {};
    const { container } = render(<GuidePane version="1" target={{ section: "axes" }} />);
    const sec = container.querySelector("#guide-axes")!;
    expect(sec.classList.contains("guide-pulse")).toBe(true);
    await act(() => new Promise((r) => setTimeout(r, 1700)));
    expect(sec.classList.contains("guide-pulse"), "the flash never ended").toBe(false);
  }, GUIDE_TIMEOUT);
});

/**
 * The call-outs, as rendered.
 *
 * `guide-shots.test.ts` guards the coordinates; what can only fail here is the drawing — a box
 * count that does not match the legend, a legend that does not match the file, an overlay that
 * silently renders nothing because the marks never reached the component.
 */
describe("call-outs over a snapshot", () => {
  /** The manual's marked pictures, in the order their blocks appear. */
  const markedFiles = pictureFiles().filter((f) => GUIDE_MARKS[f]);

  it("there are marked pictures — otherwise everything below is vacuous", () => {
    expect(markedFiles.length).toBeGreaterThanOrEqual(6);
  });

  it("draws one numbered box per mark, and a legend row for each", () => {
    const { container } = render(<GuidePane version="1" />);
    for (const file of markedFiles) {
      const marks = GUIDE_MARKS[file]!;
      const fig = [...container.querySelectorAll("figure.guide-shot")].find(
        (f) => (f.querySelector("img")?.getAttribute("src") ?? "").includes(file.replace(".png", "")),
      );
      expect(fig, `no figure rendered for ${file}`).toBeTruthy();
      const boxes = fig!.querySelectorAll(".guide-markbox");
      const badges = fig!.querySelectorAll(".guide-shot-frame > .guide-markpin");
      const legend = fig!.querySelectorAll(".guide-marklegend-i");
      expect(boxes.length, `${file}: ${boxes.length} boxes for ${marks.marks.length} marks`).toBe(marks.marks.length);
      expect(badges.length, `${file}: a box without a number on it`).toBe(marks.marks.length);
      expect(legend.length, `${file}: ${legend.length} legend rows for ${marks.marks.length} boxes`).toBe(
        marks.marks.length,
      );
      // Every legend row says what the capture recorded — not a re-typed caption that could drift.
      const rows = [...legend].map((n) => n.textContent ?? "");
      for (const m of marks.marks) {
        expect(
          rows.some((r) => r.includes(m.label)),
          `${file}: the legend does not carry “${m.label}”`,
        ).toBe(true);
      }
    }
  });

  it("the overlay's viewBox is the capture's own size, so the boxes land where they were measured", () => {
    const { container } = render(<GuidePane version="1" />);
    // Every marked picture, each found by its own file — not "the first svg on the page", which
    // only matches `markedFiles[0]` when the welcome-page shot happens to lead the manual.
    for (const file of markedFiles) {
      const marks = GUIDE_MARKS[file]!;
      const fig = [...container.querySelectorAll("figure.guide-shot")].find(
        (f) => (f.querySelector("img")?.getAttribute("src") ?? "").includes(file.replace(".png", "")),
      );
      const svg = fig?.querySelector("svg.guide-marks");
      expect(svg, `${file}: no overlay drawn`).toBeTruthy();
      expect(svg!.getAttribute("viewBox"), file).toBe(`0 0 ${marks.w} ${marks.h}`);
    }
  });

  it("an unmarked picture draws no overlay at all", () => {
    // Most snapshots have no call-outs. An empty <svg> over them would still take a layer and
    // (with a stray stroke) print a line across the picture.
    const { container } = render(<GuidePane version="1" />);
    const figures = [...container.querySelectorAll("figure.guide-shot")];
    const unmarked = figures.filter((f) => f.querySelector("svg.guide-marks") === null);
    expect(unmarked.length, "every picture has an overlay — the unmarked ones should have none").toBeGreaterThan(0);
    expect(figures.length - unmarked.length).toBe(markedFiles.length);
  });

  it("carries the call-outs into the enlargement too", () => {
    // The thumbnail is small; the enlargement is where someone actually reads the numbers off.
    const { container } = render(<GuidePane version="1" />);
    const fig = [...container.querySelectorAll("figure.guide-shot")].find((f) => f.querySelector("svg.guide-marks"))!;
    fireEvent.click(fig.querySelector("button.guide-shot-zoom")!);
    const box = container.querySelector(".guide-lightbox")!;
    expect(box.querySelector("svg.guide-marks"), "the enlargement lost its call-outs").toBeTruthy();
    expect(box.querySelectorAll(".guide-marklegend-i").length, "the enlargement lost its legend").toBeGreaterThan(0);
  });
});

/**
 * "Where is everything" — the reference chapter that lists the index by route.
 *
 * Guards against an `index` block that renders as nothing: a block kind that falls out of the
 * switch makes React draw empty, so the chapter would show its headings and no tables without
 * any error. The component has an exhaustiveness guard; this is the runtime half.
 */
describe("the “Where is everything” chapter", () => {
  it("exists, in the Reference group", () => {
    const s = GUIDE.find((x) => x.id === "where");
    expect(s, "the where-is-everything chapter is gone").toBeTruthy();
    expect(s!.group).toBe("Reference");
  });

  it("renders a table for every route it asks for — none of them empty", () => {
    const { container } = render(<GuidePane version="1" />);
    const chapter = container.querySelector("#guide-where")!;
    const asked = GUIDE.find((x) => x.id === "where")!.blocks.filter((b) => b.kind === "index").length;
    expect(asked, "the chapter asks for no index tables").toBeGreaterThanOrEqual(6);
    const tables = chapter.querySelectorAll("table.guide-index");
    expect(tables.length, `${asked} routes asked for, ${tables.length} tables rendered`).toBe(asked);
    for (const t of tables) expect(t.querySelectorAll("tbody tr").length, "an empty route table").toBeGreaterThan(0);
  });

  it("every row names a route and the function reached by it", () => {
    const { container } = render(<GuidePane version="1" />);
    const rows = [...container.querySelectorAll("#guide-where table.guide-index tbody tr")];
    expect(rows.length, "the chapter lists nothing").toBeGreaterThan(120);
    for (const r of rows.slice(0, 60)) {
      expect((r.querySelector("th")?.textContent ?? "").trim().length, "a row with no route").toBeGreaterThan(3);
      expect((r.querySelector(".guide-indexname")?.textContent ?? "").trim().length, "a row with no name").toBeGreaterThan(1);
    }
  });

  it("lists the menu commands under their real menu paths", () => {
    const { container } = render(<GuidePane version="1" />);
    const text = container.querySelector("#guide-where")!.textContent ?? "";
    expect(text).toContain("File ▸ Save…");
    expect(text).toContain("Inspector ▸ Axis ▸ Range");
    expect(text).toContain("Toolbar ▸ Save");
  });
});
