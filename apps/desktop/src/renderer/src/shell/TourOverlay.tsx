/**
 * The guided tour's highlight — the rest of the window darkens, the control to press stands out,
 * and a card says what to do. Steps and their done-checks live in `tour.ts`; this file only draws
 * and polls.
 *
 * Dim only. The dark layer is the ring's shadow, and the ring has `pointer-events: none`, so
 * every click lands on the program exactly as it would without the tour — including clicks on
 * things the tour is not pointing at. Only the card takes clicks. A reader who wanders is never
 * trapped, and a control under the dark can still be pressed.
 *
 * The highlight follows the DOM, not the render. A menu opening does not re-render the shell,
 * and a dialog's button is not on screen until the dialog is. So the anchor is looked up on a
 * short timer: the first of the step's selectors that exists gets the ring, re-measured each tick
 * so it tracks resizes, scrolls and panels sliding open. 100 ms is well under the eye's notice
 * and one `querySelector` + one `getBoundingClientRect` per tick is negligible.
 *
 * Advance on the document. `state` is read off the program by the shell every render; when the
 * current step's check says done, the next step starts and remembers the state it started in.
 * The check runs on entry with `now === start`, so `tour.test.ts` pins that no step is true
 * there — otherwise a step would skip itself before the card was read.
 */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { needMet, REACH_LABEL, stepDone, type TourNeed, type TourPerform, type TourReach, type TourState, type TourStep } from "./tour";

/** How far the ring stands off the control it lights, in px. */
const PAD = 6;
/** The card's width, matched by `.tour-card` in shell.css. */
const CARD_W = 340;
/** Anchor re-measure period, ms. */
const TICK_MS = 100;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The state a step is entered in, made safe to keep. The document mutates in place: the plot
 * the shell hands over is the live object, so a check comparing "the plot now" with "the plot at
 * entry" would compare the object with itself and never fire (for example, the axis tour would
 * stay on its Range step with the typed value in the box). The fingerprint is already that plot serialised
 * at that render, so the frozen copy costs one parse per step, not one clone per render.
 */
export const freeze = (s: TourState): TourState =>
  s.activePlot ? { ...s, activePlot: { ...s.activePlot, plot: JSON.parse(s.activePlot.fingerprint) as TourState["activePlot"] extends infer A ? (A extends { plot: infer P } ? P : never) : never } } : s;

