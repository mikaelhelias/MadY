// @vitest-environment jsdom
/**
 * A row strip's word runs along the strip. The builder sizes the word for that (its length is
 * measured down the rows, `buildScene` "Runs of equal values"), so the renderer must draw it
 * rotated — drawn level, a long word across a narrow row band shows only its last few letters.
 * A column strip's runs are wide and stay level.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

/** The transform that positions a drawn word: on the <text> itself or its nearest wrapper. */
const transformOf = (el: Element): string => el.getAttribute("transform") ?? el.closest("[transform]")?.getAttribute("transform") ?? "";

describe("heatmap annotation-strip run labels", () => {
  const card = galleryItems().find((c) => c.key === "heatmapsplit")!;
  const scene = buildPlotScene(card.table, card.plot, { width: card.plot.figureWidth ?? 760, height: card.plot.figureHeight ?? 640 });
  const tracks = scene.heatmap!.tracks ?? [];
  const rowWords = tracks.filter((t) => t.axis === "row").flatMap((t) => t.runs.filter((r) => r.label).map((r) => r.label));
  const colWords = tracks.filter((t) => t.axis === "col").flatMap((t) => t.runs.filter((r) => r.label).map((r) => r.label));

  it("the fixture carries words on both kinds of strip (it cannot pass by drawing none)", () => {
    expect(rowWords.length).toBeGreaterThan(0);
    expect(colWords.length).toBeGreaterThan(0);
  });

  it("a row strip's word is drawn rotated along the strip; a column strip's stays level", () => {
    const { container } = render(<PlotFigure scene={scene} />);
    const texts = [...container.querySelectorAll("text")];
    for (const w of rowWords) {
      const el = texts.find((t) => (t.textContent ?? "").trim() === w);
      expect(el, `row-strip word "${w}" is drawn`).toBeTruthy();
      expect(transformOf(el!), `row-strip word "${w}" runs along the strip`).toMatch(/rotate\(-90/);
    }
    for (const w of colWords) {
      const el = texts.find((t) => (t.textContent ?? "").trim() === w);
      expect(el, `column-strip word "${w}" is drawn`).toBeTruthy();
      expect(transformOf(el!), `column-strip word "${w}" stays level`).not.toMatch(/rotate/);
    }
  });
});
