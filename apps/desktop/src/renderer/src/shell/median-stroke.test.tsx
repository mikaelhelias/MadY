/**
 * A box's median line must be visible against the box. The solid presets fill a box with the colour its median
 * follows, so the median disappeared on the violin's inner box and on floating bars.
 */
import { describe, expect, it } from "vitest";
import { findPreset, MadyDocument } from "@mady/core";
import type { Plot } from "@mady/core";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";
import { medianStroke } from "./PlotFigure";
import { applyPresetWithKindDefaults } from "./seedStyle";

describe("medianStroke", () => {
  it("the same colour as an opaque fill: the paper colour", () => {
    expect(medianStroke("#1A1A1A", "#1a1a1a", 0.95)).toBe("var(--bg)");
  });
  it("a different colour keeps its colour", () => {
    expect(medianStroke("#0072B2", "#b3d5e8", 1)).toBe("#0072B2");
  });
  it("the same colour on a faint fill keeps its colour, which then shows", () => {
    expect(medianStroke("#0072B2", "#0072B2", 0.18)).toBe("#0072B2");
  });
});

const SIZE = { width: 620, height: 420 };
/** The card, restyled by clicking the preset's card (the Inspector's own path). */
const withPreset = (kind: string, preset: string): string => {
  const card = (galleryItems() as unknown as { table: never; plot: Plot; title: string }[]).find((i) => i.plot.kind === kind)!;
  const doc = new MadyDocument();
  const { table, plot } = doc.insertGraph(card.table, card.plot, card.title);
  applyPresetWithKindDefaults(doc, plot.id, kind as Plot["kind"], findPreset(preset)!);
  const p = doc.toJSON().plots.find((x) => x.id === plot.id)!;
  return renderFingerprint(doc.toJSON().tables.find((t) => t.id === table.id)!, p, SIZE);
};
/** A median line drawn in exactly the colour of the opaque box right under it. */
const hiddenMedian = /<rect[^>]*fill="(#[0-9a-fA-F]{6})"[^>]*fill-opacity="(?:0\.[5-9]\d*|1)"[^>]*>(?:<\/rect>)?<line[^>]*stroke="\1"/i;
const opaqueBoxes = /<rect[^>]*fill-opacity="(?:0\.[5-9]\d*|1)"[^>]*>(?:<\/rect>)?<line/i;

describe("median line in the drawing, preset clicked", () => {
  for (const kind of ["violin", "floatingbar"]) {
    for (const preset of ["Scientific Journal", "Grayscale (print)"]) {
      it(`${kind} / ${preset}: the median line is not the colour of the box it lies on`, () => {
        const m = withPreset(kind, preset);
        expect(opaqueBoxes.test(m), "fixture: the preset must give an opaque box with a median after it").toBe(true);
        expect(hiddenMedian.test(m)).toBe(false);
      });
    }
  }
});
