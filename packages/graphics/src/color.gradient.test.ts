// @vitest-environment node
/**
 * The gradient resolver: stops, interpolation spaces, the shaping knobs (midpoint · gamma ·
 * discrete steps · opacity curve), the generated "parametric rainbow" sweep, and the registry
 * lookup that turns `custom:<id>` into a mapping.
 *
 * The built-ins' own colours are pinned separately by `color.identity.test.ts` — this file is
 * about what the resolver adds.
 */
import { describe, expect, it } from "vitest";
import type { Gradient } from "@mady/core";
import {
  gradientStops, hslToHex, labToHex, makeRamp, makeRampResolver, mixIn, rampBarStops,
  missingGradientWarning, resolveBuiltinRamp, resolveGradient, resolveRamp, rgbToHsl, rgbToLab,
} from "./color.js";

const g = (over: Partial<Gradient>): Gradient => ({
  id: "g", name: "G", mode: "stops",
  stops: [{ pos: 0, color: "#000000" }, { pos: 1, color: "#ffffff" }],
  ...over,
});
const at = (grad: Gradient, t: number): string => makeRamp(resolveGradient(grad), "#123456", "#654321", false)(t).color;

describe("stops", () => {
  it("interpolates between them and clamps outside the ends", () => {
    const grad = g({});
    expect(at(grad, 0)).toBe("#000000");
    expect(at(grad, 1)).toBe("#ffffff");
    expect(at(grad, 0.5)).toBe("#808080");
    expect(at(grad, -1)).toBe("#000000");
    expect(at(grad, 2)).toBe("#ffffff");
  });

  it("honours uneven stop positions — the whole point of hand-editing a ramp", () => {
    // Black at 0, white at 0.25, then flat white: the detail is squeezed into the first quarter.
    const grad = g({ stops: [{ pos: 0, color: "#000000" }, { pos: 0.25, color: "#ffffff" }, { pos: 1, color: "#ffffff" }] });
    expect(at(grad, 0.125)).toBe("#808080");
    expect(at(grad, 0.25)).toBe("#ffffff");
    expect(at(grad, 0.6)).toBe("#ffffff");
  });

  it("sorts stops given out of order (the editor lets a handle be dragged past its neighbour)", () => {
    const grad = g({ stops: [{ pos: 1, color: "#ffffff" }, { pos: 0, color: "#000000" }] });
    expect(at(grad, 0)).toBe("#000000");
    expect(at(grad, 1)).toBe("#ffffff");
  });

  it("carries per-stop opacity", () => {
    const grad = g({ stops: [{ pos: 0, color: "#ff0000", opacity: 0 }, { pos: 1, color: "#ff0000", opacity: 1 }] });
    const paint = makeRamp(resolveGradient(grad), "#000000", "#ffffff", false);
    expect(paint(0).opacity).toBe(0);
    expect(paint(0.5).opacity).toBeCloseTo(0.5, 6);
    expect(paint(1).opacity).toBe(1);
  });
});

describe("interpolation space", () => {
  it("rgb is the default blend", () => {
    expect(mixIn("rgb", "#ff0000", "#0000ff", 0.5)).toBe("#800080");
    expect(resolveGradient(g({})).space).toBe("rgb");
  });

  it("hsl travels the short way round the wheel — red→blue through magenta, never through grey", () => {
    const mid = mixIn("hsl", "#ff0000", "#0000ff", 0.5);
    const [h, s, l] = rgbToHsl(mid);
    expect(h).toBeCloseTo(300, 0); // magenta
    expect(s).toBeCloseTo(1, 2); // fully saturated — an RGB blend would have desaturated to #800080
    expect(l).toBeCloseTo(0.5, 2);
  });

  it("lab blends perceptually, and the conversions round-trip", () => {
    const [L, a, b] = rgbToLab("#ff0000");
    expect(L).toBeCloseTo(53.24, 1);
    expect(a).toBeCloseTo(80.09, 1);
    expect(b).toBeCloseTo(67.2, 1);
    expect(rgbToLab("#ffffff")[0]).toBeCloseTo(100, 2);
    expect(labToHex(...(rgbToLab("#2266cc") as [number, number, number]))).toBe("#2266cc");
    // Halfway along a black→white LAB ramp is L* = 50 — perceptual middle grey, which is
    // #777777, darker than RGB's #808080. (That is the point of Lab: equal steps look equal.)
    const lab = mixIn("lab", "#000000", "#ffffff", 0.5);
    expect(lab).toBe("#777777");
    expect(rgbToLab(lab)[0]).toBeCloseTo(50, 1);
    expect(mixIn("rgb", "#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("hslToHex covers every 60° sector", () => {
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(60, 1, 0.5)).toBe("#ffff00");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(180, 1, 0.5)).toBe("#00ffff");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    expect(hslToHex(300, 1, 0.5)).toBe("#ff00ff");
    expect(hslToHex(-60, 1, 0.5)).toBe("#ff00ff"); // wraps
    expect(hslToHex(0, 0, 0.5)).toBe("#808080"); // no hue at zero saturation
  });
});

