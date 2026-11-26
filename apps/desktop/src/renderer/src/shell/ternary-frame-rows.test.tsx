// @vitest-environment jsdom
/**
 * A ternary plot's triangle is its frame and its tick marks are its own, so the builder fixes the frame, tick
 * direction, tick length and minor gridlines. Frame ▸ Grid, frame & axes offered those four rows there, where they
 * changed nothing; the gridline rows the ternary does draw (show, density, thickness, style, colour) stay.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";
import { renderFingerprint } from "./drawingMarkup";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
const handlers = () => ({
  onSelect: vi.fn(), wholeGraph: false, onSetWholeGraph: vi.fn(),
  onSetAxis: vi.fn(), onSetAxisLength: vi.fn(), onSetAxisTitleFont: vi.fn(),
  onSetSeriesStyle: vi.fn(), onSetSeriesStyleAll: vi.fn(), onSetPointStyle: vi.fn(), onClearPointStyles: vi.fn(),
  onSetGrid: vi.fn(), onSetFrame: vi.fn(), onSetKind: vi.fn(), onSetBarLayout: vi.fn(), onSetBarShape: vi.fn(), onSetBoxWhisker: vi.fn(),
  onSetPlotOptions: vi.fn(), onSetGraphTitle: vi.fn(), onSetPlotFont: vi.fn(), onHomogenizeFont: vi.fn(),
  onSetLegend: vi.fn(), onSetSignificance: vi.fn(), onApplyPreset: vi.fn(),
  onApplyUserPreset: vi.fn(), onSaveUserPreset: vi.fn(), onDeleteUserPreset: vi.fn(), onSetProfileDefault: vi.fn(),
  annotationOps: {} as never,
});
const card = (kind: string) => (galleryItems() as unknown as { table: DataTable; plot: Plot }[]).find((i) => i.plot.kind === kind)!;
const frameRows = (kind: string): string[] => {
  const c = card(kind);
  const u = render(<Inspector activeSection="graphs" selection={{ kind: "plot" }} plot={c.plot} table={c.table} userPresets={[]} profileDefault={null} {...handlers()} />);
  const tab = [...u.container.querySelectorAll<HTMLButtonElement>("button.inspcat")].find((b) => b.textContent?.trim() === "Frame");
  if (tab) act(() => { fireEvent.click(tab); });
  const out = [...u.container.querySelectorAll("label.frow > span:first-child")].map((e) => (e.textContent ?? "").trim());
  cleanup();
  return out;
};
const FIXED = ["Minor lines", "Frame", "Tick direction", "Tick length"];

describe("ternary Grid, frame & axes", () => {
  it("the four fixed settings do not move the ternary drawing (a fixture that can show the fault)", () => {
    const c = card("ternary");
    const base = renderFingerprint(c.table, c.plot, { width: 620, height: 420 });
    for (const p of [{ grid: { ...c.plot.grid, minor: true } }, { frame: "box" }, { tickDir: "in" }, { tickLen: 12 }]) {
      expect(renderFingerprint(c.table, { ...c.plot, ...p } as Plot, { width: 620, height: 420 }), JSON.stringify(p)).toBe(base);
    }
  });
  it("withholds them on a ternary and keeps its gridline rows", () => {
    const r = frameRows("ternary");
    for (const f of FIXED) expect(r, f).not.toContain(f);
    expect(r).toContain("Gridlines");
  });
  it("an XY graph keeps them", () => {
    const r = frameRows("xy");
    for (const f of FIXED) expect(r, f).toContain(f);
  });
});
