// A text box's layout.
import { describe, expect, it } from "vitest";
import { estimateTextWidth, layoutTextBox } from "./textBox.js";

describe("layoutTextBox", () => {
  it("one line when there is no wrap width; the box hugs it, centred on the point", () => {
    const t = layoutTextBox("Hello", { fontSize: 10 }, 100, 50);
    expect(t.lines).toEqual(["Hello"]);
    expect(t.x).toBe(100);
    expect(t.anchor).toBe("middle");
    // 5 chars × 10 × 0.6 = 30 wide, padded 6 either side; top = baseline − 0.85·size − 4
    expect(t.box).toEqual({ x: 100 - 15 - 6, y: 50 - 8.5 - 4, w: 42, h: 12 + 8, rx: 4 });
  });
  it("wraps at spaces inside the wrap width, and the box takes that width", () => {
    const t = layoutTextBox("alpha beta gamma", { fontSize: 10, wrapPx: 70 }, 100, 50);
    expect(t.lines).toEqual(["alpha beta", "gamma"]);
    expect(t.box.w).toBe(70 + 12);
    expect(t.box.h).toBe(2 * 12 + 8);
  });
  it("keeps a typed line break", () => {
    expect(layoutTextBox("a\nb", { fontSize: 10 }, 0, 0).lines).toEqual(["a", "b"]);
  });
  it("padding grows the box on every side; radius rounds it", () => {
    const t = layoutTextBox("Hello", { fontSize: 10, padding: 10, radius: 0 }, 100, 50);
    expect(t.box).toEqual({ x: 100 - 15 - 10, y: 50 - 8.5 - 10, w: 50, h: 12 + 20, rx: 0 });
  });
  it("alignment moves the words inside the box, never the box", () => {
    const base = layoutTextBox("alpha beta gamma", { fontSize: 10, wrapPx: 70 }, 100, 50);
    const left = layoutTextBox("alpha beta gamma", { fontSize: 10, wrapPx: 70, align: "start" }, 100, 50);
    const right = layoutTextBox("alpha beta gamma", { fontSize: 10, wrapPx: 70, align: "end" }, 100, 50);
    expect(left.box).toEqual(base.box);
    expect(right.box).toEqual(base.box);
    expect(left.x).toBe(100 - 35);
    expect(left.anchor).toBe("start");
    expect(right.x).toBe(100 + 35);
    expect(right.anchor).toBe("end");
  });
  it("estimates text width the legend frame's way", () => {
    expect(estimateTextWidth("abcd", 10)).toBe(24);
  });
});
