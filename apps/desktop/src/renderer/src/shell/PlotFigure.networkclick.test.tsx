// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import type { GraphSelection } from "./AppShell";

/**
 * Clicking a network node leaves that node selected.
 *
 * Guards against the node being selected for one tick and the Inspector then showing the
 * graph-wide Chart panel instead of the node editor, which makes the per-node styling
 * (fill / two-tone / outline / size for this node) unreachable by clicking; the only way in
 * would be the Data rail tab.
 *
 * The mechanism is a pointerup-vs-click ordering problem: `nodeUp` selects on pointerup and
 * stops that event, but the browser then fires a `click` on the common ancestor, and the
 * network `<svg>`'s own `onClick` (the "click the background to select the whole plot"
 * affordance) can overwrite the selection with {kind:"plot"}. Tests that fire only
 * pointerdown/pointerup never produce that second event, so they cannot detect it — hence
 * the explicit `fireEvent.click` here.
 *
 * The assertions read the last call, never "was it ever called with the node": when the
 * background click overwrites the selection, the node is still selected first, so
 * `toHaveBeenCalledWith(node)` would pass in that case too.
 */
const netTable: DataTable = {
  id: "t", kind: "xy", name: "N",
  columns: [{ id: "s", name: "src" }, { id: "tg", name: "tgt" }],
  rows: [{ id: "r1", cells: { s: "A", tg: "B" } }, { id: "r2", cells: { s: "B", tg: "C" } }],
};
const netPlot: Plot = {
  id: "p", name: "P", source: "t", status: "ok", styleOverrides: {},
  kind: "network", network: { nodeColor: "#3399ff" },
};
const scene = () => buildPlotScene(netTable, netPlot, { width: 440, height: 320 });
/** A node disc — a <circle> with a hex fill (edges are paths, the selection ring has none). */
const nodeDiscs = (c: HTMLElement): SVGCircleElement[] =>
  [...c.querySelectorAll<SVGCircleElement>("circle")].filter((el) => el.getAttribute("fill")?.startsWith("#"));

afterEach(cleanup);

describe("PlotFigure — clicking a network node selects that node", () => {
  /** The real gesture: press, release, and the click the browser fires afterwards. */
  const clickNode = (disc: SVGCircleElement): void => {
    fireEvent.pointerDown(disc, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(disc, { clientX: 10, clientY: 10 });
    fireEvent.click(disc, { clientX: 10, clientY: 10 });
  };

  it("leaves the node selected — the background click must not overwrite it", () => {
    const onSelect = vi.fn();
    const r = render(
      <PlotFigure scene={scene()} selected={null} onSelect={onSelect} onMoveNetworkNode={() => {}} onMoveAnnotation={() => {}} />,
    );
    const disc = nodeDiscs(r.container)[0]!;
    clickNode(disc);

    expect(onSelect).toHaveBeenCalled();
    const last = onSelect.mock.calls.at(-1)![0] as GraphSelection;
    expect(
      last,
      `after clicking a node the selection is ${JSON.stringify(last)} — the <svg> onClick overwrote it, so the node editor never opens`,
    ).toEqual({ kind: "network-node", nodeId: expect.any(String) });
  });

  it("clicking the background still selects the whole plot (the affordance is intact)", () => {
    const onSelect = vi.fn();
    const r = render(
      <PlotFigure scene={scene()} selected={null} onSelect={onSelect} onMoveNetworkNode={() => {}} onMoveAnnotation={() => {}} />,
    );
    fireEvent.click(r.container.querySelector("svg.gfx-figure")!);
    expect(onSelect.mock.calls.at(-1)![0]).toEqual({ kind: "plot" });
  });

  it("a drag still moves the node and does not select it", () => {
    const onSelect = vi.fn();
    const onMoveNetworkNode = vi.fn();
    const r = render(
      <PlotFigure scene={scene()} selected={null} onSelect={onSelect} onMoveNetworkNode={onMoveNetworkNode} onMoveAnnotation={() => {}} />,
    );
    const disc = nodeDiscs(r.container)[0]!;
    fireEvent.pointerDown(disc, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(disc, { clientX: 60, clientY: 70 });
    fireEvent.pointerUp(disc, { clientX: 60, clientY: 70 });
    fireEvent.click(disc, { clientX: 60, clientY: 70 });
    expect(onMoveNetworkNode).toHaveBeenCalled();
    // A drag must not fall through to the background handler either.
    expect(onSelect).not.toHaveBeenCalledWith({ kind: "plot" });
  });
});
