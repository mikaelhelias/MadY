/**
 * A reference line placed outside the axis range is not drawn, and the graph says so. Bland-Altman, the scree plot and
 * the ordination plots built their reference lines without the list the reasons go into, so such a line vanished
 * without a word there while every other graph type gave the notice.
 */
import { describe, expect, it } from "vitest";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";

const SIZE = { width: 620, height: 420 };

describe("a reference line off the axis gives a notice", () => {
  for (const title of ["Bland-Altman", "Scree plot", "Ordination — sites", "Ordination — biplot", "XY (points + fitted curve)"]) {
    for (const kind of ["vline", "hline"] as const) {
      it(`${title}: ${kind} far outside the range`, () => {
        const item = galleryItems().find((i) => i.title === title)!;
        const plot = { ...item.plot, annotations: [...(item.plot.annotations ?? []), { id: "far", kind, value: 1e9 }] } as Plot;
        const scene = buildPlotScene(item.table, plot, SIZE);
        expect((scene.annotations ?? []).some((a) => (a as { id?: string }).id === "far")).toBe(false);
        expect((scene.warnings ?? []).some((w) => /outside the axis range/.test(String(w))), (scene.warnings ?? []).join(" | ")).toBe(true);
      });
    }
  }
});
