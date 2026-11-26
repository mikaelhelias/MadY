/**
 * The inline text editor's place and width follow the typed text: as wide as the text it opened over until the typed
 * text is longer, then as wide as the longest typed line, growing the way the text does and staying in the figure.
 */
import { describe, expect, it } from "vitest";
import { textEditSpan } from "./textEditSpan";

const perChar = (line: string): number => line.length * 10;
const base = { left: 200, width: 60, pad: 40, lineWidth: perChar } as const;

describe("textEditSpan", () => {
  it("text no longer than the one it opened over: the editor is where it opened, as wide as it opened", () => {
    for (const anchor of ["start", "middle", "end"] as const) {
      expect(textEditSpan({ ...base, anchor, value: "Bubble" })).toEqual({ left: 200, width: 100 });
      expect(textEditSpan({ ...base, anchor, value: "Bub" })).toEqual({ left: 200, width: 100 });
    }
  });

  it("longer text: as wide as the text, grown to the right for left-aligned text", () => {
    expect(textEditSpan({ ...base, anchor: "start", value: "x".repeat(30) })).toEqual({ left: 200, width: 340 });
  });

  it("a centred text grows both ways, a right-aligned one to the left", () => {
    expect(textEditSpan({ ...base, anchor: "middle", value: "x".repeat(30) })).toEqual({ left: 80, width: 340 });
    expect(textEditSpan({ ...base, anchor: "end", value: "x".repeat(30) })).toEqual({ left: 0, width: 340 });
  });

  it("several lines: the longest line sets the width", () => {
    expect(textEditSpan({ ...base, anchor: "start", value: `short\n${"x".repeat(20)}\nmid line` }).width).toBe(240);
  });

  it("stays inside the figure: pulled back from the right edge, and never wider than the figure", () => {
    expect(textEditSpan({ ...base, anchor: "start", room: 400, value: "x".repeat(30) })).toEqual({ left: 60, width: 340 });
    expect(textEditSpan({ ...base, anchor: "middle", room: 300, value: "x".repeat(50) })).toEqual({ left: 0, width: 300 });
  });
});
