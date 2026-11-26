import { describe, expect, it } from "vitest";
import { colorbarBarRect, colorbarHeading, colorbarMarginFor, colorbarScale, colorbarWidth } from "./colorbarSize";

describe("colorbarScale", () => {
  it("is 1 when unset or not a number", () => {
    expect(colorbarScale({})).toBe(1);
    expect(colorbarScale({ colorbarScale: Number.NaN })).toBe(1);
  });
  it("keeps a value inside 0.4–2", () => {
    expect(colorbarScale({ colorbarScale: 0.1 })).toBe(0.4);
    expect(colorbarScale({ colorbarScale: 9 })).toBe(2);
    expect(colorbarScale({ colorbarScale: 1.5 })).toBe(1.5);
  });
});

describe("colorbarWidth / colorbarMarginFor", () => {
  it("is 14 px at the default size and grows with the scale", () => {
    expect(colorbarWidth({})).toBe(14);
    expect(colorbarWidth({ colorbarScale: 2 })).toBe(28);
  });
  it("reserves the bar's own width plus the room for its labels and heading", () => {
    expect(colorbarMarginFor({})).toBe(74);
    expect(colorbarMarginFor({ colorbarScale: 2 })).toBe(28 + 60);
  });
});

describe("colorbarBarRect", () => {
  it("fills the plot band at the default size", () => {
    expect(colorbarBarRect({}, 500, 40, 300)).toEqual({ x: 500, y: 40, w: 14, h: 300 });
  });
  it("is shorter and centred on the band when scaled down", () => {
    const r = colorbarBarRect({ colorbarScale: 0.5 }, 500, 40, 300);
    expect(r.h).toBe(150);
    expect(r.y).toBe(40 + 75);
    expect(r.w).toBe(7);
  });
  it("is thicker but never longer than the band when scaled up", () => {
    const r = colorbarBarRect({ colorbarScale: 2 }, 500, 40, 300);
    expect(r.h).toBe(300);
    expect(r.y).toBe(40);
    expect(r.w).toBe(28);
  });
});

describe("colorbarHeading", () => {
  it("is the column name until the user types something", () => {
    expect(colorbarHeading({}, "Score")).toBe("Score");
    expect(colorbarHeading({ colorbarTitle: "Dose (mg)" }, "Score")).toBe("Dose (mg)");
  });
  it("a blank heading brings the column name back; switching the heading off removes it", () => {
    expect(colorbarHeading({ colorbarTitle: "  " }, "Score")).toBe("Score");
    expect(colorbarHeading({ colorbarTitle: "Dose (mg)", colorbarShowTitle: false }, "Score")).toBe("");
    expect(colorbarHeading({ colorbarShowTitle: true }, "Score")).toBe("Score");
  });
});
