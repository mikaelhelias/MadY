// @vitest-environment jsdom
/**
 * "Only these ticks" in the axis panel's Custom ticks group (`AxisSpec.onlyExtraTicks`). Offered once the axis has a
 * tick of its own (with none, the option has nothing to keep), and kept while it is on so it can be turned off.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { AxisSpec, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const card = galleryItems().find((g) => g.plot.kind === "xy")!;

function panel(xAxis: AxisSpec) {
  const patches: Partial<AxisSpec>[] = [];
  const onSetAxis = (_a: string, p: Partial<AxisSpec>): void => { patches.push(p); };
  const plot = { ...card.plot, xAxis: { ...(card.plot.xAxis ?? {}), ...xAxis } } as Plot;
  const { container } = render(
    <Inspector activeSection="graphs" selection={{ kind: "axis", axis: "x" }} plot={plot} table={card.table}
      userPresets={[]} profileDefault={null}
      onSelect={vi.fn()} onSetAxis={onSetAxis} onSetAxisLength={vi.fn()} onSetAxisTitleFont={vi.fn()}
      onSetSeriesStyle={vi.fn()} onSetSeriesStyleAll={vi.fn()} onSetPointStyle={vi.fn()} onClearPointStyles={vi.fn()}
      onSetGrid={vi.fn()} onSetFrame={vi.fn()} onSetKind={vi.fn()} onSetBarLayout={vi.fn()} onSetBarShape={vi.fn()} onSetBoxWhisker={vi.fn()}
      onSetPlotOptions={vi.fn()} onSetGraphTitle={vi.fn()} onSetPlotFont={vi.fn()} onHomogenizeFont={vi.fn()}
      onSetLegend={vi.fn()} onSetSignificance={vi.fn()} onApplyPreset={vi.fn()}
      onApplyUserPreset={vi.fn()} onSaveUserPreset={vi.fn()} onDeleteUserPreset={vi.fn()} onSetProfileDefault={vi.fn()}
      annotationOps={{ add: vi.fn(), update: vi.fn(), remove: vi.fn(), reorder: vi.fn(), align: vi.fn(), group: vi.fn(), ungroup: vi.fn(), setLocked: vi.fn(), addImage: vi.fn(), replaceImage: vi.fn() } as never} />,
  );
  const box = container.querySelector('input[aria-label="Only these ticks"]') as HTMLInputElement | null;
  return { box, patches };
}

describe("Only these ticks — the control", () => {
  it("no tick of the axis's own: not offered", () => {
    expect(panel({}).box).toBeNull();
  });

  it("with a tick of its own: offered, off, and ticking it writes onlyExtraTicks: true", () => {
    const { box, patches } = panel({ extraTicks: [{ value: 2 }] });
    expect(box, "no Only these ticks box beside the axis's own ticks").not.toBeNull();
    expect(box!.checked).toBe(false);
    fireEvent.click(box!);
    expect(patches.at(-1)).toEqual({ onlyExtraTicks: true });
  });

  it("on: shown ticked, and unticking clears the field", () => {
    const { box, patches } = panel({ extraTicks: [{ value: 2 }], onlyExtraTicks: true });
    expect(box!.checked).toBe(true);
    fireEvent.click(box!);
    expect(patches.at(-1)).toEqual({ onlyExtraTicks: undefined });
  });
});
