import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AboutCard, citation } from "./AboutPane";
import { BetaBanner } from "./BetaBanner";
import { METHOD_GROUPS } from "./analysis";
import { GUIDE, GUIDE_GROUPS, type GuideBlock, type GuideVia } from "./guide";
import { guideIndex, whereLine, type GuideEntry } from "./guideIndex";
import { headingSlug } from "./guideIds";
import { searchGuide, type ChapterHit, type FunctionHit, type GuideResults } from "./guideSearch";
import { HOW_TO_SHOTS, howTosBySurface, type HowToSurface } from "./howTo";
import { toursByTheme, type TourId } from "./tour";

/**
 * Where the manual should open. `section` scrolls to a chapter; `entry` lands in the chapter's
 * prose at the most specific place that explains the function (its how-to row, its group's
 * heading, or the chapter top), which is how a "?" button, a Ctrl+K hit or the Ask bar's popup
 * puts a reader in front of the explanation rather than a results list.
 */
export interface GuideTarget {
  section?: string | undefined;
  /**
   * A function, landed in the chapter's prose: the control's own how-to row if it has one,
   * else its group's heading, else the chapter top (`proseAnchors`). Every
   * door — the Ask bar's popup, the "?" buttons and Ctrl+K — lands this way. Opening the
   * search view with the entry's name typed in would isolate the one control with its route
   * but show a results list where the reader expects an explanation.
   */
  entry?: string | undefined;
}

/**
 * Where an entry lives in the prose — the ids the chapters actually render, most specific
 * first. `howto:<id>` rows are `howto-<id>`; an Inspector section or Axis group
 * (`insp:<slug>` / `axis:<slug>`) has a how-to group heading `howto-group-<slug>`; everything
 * has a chapter. The caller keeps the first one that is on the page.
 */
export function proseAnchors(e: { id: string; section: string }): string[] {
  const out: string[] = [];
  const m = /^(howto|insp|axis):(.+)$/.exec(e.id);
  if (m?.[1] === "howto") out.push(`howto-${m[2]}`);
  if (m?.[1] === "insp" || m?.[1] === "axis") out.push(`howto-group-${m[2]}`);
  out.push(`guide-${e.section}`);
  return out;
}

/**
 * Every bundled manual snapshot, keyed by bare filename ("style-preset-cards.png" → its built
 * URL). The glob is eager so a "shot" block resolves synchronously, and `guide-shots.test.ts`
 * holds the two directions default-deny: a block naming a file not in here fails, and a file
 * in here that no block names fails (an image shipping for nothing).
 */
export const GUIDE_SHOTS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../assets/guide/*.png", { eager: true, query: "?url", import: "default" })).map(
    ([path, url]) => [path.split("/").pop()!, url as string],
  ),
);

/**
 * Every bundled manual video, keyed by bare filename. Held to the `video` blocks in both
 * directions by `guide-videos.test.ts`, as the pictures are by `guide-shots.test.ts`.
 */
export const GUIDE_VIDEOS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("../assets/guide/*.webm", { eager: true, query: "?url", import: "default" })).map(
    ([path, url]) => [path.split("/").pop()!, url as string],
  ),
);

/** One numbered call-out: a box in the capture's own pixels, and what to call the thing in it. */
export interface GuideMark {
  n: number;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}
/** A capture's size (CSS px, the same units the marks are in) and its call-outs. */
export interface GuideMarks {
  w: number;
  h: number;
  marks: GuideMark[];
}

/**
 * The call-out coordinates beside each snapshot, keyed by the PNG's name.
 *
 * Measured at capture time by `scripts/gen-guide-shots.mjs`, never written by hand: a box is
 * a claim that a named control is at that spot, and a hand-placed one goes quietly wrong the
 * first time a panel moves. A file with no `.marks.json` simply has no call-outs.
 */
export const GUIDE_MARKS: Record<string, GuideMarks> = Object.fromEntries(
  Object.entries(import.meta.glob("../assets/guide/*.marks.json", { eager: true, import: "default" })).map(
    ([path, data]) => [path.split("/").pop()!.replace(/\.marks\.json$/, ""), data as GuideMarks],
  ),
);

/**
 * "Where is everything" — every function reachable by one route, as a table.
 *
 * Built from `guideIndex()`, never hand-listed: a chapter that names two hundred controls in
 * prose is the one that goes stale first, and the index is already default-deny over the
 * registries the program keeps.
 *
 * Sorted by the route rather than the name, so the menus read menu by menu and the Inspector
 * reads tab by tab — a reader scanning this is looking in a place, not for a word.
 */