describe("the shaping knobs", () => {
  it("midpoint moves the centre of the ramp without moving its ends", () => {
    const plain = g({});
    const pinned = g({ midpoint: 0.25 });
    expect(at(pinned, 0)).toBe(at(plain, 0));
    expect(at(pinned, 1)).toBe(at(plain, 1));
    // the value sitting at the midpoint now gets the ramp's middle colour
    expect(at(pinned, 0.25)).toBe(at(plain, 0.5));
    // and 0.25 of the way from the midpoint to the top gets 5/8 of the ramp
    expect(at(pinned, 0.4375)).toBe(at(plain, 0.625));
  });

  it("a midpoint of 0 or 1 is ignored rather than dividing by zero", () => {
    expect(at(g({ midpoint: 0 }), 0.5)).toBe(at(g({}), 0.5));
    expect(at(g({ midpoint: 1 }), 0.5)).toBe(at(g({}), 0.5));
  });

  it("gamma bends the mapping toward one end, ends unchanged, still monotonic", () => {
    const dark = g({ gamma: 2 }); // >1 pushes values toward the ramp's low end
    expect(at(dark, 0)).toBe("#000000");
    expect(at(dark, 1)).toBe("#ffffff");
    const lvl = (t: number): number => parseInt(at(dark, t).slice(1, 3), 16);
    expect(lvl(0.5)).toBeLessThan(parseInt(at(g({}), 0.5).slice(1, 3), 16));
    for (let i = 1; i <= 10; i++) expect(lvl(i / 10)).toBeGreaterThanOrEqual(lvl((i - 1) / 10));
    expect(at(g({ gamma: 1 }), 0.3)).toBe(at(g({}), 0.3)); // 1 = linear = no-op
  });

  it("steps quantise the ramp into exactly n classes", () => {
    const stepped = g({ steps: 4 });
    const seen = new Set<string>();
    for (let i = 0; i <= 100; i++) seen.add(at(stepped, i / 100));
    expect(seen.size).toBe(4);
    // every value inside one class gets the same colour, and the class is a solid band
    expect(at(stepped, 0.01)).toBe(at(stepped, 0.24));
    expect(at(stepped, 0.26)).not.toBe(at(stepped, 0.24));
    // classes take their colour at the class centre, so the ends are not over-weighted
    expect(at(stepped, 0)).toBe(at(g({}), 0.125));
  });

  it("steps below 2 leave the ramp continuous", () => {
    for (const n of [0, 1]) {
      const seen = new Set<string>();
      for (let i = 0; i <= 50; i++) seen.add(at(g({ steps: n }), i / 50));
      expect(seen.size).toBeGreaterThan(10);
    }
  });

  it("the opacity curve fades the ramp from end to end", () => {
    const paint = makeRamp(resolveGradient(g({ opacityCurve: [0.2, 1] })), "#000000", "#ffffff", false);
    expect(paint(0).opacity).toBeCloseTo(0.2, 6);
    expect(paint(0.5).opacity).toBeCloseTo(0.6, 6);
    expect(paint(1).opacity).toBeCloseTo(1, 6);
  });

  it("reverse flips the ramp before the shaping, so one gradient serves both directions", () => {
    const grad = resolveGradient(g({ midpoint: 0.25 }));
    const fwd = makeRamp(grad, "#000000", "#ffffff", false);
    const rev = makeRamp(grad, "#000000", "#ffffff", true);
    expect(rev(0).color).toBe(fwd(1).color);
    expect(rev(1).color).toBe(fwd(0).color);
    expect(rev(0.75).color).toBe(fwd(0.25).color);
  });
});

