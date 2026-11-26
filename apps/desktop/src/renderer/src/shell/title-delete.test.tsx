// @vitest-environment jsdom
/**
 * Every kind's graph title (and the axis titles) can be deleted with the erase button.
 *
 * Axis titles and graph titles can be deleted with a cross that appears beside the
 * inline editor, for all graph types. The erase button lives on the shared
 * inline-editor overlay (useInlineTextEditor), so one implementation covers every
 * figure variant: double-click the text → the editor opens with the cross beside it →
 * one click commits "" through the same onEditText path typing would use ("" hides
 * the text; the toolbar's Text control brings it back).
 *
 * Per kind: open the title's editor, the erase button must be offered, and clicking it
 * must commit the empty string for the title target. Rename-only targets (a heatmap row
 * label) must not offer it — emptying a category name is a rename, not a delete.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { galleryItems } from "./gallery";
import { PlotFigure } from "./PlotFigure";
import type { TextTarget } from "./PlotFigure";
import { scenePaletteOpt } from "./scenePalette";

afterEach(cleanup);

const measure = (t: string, px: number): number => t.length * px * 0.6;
const SIZE = { width: 580, height: 380 };
const TITLE = "Kind Title";

function sceneFor(item: ReturnType<typeof galleryItems>[number]) {
  const plot = { ...item.plot, title: TITLE } as Plot;
  return buildPlotScene(item.table, plot, { measure, ...SIZE, ...scenePaletteOpt(plot) });
}

function openTitleEditor(container: HTMLElement): HTMLElement | null {
  const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === TITLE);
  if (!el) return null;
  fireEvent.doubleClick(el);
  return container.querySelector(".texterase");
}

describe("the title erase button — delete a graph title on every kind", () => {
  const items = galleryItems();

  it("covers the whole gallery", () => {
    expect(items.length).toBeGreaterThan(30);
  });

  it.each(items.map((i) => [i.plot.kind ?? "xy", i] as const))("%s", (kind, item) => {
    void kind;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={sceneFor(item)} zoom={1} onEditText={onEditText} />);
    const erase = openTitleEditor(container);
    expect(erase, "double-clicking the title must open the editor WITH the ✕").toBeTruthy();
    fireEvent.click(erase!);
    const call = onEditText.mock.calls.find(([t]) => (t as TextTarget).kind === "title");
    expect(call, "the ✕ must commit through onEditText").toBeTruthy();
    expect(call![1], "the ✕ must commit the EMPTY string (delete, not keep)").toBe("");
  });

  it("axis titles get the erase button too (xy, y axis)", () => {
    const item = items.find((i) => (i.plot.kind ?? "xy") === "xy")!;
    const onEditText = vi.fn();
    const { container } = render(<PlotFigure scene={sceneFor(item)} zoom={1} onEditText={onEditText} />);
    const yTitle = item.plot.yAxis?.title ?? "";
    expect(yTitle, "the xy card must set a y-axis title for this to measure anything").not.toBe("");
    const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === yTitle);
    expect(el, "the y-axis title must be drawn").toBeTruthy();
    fireEvent.doubleClick(el!);
    const erase = container.querySelector(".texterase");
    expect(erase, "the axis-title editor must offer the ✕").toBeTruthy();
    fireEvent.click(erase!);
    const call = onEditText.mock.calls.find(([t]) => (t as TextTarget).kind === "axisTitle");
    expect(call?.[1]).toBe("");
  });

  it("a rename-only target (heatmap row label) does not offer the erase button", () => {
    const item = items.find((i) => (i.plot.kind ?? "xy") === "heatmap")!;
    const { container } = render(<PlotFigure scene={sceneFor(item)} zoom={1} onEditText={vi.fn()} />);
    const el = [...container.querySelectorAll("text")].find((t) => (t.textContent ?? "").trim() === "GeneA");
    expect(el, "the heatmap row label must be drawn").toBeTruthy();
    fireEvent.doubleClick(el!);
    expect(container.querySelector(".texterase"), "emptying a row label is a rename — no delete ✕").toBeNull();
  });
});
