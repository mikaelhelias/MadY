// @vitest-environment jsdom
// A new lollipop starts clean, and both label layers are still one tick away.
//
// The builder's fallbacks are `?? true` for both label layers — the value at each dot
// (`lollipop.showValues`) and a Δ% beside it (`lollipop.showDelta`). Both are off by default
// via the creation default in `KIND_HOUSE_DEFAULTS`, so:
//
//   • a new lollipop and the gallery card start with no labels;
//   • a lollipop already saved in a project keeps the labels it was drawn with (the builder's
//     fallback stays `true` — flipping it would change existing figures);
//   • both tickboxes still switch the labels on, which a test that only reads the default
//     values would never notice.
//
// Asked of the drawing. Reading `plot.lollipop.showValues` back out of the config would restate
// the default rather than test it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 620, height: 420 };
const item = () => galleryItems().find((g) => g.plot.kind === "lollipop")!;

/** The text a lollipop draws, as one string. */
function textOf(plot: Plot): string {
  const { container } = render(
    <PlotFigure scene={buildPlotScene(item().table, plot, SIZE)} zoom={1} onSelect={vi.fn()} />,
  );
  const t = container.textContent ?? "";
  cleanup();
  return t;
}

const withLollipop = (patch: Record<string, unknown>): Plot =>
  ({ ...item().plot, lollipop: { ...(item().plot.lollipop ?? {}), ...patch } }) as Plot;

describe("a lollipop starts with no value labels", () => {
  it("the gallery card draws neither the values nor the Δ%", () => {
    const plain = textOf(item().plot);
    const withValues = textOf(withLollipop({ showValues: true }));
    const withDelta = textOf(withLollipop({ showDelta: true }));
    // Positive control first: if switching them on changed nothing, the assertions below would
    // pass on a chart that simply cannot draw labels at all.
    expect(withValues, "switching values on changed nothing — this fixture cannot show the bug").not.toBe(plain);
    expect(withDelta, "switching Δ% on changed nothing — this fixture cannot show the bug").not.toBe(plain);
    expect(plain.length, "a new lollipop is drawing label text it was not asked for")
      .toBeLessThan(Math.min(withValues.length, withDelta.length));
  });

  it("both layers come back when asked — the default is a starting point, not a refusal", () => {
    const both = textOf(withLollipop({ showValues: true, showDelta: true }));
    expect(both.length, "with both switched on, the labels did not return").toBeGreaterThan(textOf(item().plot).length);
  });

  it("both tickboxes are in the Inspector", () => {
    const { container } = render(
      <Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={item().plot} table={item().table}
        userPresets={[]} profileDefault={null}
        onSelect={vi.fn()}
        onSetAxis={vi.fn()} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
        onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
        onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
        onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
        onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()} 
        onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
        annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() }} />,
    );
    const l = [...container.querySelectorAll("label > span:first-child, .inspsub, .insphd")]
      .map((e) => (e.textContent ?? "").trim());
    expect(l, "no way to switch the value labels back on").toContain("Value labels");
    expect(l, "no way to switch the Δ% labels back on").toContain("Δ% labels");
  });

  it("a saved lollipop with no label settings keeps its labels", () => {
    // This is a creation default rather than a builder fallback because a saved figure may carry
    // no `lollipop.showValues`, and it must keep drawing its labels.
    const saved = { ...item().plot, lollipop: {} } as Plot;
    expect(textOf(saved), "an existing lollipop silently lost its labels").not.toBe(textOf(item().plot));
  });
});
