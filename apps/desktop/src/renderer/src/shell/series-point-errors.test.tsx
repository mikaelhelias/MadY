// @vitest-environment jsdom
/**
 * "Each row is a mean ± error" (`SeriesStyle.pointErrors`) in the drawing and in a box / violin series' panel: the
 * figure draws one line per dot through it; the panel offers the option only on a group entered as mean ± error, and
 * its colour and thickness only while it is on.
 */
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { DataTable, Plot, SeriesStyle } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { Inspector } from "./Inspector";
import { PlotFigure } from "./PlotFigure";

afterEach(cleanup);
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

const MEANS = [-20, -10, -5, 0, 4, 12];
const SEMS = [3, 1, 6, 2, 0, 4];
const meanErr: DataTable = {
  id: "t", kind: "column", name: "T",
  columns: [{ id: "m", name: "Mice", role: "y" }, { id: "e", name: "SEM", role: "sem", group: "m" }, { id: "s", name: "Shuffled", role: "y" }],
  rows: MEANS.map((v, i) => ({ id: `r${i}`, cells: { m: v, e: SEMS[i]!, s: (i % 3) - 1 } })),
};
const raw: DataTable = { ...meanErr, columns: [{ id: "m", name: "Mice", role: "y" }, { id: "s", name: "Shuffled", role: "y" }] };
const plotOf = (kind: "box" | "violin", m: SeriesStyle): Plot => ({ id: "p", name: "P", source: "t", status: "ok", styleOverrides: {}, kind, seriesStyles: { m } }) as Plot;

for (const kind of ["box", "violin"] as const) {
  describe(`${kind}: error line per dot`, () => {
    it("the figure draws one line per dot with an error (the SEM-0 mouse has none), each through its dot", () => {
      const scene = buildPlotScene(meanErr, plotOf(kind, { pointErrors: true, showPoints: true }), { width: 640, height: 420 });
      const { container } = render(<PlotFigure scene={scene} />);
      const lines = [...container.querySelectorAll(".gfx-point-errors line")];
      expect(lines.length).toBe(5);
      const dots = scene.series.find((s) => s.id === "m")!.marks[0]!.points!;
      for (const l of lines) {
        const x = Number(l.getAttribute("x1"));
        expect(Number(l.getAttribute("x2"))).toBe(x);
        expect(dots.some((d) => Math.abs(d.cx - x) < 1e-9)).toBe(true);
      }
    });

    it("no lines when the option is off", () => {
      const scene = buildPlotScene(meanErr, plotOf(kind, { showPoints: true }), { width: 640, height: 420 });
      const { container } = render(<PlotFigure scene={scene} />);
      expect(container.querySelectorAll(".gfx-point-errors line").length).toBe(0);
    });

    const panel = (table: DataTable, own: SeriesStyle) => {
      const onSetSeriesStyle = vi.fn();
      // A violin's edits go to every violin while its "all violins" switch is on (the default), through the all-series
      // path; the clicked group must be among them.
      const onSetSeriesStyleAll = vi.fn((ids: string[], delta: SeriesStyle) => { if (ids.includes("m")) onSetSeriesStyle("m", delta); });
      const { container } = render(
        <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={{ kind: "series", columnId: "m" } as never}
          plot={plotOf(kind, own)} table={table} userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={() => {}} onSelect={vi.fn()}
          onSetSeriesStyle={onSetSeriesStyle} onSetSeriesStyleAll={onSetSeriesStyleAll} onSetPointStyle={vi.fn()} onSetPlotOptions={vi.fn()} />,
      );
      const row = (label: string) => [...container.querySelectorAll("label.frow")].find((l) => l.querySelector("span")?.textContent?.trim() === label);
      const group = [...container.querySelectorAll("summary, .inspsub")].some((e) => e.textContent?.trim().startsWith("Error per dot"));
      return { row, group, onSetSeriesStyle };
    };

    it("panel, mean ± error group: the option is offered; ticking writes pointErrors: true", () => {
      const { row, onSetSeriesStyle } = panel(meanErr, {});
      const r = row("Each row is a mean ± error");
      expect(r, "no “Each row is a mean ± error” row").toBeDefined();
      fireEvent.click(r!.querySelector("input")!);
      expect(onSetSeriesStyle).toHaveBeenLastCalledWith("m", expect.objectContaining({ pointErrors: true }));
    });

    it("panel, raw-value group: not offered", () => {
      const { group } = panel(raw, {});
      expect(group).toBe(false);
    });
  });
}
