// @vitest-environment jsdom
/**
 * A network node's name drags on its own (every text on a graph drags). Dragging the node already moves the node and
 * its name together; the name alone needs its own offset (`network.labelOffsets`), drawn where it was dropped, with
 * its leader line redrawn to the new place so it still says which node it names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 640, height: 480 };
const card = () => galleryItems().find((g) => g.title === "Network graph")!;
const named = (p: Plot, name: string) => buildPlotScene(card().table, p, SIZE).network!.nodes.find((n) => n.label === name)!;

describe("a network node's name", () => {
  it("drags on the canvas and reports the node it names", () => {
    const { table, plot } = card();
    const onMoveNetworkLabel = vi.fn();
    const onMoveNetworkNode = vi.fn();
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot as Plot, SIZE)} onMoveNetworkLabel={onMoveNetworkLabel} onMoveNetworkNode={onMoveNetworkNode} />);
    const text = [...container.querySelectorAll("text")].find((t) => t.textContent === "Klebsiella");
    expect(text, "fixture: the card names Klebsiella").toBeTruthy();
    const grp = text!.parentElement as unknown as SVGGElement;
    fireEvent.pointerDown(grp, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grp, { clientX: 125, clientY: 90, pointerId: 1 });
    fireEvent.pointerUp(grp, { clientX: 125, clientY: 90, pointerId: 1 });
    expect(onMoveNetworkLabel.mock.calls).toEqual([[named(plot as Plot, "Klebsiella").id, 25, -10]]);
    expect(onMoveNetworkNode, "the node moved with its name").not.toHaveBeenCalled();
  });

  it("is drawn where it was dropped, and its leader line goes there", () => {
    const plot = card().plot as Plot;
    const before = named(plot, "Klebsiella");
    const moved = { ...plot, network: { ...(plot.network ?? {}), labelOffsets: { [before.id]: { dx: 0, dy: 120 } } } };
    const after = named(moved, "Klebsiella");
    expect(after.labelOff).toEqual({ dx: 0, dy: 120 });
    expect([after.cx, after.cy], "the node itself moved").toEqual([before.cx, before.cy]);
    expect(after.labelLeader, "a name dropped far from its node needs a leader line").toBeTruthy();
    expect(after.labelLeader!.y2).toBeGreaterThan(before.cy + 60);
    const { container } = render(<PlotFigure scene={buildPlotScene(card().table, moved, SIZE)} />);
    const text = [...container.querySelectorAll("text")].find((t) => t.textContent === "Klebsiella")!;
    expect(text.closest("g")?.innerHTML ?? "", "the drawn name is not offset").toMatch(/translate\(0 120\)/);
  });
});
