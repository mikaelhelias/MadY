// @vitest-environment jsdom
/**
 * The polar histogram's band colours. A wind rose stacks each wedge into magnitude bands, and by default every
 * band is a shade of the one Wedge colour. Each band can take its own colour
 * (`RoseStyle.bandColors`, keyed by band number from 0 = the lowest): Chart type ▸ Polar histogram lists the bands under
 * Wedge colour, each with its colour and a reset. A band with no colour of its own keeps its shade of the base colour,
 * and the legend key follows the band it names.
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

const rose = () => {
  const g = galleryItems().find((x) => x.plot.kind === "rose");
  if (!g) throw new Error("no rose card");
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const withRose = (patch: NonNullable<Plot["rose"]>) => {
  const c = rose();
  return { ...c, plot: { ...c.plot, rose: { ...(c.plot.rose ?? {}), ...patch } } as Plot };
};
const sceneOf = (c: ReturnType<typeof rose>) => buildPlotScene(c.table, c.plot, { width: 640, height: 560, tables: c.lk });
const bandFills = (s: ReturnType<typeof sceneOf>, band: number) =>
  s.rose!.wedges.flatMap((w) => w.segments.filter((g) => g.band === band).map((g) => g.color));

describe("rose band colours — the drawing", () => {
  it("one band's own colour reaches its wedges, its range and its legend key; the other bands keep their shades", () => {
    const before = sceneOf(rose());
    expect(before.rose!.bandRanges.length, "the card has no bands - this proves nothing").toBeGreaterThan(2);
    expect(bandFills(before, 1).length, "band 1 draws no wedge - this proves nothing").toBeGreaterThan(0);
    const after = sceneOf(withRose({ bandColors: { "1": "#ff0000" } }));
    expect(new Set(bandFills(after, 1))).toEqual(new Set(["#ff0000"]));
    expect(after.rose!.bandRanges[1]!.color).toBe("#ff0000");
    expect(after.legend[1]!.color).toBe("#ff0000");
    for (const b of [0, 2, 3]) expect(bandFills(after, b), `band ${b} changed`).toEqual(bandFills(before, b));
  });

  it("the drawn wedges take it", () => {
    const { container } = render(<PlotFigure scene={sceneOf(withRose({ bandColors: { "1": "#ff0000" } }))} />);
    expect([...container.querySelectorAll("path.rosewedge")].some((p) => p.getAttribute("fill") === "#ff0000")).toBe(true);
  });

  it("unset: the scene is exactly what it was", () => {
    expect(JSON.stringify(sceneOf(withRose({ bandColors: {} })).rose)).toBe(JSON.stringify(sceneOf(rose()).rose));
  });
});

describe("rose band colours — the controls, in Chart type ▸ Polar histogram", () => {
  const panel = (c: ReturnType<typeof rose>) => {
    const onSetPlotOptions = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetPlotOptions={onSetPlotOptions} />,
    );
    return { container, onSetPlotOptions };
  };
  const bandInputs = (c: HTMLElement) => [...c.querySelectorAll<HTMLInputElement>('input[aria-label^="Band colour"]')];

  it("one colour per band, showing the colour drawn, right after Wedge colour", () => {
    const c = rose();
    const { container } = panel(c);
    const s = sceneOf(c);
    const inputs = bandInputs(container);
    expect(inputs).toHaveLength(s.rose!.bandRanges.length);
    inputs.forEach((el, i) => expect(el.value.toLowerCase(), `band ${i}`).toBe(s.rose!.bandRanges[i]!.color.toLowerCase()));
    const labels = [...container.querySelectorAll("label.frow > span:first-child")].map((x) => x.textContent);
    expect(labels.indexOf("Wedge colour")).toBeGreaterThan(-1);
    expect(labels.indexOf(`Band ${s.legend[0]!.label}`)).toBe(labels.indexOf("Wedge colour") + 1);
  });

  it("picking a colour writes that band only; the reset takes it back to its shade", () => {
    const c = withRose({ bandColors: { "0": "#00ff00" } });
    const { container, onSetPlotOptions } = panel(c);
    fireEvent.change(bandInputs(container)[2]!, { target: { value: "#ff0000" } });
    expect(onSetPlotOptions.mock.calls.at(-1)![0].rose.bandColors).toEqual({ "0": "#00ff00", "2": "#ff0000" });
    const reset = container.querySelector<HTMLButtonElement>('button[title="Band colour 1: back to its shade"]');
    expect(reset, "a band with its own colour has no reset").not.toBeNull();
    expect(container.querySelector('button[title="Band colour 2: back to its shade"]'), "a band on its shade offers a reset").toBeNull();
    fireEvent.click(reset!);
    expect(onSetPlotOptions.mock.calls.at(-1)![0].rose.bandColors).toBeUndefined();
  });

  it("one band (no magnitude bands): no band rows — Wedge colour is the colour", () => {
    const { container } = panel(withRose({ bands: 1 }));
    expect(bandInputs(container)).toHaveLength(0);
  });
});
