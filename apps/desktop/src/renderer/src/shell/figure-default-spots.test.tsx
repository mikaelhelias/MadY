// @vitest-environment jsdom
/**
 * Panels with no stored position sit at default spots on the figure's grid. The spots make room for each card: a panel
 * bigger than the standard card moves its neighbours along instead of being drawn over them, and standard cards keep
 * the fixed grid they always had.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { DataTable, FigureLayout, Plot, Project } from "@mady/core";
import { defaultPanelSpots, LayoutPane } from "./panes";

afterEach(cleanup);

describe("defaultPanelSpots", () => {
  const W = 396, H = 308, G = 16;

  it("standard cards: the fixed grid (8 px in, one standard card + gutter apart)", () => {
    const spots = defaultPanelSpots([{ w: 380, h: 280 }, { w: W, h: H }, { w: 200, h: 100 }], 2, G, W, H);
    expect(spots).toEqual([{ x: 8, y: 8 }, { x: 8 + W + G, y: 8 }, { x: 8, y: 8 + H + G }]);
  });

  it("a wide card in the first column moves the second column along by its own width", () => {
    const spots = defaultPanelSpots([{ w: 676, h: 200 }, { w: 300, h: 200 }, { w: 300, h: 200 }, { w: 300, h: 200 }], 2, G, W, H);
    expect(spots[1]!.x).toBe(8 + 676 + G);
    expect(spots[3]!.x).toBe(8 + 676 + G);
  });

  it("a tall card in the first row moves the second row down by its own height", () => {
    const spots = defaultPanelSpots([{ w: 300, h: 772 }, { w: 300, h: 100 }, { w: 300, h: 100 }], 2, G, W, H);
    expect(spots[2]!.y).toBe(8 + 772 + G);
  });

  it("a card of no size (a panel placed by hand) leaves its column and row at the standard size", () => {
    const spots = defaultPanelSpots([{ w: 0, h: 0 }, { w: 300, h: 100 }, { w: 300, h: 100 }], 2, G, W, H);
    expect(spots).toEqual([{ x: 8, y: 8 }, { x: 8 + W + G, y: 8 }, { x: 8, y: 8 + H + G }]);
  });
});

describe("a figure whose panels are bigger than the standard card", () => {
  const table: DataTable = {
    id: "t", kind: "xy", name: "T",
    columns: [{ id: "x", name: "X", role: "x" }, { id: "y", name: "Y", role: "y" }],
    rows: [{ id: "r1", cells: { x: 1, y: 2 } }, { id: "r2", cells: { x: 2, y: 4 } }],
  };
  const plot = (id: string): Plot => ({ id, name: id, source: "t", status: "ok", styleOverrides: {}, kind: "xy" });
  const project = (layout: Partial<FigureLayout>): Project => ({
    schemaVersion: 5, tables: [table], plots: ["A", "B", "C", "D"].map(plot), analyses: [], log: [],
    layouts: [{ id: "L", name: "Figure", panels: ["A", "B", "C", "D"], columns: 2, ...layout }],
    workspace: { folders: [], loose: [] },
  });
  const boxes = (container: HTMLElement) =>
    ([...container.querySelectorAll(".laypanel")] as HTMLElement[]).map((el) => ({
      x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height),
    }));
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it("no two cards overlap: wide panels on the first row, tall ones on the second", () => {
    const { container } = render(
      <LayoutPane project={project({ panelSizes: { A: { w: 660, h: 468 }, B: { w: 660, h: 468 }, C: { w: 372, h: 756 }, D: { w: 372, h: 756 } } })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    const b = boxes(container);
    expect(b.length).toBe(4);
    expect(b.every((x) => Number.isFinite(x.x) && Number.isFinite(x.w) && x.w > 600 === (b.indexOf(x) < 2)), "the fixture draws two wide and two narrow cards").toBe(true);
    for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) {
      expect(overlap(b[i]!, b[j]!), `cards ${i + 1} and ${j + 1} overlap: ${JSON.stringify([b[i], b[j]])}`).toBe(false);
    }
  });

  it("standard-size panels keep the fixed grid spots", () => {
    const { container } = render(<LayoutPane project={project({})} layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />);
    const b = boxes(container);
    expect(b.map((x) => [x.x, x.y])).toEqual([[8, 8], [8 + 396 + 16, 8], [8, 8 + 308 + 16], [8 + 396 + 16, 8 + 308 + 16]]);
  });

  it("a panel placed by hand stays where it was put", () => {
    const { container } = render(
      <LayoutPane project={project({ panelPositions: { B: { x: 900, y: 30 } }, panelSizes: { A: { w: 660, h: 468 } } })}
        layoutId="L" onRemovePanel={() => {}} onOpenPlot={() => {}} onSetLayoutOptions={() => {}} />,
    );
    const b = boxes(container);
    expect([b[1]!.x, b[1]!.y]).toEqual([900, 30]);
  });
});
