// @vitest-environment jsdom
/**
 * The manual in a popup — what a click on an Ask-bar match opens. It hosts the same GuidePane
 * the Documentation tab shows, landed on the target (scrolled + flashed), and it can hand the
 * reader over to the tab when they want the whole manual.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ManualPopup } from "./ManualPopup";
import { GuidePane, proseAnchors } from "./GuidePane";

/**
 * A deep-link landing is instant; a click inside the pane scrolls smoothly. A smooth scroll to
 * a distant chapter such as Axis takes seconds, longer than the 1.6s flash, so a smooth landing
 * would open the popup on the top of the manual, drifting, with the flash over on arrival.
 * jsdom cannot scroll, so the guard is on what the pane asks for.
 */
describe("landing speed", () => {
  it("a target lands instantly", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<ManualPopup target={{ section: "axes" }} onClose={() => {}} onOpenTab={() => {}} />);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ behavior: "auto" });
  });
  it("a click on the contents list still scrolls smoothly", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { container } = render(<GuidePane version="1" />);
    fireEvent.click(container.querySelector(".guide-toclink")!);
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.at(-1)![0]).toMatchObject({ behavior: "smooth" });
  });
});
import { guideIndex } from "./guideIndex";

describe("proseAnchors — where an entry lives in the chapters, most specific first", () => {
  it("a how-to row, then its chapter", () => {
    expect(proseAnchors({ id: "howto:insp:axispanel:breaks-cuts:break-start", section: "axes" })).toEqual([
      "howto-insp:axispanel:breaks-cuts:break-start",
      "guide-axes",
    ]);
  });
  it("an Inspector section or Axis group: its how-to group heading, then its chapter", () => {
    expect(proseAnchors({ id: "axis:breaks-cuts", section: "axes" })).toEqual(["howto-group-breaks-cuts", "guide-axes"]);
    expect(proseAnchors({ id: "insp:background", section: "colours" })).toEqual(["howto-group-background", "guide-colours"]);
  });
  it("anything else: the chapter only", () => {
    expect(proseAnchors({ id: "action:save", section: "files" })).toEqual(["guide-files"]);
    expect(proseAnchors({ id: "method:ttest", section: "analyze" })).toEqual(["guide-analyze"]);
  });
  it("every real entry ends at a chapter that exists on the page", () => {
    for (const e of guideIndex()) {
      const last = proseAnchors(e).at(-1)!;
      expect(last).toBe(`guide-${e.section}`);
    }
  });
});

beforeEach(() => {
  Element.prototype.scrollIntoView = function () {};
});
afterEach(() => cleanup());

describe("ManualPopup", () => {
  it("shows the manual landed on the requested chapter, flashed so the reader sees where", () => {
    const { container } = render(<ManualPopup target={{ section: "axes" }} onClose={() => {}} onOpenTab={() => {}} />);
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog, "no dialog rendered").toBeTruthy();
    const sec = container.querySelector("#guide-axes");
    expect(sec, "the manual is not inside the popup").toBeTruthy();
    expect(sec!.classList.contains("guide-pulse"), "the target chapter was not flashed").toBe(true);
  });

  /**
   * A function opens in the chapter's prose, never in the search view. Three landings,
   * most specific first:
   * the control's own how-to row, its group's heading, the chapter top.
   */
  const pulsed = (container: HTMLElement): string[] =>
    [...container.querySelectorAll(".guide-pulse")].map((e) => e.id);

  it("a how-to control lands on its own row in the chapter, with no search results shown", () => {
    const entry = guideIndex().find((e) => e.id === "howto:insp:axispanel:breaks-cuts:break-start")!;
    expect(entry, "the fixture needs the Break start how-to in the index").toBeTruthy();
    const { container } = render(<ManualPopup target={{ entry: entry.id }} onClose={() => {}} onOpenTab={() => {}} />);
    expect(pulsed(container)).toEqual(["howto-insp:axispanel:breaks-cuts:break-start"]);
    expect(container.querySelectorAll(".guide-hit").length, "the search view was shown instead of the prose").toBe(0);
    expect((container.querySelector(".guide-search") as HTMLInputElement).value).toBe("");
  });

  it("an Inspector group lands on that group's heading in the chapter", () => {
    const { container } = render(<ManualPopup target={{ entry: "axis:breaks-cuts" }} onClose={() => {}} onOpenTab={() => {}} />);
    expect(pulsed(container)).toEqual(["howto-group-breaks-cuts"]);
    expect(container.querySelectorAll(".guide-hit").length).toBe(0);
  });

  it("a function with no row of its own lands on its chapter", () => {
    const entry = guideIndex().find((e) => e.id.startsWith("action:"))!;
    const { container } = render(<ManualPopup target={{ entry: entry.id }} onClose={() => {}} onOpenTab={() => {}} />);
    expect(pulsed(container)).toEqual([`guide-${entry.section}`]);
    expect(container.querySelectorAll(".guide-hit").length).toBe(0);
  });

  it("closes on Escape, on the backdrop, and on its close button — never on a click inside", () => {
    const onClose = vi.fn();
    const { container } = render(<ManualPopup target={{ section: "axes" }} onClose={onClose} onOpenTab={() => {}} />);
    fireEvent.click(container.querySelector("#guide-axes")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(container.querySelector(".manualpop-ov")!);
    fireEvent.click(container.querySelector(".manualpop-close")!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("hands the same target to the Documentation tab on request", () => {
    const onOpenTab = vi.fn();
    const { container } = render(<ManualPopup target={{ section: "axes" }} onClose={() => {}} onOpenTab={onOpenTab} />);
    // By class, not by text: the manual inside the popup names this button in its own Ask chapter.
    const btn = container.querySelector(".manualpop-tab") as HTMLButtonElement;
    expect(btn.textContent).toMatch(/Open in Documentation/);
    fireEvent.click(btn);
    expect(onOpenTab).toHaveBeenCalledWith({ section: "axes" });
  });
});