const sameRect = (a: Rect | null, b: Rect | null): boolean =>
  a === b || (a !== null && b !== null && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * The words an element is known by: its first `<span>` child (an Inspector row's label) or else
 * its own text (a tab, a group heading, a ribbon tickbox). CSS-drawn glyphs (the "?" buttons) are
 * not in textContent, so a heading's label is its title.
 */
/** The discreet line under an Inspector card: the lit row may sit below the fold of that panel. */
export const INSPECTOR_HINT = "If the option is not in view, scroll the Inspector up or down (mouse wheel).";
/** A step whose control lives in the Inspector — a row, a group heading, a section heading or a tab. */
export const inInspector = (step: TourStep): boolean => step.anchors.some((a) => /^\.(frow|insphd|inspsub2|inspcat)\b/.test(a));

export function labelOf(el: Element): string {
  const span = el.querySelector(":scope > span");
  if (span) return norm(span.textContent);
  // Its own words only: a `<label>Frame<select>…</select></label>` is "Frame", not "Frame L-shape
  // Box Offset". A row with no words of its own (inputs and a button) falls back to everything.
  const own = norm([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? "").join(" "));
  return own || norm(el.textContent);
}

/**
 * Every element an anchor names, in DOM order. `<css> :: <label>` keeps only those whose label is
 * <label> — exactly, or followed by a count badge ("Series 3"). Never a prefix of other words:
 * "Tick interval" must not light "Tick interval fine".
 */
export function findAnchors(anchor: string, doc: Document = document): Element[] {
  const at = anchor.indexOf(" :: ");
  if (at < 0) return [...doc.querySelectorAll(anchor)];
  const css = anchor.slice(0, at);
  const label = norm(anchor.slice(at + 4));
  return [...doc.querySelectorAll(css)].filter((el) => {
    const l = labelOf(el);
    return l === label || (l.startsWith(label + " ") && /^\d+$/.test(l.slice(label.length + 1)));
  });
}

/**
 * Is the element actually on screen? Three things say no, and all three occur here:
 *  - it sits inside a closed `<details>` (an Inspector section or group) and is not that
 *    group's summary — Chromium keeps layout boxes for the hidden content of a closed details
 *    (`content-visibility: hidden`), so its rows report a real size at a real position while
 *    being invisible (without this check the ring could land on a row of a closed section,
 *    just under its heading);
 *  - the browser's own verdict (`checkVisibility`: display:none, visibility:hidden,
 *    content-visibility, an ancestor with `hidden`);
 *  - a zero-size box (an unmounted dock, a collapsed panel).
 */
export function isOnScreen(el: Element): boolean {
  const closed = el.closest("details:not([open])");
  if (closed && !(el.closest("summary")?.parentElement === closed)) return false;
  const check = (el as Element & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === "function" && !check.call(el)) return false;
  const r = el.getBoundingClientRect();
  return !(r.width === 0 && r.height === 0);
}

/** The first of the step's anchors that is on screen, measured; null when none is. */
export function measureAnchor(anchors: readonly string[], doc: Document = document): Rect | null {
  for (const sel of anchors) {
    for (const el of findAnchors(sel, doc)) {
      if (!isOnScreen(el)) continue; // try the next: a closed group's row, then its heading
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }
  return null;
}

/**
 * Where the card goes: below the ring when there is room, else above, else beside; centred in
 * the window when there is no ring. Always clamped inside the viewport.
 */
export function placeCard(
  ring: Rect | null,
  card: { w: number; h: number },
  view: { w: number; h: number },
): { left: number; top: number } {
  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
  // Nothing lit: the card sits in the bottom-right corner, out of the way. In the middle it would
  // cover the work area and read as a dialog to dismiss.
  if (!ring) return { left: view.w - card.w - 24, top: view.h - card.h - 24 };
  const gap = 14;
  const cx = ring.x + ring.w / 2 - card.w / 2;
  const cy = clamp(ring.y + ring.h / 2 - card.h / 2, 8, view.h - card.h - 8);
  // A ring in a side panel (the Inspector on the right, the Project tree on the left): the card
  // goes beside the panel, never under the ring — under it, it would sit on the section headings
  // the next step needs and intercept pointer events on them.
  if (ring.x > view.w * 0.6 && ring.x - gap - card.w >= 0) return { left: ring.x - gap - card.w, top: cy };
  if (ring.x + ring.w < view.w * 0.3 && ring.x + ring.w + gap + card.w <= view.w) return { left: ring.x + ring.w + gap, top: cy };
  if (ring.y + ring.h + gap + card.h <= view.h) return { left: clamp(cx, 8, view.w - card.w - 8), top: ring.y + ring.h + gap };
  if (ring.y - gap - card.h >= 0) return { left: clamp(cx, 8, view.w - card.w - 8), top: ring.y - gap - card.h };
  if (ring.x + ring.w + gap + card.w <= view.w) return { left: ring.x + ring.w + gap, top: cy };
  return { left: clamp(ring.x - gap - card.w, 8, view.w - card.w - 8), top: cy };
}

export function TourOverlay({
  steps,
  state,
  onQuit,
  onFinish,
  onCopySample,
  onReach,
  onPerform,
}: {
  steps: readonly TourStep[];
  /** Read off the program every render; the current step's check runs against it. */
  state: TourState;
  /** The close button — leave the tour where it is. */
  onQuit: () => void;
  /** Next on the last card. */
  onFinish: () => void;
  /** "Put sample numbers on the clipboard" — the shell owns the clipboard bridge. */
  onCopySample?: (() => void) | undefined;
  /**
   * Bring what a step needs in front: the reader's own suitable sheet/graph, else a generated
   * sample. Called once on entering a step whose need is unmet (not for `choose` steps, where
   * the card offers it as a button instead).
   */
  onReach?: TourReach | undefined;
  /** Next on an unmet action step: the shell performs the step itself (see `TourPerform`). */
  onPerform?: TourPerform | undefined;
}) {
  const [index, setIndex] = useState(0);
  const [ring, setRing] = useState<Rect | null>(null);
  const [view, setView] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardH, setCardH] = useState(160);
  // The card can be dragged by its header: it takes clicks (it must — its buttons), so wherever
  // it lands it covers something, and sometimes that something is the cell the card says to
  // click. The offset resets on every step, when the card is placed afresh.
  const [drag, setDrag] = useState({ dx: 0, dy: 0 });
  // Feedback while the program is doing something for the reader (making the sample, performing
  // the step); the card must never look dead after a press.
  const [busy, setBusy] = useState<string | null>(null);
  // Advance on the next state change (after a perform or a reach), so the following step is entered
  // with the document as it now is, not as it was before the press. A timer covers a perform that
  // changes nothing observable.
  const pending = useRef<number | null>(null);
  const settle = (ms: number): void => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      setBusy(null);
      setIndex((i) => i + 1);
    }, ms);
  };
  const advanceAfterChange = (): void => settle(2500);
  const dragFrom = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const onHeadPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest("button")) return; // the close button stays a button
    dragFrom.current = { x: e.clientX, y: e.clientY, dx: drag.dx, dy: drag.dy };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onHeadPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const f = dragFrom.current;
    if (f) setDrag({ dx: f.dx + e.clientX - f.x, dy: f.dy + e.clientY - f.y });
  };
  const onHeadPointerUp = (): void => {
    dragFrom.current = null;
  };
  const startRef = useRef<TourState>(state);
  // The sheet and the graph the tour is working on — captured when a step starts with one in
  // front. "Needs a sheet" then means that sheet: a reader who switched to another sheet (two
  // sample sheets, a demo sheet) is brought back to the right one, not left on any sheet.
  const lastSheet = useRef<string | undefined>(undefined);
  const lastPlot = useRef<string | undefined>(undefined);
  const preferFor = useCallback((need: TourNeed): string | undefined => (need.endsWith("sheet") ? lastSheet.current : lastPlot.current), []);
  /** The need is met and it is the object the tour is working on (when one is known). Reads only
   *  refs and its arguments, so one identity serves the whole life of the overlay. */
  const metHere = useCallback((need: TourNeed, s: TourState): boolean => {
    if (!needMet(need, s)) return false;
    const want = preferFor(need);
    const have = need.endsWith("sheet") ? s.sheet?.id : s.activePlot?.plot.id;
    return want === undefined || have === want;
  }, [preferFor]);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const step = steps[index];

  // Remember the state each step is entered in, then test the check — in one effect, so the
  // entering state is never compared against a stale memo from the previous step.
  const lastIndex = useRef(-1);
  useEffect(() => {
    if (!step) return;
    // A perform/reach was pressed and the document is changing: move on once it has settled. A
    // perform can change the document in two moves (make the graph, then open its tab); advancing
    // after the first one would enter the next step with the old view still in front.
    if (pending.current !== null && lastIndex.current === index) {
      // The step's own state arrived (an action done, or a look step's view in front): move on now.
      if (stepDone(step, state, startRef.current) || (step.mode === "look" && step.needs !== undefined && metHere(step.needs, state))) {
        window.clearTimeout(pending.current);
        pending.current = null;
        setBusy(null);
        setIndex((i) => i + 1);
        return;
      }
      settle(300);
      return;
    }
    if (lastIndex.current !== index) {
      lastIndex.current = index;
      setDrag({ dx: 0, dy: 0 });
      startRef.current = freeze(state);
      setBusy(null);
      // Already true on entry ("open a graph" while one is open): skip without showing it.
      if (step.skipIf?.(state)) {
        setIndex((i) => i + 1);
        return;
      }
      // Remember what the step starts on; then, if the step works on a sheet or a graph that is
      // not in front (or is a different one), reach it now, so the card never talks about a view
      // the reader cannot see. A `choose` step asks instead.
      // (Only when none is known yet: once the tour is on a sheet, a different sheet the reader
      // switched to must not become "the" sheet — that is exactly the case to reach away from.)
      if (step.needs && needMet(step.needs, state)) {
        if (step.needs.endsWith("sheet") && state.sheet && lastSheet.current === undefined) lastSheet.current = state.sheet.id;
        if (step.needs.endsWith("graph") && state.activePlot && lastPlot.current === undefined) lastPlot.current = state.activePlot.plot.id;
      }
      if (step.needs && !step.choose && !metHere(step.needs, state)) onReach?.(step.needs, { preferId: preferFor(step.needs) });
    }
    // A different graph came into view since the step started (the reader clicked back from an
    // analysis tab, or opened another graph): the step is about that graph now, so the entering
    // state adopts it as it is at this moment. Nothing fires on the adoption itself (both sides
    // are now equal); the reader's next change on it does.
    // Check first, against the un-rebased start: "a graph appeared" is itself the change the
    // open-graph step waits for, and rebasing before checking would swallow it.
    if (stepDone(step, state, startRef.current)) {
      // The reader just acted on what is in front: that is the sheet / graph the tour is on
      // (a step with no `needs` — Import, Create graph — is where they first appear).
      if (state.sheet) lastSheet.current = state.sheet.id;
      if (state.activePlot) lastPlot.current = state.activePlot.plot.id;
      setIndex((i) => i + 1);
      return;
    }
    const startPlot = startRef.current.activePlot?.plot.id;
    if (state.activePlot && state.activePlot.plot.id !== startPlot) startRef.current = freeze({ ...startRef.current, activePlot: state.activePlot });
    // …and the same for a datasheet: the include step is entered from the graph the card sent the
    // reader to look at, and the sheet comes back in front only when the step reaches it.
    if (state.sheet && state.sheet.id !== startRef.current.sheet?.id) startRef.current = { ...startRef.current, sheet: state.sheet, sheetInFront: state.sheetInFront };
  }, [state, index, step, onReach, metHere, preferFor]);

  // Follow the anchor.
  useEffect(() => {
    if (!step) return;
    // `undefined` until the first measurement: a step whose anchors match nothing must clear the
    // previous step's ring, so the first tick always writes, even a null.
    let last: Rect | null | undefined;
    const tick = (): void => {
      const r = measureAnchor(step.anchors);
      if (last === undefined || !sameRect(r, last)) {
        last = r;
        setRing(r);
      }
      const v = { w: window.innerWidth, h: window.innerHeight };
      setView((old) => (old.w === v.w && old.h === v.h ? old : v));
      const h = cardRef.current?.offsetHeight ?? 0;
      if (h > 0) setCardH((old) => (old === h ? old : h));
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [step]);

  if (!step) return null;
  const last = index === steps.length - 1;
  const placed = placeCard(ring, { w: CARD_W, h: cardH }, view);
  const pos = { left: placed.left + drag.dx, top: placed.top + drag.dy };
  const advance = (): void => (last ? onFinish() : setIndex((i) => i + 1));
  /**
   * Next — verify or do. A look step: its view is brought in front if it is not, then on. An action
   * step: on if its state is already there; else the program performs it and the tour moves on once
   * the document shows the change. There is no way past a step without its state.
   */
  const next = (): void => {
    if (last) return onFinish();
    if (step.nextAdvances) return advance();
    if (step.mode === "look") {
      if (step.needs && onReach && !metHere(step.needs, state)) {
        onReach(step.needs, { preferId: preferFor(step.needs) });
        setBusy("Bringing it in front…");
        advanceAfterChange();
        return;
      }
      return advance();
    }
    if (stepDone(step, state, startRef.current)) return advance();
    if (onPerform) {
      const changed = onPerform(step, state);
      if (changed) {
        setBusy("Doing it for you…");
        advanceAfterChange();
        return;
      }
    }
    advance();
  };
  const reachSample = (): void => {
    if (!step.needs || !onReach) return;
    setBusy("Making the sample…");
    onReach(step.needs, { generate: true });
    // A choose step completes on its own once the sample is in front (its done-check); the busy
    // sign clears on that entry. If nothing arrives, the sign must not stay forever.
    window.setTimeout(() => setBusy((b) => (b === "Making the sample…" ? null : b)), 3000);
  };

  return (
    <div className="tour" data-tour-step={step.id}>
      {ring ? (
        <div
          className="tour-ring"
          style={{ left: ring.x - PAD, top: ring.y - PAD, width: ring.w + PAD * 2, height: ring.h + PAD * 2, pointerEvents: "none" }}
        />
      ) : (
        <div className="tour-dim" style={{ pointerEvents: "none" }} />
      )}
      <div ref={cardRef} className="tour-card" role="dialog" aria-label={`Guided tour, step ${index + 1} of ${steps.length}`} style={{ left: pos.left, top: pos.top, width: CARD_W }}>
        <div className="tour-card-head" title="Drag to move the card" onPointerDown={onHeadPointerDown} onPointerMove={onHeadPointerMove} onPointerUp={onHeadPointerUp} onPointerCancel={onHeadPointerUp}>
          <span className="tour-card-n">
            Step {index + 1} of {steps.length}
          </span>
          <button type="button" className="tour-x" title="Leave the tour" aria-label="Leave the tour" onClick={onQuit}>
            ✕
          </button>
        </div>
        <h3 className="tour-card-title">{step.title}</h3>
        <p className="tour-card-text">{step.text}</p>
        {inInspector(step) && <p className="tour-hint">{INSPECTOR_HINT}</p>}
        <div className="tour-card-btns">
          {busy && (
            <span className="tour-busy" role="status">
              {busy}
            </span>
          )}
          {step.offerSample && onCopySample && !busy && (
            <button type="button" className="btn-ghost tour-sample" title="Sample numbers go on the clipboard; the tour moves on to pasting them" onClick={() => { onCopySample(); advance(); }}>
              Put sample numbers on the clipboard
            </button>
          )}
          {step.needs && onReach && !metHere(step.needs, state) && !busy && (
            <button type="button" className="btn tour-reach" data-need={step.needs} onClick={reachSample}>
              {REACH_LABEL[step.needs]}
            </button>
          )}
          {(step.nextAdvances || !(step.choose && step.needs && !metHere(step.needs, state))) && !busy && (
            <button type="button" className="btn tour-next" title={step.mode === "action" ? "Move on — done already, or the program does this step for you" : undefined} onClick={next}>
              {last ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
