// @vitest-environment jsdom
/**
 * The split controls: change every break at once, or just the selected one.
 *
 * A heatmap can be split into several blocks, each break styled differently; the spacing or
 * the line thickness — whichever style the break uses — can be set for all breaks or for one
 * selected break.
 *
 * So the assertions here are about reach, not about pixels (the geometry is pinned in
 * packages/graphics/src/heatmap-splits.test.ts):
 *  • the shared row writes the chart-wide default and every un-overridden break follows it;
 *  • a break's own row writes only that break;
 *  • the number offered follows the style chosen — a space has a width, a rule a thickness —
 *    per break, not just chart-wide;
 *  • a break can be put back under the shared setting, and the button says so.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DataTable, HeatSplit, Plot } from "@mady/core";
import { Inspector } from "./Inspector";

afterEach(cleanup);

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

const table: DataTable = {
  id: "t", kind: "xy", name: "T",
  columns: [{ id: "g", name: "Gene" }, { id: "c0", name: "Ctrl" }, { id: "c1", name: "A" }, { id: "c2", name: "B" }],
  rows: ["G1", "G2", "G3", "G4", "G5", "G6"].map((g, i) => ({
    id: `r${i}`, cells: { g, c0: i + 1, c1: i + 2, c2: i + 3 },
  })),
};

function show(heatmap: NonNullable<Plot["heatmap"]>) {
  const h = handlers();
  const plot = { id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind: "heatmap", heatmap } as Plot;
  render(
    <Inspector activeSection="graphs" selection={{ kind: "plot" } as never} plot={plot} table={table}
      userPresets={[]} profileDefault={null} {...h} />,
  );
  return h;
}
/** The heatmap patch the panel wrote. */
const wrote = (h: ReturnType<typeof handlers>): NonNullable<Plot["heatmap"]> =>
  (h.onSetPlotOptions.mock.calls[0]![0] as Plot).heatmap!;

