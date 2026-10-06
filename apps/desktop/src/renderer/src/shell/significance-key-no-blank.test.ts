// @vitest-environment node
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { describe, expect, it } from "vitest";
import { galleryItems } from "./gallery";
import { PlotFigure } from "./PlotFigure";

/**
 * Default-deny: switching the significance key on must never produce blank space.
 *
 * The key band is reserved at a shared choke point — `scene.height += size + 10` for every kind
 * — but only figures on the main path draw the caption. This guards against a key built from
 * `plot.annotations`, i.e. from brackets the document holds whether or not the chart could
 * place them. An axis-less kind (pie, treemap, heatmap, corrmatrix, alluvial, network, radar,
 * parallel, scatter3d) accepts a bracket and then drops it with a warning; such a key would make
 * the figure taller by the key's band and draw nothing in it.
 *
 * Caution: this test must render. Comparing `scene.significanceCaption` against `scene.height`
 * passes even when the figure draws no caption: the scene holds a caption on every kind, and the
 * band is genuinely reserved for it, so scene-level the two always agree. The failure this guards
 * against is a figure that ignores the caption the scene carries — invisible to any check that
 * stops at the scene. `renderToStaticMarkup` needs no DOM and costs ~1-3ms a figure.
 */
const SIZE = { width: 620, height: 420 };

/** A bracket carrying a p-value — the only thing that produces a key. */
const BRACKET = { id: "sig-1", kind: "bracket" as const, from: 1, to: 2, bracketY: 1, p: 0.01, label: "*" };

const markup = (t: Parameters<typeof buildPlotScene>[0], p: Plot): { html: string; height: number } => {
  const scene = buildPlotScene(t, p, SIZE);
  return { html: renderToStaticMarkup(createElement(PlotFigure, { scene })), height: scene.height };
};

describe("significance key — reserved space must actually be filled", () => {
  const items = galleryItems();

  it("covers the gallery (guards the guard)", () => {
    expect(items.length).toBeGreaterThan(20);
  });

  for (const item of items) {
    it(`${item.title} — no band without a key on the page`, () => {
      const base: Plot = { ...item.plot, annotations: [...(item.plot.annotations ?? []), BRACKET] };
      const off = markup(item.table, { ...base, significance: { ...(item.plot.significance ?? {}), legend: false } });
      const on = markup(item.table, { ...base, significance: { ...(item.plot.significance ?? {}), legend: true } });

      const grew = on.height - off.height;
      if (grew === 0) return; // nothing reserved, nothing to answer for

      // The band was reserved — so the key must be on the page. `p&lt;` is how `p<0.05` is
      // escaped into the markup; check the rendered output, never the scene.
      expect(
        /p&lt;|p&#x3C;/.test(on.html),
        `${item.plot.kind ?? "xy"}: switching the significance key on added ${grew}px to the ` +
          `figure and drew no key in it. Build the key from brackets that actually reached the ` +
          `drawing (scene.annotations), not from plot.annotations.`,
      ).toBe(true);
    });
  }

  it("a kind that CAN draw brackets still gets its key (only kinds that cannot draw them lose it)", () => {
    const bar = items.find((i) => i.plot.kind === "bar")!;
    const on = markup(bar.table, { ...bar.plot, annotations: [BRACKET], significance: { legend: true } });
    const off = markup(bar.table, { ...bar.plot, annotations: [BRACKET], significance: { legend: false } });
    expect(on.height - off.height, "bar draws brackets, so it must still reserve the band").toBeGreaterThan(0);
    expect(/p&lt;|p&#x3C;/.test(on.html), "bar must still print the key").toBe(true);
  });
});