describe("the generated sweep — the parametric rainbow", () => {
  it("walks the wheel clockwise from hueFrom to hueTo", () => {
    const stops = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 240, sweepStops: 3 } }));
    expect(stops.map((s) => s.color)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    expect(stops.map((s) => s.pos)).toEqual([0, 0.5, 1]);
  });

  it("counter-clockwise takes the other way round — red → magenta → blue", () => {
    const stops = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 240, hueDirection: "ccw", sweepStops: 3 } }));
    expect(stops.map((s) => s.color)).toEqual(["#ff0000", "#ff00ff", "#0000ff"]);
  });

  it("hueFrom === hueTo means the whole wheel, not one flat colour", () => {
    const stops = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 0, sweepStops: 5 } }));
    expect(new Set(stops.map((s) => s.color)).size).toBeGreaterThan(2);
  });

  it("cycles repeat the sweep, for cyclic (phase / direction) data", () => {
    const one = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 0, sweepStops: 9 } }));
    const two = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 0, hueCycles: 2, sweepStops: 17 } }));
    expect(two[8]!.color).toBe(one[8]!.color); // half way through 2 cycles = the end of cycle 1
    expect(two[0]!.color).toBe(two[16]!.color);
  });

  it("saturation and lightness take a single value or a start→end pair", () => {
    const flat = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 240, sweepStops: 3, saturation: 0 } }));
    expect(new Set(flat.map((s) => s.color)).size).toBe(1); // no hue at zero saturation
    const fade = gradientStops(g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 240, sweepStops: 3, lightness: [0, 1] } }));
    expect(fade[0]!.color).toBe("#000000");
    expect(fade[2]!.color).toBe("#ffffff");
  });

  it("a sweep converted to stops keeps exactly the colours it generated", () => {
    const sweep = g({ mode: "sweep", stops: [], sweep: { hueFrom: 0, hueTo: 240, sweepStops: 7 } });
    const frozen = g({ mode: "stops", stops: gradientStops(sweep) });
    for (let i = 0; i <= 10; i++) expect(at(frozen, i / 10)).toBe(at(sweep, i / 10));
  });
});

