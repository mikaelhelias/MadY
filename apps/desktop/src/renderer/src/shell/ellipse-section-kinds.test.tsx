// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import type { Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
afterEach(() => globalThis.localStorage?.clear());

/**
 * If the chart draws a confidence ellipse, its panel must offer one.
 *
 * The builder draws the ellipse not only on xy / area / pcascore / pcabiplot but on `bubble` and
 * `volcano` too — both are XY-family scatters, and the drawing honours `ellipse.show` / `level` /
 * `fillOpacity` / `borderWidth` there. Guards against the Confidence-ellipse section being
 * withheld on a kind that draws it.
 *
 * The test derives the expectation from the builder rather than restating the kind list: for
 * every gallery kind, if turning `ellipse.show` on changes what is drawn, the Inspector has to
 * offer the section. A kind added later is covered the day it lands.
 */
const handlers = () => ({
  onSelect: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(), 
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: { add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() },
});

const SIZE = { width: 620, height: 420 };

/** Does the builder draw an ellipse on this kind when it is switched on? */
function buildsEllipse(item: ReturnType<typeof galleryItems>[number]): boolean {
  const scene = (show: boolean) =>
    JSON.stringify(buildPlotScene(item.table, { ...item.plot, ellipse: { ...(item.plot.ellipse ?? {}), show } } as Plot, SIZE));
  return scene(true) !== scene(false);
}

/** Does the plot panel offer the Confidence ellipse section? */
function offersEllipse(item: ReturnType<typeof galleryItems>[number]): boolean {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  const labels = [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd, .inspsec")]
    .map((e) => (e.textContent ?? "").trim());
  return labels.some((l) => /Confidence ellipse/i.test(l));
}

/** Does the builder draw a spread band on this kind when it is switched on? */
function buildsSpread(item: ReturnType<typeof galleryItems>[number]): boolean {
  const scene = (on: boolean) =>
    JSON.stringify(buildPlotScene(item.table, { ...item.plot, ...(on ? { spread: { mode: "sd" } } : {}) } as Plot, SIZE));
  return scene(true) !== scene(false);
}

/** Does the plot panel offer the spread controls? ("Mean ± spread" / its mode row.) */
function offersSpread(item: ReturnType<typeof galleryItems>[number]): boolean {
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item.plot} table={item.table}
      userPresets={[]} profileDefault={null} {...handlers()} />,
  );
  // Read the labels, not textContent: a textContent regex would pass even when the section is
  // missing, because it also matches the text of hidden <option>s. "Spread band" is the row's own label.
  return [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
    .map((e) => (e.textContent ?? "").trim())
    .includes("Spread band");
}

describe("spread-band section follows the builder", () => {
  const items = galleryItems();

  it("guards the guard — some kinds draw it and some do not", () => {
    const draws = items.filter(buildsSpread).length;
    expect(draws, "no kind draws a spread band — the check is broken").toBeGreaterThan(1);
    expect(draws, "every kind draws one — the check is broken").toBeLessThan(items.length);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: offers the section exactly when the builder draws a band`, () => {
      if (!buildsSpread(item)) return;
      expect(
        offersSpread(item),
        `${kind} draws a spread band but its panel offers no control for it`,
      ).toBe(true);
    });
  }
});

describe("confidence-ellipse section follows the builder", () => {
  const items = galleryItems();

  it("guards the guard — some kinds draw it and some do not", () => {
    const draws = items.filter(buildsEllipse).map((i) => i.plot.kind ?? "xy");
    expect(draws.length, "no kind draws an ellipse — the check is broken").toBeGreaterThan(2);
    expect(draws.length, "every kind draws one — the check is broken").toBeLessThan(items.length);
  });

  for (const item of items) {
    const kind = item.plot.kind ?? "xy";
    it(`${kind}: offers the section exactly when the builder draws one`, () => {
      if (!buildsEllipse(item)) return; // nothing to offer — absence is correct
      expect(
        offersEllipse(item),
        `${kind} draws a confidence ellipse but its panel offers no control for it`,
      ).toBe(true);
    });
  }
});
