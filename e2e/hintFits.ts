import type { Page } from "@playwright/test";

/**
 * Does the hint inside every empty, visible box under `scope` fit that box?
 *
 * The measurement: the hint's width in the box's own font (canvas `measureText`) against the
 * room inside it — client width less padding, less the spinner on a number box.
 * jsdom has no layout, so only a real browser can say this.
 *
 * Returns one line per cut-off hint, and how many hints were measured, so a caller can refuse a
 * run that found no boxes at all (a probe that reads nothing "passes").
 */
export const SPINNER_PX = 15; // Chromium's number spinner. "auto" (26 px) fits a 58 px box; "length" (35 px) does not.

export async function clippedHints(page: Page, scope: string): Promise<{ bad: string[]; n: number }> {
  return page.evaluate(
    ([sel, spinner]) => {
      const ctx = document.createElement("canvas").getContext("2d")!;
      const bad: string[] = [];
      let n = 0;
      for (const root of document.querySelectorAll(sel)) {
        for (const el of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[placeholder], textarea[placeholder]")) {
          if (!el.placeholder || el.value !== "") continue;
          const box = el.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden") continue;
          ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
          // A textarea wraps its hint; only its longest WORD has to fit a line.
          const text = el instanceof HTMLTextAreaElement ? el.placeholder.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), "") : el.placeholder;
          const need = ctx.measureText(text).width;
          const room =
            el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el instanceof HTMLInputElement && el.type === "number" ? spinner : 0);
          n++;
          if (need > room + 0.5) {
            const label =
              el.getAttribute("aria-label") ??
              el.closest(".frow, label")?.querySelector("span")?.textContent?.trim() ??
              "?";
            bad.push(`"${el.placeholder}" (${label}): needs ${need.toFixed(1)} px, has ${room.toFixed(1)} px`);
          }
        }
      }
      return { bad, n };
    },
    [scope, SPINNER_PX] as const,
  );
}