describe("the registry", () => {
  const lib = (id: string): Gradient | undefined => (id === "mine" ? g({ id: "mine", stops: [{ pos: 0, color: "#ff0000" }, { pos: 1, color: "#00ff00" }] }) : undefined);

  it("resolves a built-in name without any registry", () => {
    expect(resolveRamp("viridis")).toEqual(resolveBuiltinRamp("viridis"));
    expect(resolveRamp("twocolor")!.derived).toBe("twocolor");
  });

  it("resolves custom:<id> from the registry", () => {
    const r = resolveRamp("custom:mine", lib)!;
    expect(r.stops?.[0]?.color).toBe("#ff0000");
  });

  it("returns null for an id the registry does not have — the caller must decide", () => {
    expect(resolveRamp("custom:gone", lib)).toBeNull();
    expect(resolveRamp("custom:anything")).toBeNull();
  });

  it("the resolver falls back to viridis and records the miss once", () => {
    const sink: string[] = [];
    const rr = makeRampResolver(lib, sink);
    const a = rr.ramp("custom:gone", "#000000", "#ffffff", false)(0.5).color;
    rr.ramp("custom:gone", "#000000", "#ffffff", false)(0.5);
    rr.resolve("custom:gone");
    expect(a).toBe(makeRamp(resolveBuiltinRamp("viridis"), "#000000", "#ffffff", false)(0.5).color);
    expect(sink).toEqual([missingGradientWarning("gone")]);
    expect(rr.warnings()).toEqual([missingGradientWarning("gone")]);
  });

  it("a resolved gradient produces no warning at all", () => {
    const sink: string[] = [];
    makeRampResolver(lib, sink).ramp("custom:mine", "#000000", "#ffffff", false)(0.5);
    expect(sink).toEqual([]);
  });

  it("stops(): an unshaped built-in emits its own stops, so an SVG gradient is unchanged", () => {
    const rr = makeRampResolver(lib);
    const s = rr.stops("coolwarm", "coolwarm");
    expect(s[0]!.color).toBe("#3b4cc0");
    expect(s[s.length - 1]!.color).toBe("#b40426");
    expect(s[0]!.offset).toBe(0);
    expect(s[s.length - 1]!.offset).toBe(1);
  });

  it("stops(): a derived ramp has no colours of its own, so the caller's fallback is used", () => {
    const rr = makeRampResolver(lib);
    expect(rr.stops("twocolor", "coolwarm")).toEqual(rr.stops("coolwarm", "coolwarm"));
  });

  it("stops(): a stepped gradient gives a staircase — hard edges, not a dense sample", () => {
    // Note: dense sampling would still let the SVG gradient blend across a class edge, so the
    // key would be banded but blurred. Two stops per class is the stronger contract.
    const rr = makeRampResolver((id) => (id === "st" ? g({ id: "st", steps: 3 }) : undefined));
    const s = rr.stops("custom:st", "coolwarm");
    expect(s).toHaveLength(6);
    expect(s.map((x) => x.offset)).toEqual([0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1]);
    expect(new Set(s.map((x) => x.color)).size).toBe(3);
  });

  it("ramp(): the two-colour ramp blends in the requested space — the Blend control reaches it", () => {
    // Guards against `twocolor` mixing with the RGB-only `mix` whatever `space` says, which would
    // make switching Blend to HSL or Lab on a graduated two-colour fill change nothing.
    const rr = makeRampResolver(() => undefined);
    const at = (space: "rgb" | "hsl" | "lab") => rr.ramp("twocolor", "#ff0000", "#0000ff", false, { space })(0.5).color;
    expect(at("rgb")).toBe(rr.ramp("twocolor", "#ff0000", "#0000ff", false)(0.5).color); // RGB is the default look
    expect(at("hsl")).not.toBe(at("rgb"));
    expect(at("lab")).not.toBe(at("rgb"));
  });

  it("stops(): a non-RGB blend is still sampled densely (an SVG gradient blends in sRGB)", () => {
    const rr = makeRampResolver((id) => (id === "hs" ? g({ id: "hs", space: "hsl" }) : undefined));
    expect(rr.stops("custom:hs", "coolwarm").length).toBeGreaterThan(32);
  });
});

describe("class rules beyond equal intervals", () => {
  // Nine bunched values and one far outlier — the shape that makes an equal-interval map go
  // flat. Note: not all-tied: with ties at the minimum a quantile edge lands on 0, which cannot
  // start a non-empty class, and the rule correctly falls back (pinned below).
  const skewed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 60];
  const rr = (grad: Gradient) => makeRampResolver((id) => (id === "g" ? grad : undefined));
  const paintWith = (grad: Gradient, shape: Parameters<ReturnType<typeof rr>["ramp"]>[4]) =>
    rr(grad).ramp("custom:g", "#000000", "#ffffff", false, shape);

  it("equal intervals put almost everything in one class when the data is skewed", () => {
    const grad = g({ steps: 4 });
    const paint = paintWith(grad, { steps: 4, lo: 1, hi: 60, values: skewed });
    const classes = new Set(skewed.map((v) => paint((v - 1) / 59).color));
    expect(classes.size).toBe(2); // nine values in the first class, one in the last
  });

  it("quantile classes spread the same data across all four", () => {
    const grad = g({ steps: 4, stepMode: "quantile" });
    const paint = paintWith(grad, { steps: 4, lo: 1, hi: 60, values: skewed });
    const classes = new Set(skewed.map((v) => paint((v - 1) / 59).color));
    expect(classes.size).toBe(4);
  });

  it("quantile falls back to equal intervals when ties collapse the classes", () => {
    // Five values all at the minimum: the first quantile edge would sit on 0 and open an empty
    // class. Falling back is the correct answer — better than silently drawing three classes
    // where the control says four.
    const tied = [1, 1, 1, 1, 1, 2, 2, 2, 3, 40];
    const q = paintWith(g({ steps: 4, stepMode: "quantile" }), { steps: 4, lo: 1, hi: 40, values: tied });
    const e = paintWith(g({ steps: 4 }), { steps: 4, lo: 1, hi: 40, values: tied });
    for (let i = 0; i <= 10; i++) expect(q(i / 10).color).toBe(e(i / 10).color);
  });

  it("quantile falls back to equal intervals when there are fewer values than classes", () => {
    const grad = g({ steps: 6, stepMode: "quantile" });
    const few = [1, 2];
    const q = paintWith(grad, { steps: 6, lo: 1, hi: 2, values: few });
    const e = paintWith(g({ steps: 6 }), { steps: 6, lo: 1, hi: 2, values: few });
    for (let i = 0; i <= 10; i++) expect(q(i / 10).color).toBe(e(i / 10).color);
  });

  it("user-defined breaks cut exactly where the user said", () => {
    const grad = g({ steps: 3, stepMode: "breaks", breaks: [10, 20] });
    const paint = paintWith(grad, { steps: 3, lo: 0, hi: 100, values: [] });
    const at = (v: number): string => paint(v / 100).color;
    expect(at(5)).toBe(at(9.9));
    expect(at(10.1)).toBe(at(19));
    expect(at(9.9)).not.toBe(at(10.1)); // the edge is at 10
    expect(at(21)).toBe(at(99));
    expect(new Set([at(5), at(15), at(50)]).size).toBe(3);
  });

  it("breaks that do not match the class count are ignored rather than half-applied", () => {
    const grad = g({ steps: 4, stepMode: "breaks", breaks: [10] }); // needs 3
    const b = paintWith(grad, { steps: 4, lo: 0, hi: 100, values: [] });
    const e = paintWith(g({ steps: 4 }), { steps: 4, lo: 0, hi: 100, values: [] });
    for (let i = 0; i <= 10; i++) expect(b(i / 10).color).toBe(e(i / 10).color);
  });
});