describe("adding and removing breaks", () => {
  it("offers a way to add a break on each axis, and the first one lands somewhere it can draw", () => {
    const h = show({});
    expect(screen.getByLabelText("Add a row split")).toBeTruthy();
    expect(screen.getByLabelText("Add a column split")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Add a row split"));
    expect(wrote(h).rowSplits).toEqual([{ at: 0 }]);
  });

  it("adds the next free position, so two clicks make two different breaks", () => {
    const h = show({ rowSplits: [{ at: 0 }] });
    fireEvent.click(screen.getByLabelText("Add a row split"));
    expect(wrote(h).rowSplits).toEqual([{ at: 0 }, { at: 1 }]);
  });

  it("refuses to add one when every gap already has a break, and says why", () => {
    // 3 columns → only 2 places a break can go
    show({ colSplits: [{ at: 0 }, { at: 1 }] });
    const add = screen.getByLabelText("Add a column split") as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toMatch(/already has a split/i);
  });

  it("removes the break you point at, not the first one", () => {
    const h = show({ rowSplits: [{ at: 1 }, { at: 3 }] });
    fireEvent.click(screen.getByLabelText("Remove row split 2"));
    expect(wrote(h).rowSplits).toEqual([{ at: 1 }]);
  });

  it("removing the last break clears the field rather than leaving an empty list", () => {
    const h = show({ rowSplits: [{ at: 1 }] });
    fireEvent.click(screen.getByLabelText("Remove row split 1"));
    expect(wrote(h).rowSplits).toBeUndefined();
  });

  it("a break is placed by a 1-based position — 'after row 3' is what a person reads", () => {
    const h = show({ rowSplits: [{ at: 1 }] });
    const pos = screen.getByLabelText("row split 1 position") as HTMLInputElement;
    expect(pos.value, "the stored index is 0-based; the box must show 1-based").toBe("2");
    fireEvent.change(pos, { target: { value: "4" } });
    expect(wrote(h).rowSplits).toEqual([{ at: 3 }]);
  });
});

describe("all breaks, or just the one", () => {
  const two: HeatSplit[] = [{ at: 1 }, { at: 3 }];

  it("the shared row sets the style for every break", () => {
    const h = show({ rowSplits: two });
    fireEvent.change(screen.getByLabelText("Break style for all splits"), { target: { value: "both" } });
    expect(wrote(h).splitStyle).toBe("both");
    expect(wrote(h).rowSplits, "the shared setting must not stamp itself onto the breaks").toEqual(two);
  });

  it("the shared space and the shared rule thickness each have their own row", () => {
    const h = show({ rowSplits: two, splitStyle: "both" });
    fireEvent.change(screen.getByLabelText("Space for all splits"), { target: { value: "24" } });
    expect(wrote(h).splitGap).toBe(24);
    cleanup();
    const h2 = show({ rowSplits: two, splitStyle: "both" });
    fireEvent.change(screen.getByLabelText("Rule thickness for all splits"), { target: { value: "4" } });
    expect(wrote(h2).splitLineWidth).toBe(4);
  });

  it("the number offered follows the style — a space has no thickness, a rule has no width", () => {
    show({ rowSplits: two, splitStyle: "gap" });
    expect(screen.getByLabelText("Space for all splits")).toBeTruthy();
    expect(screen.queryByLabelText("Rule thickness for all splits"), "a space cannot have a thickness").toBeNull();
    cleanup();
    show({ rowSplits: two, splitStyle: "line" });
    expect(screen.queryByLabelText("Space for all splits"), "a rule opens no space").toBeNull();
    expect(screen.getByLabelText("Rule thickness for all splits")).toBeTruthy();
    cleanup();
    show({ rowSplits: two, splitStyle: "both" });
    expect(screen.getByLabelText("Space for all splits")).toBeTruthy();
    expect(screen.getByLabelText("Rule thickness for all splits")).toBeTruthy();
  });

  it("one break's space can be set without touching the other", () => {
    const h = show({ rowSplits: two, splitGap: 8 });
    fireEvent.change(screen.getByLabelText("row split 2 space"), { target: { value: "40" } });
    expect(wrote(h).rowSplits).toEqual([{ at: 1 }, { at: 3, gap: 40 }]);
    expect(wrote(h).splitGap, "one break must not rewrite the shared setting").toBe(8);
  });

  it("one break's style changes which number it offers, and the others keep theirs", () => {
    show({ rowSplits: two, splitStyle: "gap" });
    // break 1 follows the shared "space" style: no thickness box
    expect(screen.queryByLabelText("row split 1 rule thickness")).toBeNull();
    cleanup();
    show({ rowSplits: [{ at: 1, style: "line" }, { at: 3 }], splitStyle: "gap" });
    expect(screen.getByLabelText("row split 1 rule thickness"), "a break set to Rule must offer a thickness").toBeTruthy();
    expect(screen.queryByLabelText("row split 1 space"), "…and stop offering a width").toBeNull();
    expect(screen.getByLabelText("row split 2 space"), "the other break still follows the shared space style").toBeTruthy();
  });

  it("a break shows the shared value as its placeholder, so 'blank' visibly means 'follow'", () => {
    show({ rowSplits: two, splitGap: 13 });
    const box = screen.getByLabelText("row split 1 space") as HTMLInputElement;
    expect(box.value).toBe("");
    expect(box.placeholder).toBe("13");
  });

  it("a break can be put back under the shared setting, and the button is disabled until it has left", () => {
    const clean = show({ rowSplits: [{ at: 1 }] });
    const reset = screen.getByLabelText("Put row split 1 back under the shared setting") as HTMLButtonElement;
    expect(reset.disabled, "nothing to reset on a break that never overrode anything").toBe(true);
    expect(clean.onSetPlotOptions).not.toHaveBeenCalled();
    cleanup();

    const h = show({ rowSplits: [{ at: 1, gap: 40, style: "both", color: "#ff0000" }] });
    const live = screen.getByLabelText("Put row split 1 back under the shared setting") as HTMLButtonElement;
    expect(live.disabled).toBe(false);
    fireEvent.click(live);
    expect(wrote(h).rowSplits).toEqual([{ at: 1, style: undefined, gap: undefined, lineWidth: undefined, color: undefined }]);
  });

  it("each break carries its own block label", () => {
    const h = show({ rowSplits: two });
    fireEvent.change(screen.getByLabelText("row split 2 block label"), { target: { value: "Treated" } });
    expect(wrote(h).rowSplits).toEqual([{ at: 1 }, { at: 3, label: "Treated" }]);
  });
});

describe("where the controls are", () => {
  it("splits are offered on a matrix heatmap and withheld from the density view", () => {
    show({});
    expect(screen.getByLabelText("Add a row split")).toBeTruthy();
    cleanup();
    show({ mode: "density2d" });
    expect(screen.queryByLabelText("Add a row split"), "a density cloud has no rows to split").toBeNull();
  });
});

describe("blocks from the tree", () => {
  it("is offered only on an axis that has a tree — cutting one that does not exist draws nothing", () => {
    show({});
    expect(screen.queryByLabelText("Row blocks from the tree"), "no clustering, no tree to cut").toBeNull();
    expect(screen.queryByLabelText("Column blocks from the tree")).toBeNull();
    cleanup();
    show({ cluster: "rows" });
    expect(screen.getByLabelText("Row blocks from the tree")).toBeTruthy();
    expect(screen.queryByLabelText("Column blocks from the tree"), "only the rows are clustered").toBeNull();
    cleanup();
    show({ cluster: "both" });
    expect(screen.getByLabelText("Row blocks from the tree")).toBeTruthy();
    expect(screen.getByLabelText("Column blocks from the tree")).toBeTruthy();
  });

  it("writes the block count", () => {
    const h = show({ cluster: "rows" });
    fireEvent.change(screen.getByLabelText("Row blocks from the tree"), { target: { value: "3" } });
    expect(wrote(h).rowSplitK).toBe(3);
  });

  it("clearing it hands the breaks back to the hand-placed list", () => {
    const h = show({ cluster: "rows", rowSplitK: 3 });
    fireEvent.change(screen.getByLabelText("Row blocks from the tree"), { target: { value: "" } });
    expect(wrote(h).rowSplitK).toBeUndefined();
  });

  it("hides the hand-placed row list while the tree is in charge — it would not be drawn", () => {
    show({ cluster: "rows", rowSplitK: 3, rowSplits: [{ at: 1 }] });
    expect(screen.queryByLabelText("Add a row split"), "a list of breaks that does nothing").toBeNull();
    expect(screen.getByText(/breaks come from the tree/i)).toBeTruthy();
    // …the column list is untouched, because only the rows are cut by the tree
    expect(screen.getByLabelText("Add a column split")).toBeTruthy();
  });

  it("the list comes back the moment the tree is switched off", () => {
    show({ cluster: "rows", rowSplitK: 1, rowSplits: [{ at: 1 }] });
    expect(screen.getByLabelText("Add a row split")).toBeTruthy();
  });
});
