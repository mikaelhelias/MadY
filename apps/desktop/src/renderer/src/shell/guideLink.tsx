/**
 * "?" — the link from a control back to the manual.
 *
 * The manual can answer "what is this thing in front of me", but only if the thing in front of
 * you offers a way to ask. This is that way: a small "?" beside an Inspector section, a rail
 * tab or a dialog title, which opens Help ▸ Documentation already scrolled to the entry for
 * exactly that control.
 *
 * It goes through a window event, not a prop. The buttons live in the Inspector and in
 * twenty-odd dialogs, all of them several components below `AppShell`, and threading an
 * `onOpenGuide` prop through every one of them would add a parameter to files that have nothing
 * to do with the manual. `requestBugReport` (bugReport.ts) uses the same idiom for the same
 * reason — a component deep in the tree asking the shell to open a top-level surface. AppShell
 * listens once and calls `openGuide`.
 *
 * The target must resolve. A "?" that opens the manual at nothing is worse than no "?" —
 * the reader has been promised an answer and given a search box. `guide-help.test.tsx` is
 * default-deny in both directions: every target named here exists in `guideIndex()`, and every
 * dialog with a title either carries a "?" or is listed as exempt with a reason.
 */
import type { GuideTarget } from "./GuidePane";

/** The window event `AppShell` listens for. Carries a `GuideTarget` as its detail. */
export const GUIDE_OPEN_EVENT = "mady:open-guide";

/** Ask the app to open the manual at `target`. No-op outside a window. */
export function requestGuide(target: GuideTarget): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(GUIDE_OPEN_EVENT, { detail: target }));
  }
}

/**
 * The button itself.
 *
 * `what` is what the reader is asking about, and it becomes the tooltip and the accessible
 * name — "Help: Axis" reads correctly in a screen reader's list of buttons, where a bare "?"
 * twenty times over does not.
 *
 * Note: `preventDefault` and `stopPropagation` are both needed: half of these sit inside a
 * `<summary>`, where a click toggles the `<details>` it belongs to. Without both, asking for help
 * on a section would collapse the section under the reader.
 *
 * The "?" glyph is drawn by CSS (`.guidehelp::before`), not put in the button as text. A
 * button inside a heading or a `<summary>` becomes part of that element's own `textContent`
 * (a dialog title would read "New datasheet + graph?", which `NewGraphDialog.test` checks), and
 * a heading has to read as the heading. Where possible the button sits outside the element
 * (dialog titles are a sibling of the `<h3>`, in `.modalh-row`); inside a `<summary>` it
 * cannot be, because a closed `<details>` renders nothing but its summary. So the character is
 * decoration and the meaning is in `aria-label`, which is what a screen reader reads anyway.
 */
export function GuideHelp({
  target,
  what,
  className,
}: {
  target: GuideTarget;
  what: string;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      className={`guidehelp${className ? ` ${className}` : ""}`}
      title={`${what} — open the manual`}
      aria-label={`Help: ${what}`}
      data-guide-target={target.entry ?? target.section}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        requestGuide(target);
      }}
    />
  );
}