describe("out-of-range colours", () => {
  it("under / over paint values outside a pinned scale, and only those", () => {
    const grad = resolveGradient(g({ underColor: "#123456", overColor: "#654321" }));
    const paint = makeRamp(grad, "#000000", "#ffffff", false);
    expect(paint(-0.01).color).toBe("#123456");
    expect(paint(1.01).color).toBe("#654321");
    expect(paint(0).color).toBe("#000000"); // the ends themselves are in range
    expect(paint(1).color).toBe("#ffffff");
  });

  it("without them, out-of-range values clamp to the ends", () => {
    const paint = makeRamp(resolveGradient(g({})), "#000000", "#ffffff", false);
    expect(paint(-5).color).toBe("#000000");
    expect(paint(5).color).toBe("#ffffff");
  });

  it("under/over are read from the data side, so a reversed ramp still calls low 'under'", () => {
    const grad = resolveGradient(g({ underColor: "#123456", overColor: "#654321" }));
    const rev = makeRamp(grad, "#000000", "#ffffff", true);
    expect(rev(-0.01).color).toBe("#123456");
    expect(rev(1.01).color).toBe("#654321");
  });
});

describe("colour-bar stops", () => {
  it("a smooth ramp gives a plain ascending sample", () => {
    const stops = rampBarStops(resolveGradient(g({})), "#000000", "#ffffff", false, 4);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(new Set(stops.map((s) => s.color)).size).toBe(5);
  });

  it("a stepped ramp gives a staircase — two stops per class, so the edges are edges", () => {
    const stops = rampBarStops(resolveGradient(g({ steps: 4 })), "#000000", "#ffffff", false);
    expect(stops).toHaveLength(8);
    expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1]);
    // each class is one flat colour, and there are exactly four of them
    expect(new Set(stops.map((s) => s.color)).size).toBe(4);
    expect(stops[0]!.color).toBe(stops[1]!.color);
    expect(stops[1]!.color).not.toBe(stops[2]!.color);
  });

  it("the staircase follows unequal classes, so a quantile bar shows their real widths", () => {
    const rr = makeRampResolver((id) => (id === "g" ? g({ steps: 4, stepMode: "quantile" }) : undefined));
    const stops = rr.barStops("custom:g", "#000000", "#ffffff", false, {
      steps: 4, lo: 1, hi: 60, values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 60],
    });
    expect(stops).toHaveLength(8);
    const widths = [stops[1]!.offset - stops[0]!.offset, stops[7]!.offset - stops[6]!.offset];
    expect(widths[1], "the top quantile class should be far wider than the bottom one").toBeGreaterThan(widths[0]! * 5);
  });
});
