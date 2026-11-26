// @vitest-environment jsdom
/**
 * The polar histogram's rings: like the radar's rings, the circle lines have their own settings in
 * Chart type ▸ Polar histogram (show, colour, thickness, dashes: `RoseStyle.ring*`), and clicking a ring opens that
 * section. Style presets never touch them, and a rose with none of these set draws its rings in the theme's line
 * colour, 1 px, solid.
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
const draw = (ring: NonNullable<Plot["rose"]> = {}, onSelect = vi.fn()) => {
  const c = rose();
  const plot = { ...c.plot, rose: { ...(c.plot.rose ?? {}), ...ring } } as Plot;
  const scene = buildPlotScene(c.table, plot, { width: 640, height: 560, tables: c.lk });
  const { container } = render(<PlotFigure scene={scene} onSelect={onSelect} />);
  return { container, onSelect, scene };
};
const rings = (c: HTMLElement) => [...c.querySelectorAll<SVGCircleElement>("circle.rosering")];

describe("rose rings — the drawing", () => {
  it("unset: drawn in the theme line colour, 1 px, solid", () => {
    const { container, scene } = draw();
    expect(scene.rose!.ringStyle, "a rose with no ring setting must carry no ring style").toBeUndefined();
    const r = rings(container);
    expect(r.length, "the card draws no rings - this proves nothing").toBeGreaterThan(1);
    for (const el of r) {
      expect(el.getAttribute("stroke")).toBe("var(--line)");
      expect(el.getAttribute("stroke-width")).toBe("1");
      expect(el.getAttribute("stroke-dasharray")).toBeNull();
    }
  });

  it("colour, thickness and dashes reach every ring", () => {
    const { container } = draw({ ringColor: "#ff0000", ringWidth: 3, ringDash: "dashed" });
    const r = rings(container);
    expect(r.length).toBeGreaterThan(1);
    for (const el of r) {
      expect(el.getAttribute("stroke")).toBe("#ff0000");
      expect(el.getAttribute("stroke-width")).toBe("3");
      expect(el.getAttribute("stroke-dasharray") ?? "").not.toBe("");
    }
  });

  it("hidden: no ring lines, the ring numbers stay", () => {
    const before = draw().container.querySelectorAll(".gfx-rose text").length;
    cleanup();
    const { container } = draw({ ringShow: false });
    expect(rings(container)).toHaveLength(0);
    expect(container.querySelectorAll(".gfx-rose text").length).toBe(before);
  });

  it("clicking a ring opens Chart type (where the Polar histogram settings are)", () => {
    const { container, onSelect } = draw();
    const target = container.querySelector("circle.rosering-hit");
    expect(target, "a ring has no click target").not.toBeNull();
    fireEvent.click(target!);
    expect(onSelect).toHaveBeenCalledWith({ kind: "chart-section", title: "Chart type" });
  });

  it("a hidden ring offers no click target", () => {
    expect(draw({ ringShow: false }).container.querySelector("circle.rosering-hit")).toBeNull();
  });
});

describe("rose rings — the controls, in Chart type ▸ Polar histogram", () => {
  const panel = (onSetPlotOptions = vi.fn()) => {
    const c = rose();
    const { container } = render(
      <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "plot" } as never} plot={c.plot} table={c.table}
        userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()} onSetPlotOptions={onSetPlotOptions} />,
    );
    return { container, onSetPlotOptions };
  };
  const row = (c: HTMLElement, label: string) =>
    [...c.querySelectorAll("label.frow")].find((l) => l.querySelector(":scope > span")?.textContent === label);

  it("Show rings, Ring colour, Ring width and Ring dashes sit right after Compass (N up)", () => {
    const { container } = panel();
    const labels = [...container.querySelectorAll("label.frow > span:first-child")].map((s) => s.textContent);
    const at = labels.indexOf("Compass (N up)");
    expect(at, "no Polar histogram section").toBeGreaterThan(-1);
    for (const l of ["Show rings", "Ring colour", "Ring width", "Ring dashes"]) expect(labels, l).toContain(l);
    expect(labels.indexOf("Show rings")).toBeGreaterThan(at);
  });

  it("each one writes its own field", () => {
    const { container, onSetPlotOptions } = panel();
    fireEvent.click(row(container, "Show rings")!.querySelector("input")!);
    expect(onSetPlotOptions.mock.calls.at(-1)![0].rose).toMatchObject({ ringShow: false });
    fireEvent.change(row(container, "Ring width")!.querySelector("input")!, { target: { value: "2.5" } });
    expect(onSetPlotOptions.mock.calls.at(-1)![0].rose).toMatchObject({ ringWidth: 2.5 });
    fireEvent.change(row(container, "Ring dashes")!.querySelector("select")!, { target: { value: "dotted" } });
    expect(onSetPlotOptions.mock.calls.at(-1)![0].rose).toMatchObject({ ringDash: "dotted" });
    expect(row(container, "Ring colour")!.querySelector('input, [aria-label="Ring colour"]'), "no colour input").not.toBeNull();
  });
});
