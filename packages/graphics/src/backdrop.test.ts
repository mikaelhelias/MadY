import { describe, expect, it } from "vitest";
import { buildBackdrop, gradientVector, MAX_WAVES, WAVE_OPACITY_CAP } from "./backdrop.js";

describe("backdrop — opt-in by default", () => {
  it("draws nothing when no backdrop is configured (the default path)", () => {
    expect(buildBackdrop(undefined, 800, 600)).toBeNull();
  });

  it("draws nothing at zero opacity or zero size", () => {
    expect(buildBackdrop({ opacity: 0 }, 800, 600)).toBeNull();
    expect(buildBackdrop({}, 0, 600)).toBeNull();
    expect(buildBackdrop({}, 800, 0)).toBeNull();
  });

  it("an empty style still yields a drawable backdrop (preset defaults to aurora)", () => {
    const bd = buildBackdrop({}, 800, 600);
    expect(bd).not.toBeNull();
    expect(bd!.stops.length).toBeGreaterThan(1);
    expect(bd!.waves).toHaveLength(3);
  });
});

describe("backdrop — legibility is a hard constraint", () => {
  it("no wave band may exceed the opacity cap, even when asked for full strength", () => {
    // waveOpacity=1 is the strongest a user can ask for; the cap must still hold, and at
    // least one band must actually BE capped (else this assertion proves nothing).
    for (let n = 1; n <= MAX_WAVES; n++) {
      const bd = buildBackdrop({ waveCount: n, waveOpacity: 1, seed: n }, 800, 600)!;
      for (const w of bd.waves) {
        expect(w.opacity).toBeLessThanOrEqual(WAVE_OPACITY_CAP);
      }
      expect(bd.waves.some((w) => w.opacity === WAVE_OPACITY_CAP)).toBe(true);
    }
  });

  it("band strength is honoured below the cap (the control is not a no-op)", () => {
    const faint = buildBackdrop({ waveOpacity: 0.1, seed: 1 }, 800, 600)!;
    const strong = buildBackdrop({ waveOpacity: 0.3, seed: 1 }, 800, 600)!;
    expect(faint.waves[0]!.opacity).toBeLessThan(strong.waves[0]!.opacity);
  });

  it("clamps the band count into range rather than trusting the input", () => {
    expect(buildBackdrop({ waveCount: 99 }, 800, 600)!.waves).toHaveLength(MAX_WAVES);
    expect(buildBackdrop({ waveCount: -5 }, 800, 600)!.waves).toHaveLength(1);
  });

  it("clamps overall opacity to 0–1", () => {
    expect(buildBackdrop({ opacity: 5 }, 800, 600)!.opacity).toBe(1);
  });

  it("waves can be turned off entirely, leaving just the gradient", () => {
    const bd = buildBackdrop({ waves: false }, 800, 600)!;
    expect(bd.waves).toHaveLength(0);
    expect(bd.stops.length).toBeGreaterThan(1);
  });
});

/**
 * The legibility requirement, stated as maths rather than taste. A figure's own text is
 * near-black; if the backdrop behind it is dark, the figure is unreadable. Without its scrim a
 * dark palette such as `spectrum` measures about 1.2:1 against chart text.
 * Contrast + compositing are re-derived here independently of the builder.
 */
describe("backdrop — a decoration may never make chart text unreadable", () => {
  const FIGURE_TEXT = [10, 10, 10]; // the app's near-black tick/label fill
  const WCAG_BODY_TEXT = 4.5;

  const hex = (h: string): number[] => h.replace("#", "").match(/.{2}/g)!.map((x) => parseInt(x, 16));
  /** src over dst at alpha a. */
  const over = (src: number[], dst: number[], a: number): number[] => dst.map((d, i) => a * src[i]! + (1 - a) * d);
  const lum = (c: number[]): number => {
    const f = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * f[0]! + 0.7152 * f[1]! + 0.0722 * f[2]!;
  };
  const contrast = (a: number[], b: number[]): number => {
    const [hi, lo] = [Math.max(lum(a), lum(b)), Math.min(lum(a), lum(b))];
    return (hi + 0.05) / (lo + 0.05);
  };

  for (const preset of ["aurora", "spectrum", "tide"] as const) {
    it(`${preset}: every gradient stop clears ${WCAG_BODY_TEXT}:1 for near-black text once scrimmed`, () => {
      const bd = buildBackdrop({ preset }, 800, 600)!;
      for (const stop of bd.stops) {
        const composited = bd.scrim ? over(hex(bd.scrim.color), hex(stop.color), bd.scrim.opacity) : hex(stop.color);
        expect(contrast(FIGURE_TEXT, composited)).toBeGreaterThanOrEqual(WCAG_BODY_TEXT);
      }
    });
  }

  it("the scrim is user-adjustable (it is a control, not a constant)", () => {
    expect(buildBackdrop({ preset: "spectrum", scrim: 0 }, 800, 600)!.scrim).toBeNull();
    expect(buildBackdrop({ preset: "spectrum", scrim: 0.9 }, 800, 600)!.scrim!.opacity).toBe(0.9);
  });
});

describe("backdrop — deterministic (golden snapshots + exports must be byte-stable)", () => {
  it("the same seed and size produce identical geometry", () => {
    const a = buildBackdrop({ seed: 7, waveCount: 4 }, 800, 600)!;
    const b = buildBackdrop({ seed: 7, waveCount: 4 }, 800, 600)!;
    expect(a.waves.map((w) => w.d)).toEqual(b.waves.map((w) => w.d));
  });

  it("a different seed reshuffles the shapes", () => {
    const a = buildBackdrop({ seed: 1, waveCount: 4 }, 800, 600)!;
    const b = buildBackdrop({ seed: 2, waveCount: 4 }, 800, 600)!;
    expect(a.waves.map((w) => w.d)).not.toEqual(b.waves.map((w) => w.d));
  });

  it("emits no NaN/Infinity in any path (a single bad number blanks the figure)", () => {
    const bd = buildBackdrop({ waveCount: MAX_WAVES, angle: 42, seed: 3 }, 640, 480)!;
    for (const w of bd.waves) expect(w.d).not.toMatch(/NaN|Infinity/);
    for (const v of [bd.x1, bd.y1, bd.x2, bd.y2]) expect(Number.isFinite(v)).toBe(true);
  });

  it("wave paths stay within the figure's horizontal bounds", () => {
    const width = 800;
    const bd = buildBackdrop({ waveCount: 3, seed: 5 }, width, 600)!;
    for (const w of bd.waves) {
      const xs = [...w.d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => Number(m[1]));
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(width);
    }
  });
});

describe("gradientVector", () => {
  it("maps 180° to a top→bottom sweep", () => {
    const v = gradientVector(180);
    expect(v.y1).toBe(0);
    expect(v.y2).toBe(1);
  });

  it("maps 90° to a left→right sweep", () => {
    const v = gradientVector(90);
    expect(v.x1).toBe(0);
    expect(v.x2).toBe(1);
  });
});
