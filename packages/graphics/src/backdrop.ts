/**
 * Decorative figure backdrop — gradient + flowing wave bands.
 *
 * Opt-in and off by default: this is a poster / slide / social-media look, not something
 * to sit under a publication figure. The builder is pure and
 * deterministic (a seeded PRNG, coordinates rounded) so golden snapshots and exports are
 * byte-stable — never `Math.random()` at render time.
 *
 * Note: legibility is a hard constraint, not a preference: `WAVE_OPACITY_CAP` bounds how
 * strong the decoration can get, so a backdrop can never win against the data.
 */
import type { BackdropPreset, BackdropStyle } from "@mady/core";

/** No wave band may exceed this opacity — the guard that keeps figures readable. */
export const WAVE_OPACITY_CAP = 0.38;
/** Wave-band count is clamped to this range. */
export const MAX_WAVES = 6;

export interface BackdropScene {
  /** Gradient stops (offset 0–1 + colour), resolved from the preset. */
  stops: { offset: number; color: string }[];
  /** Gradient vector in objectBoundingBox units, resolved from `angle`. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Overall backdrop opacity (0–1). */
  opacity: number;
  /** Wave bands, back-to-front; each an SVG path in scene pixel space. */
  waves: { d: string; fill: string; opacity: number }[];
  /**
   * Legibility scrim drawn over the gradient + waves but under all figure content, so the
   * chart's own near-black text stays readable on a dark palette. null = none needed.
   */
  scrim: { color: string; opacity: number } | null;
}

interface PresetDef {
  /** Gradient stop colours, in order. */
  stops: string[];
  /** Wave band fills, back-to-front. */
  waveFills: string[];
  /**
   * Default legibility-scrim opacity for this palette (see `SCRIM_COLOR`). Dark palettes
   * need a stronger scrim: a figure's own text is near-black, so an undimmed dark gradient
   * behind it measures ~1.2:1 contrast — unreadable. Tuned so the darkest stop of each
   * palette clears the 4.5:1 body-text threshold (locked by `backdrop.test.ts`).
   */
  scrim: number;
}

/** The scrim is always white — it lifts any palette toward the light end for dark text. */
export const SCRIM_COLOR = "#ffffff";

/** The three backdrop palettes. */
const PRESETS: Record<BackdropPreset, PresetDef> = {
  // pale blue → soft grey → warm peach (light, airy)
  aurora: {
    stops: ["#dce8f7", "#eef2f8", "#fbe3cd"],
    waveFills: ["#7fb0e3", "#a9cbee", "#f3c9a2"],
    scrim: 0.12,
  },
  // deep navy → violet → hot orange (vivid, dark)
  spectrum: {
    stops: ["#141a4a", "#5c1f7c", "#e2561d"],
    waveFills: ["#27b3d4", "#a238d2", "#f5891b"],
    scrim: 0.62,
  },
  // cream → teal → deep blue (editorial, calm)
  tide: {
    stops: ["#f4ecd8", "#9ed2c2", "#123a6b"],
    waveFills: ["#6cbfa8", "#4a8cbd", "#1b4c84"],
    scrim: 0.58,
  },
};

/** mulberry32 — a tiny deterministic PRNG (same seed ⇒ same figure, always). */
function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/**
 * Gradient vector from an angle in degrees, clockwise from "to top", expressed in
 * objectBoundingBox units (what SVG's default gradientUnits expects).
 */
export function gradientVector(angle: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  return {
    x1: round2(0.5 - dx / 2),
    y1: round2(0.5 - dy / 2),
    x2: round2(0.5 + dx / 2),
    y2: round2(0.5 + dy / 2),
  };
}

/**
 * One wave band: a smooth sampled sine ribbon spanning the full width, filled down to
 * the bottom edge so the bands stack like layered hills.
 */
function wavePath(width: number, height: number, baseY: number, amp: number, freq: number, phase: number): string {
  const N = 48;
  const parts: string[] = [];
  for (let i = 0; i <= N; i++) {
    const x = (width * i) / N;
    const y = baseY + amp * Math.sin(freq * (x / width) * Math.PI * 2 + phase);
    parts.push(`${i === 0 ? "M" : "L"} ${round2(x)} ${round2(y)}`);
  }
  parts.push(`L ${round2(width)} ${round2(height)}`, `L 0 ${round2(height)}`, "Z");
  return parts.join(" ");
}

/**
 * Resolve a `BackdropStyle` into drawable scene data. Returns null when there is no
 * backdrop to draw, so the renderer can skip it entirely (the default path).
 */
export function buildBackdrop(
  style: BackdropStyle | undefined,
  width: number,
  height: number,
): BackdropScene | null {
  if (!style || width <= 0 || height <= 0) return null;

  const preset = PRESETS[style.preset ?? "aurora"] ?? PRESETS.aurora;
  const opacity = clamp(style.opacity ?? 1, 0, 1);
  if (opacity === 0) return null;

  const stops = preset.stops.map((color, i) => ({
    offset: preset.stops.length === 1 ? 0 : round2(i / (preset.stops.length - 1)),
    color,
  }));

  const waves: BackdropScene["waves"] = [];
  if (style.waves !== false) {
    const count = clamp(Math.round(style.waveCount ?? 3), 1, MAX_WAVES);
    const rand = rng(style.seed ?? 1);
    for (let i = 0; i < count; i++) {
      // Bands march down the figure, back (highest, faintest) to front (lowest, strongest).
      const t = count === 1 ? 0.5 : i / (count - 1);
      const baseY = height * (0.42 + 0.16 * t);
      const amp = height * (0.05 + 0.05 * rand());
      const freq = 0.8 + 0.7 * rand();
      const phase = rand() * Math.PI * 2;
      const fill = preset.waveFills[i % preset.waveFills.length]!;
      // Front bands read slightly stronger than back ones. The cap is the legibility
      // guarantee: even waveOpacity=1 cannot push a band past WAVE_OPACITY_CAP.
      const base = clamp(style.waveOpacity ?? 0.22, 0, 1);
      const bandOpacity = round2(Math.min(WAVE_OPACITY_CAP, base * (0.7 + 0.5 * t)));
      waves.push({ d: wavePath(width, height, baseY, amp, freq, phase), fill, opacity: bandOpacity });
    }
  }

  const scrimOpacity = round2(clamp(style.scrim ?? preset.scrim, 0, 1));
  const scrim = scrimOpacity > 0 ? { color: SCRIM_COLOR, opacity: scrimOpacity } : null;

  return { stops, ...gradientVector(style.angle ?? 135), opacity, waves, scrim };
}