const VIA_HEADING: Record<GuideVia, string> = {
  menu: "In the menus",
  toolbar: "On the toolbar",
  inspector: "In the Inspector — the right-hand panel",
  dialog: "In a dialog",
  context: "On a right-click",
  figure: "By working on the figure",
  sheet: "By working in the datasheet",
  keys: "On the keyboard",
};

function IndexTable({ via }: { via: GuideVia }) {
  const rows = guideIndex()
    .flatMap((e) => e.where.filter((w) => w.via === via).map((w) => ({ e, line: whereLine(w) })))
    .sort((a, b) => a.line.localeCompare(b.line) || a.e.name.localeCompare(b.e.name));
  if (rows.length === 0) return null;
  return (
    <>
    <h4 className="guide-indexh">
      {VIA_HEADING[via]} <span className="guide-indexn">{rows.length}</span>
    </h4>
    <div className="guide-tablewrap">
      <table className="guide-index">
        <tbody>
          {rows.map(({ e, line }, i) => (
            <tr key={`${e.id}-${i}`}>
              <th scope="row">{line}</th>
              <td>
                <span className="guide-indexname">{e.name}</span> — {e.what}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

/**
 * Every analysis method, grouped as the Analyze dialog groups them.
 *
 * Two registries, both the program's own: `METHOD_GROUPS` decides the grouping and the order
 * (it is the list the dialog's catalogue renders), and the index supplies each method's name
 * and its when-to-use sentence — which came from `METHOD_INFO` in the first place. Nothing is
 * listed here, so a method added to the dialog appears in the manual without being typed twice.
 *
 * A group whose methods are all missing from the index would be an empty heading, so it is
 * dropped rather than drawn; `guide-methods.test.tsx` fails if that ever happens to all of them.
 */
function MethodsTable() {
  const byId = new Map(guideIndex().map((e) => [e.id, e]));
  const groups = METHOD_GROUPS.map((g) => ({
    label: g.label,
    rows: g.methods.map((m) => byId.get(`method:${m}`)).filter((e): e is GuideEntry => Boolean(e)),
  })).filter((g) => g.rows.length > 0);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  return (
    <>
      <h4 className="guide-indexh">
        Every method <span className="guide-indexn">{total}</span>
      </h4>
      {groups.map((g) => (
        <table className="guide-index guide-methods" key={g.label}>
          <caption>{g.label}</caption>
          <tbody>
            {g.rows.map((e) => (
              <tr key={e.id}>
                <th scope="row">{e.name}</th>
                <td>{e.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}

/**
 * The box the picture and its call-outs share.
 *
 * The frame has to be exactly the image's rectangle, or every measured box lands somewhere
 * else. Letting it shrink-wrap does not do that: the image's own `max-width: min(100%, 52ch)`
 * is a percentage, which makes its intrinsic contribution indefinite, so the frame would take
 * the whole available width — wider than the image, with every call-out drawn to the right of
 * what it marks.
 *
 * So a marked picture inverts it: the frame owns the box (its aspect ratio is the capture's own,
 * which the marks already record) and the image fills the frame. In the enlargement the frame
 * is set to the capture's CSS-pixel width, which is the 1:1 size the app drew at.
 */
function frameStyle(marks: GuideMarks | undefined, full = false): CSSProperties | undefined {
  if (!marks) return undefined;
  const ratio = `${marks.w} / ${marks.h}`;
  // In the flow: as wide as the pane allows, but never wider than the capture really is —
  // upscaling a screenshot only blurs it. In the lightbox: exactly 1:1.
  return full ? { width: `${marks.w}px`, aspectRatio: ratio } : { maxWidth: `min(100%, ${marks.w}px)`, aspectRatio: ratio };
}

/**
 * The badge a call-out wears, on the picture and again in the legend, so the two are read as
 * one thing.
 *
 * Note: not the ➊ dingbats. They render as a plain filled disc at the size a thumbnail's
 * legend uses — a row of identical dots with no number in any of them. A styled
 * span is legible at every size and matches the badge drawn over the picture exactly.
 */
export function MarkPin({ n, style }: { n: number; style?: CSSProperties | undefined }) {
  return (
    <span className="guide-markpin" style={style} aria-hidden="true">
      {n}
    </span>
  );
}

/**
 * The Documentation tab — the program's own manual, and the index of every function in it.
 *
 * Three things stacked, in the order a reader needs them:
 *
 *  1. **The search box**, over the ranked index (`guideSearch.ts`). Typing shows functions
 *     first — each with the menu path, button or gesture that reaches it — then chapters.
 *     That is the answer to "where is axis tuning", which prose alone cannot give.
 *  2. **The contents list**, grouped (Start here / Your data / …). A flat list of every
 *     heading is a wall you scan rather than read; the groups are the questions a reader
 *     actually arrives with. It stays on screen while you type, because hiding it would take
 *     away the map at the moment someone has failed to find something.
 *  3. **Every chapter**, always rendered, in array order (`guide.test.ts` pins that order to
 *     the groups). Filtering the page down to matches would break every anchor that did not
 *     match, so a result you clicked could scroll to nothing; the results list is the filter.
 */
/** The snapshot currently enlarged in the lightbox, or null. */
type Zoomed = { src: string; alt: string; caption: string; marks?: GuideMarks | undefined };

export function GuidePane({
  version,
  onOpenLicence,
  onStartTour,
  target,
}: {
  version?: string | undefined;
  onOpenLicence?: (() => void) | undefined;
  /** Start a guided tour from the Guided tours chapter. Absent (the popup): the list has no buttons. */
  onStartTour?: ((id: TourId) => void) | undefined;
  /** Open on this chapter or this function (Help ▸ Documentation with a destination). */
  target?: GuideTarget | undefined;
}) {
  const [query, setQuery] = useState("");
  /** The id of the element to scroll to and flash — cleared once the flash has run. */
  const [pulse, setPulse] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  /**
   * A deep-link landing scrolls instantly; a click inside the pane scrolls smoothly. A smooth
   * scroll across a long manual takes longer than the 1.6s flash, so the flash would end before
   * the reader arrives, and a popup that had just opened would drift down from the top of the
   * manual. Set by the target effect, spent by the scroll effect.
   */
  const landInstant = useRef(false);
  // In-page snapshots are deliberately small (a manual is for reading); clicking one opens it
  // full-size here. One overlay for the whole pane — never one per image.
  const [zoomed, setZoomed] = useState<Zoomed | null>(null);

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setZoomed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const results = useMemo(() => searchGuide(query), [query]);
  const searching = query.trim() !== "";
  const nothing = searching && results.functions.length === 0 && results.chapters.length === 0;

  /**
   * The results popup under the search box. Open whenever there is a query, until Escape, an
   * outside click or a chosen result dismisses it; typing reopens it. When it opens, the
   * header is scrolled to the top of the pane so the card has the room below the box; left
   * where it is, the box can sit near the bottom of the window, under the About card and the
   * "why" paragraph.
   */
  const [popDismissed, setPopDismissed] = useState(false);
  const popOpen = searching && !popDismissed;
  const head = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!popOpen) return;
    // Optional call: jsdom has no scrollIntoView, and the tests that do not care about the
    // scroll should not have to stub it.
    head.current?.scrollIntoView?.({ block: "start", behavior: "auto" });
    const onDown = (e: MouseEvent): void => {
      if (head.current && !head.current.contains(e.target as Node)) setPopDismissed(true);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [popOpen]);

  /**
   * Land on the requested chapter or function.
   *
   * A deep link that only scrolls is a link a reader loses: the page moves, and nothing says
   * which of the paragraphs on screen was the point. So the destination also flashes.
   */
  useEffect(() => {
    if (!target) return;
    landInstant.current = true;
    if (target.entry) {
      const e = guideIndex().find((x) => x.id === target.entry);
      if (e) {
        // Every chapter is already on the page (nothing is filtered out), so the most
        // specific anchor that exists can be picked right here.
        const doc = root.current?.ownerDocument;
        const anchor = proseAnchors(e).find((id) => doc?.getElementById(id)) ?? `guide-${e.section}`;
        setQuery("");
        setPulse(anchor);
        return;
      }
    }
    if (target.section) {
      setQuery("");
      setPulse(`guide-${target.section}`);
    }
  }, [target]);

  // Scroll + flash, once the element the target names is actually in the DOM (setting the
  // query above re-renders the results list first).
  useEffect(() => {
    if (!pulse) return;
    const el = root.current?.ownerDocument.getElementById(pulse);
    if (!el) return;
    el.scrollIntoView({ block: "start", behavior: landInstant.current ? "auto" : "smooth" });
    landInstant.current = false;
    el.classList.add("guide-pulse");
    const t = setTimeout(() => {
      el.classList.remove("guide-pulse");
      setPulse(null);
    }, 1600);
    return () => clearTimeout(t);
  }, [pulse, query]);

  /** Jump to a chapter from a search hit or the contents list, and flash it on arrival. A
   *  chosen result also closes the results popup — the reader has their answer. */
  const goToSection = (id: string): void => {
    setPopDismissed(true);
    setPulse(`guide-${id}`);
  };

  return (
    <div className="guide" ref={root}>
      <BetaBanner />
      {/* Note: the card is on both tabs, deliberately. Help ▸ About MadY is the direct route
          for someone who only wants the version or the licence; here it is the header of the
          manual, which is where a reader already looking things up expects to find what the
          program is. `GuidePane.test.tsx` pins its presence in both places. One
          `AboutCard`, rendered twice: they cannot drift. */}
      <AboutCard version={version} onOpenLicence={onOpenLicence} />
      {/* Why the program exists, above the manual's own title — a reader who has just met the
          program should get the reason before the table of contents.
          It names no other product: "an expensive licence" carries the point. */}
      <section className="guide-why" aria-label="Why MadY exists">
        <p>
          MadY is free and open-source software for scientific graphing and statistics. It exists
          because publication-quality figures should not require an expensive licence, a
          subscription, or sending your data to someone else’s computer.
        </p>
      </section>
      <header className="guide-head" ref={head}>
        <h2 className="h">MadY documentation</h2>
        <p className="note">How the program works, in the order you are likely to need it.</p>
        <input
          className="guide-search"
          type="search"
          aria-label="Search the documentation"
          placeholder="Search — a function, a control, or what you are trying to do"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPopDismissed(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // preventDefault: on a `type="search"` input Chromium's own Escape clears the
              // text, so the query would vanish with the popup. A jsdom guard cannot see this
              // (jsdom has no native behaviour); it shows only in a real browser.
              e.preventDefault();
              setPopDismissed(true);
            }
          }}
        />
        {/* The results are a popup under the box. Rendered after the contents list, the first
            result would sit below the bottom of the window, so typing would seem to show nothing.
            Escape, an outside click or a chosen result closes the card; typing reopens it. */}
        {popOpen && (
          <div className="guide-searchpop" role="region" aria-label="Search results">
            {nothing && (
              <p className="note guide-empty">
                Nothing here matches “{query}”. Try a plainer word — the documentation is written the way the
                program talks, so “export”, “error bar” or “bug” will find more than a technical term.
              </p>
            )}
            {!nothing && <SearchResults results={results} onGoToSection={goToSection} />}
          </div>
        )}
      </header>

      {/* The contents list never disappears. Hiding it while typing would take away the one
          thing that shows what the manual contains, at exactly the moment a search has failed
          to find something. */}
      <nav className="guide-toc" aria-label="Contents">
        {GUIDE_GROUPS.map((g) => {
          const inGroup = GUIDE.filter((s) => s.group === g);
          if (inGroup.length === 0) return null;
          return (
            <div key={g} className="guide-tocgroup">
              <h4 className="guide-tocgh">{g}</h4>
              {inGroup.map((s) => (
                <a key={s.id} href={`#guide-${s.id}`} className="guide-toclink" onClick={() => goToSection(s.id)}>
                  {s.title}
                </a>
              ))}
            </div>
          );
        })}
      </nav>

      {/* Every chapter renders, searching or not. Filtering the page down to the matches
          would break every anchor that did not match — a clicked result could scroll to nothing.
          The results above are the filter; this is the document they point into. */}
      {GUIDE.map((s) => (
        // A chapter carrying the function index leaves the 760px reading column: its table is
        // scanned, not read, and needs the whole window for the description column.
        <section
          key={s.id}
          id={`guide-${s.id}`}
          className={s.blocks.some((b) => b.kind === "index") ? "guide-sec guide-wide" : "guide-sec"}
        >
          <p className="guide-kicker">{s.group}</p>
          <h3 className="guide-h">{s.title}</h3>
          <p className="guide-sum">{s.summary}</p>
          {s.blocks.map((b, i) => (
            <Block key={i} block={b} version={version} onZoom={setZoomed} onStartTour={onStartTour} />
          ))}
        </section>
      ))}

      {zoomed && (
        // An opaque card, not a floating image: nothing half-shows through it, the caption sits
        // on its own solid footer, and the capture displays at 1:1 app scale — squeezing a tall
        // capture to fit the window would make its text unreadably small, which defeats a manual.
        // The card scrolls instead. Backdrop click, the Close button or Escape dismiss it;
        // clicks inside the card do not (reading and scrolling must never close it).
        <div
          className="guide-lightbox"
          role="dialog"
          aria-label={`Enlarged snapshot: ${zoomed.caption}`}
          onClick={() => setZoomed(null)}
        >
          <div className="guide-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <div className="guide-lightbox-scroll">
              <span
                className={`guide-shot-frame${zoomed.marks ? " is-marked" : ""}`}
                style={frameStyle(zoomed.marks, true)}
              >
                <img
                  src={zoomed.src}
                  alt={zoomed.alt}
                  onLoad={(e) => {
                    // Captures are taken at 2× device pixels (scripts/gen-guide-shots.mjs), so
                    // naturalWidth/2 CSS px is exactly the size the app drew at — crisp and
                    // readable, never fit-to-window-shrunk. A marked picture gets that width
                    // from its frame instead (the marks already record it), so the image can
                    // simply fill the frame and the boxes cannot drift from it.
                    if (!zoomed.marks) e.currentTarget.style.width = `${e.currentTarget.naturalWidth / 2}px`;
                  }}
                />
                <MarkOverlay marks={zoomed.marks} />
              </span>
            </div>
            <div className="guide-lightbox-foot">
              <p className="guide-lightbox-cap">{zoomed.caption}</p>
              <MarkLegend marks={zoomed.marks} />
              <button type="button" className="guide-lightbox-close" onClick={() => setZoomed(null)}>
                Close (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

/**
 * One block of a chapter.
 *
 * The `never` at the foot is not decoration. Adding a variant to `GuideBlock` and forgetting
 * a case here compiles clean — the function simply returns `undefined`, which React renders as
 * nothing, and the block is silently missing from the manual. That is exactly the silent no-op
 * this project treats as a defect.
 */
function Block({
  block,
  version,
  onZoom,
  onStartTour,
}: {
  block: GuideBlock;
  version?: string | undefined;
  onZoom?: ((z: Zoomed) => void) | undefined;
  onStartTour?: ((id: TourId) => void) | undefined;
}) {
  switch (block.kind) {
    case "tours":
      // Listed from the registry, so the chapter cannot name a tour the program does not have.
      // The Start button's words are CSS content (`.guide-tourstart::before`): the `<li>`'s
      // textContent stays the tour's own words for the HTML export and the search.
      return (
        <>
          {toursByTheme().map((g) => (
            <div key={g.theme}>
              <h4 className="guide-sub">{g.theme}</h4>
              <ul className="guide-ul guide-tours">
                {g.tours.map((t) => (
                  <li key={t.id}>
                    <span className="guide-tours-text">
                      <span className="guide-tours-name">{t.title}</span> — <span className="guide-tours-summary">{t.summary}</span>{" "}
                      <span className="guide-tours-level">({t.level})</span>
                    </span>
                    {onStartTour && (
                      <button type="button" className="guide-tourstart" data-tour-id={t.id} aria-label={`Start the tour: ${t.title}`} title="Start this tour in the program" onClick={() => onStartTour(t.id)} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      );
    case "cite":
      // Same `citation()` as the About card, so the two lines cannot drift apart.
      return (
        <p className="guide-p">
          <code className="about-cite">{citation(version)}</code>
        </p>
      );
    case "p":
      return <p className="guide-p">{block.text}</p>;
    case "ul":
      return (
        <ul className="guide-ul">
          {block.items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol className="guide-steps">
          {block.items.map((it, i) => {
            // A step is either a bare sentence or a step with its picture, placed under it
            // rather than at the top of the section — which is what turns a description into an instruction.
            const step = typeof it === "string" ? { text: it } : it;
            return (
              <li key={i}>
                {step.text}
                {step.shot && (
                  <ShotFigure file={step.shot.file} alt={step.shot.alt} caption={step.shot.caption} onZoom={onZoom} />
                )}
              </li>
            );
          })}
        </ol>
      );
    case "goal":
      return (
        <p className="guide-goal">
          <b>Goal:</b> {block.text}
        </p>
      );
    case "h":
      return <h4 className="guide-sub">{block.text}</h4>;
    case "table":
      return <RefTable head={block.head} rows={block.rows} />;
    case "note":
      return <p className="guide-note">{block.text}</p>;
    case "keys":
      return (
        <table className="guide-keys">
          <tbody>
            {block.rows.map((r) => (
              <tr key={r.keys}>
                <th scope="row">
                  <kbd>{r.keys}</kbd>
                </th>
                <td>{r.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    case "index":
      return <IndexTable via={block.via} />;
    case "methods":
      return <MethodsTable />;
    case "shot":
      return <ShotFigure file={block.file} alt={block.alt} caption={block.caption} onZoom={onZoom} />;
    case "video":
      return <VideoFigure file={block.file} alt={block.alt} caption={block.caption} />;
    case "howto":
      return <HowToList surface={block.surface} onZoom={onZoom} />;
    default: {
      // The exhaustiveness guard. Without it, adding a variant to `GuideBlock` compiles clean
      // and the block renders as nothing — the function just falls out of the switch returning
      // `undefined`, which React draws as empty: a chapter would render its headings and no
      // tables, and nothing would complain.
      const missed: never = block;
      throw new Error(`GuidePane: no renderer for the "${(missed as { kind: string }).kind}" block`);
    }
  }
}

/**
 * A reference table.
 *
 * A row whose first cell starts with "§" is a group heading inside the table, not a control —
 * sixty rows in one flat list is a list nobody reads, and the panel's own grouping is structure
 * the reader already has in front of them. It spans the width and carries no other cells.
 */
function RefTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="guide-tablewrap">
      <table className="guide-table">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) =>
            r[0]?.startsWith("§ ") ? (
              <tr key={i} className="guide-table-group">
                <th colSpan={head.length} scope="colgroup">
                  {r[0].slice(2)}
                </th>
              </tr>
            ) : (
              <tr key={i}>
                {head.map((_, c) => (
                  <td key={c}>{r[c] ?? ""}</td>
                ))}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One screen recording, with the player's own controls.
 *
 * `preload="metadata"` loads only the length and the first frame (the video's title card), so a
 * chapter with five videos opens instantly; the rest loads when ▶ is pressed.
 * `data-video` is the file name, for the same reason `data-shot` is on a picture: the standalone
 * manual is generated by walking this DOM, and the bundled URL carries a hash, not the name.
 */
function VideoFigure({ file, alt, caption }: { file: string; alt: string; caption: string }) {
  // A missing file cannot ship — guide-videos.test.ts is default-deny on this map.
  const url = GUIDE_VIDEOS[file];
  if (!url) return null;
  return (
    <figure className="guide-video">
      <video src={url} controls preload="metadata" aria-label={alt} data-video={file} />
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/**
 * One snapshot with its call-outs, its legend, and click-to-enlarge.
 *
 * Its own component because two things show a picture: a `shot` block, and the how-to page,
 * which puts the capture at the head of each run of controls it shows. Two copies of this markup
 * would drift, and the one that drifted would be the one nobody looked at.
 */
function ShotFigure({
  file,
  alt,
  caption,
  onZoom,
}: {
  file: string;
  alt: string;
  caption: string;
  onZoom?: ((z: Zoomed) => void) | undefined;
}) {
  // A missing file cannot ship — guide-shots.test.ts is default-deny on exactly this map — so
  // this guard only covers a development build whose snapshots have not been captured yet.
  const url = GUIDE_SHOTS[file];
  if (!url) return null;
  const marks = GUIDE_MARKS[file];
  return (
    <figure className="guide-shot">
      <button
        type="button"
        className="guide-shot-zoom"
        title="Click to enlarge"
        aria-label={`Enlarge: ${caption}`}
        onClick={() => onZoom?.({ src: url, alt, caption, marks })}
      >
        <span className={`guide-shot-frame${marks ? " is-marked" : ""}`} style={frameStyle(marks)}>
          {/* Not loading="lazy": these are small local assets in an offline app — lazy loading
              buys nothing, makes scrolled-past images pop in, and can leave ones far above the
              viewport unloaded. */}
          {/* `data-shot` is the file name, and it is load-bearing outside the app: the standalone
              manual is generated by walking this DOM, and Vite inlines a small asset as a `data:`
              URI — from which no file name can be recovered. Without this the generator could not
              find the picture's measured call-outs. */}
          <img src={url} alt={alt} data-shot={file} />
          <MarkOverlay marks={marks} />
        </span>
      </button>
      <figcaption>
        {caption}
        <MarkLegend marks={marks} />
      </figcaption>
    </figure>
  );
}

/**
 * The how-to page for one surface — the answer to "I want to X, how do I do that?".
 *
 * One block per group of controls, each opening with the capture that shows that group and then
 * listing its controls: the name (with its call-out number, so the picture and the words are read
 * as one thing), what it does, and the gesture. A control that is not always there says so.
 *
 * The picture is emitted when the file changes, walking the rows — not once per group, and not
 * once per group's first picture. Several groups share a capture (the Axis tab's Ticks and
 * Numbering are photographed together), so once-per-group would repeat the same image under every
 * heading; and one group can span two captures (the 3-D scatter's edge panel is photographed top
 * and bottom), so taking only the group's first file would drop the second picture entirely while
 * its seven how-tos still carry call-out numbers pointing into it.
 */
function HowToList({ surface, onZoom }: { surface: HowToSurface; onZoom?: ((z: Zoomed) => void) | undefined }) {
  const groups = howTosBySurface(surface);
  let shown = "";
  return (
    <div className="guide-howto">
      {groups.map(({ group, rows }) => (
        // The id is the deep-link landing for an Inspector section / Axis group entry
        // (`proseAnchors`): the same slug `guideIds` gives the entry, so the two cannot drift.
        <section key={group} className="guide-howto-group" id={`howto-group-${headingSlug(group)}`}>
          <h4 className="guide-howto-h">{group}</h4>
          <dl className="guide-howto-rows">
            {rows.map((r) => {
              const file = r.shot?.file;
              const shot = file && file !== shown ? HOW_TO_SHOTS.find((s) => s.file === file) : undefined;
              if (file) shown = file;
              return (
                <div key={r.id} className="guide-howto-row" id={`howto-${r.id}`}>
                  {shot && (
                    <div className="guide-howto-shot">
                      <ShotFigure file={shot.file} alt={shot.alt} caption={shot.caption} onZoom={onZoom} />
                    </div>
                  )}
                  <dt className="guide-howto-name">
                    {r.shot && <MarkPin n={r.shot.mark} />} {r.name}
                  </dt>
                  <dd className="guide-howto-body">
                    <span className="guide-howto-what">{r.what}</span>{" "}
                    <span className="guide-howto-do">{r.how}</span>
                    {r.only && <span className="guide-howto-only">Only there when: {r.only}</span>}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * The numbered boxes, drawn over the snapshot from the coordinates recorded at capture time.
 *
 * The overlay is an `<svg viewBox>` sized to the capture's own pixels and stretched to exactly
 * the rendered image, so one set of coordinates works at every size the image is shown at — the
 * thumbnail in the flow of the text and the 1:1 enlargement in the lightbox. `preserveAspect
 * Ratio="none"` is safe here precisely because the box and the image have the same aspect: the
 * stretch is uniform.
 *
 * `aria-hidden`: the same information is in the legend below, as text, where a screen reader can
 * reach it in reading order. A duplicate set of numbers would just be noise.
 */
function MarkOverlay({ marks }: { marks?: GuideMarks | undefined }) {
  if (!marks || marks.marks.length === 0) return null;
  return (
    <>
      <svg
        className="guide-marks"
        viewBox={`0 0 ${marks.w} ${marks.h}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        {marks.marks.map((m) => (
          <g key={m.n}>
            {/* Two strokes: a white one under a coloured one, so the box reads on a pale panel
                and on a dark figure. A single stroke disappears into whichever it matches.
                `non-scaling-stroke`, or the line thins to nothing in the thumbnail and goes
                fat in the enlargement — the same box would look like two different things. */}
            <rect className="guide-markbox-halo" x={m.x - 2} y={m.y - 2} width={m.w + 4} height={m.h + 4} rx={6} />
            <rect className="guide-markbox" x={m.x - 2} y={m.y - 2} width={m.w + 4} height={m.h + 4} rx={6} />
          </g>
        ))}
      </svg>
      {/* The numbers are HTML, positioned in percentages of the picture. Inside the SVG they
         would scale with the viewBox and shrink to a few pixels in a thumbnail: a row of dots
         with no readable digit. As spans they are the same size whatever size the picture is
         shown at. */}
      {marks.marks.map((m) => (
        <MarkPin
          key={m.n}
          n={m.n}
          style={{ position: "absolute", left: `${(m.x / marks.w) * 100}%`, top: `${(m.y / marks.h) * 100}%` }}
        />
      ))}
    </>
  );
}

/**
 * The legend under the picture: ➊ Menu bar ➋ Toolbar …
 *
 * It is generated from the same `marks.json` the boxes are drawn from, so the picture and the
 * words beneath it cannot disagree — which is the failure a hand-written caption list always
 * eventually has.
 */
function MarkLegend({ marks }: { marks?: GuideMarks | undefined }) {
  if (!marks || marks.marks.length === 0) return null;
  return (
    <span className="guide-marklegend">
      {marks.marks.map((m) => (
        <span key={m.n} className="guide-marklegend-i">
          <MarkPin n={m.n} /> {m.label}
        </span>
      ))}
    </span>
  );
}

/** Long result lists stop being answers. Past this, the useful advice is "add a word". */
const MAX_HITS = 12;

/** The title of the chapter an entry belongs to, for its "read about it" link. */
const chapterTitle = (id: string): string => GUIDE.find((s) => s.id === id)?.title ?? id;

/**
 * One function hit: the name, every route to it, and the chapter that explains it.
 *
 * The routes are the whole point — a hit that only names the thing is the failure this search
 * exists to fix. Several are listed when a function has several doors (a menu row, a
 * toolbar button and a right-click), because which one a reader can find is not ours to guess.
 */
function FunctionResult({
  hit,
  onGoToSection,
}: {
  hit: FunctionHit;
  onGoToSection: (id: string) => void;
}) {
  const e: GuideEntry = hit.entry;
  return (
    <li className="guide-hit" id={`guide-hit-${e.id}`}>
      <p className="guide-hitname">{e.name}</p>
      <ul className="guide-wheres">
        {e.where.map((w, i) => (
          <li key={i} className="guide-where">
            {whereLine(w)}
          </li>
        ))}
      </ul>
      <p className="guide-hitwhat">{e.what}</p>
      <a className="guide-hitchapter" href={`#guide-${e.section}`} onClick={() => onGoToSection(e.section)}>
        Read: {chapterTitle(e.section)}
      </a>
    </li>
  );
}

/** One chapter hit: its title, its one-line summary, and the sentence the query matched. */
function ChapterResult({
  hit,
  onGoToSection,
}: {
  hit: ChapterHit;
  onGoToSection: (id: string) => void;
}) {
  const s = hit.section;
  return (
    <li className="guide-hit guide-hit-chapter">
      <a className="guide-hitname" href={`#guide-${s.id}`} onClick={() => onGoToSection(s.id)}>
        {s.title}
      </a>
      <p className="guide-hitwhat">{s.summary}</p>
      {hit.snippet !== "" && <p className="guide-snippet">“{hit.snippet}”</p>}
    </li>
  );
}

/**
 * The search results: functions first. Someone typing into a manual is usually looking for a
 * control, not for a chapter — so the lead answers are the things you can press, each with
 * the route to it, and the chapters follow for the reader who wants the explanation.
 */
function SearchResults({
  results,
  onGoToSection,
}: {
  results: GuideResults;
  onGoToSection: (id: string) => void;
}): React.ReactElement {
  return (
    <div className="guide-results">
      {results.functions.length > 0 && (
        <section className="guide-resgroup" aria-label="Functions">
          <h3 className="guide-resh">
            Functions <span className="guide-rescount">{results.functions.length}</span>
          </h3>
          <ul className="guide-hits">
            {results.functions.slice(0, MAX_HITS).map((h) => (
              <FunctionResult key={h.entry.id} hit={h} onGoToSection={onGoToSection} />
            ))}
          </ul>
          {results.functions.length > MAX_HITS && (
            <p className="note guide-more">
              …and {results.functions.length - MAX_HITS} more. Add a word to narrow it down.
            </p>
          )}
        </section>
      )}
      {results.chapters.length > 0 && (
        <section className="guide-resgroup" aria-label="Chapters">
          <h3 className="guide-resh">
            Chapters <span className="guide-rescount">{results.chapters.length}</span>
          </h3>
          <ul className="guide-hits">
            {results.chapters.slice(0, MAX_HITS).map((h) => (
              <ChapterResult key={h.section.id} hit={h} onGoToSection={onGoToSection} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
