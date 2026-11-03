// @vitest-environment jsdom
/**
 * A shaded band set by axis values (the waterfall's "Response" and "Progression" zones) cannot move: its range is
 * the data's. Its caption is words, though, and every text on a graph drags. The caption moves on its own, is
 * stored on the band (`Annotation.labelOffset`), drawn where it was dropped, and undone in one step.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MadyDocument } from "@mady/core";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const SIZE = { width: 640, height: 480 };
const card = () => galleryItems().find((g) => g.title === "Waterfall (response)")!;

describe("a value-set band's caption", () => {
  it("drags on its own on the canvas", () => {
    const { table, plot } = card();
    const band = (plot.annotations ?? []).find((a) => a.kind === "hband" && a.label === "Progression");
    expect(band, "fixture: the waterfall card has its Progression zone").toBeTruthy();
    const onMoveRefLineLabel = vi.fn();
    const onMoveAnnotation = vi.fn();
    const { container } = render(<PlotFigure scene={buildPlotScene(table, plot as Plot, SIZE)} onMoveRefLineLabel={onMoveRefLineLabel} onMoveAnnotation={onMoveAnnotation} />);
    const text = container.querySelector(`[data-ann-text="${band!.id}"]`) as unknown as SVGElement;
    expect(text, "the caption is not drawn").toBeTruthy();
    const grp = text.parentElement as unknown as SVGGElement;
    fireEvent.pointerDown(grp, { clientX: 200, clientY: 100 });
    fireEvent.pointerMove(grp, { clientX: 230, clientY: 140 });
    fireEvent.pointerUp(grp, { clientX: 230, clientY: 140 });
    expect(onMoveRefLineLabel.mock.calls, "the caption drag did not reach the document").toEqual([[band!.id, 30, 40]]);
    expect(onMoveAnnotation, "the band itself moved").not.toHaveBeenCalled();
  });

  it("is stored on the band, drawn there, and one Undo puts it back", () => {
    const doc = new MadyDocument();
    const { table, plot } = doc.insertGraph(card().table, card().plot as Plot);
    const band = () => doc.toJSON().plots.find((q) => q.id === plot.id)!.annotations!.find((a) => a.label === "Response")!;
    const caption = () => buildPlotScene(table, doc.toJSON().plots.find((q) => q.id === plot.id)!, SIZE).annotations.find((a) => a.id === band().id)!;
    expect(caption().labelOffset, "a band set by values offers its caption drag from the start").toEqual({ dx: 0, dy: 0 });
    const lo = band().bandLo;
    doc.moveRefLineLabel(plot.id, band().id, 12, -7);
    expect(band().labelOffset).toEqual({ dx: 12, dy: -7 });
    expect(caption().labelOffset).toEqual({ dx: 12, dy: -7 });
    expect(band().bandLo, "the band's range moved").toBe(lo);
    doc.commands.undo();
    expect(band().labelOffset).toBeUndefined();
  });
});
