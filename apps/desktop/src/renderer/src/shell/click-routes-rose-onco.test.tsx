// @vitest-environment jsdom
/**
 * Clicks on polar histogram and oncoprint labels reach the right place — the polar histogram's data tab
 * and axis labels are editable and draggable; the oncoprint's axis labels are clickable. Guards against:
 *  - a rose's compass letters opening Chart type, while their font ("Compass & ring label font") is in Title & legend;
 *  - its ring numbers ignoring clicks;
 *  - its Data tab being greyed — the wedge colour is one click away in Chart type, and a hover-only hint is not enough;
 *  - an oncoprint's % column ignoring clicks (its Show % switch is in Chart type).
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

const card = (key: string) => {
  const g = galleryItems().find((x) => x.plot.kind === key);
  if (!g) throw new Error(`no ${key} card`);
  return { table: g.table as DataTable, plot: g.plot as Plot, lk: galleryLookup(g) };
};
const figure = (key: string) => {
  const c = card(key);
  const scene = buildPlotScene(c.table, c.plot, { width: 640, height: 560, tables: c.lk });
  const onSelect = vi.fn();
  const { container } = render(<PlotFigure scene={scene} selected={null} onSelect={onSelect} />);
  return { scene, container, onSelect };
};
const TEXT_FONT = { kind: "chart-section", title: "Title & legend" };
const CHART_TYPE = { kind: "chart-section", title: "Chart type" };

describe("polar histogram", () => {
  it("a compass letter opens its font (Title & legend)", () => {
    const { scene, container, onSelect } = figure("rose");
    const letter = scene.rose!.directionLabels[0]!.text;
    const t = [...container.querySelectorAll(".gfx-rose text")].find((x) => x.textContent === letter)!;
    // What a mouse sends: press, release, click. The letter is a draggable label, which selects on
    // the release and swallows the click after it (a lone "click" is not what a real mouse does).
    fireEvent.pointerDown(t, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.pointerUp(t, { clientX: 50, clientY: 50, pointerId: 1 });
    fireEvent.click(t);
    expect(onSelect).toHaveBeenLastCalledWith(TEXT_FONT);
  });

  it("a ring number opens its font too — it does not ignore clicks", () => {
    const { scene, container, onSelect } = figure("rose");
    const n = String(scene.rose!.rings[0]!.count);
    const t = [...container.querySelectorAll(".gfx-rose text")].find((x) => x.textContent === n)!;
    fireEvent.click(t);
    expect(onSelect).toHaveBeenLastCalledWith(TEXT_FONT);
  });

  it("the Data tab is live and takes you to the wedge colour (Chart type)", () => {
    const c = card("rose");
    const onSelect = vi.fn();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={onSelect} />,
    );
    const tab = [...container.querySelectorAll('[role="tab"]')].find((b) => b.textContent === "Data")!;
    expect(tab.getAttribute("aria-disabled"), "the Data tab is greyed").toBeNull();
    fireEvent.click(tab);
    expect(onSelect).toHaveBeenLastCalledWith(CHART_TYPE);
  });
});

describe("oncoprint", () => {
  it("a % label opens Chart type, where Show % is", () => {
    const { scene, container, onSelect } = figure("oncoprint");
    const p = scene.oncoprint!.percentLabels[0]!.text;
    const t = [...container.querySelectorAll(".gfx-oncoprint text")].find((x) => x.textContent === p)!;
    fireEvent.click(t);
    expect(onSelect).toHaveBeenLastCalledWith(CHART_TYPE);
  });
});
