// @vitest-environment jsdom
/**
 * The oncoprint's gap colour. The gap is the space between tiles; its thickness is Chart type ▸ Tile gap. Gap colour (`OncoprintStyle.gapColor`), right after
 * Tile gap, paints a panel behind the tiles — spanning the first tile to the last, so the gaps take the colour and no
 * border appears around the grid. Clicking a gap opens those settings. Unset: nothing is drawn behind the tiles, and
 * whatever is behind the grid shows through the gaps.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems, galleryLookup } from "./gallery";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const onco = (patch: NonNullable<Plot["oncoprint"]> = {}) => {
  const g = galleryItems().find((x) => x.plot.kind === "oncoprint");
  if (!g) throw new Error("no oncoprint card");
  const plot = { ...g.plot, oncoprint: { ...(g.plot.oncoprint ?? {}), ...patch } } as Plot;
  return { table: g.table as DataTable, plot, scene: buildPlotScene(g.table, plot, { width: 640, height: 480, tables: galleryLookup(g) }) };
};

describe("oncoprint gap colour — the drawing", () => {
  it("unset: nothing behind the tiles", () => {
    const s = onco().scene;
    expect(s.oncoprint!.tiles.length, "the card draws no tiles - this proves nothing").toBeGreaterThan(4);
    expect(s.oncoprint!.gap).toBeUndefined();
    const { container } = render(<PlotFigure scene={s} />);
    expect(container.querySelector("rect.oncogap")).toBeNull();
  });

  it("set: a panel of that colour behind the tiles, from the first tile's edge to the last", () => {
    const s = onco({ gapColor: "#ff0000" }).scene;
    const t = s.oncoprint!.tiles;
    const g = s.oncoprint!.gap!;
    expect(g.color).toBe("#ff0000");
    expect(g.x).toBeCloseTo(Math.min(...t.map((x) => x.x)));
    expect(g.y).toBeCloseTo(Math.min(...t.map((x) => x.y)));
    expect(g.x + g.w).toBeCloseTo(Math.max(...t.map((x) => x.x + x.w)));
    expect(g.y + g.h).toBeCloseTo(Math.max(...t.map((x) => x.y + x.h)));
    const { container } = render(<PlotFigure scene={s} />);
    const rects = [...container.querySelectorAll(".gfx-oncoprint rect")];
    const gap = container.querySelector("rect.oncogap");
    expect(gap?.getAttribute("fill")).toBe("#ff0000");
    expect(rects.indexOf(gap!), "the gap panel must be drawn behind the tiles").toBe(0);
  });

  it("no gap (Tile gap 0): nothing to colour, nothing drawn", () => {
    expect(onco({ gapColor: "#ff0000", tileGap: 0 }).scene.oncoprint!.gap).toBeUndefined();
  });

  it("clicking the gap opens Chart type", () => {
    const onSelect = vi.fn();
    const { container } = render(<PlotFigure scene={onco({ gapColor: "#ff0000" }).scene} onSelect={onSelect} />);
    fireEvent.click(container.querySelector("rect.oncogap")!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "chart-section", title: "Chart type" });
  });
});

describe("oncoprint gap colour — the control", () => {
  const panel = (patch: NonNullable<Plot["oncoprint"]> = {}) => {
    const c = onco(patch);
    const onSetPlotOptions = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetPlotOptions={onSetPlotOptions} />,
    );
    return { container, onSetPlotOptions };
  };
  const labels = (c: HTMLElement) => [...c.querySelectorAll("label.frow > span:first-child")].map((s) => s.textContent);

  it("Gap colour sits right after Tile gap, and writes gapColor", () => {
    const { container, onSetPlotOptions } = panel();
    const l = labels(container);
    expect(l.indexOf("Gap colour"), "no Gap colour").toBe(l.indexOf("Tile gap") + 1);
    fireEvent.change(container.querySelector('input[aria-label="Gap colour"]')!, { target: { value: "#123456" } });
    expect(onSetPlotOptions.mock.calls.at(-1)![0].oncoprint).toMatchObject({ gapColor: "#123456" });
  });

  it("a reset appears once it is set, and clears it", () => {
    expect(panel().container.querySelector('button[title="Gap colour: back to see-through"]')).toBeNull();
    cleanup();
    const { container, onSetPlotOptions } = panel({ gapColor: "#ff0000" });
    fireEvent.click(container.querySelector('button[title="Gap colour: back to see-through"]')!);
    expect(onSetPlotOptions.mock.calls.at(-1)![0].oncoprint.gapColor).toBeUndefined();
  });

  it("Tile gap 0: no Gap colour — there is no gap to colour", () => {
    expect(labels(panel({ tileGap: 0 }).container)).not.toContain("Gap colour");
  });
});
