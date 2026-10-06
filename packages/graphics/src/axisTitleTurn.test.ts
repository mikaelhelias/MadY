import { describe, expect, it } from "vitest";
import {
  aboveBand, besideLayout, defaultTitleAngle, normalizeAngle, placeAbove, placeBeside, requestedTurn,
  rightTitleBand, titleDescent, titleLength, turnedInk, wrapTitle,
} from "./axisTitleTurn";

const measure = (t: string, px: number): number => t.length * px * 0.6;

describe("axisTitleTurn — Title direction helpers", () => {
  it("defaults and angle normalising", () => {
    expect(defaultTitleAngle("left")).toBe(90);
    expect(defaultTitleAngle("right")).toBe(270);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(405.4)).toBe(45);
    expect(normalizeAngle(360)).toBe(0);
  });

  it("requestedTurn: nothing for the default, 'above' only when level", () => {
    expect(requestedTurn(undefined, "left")).toBeUndefined();
    expect(requestedTurn({ titleAngle: 90 }, "left")).toBeUndefined();
    expect(requestedTurn({ titleAngle: 270 }, "right")).toBeUndefined();
    expect(requestedTurn({ titleAngle: 90 }, "right")).toEqual({ angle: 90, above: false, aboveRefused: false });
    expect(requestedTurn({ titleAngle: 0, titleAbove: true }, "left")).toEqual({ angle: 0, above: true, aboveRefused: false });
    expect(requestedTurn({ titleAngle: 45, titleAbove: true }, "left")).toEqual({ angle: 45, above: false, aboveRefused: true });
    // "above" with no angle: the title stays at its default turn, and the refusal is reported.
    expect(requestedTurn({ titleAbove: true }, "left")).toEqual({ angle: 90, above: false, aboveRefused: true });
    expect(requestedTurn({ titleAngle: Number.NaN }, "left")).toBeUndefined();
  });

  it("turnedInk: at 90° it is the default turned title — (ascent + descent) wide, anchor `descent` inside its right edge", () => {
    const ink = turnedInk(90, 200, 20);
    expect(ink.hw * 2).toBeCloseTo(1.35 * 20);
    expect(ink.hh * 2).toBeCloseTo(200);
    // anchor x = centre + ax; right edge = centre + hw ⇒ right edge − anchor = hw − ax = descent
    expect(ink.hw - ink.ax).toBeCloseTo(0.27 * 20);
    expect(ink.ay).toBeCloseTo(0);
  });

  it("turnedInk: level — as wide as the text, baseline below the centre; more lines hang lower", () => {
    const one = turnedInk(0, 100, 10);
    expect(one.hw).toBeCloseTo(50);
    expect(one.hh * 2).toBeCloseTo(13.5);
    expect(one.ay).toBeCloseTo((1.08 - 0.27) / 2 * 10); // the baseline sits below the ink centre
    const two = turnedInk(0, 100, 10, 2);
    expect(two.hh * 2).toBeCloseTo(13.5 + 12);
    expect(two.ay).toBeLessThan(one.ay); // the first baseline is higher when a second line hangs under it
  });

  it("wrapTitle breaks at spaces, keeps a long word whole and keeps typed breaks", () => {
    expect(wrapTitle("Response (% of max)", 10, measure, 60)).toEqual(["Response", "(% of", "max)"]);
    expect(wrapTitle("Supercalifragilistic", 10, measure, 20)).toEqual(["Supercalifragilistic"]);
    expect(wrapTitle("A\nB C", 10, measure, 5)).toEqual(["A", "B C"]);
    expect(wrapTitle("Short", 10, measure, 500)).toEqual(["Short"]);
  });

  it("besideLayout: wraps to a fifth of the figure, refuses only what still cannot fit", () => {
    const ok = besideLayout("Expression (a.u.)", 0, 22, measure, 580);
    expect(ok.lines).toEqual(["Expression", "(a.u.)"]);
    expect(ok.tooWide).toBe(false);
    expect(besideLayout("Supercalifragilisticexpialidocious_measurement", 0, 22, measure, 580).tooWide).toBe(true);
    expect(besideLayout("Supercalifragilisticexpialidocious_measurement", 90, 22, measure, 580).tooWide).toBe(false);
  });

  it("rightTitleBand: the fixed one-line band for the default, 'above' and a refusal; the real ink otherwise", () => {
    const flat = Math.ceil(1.35 * 20) + 6;
    expect(rightTitleBand(undefined, "Title", 20, 6, measure, 580)).toBe(flat);
    expect(rightTitleBand({ titleAngle: 0, titleAbove: true }, "Title", 20, 6, measure, 580)).toBe(flat);
    expect(rightTitleBand({ titleAngle: 0 }, "Supercalifragilisticexpialidocious_measurement", 20, 6, measure, 580)).toBe(flat);
    expect(rightTitleBand({ titleAngle: 0 }, "", 20, 6, measure, 580)).toBe(flat);
    const level = rightTitleBand({ titleAngle: 0 }, "Title", 20, 6, measure, 580);
    expect(level).toBe(Math.ceil(titleLength("Title", 20, measure)) + 6);
  });

  it("placeBeside: the ink ends at the edge, on the side asked, kept on the canvas; overflow is reported", () => {
    const left = placeBeside("left", 0, ["Title"], 66, 20, 100, 150, { width: 580, height: 380 });
    const ink = turnedInk(0, 66, 20);
    expect(left.turn.x - ink.ax + ink.hw).toBeCloseTo(100, 1); // right edge of the ink on the edge
    expect(left.turn.anchor).toBe("middle");
    expect(left.overflowLeft).toBe(0);
    const tight = placeBeside("left", 0, ["Title"], 66, 20, 40, 150, { width: 580, height: 380 });
    expect(tight.overflowLeft).toBeCloseTo(2 - (40 - 66), 1);
    const right = placeBeside("right", 0, ["Title"], 66, 20, 540, 150, { width: 580, height: 380 });
    expect(right.overflowRight).toBeCloseTo(540 + 66 + 2 - 580, 1);
    const low = placeBeside("left", 90, ["Title"], 300, 20, 100, 370, { width: 580, height: 380 });
    expect(low.turn.y).toBeLessThanOrEqual(380 - 150 - 2 + 0.01); // pulled up so its length stays on the canvas
    expect(placeBeside("left", 0, ["A", "B"], 20, 20, 100, 150, { width: 580, height: 380 }).turn.text).toBe("A\nB");
  });

  it("placeAbove: starts at the labels on the left, ends at them on the right, pulled onto the figure", () => {
    expect(placeAbove("left", 100, 30, 40, 580)!.turn).toEqual({ angle: 0, x: 30, y: 40, anchor: "start" });
    expect(placeAbove("left", 100, 520, 40, 580)!.turn.x).toBe(478);
    expect(placeAbove("right", 100, 560, 40, 580)!.turn).toEqual({ angle: 0, x: 560, y: 40, anchor: "end" });
    expect(placeAbove("right", 100, 50, 40, 580)!.turn.x).toBe(102);
    expect(placeAbove("left", 600, 30, 40, 580)).toBeUndefined();
  });

  it("aboveBand and titleDescent", () => {
    expect(aboveBand(20, 6)).toBe(Math.ceil(27) + 6);
    expect(titleDescent(20)).toBeCloseTo(5.4);
  });
});
