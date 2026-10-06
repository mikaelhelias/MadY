// @vitest-environment jsdom
/**
 * Every graph type: a data element is clickable, and an ordinary click survives.
 *
 * Clicking a data point must open its Data tab on every graph, so this sweep checks every
 * graph type.
 *
 * It clicks twice, and the second click is the point. A handler can be present and correct yet
 * never fire: on the 3-D scatter `startOrbit` sits on the <svg> and 3px of movement sets its
 * drag flag, so if the point's own onClick bails on that flag, a *motionless* click selects the
 * point and an ordinary one, which always jitters a pixel or two, selects nothing. A sweep that
 * only fires a clean `click()` would call that kind healthy. Every kind is therefore clicked
 * still and with the mouse moving 4px, and both must select.
 *
 * Derived from the gallery, so a new chart type is covered the day its card is added.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Plot } from "@mady/core";
import { buildPlotScene } from "@mady/graphics";
import { PlotFigure } from "./PlotFigure";
import { galleryItems } from "./gallery";
import type { GraphSelection } from "./AppShell";

afterEach(cleanup);
const SIZE = { width: 580, height: 380 };

/** The selection kinds `Inspector` routes to the Data tab (`isDataSel`). */
const DATA_KINDS = new Set([
  "series", "pie-slice", "venn-set", "upset-set", "treemap-cell", "network-node", "network-edge",
  "parallel-line", "alluvial-node", "heatmap-cell", "corr-cell",
]);

/** Click every drawn element; return the distinct data selection kinds produced. */
function dataHits(kind: string, movePx: number): string[] {
  const g = galleryItems().find((x) => (x.plot.kind ?? "xy") === kind)!;
  const s = buildPlotScene(g.table, g.plot as Plot, SIZE);
  const got: GraphSelection[] = [];
  const { container } = render(
    <PlotFigure scene={s} zoom={1} onSelect={(x) => got.push(x)} onCamera3D={vi.fn()} onViewChange={vi.fn()} />,
  );
  const svg = container.querySelector("svg")!;
  for (const el of container.querySelectorAll("circle, rect, path, polygon, polyline, ellipse, line")) {
    fireEvent.pointerDown(el, { clientX: 100, clientY: 100, pointerId: 1 });
    if (movePx) fireEvent.pointerMove(svg, { clientX: 100 + movePx, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(svg, { clientX: 100 + movePx, clientY: 100, pointerId: 1 });
    fireEvent.click(el, { clientX: 100 + movePx, clientY: 100 });
  }
  cleanup();
  return [...new Set(got.filter((x) => x && DATA_KINDS.has(x.kind)).map((x) => x!.kind))];
}

const KINDS = galleryItems().map((g) => String(g.plot.kind ?? "xy"));

/**
 * Kinds with no data element by design — their clickable ink is bins/wholes, not series or
 * points, and clicking it opens the named section instead. Checked both ways below: a kind
 * listed here that starts emitting a data selection is a stale excuse and fails.
 */
const NO_DATA_ELEMENT: Record<string, string> = {
  // The card uses the banded horizon fold: every slice is a level of the band ramp, whose
  // colours live in the Chart type section — so a click opens that section, not a series.
  // (A plain density ridge still selects its series; only the banded fixture is listed here.)
  ridgeline: "banded ridge: slices are ramp LEVELS, opened in Chart type",
  rose: "wedges are BINS (many rows each) — a wedge click opens the Polar histogram chart-section, where its sectors/bands/colour controls live",
  // tracks is not listed: a numeric track's tiles + colour bar select
  // the track's own column (a data element → its "Colour by data" ramp), so tracks yields a data
  // selection. A categorical track's tiles still open the Chart type section.
  sunburst: "a ring segment is a BIN (an aggregated hierarchy node, many rows) — clicking it opens the Chart type chart-section, where its levels/value/colour controls live",
  chord: "an arc / ribbon is an aggregate (a node's total weight / a pair's weight, many rows) — clicking it opens the Chart type chart-section, where the node/ribbon controls live",
  oncoprint: "a tile is an aggregated cell (a gene × sample, possibly several alterations) — clicking it opens the Chart type chart-section, where the sort/colour controls live",
};

describe("clicking data opens the Data panel — on every graph type", () => {
  it("the sweep covers every kind (it is derived, not listed)", () => {
    expect(KINDS.length, "the gallery shrank — this sweep is measuring less than it claims").toBeGreaterThan(30);
  });

  for (const kind of KINDS) {
    if (kind in NO_DATA_ELEMENT) {
      it(`${kind}: has no data element on purpose (${NO_DATA_ELEMENT[kind]})`, () => {
        expect(dataHits(kind, 0), `${kind} now emits a DATA selection — take it off NO_DATA_ELEMENT and assert the click`).toEqual([]);
      });
      continue;
    }
    it(`${kind}: a still click selects a data element`, () => {
      expect(dataHits(kind, 0), `${kind} has no clickable data element at all`).not.toEqual([]);
    });

    it(`${kind}: …and so does a click with the mouse moving 4px`, () => {
      const still = dataHits(kind, 0);
      const wobble = dataHits(kind, 4);
      expect(wobble, `${kind}: a motionless click selected ${JSON.stringify(still)} but an ordinary one selected nothing — a drag gesture is eating the click`).not.toEqual([]);
    });
  }
});
