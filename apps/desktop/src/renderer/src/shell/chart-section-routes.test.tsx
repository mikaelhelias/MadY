// @vitest-environment jsdom
/**
 * A click on the figure that opens "a section" opens one that exists.
 *
 * Guards against a click that asks for a section no panel has: the Inspector hides every section
 * whose title does not contain the one asked for, so asking for "UpSet plot" (the UpSet rows sit
 * in "Chart type") would show an empty Inspector — the tab names and nothing under them. The same
 * applies to a Venn diagram ("Venn diagram") and a swimmer bar with no Start column ("Swimmer plot").
 *
 * Two checks. (1) Every section title the figure can ask for is contained in a real section title —
 * read from both sources, so a new route or a renamed section fails here. (2) For those three
 * charts, the real panel, selected that way, shows the chart's own rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { Inspector } from "./Inspector";
import { galleryItems } from "./gallery";

afterEach(cleanup);

const HERE = join(process.cwd(), "apps/desktop/src/renderer/src/shell");
const read = (f: string): string => readFileSync(join(HERE, f), "utf8");

describe("figure clicks that open a section", () => {
  it("every section the figure asks for exists in the Inspector", () => {
    const asked = new Set([...read("PlotFigure.tsx").matchAll(/kind: "chart-section", title: "([^"]+)"/g)].map((m) => m[1]!));
    const inspector = read("Inspector.tsx");
    const sections = [...inspector.matchAll(/<Section\s+title="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    expect(asked.size).toBeGreaterThan(8); // the reader found the routes
    const missing = [...asked].filter((t) => !sections.some((s) => s.includes(t)));
    expect(missing).toEqual([]);
  });

  // The panel is opened with whatever the FIGURE hands it — clicked, not typed out here — so a route
  // that names a missing section fails. (A swimmer bar with a Start column opens that series instead,
  // so the swimmer's section route is held by the source check above.)
  for (const [kind, row, target] of [["upset", "Bar colour", ".gfx-series rect"], ["venn", "Area-proportional", "svg.gfx-figure"]] as const) {
    it(`${kind}: clicking the figure opens a section that shows the chart's own rows`, () => {
      const item = galleryItems().find((i) => i.plot.kind === kind)!;
      const onSelect = vi.fn();
      const fig = render(<PlotFigure scene={buildPlotScene(item.table, item.plot, { width: 640, height: 460 })} selected={null} onSelect={onSelect} />);
      const el = fig.container.querySelector(target);
      expect(el, `nothing to click on the ${kind} figure`).toBeTruthy();
      fireEvent.click(el!);
      const sel = onSelect.mock.calls.map(([x]) => x).find((x) => x?.kind === "chart-section");
      expect(sel, `clicking the ${kind} figure opened no section`).toBeTruthy();
      cleanup();
      const noop = vi.fn();
      const { container } = render(
        <Inspector {...({} as ComponentProps<typeof Inspector>)} activeSection="graphs" selection={sel} plot={item.plot} table={item.table}
          userPresets={[]} profileDefault={null} wholeGraph={false} onSetWholeGraph={noop} onSelect={noop} onSetPlotOptions={noop}
          annotationOps={{ add: noop, update: noop, remove: noop, reorder: noop, align: noop, group: noop, ungroup: noop, setLocked: noop, addImage: noop, replaceImage: noop }} />,
      );
      const span = [...container.querySelectorAll(".frow > span")].find((x) => (x.textContent ?? "").startsWith(row));
      expect(span, `no "${row}" row rendered`).toBeTruthy();
      expect(span!.closest("[hidden]"), `"${row}" is inside a hidden section — the click opened an empty panel`).toBeNull();
    });
  }
});
