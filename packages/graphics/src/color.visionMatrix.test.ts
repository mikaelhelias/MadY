// The whole-figure colour-vision preview must show the same colours the swatch preview shows.
// `visionMatrixValues` feeds an SVG feColorMatrix (a CSS filter over the whole drawing);
// `simulateVision` recolours one swatch at a time (the gradient editor). Two code paths, one
// truth — so this file applies the matrix itself, in linear light, with its OWN sRGB transfer
// functions (the oracle shares no code with the matrix builder), and holds every channel to
// within 1/255 of `simulateVision` for six colours × four kinds.
import { describe, expect, it } from "vitest";
import { simulateVision, visionMatrixValues } from "./color";
import type { ColorVision } from "./color";

const toLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** Apply a 4×5 feColorMatrix values string to a hex colour, in linear light, → 0–255 channels. */
function applyMatrix(values: string, h: string): [number, number, number] {
  const m = values.split(/\s+/).map(Number);
  expect(m).toHaveLength(20);
  const [r, g, b] = hex(h).map((v) => toLinear(v / 255)) as [number, number, number];
  const ch = (row: number): number => Math.max(0, Math.min(1, m[row * 5]! * r + m[row * 5 + 1]! * g + m[row * 5 + 2]! * b + m[row * 5 + 4]!));
  return [ch(0), ch(1), ch(2)].map((v) => Math.round(toSrgb(v) * 255)) as [number, number, number];
}

const COLOURS = ["#ff0000", "#00ff00", "#0000ff", "#e69f00", "#56b4e9", "#808080"];
const KINDS: ColorVision[] = ["deuteranopia", "protanopia", "tritanopia", "grayscale"];

describe("visionMatrixValues agrees with simulateVision", () => {
  for (const kind of KINDS) {
    it(`${kind}: every channel within 1/255 on six colours`, () => {
      const values = visionMatrixValues(kind);
      for (const c of COLOURS) {
        const viaMatrix = applyMatrix(values, c);
        const viaSwatch = hex(simulateVision(c, kind));
        for (let i = 0; i < 3; i++) expect(Math.abs(viaMatrix[i]! - viaSwatch[i]!), `${kind} ${c} channel ${i}`).toBeLessThanOrEqual(1);
      }
    });
  }
  it("the alpha row is identity, so nothing becomes transparent", () => {
    for (const kind of KINDS) expect(visionMatrixValues(kind).split(/\s+/).slice(15)).toEqual(["0", "0", "0", "1", "0"]);
  });
});
