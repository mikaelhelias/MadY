// @vitest-environment jsdom
/**
 * A voronoi treemap's arrangement can be changed.
 *
 * The packing starts from a seeded scatter and the builder honours `treemap.seed`; without a
 * control for it the user would be stuck with one packing. "Arrangement" (a number) and
 * "Another" (next number) in the Treemap section write it.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const item = () => galleryItems().find((i) => i.plot.kind === "treemap")!;

function panel(plot: Plot) {
  const noop = vi.fn();
  const onSetPlotOptions = vi.fn<(patch: Partial<Plot>) => void>();
  const { container } = render(
    <Inspector {...({} as ComponentProps<typeof Inspector>)} onSetPlotOptions={onSetPlotOptions} activeSection="graphs" selection={{ kind: "plot" }} plot={plot} table={item().table}
      userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop}
      annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
  );
  return { container, onSetPlotOptions };
}

const cells = (plot: Plot): string => JSON.stringify((buildPlotScene(item().table, plot, {}) as { treemap?: unknown }).treemap);

describe("treemap arrangement", () => {
  it("the number and the Another button each give the drawing a different packing", () => {
    const plot = item().plot;
    expect((plot.treemap?.layout ?? "voronoi"), "the gallery treemap is not a voronoi one — cannot exhibit this").toBe("voronoi");
    const { container, onSetPlotOptions } = panel(plot);
    fireEvent.change(container.querySelector('input[aria-label="Arrangement number"]')!, { target: { value: "7" } });
    const typed = onSetPlotOptions.mock.calls.at(-1)![0];
    expect(typed.treemap?.seed).toBe(7);
    expect(cells({ ...plot, ...typed })).not.toBe(cells(plot));
    const another = [...container.querySelectorAll("button")].find((b) => b.textContent === "Another")!;
    fireEvent.click(another);
    const next = onSetPlotOptions.mock.calls.at(-1)![0];
    expect(next.treemap?.seed).toBeDefined();
    expect(cells({ ...plot, ...next })).not.toBe(cells(plot));
  });

  it("a squarified treemap (no randomness) does not offer it", () => {
    const plot = { ...item().plot, treemap: { ...(item().plot.treemap ?? {}), layout: "squarified" } } as Plot;
    const { container } = panel(plot);
    expect(container.querySelector('input[aria-label="Arrangement number"]')).toBeNull();
  });
});
