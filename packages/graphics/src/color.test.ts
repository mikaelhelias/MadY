import { describe, expect, it } from "vitest";
import { mix, rampColor, COLORMAPS } from "./color.js";

describe("mix", () => {
  it("blends endpoints and the midpoint", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#ff0000", "#0000ff", 0.5)).toBe("#800080");
  });
  it("clamps the amount to [0,1]", () => {
    expect(mix("#000000", "#ffffff", -1)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 2)).toBe("#ffffff");
  });
});

describe("rampColor", () => {
  const base = "#2266cc";

  it("lightness: low → light, high → darker; reverse flips it", () => {
    const lo = rampColor("lightness", 0, base, "#1a1a1a", false).color;
    const hi = rampColor("lightness", 1, base, "#1a1a1a", false).color;
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(lo)).toBeGreaterThan(lum(hi)); // low value is lighter
    // reversed swaps which end is light
    expect(rampColor("lightness", 0, base, "#1a1a1a", true).color).toBe(hi);
  });

  it("transparency: opacity ramps faint→opaque (colour stays the base)", () => {
    expect(rampColor("transparency", 0, base, "#000", false)).toMatchObject({ color: base });
    expect(rampColor("transparency", 0, base, "#000", false).opacity).toBeLessThan(0.3);
    expect(rampColor("transparency", 1, base, "#000", false).opacity).toBe(1);
  });

  it("two-colour interpolates base→to", () => {
    expect(rampColor("twocolor", 0, "#000000", "#ffffff", false).color).toBe("#000000");
    expect(rampColor("twocolor", 1, "#000000", "#ffffff", false).color).toBe("#ffffff");
  });

  it("colormaps hit their endpoints (viridis purple→yellow)", () => {
    const v = COLORMAPS.viridis!;
    expect(rampColor("viridis", 0, base, "#000", false).color).toBe(v[0]);
    expect(rampColor("viridis", 1, base, "#000", false).color).toBe(v[v.length - 1]);
  });

  it("ships a generous set of colormaps (≥13)", () => {
    expect(Object.keys(COLORMAPS).length).toBeGreaterThanOrEqual(13);
  });
});
